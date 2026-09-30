//! Replaying a recorded capture as a virtual CAN source.
//!
//! A replay emits the same `can-frames` events the slcan reader does, on the
//! same batching cadence, from a background thread. That is the whole point:
//! the leading suspect for the live view's memory growth is the IPC hop
//! itself, and a replay that handed frames to the decoder in JavaScript would
//! skip precisely the layer under investigation and produce a reassuring,
//! meaningless number. The frontend cannot tell a replay from an adapter, so
//! everything downstream of the reader is exercised unchanged — with no
//! hardware attached, and with the same traffic every run.
//!
//! As with `simulation.rs`, the timing arithmetic is separated from the thread
//! that acts on it: `schedule_offsets`, `capture_span_ms` and `loop_shift_ms`
//! are pure, so the part that is easy to get subtly wrong is the part that is
//! unit-tested.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::can::{self, ensure_no_device, CanFrame, CanState};
use crate::recording::parse_capture_file;
use crate::simulation::wait_until;

/// How many frames one replay may hold. A memory bound rather than a format
/// rule — the frames stay in RAM for the whole run, so opening the wrong
/// multi-gigabyte file has to be a message rather than an out-of-memory abort.
/// Deliberately lower than the recorder's own ceiling: a recording is for
/// analysis as well as replay, and may legitimately be larger than this.
pub const MAX_REPLAY_FRAMES: usize = 5_000_000;

/// How many source bytes a replay may parse.
///
/// This is distinct from `MAX_REPLAY_FRAMES`: the frame cap bounds the retained
/// `Vec<CanFrame>`, while this cap prevents the old startup peak of a full CSV
/// `String` plus the parsed frames. 256 MiB leaves headroom for a near-cap
/// compact capture on commodity machines while rejecting the accidental
/// multi-gigabyte input before its contents are allocated.
pub const MAX_REPLAY_CAPTURE_BYTES: u64 = 256 * 1024 * 1024;

/// Inserted between the last frame of one pass and the first of the next, so a
/// repeated capture does not emit two frames claiming the same instant.
const LOOP_GAP_MS: f64 = 1.0;

/// When each frame is due, relative to the start of the pass.
///
/// Offsets rather than deadlines so the arithmetic can be tested without a
/// clock. Clamped to be non-decreasing: `FrameClock` cannot produce a
/// backwards timestamp, but a hand-edited or foreign capture can, and there is
/// no such thing as an `Instant` in the past of another one.
pub(crate) fn schedule_offsets(frames: &[CanFrame], speed: f64) -> Vec<Duration> {
    let Some(first) = frames.first() else {
        return Vec::new();
    };
    let base = first.timestamp_ms;

    let mut offsets = Vec::with_capacity(frames.len());
    let mut previous = Duration::ZERO;
    for frame in frames {
        let ms = ((frame.timestamp_ms - base) / speed).max(0.0);
        let offset = Duration::from_secs_f64(ms / 1_000.0).max(previous);
        previous = offset;
        offsets.push(offset);
    }
    offsets
}

/// How long the capture covers, first frame to last.
pub(crate) fn capture_span_ms(frames: &[CanFrame]) -> f64 {
    match (frames.first(), frames.last()) {
        (Some(first), Some(last)) => (last.timestamp_ms - first.timestamp_ms).max(0.0),
        _ => 0.0,
    }
}

/// How far pass `loop_index` shifts every recorded timestamp forward.
///
/// Without this a repeated capture replays the same `timestamp_ms` twice. The
/// live view keys its fade on `changedAt`, which is that timestamp, so the
/// second pass would set the same value at the same instant and never re-fire
/// a highlight — the page would look frozen while frames were still arriving.
pub(crate) fn loop_shift_ms(span_ms: f64, loop_index: u64) -> f64 {
    loop_index as f64 * (span_ms + LOOP_GAP_MS)
}

/// `None` is as-fast-as-possible, which is a deliberate mode rather than a
/// missing value: it is how the frontend gets pushed past its breaking point
/// on demand.
pub(crate) fn validate_speed(speed: Option<f64>) -> Result<Option<f64>, String> {
    match speed {
        None => Ok(None),
        Some(speed) if speed.is_finite() && speed > 0.0 => Ok(Some(speed)),
        Some(speed) => Err(format!("Playback speed {speed} must be greater than zero")),
    }
}

/// Playback controls, as they arrive over IPC.
#[derive(Deserialize, Clone, Default)]
pub struct ReplayOptions {
    /// Multiplier on the recorded timing; `None` replays as fast as possible.
    pub speed: Option<f64>,
    pub repeat: bool,
}

