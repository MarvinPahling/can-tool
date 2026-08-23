import { describe, expect, it } from "vitest";
import { getSignalColor } from "./signal-colors";

describe("getSignalColor", () => {
	it("produces a deterministic oklch color for a given index", () => {
		expect(getSignalColor(0)).toBe("oklch(0.75 0.15 0)");
	});

	it("rotates hue by the golden angle per index, wrapping at 360", () => {
		expect(getSignalColor(1)).toBe("oklch(0.75 0.15 137.508)");
		expect(getSignalColor(3)).toBe("oklch(0.75 0.15 52.524)");
	});

	it("gives distinct colors to consecutive indices", () => {
		const colors = new Set(
			Array.from({ length: 20 }, (_, i) => getSignalColor(i)),
		);
		expect(colors.size).toBe(20);
	});
});
