import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanFrame } from "@/api/can";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";
import { LiveTraffic } from "./live-traffic";

const {
	emitFrames,
	useCanFrames,
	useConnectionStatus,
	useCurrentDbc,
	useReplayStatus,
	useCanError,
	emitRejections,
} = vi.hoisted(() => {
	let handler: ((batch: unknown) => void) | undefined;
	let errorHandler: ((event: unknown) => void) | undefined;
	return {
		useCanFrames: vi.fn((cb: (batch: unknown) => void, enabled = true) => {
			// Only a live subscription reaches the fold; a disabled one must
			// not, or the state grows behind a guard nothing renders from.
			handler = enabled ? cb : undefined;
		}),
		useCanError: vi.fn((cb: (event: unknown) => void) => {
			errorHandler = cb;
		}),
		useConnectionStatus: vi.fn(),
		useCurrentDbc: vi.fn(),
		useReplayStatus: vi.fn(),
		emitFrames: (frames: CanFrame[], dropped = 0) =>
			handler?.({ frames, dropped }),
		emitRejections: (rejections: number) => errorHandler?.({ rejections }),
	};
});

vi.mock("@/queries/can", () => ({
	useCanError,
	useCanFrames,
	useConnectionStatus,
}));
vi.mock("@/queries/dbc", () => ({ useCurrentDbc }));
vi.mock("@/queries/recording", () => ({ useReplayStatus }));
// The capture controls have their own test; here they are only in the way.
vi.mock("./capture-bar", () => ({ CaptureBar: () => null }));

const dbc = makeDbcFile({
	messages: [
		makeMessage({
			id: 0x1a0,
			name: "Speed",
			signals: [makeSignal({ name: "Value", start_bit: 0, size: 8 })],
		}),
		makeMessage({
			id: 0x2b0,
			name: "Brake",
			signals: [makeSignal({ name: "Pressure", start_bit: 0, size: 8 })],
		}),
	],
});

function frame(overrides: Partial<CanFrame> = {}): CanFrame {
	return {
		id: 0x1a0,
		extended: false,
		fd: false,
		bitrate_switch: false,
		remote: false,
		data: [5],
		timestamp_ms: 1000,
		...overrides,
	};
}

/** Pushes frames in, then lets the render-flush interval fire. */
/** Whether the most recent `useCanFrames` call asked to be subscribed. */
function lastEnabled(): boolean | undefined {
	const calls = useCanFrames.mock.calls;
	return calls[calls.length - 1]?.[1];
}

