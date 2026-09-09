//! Scheduling arithmetic for the periodic transmitter behind the `/simulate`
//! page.
//!
//! Only the timing decisions live here, deliberately split from the thread that
//! acts on them: every function below takes `now` rather than reading the clock,
//! which is what makes the part of a periodic sender that is easy to get subtly
//! wrong also the part that is exhaustively unit-tested. The same reasoning is
//! why `parse_slcan_frame` in `can.rs` leaves `timestamp_ms: 0`.
//!
//! The design is taken from the reference restbus simulator this feature
//! mirrors: one scheduler for every message, absolute deadlines, and a wait that
//! tightens as the deadline approaches.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use tauri::{AppHandle, Emitter, State};

use crate::can::{self, CanState};
use crate::dbc::DbcMessage;

/// Floor on a cycle time. At 115200 baud one slcan `t`/`T`/`d`/`D` command
/// costs roughly 2.5 ms on the wire, so anything faster than this cannot be
/// sustained and only builds an unbounded write backlog behind the port.
pub const MIN_CYCLE: Duration = Duration::from_millis(1);

/// Ceiling on a cycle time. An hour is far past any restbus period and keeps
/// the millisecond arithmetic comfortably inside `f64`'s exact-integer range.
pub const MAX_CYCLE: Duration = Duration::from_secs(3600);

/// Longest a single wait may last, however far away the next deadline is.
/// A stop or a restart is noticed at most this late, so a message cycling once
/// a second does not make the UI feel stuck for a second.
pub const MAX_SLEEP: Duration = Duration::from_millis(50);

/// How much of the wait is left to the finer phases. Below this margin a
/// coarse OS-scheduled sleep can no longer be trusted to land on time.
const COARSE_MARGIN: Duration = Duration::from_millis(12);

/// The last stretch, where even a 500 µs sleep can overshoot, so the wait
/// busies instead. Kept short: this is the only phase that costs CPU.
const SPIN_MARGIN: Duration = Duration::from_millis(1);

/// One slice of the polling phase. Short enough that the overshoot it can
/// contribute stays well inside the spin margin that follows it.
const POLL_INTERVAL: Duration = Duration::from_micros(500);

/// One message on the schedule: the frame to write, how often, and when next.
///
/// The payload is encoded once when the simulation starts and never
/// recomputed, so a cycle costs nothing but a write.
#[derive(Clone, Debug, PartialEq)]
pub struct ScheduledFrame {
    pub id: u32,
    pub extended: bool,
    pub data: Vec<u8>,
    pub cycle: Duration,
    pub next_send: Instant,
}

/// The next deadline for a frame that has just been sent.
///
/// Accumulates absolutely (`next_send + cycle`) rather than restarting from
/// `now`, so the cost of encoding and writing does not compound: a 20 ms
/// message stays at 20 ms instead of drifting out to 22.
///
/// The exception is a deadline that is *already* in the past — after the
/// machine slept, or an adapter blocked for its write timeout. Accumulating
/// there would emit one backdated frame per missed cycle in a burst, so the
/// missed cycles are dropped and the schedule resnaps to `now`.
pub fn advance_deadline(next_send: Instant, cycle: Duration, now: Instant) -> Instant {
    let next = next_send + cycle;
    if next < now {
        now + cycle
    } else {
        next
    }
}

/// The earliest deadline across every frame, or `None` when there are none.
///
/// The scheduler sleeps to this rather than ticking on a fixed interval: a
/// fixed tick would add its own granularity on top of the cycle jitter.
pub fn next_deadline(frames: &[ScheduledFrame]) -> Option<Instant> {
    frames.iter().map(|frame| frame.next_send).min()
}

/// The frames whose deadline has arrived, by index. A deadline exactly equal
/// to `now` counts as due; anything else would push it a whole cycle late.
pub fn due_indices(frames: &[ScheduledFrame], now: Instant) -> Vec<usize> {
    frames
        .iter()
        .enumerate()
        .filter(|(_, frame)| frame.next_send <= now)
        .map(|(index, _)| index)
        .collect()
}

/// Bounds one wait to `max_sleep`, so a far-off deadline does not make the
/// thread unresponsive to a stop.
pub fn capped_deadline(deadline: Instant, now: Instant, max_sleep: Duration) -> Instant {
    deadline.min(now + max_sleep)
}

