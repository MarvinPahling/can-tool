import type { DbcSignal } from "@/api/dbc";

/**
 * Cached per signal object.
 *
 * The indices are a function of `start_bit`, `size` and `little_endian`, none
 * of which can change for a given signal — but this ran once per signal per
 * frame inside the decoder, rebuilding an array from constants thousands of
 * times a second. A `WeakMap` keyed on the signal needs no eviction: the
 * entries go when the DBC does.
 */
const bitIndexCache = new WeakMap<DbcSignal, number[]>();

/**
 * Returns the raw DBC bit indices occupied by a signal. Little-endian
 * signals are contiguous from `start_bit`; big-endian signals must be
 * walked per the standard DBC bit-numbering algorithm (MSB-first within
 * each byte, wrapping into the next byte).
 *
 * The returned array is shared and must not be mutated.
 */
export function getSignalBitIndices(signal: DbcSignal): number[] {
	const cached = bitIndexCache.get(signal);
	if (cached) return cached;

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
	bitIndexCache.set(signal, indices);
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
