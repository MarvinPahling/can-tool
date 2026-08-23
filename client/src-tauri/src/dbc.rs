use can_dbc::{Dbc, MultiplexIndicator, NumericValue};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct DbcFile {
    pub version: String,
    pub nodes: Vec<String>,
    pub messages: Vec<DbcMessage>,
}

#[derive(Serialize, Deserialize)]
pub struct DbcMessage {
    pub id: u32,
    pub extended: bool,
    pub name: String,
    pub size: u64,
    pub transmitter: Option<String>,
    pub signals: Vec<DbcSignal>,
}

#[derive(Serialize, Deserialize)]
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

#[derive(Serialize, Deserialize)]
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
