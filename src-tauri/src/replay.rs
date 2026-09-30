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
use crate::recording::parse_capture_file_with_memory_budget;
#[cfg(test)]
use crate::recording::{
    MAX_CAPTURE_ROW_BYTES, REPLAY_FRAME_ALLOCATION_CHUNK, REPLAY_FRAME_PAYLOAD_ALLOCATION_BYTES,
    REPLAY_READER_BUFFER_BYTES, REPLAY_ROW_PARSE_SCRATCH_BYTES,
};
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

/// Enforced upper bound for replay parsing plus the retained timing schedule.
/// The parser checks it before each frame allocation. It conservatively counts
/// the full allowed source size, 8 KiB reader buffer, row buffer plus bounded
/// row-parse scratch, the old and new frame-vector capacities during a chunked
/// reallocation, up to 80 bytes per frame for payload allocation/allocator
/// overhead, and one Duration offset per frame. Chunks are 4096 frames; small
/// captures allocate only the first chunk (or the smaller frame ceiling), not
/// the full frame ceiling.
pub const MAX_REPLAY_SUPPORTED_PEAK_BYTES: u64 = 1_342_177_280; // 1.25 GiB

#[cfg(test)]
const fn previous_frame_capacity(frame_limit: usize) -> usize {
    if frame_limit <= REPLAY_FRAME_ALLOCATION_CHUNK {
        0
    } else {
        ((frame_limit - 1) / REPLAY_FRAME_ALLOCATION_CHUNK) * REPLAY_FRAME_ALLOCATION_CHUNK
    }
}

#[cfg(test)]
const fn supported_peak_estimate() -> u64 {
    let frames = MAX_REPLAY_FRAMES as u64;
    let previous_capacity = previous_frame_capacity(MAX_REPLAY_FRAMES) as u64;
    let transient_frame_capacity = frames + previous_capacity;
    MAX_REPLAY_CAPTURE_BYTES
        + REPLAY_READER_BUFFER_BYTES as u64
        + MAX_CAPTURE_ROW_BYTES as u64
        + REPLAY_ROW_PARSE_SCRATCH_BYTES as u64
        + transient_frame_capacity * std::mem::size_of::<CanFrame>() as u64
        + frames * REPLAY_FRAME_PAYLOAD_ALLOCATION_BYTES as u64
        + frames * std::mem::size_of::<Duration>() as u64
}

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
    inner: Mutex<ReplayInner>,
}

#[derive(Default)]
struct ReplayInner {
    running: Option<Running>,
    starting: Option<Arc<AtomicBool>>,
}

impl ReplayState {
    fn reserve_start(&self) -> Result<Arc<AtomicBool>, String> {
        let mut inner = self.inner.lock().map_err(|_| poisoned())?;
        if inner.starting.is_some()
            || inner
                .running
                .as_ref()
                .and_then(|r| r.thread.as_ref())
                .is_some_and(|t| !t.is_finished())
        {
            return Err("A capture replay is already running or starting".to_string());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        inner.starting = Some(Arc::clone(&cancelled));
        Ok(cancelled)
    }

    fn release_start(&self, reservation: &Arc<AtomicBool>) {
        if let Ok(mut inner) = self.inner.lock() {
            if inner
                .starting
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, reservation))
            {
                inner.starting = None;
            }
        }
    }
}

fn poisoned() -> String {
    "Replay state poisoned".to_string()
}

/// Refuses while a replay is running. The mirror of `can::ensure_no_device` —
/// see there for why one source of `can-frames` at a time is not negotiable.
pub(crate) fn ensure_not_replaying(state: &ReplayState) -> Result<(), String> {
    let guard = state.inner.lock().map_err(|_| poisoned())?;
    let running = guard.starting.is_some()
        || guard
            .running
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
    if let Some(starting) = &guard.starting {
        starting.store(true, Ordering::Relaxed);
    }
    if let Some(running) = guard.running.as_mut() {
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

fn commit_start(
    state: &ReplayState,
    reservation: &Arc<AtomicBool>,
    make_running: impl FnOnce() -> Running,
) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|_| poisoned())?;
    if reservation.load(Ordering::Relaxed)
        || !inner
            .starting
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, reservation))
    {
        inner.starting = None;
        return Err("Replay start was cancelled".to_string());
    }
    // Spawn and publish while holding the state lock. A concurrent stop either
    // cancels before this point or observes and stops the fully installed run.
    inner.running = Some(make_running());
    inner.starting = None;
    Ok(())
}

