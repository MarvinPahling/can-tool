/**
 * Switches for a memory measurement run.
 *
 * These exist so the variables in the baseline matrix can be changed without a
 * rebuild: the devtools that sit in front of every event, and the readout that
 * reports what a run is costing.
 *
 * Read **once at import** rather than through a live store. A measurement
 * variable that can change mid-run is worse than useless, and reading once
 * keeps the flags themselves out of the render path entirely. Set them in the
 * console and reload:
 *
 * ```js
 * localStorage.setItem("can-tool:perf", '{"hud":true,"devtools":false}')
 * ```
 */
export interface PerfFlags {
	/** Show the measurement readout on `/visualize`. */
	hud: boolean;
	/** Mount the React Query and Router devtools. */
	devtools: boolean;
}

const PERF_FLAGS_STORAGE_KEY = "can-tool:perf";

/**
 * Today's behaviour, exactly. If simply having these flags present changed
 * anything, the baseline would be measuring the instrumentation.
 */
export const DEFAULT_PERF_FLAGS: PerfFlags = { hud: false, devtools: true };

export function parsePerfFlags(raw: string | null): PerfFlags {
	if (!raw) return DEFAULT_PERF_FLAGS;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return DEFAULT_PERF_FLAGS;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return DEFAULT_PERF_FLAGS;
	}

	const record = parsed as Record<string, unknown>;
	const flag = (name: keyof PerfFlags) =>
		typeof record[name] === "boolean"
			? (record[name] as boolean)
			: DEFAULT_PERF_FLAGS[name];

	return { hud: flag("hud"), devtools: flag("devtools") };
}

/** A delta over a window, as a per-second rate. */
export function perSecond(delta: number, elapsedMs: number): number {
	if (elapsedMs <= 0) return 0;
	return Math.round((delta * 1000) / elapsedMs);
}

export const perfFlags: PerfFlags =
	typeof localStorage === "undefined"
		? DEFAULT_PERF_FLAGS
		: parsePerfFlags(localStorage.getItem(PERF_FLAGS_STORAGE_KEY));
