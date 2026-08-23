import type { DbcFile, DbcMessage, DbcSignal } from "@/api/dbc";

export type MessageRow = {
  kind: "message";
  id: string;
  message: DbcMessage;
  subRows: SignalRow[];
};

export type SignalRow = {
  kind: "signal";
  id: string;
  signal: DbcSignal;
  message: DbcMessage;
};

export type DbcRow = MessageRow | SignalRow;

export function buildDbcRows(dbc: DbcFile): MessageRow[] {
  return dbc.messages.map((message) => ({
    kind: "message",
    id: `msg-${message.id}`,
    message,
    subRows: message.signals.map((signal) => ({
      kind: "signal",
      id: `msg-${message.id}-sig-${signal.name}`,
      signal,
      message,
    })),
  }));
}

export function getDbcSubRows(row: DbcRow): DbcRow[] | undefined {
  return row.kind === "message" ? row.subRows : undefined;
}
