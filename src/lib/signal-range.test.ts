import { describe, expect, it } from "vitest";
import { makeSignal } from "@/test/fixtures";
import { getSignalRange } from "./signal-range";

describe("getSignalRange", () => {
	it("computes the unsigned range from bit width, factor, and offset", () => {
		const signal = makeSignal({ size: 8, signed: false, factor: 1, offset: 0 });
		expect(getSignalRange(signal)).toEqual({ min: 0, max: 255 });
	});

	it("computes the signed range for a two's-complement width", () => {
		const signal = makeSignal({ size: 8, signed: true, factor: 1, offset: 0 });
		expect(getSignalRange(signal)).toEqual({ min: -128, max: 127 });
	});

	it("applies factor and offset to both bounds", () => {
		const signal = makeSignal({
			size: 8,
			signed: false,
			factor: 0.5,
			offset: -10,
		});
		expect(getSignalRange(signal)).toEqual({ min: -10, max: 255 * 0.5 - 10 });
	});

	it("ignores the DBC's declared min/max entirely", () => {
		const signal = makeSignal({ size: 4, signed: false, min: 0, max: 1 });
		expect(getSignalRange(signal)).toEqual({ min: 0, max: 15 });
	});
});
