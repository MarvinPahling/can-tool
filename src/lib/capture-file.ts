import type { CaptureSpec } from "@/api/recording";

/**
 * `capture-YYYYMMDD-HHMMSS.csv`, the pattern the reference tool uses
 * (`default_capture_path` in `ignore/canable/src/canable/capture.py`). Local
 * time, like the original — a capture is named for when *you* recorded it.
 *
 * Takes `now` rather than reading the clock so it can be tested, the same rule
 * the Rust scheduling helpers follow.
 */
export function defaultCaptureFilename(now: Date): string {
	const pad = (value: number, width = 2) => String(value).padStart(width, "0");
	const date = `${pad(now.getFullYear(), 4)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `capture-${date}-${time}.csv`;
}

const UNITS = [
	{ limit: 1_000_000_000, suffix: "GB" },
	{ limit: 1_000_000, suffix: "MB" },
	{ limit: 1_000, suffix: "kB" },
];

/** A file size at a glance. Decimal units, because that is what disks claim. */
export function formatBytes(bytes: number): string {
	for (const { limit, suffix } of UNITS) {
		if (bytes >= limit) return `${(bytes / limit).toFixed(1)} ${suffix}`;
	}
	return `${Math.round(bytes)} B`;
}

/** Playback rates. `null` is as fast as the machine will go. */
export const SPEED_OPTIONS: { value: number | null; label: string }[] = [
	{ value: 0.5, label: "0.5×" },
	{ value: 1, label: "1× (real time)" },
	{ value: 2, label: "2×" },
	{ value: 5, label: "5×" },
	{ value: null, label: "As fast as possible" },
];

/**
 * The two traffic shapes the live view is known to struggle with, as one
 * click each. Both are deliberately reproducible: same seed, same file.
 */
export const CAPTURE_PRESETS: {
	id: string;
	label: string;
	description: string;
	spec: Omit<CaptureSpec, "from_dbc">;
}[] = [
	{
		id: "many-ids",
		label: "20 000 extended ids",
		description:
			"Two passes over 20 000 distinct 29-bit ids. Nothing bounds the live view's per-id map, so this is the shape that grows it.",
		spec: {
			seed: 1,
			duration_ms: 20_000,
			id_count: 20_000,
			extended: true,
			cycle_ms: 10_000,
			fd_ratio: 0.25,
			brs_ratio: 1,
			churn: 0.3,
		},
	},
	{
		id: "high-rate",
		label: "3 000 frames/s",
		description:
			"60 ids at 20 ms for thirty seconds. Enough sustained traffic to keep the main thread behind the emit queue.",
		spec: {
			seed: 1,
			duration_ms: 30_000,
			id_count: 60,
			extended: false,
			cycle_ms: 20,
			fd_ratio: 0.5,
			brs_ratio: 1,
			churn: 0.5,
		},
	},
];
