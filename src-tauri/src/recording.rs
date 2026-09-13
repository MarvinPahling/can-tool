//! The capture CSV format: one row per CAN frame, as pure functions.
//!
//! The schema is taken verbatim from the reference tool
//! (`ignore/canable/src/canable/capture.py`), which writes what `python-can`
//! reads. Matching it byte for byte is what lets recordings made by either
//! tool be replayed and analysed by the other, and it is why the formatting
//! rules below are exact rather than approximate:
//!
//! | column | rule |
//! |---|---|
//! | `timestamp` | Unix epoch **seconds**, exactly six decimals. |
//! | `arbitration_id` | `0x` + uppercase hex, **unpadded** (`0xA5`, not `0x0A5`). |
//! | the five flags | `0` / `1`, never `true` / `false`. |
//! | `dlc` | the **resolved byte count**, not the CAN FD nibble: a nibble-`A` frame writes `16`. |
//! | `data` | **lowercase**, unseparated hex. |
//!
//! Hand-rolled rather than pulled from a `csv` crate: the format has no
//! quoting, no embedded separators and no escapes, so a dependency would buy
//! nothing that a pure function does not, and a pure function is what this
//! crate's tests are built on.
//!
//! Nothing read back is trusted. A capture is a file on disk that a user can
//! edit and that another tool may have written, so every field is validated
//! and every error names its line — one bad row in a forty-thousand-line
//! recording is otherwise undebuggable.

use std::fmt::Write as _;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

use crate::can::{parse_hex, CanFrame, CAN_FD_DLC, MAX_EXTENDED_ID, MAX_STANDARD_ID};

pub const CAPTURE_HEADER: &str = "timestamp,arbitration_id,is_extended_id,is_fd,bitrate_switch,is_error_frame,is_remote_frame,dlc,data";

/// CRLF, because Python's `csv` module terminates lines with it by default and
/// every capture the reference tool has written therefore has it. Readers here
/// accept either, but writers should agree with the files already in the wild.
pub const CAPTURE_LINE_ENDING: &str = "\r\n";

const COLUMNS: usize = 9;

fn at(line_no: usize, message: impl AsRef<str>) -> String {
    format!("Line {line_no}: {}", message.as_ref())
}

fn flag(field: &str, name: &str, line_no: usize) -> Result<bool, String> {
    match field {
        "0" => Ok(false),
        "1" => Ok(true),
        other => Err(at(
            line_no,
            format!("{name} must be 0 or 1, found `{other}`"),
        )),
    }
}

/// One CSV row for a frame, without a line terminator.
pub fn frame_to_row(frame: &CanFrame) -> String {
    let mut row = String::with_capacity(48 + frame.data.len() * 2);
    let _ = write!(
        row,
        "{:.6},0x{:X},{},{},{},0,{},{},",
        frame.timestamp_ms / 1_000.0,
        frame.id,
        u8::from(frame.extended),
        u8::from(frame.fd),
        u8::from(frame.bitrate_switch),
        u8::from(frame.remote),
        frame.data.len(),
    );
    for byte in &frame.data {
        let _ = write!(row, "{byte:02x}");
    }
    row
}

/// Validates the first line of a capture, so a file in some other format
/// fails once, up front, rather than as one error per row.
pub fn check_header(line: &str) -> Result<(), String> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line == CAPTURE_HEADER {
        return Ok(());
    }
    Err(format!(
        "Not a capture file. Expected the header `{CAPTURE_HEADER}`, found `{line}`"
    ))
}

