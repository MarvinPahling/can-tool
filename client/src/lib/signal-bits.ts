import type { DbcSignal } from "@/api/dbc";

/**
 * Returns the raw DBC bit indices occupied by a signal. Little-endian
 * signals are contiguous from `start_bit`; big-endian signals must be
 * walked per the standard DBC bit-numbering algorithm (MSB-first within
 * each byte, wrapping into the next byte).
 */
export function getSignalBitIndices(signal: DbcSignal): number[] {
	const indices: number[] = [];
	if (signal.little_endian) {
		for (let i = 0; i < signal.size; i++) indices.push(signal.start_bit + i);
	} else {
		let pos = signal.start_bit;
		for (let i = 0; i < signal.size; i++) {
			indices.push(pos);
			pos = pos % 8 === 0 ? pos + 15 : pos - 1;
		}
	}
	return indices;
}

/** Maps each occupied bit index to the signal(s) covering it. */
export function buildSignalBitMap(
	signals: DbcSignal[],
): Map<number, DbcSignal[]> {
	const map = new Map<number, DbcSignal[]>();
	for (const signal of signals) {
		for (const index of getSignalBitIndices(signal)) {
			const owners = map.get(index);
			if (owners) owners.push(signal);
			else map.set(index, [signal]);
		}
	}
	return map;
}