/// What the replay is doing, polled by the frontend.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ReplayStatus {
    pub running: bool,
    pub path: Option<String>,
    pub frames_total: u64,
    pub frames_emitted: u64,
    pub loops: u64,
    pub last_error: Option<String>,
}

/// Everything the emit thread and the state that owns it share.
#[derive(Clone, Default)]
struct Channel {
    stop: Arc<AtomicBool>,
    emitted: Arc<AtomicU64>,
    loops: Arc<AtomicU64>,
    /// Only ever locked to store or clone a message, never across an emit.
    error: Arc<Mutex<Option<String>>>,
}

/// A live replay: its thread, its shared channel, and what it started with.
struct Running {
    thread: Option<JoinHandle<()>>,
    channel: Channel,
    path: String,
    frames_total: u64,
}

/// Managed state, kept beside `SimulationState` at the same level: a replay
/// must be stoppable without touching the connection mutex.
#[derive(Default)]
pub struct ReplayState {
    inner: Mutex<Option<Running>>,
}

fn poisoned() -> String {
    "Replay state poisoned".to_string()
}

/// Refuses while a replay is running. The mirror of `can::ensure_no_device` —
/// see there for why one source of `can-frames` at a time is not negotiable.
pub(crate) fn ensure_not_replaying(state: &ReplayState) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|_| poisoned())?;
    let running = guard
        .as_ref()
        .and_then(|running| running.thread.as_ref())
        .is_some_and(|thread| !thread.is_finished());

    if running {
        return Err("A capture replay is running; stop it first".to_string());
    }
    Ok(())
}

/// Signals the thread and joins it. Leaves the `Running` in place so
/// `last_error` and the frame counts survive the thread that produced them —
/// the page has to be able to say why a replay ended.
pub(crate) fn stop_running(state: &ReplayState) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| poisoned())?;
    if let Some(running) = guard.as_mut() {
        running.channel.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = running.thread.take() {
            // The wait parks, so an unpark is what makes a stop prompt rather
            // than one capture-gap late.
            thread.thread().unpark();
            let _ = thread.join();
        }
    }
    Ok(())
}

fn install_running(state: &ReplayState, running: Running) -> Result<(), String> {
    *state.inner.lock().map_err(|_| poisoned())? = Some(running);
    Ok(())
}

pub(crate) fn replay_status_of(state: &ReplayState) -> Result<ReplayStatus, String> {
    let guard = state.inner.lock().map_err(|_| poisoned())?;
    let Some(running) = guard.as_ref() else {
        return Ok(ReplayStatus {
            running: false,
            path: None,
            frames_total: 0,
            frames_emitted: 0,
            loops: 0,
            last_error: None,
        });
    };

    let last_error = running
        .channel
        .error
        .lock()
        .map_err(|_| poisoned())?
        .clone();

    Ok(ReplayStatus {
        // Derived from the thread rather than the stop flag, so a replay that
        // ran to its end reports itself stopped without anyone asking.
        running: running
            .thread
            .as_ref()
            .is_some_and(|thread| !thread.is_finished()),
        path: Some(running.path.clone()),
        frames_total: running.frames_total,
        frames_emitted: running.channel.emitted.load(Ordering::Relaxed),
        loops: running.channel.loops.load(Ordering::Relaxed),
        last_error,
    })
}

fn emit_batch(
    app: &AppHandle,
    pending: &mut Vec<CanFrame>,
    dropped: &mut usize,
    channel: &Channel,
) {
    if pending.is_empty() {
        return;
    }
    // Through the reader's own helper, so a replay and an adapter cannot drift
    // into emitting different shapes — the frontend must not be able to tell
    // them apart.
    can::emit_frames(app, pending, *dropped);
    channel
        .emitted
        .fetch_add(pending.len() as u64, Ordering::Relaxed);
    pending.clear();
    *dropped = 0;
}