/// Parses one CSV row.
///
/// `Ok(None)` is a well-formed row that carries no frame we can represent —
/// today only an error frame, which `CanFrame` has no shape for. Rejecting it
/// would let one noisy moment on the bus unload an entire recording, so the
/// caller decides what to do about it. This is the same "valid input, not a
/// frame" contract `parse_slcan_frame` uses for adapter chatter.
pub fn row_to_frame(line: &str, line_no: usize) -> Result<Option<CanFrame>, String> {
    let line = line.trim_end_matches(['\r', '\n']);
    let fields: Vec<&str> = line.split(',').collect();
    if fields.len() != COLUMNS {
        return Err(at(
            line_no,
            format!("expected {COLUMNS} columns, found {}", fields.len()),
        ));
    }

    let seconds: f64 = fields[0].parse().map_err(|_| {
        at(
            line_no,
            format!("timestamp `{}` is not a number", fields[0]),
        )
    })?;
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(at(
            line_no,
            format!("timestamp `{}` is not a point in time", fields[0]),
        ));
    }

    let id_hex = fields[1]
        .strip_prefix("0x")
        .or_else(|| fields[1].strip_prefix("0X"))
        .unwrap_or(fields[1]);
    let id = parse_hex(id_hex).ok_or_else(|| {
        at(
            line_no,
            format!("arbitration_id `{}` is not hex", fields[1]),
        )
    })?;

    let extended = flag(fields[2], "is_extended_id", line_no)?;
    let fd = flag(fields[3], "is_fd", line_no)?;
    let bitrate_switch = flag(fields[4], "bitrate_switch", line_no)?;
    let error = flag(fields[5], "is_error_frame", line_no)?;
    let remote = flag(fields[6], "is_remote_frame", line_no)?;

    // Checked before the payload rules, which an error frame need not obey.
    if error {
        return Ok(None);
    }

    let max_id = if extended {
        MAX_EXTENDED_ID
    } else {
        MAX_STANDARD_ID
    };
    if id > max_id {
        return Err(at(
            line_no,
            format!(
                "arbitration_id `{}` is wider than {} bits",
                fields[1],
                if extended { 29 } else { 11 }
            ),
        ));
    }

    let dlc: usize = fields[7]
        .parse()
        .map_err(|_| at(line_no, format!("dlc `{}` is not a number", fields[7])))?;

    let hex = fields[8];
    if !hex.len().is_multiple_of(2) {
        return Err(at(
            line_no,
            format!("data `{hex}` has an odd number of hex digits"),
        ));
    }
    let data = hex
        .as_bytes()
        .chunks(2)
        .map(|pair| parse_hex(std::str::from_utf8(pair).ok()?).map(|b| b as u8))
        .collect::<Option<Vec<u8>>>()
        .ok_or_else(|| at(line_no, format!("data `{hex}` is not hex")))?;

    if remote {
        // A remote frame requests a length it does not carry, and `CanFrame`
        // has nowhere to keep that request — `parse_slcan_frame` drops it off
        // the wire for the same reason. The declared `dlc` is read and
        // discarded rather than being mistaken for a payload length.
        if !data.is_empty() {
            return Err(at(line_no, "a remote frame cannot carry data"));
        }
    } else {
        if data.len() != dlc {
            return Err(at(
                line_no,
                format!("dlc says {dlc} bytes, data carries {}", data.len()),
            ));
        }
        if fd {
            if !CAN_FD_DLC.contains(&dlc) {
                return Err(at(
                    line_no,
                    format!("{dlc} is not a length CAN FD can express"),
                ));
            }
        } else if dlc > 8 {
            return Err(at(
                line_no,
                format!("a classic CAN frame carries at most 8 bytes, dlc says {dlc}"),
            ));
        }
    }

    Ok(Some(CanFrame {
        id,
        extended,
        fd,
        bitrate_switch,
        remote,
        data,
        timestamp_ms: seconds * 1_000.0,
    }))
}

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

/// Big enough that a busy bus costs a handful of `write` syscalls a second
/// rather than one per frame.
const RECORDING_BUFFER_BYTES: usize = 64 * 1024;

/// How often the buffer is pushed to the disk regardless of how full it is, so
/// a crash costs at most a second of capture rather than 64 KiB of it.
const RECORDING_FLUSH_INTERVAL: Duration = Duration::from_secs(1);

/// Ceilings a recording stops itself at. Generous — roughly two hours of a
/// saturated bus — but finite: a recording left running overnight must not
/// fill the disk.
const DEFAULT_MAX_FRAMES: u64 = 20_000_000;
const DEFAULT_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Why a recording that has written `frames`/`bytes` has to stop, if it does.
pub(crate) fn ceiling_reached(
    frames: u64,
    bytes: u64,
    max_frames: u64,
    max_bytes: u64,
) -> Option<String> {
    if frames >= max_frames {
        return Some(format!("Stopped at the {max_frames} frame limit"));
    }
    if bytes >= max_bytes {
        return Some(format!("Stopped at the {max_bytes} byte size limit"));
    }
    None
}

