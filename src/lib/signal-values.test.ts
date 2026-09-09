import { describe, expect, it } from "vitest";
import { makeMessage, makeSignal } from "@/test/fixtures";
import {
	defaultSignalValues,
	isBooleanSignal,
	validateSignalValue,
} from "./signal-values";

describe("isBooleanSignal", () => {
	it("treats a one-bit signal as a flag", () => {
		expect(isBooleanSignal(makeSignal({ size: 1 }))).toBe(true);
		expect(isBooleanSignal(makeSignal({ size: 2 }))).toBe(false);
	});
});

describe("validateSignalValue", () => {
	const signal = makeSignal({ size: 8 });

	it("accepts a value inside the range, endpoints included", () => {
		expect(validateSignalValue(signal, 0)).toBeUndefined();
		expect(validateSignalValue(signal, 128)).toBeUndefined();
		expect(validateSignalValue(signal, 255)).toBeUndefined();
	});

	it("requires a value at all", () => {
		expect(validateSignalValue(signal, undefined)).toBe("Required");
		expect(validateSignalValue(signal, Number.NaN)).toBe("Required");
	});

	it("names the bounds when the value is outside them", () => {
		expect(validateSignalValue(signal, 300)).toBe("Must be between 0 and 255");
		expect(validateSignalValue(signal, -1)).toBe("Must be between 0 and 255");
	});

	it("bounds by what the signal can encode, not by its declared min and max", () => {
		// Reverse-engineered DBCs routinely carry a placeholder 0|1 regardless
		// of bit width; trusting it would reject perfectly encodable values.
		const placeholder = makeSignal({ size: 8, min: 0, max: 1 });

		expect(validateSignalValue(placeholder, 200)).toBeUndefined();
	});

	it("applies factor and offset", () => {
		const scaled = makeSignal({ size: 8, factor: 0.5, offset: -10 });

		expect(validateSignalValue(scaled, 100)).toBeUndefined();
		expect(validateSignalValue(scaled, 130)).toBe(
			"Must be between -10 and 117.5",
		);
	});
});

describe("defaultSignalValues", () => {
	it("seeds every signal in the message", () => {
		const message = makeMessage({
			signals: [
				makeSignal({ name: "A", start_bit: 0, size: 8 }),
				makeSignal({ name: "B", start_bit: 8, size: 8 }),
			],
		});

		expect(defaultSignalValues(message)).toEqual({ A: 0, B: 0 });
	});

	it("uses the bottom of the range when zero is not encodable", () => {
		// An offset signal need not be able to represent zero at all.
		const message = makeMessage({
			signals: [makeSignal({ name: "Offset", size: 8, offset: 40 })],
		});

		expect(defaultSignalValues(message)).toEqual({ Offset: 40 });
	});

	it("is empty for a message with no signals", () => {
		expect(defaultSignalValues(makeMessage({ signals: [] }))).toEqual({});
	});
});