/// Which way to wait, given how much of the wait is left.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WaitPhase {
    /// Sleep (or park) for this long, then re-evaluate.
    Coarse(Duration),
    /// Sleep in short slices, re-checking as it goes.
    Poll,
    /// Busy-wait; the deadline is too close for any sleep to be accurate.
    Spin,
    /// The deadline has arrived.
    Done,
}

/// Picks the wait phase for `remaining` time.
///
/// Three phases rather than one sleep because a plain timed wait on a
/// background thread overshoots: macOS coalesces such timers and can miss a
/// 20 ms deadline by up to 10 ms, which is the difference between a restbus
/// and a stream of late frames.
pub fn wait_phase(remaining: Duration) -> WaitPhase {
    if remaining.is_zero() {
        WaitPhase::Done
    } else if remaining > COARSE_MARGIN {
        WaitPhase::Coarse(remaining - COARSE_MARGIN)
    } else if remaining > SPIN_MARGIN {
        WaitPhase::Poll
    } else {
        WaitPhase::Spin
    }
}

/// Turns a period entered in the UI into a cycle time.
///
/// Rejects what cannot mean a period at all and clamps the rest into
/// `[MIN_CYCLE, MAX_CYCLE]`. Clamping rather than rejecting an out-of-range
/// value matters because these numbers are read back from user-writable
/// storage: a hand-edited `0` must become the floor, not a busy loop writing
/// to the adapter as fast as the port will take it.
pub fn cycle_time(period_ms: f64) -> Result<Duration, String> {
    if !period_ms.is_finite() {
        return Err(format!("Period {period_ms} is not a number"));
    }
    if period_ms <= 0.0 {
        return Err(format!("Period {period_ms} ms must be greater than zero"));
    }

    let cycle = Duration::from_secs_f64(period_ms / 1000.0);
    Ok(cycle.clamp(MIN_CYCLE, MAX_CYCLE))
}

/// One message the frontend wants cycled, as it arrives over IPC.
///
/// Carries the DBC message and physical values rather than encoded bytes, the
/// same shape `send_can_message` takes. Encoding here rather than in the
/// frontend keeps one encoder authoritative, and lets a bad value fail the
/// whole start with nothing on the bus instead of going out as a frame whose
/// preview happened to disagree.
#[derive(Deserialize, Clone)]
pub struct SimulationEntry {
    pub message: DbcMessage,
    pub values: HashMap<String, f64>,
    pub period_ms: f64,
}

/// What the simulation is doing, polled by the frontend.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SimulationStatus {
    pub running: bool,
    pub frames_sent: u64,
    pub frame_count: usize,
    pub started_at_ms: u64,
    /// The failure that ended the run, kept after the thread exits so the page
    /// can explain why traffic stopped.
    pub last_error: Option<String>,
}

/// Everything the scheduler thread and the state that owns it share: the stop
/// signal in one direction, the counters and the failure in the other.
#[derive(Clone, Default)]
struct Channel {
    stop: Arc<AtomicBool>,
    sent: Arc<AtomicU64>,
    /// Only ever locked to store or clone a message — never across a write.
    error: Arc<Mutex<Option<String>>>,
}

/// A live scheduler: its thread, its shared channel, and what it started with.
struct Running {
    thread: Option<JoinHandle<()>>,
    channel: Channel,
    frame_count: usize,
    started_at_ms: u64,
}

/// Managed state for the simulation, kept beside `CanState` rather than inside
/// it: the scheduler must be stoppable without touching the connection mutex,
/// and folding the two together would make that impossible to express.
#[derive(Default)]
pub struct SimulationState {
    inner: Mutex<Option<Running>>,
}

