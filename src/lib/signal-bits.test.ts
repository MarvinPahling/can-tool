import { describe, expect, it } from "vitest";
import { makeSignal } from "@/test/fixtures";
import { buildSignalBitMap, getSignalBitIndices } from "./signal-bits";

describe("getSignalBitIndices", () => {
	it("returns a contiguous ascending range for little-endian signals", () => {
		const signal = makeSignal({ start_bit: 3, size: 5, little_endian: true });
		expect(getSignalBitIndices(signal)).toEqual([3, 4, 5, 6, 7]);
	});

	it("walks MSB-first within a byte for big-endian signals", () => {
		// DBC big-endian numbering for a full byte starting at bit 7: 7,6,5,4,3,2,1,0
		const signal = makeSignal({ start_bit: 7, size: 8, little_endian: false });
		expect(getSignalBitIndices(signal)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
	});

	it("wraps into the next byte for big-endian signals crossing a byte boundary", () => {
		const signal = makeSignal({ start_bit: 1, size: 4, little_endian: false });
		// From bit 1, walking down within the byte: 1, 0, then wrap to 15, 14
		expect(getSignalBitIndices(signal)).toEqual([1, 0, 15, 14]);
	});

	it("returns an empty array for a zero-size signal", () => {
		const signal = makeSignal({ size: 0 });
		expect(getSignalBitIndices(signal)).toEqual([]);
	});
});

describe("buildSignalBitMap", () => {
	it("maps each bit index to its owning signal", () => {
		const a = makeSignal({
			name: "A",
			start_bit: 0,
			size: 2,
			little_endian: true,
		});
		const b = makeSignal({
			name: "B",
			start_bit: 2,
			size: 2,
			little_endian: true,
		});
		const map = buildSignalBitMap([a, b]);

		expect(map.get(0)).toEqual([a]);
		expect(map.get(1)).toEqual([a]);
		expect(map.get(2)).toEqual([b]);
		expect(map.get(3)).toEqual([b]);
		expect(map.has(4)).toBe(false);
	});

	it("lists every overlapping signal for a shared bit, in signal order", () => {
		const a = makeSignal({
			name: "A",
			start_bit: 0,
			size: 4,
			little_endian: true,
		});
		const b = makeSignal({
			name: "B",
			start_bit: 2,
			size: 4,
			little_endian: true,
		});
		const map = buildSignalBitMap([a, b]);

		expect(map.get(2)).toEqual([a, b]);
		expect(map.get(3)).toEqual([a, b]);
	});

	it("returns an empty map for no signals", () => {
		expect(buildSignalBitMap([]).size).toBe(0);
	});
});
