import { describe, expect, it } from "vitest";
import { DEFAULT_PERF_FLAGS, parsePerfFlags, perSecond } from "./perf-flags";

describe("parsePerfFlags", () => {
	it("defaults to no readout and devtools left alone", () => {
		// The defaults have to be today's behaviour, or simply having the flags
		// present would change what is being measured.
		expect(parsePerfFlags(null)).toEqual(DEFAULT_PERF_FLAGS);
		expect(DEFAULT_PERF_FLAGS).toEqual({ hud: false, devtools: true });
	});

	it("reads both flags", () => {
		expect(parsePerfFlags('{"hud":true,"devtools":false}')).toEqual({
			hud: true,
			devtools: false,
		});
	});

	it("ignores anything that is not a boolean", () => {
		// Storage is user-writable and survives app versions, so nothing read
		// back from it is trusted.
		expect(parsePerfFlags('{"hud":"yes","devtools":0}')).toEqual(
			DEFAULT_PERF_FLAGS,
		);
	});

	it("survives junk", () => {
		expect(parsePerfFlags("not json")).toEqual(DEFAULT_PERF_FLAGS);
		expect(parsePerfFlags("[]")).toEqual(DEFAULT_PERF_FLAGS);
		expect(parsePerfFlags("null")).toEqual(DEFAULT_PERF_FLAGS);
	});
});

describe("perSecond", () => {
	it("scales a delta to a rate", () => {
		expect(perSecond(100, 1_000)).toBe(100);
		expect(perSecond(100, 500)).toBe(200);
		expect(perSecond(50, 2_000)).toBe(25);
	});

	it("reports zero rather than infinity for a zero-length window", () => {
		// The first sample has no previous one to measure against.
		expect(perSecond(100, 0)).toBe(0);
		expect(perSecond(100, -5)).toBe(0);
	});
});
