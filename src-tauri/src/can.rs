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

fn write_frame(
    port: &mut Box<dyn SerialPort>,
    id: u32,
    extended: bool,
    data: &[u8],
) -> Result<(), String> {
    if data.len() > 8 {
        return Err("CAN frames support at most 8 data bytes".to_string());
    }
    let hex_data: String = data.iter().map(|b| format!("{b:02X}")).collect();
    let command = if extended {
        format!("T{id:08X}{}{hex_data}", data.len())
    } else {
        format!("t{id:03X}{}{hex_data}", data.len())
    };
    write_slcan_command(port, &command)?;

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