/// The open file a recording writes through. Only the reader thread ever
/// touches one.
struct Sink {
    writer: BufWriter<File>,
    path: String,
    last_flush: Instant,
}

impl Sink {
    /// Opens the file and writes the header. Returns the header's size so the
    /// caller's byte count starts out honest.
    fn create(path: &str) -> Result<(Self, u64), String> {
        let file = File::create(path).map_err(|e| format!("Cannot write {path}: {e}"))?;
        let mut writer = BufWriter::with_capacity(RECORDING_BUFFER_BYTES, file);
        let header = format!("{CAPTURE_HEADER}{CAPTURE_LINE_ENDING}");
        writer
            .write_all(header.as_bytes())
            .map_err(|e| format!("Cannot write {path}: {e}"))?;

        Ok((
            Self {
                writer,
                path: path.to_string(),
                last_flush: Instant::now(),
            },
            header.len() as u64,
        ))
    }

    fn write_frame(&mut self, frame: &CanFrame) -> std::io::Result<u64> {
        let row = frame_to_row(frame);
        self.writer.write_all(row.as_bytes())?;
        self.writer.write_all(CAPTURE_LINE_ENDING.as_bytes())?;
        Ok((row.len() + CAPTURE_LINE_ENDING.len()) as u64)
    }

    fn flush_if_due(&mut self) {
        if self.last_flush.elapsed() >= RECORDING_FLUSH_INTERVAL {
            let _ = self.writer.flush();
            self.last_flush = Instant::now();
        }
    }
}

/// A capture in progress.
///
/// The counters live outside the sink's mutex on purpose. `recording_status`
/// is polled from the main thread, and the reader thread holds that mutex
/// across a buffered disk write — the same hazard `can.rs` documents for the
/// serial port, where a status poll must never be able to block behind I/O.
/// Reading the status therefore takes no lock the reader ever holds while
/// writing.
///
/// Only the reader thread mutates `frames`/`bytes`, so a plain load/store pair
/// is sufficient; the atomics exist to make the *read* from another thread
/// well-defined, not to make the update itself contended.
pub struct RecordingHandle {
    sink: Mutex<Option<Sink>>,
    recording: AtomicBool,
    frames: AtomicU64,
    bytes: AtomicU64,
    /// Kept after a stop, so the UI can still say what was written where.
    path: Mutex<Option<String>>,
    /// Set only when the recorder stopped *itself* — a ceiling or a write
    /// error. A deliberate stop leaves it empty.
    stopped_reason: Mutex<Option<String>>,
    max_frames: u64,
    max_bytes: u64,
}

impl Default for RecordingHandle {
    fn default() -> Self {
        Self::with_limits(DEFAULT_MAX_FRAMES, DEFAULT_MAX_BYTES)
    }
}

impl RecordingHandle {
    pub(crate) fn with_limits(max_frames: u64, max_bytes: u64) -> Self {
        Self {
            sink: Mutex::new(None),
            recording: AtomicBool::new(false),
            frames: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            path: Mutex::new(None),
            stopped_reason: Mutex::new(None),
            max_frames,
            max_bytes,
        }
    }

    pub(crate) fn start(&self, path: &str) -> Result<(), String> {
        let mut guard = self.sink.lock().map_err(|_| poisoned())?;
        if guard.is_some() {
            return Err("A recording is already running".to_string());
        }

        // Opened before anything is reset: a path that cannot be written must
        // leave the recorder exactly as it was.
        let (sink, header_bytes) = Sink::create(path)?;

        self.frames.store(0, Ordering::Relaxed);
        self.bytes.store(header_bytes, Ordering::Relaxed);
        set(&self.path, Some(path.to_string()));
        set(&self.stopped_reason, None);
        self.recording.store(true, Ordering::Relaxed);
        *guard = Some(sink);
        Ok(())
    }

