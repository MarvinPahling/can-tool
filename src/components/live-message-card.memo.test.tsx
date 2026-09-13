import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveMessage, LiveSignal } from "@/lib/live-messages";
import { DEFAULT_VISUALIZE_SETTINGS } from "@/lib/visualize-settings";
import { makeMessage, makeSignal } from "@/test/fixtures";

/**
 * The card is memoized, so counting how often it renders means watching
 * something *inside* it. Mocking the card itself would replace the memo with
 * an unmemoized stub and prove nothing; mocking its child does not.
 */
const { rowRenders } = vi.hoisted(() => ({ rowRenders: vi.fn() }));

vi.mock("@/components/live-signal-value", () => ({
	LiveSignalValue: (props: { signal: { name: string } }) => {
		rowRenders(props.signal.name);
		return null;
	},
}));

const { LiveMessageCard } = await import("./live-message-card");

const message = makeMessage({
	id: 0x1a0,
	name: "Status",
	size: 2,
	signals: [
		makeSignal({ name: "Speed", start_bit: 0, size: 8 }),
		makeSignal({ name: "Brake", start_bit: 8, size: 8 }),
	],
});

function live(signals: Record<string, LiveSignal>, count = 1): LiveMessage {
	return {
		message,
		id: 0x1a0,
		extended: false,
		fd: false,
		bitrateSwitch: false,
		data: [1, 2],
		receivedAt: 1000,
		count,
		signals,
	};
}

const speed: LiveSignal = { value: 1 };
const brake: LiveSignal = { value: 2 };
const settings = DEFAULT_VISUALIZE_SETTINGS;

beforeEach(() => {
	rowRenders.mockClear();
	HTMLElement.prototype.animate = vi.fn(() => ({
		cancel: vi.fn(),
	})) as unknown as Element["animate"];
});

describe("LiveMessageCard memoization", () => {
	it("does not re-render when handed the same message again", () => {
		// Every flush builds a fresh array for the grid, so without the memo
		// every card on screen re-renders twenty times a second whether or not
		// a frame arrived for it.
		const same = live({ Speed: speed, Brake: brake });
		const { rerender } = render(
			<LiveMessageCard live={same} settings={settings} />,
		);
		expect(rowRenders).toHaveBeenCalledTimes(2);

		rerender(<LiveMessageCard live={same} settings={settings} />);

		expect(rowRenders).toHaveBeenCalledTimes(2);
	});

	it("re-renders when a frame produced a new message object", () => {
		const { rerender } = render(
			<LiveMessageCard
				live={live({ Speed: speed, Brake: brake })}
				settings={settings}
			/>,
		);
		rowRenders.mockClear();

		rerender(
			<LiveMessageCard
				live={live({ Speed: speed, Brake: brake }, 2)}
				settings={settings}
			/>,
		);

		expect(rowRenders).toHaveBeenCalledTimes(2);
	});
});
