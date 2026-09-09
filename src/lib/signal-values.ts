import type { DbcMessage, DbcSignal } from "@/api/dbc";
import { getSignalRange } from "./signal-range";

/**
 * A one-bit signal is a flag, and gets a switch rather than a number input.
 */
export function isBooleanSignal(signal: DbcSignal): boolean {
	return signal.size === 1;
}

/**
 * Checks one physical value against what its signal can actually encode,
 * returning the message to show or `undefined` when it is fine.
 *
 * The bound is `getSignalRange`'s derived range rather than the DBC's declared
 * min/max, which reverse-engineered files very commonly leave as a placeholder
 * like `0|1` regardless of bit width.
 */
export function validateSignalValue(
	signal: DbcSignal,
	value: number | undefined,
): string | undefined {
	if (value === undefined || Number.isNaN(value)) return "Required";

	const { min, max } = getSignalRange(signal);
	if (value < min || value > max) {
		return `Must be between ${min} and ${max}`;
	}
	return undefined;
}

/**
 * A starting value for every signal in a message, so a freshly added entry
 * encodes rather than showing an error on every field.
 *
 * Zero where the signal can hold it, and the bottom of the range where it
 * cannot — an offset signal may not reach zero at all.
 */
export function defaultSignalValues(
	message: DbcMessage,
): Record<string, number> {
	const values: Record<string, number> = {};
	for (const signal of message.signals) {
		const { min, max } = getSignalRange(signal);
		values[signal.name] = min <= 0 && max >= 0 ? 0 : min;
	}
	return values;
}
