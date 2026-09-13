//! Synthetic captures, so the shapes that break the live view can be produced
//! on demand instead of waited for.
//!
//! Two of them are hard to catch in the wild and impossible to catch twice:
//! a bus carrying thousands of distinct 29-bit ids (the per-id state map has
//! nothing bounding it), and a sustained frame rate high enough to keep the
//! main thread behind the emit queue. Both are one call away here.
//!
//! **Everything is derived from `seed`.** A generator whose output drifts
//! between runs cannot be used to compare a fix against a baseline, which is
//! the only reason this module exists. That is also why the RNG is a
//! hand-rolled xorshift rather than a `rand` dependency, and why the first
//! timestamp is a fixed epoch rather than `now`: two runs of the same spec
//! produce byte-identical files.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};

use serde::Deserialize;

use crate::can::{encode_can_message, signal_range, CanFrame, CAN_FD_DLC};
use crate::dbc::{DbcFile, DbcMessage, DbcSignal};
use crate::recording::{frame_to_row, RecordingSummary, CAPTURE_HEADER, CAPTURE_LINE_ENDING};

/// Where synthetic ids start. Standard ids leave the low block free so a
/// generated capture never collides with the diagnostic range people watch for.
const STANDARD_ID_BASE: u32 = 0x100;
const EXTENDED_ID_BASE: u32 = 0x1000_0000;
const MAX_STANDARD_IDS: u32 = 0x7FF - STANDARD_ID_BASE + 1;
const MAX_EXTENDED_IDS: u32 = 0x1FFF_FFFF - EXTENDED_ID_BASE + 1;

/// A fixed point in time for the first frame, so the same spec produces the
/// same bytes. A capture's absolute date is meaningless to a replay, which
/// works entirely off deltas.
const SYNTHETIC_EPOCH_MS: f64 = 1_800_000_000_000.0;

/// Ceiling on one generated file. Roughly a gigabyte of CSV.
const MAX_GENERATED_FRAMES: u64 = 15_000_000;

/// What to generate. Every axis here is one the live view is sensitive to.
#[derive(Deserialize, Clone)]
pub struct CaptureSpec {
    pub seed: u32,
    pub duration_ms: f64,
    /// Distinct CAN ids. Ignored past the message count when `from_dbc` is set.
    pub id_count: u32,
    /// 29-bit ids. Ignored when `from_dbc` is set — the DBC decides.
    pub extended: bool,
    /// How often each id repeats. The frame rate is `id_count * 1000 / cycle_ms`.
    pub cycle_ms: f64,
    /// Fraction of ids that are CAN FD. Since every id emits equally often,
    /// this is also the fraction of frames.
    pub fd_ratio: f64,
    /// Fraction of the **FD** ids that also switch bitrate. BRS does not exist
    /// without FD.
    pub brs_ratio: f64,
    /// How much of a payload changes from one frame to the next, 0 to 1.
    ///
    /// Not cosmetic: a capture of unchanging payloads never trips
    /// `hasSignificantChange`, so it never creates a highlight animation and
    /// exercises none of the render path under suspicion. Static traffic would
    /// flatter every measurement.
    pub churn: f64,
    /// Take ids and payload layouts from a real DBC, so frames decode to
    /// plausible physical values instead of noise.
    pub from_dbc: Option<DbcFile>,
}

/// A spec that has been checked, with the derived numbers the loop needs.
#[derive(Debug)]
pub(crate) struct ValidSpec {
    frames: u64,
    /// Spacing between consecutive frames: one cycle shared out across the ids.
    slot_ms: f64,
    id_count: u32,
    fd_count: u32,
    brs_count: u32,
}

fn finite_positive(value: f64, name: &str) -> Result<(), String> {
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("{name} must be a number greater than zero"));
    }
    Ok(())
}

fn ratio(value: f64, name: &str) -> Result<(), String> {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err(format!("{name} must be between 0 and 1"));
    }
    Ok(())
}

