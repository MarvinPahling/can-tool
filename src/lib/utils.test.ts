import { describe, expect, it } from "vitest";
import { bytesToHex, cn, formatCanId } from "./utils";

describe("cn", () => {
	it("joins class names", () => {
		expect(cn("a", "b")).toBe("a b");
	});

	it("drops falsy values", () => {
		expect(cn("a", false, undefined, null, "b")).toBe("a b");
	});

	it("merges conflicting tailwind classes, keeping the last one", () => {
		expect(cn("p-2", "p-4")).toBe("p-4");
	});

	it("applies conditional class objects", () => {
		expect(cn("base", { active: true, hidden: false })).toBe("base active");
	});
});

describe("bytesToHex", () => {
	it("formats bytes as uppercase space-separated hex", () => {
		expect(bytesToHex([0xde, 0xad, 0x00])).toBe("DE AD 00");
	});

	it("is empty for an empty frame", () => {
		expect(bytesToHex([])).toBe("");
	});
});

describe("formatCanId", () => {
	it("pads a standard id to three nibbles", () => {
		expect(formatCanId(0x1a0, false)).toBe("0x1A0");
		expect(formatCanId(0x7, false)).toBe("0x007");
	});

	it("pads an extended id to eight", () => {
		expect(formatCanId(0x999, true)).toBe("0x00000999");
	});
});
