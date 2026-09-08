import { describe, expect, it } from "vitest";
import { makeMessage, makeSignal } from "@/test/fixtures";
import { decodeMessage, decodeSignal } from "./decode-message";

describe("decodeSignal", () => {
	it("reads a little-endian unsigned value", () => {
		const signal = makeSignal({ start_bit: 0, size: 16 });
		// 0x0102 == 258, least significant byte first.
		expect(decodeSignal(signal, [0x02, 0x01])).toBe(258);
	});

	it("reads a big-endian value across a byte boundary", () => {
		const signal = makeSignal({
			start_bit: 7,
			size: 16,
			little_endian: false,
		});
		// Bit 1 of the raw value lands in byte 0, bit 8 in byte 1.
		expect(decodeSignal(signal, [0x40, 0x80])).toBe(258);
	});

	it("sign-extends a signed value", () => {
		const signal = makeSignal({ size: 8, signed: true });
		expect(decodeSignal(signal, [0xff])).toBe(-1);
		expect(decodeSignal(signal, [0x80])).toBe(-128);
		expect(decodeSignal(signal, [0x7f])).toBe(127);
	});

	it("applies factor and offset to reach the physical value", () => {
		const signal = makeSignal({ size: 8, factor: 0.5, offset: -10 });
		expect(decodeSignal(signal, [20])).toBe(0);
		expect(decodeSignal(signal, [0])).toBe(-10);
	});

	it("reads a single-bit flag from its position", () => {
		const signal = makeSignal({ start_bit: 3, size: 1 });
		expect(decodeSignal(signal, [0b1000])).toBe(1);
		expect(decodeSignal(signal, [0b0111])).toBe(0);
	});

	it("returns undefined when the signal runs past the frame", () => {
		const signal = makeSignal({ start_bit: 56, size: 16 });
		// Short frames are routine on a real bus and must not throw.
		expect(decodeSignal(signal, [0, 0, 0, 0, 0, 0, 0, 0])).toBeUndefined();
		expect(decodeSignal(makeSignal({ size: 8 }), [])).toBeUndefined();
	});

	it("decodes values wider than 32 bits", () => {
		// Bitwise operators would truncate to 32 bits here.
		const signal = makeSignal({ start_bit: 0, size: 40 });
		expect(decodeSignal(signal, [0, 0, 0, 0, 1])).toBe(2 ** 32);
	});
});

describe("decodeMessage", () => {
	it("decodes every plain signal in the message", () => {
		const message = makeMessage({
			signals: [
				makeSignal({ name: "A", start_bit: 0, size: 8 }),
				makeSignal({ name: "B", start_bit: 8, size: 8 }),
			],
		});
		expect(decodeMessage(message, [0x11, 0x22])).toEqual({
			A: 0x11,
			B: 0x22,
		});
	});

	it("omits signals that run past the frame", () => {
		const message = makeMessage({
			signals: [
				makeSignal({ name: "A", start_bit: 0, size: 8 }),
				makeSignal({ name: "Missing", start_bit: 32, size: 8 }),
			],
		});
		expect(decodeMessage(message, [0x11])).toEqual({ A: 0x11 });
	});

	it("includes only the multiplexed signals selected by the multiplexor", () => {
		const message = makeMessage({
			signals: [
				makeSignal({
					name: "Mux",
					start_bit: 0,
					size: 8,
					multiplexer: { kind: "Multiplexor" },
				}),
				makeSignal({
					name: "OnZero",
					start_bit: 8,
					size: 8,
					multiplexer: { kind: "MultiplexedSignal", switch_value: 0 },
				}),
				makeSignal({
					name: "OnOne",
					start_bit: 8,
					size: 8,
					multiplexer: { kind: "MultiplexedSignal", switch_value: 1 },
				}),
			],
		});

		expect(decodeMessage(message, [0, 0x42])).toEqual({
			Mux: 0,
			OnZero: 0x42,
		});
		expect(decodeMessage(message, [1, 0x42])).toEqual({
			Mux: 1,
			OnOne: 0x42,
		});
	});

	it("gates multiplexed signals on the multiplexor's raw value", () => {
		// A factor on the multiplexor must not shift which frame is selected.
		const message = makeMessage({
			signals: [
				makeSignal({
					name: "Mux",
					start_bit: 0,
					size: 8,
					factor: 10,
					multiplexer: { kind: "Multiplexor" },
				}),
				makeSignal({
					name: "OnTwo",
					start_bit: 8,
					size: 8,
					multiplexer: { kind: "MultiplexedSignal", switch_value: 2 },
				}),
			],
		});
		expect(decodeMessage(message, [2, 0x42])).toEqual({
			Mux: 20,
			OnTwo: 0x42,
		});
	});

	it("drops multiplexed signals when the message has no multiplexor", () => {
		const message = makeMessage({
			signals: [
				makeSignal({
					name: "Orphan",
					multiplexer: { kind: "MultiplexedSignal", switch_value: 0 },
				}),
			],
		});
		expect(decodeMessage(message, [0x42])).toEqual({});
	});

	it("round-trips the byte pattern the Rust encoder produces", () => {
		// Mirrors `encode_can_message_packs_a_little_endian_value` in
		// src-tauri/src/can.rs, so both sides provably agree.
		const message = makeMessage({
			signals: [makeSignal({ name: "Val", start_bit: 0, size: 16 })],
		});
		expect(decodeMessage(message, [0x02, 0x01])).toEqual({ Val: 258 });
	});
});