/// The emit loop. Batches exactly as `spawn_reader` does, through the same
/// `should_flush`, so the frontend sees the same event shape and size
/// distribution a real adapter produces.
fn run(app: AppHandle, frames: Vec<CanFrame>, options: ReplayOptions, channel: Channel) {
    let offsets = options.speed.map(|speed| schedule_offsets(&frames, speed));
    let span = capture_span_ms(&frames);
    let mut pass: u64 = 0;

    while !channel.stop.load(Ordering::Relaxed) {
        let shift = loop_shift_ms(span, pass);
        let start = Instant::now();
        let mut pending: Vec<CanFrame> = Vec::new();
        let mut dropped = 0usize;
        let mut last_flush = Instant::now();

        for (index, recorded) in frames.iter().enumerate() {
            if channel.stop.load(Ordering::Relaxed) {
                break;
            }
            // No offsets at all is the as-fast-as-possible mode: the loop
            // never waits, which is how the frontend gets pushed past what a
            // real bus could ever deliver.
            if let Some(offsets) = &offsets {
                wait_until(start + offsets[index], &channel.stop);
                if channel.stop.load(Ordering::Relaxed) {
                    break;
                }
            }

            let mut frame = recorded.clone();
            frame.timestamp_ms += shift;
            pending.push(frame);
            // Bounded the same way the reader is. Running as fast as possible
            // this drops most of what it reads, which is the honest outcome —
            // no bus could deliver that either, and the counter says so.
            dropped += can::trim_pending(&mut pending, can::RX_PENDING_CAP);

            if can::should_flush(pending.len(), last_flush.elapsed()) {
                emit_batch(&app, &mut pending, &mut dropped, &channel);
                last_flush = Instant::now();
            }
        }
        emit_batch(&app, &mut pending, &mut dropped, &channel);

        pass += 1;
        channel.loops.store(pass, Ordering::Relaxed);
        if !options.repeat {
            break;
        }
    }
}

#[tauri::command]
pub fn start_replay(
    app: AppHandle,
    replay_state: State<ReplayState>,
    path: String,
    options: ReplayOptions,
) -> Result<(), String> {
    // Everything that can be rejected is rejected before any state is touched
    // and before a single frame is emitted — the posture `validate_entries`
    // takes in `simulation.rs`, and for the same reason: a replay that dies a
    // third of the way through a file is worse than one that never starts.
    let speed = validate_speed(options.speed)?;
    let capture = parse_capture_file(&path, MAX_REPLAY_FRAMES, MAX_REPLAY_CAPTURE_BYTES)?;
    if capture.frames.is_empty() {
        return Err(format!("{path} holds no frames to replay"));
    }

    // Checked while holding nothing, so this nests no locks: the documented
    // order is about nesting, and a device check that failed *after* tearing
    // down a running replay would cost the user their measurement.
    ensure_no_device(&app.state::<CanState>())?;
    stop_running(&replay_state)?;

    let channel = Channel::default();
    let frames_total = capture.frames.len() as u64;
    let options = ReplayOptions {
        speed,
        repeat: options.repeat,
    };

    let thread = {
        let channel = channel.clone();
        let app = app.clone();
        thread::spawn(move || run(app, capture.frames, options, channel))
    };

    install_running(
        &replay_state,
        Running {
            thread: Some(thread),
            channel,
            path,
            frames_total,
        },
    )
}

#[tauri::command]
pub fn stop_replay(replay_state: State<ReplayState>) -> Result<(), String> {
    stop_running(&replay_state)
}