function deliver(frames: CanFrame[], dropped = 0) {
	act(() => {
		emitFrames(frames, dropped);
		vi.advanceTimersByTime(200);
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	HTMLElement.prototype.animate = vi.fn(() => ({
		cancel: vi.fn(),
	})) as unknown as Element["animate"];
	useCurrentDbc.mockReturnValue({ data: dbc });
	useConnectionStatus.mockReturnValue({
		data: { port_name: "tty", bitrate: 5e5 },
	});
	useReplayStatus.mockReturnValue({ data: { running: false } });
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("LiveTraffic", () => {
	it("prompts to open a DBC file when none is loaded", () => {
		useCurrentDbc.mockReturnValue({ data: undefined });
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		expect(screen.getByText(/no dbc/i)).toBeInTheDocument();
	});

	it("prompts to connect when nothing is producing frames", () => {
		useConnectionStatus.mockReturnValue({ data: null });
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		expect(screen.getByText(/no frames arriving/i)).toBeInTheDocument();
	});

	it("renders the grid during a replay with no device connected", () => {
		// The whole point of the harness: frames with nothing plugged in. If the
		// guard only knew about adapters, a replay would render an alert.
		useConnectionStatus.mockReturnValue({ data: null });
		useReplayStatus.mockReturnValue({ data: { running: true } });
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		expect(screen.queryByText(/no frames arriving/i)).not.toBeInTheDocument();

		deliver([frame()]);
		expect(screen.getByText("Speed")).toBeInTheDocument();
	});

	it("waits quietly until the first frame arrives", () => {
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		expect(screen.getByText(/waiting for traffic/i)).toBeInTheDocument();
	});

	it("renders a card per received message", () => {
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		deliver([frame(), frame({ id: 0x2b0, data: [9] })]);

		expect(screen.getByText("Speed")).toBeInTheDocument();
		expect(screen.getByText("Brake")).toBeInTheDocument();
		expect(screen.queryByText(/waiting for traffic/i)).not.toBeInTheDocument();
	});

	it("updates a card in place rather than adding another", () => {
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		deliver([frame({ data: [5] })]);
		expect(screen.getByText("5")).toBeInTheDocument();

		deliver([frame({ data: [7], timestamp_ms: 2000 })]);
		expect(screen.getAllByText("Speed")).toHaveLength(1);
		expect(screen.getByText("7")).toBeInTheDocument();
		expect(screen.queryByText("5")).not.toBeInTheDocument();
	});

	it("narrows the visible cards with the filter", () => {
		const { rerender } = render(
			<LiveTraffic filter="" onFilterChange={() => {}} />,
		);
		deliver([frame(), frame({ id: 0x2b0, data: [9] })]);

		rerender(<LiveTraffic filter="brake" onFilterChange={() => {}} />);

		expect(screen.getByText("Brake")).toBeInTheDocument();
		expect(screen.queryByText("Speed")).not.toBeInTheDocument();
	});

	it("filters on the hex id as well as the name", () => {
		const { rerender } = render(
			<LiveTraffic filter="" onFilterChange={() => {}} />,
		);
		deliver([frame(), frame({ id: 0x2b0, data: [9] })]);

		rerender(<LiveTraffic filter="0x2B0" onFilterChange={() => {}} />);

		expect(screen.getByText("Brake")).toBeInTheDocument();
		expect(screen.queryByText("Speed")).not.toBeInTheDocument();
	});

	it("shows traffic that is not in the DBC", () => {
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		deliver([frame({ id: 0x777, data: [1] })]);

		expect(screen.getByText("Not in DBC")).toBeInTheDocument();
	});

	it("says when the backend had to drop frames", () => {
		// Silently showing stale cards would be worse than the drop: the page
		// has to be able to admit it is behind.
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		deliver([frame()], 1_500);

		expect(screen.getByText(/1,500 dropped/)).toBeInTheDocument();
	});

	it("does not mention drops on a healthy bus", () => {
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		deliver([frame()]);

		expect(screen.queryByText(/dropped/)).not.toBeInTheDocument();
	});

	it("surfaces adapter transmit rejections", () => {
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		act(() => {
			emitRejections(3);
			emitRejections(4);
		});

		expect(
			screen.getByText(/7 transmitted frames were refused/),
		).toBeInTheDocument();
	});

	it("does not fold frames while the no-DBC guard is showing", () => {
		// The hooks run before the guard is decided, so without switching the
		// subscription off the map grew the whole time a static alert was on
		// screen, with nothing to hint at it.
		useCurrentDbc.mockReturnValue({ data: undefined });
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		deliver([frame()]);

		expect(lastEnabled()).toBe(false);
	});

	it("does not fold frames while nothing is producing them", () => {
		useConnectionStatus.mockReturnValue({ data: null });
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		deliver([frame()]);

		expect(lastEnabled()).toBe(false);
	});

	it("folds frames once there is a DBC and a source", () => {
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);
		expect(lastEnabled()).toBe(true);
	});

	it("keeps the cards in id order as new ids appear", () => {
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		deliver([frame({ id: 0x2b0 })]);
		deliver([frame({ id: 0x1a0 })]);

		// The state map is kept in recency order for eviction, so the display
		// order is sorted separately — and only when the id set moves.
		const names = screen
			.getAllByText(/^(Speed|Brake)$/)
			.map((node) => node.textContent);
		expect(names).toEqual(["Speed", "Brake"]);
	});
});
