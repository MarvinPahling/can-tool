use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serialport::{SerialPort, SerialPortType};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dbc::{DbcMessage, DbcSignal};

/// USB identity of a CANable 2.0 running its default slcan firmware.
const CANABLE_VID: u16 = 0xad50;
const CANABLE_PID: u16 = 0x60c4;

const SERIAL_TIMEOUT: Duration = Duration::from_millis(500);

/// Bitrates the auto-detect sweep tries, in descending order of how often they
/// turn up in the wild rather than numeric order, so the usual answer is the
/// first one tried.
const PROBE_BITRATES: [u32; 9] = [
    500_000, 250_000, 125_000, 1_000_000, 100_000, 800_000, 50_000, 20_000, 10_000,
];

/// A single frame can be garbage decoded at the wrong bitrate; two rarely are.
const PROBE_MIN_FRAMES: usize = 2;

/// How long to listen at each candidate bitrate before moving on.
const PROBE_DWELL: Duration = Duration::from_millis(400);

/// Shorter than `SERIAL_TIMEOUT`, so one blocking read cannot overrun the dwell
/// and stall the progress the UI is rendering.
const PROBE_READ_TIMEOUT: Duration = Duration::from_millis(100);

#[derive(Serialize)]
pub struct CanDeviceInfo {
    pub port_name: String,
    pub manufacturer: Option<String>,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub is_canable: bool,
}

#[derive(Serialize, Clone)]
pub struct CanConnectionStatus {
    pub port_name: String,
    pub bitrate: u32,
    /// Opened in slcan listen-only mode: the adapter receives but never
    /// transmits or ACKs, so every send path is refused.
    pub read_only: bool,
}

/// One `can-probe` event: the bitrate being tried and what it has seen so far.
#[derive(Serialize, Clone)]
pub struct ProbeProgress {
    pub bitrate: u32,
    pub frames: usize,
    /// True on the final event of a sweep, whatever the outcome.
    pub done: bool,
    /// Set only on the final event: the winning bitrate, or `None` if the sweep
    /// found nothing.
    pub detected: Option<u32>,
}

struct CanConnection {
    port: Box<dyn SerialPort>,
    status: CanConnectionStatus,
    /// Signals the reader thread to exit; see `stop_reader`.
    stop: Arc<AtomicBool>,
    reader: Option<JoinHandle<()>>,
}

impl CanConnection {
    /// Stops the reader thread and waits for it to exit, so a reconnect can
    /// never leave a second thread reading the same port. The join costs at
    /// most one read timeout.
    fn stop_reader(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

#[derive(Default)]
pub struct CanState {
    connection: Mutex<Option<CanConnection>>,
    /// Set while a bitrate sweep owns the port. The sweep cannot simply hold
    /// `connection` for its whole run: `can_connection_status` is polled once a
    /// second from the main thread, and blocking that is what freezes the UI.
    probing: AtomicBool,
}

/// Claims the probing flag and clears it on drop, so an early `?` return in the
/// middle of a sweep cannot leave the app permanently refusing to connect.
struct ProbeGuard<'a>(&'a AtomicBool);

impl<'a> ProbeGuard<'a> {
    fn claim(state: &'a CanState) -> Result<Self, String> {
        if state.probing.swap(true, Ordering::Relaxed) {
            return Err("A bitrate sweep is already running".to_string());
        }
        Ok(Self(&state.probing))
    }
}

impl Drop for ProbeGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn list_can_devices() -> Result<Vec<CanDeviceInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|port| {
            let (manufacturer, vid, pid) = match port.port_type {
                SerialPortType::UsbPort(info) => {
                    (info.manufacturer, Some(info.vid), Some(info.pid))
                }
                _ => (None, None, None),
            };
            let is_canable = vid == Some(CANABLE_VID) && pid == Some(CANABLE_PID);
            CanDeviceInfo {
                port_name: port.port_name,
                manufacturer,
                vid,
                pid,
                is_canable,
            }
        })
        .collect())
}

/// Maps a bitrate to its slcan `S<n>` setup code.
/// See https://www.can232.com/docs/canusb_manual.pdf for the standard table.
fn bitrate_code(bitrate: u32) -> Result<char, String> {
    match bitrate {
        10_000 => Ok('0'),
        20_000 => Ok('1'),
        50_000 => Ok('2'),
        100_000 => Ok('3'),
        125_000 => Ok('4'),
        250_000 => Ok('5'),
        500_000 => Ok('6'),
        800_000 => Ok('7'),
        1_000_000 => Ok('8'),
        other => Err(format!("Unsupported bitrate: {other}")),
    }
}

/// slcan opens the channel with `O` (normal) or `L` (listen-only); in
/// listen-only the adapter receives but never transmits or ACKs.
fn open_command(read_only: bool) -> &'static str {
    if read_only {
        "L"
    } else {
        "O"
    }
}

/// Whether a candidate bitrate saw enough traffic to call it the right one.
fn probe_hit(frames: usize) -> bool {
    frames >= PROBE_MIN_FRAMES
}

