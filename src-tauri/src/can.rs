use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serialport::{SerialPort, SerialPortType};
use tauri::State;

use crate::dbc::{DbcMessage, DbcSignal};

/// USB identity of a CANable 2.0 running its default slcan firmware.
const CANABLE_VID: u16 = 0xad50;
const CANABLE_PID: u16 = 0x60c4;

const SERIAL_TIMEOUT: Duration = Duration::from_millis(500);

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
}

struct CanConnection {
    port: Box<dyn SerialPort>,
    status: CanConnectionStatus,
}

#[derive(Default)]
pub struct CanState(Mutex<Option<CanConnection>>);

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

fn write_slcan_command(port: &mut Box<dyn SerialPort>, command: &str) -> Result<(), String> {
    port.write_all(format!("{command}\r").as_bytes())
        .map_err(|e| e.to_string())?;
    port.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn connect_can_device(
    state: State<CanState>,
    port_name: String,
    bitrate: u32,
) -> Result<(), String> {
    let code = bitrate_code(bitrate)?;

    let mut port = serialport::new(&port_name, 115_200)
        .timeout(SERIAL_TIMEOUT)
        .open()
        .map_err(|e| format!("Failed to open {port_name}: {e}"))?;

    // Ignore failures on "close if already open" — device may already be closed.
    let _ = write_slcan_command(&mut port, "C");
    write_slcan_command(&mut port, &format!("S{code}"))?;
    write_slcan_command(&mut port, "O")?;

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?;
    *guard = Some(CanConnection {
        port,
        status: CanConnectionStatus { port_name, bitrate },
    });
    Ok(())
}

#[tauri::command]
pub fn disconnect_can_device(state: State<CanState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?;
    if let Some(mut connection) = guard.take() {
        let _ = write_slcan_command(&mut connection.port, "C");
    }
    Ok(())
}

#[tauri::command]
pub fn can_connection_status(
    state: State<CanState>,
) -> Result<Option<CanConnectionStatus>, String> {
    let guard = state
        .0
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

// TODO(#2): drop these `dead_code` allows once the reader thread consumes
// the parser. Until then nothing calls into the receive path.
/// One CAN frame, either received from the bus or about to be written to it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[allow(dead_code)]
pub struct CanFrame {
    pub id: u32,
    pub extended: bool,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
}

/// The widest id each frame format can carry: 11 bits standard, 29 extended.
#[allow(dead_code)]
const MAX_STANDARD_ID: u32 = 0x7FF;
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
fn parse_hex(hex: &str) -> Option<u32> {
    if hex.is_empty() || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(hex, 16).ok()
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
    write_slcan_command(port, &format_slcan_frame(id, extended, data))?;

    // Read back the single-byte ack ('\r' success, BEL 0x07 error).
    let mut ack = [0u8; 1];
    match port.read_exact(&mut ack) {
        Ok(()) if ack[0] == 0x07 => Err("Adapter rejected the frame".to_string()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn send_can_frame(
    state: State<CanState>,
    id: u32,
    extended: bool,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?;
    let connection = guard.as_mut().ok_or("No CAN device connected")?;
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
        .0
        .lock()
        .map_err(|_| "CAN state poisoned".to_string())?;
    let connection = guard.as_mut().ok_or("No CAN device connected")?;
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
}