/// Turns the frontend's entries into a schedule, or explains which one is bad.
///
/// Pure, and the only part of the start path that can be tested: it encodes
/// every entry and resolves every period *before* the caller touches any state,
/// so a rejected start leaves nothing running and nothing transmitted. All
/// deadlines begin at `now`, so every message fires on the first pass and the
/// set starts in phase — the same thing the reference simulator's `start()`
/// does when it resets `next_send` across the board.
pub fn validate_entries(
    entries: &[SimulationEntry],
    now: Instant,
) -> Result<Vec<ScheduledFrame>, String> {
    if entries.is_empty() {
        return Err("Add at least one message before starting the simulation".to_string());
    }

    entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let context = |e: String| format!("Entry {} ({}): {e}", index + 1, entry.message.name);
            let cycle = cycle_time(entry.period_ms).map_err(context)?;
            let data = can::encode_can_message(entry.message.clone(), entry.values.clone())
                .map_err(context)?;

            Ok(ScheduledFrame {
                id: entry.message.id,
                extended: entry.message.extended,
                data,
                cycle,
                next_send: now,
            })
        })
        .collect()
}

/// Waits until `deadline`, giving up early when `stop` is set.
///
/// Three phases, tightening as the deadline approaches, because no single
/// mechanism is both cheap and accurate. A plain timed wait on a background
/// thread is cheap but coalesced — macOS in particular will let it overshoot a
/// 20 ms deadline by up to 10 ms, which turns a restbus into a stream of late
/// frames. A spin is accurate but burns a core. So: park for the bulk of it,
/// sleep in short slices through the middle, and busy-wait only the last
/// millisecond. The reference simulator holds 20.00 / 50.00 / 1000.0 ms
/// average cycles this way at a few percent CPU.
///
/// The coarse phase parks rather than sleeps so `stop_running`'s `unpark` cuts
/// it short; the finer two re-check `stop` on every slice. Between them, a stop
/// is never held up by the longest cycle in the set.
fn wait_until(deadline: Instant, stop: &AtomicBool) {
    while !stop.load(Ordering::Relaxed) {
        // Saturating: by the time this is read the deadline may already have
        // passed, and a negative `Instant` difference panics.
        let remaining = deadline.saturating_duration_since(Instant::now());

        match wait_phase(remaining) {
            WaitPhase::Done => return,
            // A spurious wakeup just costs one more trip around the loop.
            WaitPhase::Coarse(coarse) => thread::park_timeout(coarse),
            WaitPhase::Poll => thread::sleep(POLL_INTERVAL),
            WaitPhase::Spin => std::hint::spin_loop(),
        }
    }
}

/// The scheduler itself. Owns its port handle outright and never reaches back
/// into `CanState`, which is what keeps `can_connection_status` — polled once a
/// second from the main thread — from ever blocking behind a write.
fn run(
    app: AppHandle,
    mut port: Box<dyn SerialPort>,
    mut frames: Vec<ScheduledFrame>,
    fd: bool,
    bitrate_switch: bool,
    channel: Channel,
) {
    while !channel.stop.load(Ordering::Relaxed) {
        let now = Instant::now();

        for index in due_indices(&frames, now) {
            let frame = &frames[index];
            if let Err(message) = can::write_frame(
                &mut port,
                frame.id,
                frame.extended,
                fd,
                bitrate_switch,
                &frame.data,
            ) {
                // One dead port stops everything: every message shares this
                // thread, so there is nothing left that could still succeed.
                if let Ok(mut slot) = channel.error.lock() {
                    *slot = Some(message.clone());
                }
                let _ = app.emit("simulation-error", message);
                channel.stop.store(true, Ordering::Relaxed);
                return;
            }

            channel.sent.fetch_add(1, Ordering::Relaxed);
            frames[index].next_send =
                advance_deadline(frames[index].next_send, frames[index].cycle, now);
        }

        let Some(deadline) = next_deadline(&frames) else {
            return;
        };
        wait_until(
            capped_deadline(deadline, Instant::now(), MAX_SLEEP),
            &channel.stop,
        );
    }
}

