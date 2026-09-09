/**
 * Cycle periods, in the two units the simulation page offers.
 *
 * Milliseconds are canonical everywhere — in the entries store, in the IPC
 * payload, and in the Rust scheduler. The unit is purely a display concern, so
 * that a value can round-trip through the UI without changing what is sent.
 */
export type PeriodUnit = "ms" | "s";

export const PERIOD_UNITS: readonly PeriodUnit[] = ["ms", "s"];

/**
 * Floor on a period. Mirrors `MIN_CYCLE` in `src-tauri/src/simulation.rs`: at
 * 115200 baud one slcan command costs roughly 2.5 ms on the wire, so anything
 * faster cannot be sustained.
 */
export const MIN_PERIOD_MS = 1;

/** Ceiling on a period; mirrors `MAX_CYCLE`. */
export const MAX_PERIOD_MS = 3_600_000;

export function periodToMs(value: number, unit: PeriodUnit): number {
	return unit === "s" ? value * 1000 : value;
}

/**
 * Canonical milliseconds back into the pair a human would have typed: whole
 * seconds show as seconds, everything else stays in milliseconds. So 1000
 * reads as `1 s` and 1500 as `1500 ms`, rather than `1.5 s`.
 */
export function periodFromMs(ms: number): { value: number; unit: PeriodUnit } {
	if (ms >= 1000 && ms % 1000 === 0) {
		return { value: ms / 1000, unit: "s" };
	}
	return { value: ms, unit: "ms" };
}

/**
 * Forces a period into the range the scheduler accepts.
 *
 * Clamping rather than rejecting, because these numbers come back from
 * user-writable storage as well as from the input: a hand-edited `0` has to
 * become the floor, not a busy loop writing to the adapter as fast as the port
 * will take it. Anything that is not a number at all falls back to the floor
 * for the same reason.
 */
export function clampPeriodMs(ms: number): number {
	if (!Number.isFinite(ms)) return MIN_PERIOD_MS;
	return Math.min(Math.max(ms, MIN_PERIOD_MS), MAX_PERIOD_MS);
}