/// Refuses the transmit paths on a listen-only connection. The adapter would
/// swallow the frame anyway, so failing loudly beats sending into a void.
fn ensure_writable(status: &CanConnectionStatus) -> Result<(), String> {
    if status.read_only {
        return Err(
            "Connected in read-only mode; reconnect with read-only off to send".to_string(),
        );
    }
    Ok(())
}

fn write_slcan_command(port: &mut Box<dyn SerialPort>, command: &str) -> Result<(), String> {
    port.write_all(format!("{command}\r").as_bytes())
        .map_err(|e| e.to_string())?;
    port.flush().map_err(|e| e.to_string())
}

/// Opens the port, configures the slcan channel and starts the reader thread.
/// Shared by `connect_can_device` and the reconnect at the end of a bitrate
/// sweep, so the two paths cannot drift apart.
fn open_connection(
    app: AppHandle,
    port_name: &str,
    bitrate: u32,
    read_only: bool,
) -> Result<CanConnection, String> {
    let code = bitrate_code(bitrate)?;

    let mut port = serialport::new(port_name, 115_200)
        .timeout(SERIAL_TIMEOUT)
        .open()
        .map_err(|e| format!("Failed to open {port_name}: {e}"))?;

    // Ignore failures on "close if already open" — device may already be closed.
    let _ = write_slcan_command(&mut port, "C");
    write_slcan_command(&mut port, &format!("S{code}"))?;
    write_slcan_command(&mut port, open_command(read_only))?;

    // The reader gets its own handle so it never contends with the writer.
    let rx_port = port
        .try_clone()
        .map_err(|e| format!("Failed to open a read handle on {port_name}: {e}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let reader = spawn_reader(app, rx_port, Arc::clone(&stop));
    Ok(CanConnection {
        port,
        status: CanConnectionStatus {
            port_name: port_name.to_string(),
            bitrate,
            read_only,
        },
        stop,
        reader: Some(reader),
    })
}

#[tauri::command]
pub fn connect_can_device(
    app: AppHandle,
    state: State<CanState>,
    port_name: String,
    bitrate: u32,
    read_only: bool,
) -> Result<(), String> {
    // Racy by nature — the sweep could claim the flag right after this check —
    // but the loser then just fails to open the port, with a clearer message
    // than the OS would give.
    if state.probing.load(Ordering::Relaxed) {
        return Err("A bitrate sweep is running; wait for it to finish".to_string());
    }

    let connection = open_connection(app, &port_name, bitrate, read_only)?;

    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?;

    // Reconnecting must not leave the previous reader running.
    if let Some(previous) = guard.as_mut() {
        previous.stop_reader();
    }

    *guard = Some(connection);
    Ok(())
}

/// Listens at one candidate bitrate and reports how many valid frames arrived.
/// Opens its own short-lived handle: the sweep runs with no connection in
/// `CanState`, so there is no reader thread to share with.
fn probe_bitrate(port_name: &str, bitrate: u32, read_only: bool) -> Result<usize, String> {
    let code = bitrate_code(bitrate)?;

    let mut port = serialport::new(port_name, 115_200)
        .timeout(PROBE_READ_TIMEOUT)
        .open()
        .map_err(|e| format!("Failed to open {port_name}: {e}"))?;

    let _ = write_slcan_command(&mut port, "C");
    write_slcan_command(&mut port, &format!("S{code}"))?;
    write_slcan_command(&mut port, open_command(read_only))?;

    let mut raw = [0u8; 1024];
    let mut buf = String::new();
    let mut frames = 0usize;
    let deadline = Instant::now() + PROBE_DWELL;

    while Instant::now() < deadline {
        match port.read(&mut raw) {
            // A zero-length read would otherwise spin this loop hot.
            Ok(0) => thread::sleep(Duration::from_millis(1)),
            Ok(n) => {
                buf.push_str(&String::from_utf8_lossy(&raw[..n]));
                // Rejections are ignored: at the wrong bitrate the adapter
                // produces plenty of them, and they are not evidence either way.
                frames += drain_lines(&mut buf, now_ms()).frames.len();
            }
            // Timeouts are how a silent bus looks — keep listening.
            Err(e) if e.kind() == ErrorKind::TimedOut => {}
            Err(e) => return Err(format!("Failed to read {port_name}: {e}")),
        }
    }

    let _ = write_slcan_command(&mut port, "C");
    Ok(frames)
}

/// The sweep itself, run on a blocking worker rather than the main thread.
///
/// The `connection` mutex is taken only twice — once to hand the port over, and
/// once to install the result — never for the duration. Holding it across the
/// whole sweep would block `can_connection_status`, which the UI polls every
/// second from the main thread, and that is exactly what froze the app.
/// Overlapping sweeps and connects are kept apart by the probing flag instead.
fn run_bitrate_sweep(
    app: &AppHandle,
    state: &CanState,
    port_name: &str,
    read_only: bool,
) -> Result<Option<u32>, String> {
    let _probing = ProbeGuard::claim(state)?;

    // The OS will not grant a second exclusive open, so a live connection has
    // to be torn down before the probe can have the port.
    if let Some(mut previous) = state
        .connection
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?
        .take()
    {
        previous.stop_reader();
        let _ = write_slcan_command(&mut previous.port, "C");
    }

    let mut detected = None;
    let mut last = (0u32, 0usize);

    for bitrate in PROBE_BITRATES {
        let _ = app.emit(
            "can-probe",
            ProbeProgress {
                bitrate,
                frames: 0,
                done: false,
                detected: None,
            },
        );

        let frames = probe_bitrate(port_name, bitrate, read_only)?;
        last = (bitrate, frames);

        let _ = app.emit(
            "can-probe",
            ProbeProgress {
                bitrate,
                frames,
                done: false,
                detected: None,
            },
        );

        if probe_hit(frames) {
            detected = Some(bitrate);
            break;
        }
    }

    let _ = app.emit(
        "can-probe",
        ProbeProgress {
            bitrate: last.0,
            frames: last.1,
            done: true,
            detected,
        },
    );

    // Leave the user connected at what the sweep found.
    if let Some(bitrate) = detected {
        let connection = open_connection(app.clone(), port_name, bitrate, read_only)?;
        *state
            .connection
            .lock()
            .map_err(|_| "CAN state poisoned".to_string())? = Some(connection);
    }

    Ok(detected)
}

#[tauri::command]
pub async fn autodetect_bitrate(
    app: AppHandle,
    port_name: String,
    read_only: bool,
) -> Result<Option<u32>, String> {
    // Sync Tauri commands run on the main thread, so a multi-second sweep there
    // freezes the webview. `spawn_blocking` moves it off, and the awaited
    // handle still resolves the invoke with the detected bitrate.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CanState>();
        run_bitrate_sweep(&app, &state, &port_name, read_only)
    })
    .await
    .map_err(|e| format!("Auto-detect worker failed: {e}"))?
}

