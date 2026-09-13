import { describe, expect, it } from "vitest";
import {
	CAPTURE_PRESETS,
	defaultCaptureFilename,
	formatBytes,
	SPEED_OPTIONS,
} from "./capture-file";

describe("defaultCaptureFilename", () => {
	it("matches the reference tool's pattern", () => {
		// `capture-YYYYMMDD-HHMMSS.csv`, from
		// `ignore/canable/src/canable/capture.py`'s `default_capture_path`.
		const name = defaultCaptureFilename(new Date(2026, 7, 27, 16, 4, 5));
		expect(name).toBe("capture-20260827-160405.csv");
	});

	it("pads every field to a fixed width", () => {
		const name = defaultCaptureFilename(new Date(2026, 0, 2, 3, 4, 5));
		expect(name).toBe("capture-20260102-030405.csv");
	});
});

describe("formatBytes", () => {
	it("keeps small sizes in bytes", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(900)).toBe("900 B");
	});

	it("steps up through the units", () => {
		expect(formatBytes(1_500)).toBe("1.5 kB");
		expect(formatBytes(2_500_000)).toBe("2.5 MB");
		expect(formatBytes(3_000_000_000)).toBe("3.0 GB");
	});
});

describe("SPEED_OPTIONS", () => {
	it("offers real time and an unbounded rate", () => {
		expect(SPEED_OPTIONS.some((option) => option.value === 1)).toBe(true);
		// The mode the whole harness exists for: push the frontend past what a
		// real bus could ever deliver.
		expect(SPEED_OPTIONS.some((option) => option.value === null)).toBe(true);
	});

	it("has no duplicate values", () => {
		const values = SPEED_OPTIONS.map((option) => option.value);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("CAPTURE_PRESETS", () => {
	it("covers the two shapes that break the live view", () => {
		const ids = CAPTURE_PRESETS.find((preset) => preset.id === "many-ids");
		expect(ids?.spec.id_count).toBeGreaterThanOrEqual(20_000);
		expect(ids?.spec.extended).toBe(true);

		const rate = CAPTURE_PRESETS.find((preset) => preset.id === "high-rate");
		const framesPerSecond =
			((rate?.spec.id_count ?? 0) * 1000) / (rate?.spec.cycle_ms ?? 1);
		expect(framesPerSecond).toBeGreaterThanOrEqual(3_000);
	});

	it("churns in every preset", () => {
		// A static capture creates no highlight and measures nothing.
		for (const preset of CAPTURE_PRESETS) {
			expect(preset.spec.churn).toBeGreaterThan(0);
		}
	});

	it("keeps every preset inside the 11-bit id space unless it asks for extended", () => {
		for (const preset of CAPTURE_PRESETS) {
			if (!preset.spec.extended) {
				expect(preset.spec.id_count).toBeLessThanOrEqual(1_792);
			}
		}
	});
});
