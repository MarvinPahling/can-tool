import { describe, expect, it } from "vitest";
import { makeSignal } from "@/test/fixtures";
import { hasSignificantChange } from "./signal-change";

const off = { thresholdEnabled: false, thresholdPercent: 0 };
const signal = makeSignal({ size: 8 });

describe("hasSignificantChange", () => {
	it("never highlights the first frame a signal appears in", () => {
		// Otherwise every value on the page flashes at once on connect.
		expect(hasSignificantChange(signal, undefined, 42, off)).toBe(false);
		expect(
			hasSignificantChange(signal, undefined, 42, {
				thresholdEnabled: true,
				thresholdPercent: 5,
			}),
		).toBe(false);
	});

	describe("with the threshold off", () => {
		it("highlights any difference at all", () => {
			expect(hasSignificantChange(signal, 10, 11, off)).toBe(true);
			expect(hasSignificantChange(signal, 10, 10.0001, off)).toBe(true);
		});

		it("stays quiet when the value is unchanged", () => {
			expect(hasSignificantChange(signal, 10, 10, off)).toBe(false);
		});
	});

	describe("with the threshold on", () => {
		const on = { thresholdEnabled: true, thresholdPercent: 20 };

		it("ignores a change smaller than the threshold", () => {
			// Range is 0–255, so 20% is 51.
			expect(hasSignificantChange(signal, 100, 140, on)).toBe(false);
		});

		it("highlights a change larger than the threshold", () => {
			expect(hasSignificantChange(signal, 100, 160, on)).toBe(true);
		});

		it("treats a change exactly at the threshold as insignificant", () => {
			expect(hasSignificantChange(signal, 100, 151, on)).toBe(false);
			expect(hasSignificantChange(signal, 100, 151.5, on)).toBe(true);
		});

		it("measures against the physical range, not the raw one", () => {
			// Raw range is 0–255, but a factor of 10 makes the physical range
			// 0–2550, so 20% is 510 rather than 51.
			const scaled = makeSignal({ size: 8, factor: 10 });
			expect(hasSignificantChange(scaled, 100, 600, on)).toBe(false);
			expect(hasSignificantChange(scaled, 100, 700, on)).toBe(true);
		});

		it("highlights in both directions", () => {
			expect(hasSignificantChange(signal, 160, 100, on)).toBe(true);
		});

		it("falls back to plain inequality for a degenerate range", () => {
			// A zero-width range must yield a boolean, never NaN.
			const degenerate = makeSignal({ size: 8, factor: 0 });
			expect(hasSignificantChange(degenerate, 5, 5, on)).toBe(false);
			expect(hasSignificantChange(degenerate, 5, 6, on)).toBe(true);
		});

		it("highlights everything at a zero percent threshold", () => {
			const zero = { thresholdEnabled: true, thresholdPercent: 0 };
			expect(hasSignificantChange(signal, 10, 10, zero)).toBe(false);
			expect(hasSignificantChange(signal, 10, 11, zero)).toBe(true);
		});
	});
});