pub(crate) fn validate_spec(spec: &CaptureSpec) -> Result<ValidSpec, String> {
    finite_positive(spec.duration_ms, "Duration")?;
    finite_positive(spec.cycle_ms, "Cycle time")?;
    ratio(spec.fd_ratio, "FD ratio")?;
    ratio(spec.brs_ratio, "BRS ratio")?;
    ratio(spec.churn, "Churn")?;

    let available = match &spec.from_dbc {
        Some(dbc) => dbc.messages.len() as u32,
        None if spec.extended => MAX_EXTENDED_IDS,
        None => MAX_STANDARD_IDS,
    };
    if spec.id_count == 0 || available == 0 {
        return Err("A capture needs at least one message id".to_string());
    }
    if spec.from_dbc.is_none() && spec.id_count > available {
        return Err(format!(
            "{} ids do not fit the 11-bit id space (max {available}); set extended for a 29-bit capture",
            spec.id_count
        ));
    }
    let id_count = spec.id_count.min(available);

    let slot_ms = spec.cycle_ms / id_count as f64;
    let frames = (spec.duration_ms / slot_ms).ceil() as u64;
    if frames > MAX_GENERATED_FRAMES {
        return Err(format!(
            "That spec would generate {frames} frames; the limit is {MAX_GENERATED_FRAMES}"
        ));
    }

    // Taken from the head of the id list rather than sampled, so the ratio is
    // exact and a test can assert it instead of a distribution.
    let fd_count = (id_count as f64 * spec.fd_ratio).round() as u32;
    let brs_count = (fd_count as f64 * spec.brs_ratio).round() as u32;

    Ok(ValidSpec {
        frames,
        slot_ms,
        id_count,
        fd_count,
        brs_count,
    })
}

pub(crate) fn synthetic_id(index: u32, extended: bool) -> u32 {
    if extended {
        EXTENDED_ID_BASE + index
    } else {
        STANDARD_ID_BASE + index
    }
}

/// xorshift64*, seeded through a splitmix step so neighbouring seeds do not
/// produce neighbouring streams. Deterministic and dependency-free, which is
/// the entire requirement.
struct Rng(u64);

