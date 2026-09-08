import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanFrame } from "@/api/can";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";
import { LiveTraffic } from "./live-traffic";

const { emitFrames, useCanFrames, useConnectionStatus, useCurrentDbc } =
	vi.hoisted(() => {
		let handler: ((frames: unknown[]) => void) | undefined;
		return {
			useCanFrames: vi.fn((cb: (frames: unknown[]) => void) => {
				handler = cb;
			}),
			useConnectionStatus: vi.fn(),
			useCurrentDbc: vi.fn(),
			emitFrames: (frames: CanFrame[]) => handler?.(frames),
		};
	});

vi.mock("@/queries/can", () => ({ useCanFrames, useConnectionStatus }));
vi.mock("@/queries/dbc", () => ({ useCurrentDbc }));

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
		data: [5],
		timestamp_ms: 1000,
		...overrides,
	};
}

/** Pushes frames in, then lets the render-flush interval fire. */
function deliver(frames: CanFrame[]) {
	act(() => {
		emitFrames(frames);
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

	it("prompts to connect when there is no device", () => {
		useConnectionStatus.mockReturnValue({ data: null });
		render(<LiveTraffic filter="" onFilterChange={() => {}} />);

		expect(screen.getByText(/not connected/i)).toBeInTheDocument();
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
});