#[tauri::command]
pub fn disconnect_can_device(state: State<CanState>) -> Result<(), String> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?;
    if let Some(mut connection) = guard.take() {
        connection.stop_reader();
        let _ = write_slcan_command(&mut connection.port, "C");
    }
    Ok(())
}

#[tauri::command]
pub fn can_connection_status(
    state: State<CanState>,
) -> Result<Option<CanConnectionStatus>, String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?;
    Ok(guard.as_ref().map(|c| c.status.clone()))
}

/// Returns the raw DBC bit indices occupied by a signal, matching
/// `src/lib/signal-bits.ts`'s `getSignalBitIndices`: little-endian signals
/// are contiguous from `start_bit`; big-endian signals walk MSB-first within
/// each byte, wrapping into the next byte.
fn signal_bit_indices(start_bit: u64, size: u64, little_endian: bool) -> Vec<u64> {
    let mut indices = Vec::with_capacity(size as usize);
    if little_endian {
        for i in 0..size {
            indices.push(start_bit + i);
        }
    } else {
        let mut pos = start_bit as i64;
        for _ in 0..size {
            indices.push(pos as u64);
            pos = if pos % 8 == 0 { pos + 15 } else { pos - 1 };
        }
    }
    indices
}

/// The physical value range a signal can actually encode, derived purely
/// from its bit width/signedness/factor/offset — not the DBC's declared
/// min/max. Reverse-engineered DBC files (e.g. opendbc-style) very commonly
/// leave min/max as an unreliable placeholder like `0|1` regardless of bit
/// width, so trusting them would reject values that are perfectly encodable.
fn signal_range(signal: &DbcSignal) -> (f64, f64) {
    if signal.signed {
        let min_raw = -(1i64 << (signal.size - 1));
        let max_raw = (1i64 << (signal.size - 1)) - 1;
        (
            min_raw as f64 * signal.factor + signal.offset,
            max_raw as f64 * signal.factor + signal.offset,
        )
    } else {
        let max_raw = if signal.size >= 64 {
            u64::MAX
        } else {
            (1u64 << signal.size) - 1
        };
        (
            signal.offset,
            max_raw as f64 * signal.factor + signal.offset,
        )
    }
}

/// Encodes a set of physical signal values into the raw bytes of a CAN
/// frame. Pure/no I/O — used both for live preview/validation and as the
/// first step of `send_can_message`.
#[tauri::command]
pub fn encode_can_message(
    message: DbcMessage,
    values: HashMap<String, f64>,
) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0u8; message.size as usize];

    for signal in &message.signals {
        let Some(&value) = values.get(&signal.name) else {
            continue;
        };

        let (min, max) = signal_range(signal);
        if value < min || value > max {
            return Err(format!(
                "Signal '{}' value {value} is outside [{min}, {max}]",
                signal.name
            ));
        }

        let raw = ((value - signal.offset) / signal.factor).round();

        let raw_bits: u64 = if signal.signed {
            let min_raw = -(1i64 << (signal.size - 1));
            let max_raw = (1i64 << (signal.size - 1)) - 1;
            let raw_i = raw as i64;
            if raw_i < min_raw || raw_i > max_raw {
                return Err(format!(
                    "Signal '{}' encoded value {raw_i} does not fit in {} signed bits",
                    signal.name, signal.size
                ));
            }
            (raw_i as u64) & ((1u64 << signal.size) - 1)
        } else {
            let max_raw = if signal.size >= 64 {
                u64::MAX
            } else {
                (1u64 << signal.size) - 1
            };
            if raw < 0.0 || raw > max_raw as f64 {
                return Err(format!(
                    "Signal '{}' encoded value {raw} does not fit in {} unsigned bits",
                    signal.name, signal.size
                ));
            }
            raw as u64
        };

        let indices = signal_bit_indices(signal.start_bit, signal.size, signal.little_endian);
        for (i, &bit_index) in indices.iter().enumerate() {
            let byte_index = (bit_index / 8) as usize;
            let bit_in_byte = (bit_index % 8) as u8;
            if byte_index >= bytes.len() {
                return Err(format!(
                    "Signal '{}' overflows the {}-byte message",
                    signal.name, message.size
                ));
            }
            let bit_value = (raw_bits >> i) & 1;
            if bit_value == 1 {
                bytes[byte_index] |= 1 << bit_in_byte;
            }
        }
    }

    Ok(bytes)
}

