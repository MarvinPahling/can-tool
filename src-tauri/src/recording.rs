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

    #[test]
    fn a_non_finite_or_negative_timestamp_is_rejected() {
        assert!(row_to_frame("nan,0x1A0,0,0,0,0,0,0,", 1).is_err());
        assert!(row_to_frame("inf,0x1A0,0,0,0,0,0,0,", 1).is_err());
        assert!(row_to_frame("-1.0,0x1A0,0,0,0,0,0,0,", 1).is_err());
    }
}
