import type { DbcSignal } from "@/api/dbc";
import { getSignalRange } from "./signal-range";

/** The subset of the visualize settings that decides what counts as a change. */
export interface ChangeThresholdSettings {
	thresholdEnabled: boolean;
	thresholdPercent: number;
}

/**
 * Whether a signal's new value differs enough from its previous one to be
 * worth highlighting.
 *
 * With the threshold off, any difference counts. With it on, the change must
 * exceed a percentage of the signal's **full physical range** — deliberately
 * not a percentage of the previous value, which is undefined when that value
 * is 0, a very common case on a CAN bus.
 *
 * The range comes from `getSignalRange`, which derives it from bit width,
 * signedness, factor and offset rather than trusting the DBC's declared
 * min/max — reverse-engineered files routinely leave those as a placeholder.
 */
export function hasSignificantChange(
	signal: DbcSignal,
	previous: number | undefined,
	next: number,
	settings: ChangeThresholdSettings,
): boolean {
	// The first frame a signal appears in is not a change; without this, every
	// value on the page would flash at once the moment traffic starts.
	if (previous === undefined) return false;
	if (!settings.thresholdEnabled) return previous !== next;

	const { min, max } = getSignalRange(signal);
	const span = max - min;
	// A degenerate range would make the threshold meaningless (or NaN), so
	// fall back to treating any difference as significant.
	if (!Number.isFinite(span) || span <= 0) return previous !== next;

	return Math.abs(next - previous) > (settings.thresholdPercent / 100) * span;
}