/// CRC-8/SAE-J1850 (poly 0x1D, init 0xFF, no reflection, xorout 0xFF) — the
/// checksum commonly used for automotive CAN message integrity bytes.
fn crc8_sae_j1850(data: &[u8]) -> u8 {
    let mut crc: u8 = 0xFF;
    for &byte in data {
        crc ^= byte;
        for _ in 0..8 {
            crc = if crc & 0x80 != 0 {
                (crc << 1) ^ 0x1D
            } else {
                crc << 1
            };
        }
    }
    crc ^ 0xFF
}

/// Computes a CRC-8/SAE-J1850 checksum over the encoded frame with
/// `checksum_signal` zeroed out, and returns it converted to that signal's
/// physical value (via its factor/offset) so it can be written straight back
/// into the form.
#[tauri::command]
pub fn generate_checksum(
    message: DbcMessage,
    values: HashMap<String, f64>,
    checksum_signal: String,
) -> Result<f64, String> {
    let signal = message
        .signals
        .iter()
        .find(|s| s.name == checksum_signal)
        .ok_or_else(|| format!("Unknown signal '{checksum_signal}'"))?
        .clone();

    let mut zeroed_values = values;
    zeroed_values.insert(checksum_signal, 0.0);

    let bytes = encode_can_message(message, zeroed_values)?;
    let crc = crc8_sae_j1850(&bytes);
    Ok((crc as f64) * signal.factor + signal.offset)
}

/// One CAN frame, either received from the bus or about to be written to it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct CanFrame {
    pub id: u32,
    pub extended: bool,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
}

/// The widest id each frame format can carry: 11 bits standard, 29 extended.
const MAX_STANDARD_ID: u32 = 0x7FF;
const MAX_EXTENDED_ID: u32 = 0x1FFF_FFFF;

/// Formats a frame as an slcan/LAWICEL transmit command (without the trailing
/// `\r`, which `write_slcan_command` appends).
fn format_slcan_frame(id: u32, extended: bool, data: &[u8]) -> String {
    let hex_data: String = data.iter().map(|b| format!("{b:02X}")).collect();
    if extended {
        format!("T{id:08X}{}{hex_data}", data.len())
    } else {
        format!("t{id:03X}{}{hex_data}", data.len())
    }
}

/// Parses a single slcan line into a frame — the inverse of
/// `format_slcan_frame`, and the entry point for everything arriving from the
/// bus.
///
/// `t<3-hex-id><len><hexdata>` and `T<8-hex-id><len><hexdata>` are data
/// frames; `r`/`R` are their remote-request counterparts and carry no payload.
/// Anything else the adapter may send — a bare `\r`, the BEL byte it uses to
/// reject a transmitted frame, a `V1010` version reply, truncated or non-hex
/// digits, or a DLC that disagrees with the payload — is not a frame and
/// yields `None`.
///
/// `timestamp_ms` is left at 0 for the caller to stamp, keeping this pure so
/// its tests need neither hardware nor a clock.
fn parse_slcan_frame(line: &str) -> Option<CanFrame> {
    let line = line.trim();
    if !line.is_ascii() {
        return None;
    }

    let (kind, rest) = line.split_at_checked(1)?;
    let (extended, remote) = match kind {
        "t" => (false, false),
        "T" => (true, false),
        "r" => (false, true),
        "R" => (true, true),
        _ => return None,
    };

    let (id_hex, rest) = rest.split_at_checked(if extended { 8 } else { 3 })?;
    let id = parse_hex(id_hex)?;
    let max_id = if extended {
        MAX_EXTENDED_ID
    } else {
        MAX_STANDARD_ID
    };
    if id > max_id {
        return None;
    }

    let (len_hex, payload) = rest.split_at_checked(1)?;
    let len = parse_hex(len_hex)? as usize;
    if len > 8 {
        return None;
    }

    // A remote frame declares a length but carries no bytes.
    let data = if remote {
        if !payload.is_empty() {
            return None;
        }
        Vec::new()
    } else {
        if payload.len() != len * 2 {
            return None;
        }
        payload
            .as_bytes()
            .chunks(2)
            .map(|pair| parse_hex(std::str::from_utf8(pair).ok()?).map(|b| b as u8))
            .collect::<Option<Vec<u8>>>()?
    };

    Some(CanFrame {
        id,
        extended,
        data,
        timestamp_ms: 0,
    })
}