/// Stops a running simulation and waits for the thread to go away.
///
/// Idempotent, and safe to call when nothing is running. `Running` itself is
/// kept so `last_error` survives the thread that produced it — the page has to
/// be able to say why the traffic stopped.
///
/// Called from the connect, disconnect and sweep paths in `can.rs` as well as
/// from `stop_simulation`, which fixes the lock order as `SimulationState`
/// before `CanState` everywhere.
pub fn stop_running(state: &SimulationState) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Simulation state poisoned".to_string())?;

    if let Some(running) = guard.as_mut() {
        running.channel.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = running.thread.take() {
            thread.thread().unpark();
            let _ = thread.join();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn start_simulation(
    app: AppHandle,
    can_state: State<CanState>,
    sim_state: State<SimulationState>,
    entries: Vec<SimulationEntry>,
) -> Result<(), String> {
    // Everything that can be rejected is rejected here, before a single byte
    // is written and before the previous run is torn down.
    let frames = validate_entries(&entries, Instant::now())?;

    // Replace semantics: an edit while running is a stop and a fresh start.
    stop_running(&sim_state)?;

    // The only time this path touches the connection mutex. `clone_write_handle`
    // checks writability and hands over a private port handle, so the loop below
    // never needs it again.
    let (port, fd, bitrate_switch) = can::clone_write_handle(&can_state)?;

    let channel = Channel::default();
    let frame_count = frames.len();

    let thread = {
        let channel = channel.clone();
        thread::spawn(move || run(app, port, frames, fd, bitrate_switch, channel))
    };

    *sim_state
        .inner
        .lock()
        .map_err(|_| "Simulation state poisoned".to_string())? = Some(Running {
        thread: Some(thread),
        channel,
        frame_count,
        started_at_ms: can::now_ms(),
    });

    Ok(())
}

#[tauri::command]
pub fn stop_simulation(sim_state: State<SimulationState>) -> Result<(), String> {
    stop_running(&sim_state)
}

#[tauri::command]
pub fn simulation_status(sim_state: State<SimulationState>) -> Result<SimulationStatus, String> {
    let guard = sim_state
        .inner
        .lock()
        .map_err(|_| "Simulation state poisoned".to_string())?;

    match guard.as_ref() {
        None => Ok(SimulationStatus {
            running: false,
            frames_sent: 0,
            frame_count: 0,
            started_at_ms: 0,
            last_error: None,
        }),
        Some(running) => Ok(SimulationStatus {
            // Derived from the thread rather than from the stop flag, so a run
            // that ended on a write error reports itself stopped without
            // anyone having to ask.
            running: running
                .thread
                .as_ref()
                .is_some_and(|thread| !thread.is_finished()),
            frames_sent: running.channel.sent.load(Ordering::Relaxed),
            frame_count: running.frame_count,
            started_at_ms: running.started_at_ms,
            last_error: running
                .channel
                .error
                .lock()
                .map_err(|_| "Simulation state poisoned".to_string())?
                .clone(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::dbc::{DbcMultiplexer, DbcSignal};

    fn signal(name: &str, start_bit: u64, size: u64) -> DbcSignal {
        DbcSignal {
            name: name.to_string(),
            start_bit,
            size,
            little_endian: true,
            signed: false,
            factor: 1.0,
            offset: 0.0,
            min: 0.0,
            max: 255.0,
            unit: String::new(),
            receivers: Vec::new(),
            multiplexer: DbcMultiplexer::Plain,
        }
    }

    fn entry(name: &str, id: u32, period_ms: f64, value: f64) -> SimulationEntry {
        SimulationEntry {
            message: DbcMessage {
                id,
                extended: false,
                name: name.to_string(),
                size: 8,
                transmitter: None,
                signals: vec![signal("Value", 0, 8)],
            },
            values: HashMap::from([("Value".to_string(), value)]),
            period_ms,
        }
    }

    fn frame(next_send: Instant, cycle_ms: u64) -> ScheduledFrame {
        ScheduledFrame {
            id: 0x100,
            extended: false,
            data: vec![0; 8],
            cycle: Duration::from_millis(cycle_ms),
            next_send,
        }
    }

    fn ms(millis: u64) -> Duration {
        Duration::from_millis(millis)
    }

    #[test]
    fn advance_deadline_accumulates_absolutely_so_send_cost_does_not_drift() {
        let base = Instant::now();
        // The frame was due at `base` and took 5 ms to encode and write.
        let next = advance_deadline(base, ms(20), base + ms(5));

        assert_eq!(
            next,
            base + ms(20),
            "the next deadline must be one cycle after the previous one, not one cycle after the send finished"
        );
    }

    #[test]
    fn advance_deadline_resnaps_when_the_deadline_already_slipped_into_the_past() {
        let base = Instant::now();
        // Half a second of missed cycles: the machine slept, or a write blocked.
        let next = advance_deadline(base, ms(20), base + ms(500));

        assert_eq!(
            next,
            base + ms(520),
            "a deadline in the past must resnap to now + cycle rather than burst through 25 backdated frames"
        );
    }

    #[test]
    fn advance_deadline_keeps_a_deadline_that_lands_exactly_on_now() {
        let base = Instant::now();
        let next = advance_deadline(base, ms(20), base + ms(20));

        assert_eq!(
            next,
            base + ms(20),
            "a deadline equal to now has not slipped and must not be resnapped a cycle later"
        );
    }

    #[test]
    fn next_deadline_picks_the_earliest_frame() {
        let base = Instant::now();
        let frames = vec![
            frame(base + ms(50), 50),
            frame(base + ms(20), 20),
            frame(base + ms(1000), 1000),
        ];

        assert_eq!(next_deadline(&frames), Some(base + ms(20)));
    }

    #[test]
    fn next_deadline_is_none_without_frames() {
        assert_eq!(next_deadline(&[]), None);
    }

    #[test]
    fn due_indices_selects_only_frames_whose_deadline_arrived() {
        let base = Instant::now();
        let frames = vec![
            frame(base + ms(10), 20),
            frame(base + ms(30), 20),
            frame(base + ms(5), 20),
        ];

        assert_eq!(
            due_indices(&frames, base + ms(10)),
            vec![0, 2],
            "a deadline exactly at now is due; one still in the future is not"
        );
    }

    #[test]
    fn due_indices_is_empty_when_nothing_is_due_yet() {
        let base = Instant::now();
        let frames = vec![frame(base + ms(10), 20)];

        assert!(due_indices(&frames, base).is_empty());
    }

    #[test]
    fn capped_deadline_bounds_a_long_wait_to_the_maximum_sleep() {
        let base = Instant::now();
        let capped = capped_deadline(base + ms(1000), base, MAX_SLEEP);

        assert_eq!(
            capped,
            base + MAX_SLEEP,
            "a once-a-second message must not make the thread deaf to a stop for a second"
        );
    }

    #[test]
    fn capped_deadline_leaves_a_near_deadline_alone() {
        let base = Instant::now();

        assert_eq!(
            capped_deadline(base + ms(20), base, MAX_SLEEP),
            base + ms(20)
        );
    }

    #[test]
    fn wait_phase_descends_coarse_then_poll_then_spin() {
        assert_eq!(
            wait_phase(ms(40)),
            WaitPhase::Coarse(ms(40) - COARSE_MARGIN)
        );
        assert_eq!(wait_phase(ms(5)), WaitPhase::Poll);
        assert_eq!(wait_phase(Duration::from_micros(400)), WaitPhase::Spin);
    }

    #[test]
    fn wait_phase_reports_done_at_or_past_the_deadline() {
        assert_eq!(wait_phase(Duration::ZERO), WaitPhase::Done);

        // Past the deadline the caller's saturating subtraction floors at zero,
        // so "late" and "exactly on time" arrive here as the same input.
        let deadline = Instant::now();
        let late = deadline + ms(5);
        assert_eq!(
            wait_phase(deadline.saturating_duration_since(late)),
            WaitPhase::Done,
            "a deadline already in the past must end the wait, not restart it"
        );
    }

    #[test]
    fn wait_phase_boundaries_do_not_skip_a_phase() {
        assert_eq!(
            wait_phase(COARSE_MARGIN),
            WaitPhase::Poll,
            "exactly at the coarse margin the coarse phase is over"
        );
        assert_eq!(
            wait_phase(SPIN_MARGIN),
            WaitPhase::Spin,
            "exactly at the spin margin the polling phase is over"
        );
    }

    #[test]
    fn one_poll_slice_cannot_overshoot_past_the_spin_margin() {
        assert!(
            POLL_INTERVAL < SPIN_MARGIN,
            "a poll slice that outlasts the spin margin could sleep straight through the deadline the spin exists to catch"
        );
        assert!(
            SPIN_MARGIN < COARSE_MARGIN,
            "the phases have to narrow, or the ladder has a gap"
        );
    }

    #[test]
    fn wait_until_returns_immediately_when_stop_is_already_set() {
        let stop = AtomicBool::new(true);

        // An hour out: only the stop flag can end this.
        wait_until(Instant::now() + Duration::from_secs(3600), &stop);
    }

    #[test]
    fn wait_until_does_not_return_before_the_deadline() {
        let stop = AtomicBool::new(false);
        let started = Instant::now();
        let deadline = started + ms(5);

        wait_until(deadline, &stop);

        assert!(
            Instant::now() >= deadline,
            "returning early is the one failure that would show up as jitter on the bus"
        );
        assert!(started.elapsed() >= ms(5));
    }

    #[test]
    fn wait_phase_coarse_leaves_the_poll_and_spin_margins_intact() {
        let WaitPhase::Coarse(coarse) = wait_phase(ms(100)) else {
            panic!("100 ms out is a coarse wait");
        };

        assert_eq!(
            ms(100) - coarse,
            COARSE_MARGIN,
            "the coarse phase must stop short of the deadline by the full margin, leaving the finer phases their window"
        );
    }

    #[test]
    fn cycle_time_rejects_a_non_positive_or_non_finite_period() {
        for period in [0.0, -20.0, f64::NAN, f64::INFINITY] {
            assert!(
                cycle_time(period).is_err(),
                "{period} is not a period and must be rejected rather than clamped"
            );
        }
    }

    #[test]
    fn cycle_time_clamps_to_the_representable_range() {
        assert_eq!(
            cycle_time(0.1).expect("a positive period is valid"),
            MIN_CYCLE,
            "a period under the floor must clamp, not become a busy loop"
        );
        assert_eq!(
            cycle_time(99_999_999.0).expect("a positive period is valid"),
            MAX_CYCLE
        );
    }

    #[test]
    fn validate_entries_rejects_an_empty_entry_list() {
        let error = validate_entries(&[], Instant::now())
            .expect_err("starting with nothing scheduled is not a simulation");

        assert!(
            error.to_lowercase().contains("at least one"),
            "the error should say what is missing, got {error:?}"
        );
    }

    #[test]
    fn validate_entries_names_the_entry_and_message_in_an_out_of_range_error() {
        let entries = vec![
            entry("ESP_10", 0x116, 20.0, 1.0),
            entry("ESP_21", 0x0FD, 20.0, 300.0),
        ];

        let error = validate_entries(&entries, Instant::now())
            .expect_err("300 does not fit in an 8-bit signal");

        assert!(
            error.contains("Entry 2") && error.contains("ESP_21"),
            "a rejected entry has to be findable in a list of cards, got {error:?}"
        );
    }

    #[test]
    fn validate_entries_rejects_a_zero_period() {
        let error = validate_entries(&[entry("ESP_10", 0x116, 0.0, 1.0)], Instant::now())
            .expect_err("a zero period is a busy loop, not a cycle");

        assert!(
            error.contains("Entry 1") && error.contains("ESP_10"),
            "the period error should name its entry too, got {error:?}"
        );
    }

    #[test]
    fn validate_entries_returns_frames_in_input_order_with_the_encoded_bytes() {
        let now = Instant::now();
        let entries = vec![
            entry("ESP_10", 0x116, 20.0, 5.0),
            entry("ESP_20", 0x65D, 1000.0, 9.0),
        ];

        let frames = validate_entries(&entries, now).expect("both entries are valid");

        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].id, 0x116);
        assert_eq!(frames[0].cycle, ms(20));
        assert_eq!(frames[0].data, vec![5, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(frames[1].id, 0x65D);
        assert_eq!(frames[1].cycle, ms(1000));
        assert_eq!(frames[1].data, vec![9, 0, 0, 0, 0, 0, 0, 0]);
        assert!(
            frames.iter().all(|frame| frame.next_send == now),
            "every message starts due, so the set begins in phase"
        );
    }

    #[test]
    fn stop_running_is_idempotent_on_a_state_that_never_started() {
        let state = SimulationState::default();

        assert!(stop_running(&state).is_ok());
        assert!(
            stop_running(&state).is_ok(),
            "stopping twice must not be an error; the connect and disconnect paths both call it blind"
        );
    }

    #[test]
    fn cycle_time_converts_milliseconds_to_a_duration() {
        assert_eq!(cycle_time(20.0).expect("20 ms is a valid period"), ms(20));
        assert_eq!(cycle_time(1000.0).expect("1 s is a valid period"), ms(1000));
    }
}
