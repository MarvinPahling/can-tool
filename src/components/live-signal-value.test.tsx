import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSignal } from "@/lib/live-messages";
import { DEFAULT_VISUALIZE_SETTINGS } from "@/lib/visualize-settings";
import { makeSignal } from "@/test/fixtures";
import { LiveSignalValue } from "./live-signal-value";

interface FakeAnimation {
	cancel: ReturnType<typeof vi.fn>;
	commitStyles: ReturnType<typeof vi.fn>;
	onfinish?: () => void;
}

let animation: FakeAnimation;
const animate = vi.fn(() => {
	animation = { cancel: vi.fn(), commitStyles: vi.fn() };
	return animation;
});

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

	it("snaps instead of fading when reduced motion is preferred", async () => {
		setReducedMotion(true);
		// The preference is now read once and cached at module scope, so this
		// needs its own copy of the module to see a different one.
		vi.resetModules();
		const { LiveSignalValue: Fresh } = await import("./live-signal-value");

		const signal = makeSignal();
		const { rerender } = render(
			<Fresh signal={signal} live={live()} settings={settings} />,
		);

		rerender(
			<Fresh
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

	it("reads the reduced-motion query once, not once per fade", () => {
		// It used to be called inside the fade effect. Every call allocates a
		// `MediaQueryList` the document's matcher registers, and a busy bus
		// runs this thousands of times a second.
		const signal = makeSignal();
		const { rerender } = render(
			<LiveSignalValue signal={signal} live={live()} settings={settings} />,
		);
		const before = (matchMedia as unknown as ReturnType<typeof vi.fn>).mock
			.calls.length;

		for (let tick = 1; tick <= 5; tick++) {
			rerender(
				<LiveSignalValue
					signal={signal}
					live={live({ value: 40 + tick, changedAt: 1000 * tick })}
					settings={settings}
				/>,
			);
		}

		expect(animate).toHaveBeenCalledTimes(5);
		expect(
			(matchMedia as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBe(before);
	});

	it("releases the animation once the fade finishes", () => {
		// A finished `fill: "forwards"` animation stays alive on its element
		// and in `document.getAnimations()`, because it still owns the
		// computed background. One per rendered row, for as long as the row
		// exists — and the row count is what grows.
		const signal = makeSignal();
		const { rerender } = render(
			<LiveSignalValue signal={signal} live={live()} settings={settings} />,
		);
		rerender(
			<LiveSignalValue
				signal={signal}
				live={live({ value: 43, changedAt: 1000 })}
				settings={settings}
			/>,
		);

		expect(animation.cancel).not.toHaveBeenCalled();
		animation.onfinish?.();

		expect(animation.commitStyles).toHaveBeenCalledTimes(1);
		expect(animation.cancel).toHaveBeenCalledTimes(1);
	});

	it("still releases the animation when committing throws", () => {
		// `commitStyles` throws on a detached element. The fade is cosmetic;
		// it must not take the row down with it.
		const signal = makeSignal();
		const { rerender } = render(
			<LiveSignalValue signal={signal} live={live()} settings={settings} />,
		);
		rerender(
			<LiveSignalValue
				signal={signal}
				live={live({ value: 43, changedAt: 1000 })}
				settings={settings}
			/>,
		);
		animation.commitStyles.mockImplementation(() => {
			throw new Error("not rendered");
		});

		expect(() => animation.onfinish?.()).not.toThrow();
		expect(animation.cancel).toHaveBeenCalledTimes(1);
	});

	it("applies a new highlight colour to the next fade", () => {
		// The effect used to read the settings directly while depending only
		// on `changedAt`, so a settings change did nothing until the signal
		// happened to move again.
		const signal = makeSignal();
		const { rerender } = render(
			<LiveSignalValue signal={signal} live={live()} settings={settings} />,
		);

		rerender(
			<LiveSignalValue
				signal={signal}
				live={live({ value: 43, changedAt: 1000 })}
				settings={{ ...settings, highlightColor: "#00ff00" }}
			/>,
		);

		const [keyframes] = animate.mock.calls[0] as unknown as [Keyframe[]];
		expect(keyframes[0]?.backgroundColor).toBe("#00ff00");
	});

	it("does not restart a running fade when the settings change", () => {
		const signal = makeSignal();
		const props = {
			signal,
			settings,
			live: live({ value: 43, changedAt: 1000 }),
		};
		const { rerender } = render(<LiveSignalValue {...props} />);
		expect(animate).toHaveBeenCalledTimes(1);

		rerender(
			<LiveSignalValue {...props} settings={{ ...settings, fadeMs: 4000 }} />,
		);

		expect(animate).toHaveBeenCalledTimes(1);
	});
});

describe("LiveSignalValue memoization", () => {
	it("is memoized", () => {
		// Structural rather than behavioural: the row has no component child
		// to count renders through. What makes the memo *effective* — that
		// `applyFrames` returns an unchanged `LiveSignal` by identity — is
		// covered in `live-messages.test.ts` under "referential stability".
		expect((LiveSignalValue as unknown as { $$typeof: symbol }).$$typeof).toBe(
			Symbol.for("react.memo"),
		);
	});
});
