import { describe, expect, it } from "vitest";
import {
	clampPeriodMs,
	MAX_PERIOD_MS,
	MIN_PERIOD_MS,
	periodFromMs,
	periodToMs,
} from "./period";

describe("periodToMs", () => {
	it("passes milliseconds through", () => {
		expect(periodToMs(20, "ms")).toBe(20);
	});

	it("scales seconds up", () => {
		expect(periodToMs(1, "s")).toBe(1000);
		expect(periodToMs(0.02, "s")).toBe(20);
	});
});

describe("periodFromMs", () => {
	it("keeps a sub-second period in milliseconds", () => {
		expect(periodFromMs(20)).toEqual({ value: 20, unit: "ms" });
	});

	it("shows whole seconds as seconds", () => {
		expect(periodFromMs(1000)).toEqual({ value: 1, unit: "s" });
		expect(periodFromMs(5000)).toEqual({ value: 5, unit: "s" });
	});

	it("keeps a fractional second in milliseconds", () => {
		// 1.5 s is a worse thing to read than 1500 ms, and a worse thing to
		// edit — nudging the number would step by a whole second.
		expect(periodFromMs(1500)).toEqual({ value: 1500, unit: "ms" });
	});

	it("round-trips every unit", () => {
		for (const ms of [1, 20, 50, 999, 1000, 1500, 60_000]) {
			const { value, unit } = periodFromMs(ms);
			expect(periodToMs(value, unit)).toBe(ms);
		}
	});
});

describe("clampPeriodMs", () => {
	it("leaves a period in range alone", () => {
		expect(clampPeriodMs(20)).toBe(20);
	});

	it("clamps below the floor", () => {
		// A zero read back from storage would otherwise be a busy loop writing
		// as fast as the port will take it.
		expect(clampPeriodMs(0)).toBe(MIN_PERIOD_MS);
		expect(clampPeriodMs(-5)).toBe(MIN_PERIOD_MS);
	});

	it("clamps above the ceiling", () => {
		expect(clampPeriodMs(99_999_999)).toBe(MAX_PERIOD_MS);
	});

	it("falls back to the floor for anything that is not a number", () => {
		expect(clampPeriodMs(Number.NaN)).toBe(MIN_PERIOD_MS);
		expect(clampPeriodMs(Number.POSITIVE_INFINITY)).toBe(MIN_PERIOD_MS);
	});
});
