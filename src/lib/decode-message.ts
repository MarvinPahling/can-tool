import type { DbcMessage, DbcSignal } from "@/api/dbc";
import { getSignalBitIndices } from "./signal-bits";

/**
 * Gathers a signal's bits out of a frame into its raw integer value, the
 * exact inverse of the packing loop in `encode_can_message`
 * (src-tauri/src/can.rs): bit `i` of the raw value lives at the `i`th index
 * `getSignalBitIndices` reports.
 *
 * Returns `undefined` when the signal runs past the end of the frame — short
 * frames are routine on a real bus, and a decoder that threw would take the
 * whole view down with it.
 *
 * Uses arithmetic rather than bitwise operators throughout: `<<` and `|`
 * coerce to 32 bits, which would silently truncate signals wider than that.
 */
function decodeRawSignal(
	signal: DbcSignal,
	data: number[],
): number | undefined {
	const indices = getSignalBitIndices(signal);
	let raw = 0;

	for (let i = 0; i < indices.length; i++) {
		const bitIndex = indices[i] as number;
		const byteIndex = Math.floor(bitIndex / 8);
		const byte = data[byteIndex];
		if (byte === undefined) return undefined;

		const bit = Math.floor(byte / 2 ** (bitIndex % 8)) % 2;
		raw += bit * 2 ** i;
	}

	// Two's complement: the top bit set means the value is negative.
	if (signal.signed && raw >= 2 ** (signal.size - 1)) {
		raw -= 2 ** signal.size;
	}
	return raw;
}

/** Decodes one signal to its physical value, or `undefined` if it does not fit. */
export function decodeSignal(
	signal: DbcSignal,
	data: number[],
): number | undefined {
	const raw = decodeRawSignal(signal, data);
	return raw === undefined ? undefined : raw * signal.factor + signal.offset;
}

function isMultiplexor(signal: DbcSignal): boolean {
	return (
		signal.multiplexer.kind === "Multiplexor" ||
		signal.multiplexer.kind === "MultiplexorAndMultiplexedSignal"
	);
}

/**
 * Decodes every signal carried by this particular frame, keyed by signal name.
 *
 * Multiplexed signals share the same bits and are only meaningful for one
 * value of the message's multiplexor, so a signal is included only when its
 * `switch_value` matches. The comparison is against the multiplexor's *raw*
 * value, since `switch_value` in the DBC is a raw selector — a factor or
 * offset on the multiplexor must not shift which frame layout is selected.
 *
 * Signals that do not fit the frame are omitted rather than reported as 0.
 *
 * Only single-level multiplexing is resolved: the first multiplexor in the
 * message selects the layout. DBC's extended multiplexing, where a
 * `MultiplexorAndMultiplexedSignal` is itself gated by a parent multiplexor,
 * would need a multiplexor tree to resolve properly. No DBC in use here
 * exercises it; revisit if one does.
 */
export function decodeMessage(
	message: DbcMessage,
	data: number[],
): Record<string, number> {
	const multiplexor = message.signals.find(isMultiplexor);
	const switchValue = multiplexor
		? decodeRawSignal(multiplexor, data)
		: undefined;

	const values: Record<string, number> = {};
	for (const signal of message.signals) {
		const { multiplexer } = signal;
		if (
			multiplexer.kind === "MultiplexedSignal" ||
			multiplexer.kind === "MultiplexorAndMultiplexedSignal"
		) {
			if (multiplexer.switch_value !== switchValue) continue;
		}

		const value = decodeSignal(signal, data);
		if (value !== undefined) values[signal.name] = value;
	}
	return values;
}
