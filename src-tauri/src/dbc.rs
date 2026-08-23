use can_dbc::{Dbc, MultiplexIndicator, NumericValue};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct DbcFile {
    pub version: String,
    pub nodes: Vec<String>,
    pub messages: Vec<DbcMessage>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DbcMessage {
    pub id: u32,
    pub extended: bool,
    pub name: String,
    pub size: u64,
    pub transmitter: Option<String>,
    pub signals: Vec<DbcSignal>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DbcSignal {
    pub name: String,
    pub start_bit: u64,
    pub size: u64,
    pub little_endian: bool,
    pub signed: bool,
    pub factor: f64,
    pub offset: f64,
    pub min: f64,
    pub max: f64,
    pub unit: String,
    pub receivers: Vec<String>,
    pub multiplexer: DbcMultiplexer,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind")]
pub enum DbcMultiplexer {
    Plain,
    Multiplexor,
    MultiplexedSignal { switch_value: u64 },
    MultiplexorAndMultiplexedSignal { switch_value: u64 },
}

impl From<MultiplexIndicator> for DbcMultiplexer {
    fn from(value: MultiplexIndicator) -> Self {
        match value {
            MultiplexIndicator::Plain => Self::Plain,
            MultiplexIndicator::Multiplexor => Self::Multiplexor,
            MultiplexIndicator::MultiplexedSignal(switch_value) => {
                Self::MultiplexedSignal { switch_value }
            }
            MultiplexIndicator::MultiplexorAndMultiplexedSignal(switch_value) => {
                Self::MultiplexorAndMultiplexedSignal { switch_value }
            }
        }
    }
}

fn numeric_value_to_f64(value: NumericValue) -> f64 {
    match value {
        NumericValue::Uint(v) => v as f64,
        NumericValue::Int(v) => v as f64,
        NumericValue::Double(v) => v,
    }
}

impl From<Dbc> for DbcFile {
    fn from(dbc: Dbc) -> Self {
        Self {
            version: dbc.version.0,
            nodes: dbc.nodes.into_iter().map(|node| node.0).collect(),
            messages: dbc
                .messages
                .into_iter()
                .map(|message| DbcMessage {
                    id: message.id.raw(),
                    extended: matches!(message.id, can_dbc::MessageId::Extended(_)),
                    name: message.name,
                    size: message.size,
                    transmitter: message.transmitter,
                    signals: message
                        .signals
                        .into_iter()
                        .map(|signal| DbcSignal {
                            name: signal.name,
                            start_bit: signal.start_bit,
                            size: signal.size,
                            little_endian: matches!(
                                signal.byte_order,
                                can_dbc::ByteOrder::LittleEndian
                            ),
                            signed: matches!(signal.value_type, can_dbc::ValueType::Signed),
                            factor: signal.factor,
                            offset: signal.offset,
                            min: numeric_value_to_f64(signal.min),
                            max: numeric_value_to_f64(signal.max),
                            unit: signal.unit,
                            receivers: signal.receivers,
                            multiplexer: signal.multiplexer_indicator.into(),
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}

#[tauri::command]
pub fn parse_dbc_file(path: String) -> Result<DbcFile, String> {
    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let dbc = Dbc::try_from(contents.as_str()).map_err(|e| e.to_string())?;
    Ok(dbc.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SAMPLE_DBC: &str = r#"VERSION "1.0"

NS_ :

BS_:

BU_: ECU1 ECU2

BO_ 100 EngineData: 8 ECU1
 SG_ RPM : 0|16@1+ (1,0) [0|65535] "rpm" ECU2
 SG_ Temp : 16|8@1- (0.5,-40) [-40|215] "C" ECU2

BO_ 200 ExtendedMsg: 4 ECU2
 SG_ Flag m1 : 0|1@1+ (1,0) [0|1] "" ECU1
"#;

    #[test]
    fn converts_numeric_value_variants_to_f64() {
        assert_eq!(numeric_value_to_f64(NumericValue::Uint(7)), 7.0);
        assert_eq!(numeric_value_to_f64(NumericValue::Int(-7)), -7.0);
        assert_eq!(numeric_value_to_f64(NumericValue::Double(1.5)), 1.5);
    }

    #[test]
    fn converts_each_multiplex_indicator_variant() {
        assert!(matches!(
            DbcMultiplexer::from(MultiplexIndicator::Plain),
            DbcMultiplexer::Plain
        ));
        assert!(matches!(
            DbcMultiplexer::from(MultiplexIndicator::Multiplexor),
            DbcMultiplexer::Multiplexor
        ));
        assert!(matches!(
            DbcMultiplexer::from(MultiplexIndicator::MultiplexedSignal(3)),
            DbcMultiplexer::MultiplexedSignal { switch_value: 3 }
        ));
        assert!(matches!(
            DbcMultiplexer::from(MultiplexIndicator::MultiplexorAndMultiplexedSignal(3)),
            DbcMultiplexer::MultiplexorAndMultiplexedSignal { switch_value: 3 }
        ));
    }

    #[test]
    fn parses_a_valid_dbc_file_into_the_expected_shape() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(SAMPLE_DBC.as_bytes()).unwrap();

        let dbc = parse_dbc_file(file.path().to_string_lossy().into_owned()).unwrap();

        assert_eq!(dbc.version, "1.0");
        assert_eq!(dbc.nodes, vec!["ECU1", "ECU2"]);
        assert_eq!(dbc.messages.len(), 2);

        let engine = dbc.messages.iter().find(|m| m.id == 100).unwrap();
        assert_eq!(engine.name, "EngineData");
        assert_eq!(engine.size, 8);
        assert!(!engine.extended);
        assert_eq!(engine.signals.len(), 2);

        let rpm = engine.signals.iter().find(|s| s.name == "RPM").unwrap();
        assert_eq!(rpm.start_bit, 0);
        assert_eq!(rpm.size, 16);
        assert!(rpm.little_endian);
        assert!(!rpm.signed);
        assert_eq!(rpm.factor, 1.0);
        assert_eq!(rpm.unit, "rpm");

        let temp = engine.signals.iter().find(|s| s.name == "Temp").unwrap();
        assert!(temp.signed);
        assert_eq!(temp.factor, 0.5);
        assert_eq!(temp.offset, -40.0);
    }

    #[test]
    fn parses_multiplexed_signals() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(SAMPLE_DBC.as_bytes()).unwrap();

        let dbc = parse_dbc_file(file.path().to_string_lossy().into_owned()).unwrap();

        let ext = dbc.messages.iter().find(|m| m.id == 200).unwrap();
        let flag = ext.signals.iter().find(|s| s.name == "Flag").unwrap();
        assert!(matches!(
            flag.multiplexer,
            DbcMultiplexer::MultiplexedSignal { switch_value: 1 }
        ));
    }

    #[test]
    fn errors_on_missing_file() {
        let result = parse_dbc_file("/nonexistent/path/does-not-exist.dbc".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn errors_on_invalid_dbc_contents() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"this is not a valid dbc file").unwrap();

        let result = parse_dbc_file(file.path().to_string_lossy().into_owned());
        assert!(result.is_err());
    }
}