impl Rng {
    fn new(seed: u32) -> Self {
        let mut state = (seed as u64).wrapping_add(0x9E37_79B9_7F4A_7C15);
        state = (state ^ (state >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        state = (state ^ (state >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        Self(state ^ (state >> 31) | 1)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn next_u8(&mut self) -> u8 {
        (self.next_u64() >> 33) as u8
    }

    /// A uniform value in `[0, 1)`.
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn chance(&mut self, probability: f64) -> bool {
        self.unit() < probability
    }

    fn in_range(&mut self, len: usize) -> usize {
        (self.next_u64() % len as u64) as usize
    }
}

/// One id's fixed properties plus the payload it is currently carrying.
struct Profile {
    id: u32,
    extended: bool,
    fd: bool,
    bitrate_switch: bool,
    data: Vec<u8>,
    /// Present only for a DBC-seeded capture: the message and its live values.
    source: Option<(DbcMessage, HashMap<String, f64>)>,
}

/// Picks a value the signal can actually encode.
///
/// Derived from `signal_range` rather than the DBC's declared min/max, which
/// reverse-engineered files routinely leave as a placeholder — the same reason
/// `encode_can_message` validates against the derived range.
fn value_in_range(signal: &DbcSignal, rng: &mut Rng) -> f64 {
    let (min, max) = signal_range(signal);
    min + (max - min) * rng.unit()
}

fn build_profiles(
    spec: &CaptureSpec,
    valid: &ValidSpec,
    rng: &mut Rng,
) -> Result<Vec<Profile>, String> {
    let mut profiles = Vec::with_capacity(valid.id_count as usize);

    for index in 0..valid.id_count {
        let fd = index < valid.fd_count;
        let bitrate_switch = index < valid.brs_count;

        let profile = match &spec.from_dbc {
            Some(dbc) => {
                let message = dbc.messages[index as usize].clone();
                let values: HashMap<String, f64> = message
                    .signals
                    .iter()
                    .map(|signal| (signal.name.clone(), value_in_range(signal, rng)))
                    .collect();
                let data = encode_can_message(message.clone(), values.clone())
                    .map_err(|e| format!("Message '{}' cannot be encoded: {e}", message.name))?;

                Profile {
                    id: message.id,
                    extended: message.extended,
                    fd,
                    bitrate_switch,
                    data,
                    source: Some((message, values)),
                }
            }
            None => {
                let len = if fd {
                    // Skip the zero-length entry; an empty payload decodes to
                    // nothing and exercises none of the render path.
                    CAN_FD_DLC[1 + rng.in_range(CAN_FD_DLC.len() - 1)]
                } else {
                    1 + rng.in_range(8)
                };
                Profile {
                    id: synthetic_id(index, spec.extended),
                    extended: spec.extended,
                    fd,
                    bitrate_switch,
                    data: (0..len).map(|_| rng.next_u8()).collect(),
                    source: None,
                }
            }
        };
        profiles.push(profile);
    }

    Ok(profiles)
}

/// Moves a profile's payload on by `churn`, in place.
fn churn_payload(profile: &mut Profile, churn: f64, rng: &mut Rng) -> Result<(), String> {
    match &mut profile.source {
        Some((message, values)) => {
            let mut changed = false;
            for signal in &message.signals {
                if rng.chance(churn) {
                    values.insert(signal.name.clone(), value_in_range(signal, rng));
                    changed = true;
                }
            }
            if changed {
                profile.data = encode_can_message(message.clone(), values.clone())
                    .map_err(|e| format!("Message '{}' cannot be encoded: {e}", message.name))?;
            }
        }
        None => {
            for byte in &mut profile.data {
                if rng.chance(churn) {
                    *byte = rng.next_u8();
                }
            }
        }
    }
    Ok(())
}

/// Writes a whole capture, streaming.
///
/// Frames are emitted round-robin, one per `slot_ms`, which makes the sequence
/// sorted by construction — no buffer of a million frames waiting to be sorted,
/// the same mistake the recorder is careful not to make.
pub(crate) fn generate_into<W: Write>(spec: &CaptureSpec, out: &mut W) -> Result<u64, String> {
    let valid = validate_spec(spec)?;
    let mut rng = Rng::new(spec.seed);
    let mut profiles = build_profiles(spec, &valid, &mut rng)?;

    let io = |e: std::io::Error| format!("Cannot write the capture: {e}");
    out.write_all(format!("{CAPTURE_HEADER}{CAPTURE_LINE_ENDING}").as_bytes())
        .map_err(io)?;

    for index in 0..valid.frames {
        let profile = &mut profiles[(index % valid.id_count as u64) as usize];

        // The first frame of each id carries the payload it was built with;
        // churn applies from its second appearance onwards.
        if index >= valid.id_count as u64 {
            churn_payload(profile, spec.churn, &mut rng)?;
        }

        let frame = CanFrame {
            id: profile.id,
            extended: profile.extended,
            fd: profile.fd,
            bitrate_switch: profile.bitrate_switch,
            remote: false,
            data: profile.data.clone(),
            timestamp_ms: SYNTHETIC_EPOCH_MS + index as f64 * valid.slot_ms,
        };

        out.write_all(frame_to_row(&frame).as_bytes()).map_err(io)?;
        out.write_all(CAPTURE_LINE_ENDING.as_bytes()).map_err(io)?;
    }

    Ok(valid.frames)
}

#[tauri::command]
pub fn generate_capture(path: String, spec: CaptureSpec) -> Result<RecordingSummary, String> {
    // Checked before the file is created, so a bad spec does not leave an
    // empty capture behind.
    validate_spec(&spec)?;

    let file = File::create(&path).map_err(|e| format!("Cannot write {path}: {e}"))?;
    let mut writer = BufWriter::new(file);
    let frames = generate_into(&spec, &mut writer)?;
    writer
        .flush()
        .map_err(|e| format!("Cannot write {path}: {e}"))?;

    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(RecordingSummary {
        path,
        frames,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dbc::DbcMultiplexer;
    use crate::recording::parse_capture;

    fn spec(overrides: impl FnOnce(&mut CaptureSpec)) -> CaptureSpec {
        let mut spec = CaptureSpec {
            seed: 7,
            duration_ms: 100.0,
            id_count: 4,
            extended: false,
            cycle_ms: 20.0,
            fd_ratio: 0.0,
            brs_ratio: 0.0,
            churn: 1.0,
            from_dbc: None,
        };
        overrides(&mut spec);
        spec
    }

    fn generate(spec: &CaptureSpec) -> String {
        let mut out = Vec::new();
        generate_into(spec, &mut out).expect("a capture");
        String::from_utf8(out).expect("utf-8")
    }

    fn frames_of(text: &str) -> Vec<CanFrame> {
        parse_capture(text, 1_000_000)
            .expect("a valid capture")
            .frames
    }

    #[test]
    fn the_same_seed_produces_identical_bytes() {
        // The reason the generator exists: a before/after measurement is only
        // a measurement if both runs saw the same traffic.
        assert_eq!(generate(&spec(|_| {})), generate(&spec(|_| {})));
    }

    #[test]
    fn a_different_seed_produces_different_payloads() {
        let a = generate(&spec(|s| s.seed = 1));
        let b = generate(&spec(|s| s.seed = 2));
        assert_ne!(a, b);
    }

    #[test]
    fn generated_output_parses_back_through_the_codec() {
        let frames = frames_of(&generate(&spec(|s| {
            s.fd_ratio = 0.5;
            s.brs_ratio = 1.0;
        })));
        assert!(!frames.is_empty());
    }

    #[test]
    fn every_requested_id_appears_exactly_once_in_a_single_cycle() {
        let frames = frames_of(&generate(&spec(|s| {
            s.id_count = 8;
            s.cycle_ms = 20.0;
            s.duration_ms = 20.0;
        })));

        let mut ids: Vec<u32> = frames.iter().map(|f| f.id).collect();
        assert_eq!(ids.len(), 8);
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 8, "every id must be distinct");
    }

    #[test]
    fn the_frame_rate_matches_the_requested_cycle_and_id_count() {
        // 50 ids at 20 ms is 2500 frames/s.
        let frames = frames_of(&generate(&spec(|s| {
            s.id_count = 50;
            s.cycle_ms = 20.0;
            s.duration_ms = 1_000.0;
        })));

        let rate = frames.len() as f64;
        assert!(
            (rate - 2_500.0).abs() <= 2.0,
            "expected about 2500 frames in a second, got {rate}"
        );
    }

    #[test]
    fn timestamps_are_monotonically_non_decreasing() {
        let frames = frames_of(&generate(&spec(|s| s.id_count = 16)));
        assert!(frames
            .windows(2)
            .all(|w| w[1].timestamp_ms >= w[0].timestamp_ms));
    }

    #[test]
    fn the_fd_and_brs_ratios_are_honoured() {
        let frames = frames_of(&generate(&spec(|s| {
            s.id_count = 10;
            s.cycle_ms = 20.0;
            s.duration_ms = 20.0;
            s.fd_ratio = 0.6;
            s.brs_ratio = 0.5;
        })));

        assert_eq!(frames.iter().filter(|f| f.fd).count(), 6);
        assert_eq!(frames.iter().filter(|f| f.bitrate_switch).count(), 3);
        assert!(
            frames.iter().all(|f| f.fd || !f.bitrate_switch),
            "a classic frame cannot switch bitrate"
        );
    }

    #[test]
    fn zero_churn_repeats_an_ids_payload_unchanged() {
        // A static capture exercises none of the highlight path, which is why
        // churn is a knob rather than a constant — and why it defaults high.
        let frames = frames_of(&generate(&spec(|s| {
            s.id_count = 2;
            s.churn = 0.0;
        })));

        for id in [synthetic_id(0, false), synthetic_id(1, false)] {
            let payloads: Vec<&Vec<u8>> = frames
                .iter()
                .filter(|f| f.id == id)
                .map(|f| &f.data)
                .collect();
            assert!(payloads.len() > 1);
            assert!(payloads.windows(2).all(|w| w[0] == w[1]));
        }
    }

    #[test]
    fn full_churn_moves_the_payload() {
        let frames = frames_of(&generate(&spec(|s| {
            s.id_count = 1;
            s.churn = 1.0;
        })));
        let payloads: Vec<&Vec<u8>> = frames.iter().map(|f| &f.data).collect();
        assert!(payloads.windows(2).any(|w| w[0] != w[1]));
    }

    #[test]
    fn a_standard_id_count_beyond_the_11_bit_space_is_refused() {
        let err = validate_spec(&spec(|s| s.id_count = 5_000)).unwrap_err();
        assert!(
            err.contains("extended"),
            "the message should point at the way out, got: {err}"
        );
    }

    #[test]
    fn an_extended_capture_can_carry_twenty_thousand_ids() {
        // One of the two shapes this generator exists to produce: a 29-bit bus
        // where the live view's per-id map has nothing to bound it.
        let frames = frames_of(&generate(&spec(|s| {
            s.id_count = 20_000;
            s.extended = true;
            s.cycle_ms = 1_000.0;
            s.duration_ms = 1_000.0;
        })));

        assert_eq!(frames.len(), 20_000);
        assert!(frames.iter().all(|f| f.extended));
    }

    #[test]
    fn validate_spec_rejects_a_spec_that_cannot_mean_anything() {
        assert!(validate_spec(&spec(|s| s.id_count = 0)).is_err());
        assert!(validate_spec(&spec(|s| s.cycle_ms = 0.0)).is_err());
        assert!(validate_spec(&spec(|s| s.duration_ms = 0.0)).is_err());
        assert!(validate_spec(&spec(|s| s.duration_ms = f64::NAN)).is_err());
        assert!(validate_spec(&spec(|s| s.fd_ratio = 1.5)).is_err());
        assert!(validate_spec(&spec(|s| s.brs_ratio = -0.1)).is_err());
        assert!(validate_spec(&spec(|s| s.churn = 2.0)).is_err());
    }

    #[test]
    fn a_capture_beyond_the_generation_cap_is_refused() {
        let err = validate_spec(&spec(|s| {
            s.id_count = 1_000;
            s.cycle_ms = 1.0;
            s.duration_ms = 3_600_000.0;
        }))
        .unwrap_err();
        assert!(err.contains("frames"), "got: {err}");
    }

    // ---- seeding from a DBC ----

    fn dbc_fixture() -> DbcFile {
        let signal = |name: &str, start_bit: u64, size: u64, factor: f64, offset: f64| DbcSignal {
            name: name.to_string(),
            start_bit,
            size,
            little_endian: true,
            signed: false,
            factor,
            offset,
            min: 0.0,
            max: 0.0,
            unit: String::new(),
            receivers: Vec::new(),
            multiplexer: DbcMultiplexer::Plain,
        };

        DbcFile {
            version: "1".to_string(),
            nodes: Vec::new(),
            messages: vec![DbcMessage {
                id: 0x1A0,
                extended: false,
                name: "Status".to_string(),
                size: 4,
                transmitter: None,
                signals: vec![
                    signal("Speed", 0, 16, 0.01, 0.0),
                    signal("Temp", 16, 8, 1.0, -40.0),
                ],
            }],
        }
    }

    #[test]
    fn a_dbc_seeded_capture_uses_the_dbc_ids() {
        let frames = frames_of(&generate(&spec(|s| {
            s.from_dbc = Some(dbc_fixture());
            s.id_count = 4;
        })));
        assert!(frames.iter().all(|f| f.id == 0x1A0));
        assert!(frames.iter().all(|f| f.data.len() == 4));
    }

    #[test]
    fn a_dbc_seeded_capture_decodes_to_in_range_values() {
        let dbc = dbc_fixture();
        let frames = frames_of(&generate(&spec(|s| {
            s.from_dbc = Some(dbc_fixture());
            s.id_count = 1;
        })));

        let message = &dbc.messages[0];
        for frame in &frames {
            for signal in &message.signals {
                let (min, max) = crate::can::signal_range(signal);
                let raw = decode_raw(&frame.data, signal);
                let value = raw * signal.factor + signal.offset;
                assert!(
                    value >= min && value <= max,
                    "{} decoded to {value}, outside [{min}, {max}]",
                    signal.name
                );
            }
        }
    }

    /// Little-endian raw read, enough for the fixture above.
    fn decode_raw(data: &[u8], signal: &DbcSignal) -> f64 {
        let mut raw: u64 = 0;
        for bit in 0..signal.size {
            let index = signal.start_bit + bit;
            let byte = data[(index / 8) as usize];
            if byte >> (index % 8) & 1 == 1 {
                raw |= 1 << bit;
            }
        }
        raw as f64
    }
}