    /// Writes a batch straight through to the disk. Called from the reader
    /// thread, ahead of the `can-frames` emit: the recording is ground truth,
    /// the event stream is best-effort.
    ///
    /// Never returns an error — the reader has nowhere to put one, and a
    /// recording that fails must not take the live view down with it. A
    /// failure closes the sink and surfaces through `stopped_reason`.
    pub(crate) fn write_frames(&self, frames: &[CanFrame]) {
        if frames.is_empty() {
            return;
        }
        let Ok(mut guard) = self.sink.lock() else {
            return;
        };
        let Some(sink) = guard.as_mut() else {
            return;
        };

        let mut written = self.frames.load(Ordering::Relaxed);
        let mut bytes = self.bytes.load(Ordering::Relaxed);
        let mut reason = None;

        for frame in frames {
            match sink.write_frame(frame) {
                Ok(size) => {
                    written += 1;
                    bytes += size;
                }
                Err(e) => {
                    reason = Some(format!("Stopped after a write error: {e}"));
                    break;
                }
            }
            // Checked per frame rather than per batch, so a ceiling stops the
            // recording exactly where it says it does.
            reason = ceiling_reached(written, bytes, self.max_frames, self.max_bytes);
            if reason.is_some() {
                break;
            }
        }

        self.frames.store(written, Ordering::Relaxed);
        self.bytes.store(bytes, Ordering::Relaxed);

        if let Some(reason) = reason {
            // Flushed on the way out, so a stopped recording is still a
            // readable capture rather than a truncated one.
            let _ = sink.writer.flush();
            *guard = None;
            self.recording.store(false, Ordering::Relaxed);
            set(&self.stopped_reason, Some(reason));
        } else {
            sink.flush_if_due();
        }
    }

    pub(crate) fn stop(&self) -> Result<RecordingSummary, String> {
        let mut guard = self.sink.lock().map_err(|_| poisoned())?;
        let Some(mut sink) = guard.take() else {
            return Err("No recording is running".to_string());
        };
        self.recording.store(false, Ordering::Relaxed);

        let flushed = sink.writer.flush();
        let summary = RecordingSummary {
            path: sink.path.clone(),
            frames: self.frames.load(Ordering::Relaxed),
            bytes: self.bytes.load(Ordering::Relaxed),
        };
        flushed.map_err(|e| format!("Cannot write {}: {e}", sink.path))?;
        Ok(summary)
    }

    /// Deliberately takes no lock the reader holds while writing.
    pub(crate) fn status(&self) -> RecordingStatus {
        RecordingStatus {
            recording: self.recording.load(Ordering::Relaxed),
            path: get(&self.path),
            frames: self.frames.load(Ordering::Relaxed),
            bytes: self.bytes.load(Ordering::Relaxed),
            stopped_reason: get(&self.stopped_reason),
        }
    }
}

fn poisoned() -> String {
    "Recording state poisoned".to_string()
}

fn get(slot: &Mutex<Option<String>>) -> Option<String> {
    slot.lock().ok().and_then(|value| value.clone())
}

fn set(slot: &Mutex<Option<String>>, value: Option<String>) {
    if let Ok(mut slot) = slot.lock() {
        *slot = value;
    }
}

