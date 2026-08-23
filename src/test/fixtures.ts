import type { DbcFile, DbcMessage, DbcSignal } from "@/api/dbc";

export function makeSignal(overrides: Partial<DbcSignal> = {}): DbcSignal {
	return {
		name: "Signal",
		start_bit: 0,
		size: 8,
		little_endian: true,
		signed: false,
		factor: 1,
		offset: 0,
		min: 0,
		max: 255,
		unit: "",
		receivers: [],
		multiplexer: { kind: "Plain" },
		...overrides,
	};
}

export function makeMessage(overrides: Partial<DbcMessage> = {}): DbcMessage {
	return {
		id: 100,
		extended: false,
		name: "Message",
		size: 8,
		transmitter: undefined,
		signals: [],
		...overrides,
	};
}

export function makeDbcFile(overrides: Partial<DbcFile> = {}): DbcFile {
	return {
		version: "1.0",
		nodes: [],
		messages: [],
		...overrides,
	};
}