/// Strict hex parse: unlike `from_str_radix`, rejects a leading `+`/`-` sign
/// so a line like `t+101FF` is not mistaken for a frame.
fn parse_hex(hex: &str) -> Option<u32> {
    if hex.is_empty() || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(hex, 16).ok()
}

/// How often the reader flushes buffered frames to the frontend, and the
/// batch size that forces an early flush. A busy 500 kbit/s bus produces
/// thousands of frames a second; emitting one event each would swamp the
/// webview, so they go over in ~33 batches/s instead.
const RX_FLUSH_INTERVAL: Duration = Duration::from_millis(30);
const RX_BATCH_CAP: usize = 256;

/// Guards against unbounded growth if the adapter ever streams bytes with no
/// line terminator in sight.
const RX_BUFFER_LIMIT: usize = 4096;

/// What one read off the port yielded: the frames it completed, and how many
/// transmit rejections the adapter reported.
#[derive(Default, Debug)]
struct RxBatch {
    frames: Vec<CanFrame>,
    rejections: usize,
}

/// Splits every *complete* line out of `buf`, leaving a trailing partial line
/// behind so a frame split across two reads is reassembled rather than lost.
///
/// Lines end in `\r`, or in the BEL byte the adapter sends to reject a frame
/// we transmitted. BEL is counted rather than parsed: it is the ack that
/// `write_frame` used to read inline, and which now belongs to this thread.
fn drain_lines(buf: &mut String, timestamp_ms: u64) -> RxBatch {
    let mut batch = RxBatch::default();
    let Some(end) = buf.rfind(['\r', '\u{7}']) else {
        if buf.len() > RX_BUFFER_LIMIT {
            buf.clear();
        }
        return batch;
    };

    let complete: String = buf.drain(..=end).collect();
    for line in complete.split_inclusive(['\r', '\u{7}']) {
        if line.ends_with('\u{7}') {
            batch.rejections += 1;
        }
        if let Some(mut frame) = parse_slcan_frame(line) {
            frame.timestamp_ms = timestamp_ms;
            batch.frames.push(frame);
        }
    }
    batch
}

/// Whether buffered frames should go out now — either the batching window
/// elapsed or the batch grew large enough that waiting would add latency.
fn should_flush(pending: usize, since_last_flush: Duration) -> bool {
    pending > 0 && (pending >= RX_BATCH_CAP || since_last_flush >= RX_FLUSH_INTERVAL)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Reads the port until `stop` is set, emitting batched `can-frames` events.
///
/// Owns its own handle (a `try_clone` of the connection's port) so it never
/// contends with `write_frame` for the `CanState` mutex.
fn spawn_reader(
    app: AppHandle,
    mut port: Box<dyn SerialPort>,
    stop: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut raw = [0u8; 1024];
        let mut buf = String::new();
        let mut pending: Vec<CanFrame> = Vec::new();
        let mut last_flush = Instant::now();

        while !stop.load(Ordering::Relaxed) {
            match port.read(&mut raw) {
                // A zero-length read would otherwise spin this loop hot.
                Ok(0) => thread::sleep(Duration::from_millis(1)),
                Ok(n) => {
                    buf.push_str(&String::from_utf8_lossy(&raw[..n]));
                    let batch = drain_lines(&mut buf, now_ms());
                    if batch.rejections > 0 {
                        let _ = app.emit("can-error", "Adapter rejected a frame");
                    }
                    pending.extend(batch.frames);
                }
                // Timeouts are how an idle bus looks — keep waiting.
                Err(e) if e.kind() == ErrorKind::TimedOut => {}
                // Anything else means the port is gone (unplugged, closed).
                Err(_) => break,
            }

            if should_flush(pending.len(), last_flush.elapsed()) {
                let _ = app.emit("can-frames", &pending);
                pending.clear();
                last_flush = Instant::now();
            }
        }
    })
}

fn write_frame(
    port: &mut Box<dyn SerialPort>,
    id: u32,
    extended: bool,
    data: &[u8],
) -> Result<(), String> {
    if data.len() > 8 {
        return Err("CAN frames support at most 8 data bytes".to_string());
    }
    // The ack (`\r` success, BEL 0x07 rejection) is deliberately not read
    // here: the reader thread owns the incoming byte stream, and racing it
    // for that byte would corrupt both sides. It surfaces a rejection as a
    // `can-error` event instead, so this returns as soon as the write lands.
    write_slcan_command(port, &format_slcan_frame(id, extended, data))
}

#[tauri::command]
pub fn send_can_frame(
    state: State<CanState>,
    id: u32,
    extended: bool,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?;
    let connection = guard.as_mut().ok_or("No CAN device connected")?;
    ensure_writable(&connection.status)?;
    write_frame(&mut connection.port, id, extended, &data)
}

