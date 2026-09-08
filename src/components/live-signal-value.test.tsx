import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSignal } from "@/lib/live-messages";
import { DEFAULT_VISUALIZE_SETTINGS } from "@/lib/visualize-settings";
import { makeSignal } from "@/test/fixtures";
import { LiveSignalValue } from "./live-signal-value";

const animate = vi.fn(() => ({ cancel: vi.fn() }));

function setReducedMotion(reduced: boolean) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: reduced && query.includes("reduce"),
			media: query,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
}

beforeEach(() => {
	// jsdom implements neither of these.
	HTMLElement.prototype.animate = animate as unknown as Element["animate"];
	animate.mockClear();
	setReducedMotion(false);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const settings = DEFAULT_VISUALIZE_SETTINGS;
const live = (overrides: Partial<LiveSignal> = {}): LiveSignal => ({
	value: 42,
	...overrides,
});

describe("LiveSignalValue", () => {
	it("shows the signal name, value and unit", () => {
		render(
			<LiveSignalValue
				signal={makeSignal({ name: "Speed", unit: "km/h" })}
				live={live({ value: 42 })}
				settings={settings}
			/>,
		);

		expect(screen.getByText("Speed")).toBeInTheDocument();
		expect(screen.getByText("42")).toBeInTheDocument();
		expect(screen.getByText("km/h")).toBeInTheDocument();
	});

	it("formats to the precision the signal's factor implies", () => {
		render(
			<LiveSignalValue
				signal={makeSignal({ name: "Temp", factor: 0.01 })}
				live={live({ value: 12.3400000000002 })}
				settings={settings}
			/>,
		);

		expect(screen.getByText("12.34")).toBeInTheDocument();
	});

	it("renders a single-bit signal as on/off rather than 1/0", () => {
		const flag = makeSignal({ name: "Enabled", size: 1 });
		const { rerender } = render(
			<LiveSignalValue
				signal={flag}
				live={live({ value: 1 })}
				settings={settings}
			/>,
		);
		expect(screen.getByText("on")).toBeInTheDocument();

		rerender(
			<LiveSignalValue
				signal={flag}
				live={live({ value: 0 })}
				settings={settings}
			/>,
		);
		expect(screen.getByText("off")).toBeInTheDocument();
	});

	it("does not animate a value that has never changed", () => {
		render(
			<LiveSignalValue
				signal={makeSignal()}
				live={live({ changedAt: undefined })}
				settings={settings}
			/>,
		);

		expect(animate).not.toHaveBeenCalled();
	});

	it("flashes in the configured color and duration when the value changes", () => {
		const signal = makeSignal();
		const { rerender } = render(
			<LiveSignalValue signal={signal} live={live()} settings={settings} />,
		);

		rerender(
			<LiveSignalValue
				signal={signal}
				live={live({ value: 43, previous: 42, changedAt: 1000 })}
				settings={{ ...settings, highlightColor: "#ff0000", fadeMs: 1234 }}
			/>,
		);

		expect(animate).toHaveBeenCalledTimes(1);
		const [keyframes, options] = animate.mock.calls[0] as unknown as [
			Keyframe[],
			KeyframeAnimationOptions,
		];
		expect(keyframes[0]?.backgroundColor).toBe("#ff0000");
		expect(keyframes[1]?.backgroundColor).toBe("transparent");
		expect(options.duration).toBe(1234);
	});

	it("re-flashes only when changedAt advances", () => {
		const signal = makeSignal();
		const props = {
			signal,
			settings,
			live: live({ value: 43, previous: 42, changedAt: 1000 }),
		};
		const { rerender } = render(<LiveSignalValue {...props} />);
		expect(animate).toHaveBeenCalledTimes(1);

		// A re-render with the same changedAt must not restart the fade.
		rerender(<LiveSignalValue {...props} />);
		expect(animate).toHaveBeenCalledTimes(1);

		rerender(
			<LiveSignalValue
				{...props}
				live={live({ value: 44, previous: 43, changedAt: 2000 })}
			/>,
		);
		expect(animate).toHaveBeenCalledTimes(2);
	});

	it("snaps instead of fading when reduced motion is preferred", () => {
		setReducedMotion(true);
		const signal = makeSignal();
		const { rerender } = render(
			<LiveSignalValue signal={signal} live={live()} settings={settings} />,
		);

		rerender(
			<LiveSignalValue
				signal={signal}
				live={live({ value: 43, previous: 42, changedAt: 1000 })}
				settings={settings}
			/>,
		);

		const [, options] = animate.mock.calls[0] as unknown as [
			Keyframe[],
			KeyframeAnimationOptions,
		];
		expect(options.easing).toBe("steps(1, end)");
	});
});