#[tauri::command]
pub fn replay_status(replay_state: State<ReplayState>) -> Result<ReplayStatus, String> {
    replay_status_of(&replay_state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(timestamp_ms: f64) -> CanFrame {
        CanFrame {
            id: 0x1A0,
            extended: false,
            fd: false,
            bitrate_switch: false,
            remote: false,
            data: vec![1, 2],
            timestamp_ms,
        }
    }

    fn micros(offsets: &[Duration]) -> Vec<u128> {
        offsets.iter().map(Duration::as_micros).collect()
    }

    #[test]
    fn the_first_frame_is_emitted_immediately() {
        let offsets = schedule_offsets(&[frame(5_000.0), frame(5_020.0)], 1.0);
        assert_eq!(
            offsets[0],
            Duration::ZERO,
            "a capture must not wait out its own start time"
        );
    }

    #[test]
    fn deltas_between_recorded_frames_are_preserved_at_1x() {
        let offsets = schedule_offsets(&[frame(1_000.0), frame(1_020.0), frame(1_070.0)], 1.0);
        assert_eq!(micros(&offsets), vec![0, 20_000, 70_000]);
    }

    #[test]
    fn speed_scales_every_delta_including_the_first() {
        let offsets = schedule_offsets(&[frame(1_000.0), frame(1_020.0), frame(1_070.0)], 5.0);
        assert_eq!(micros(&offsets), vec![0, 4_000, 14_000]);
    }

    #[test]
    fn a_slower_speed_stretches_the_schedule() {
        let offsets = schedule_offsets(&[frame(0.0), frame(20.0)], 0.5);
        assert_eq!(micros(&offsets), vec![0, 40_000]);
    }

    #[test]
    fn a_backwards_timestamp_never_makes_the_schedule_go_backwards() {
        // `FrameClock` cannot produce one, but a hand-edited or foreign
        // capture can, and `Instant + negative` does not exist.
        let offsets = schedule_offsets(&[frame(1_000.0), frame(900.0), frame(1_050.0)], 1.0);
        assert!(
            offsets.windows(2).all(|w| w[1] >= w[0]),
            "got {:?}",
            micros(&offsets)
        );
    }

    #[test]
    fn an_empty_capture_has_an_empty_schedule() {
        assert!(schedule_offsets(&[], 1.0).is_empty());
    }

    #[test]
    fn the_capture_span_is_the_distance_between_the_first_and_last_frame() {
        assert_eq!(capture_span_ms(&[frame(1_000.0), frame(1_070.0)]), 70.0);
        assert_eq!(capture_span_ms(&[frame(1_000.0)]), 0.0);
        assert_eq!(capture_span_ms(&[]), 0.0);
    }

    #[test]
    fn a_loop_shifts_every_timestamp_past_the_previous_pass() {
        // Without this, a repeated capture replays the same `changedAt` twice
        // and the second pass never re-fires a highlight.
        let span = capture_span_ms(&[frame(1_000.0), frame(1_070.0)]);
        assert_eq!(loop_shift_ms(span, 0), 0.0);
        assert!(
            loop_shift_ms(span, 1) > span,
            "the seam must not repeat an instant"
        );
        assert!(loop_shift_ms(span, 2) > loop_shift_ms(span, 1));
    }

    #[test]
    fn validate_speed_accepts_a_positive_rate() {
        assert_eq!(validate_speed(Some(2.0)).unwrap(), Some(2.0));
    }

    #[test]
    fn validate_speed_passes_through_as_fast_as_possible() {
        assert_eq!(validate_speed(None).unwrap(), None);
    }

    #[test]
    fn validate_speed_rejects_what_cannot_be_a_rate() {
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(
                validate_speed(Some(bad)).is_err(),
                "{bad} should be refused"
            );
        }
    }

    #[test]
    fn ensure_not_replaying_passes_when_nothing_is_running() {
        assert!(ensure_not_replaying(&ReplayState::default()).is_ok());
    }

    #[test]
    fn ensure_not_replaying_refuses_while_a_replay_runs_and_passes_again_after_a_stop() {
        let state = ReplayState::default();
        let channel = Channel::default();

        // A stand-in for the emit loop: it watches the same stop flag, so this
        // exercises the real teardown rather than a mocked one.
        let thread = {
            let stop = Arc::clone(&channel.stop);
            thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    thread::park_timeout(Duration::from_millis(1));
                }
            })
        };
        install_running(
            &state,
            Running {
                thread: Some(thread),
                channel,
                path: "capture.csv".to_string(),
                frames_total: 3,
            },
        )
        .unwrap();

        let err = ensure_not_replaying(&state).unwrap_err();
        assert!(err.to_lowercase().contains("replay"), "got: {err}");
        assert!(replay_status_of(&state).unwrap().running);

        stop_running(&state).unwrap();
        assert!(ensure_not_replaying(&state).is_ok());
        assert!(!replay_status_of(&state).unwrap().running);
    }

    #[test]
    fn stop_running_is_idempotent_on_a_state_that_never_started() {
        let state = ReplayState::default();
        assert!(stop_running(&state).is_ok());
        assert!(stop_running(&state).is_ok());
    }

    #[test]
    fn the_status_of_a_state_that_never_ran_is_empty() {
        let status = replay_status_of(&ReplayState::default()).unwrap();
        assert!(!status.running);
        assert_eq!(status.path, None);
        assert_eq!(status.frames_total, 0);
        assert_eq!(status.frames_emitted, 0);
        assert_eq!(status.loops, 0);
        assert_eq!(status.last_error, None);
    }

    #[test]
    fn a_replay_is_refused_while_a_device_is_connected() {
        // Only the passing direction is reachable in a unit test: the refusing
        // one needs a `CanConnection`, which needs a real serial port. The
        // guard is one `is_some()` over the same mutex `disconnect_can_device`
        // reads, and it is covered by hand on hardware.
        assert!(ensure_no_device(&CanState::default()).is_ok());
    }
}