#[tauri::command]
pub fn send_can_message(
    state: State<CanState>,
    message: DbcMessage,
    values: HashMap<String, f64>,
) -> Result<(), String> {
    let data = encode_can_message(message.clone(), values)?;
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?;
    let connection = guard.as_mut().ok_or("No CAN device connected")?;
    ensure_writable(&connection.status)?;
    write_frame(&mut connection.port, message.id, message.extended, &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signal(overrides: impl FnOnce(&mut DbcSignal)) -> DbcSignal {
        let mut signal = DbcSignal {
            name: "Signal".to_string(),
            start_bit: 0,
            size: 8,
            little_endian: true,
            signed: false,
            factor: 1.0,
            offset: 0.0,
            min: 0.0,
            max: 255.0,
            unit: String::new(),
            receivers: Vec::new(),
            multiplexer: crate::dbc::DbcMultiplexer::Plain,
        };
        overrides(&mut signal);
        signal
    }

    fn message(signals: Vec<DbcSignal>) -> DbcMessage {
        DbcMessage {
            id: 100,
            extended: false,
            name: "Message".to_string(),
            size: 8,
            transmitter: None,
            signals,
        }
    }

    fn status(read_only: bool) -> CanConnectionStatus {
        CanConnectionStatus {
            port_name: "tty".to_string(),
            bitrate: 500_000,
            read_only,
        }
    }

    #[test]
    fn probe_guard_clears_the_flag_even_on_an_early_return() {
        let state = CanState::default();

        let result: Result<(), String> = (|| {
            let _probing = ProbeGuard::claim(&state)?;
            assert!(state.probing.load(Ordering::Relaxed));
            // A second sweep must not start while the first holds the flag.
            assert!(ProbeGuard::claim(&state).is_err());
            Err("probe failed halfway".to_string())
        })();

        assert!(result.is_err());
        assert!(
            !state.probing.load(Ordering::Relaxed),
            "an early return must not leave the app refusing connects"
        );
        assert!(ProbeGuard::claim(&state).is_ok());
    }

    #[test]
    fn probe_hit_needs_more_than_one_frame() {
        assert!(!probe_hit(0));
        assert!(!probe_hit(PROBE_MIN_FRAMES - 1));
        assert!(probe_hit(PROBE_MIN_FRAMES));
        assert!(probe_hit(PROBE_MIN_FRAMES + 10));
    }

    #[test]
    fn every_probed_bitrate_has_an_slcan_code() {
        for bitrate in PROBE_BITRATES {
            assert!(
                bitrate_code(bitrate).is_ok(),
                "{bitrate} is probed but has no slcan code"
            );
        }
    }

    #[test]
    fn probe_tries_the_common_bitrates_first() {
        assert_eq!(&PROBE_BITRATES[..3], &[500_000, 250_000, 125_000]);
    }

    #[test]
    fn open_command_picks_listen_only_when_read_only() {
        assert_eq!(open_command(false), "O");
        assert_eq!(open_command(true), "L");
    }

    #[test]
    fn ensure_writable_rejects_a_read_only_connection() {
        assert!(ensure_writable(&status(false)).is_ok());

        let error = ensure_writable(&status(true)).expect_err("read-only must reject writes");
        assert!(
            error.to_lowercase().contains("read-only"),
            "the error should name read-only mode, got {error:?}"
        );
    }

    #[test]
    fn bitrate_code_maps_known_bitrates() {
        assert_eq!(bitrate_code(500_000), Ok('6'));
        assert_eq!(bitrate_code(1_000_000), Ok('8'));
    }

    #[test]
    fn bitrate_code_rejects_unknown_bitrates() {
        assert!(bitrate_code(123_456).is_err());
    }

    #[test]
    fn signal_bit_indices_are_contiguous_for_little_endian() {
        assert_eq!(signal_bit_indices(3, 5, true), vec![3, 4, 5, 6, 7]);
    }

    #[test]
    fn signal_bit_indices_wrap_bytes_for_big_endian() {
        assert_eq!(signal_bit_indices(1, 4, false), vec![1, 0, 15, 14]);
    }

    #[test]
    fn signal_range_unsigned_spans_zero_to_max_raw() {
        let sig = signal(|_| {});
        assert_eq!(signal_range(&sig), (0.0, 255.0));
    }

    #[test]
    fn signal_range_signed_is_twos_complement() {
        let sig = signal(|s| s.signed = true);
        assert_eq!(signal_range(&sig), (-128.0, 127.0));
    }

    #[test]
    fn signal_range_applies_factor_and_offset() {
        let sig = signal(|s| {
            s.factor = 0.5;
            s.offset = -10.0;
        });
        assert_eq!(signal_range(&sig), (-10.0, 255.0 * 0.5 - 10.0));
    }

    #[test]
    fn crc8_sae_j1850_matches_known_vector() {
        // Standard CRC-8/SAE-J1850 test vector: CRC("123456789") == 0x4B.
        assert_eq!(crc8_sae_j1850(b"123456789"), 0x4B);
    }

    #[test]
    fn encode_can_message_packs_a_little_endian_value() {
        let sig = signal(|s| {
            s.name = "Val".to_string();
            s.start_bit = 0;
            s.size = 16;
        });
        let msg = message(vec![sig]);
        let mut values = HashMap::new();
        values.insert("Val".to_string(), 258.0); // 0x0102

        let bytes = encode_can_message(msg, values).unwrap();
        assert_eq!(&bytes[..2], &[0x02, 0x01]);
    }

    #[test]
    fn encode_can_message_rejects_out_of_range_physical_value() {
        let sig = signal(|s| s.name = "Val".to_string());
        let msg = message(vec![sig]);
        let mut values = HashMap::new();
        values.insert("Val".to_string(), 999.0);

        assert!(encode_can_message(msg, values).is_err());
    }

    #[test]
    fn encode_can_message_skips_signals_missing_from_the_value_map() {
        let sig = signal(|s| s.name = "Val".to_string());
        let msg = message(vec![sig]);

        let bytes = encode_can_message(msg, HashMap::new()).unwrap();
        assert_eq!(bytes, vec![0u8; 8]);
    }

    #[test]
    fn encode_can_message_errors_when_signal_overflows_message() {
        let sig = signal(|s| {
            s.name = "Val".to_string();
            s.start_bit = 0;
            s.size = 8;
        });
        let mut msg = message(vec![sig]);
        msg.size = 0; // no bytes available to write into

        let mut values = HashMap::new();
        values.insert("Val".to_string(), 1.0);

        assert!(encode_can_message(msg, values).is_err());
    }

    #[test]
    fn generate_checksum_zeroes_the_checksum_signal_before_computing() {
        let data_sig = signal(|s| {
            s.name = "Data".to_string();
            s.start_bit = 0;
            s.size = 8;
        });
        let checksum_sig = signal(|s| {
            s.name = "Checksum".to_string();
            s.start_bit = 8;
            s.size = 8;
        });
        let msg = message(vec![data_sig, checksum_sig]);

        let mut values = HashMap::new();
        values.insert("Data".to_string(), 42.0);
        // Whatever value the caller had for the checksum should be ignored/overwritten.
        values.insert("Checksum".to_string(), 200.0);

        let checksum =
            generate_checksum(msg.clone(), values.clone(), "Checksum".to_string()).unwrap();

        let mut zeroed = values.clone();
        zeroed.insert("Checksum".to_string(), 0.0);
        let bytes = encode_can_message(msg, zeroed).unwrap();
        let expected = crc8_sae_j1850(&bytes) as f64;

        assert_eq!(checksum, expected);
    }

    #[test]
    fn generate_checksum_errors_on_unknown_signal_name() {
        let msg = message(vec![signal(|s| s.name = "Data".to_string())]);
        let result = generate_checksum(msg, HashMap::new(), "Nope".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn parse_slcan_frame_reads_a_standard_data_frame() {
        let frame = parse_slcan_frame("t1A08DEADBEEF00112233").unwrap();
        assert_eq!(frame.id, 0x1A0);
        assert!(!frame.extended);
        assert_eq!(
            frame.data,
            vec![0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x11, 0x22, 0x33]
        );
        assert_eq!(frame.timestamp_ms, 0);
    }

    #[test]
    fn parse_slcan_frame_reads_an_extended_data_frame() {
        let frame = parse_slcan_frame("T18DAF1102AABB").unwrap();
        assert_eq!(frame.id, 0x18DAF110);
        assert!(frame.extended);
        assert_eq!(frame.data, vec![0xAA, 0xBB]);
    }

    #[test]
    fn parse_slcan_frame_reads_a_zero_length_frame() {
        let frame = parse_slcan_frame("t2000").unwrap();
        assert_eq!(frame.id, 0x200);
        assert!(frame.data.is_empty());
    }

    #[test]
    fn parse_slcan_frame_reads_remote_frames_without_payload() {
        let standard = parse_slcan_frame("r1238").unwrap();
        assert_eq!(standard.id, 0x123);
        assert!(!standard.extended);
        assert!(standard.data.is_empty());

        let extended = parse_slcan_frame("R000001238").unwrap();
        assert_eq!(extended.id, 0x123);
        assert!(extended.extended);
        assert!(extended.data.is_empty());
    }

    #[test]
    fn parse_slcan_frame_tolerates_a_trailing_carriage_return() {
        let frame = parse_slcan_frame("t1A01FF\r").unwrap();
        assert_eq!(frame.id, 0x1A0);
        assert_eq!(frame.data, vec![0xFF]);
    }

    #[test]
    fn parse_slcan_frame_rejects_non_frame_lines() {
        // The BEL byte the adapter sends to reject a transmitted frame.
        assert!(parse_slcan_frame("\u{7}").is_none());
        assert!(parse_slcan_frame("").is_none());
        assert!(parse_slcan_frame("\r").is_none());
        // Version/serial-number replies.
        assert!(parse_slcan_frame("V1010").is_none());
        assert!(parse_slcan_frame("NA123").is_none());
        assert!(parse_slcan_frame("garbage").is_none());
    }

    #[test]
    fn parse_slcan_frame_rejects_malformed_hex() {
        // Non-hex digits in the id, the length, and the payload.
        assert!(parse_slcan_frame("tZZZ1FF").is_none());
        assert!(parse_slcan_frame("t1A0ZFF").is_none());
        assert!(parse_slcan_frame("t1A01GG").is_none());
        // `from_str_radix` would happily accept a leading sign; we must not.
        assert!(parse_slcan_frame("t+101FF").is_none());
    }

    #[test]
    fn parse_slcan_frame_rejects_a_dlc_that_disagrees_with_the_payload() {
        // Says 4 bytes, carries 1.
        assert!(parse_slcan_frame("t1A04FF").is_none());
        // Says 1 byte, carries 2.
        assert!(parse_slcan_frame("t1A01FFEE").is_none());
        // Truncated id.
        assert!(parse_slcan_frame("t1A").is_none());
        // Missing length nibble.
        assert!(parse_slcan_frame("t1A0").is_none());
        // A DLC above the 8-byte classic CAN maximum.
        assert!(parse_slcan_frame("t1A09FFFFFFFFFFFFFFFFFF").is_none());
        // Remote frames carry no payload.
        assert!(parse_slcan_frame("r1231FF").is_none());
    }

    #[test]
    fn parse_slcan_frame_rejects_ids_wider_than_their_frame_format() {
        // 0x800 does not fit in an 11-bit standard id.
        assert!(parse_slcan_frame("t8000").is_none());
        // 0x20000000 does not fit in a 29-bit extended id.
        assert!(parse_slcan_frame("T200000000").is_none());
    }

    #[test]
    fn slcan_frames_round_trip_through_format_and_parse() {
        for (id, extended, data) in [
            (0x1A0u32, false, vec![0xDE, 0xAD]),
            (0x7FF, false, vec![]),
            (
                0x18DAF110,
                true,
                vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
            ),
        ] {
            let line = format_slcan_frame(id, extended, &data);
            let frame =
                parse_slcan_frame(&line).unwrap_or_else(|| panic!("failed to parse {line:?}"));
            assert_eq!(frame.id, id);
            assert_eq!(frame.extended, extended);
            assert_eq!(frame.data, data);
        }
    }

    #[test]
    fn drain_lines_extracts_complete_frames_and_keeps_the_partial() {
        let mut buf = String::from("t1A01FF\rt1A01EE\rt1A0");
        let batch = drain_lines(&mut buf, 42);
        assert_eq!(batch.frames.len(), 2);
        assert_eq!(batch.frames[0].data, vec![0xFF]);
        assert_eq!(batch.frames[1].data, vec![0xEE]);
        // The trailing partial line stays behind for the next read.
        assert_eq!(buf, "t1A0");
    }

    #[test]
    fn drain_lines_reassembles_a_frame_split_across_two_reads() {
        let mut buf = String::new();

        buf.push_str("t1A08DEAD");
        let batch = drain_lines(&mut buf, 1);
        assert!(batch.frames.is_empty(), "no terminator yet");

        buf.push_str("BEEF00112233\r");
        let batch = drain_lines(&mut buf, 2);
        assert_eq!(batch.frames.len(), 1);
        assert_eq!(
            batch.frames[0].data,
            vec![0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x11, 0x22, 0x33]
        );
        assert!(buf.is_empty());
    }

    #[test]
    fn drain_lines_stamps_every_frame_with_the_given_timestamp() {
        let mut buf = String::from("t1A01FF\rt1A01EE\r");
        let batch = drain_lines(&mut buf, 1234);
        assert!(batch.frames.iter().all(|f| f.timestamp_ms == 1234));
    }

    #[test]
    fn drain_lines_counts_bel_as_a_rejection_not_a_frame() {
        // The adapter answers a transmit command with BEL when it rejects it.
        let mut buf = String::from("\u{7}t1A01FF\r");
        let batch = drain_lines(&mut buf, 0);
        assert_eq!(batch.rejections, 1);
        assert_eq!(batch.frames.len(), 1);
    }

    #[test]
    fn drain_lines_ignores_empty_and_unparsable_lines() {
        // A bare ack, a version reply and garbage all sit in the same stream.
        let mut buf = String::from("\rV1010\rgarbage\rt1A01FF\r");
        let batch = drain_lines(&mut buf, 0);
        assert_eq!(batch.frames.len(), 1);
        assert_eq!(batch.rejections, 0);
        assert!(buf.is_empty());
    }

    #[test]
    fn drain_lines_returns_nothing_when_no_line_is_complete() {
        let mut buf = String::from("t1A01F");
        let batch = drain_lines(&mut buf, 0);
        assert!(batch.frames.is_empty());
        assert_eq!(buf, "t1A01F", "the buffer is left untouched");
    }

    #[test]
    fn should_flush_batches_until_the_interval_or_the_cap() {
        // Nothing buffered: never flush, however long it has been.
        assert!(!should_flush(0, Duration::from_secs(1)));
        // Buffered but still inside the window: keep batching.
        assert!(!should_flush(1, Duration::from_millis(5)));
        // The interval elapsed.
        assert!(should_flush(1, RX_FLUSH_INTERVAL));
        // The cap is reached before the interval, so a burst flushes early.
        assert!(should_flush(RX_BATCH_CAP, Duration::from_millis(0)));
    }
}