/// Managed state. Holds the handle behind an `Arc` so the reader thread can
/// take its own reference and start/stop can work mid-connection.
#[derive(Default)]
pub struct RecordingState {
    pub(crate) handle: Arc<RecordingHandle>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RecordingStatus {
    pub recording: bool,
    pub path: Option<String>,
    pub frames: u64,
    pub bytes: u64,
    pub stopped_reason: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RecordingSummary {
    pub path: String,
    pub frames: u64,
    pub bytes: u64,
}

#[tauri::command]
pub fn start_recording(state: State<RecordingState>, path: String) -> Result<(), String> {
    state.handle.start(&path)
}

#[tauri::command]
pub fn stop_recording(state: State<RecordingState>) -> Result<RecordingSummary, String> {
    state.handle.stop()
}

#[tauri::command]
pub fn recording_status(state: State<RecordingState>) -> RecordingStatus {
    state.handle.status()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One row from `fixtures/reference-capture.csv`, the FD+BRS frame at
    /// DLC nibble `A` — 16 resolved bytes.
    const REFERENCE_ROW: &str =
        "1787839203.108521,0xA5,0,1,1,0,0,16,20e0020000000a990000000000000000";

    fn frame(overrides: impl FnOnce(&mut CanFrame)) -> CanFrame {
        let mut frame = CanFrame {
            id: 0xA5,
            extended: false,
            fd: true,
            bitrate_switch: true,
            remote: false,
            data: vec![
                0x20, 0xe0, 0x02, 0x00, 0x00, 0x00, 0x0a, 0x99, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00,
            ],
            timestamp_ms: 1_787_839_203_108.521,
        };
        overrides(&mut frame);
        frame
    }

    #[test]
    fn frame_to_row_matches_the_reference_formatting() {
        // Every one of these is a way to be subtly wrong: epoch *seconds* at
        // six decimals, an unpadded uppercase id, flags as 0/1, the resolved
        // byte count rather than the FD nibble, and lowercase payload hex.
        assert_eq!(frame_to_row(&frame(|_| {})), REFERENCE_ROW);
    }

    #[test]
    fn frame_to_row_writes_the_resolved_byte_count_not_the_fd_dlc_nibble() {
        let row = frame_to_row(&frame(|f| f.data = vec![0xFF; 24]));
        assert_eq!(
            row.split(',').nth(7),
            Some("24"),
            "24 bytes is DLC nibble C; writing 12 would make the file disagree with its own payload"
        );
    }

    #[test]
    fn frame_to_row_pads_a_short_id_with_nothing() {
        let row = frame_to_row(&frame(|f| f.id = 0x5));
        assert_eq!(row.split(',').nth(1), Some("0x5"));
    }

    #[test]
    fn frame_to_row_writes_an_extended_id_uppercase() {
        let row = frame_to_row(&frame(|f| {
            f.id = 0x18DA_F110;
            f.extended = true;
        }));
        assert_eq!(row.split(',').nth(1), Some("0x18DAF110"));
        assert_eq!(row.split(',').nth(2), Some("1"));
    }

    #[test]
    fn a_frame_round_trips_through_a_row() {
        for f in [
            frame(|_| {}),
            frame(|f| {
                f.id = 0x18DA_F110;
                f.extended = true;
                f.fd = false;
                f.bitrate_switch = false;
                f.data = vec![0xAA, 0xBB];
            }),
            frame(|f| f.data = Vec::new()),
        ] {
            let row = frame_to_row(&f);
            let parsed = row_to_frame(&row, 1).unwrap().unwrap();
            assert_eq!(parsed, f, "round trip changed the frame: {row}");
        }
    }

    #[test]
    fn every_row_of_the_reference_capture_round_trips_byte_for_byte() {
        // The claim this whole schema rests on: our writer produces what the
        // reference tool produces. Asserting on real recorded rows is what
        // makes that a fact rather than an intention.
        let capture = include_str!("../fixtures/reference-capture.csv");
        let mut rows = capture.lines();

        check_header(rows.next().expect("a header")).expect("the reference header");

        let mut seen = 0;
        for (index, row) in rows.enumerate() {
            let parsed = row_to_frame(row, index + 2)
                .unwrap_or_else(|e| panic!("{e}"))
                .expect("a data frame");
            assert_eq!(frame_to_row(&parsed), row.trim_end_matches('\r'));
            seen += 1;
        }
        assert!(
            seen > 30,
            "the fixture should carry real traffic, saw {seen}"
        );
    }

    #[test]
    fn check_header_tolerates_the_crlf_the_reference_writes() {
        // Python's `csv` module terminates lines with \r\n by default, so
        // every capture from the reference tool has it.
        check_header(&format!("{CAPTURE_HEADER}\r")).unwrap();
        check_header(CAPTURE_HEADER).unwrap();
    }

    #[test]
    fn check_header_rejects_a_foreign_csv() {
        let err = check_header("time,id,payload").unwrap_err();
        assert!(
            err.contains("timestamp"),
            "the error should show what was expected, got: {err}"
        );
    }

    #[test]
    fn a_remote_frame_carries_no_payload_and_no_length() {
        let row = frame_to_row(&frame(|f| {
            f.remote = true;
            f.fd = false;
            f.bitrate_switch = false;
            f.data = Vec::new();
        }));
        assert_eq!(row.split(',').nth(6), Some("1"), "is_remote_frame");
        // A remote frame requests a length it does not carry, and `CanFrame`
        // has nowhere to keep it — `parse_slcan_frame` drops it too. So the
        // request is recorded as a remote frame of length zero. Documented
        // here rather than left as a surprise.
        assert_eq!(row.split(',').nth(7), Some("0"), "dlc");
        assert_eq!(row.split(',').nth(8), Some(""), "data");

        let parsed = row_to_frame(&row, 1).unwrap().unwrap();
        assert!(parsed.remote);
        assert!(parsed.data.is_empty());
    }

    #[test]
    fn a_remote_row_from_a_foreign_capture_keeps_its_flag_but_loses_its_length() {
        let parsed = row_to_frame("1.000000,0x1A0,0,0,0,0,1,8,", 1)
            .unwrap()
            .unwrap();
        assert!(parsed.remote);
        assert!(
            parsed.data.is_empty(),
            "a remote frame carries no bytes whatever length it asked for"
        );
    }

    #[test]
    fn an_error_frame_row_is_valid_but_carries_no_frame() {
        // `CanFrame` cannot represent an error frame. Rejecting the row would
        // make one noisy moment on the bus unload a whole 40,000-line
        // recording, so it parses to `None` and the caller decides — the same
        // "valid input, not a frame" shape `parse_slcan_frame` uses.
        assert_eq!(
            row_to_frame("1.000000,0x1A0,0,0,0,1,0,0,", 1).unwrap(),
            None
        );
    }

    #[test]
    fn row_to_frame_names_the_line_in_its_error() {
        let cases = [
            ("1.0,0xZZ,0,0,0,0,0,0,", "a non-hex id"),
            ("1.0,0x1A0,0,0,0,0,0,1,ZZ", "a non-hex payload"),
            ("1.0,0x1A0,0,0,0,0,0,4,AABB", "a dlc that disagrees"),
            ("1.0,0x1A0,0,0,0,0,0", "too few columns"),
            ("1.0,0x1A0,0,0,0,0,0,0,,extra", "too many columns"),
            ("nope,0x1A0,0,0,0,0,0,0,", "a non-numeric timestamp"),
            ("1.0,0x1A0,2,0,0,0,0,0,", "a flag that is not 0 or 1"),
        ];

        for (row, what) in cases {
            let err = row_to_frame(row, 412).unwrap_err();
            assert!(
                err.contains("412"),
                "{what}: a 40,000-line capture with one bad row is undebuggable without the line number, got: {err}"
            );
        }
    }

    #[test]
    fn an_id_beyond_its_frame_format_is_rejected() {
        assert!(row_to_frame("1.0,0x800,0,0,0,0,0,0,", 1).is_err());
        assert!(row_to_frame("1.0,0x20000000,1,0,0,0,0,0,", 1).is_err());
        // The same ids are fine one bit narrower.
        assert!(row_to_frame("1.0,0x7FF,0,0,0,0,0,0,", 1).is_ok());
        assert!(row_to_frame("1.0,0x1FFFFFFF,1,0,0,0,0,0,", 1).is_ok());
    }

    #[test]
    fn a_classic_frame_cannot_carry_more_than_eight_bytes() {
        assert!(
            row_to_frame("1.0,0x1A0,0,0,0,0,0,16,00112233445566778899aabbccddeeff", 1).is_err()
        );
    }

    #[test]
    fn an_fd_length_that_no_dlc_can_express_is_rejected() {
        // 9 bytes is not a CAN FD length; the nibble steps 8 -> 12.
        assert!(row_to_frame("1.0,0x1A0,0,1,0,0,0,9,001122334455667788", 1).is_err());
    }

    #[test]
    fn an_id_may_be_written_without_the_hex_prefix() {
        // The reference analysis scripts read ids with `int(x, 16)`, which
        // accepts both. Be liberal here and strict in `frame_to_row`.
        let parsed = row_to_frame("1.000000,1A0,0,0,0,0,0,0,", 1)
            .unwrap()
            .unwrap();
        assert_eq!(parsed.id, 0x1A0);
    }

    #[test]
    fn a_payload_may_be_written_in_upper_case() {
        let parsed = row_to_frame("1.000000,0x1A0,0,0,0,0,0,2,AABB", 1)
            .unwrap()
            .unwrap();
        assert_eq!(parsed.data, vec![0xAA, 0xBB]);
    }

    #[test]
    fn a_timestamp_survives_the_seconds_conversion() {
        let parsed = row_to_frame(REFERENCE_ROW, 1).unwrap().unwrap();
        assert_eq!(parsed.timestamp_ms, 1_787_839_203_108.521);
    }

    // ---- the recorder ----

    fn temp_path() -> (tempfile::NamedTempFile, String) {
        let file = tempfile::NamedTempFile::new().expect("a temp file");
        let path = file.path().to_string_lossy().into_owned();
        (file, path)
    }

    fn rows_of(path: &str) -> Vec<String> {
        std::fs::read_to_string(path)
            .expect("the capture")
            .lines()
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn ceiling_reached_is_none_below_both_limits() {
        assert_eq!(ceiling_reached(9, 9, 10, 10), None);
    }

    #[test]
    fn ceiling_reached_names_which_limit_was_hit() {
        let frames = ceiling_reached(10, 0, 10, 100).expect("the frame ceiling");
        assert!(frames.contains("frame"), "got: {frames}");

        let bytes = ceiling_reached(0, 100, 10, 100).expect("the size ceiling");
        assert!(
            bytes.contains("size") || bytes.contains("byte"),
            "got: {bytes}"
        );
    }

    #[test]
    fn a_recording_writes_the_header_ahead_of_the_first_frame() {
        let (_temp, path) = temp_path();
        let handle = RecordingHandle::default();
        handle.start(&path).unwrap();
        handle.write_frames(&[frame(|_| {}), frame(|f| f.id = 0x272)]);
        handle.stop().unwrap();

        let rows = rows_of(&path);
        check_header(&rows[0]).expect("the header comes first");
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn frames_written_to_a_recording_parse_back() {
        let (_temp, path) = temp_path();
        let handle = RecordingHandle::default();
        handle.start(&path).unwrap();

        let written = [
            frame(|_| {}),
            frame(|f| {
                f.id = 0x18DA_F110;
                f.extended = true;
                f.fd = false;
                f.bitrate_switch = false;
                f.data = vec![0xAA, 0xBB];
            }),
        ];
        handle.write_frames(&written);
        handle.stop().unwrap();

        let rows = rows_of(&path);
        let parsed: Vec<CanFrame> = rows[1..]
            .iter()
            .enumerate()
            .map(|(i, row)| row_to_frame(row, i + 2).unwrap().unwrap())
            .collect();
        assert_eq!(parsed, written);
    }

    #[test]
    fn stopping_flushes_the_buffer() {
        let (_temp, path) = temp_path();
        let handle = RecordingHandle::default();
        handle.start(&path).unwrap();
        handle.write_frames(&[frame(|_| {})]);

        // A 64 KiB BufWriter has not touched the disk yet.
        assert_eq!(rows_of(&path).len(), 0, "nothing should be flushed yet");

        let summary = handle.stop().unwrap();
        assert_eq!(
            rows_of(&path).len(),
            2,
            "the last frame must reach the disk"
        );
        assert_eq!(summary.frames, 1);
        assert_eq!(summary.path, path);
    }

    #[test]
    fn starting_twice_is_refused() {
        let (_temp, first) = temp_path();
        let (_temp2, second) = temp_path();
        let handle = RecordingHandle::default();
        handle.start(&first).unwrap();

        assert!(handle.start(&second).is_err());
        assert_eq!(
            handle.status().path.as_deref(),
            Some(first.as_str()),
            "the running recording must not be swapped out from under itself"
        );
    }

    #[test]
    fn a_path_that_cannot_be_opened_fails_before_any_state_is_touched() {
        let handle = RecordingHandle::default();
        let err = handle
            .start("/nonexistent-directory/capture.csv")
            .unwrap_err();

        assert!(
            err.contains("capture.csv"),
            "the error should name the path, got: {err}"
        );
        let status = handle.status();
        assert!(!status.recording);
        assert_eq!(status.path, None);
    }

    #[test]
    fn stopping_without_a_recording_is_refused() {
        assert!(RecordingHandle::default().stop().is_err());
    }

    #[test]
    fn writing_without_a_recording_is_a_no_op() {
        let handle = RecordingHandle::default();
        handle.write_frames(&[frame(|_| {})]);
        assert_eq!(handle.status().frames, 0);
    }

    #[test]
    fn the_frame_ceiling_stops_the_recording_and_leaves_a_valid_file() {
        let (_temp, path) = temp_path();
        let handle = RecordingHandle::with_limits(3, u64::MAX);
        handle.start(&path).unwrap();
        handle.write_frames(&vec![frame(|_| {}); 5]);

        let status = handle.status();
        assert!(!status.recording, "the ceiling must stop the recording");
        assert_eq!(status.frames, 3, "and stop it exactly at the limit");
        assert!(
            status.stopped_reason.unwrap_or_default().contains("frame"),
            "the UI has to be able to say why it stopped"
        );

        // Stopped, not corrupted: the file is still a capture.
        let rows = rows_of(&path);
        check_header(&rows[0]).unwrap();
        assert_eq!(rows.len(), 4);
        for (i, row) in rows[1..].iter().enumerate() {
            row_to_frame(row, i + 2).unwrap().unwrap();
        }
    }

    #[test]
    fn the_size_ceiling_stops_the_recording() {
        let (_temp, path) = temp_path();
        let handle = RecordingHandle::with_limits(u64::MAX, 200);
        handle.start(&path).unwrap();
        handle.write_frames(&vec![frame(|_| {}); 20]);

        let status = handle.status();
        assert!(!status.recording);
        assert!(status.frames > 0 && status.frames < 20);
        assert!(status.bytes >= 200);
    }

    #[test]
    fn the_status_reports_progress_and_survives_the_stop() {
        let (_temp, path) = temp_path();
        let handle = RecordingHandle::default();
        handle.start(&path).unwrap();
        handle.write_frames(&[frame(|_| {}), frame(|_| {})]);

        let running = handle.status();
        assert!(running.recording);
        assert_eq!(running.frames, 2);
        assert!(running.bytes > 0);
        assert_eq!(running.path.as_deref(), Some(path.as_str()));

        handle.stop().unwrap();
        let stopped = handle.status();
        assert!(!stopped.recording);
        assert_eq!(
            stopped.frames, 2,
            "the UI still has to say what was written"
        );
        assert_eq!(stopped.path.as_deref(), Some(path.as_str()));
        assert_eq!(
            stopped.stopped_reason, None,
            "a deliberate stop has no reason"
        );
    }

    #[test]
    fn a_new_recording_clears_the_previous_run() {
        let (_temp, first) = temp_path();
        let (_temp2, second) = temp_path();
        let handle = RecordingHandle::with_limits(1, u64::MAX);
        handle.start(&first).unwrap();
        handle.write_frames(&[frame(|_| {}), frame(|_| {})]);
        assert!(handle.status().stopped_reason.is_some());

        handle.start(&second).unwrap();
        let status = handle.status();
        assert_eq!(status.frames, 0);
        assert_eq!(status.stopped_reason, None, "a stale reason would be a lie");
        assert_eq!(status.path.as_deref(), Some(second.as_str()));
    }

    #[test]
    fn a_non_finite_or_negative_timestamp_is_rejected() {
        assert!(row_to_frame("nan,0x1A0,0,0,0,0,0,0,", 1).is_err());
        assert!(row_to_frame("inf,0x1A0,0,0,0,0,0,0,", 1).is_err());
        assert!(row_to_frame("-1.0,0x1A0,0,0,0,0,0,0,", 1).is_err());
    }
}