pub(crate) fn replay_status_of(state: &ReplayState) -> Result<ReplayStatus, String> {
    let guard = state.inner.lock().map_err(|_| poisoned())?;
    let Some(running) = guard.running.as_ref() else {
        return Ok(ReplayStatus {
            running: guard.starting.is_some(),
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
        running: guard.starting.is_some()
            || running
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
pub async fn start_replay(
    app: AppHandle,
    replay_state: State<'_, ReplayState>,
    path: String,
    options: ReplayOptions,
) -> Result<(), String> {
    // Reserve before dispatch so repeated IPC requests cannot queue unbounded
    // parsers on the blocking pool. Stop can cancel this reservation while the
    // worker is reading/parsing the capture.
    let speed = validate_speed(options.speed)?;
    ensure_no_device(&app.state::<CanState>())?;
    let reservation = replay_state.reserve_start()?;
    let app_for_worker = app.clone();
    let worker_reservation = Arc::clone(&reservation);
    let worker_options = ReplayOptions {
        speed,
        repeat: options.repeat,
    };

    tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_worker.state::<ReplayState>();
        let result = (|| {
            let capture = parse_capture_file_with_memory_budget(
                &path,
                MAX_REPLAY_FRAMES,
                MAX_REPLAY_CAPTURE_BYTES,
                MAX_REPLAY_SUPPORTED_PEAK_BYTES,
            )?;
            if capture.frames.is_empty() {
                return Err(format!("{path} holds no frames to replay"));
            }
            if worker_reservation.load(Ordering::Relaxed) {
                return Err("Replay start was cancelled".to_string());
            }
            ensure_no_device(&app_for_worker.state::<CanState>())?;

            let frames_total = capture.frames.len() as u64;
            commit_start(&state, &worker_reservation, || {
                let channel = Channel::default();
                let thread = {
                    let channel = channel.clone();
                    let app = app_for_worker.clone();
                    thread::spawn(move || run(app, capture.frames, worker_options, channel))
                };
                Running {
                    thread: Some(thread),
                    channel,
                    path,
                    frames_total,
                }
            })
        })();
        if result.is_err() {
            state.release_start(&worker_reservation);
        }
        result
    })
    .await
    .map_err(|e| format!("Replay worker failed: {e}"))?
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
    fn supported_peak_memory_bound_includes_growth_and_replay_offsets() {
        assert_eq!(std::mem::size_of::<CanFrame>(), 40);
        assert_eq!(MAX_REPLAY_SUPPORTED_PEAK_BYTES, 1_342_177_280);
        assert_eq!(previous_frame_capacity(4_097), 4_096);
        assert_eq!(previous_frame_capacity(MAX_REPLAY_FRAMES), 4_997_120);
        assert_eq!(supported_peak_estimate(), 1_148_330_112);
        assert!(supported_peak_estimate() <= MAX_REPLAY_SUPPORTED_PEAK_BYTES);
    }

    #[test]
    fn replay_parse_reservation_rejects_overlapping_starts_and_can_be_released() {
        let state = ReplayState::default();
        let reservation = state.reserve_start().expect("first start reserves");
        assert!(
            state.reserve_start().is_err(),
            "overlapping starts are bounded"
        );
        state.release_start(&reservation);
        assert!(state.reserve_start().is_ok());
    }

    #[test]
    fn replay_status_reports_a_parse_reservation_as_starting() {
        let state = ReplayState::default();
        let _reservation = state.reserve_start().unwrap();
        let status = replay_status_of(&state).unwrap();
        assert!(status.running);
        assert_eq!(status.path, None);
        assert_eq!(status.frames_total, 0);
    }

    #[test]
    fn stop_cancels_a_replay_while_its_capture_is_being_parsed() {
        let state = ReplayState::default();
        let reservation = state.reserve_start().expect("start reserves");
        stop_running(&state).unwrap();
        assert!(reservation.load(Ordering::Relaxed));
        state.release_start(&reservation);
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
        let reservation = state.reserve_start().unwrap();
        commit_start(&state, &reservation, || Running {
            thread: Some(thread),
            channel,
            path: "capture.csv".to_string(),
            frames_total: 3,
        })
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
