import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addSimulationEntry,
	clearSimulationEntries,
	type SimulationEntry,
	updateSimulationEntry,
} from "@/lib/simulation-entries";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";
import { buildPayload, frameRate, SimulationPanel } from "./simulation-panel";

const {
	encodeCanMessage,
	useConnectionStatus,
	useCurrentDbc,
	useGenerateChecksum,
	useSendCanMessage,
	useSimulationStatus,
	useStartSimulation,
	useStopSimulation,
	useSimulationError,
	start,
	stop,
} = vi.hoisted(() => ({
	encodeCanMessage: vi.fn(),
	useConnectionStatus: vi.fn(),
	useCurrentDbc: vi.fn(),
	useGenerateChecksum: vi.fn(),
	useSendCanMessage: vi.fn(),
	useSimulationStatus: vi.fn(),
	useStartSimulation: vi.fn(),
	useStopSimulation: vi.fn(),
	useSimulationError: vi.fn(),
	start: vi.fn(),
	stop: vi.fn(),
}));

vi.mock("@/api/can", () => ({ encodeCanMessage }));
vi.mock("@/queries/can", () => ({
	useConnectionStatus,
	useGenerateChecksum,
	useSendCanMessage,
}));
vi.mock("@/queries/dbc", () => ({ useCurrentDbc }));
vi.mock("@/queries/simulation", () => ({
	useSimulationStatus,
	useStartSimulation,
	useStopSimulation,
	useSimulationError,
}));

const speed = makeMessage({
	id: 0x1a0,
	name: "Speed",
	signals: [makeSignal({ name: "Value", start_bit: 0, size: 8 })],
});
const gear = makeMessage({
	id: 0x2b0,
	name: "Gear",
	signals: [makeSignal({ name: "Position", start_bit: 0, size: 4 })],
});
const dbc = makeDbcFile({ messages: [speed, gear] });

function idle(overrides: Record<string, unknown> = {}) {
	return {
		data: {
			running: false,
			frames_sent: 0,
			frame_count: 0,
			started_at_ms: 0,
			last_error: null,
			...overrides,
		},
	};
}

function renderPanel() {
	return render(<SimulationPanel filter="" onFilterChange={() => {}} />);
}

function startButton() {
	return screen.getByRole("button", { name: /^start$/i });
}

beforeEach(() => {
	encodeCanMessage.mockResolvedValue([0]);
	useCurrentDbc.mockReturnValue({ data: dbc });
	useConnectionStatus.mockReturnValue({
		data: { port_name: "tty", bitrate: 500_000, read_only: false },
	});
	useGenerateChecksum.mockReturnValue({
		mutateAsync: vi.fn(),
		isPending: false,
		isError: false,
	});
	useSendCanMessage.mockReturnValue({ mutate: vi.fn(), isPending: false });
	useSimulationStatus.mockReturnValue(idle());
	useStartSimulation.mockReturnValue({ mutate: start, isPending: false });
	useStopSimulation.mockReturnValue({ mutate: stop, isPending: false });
	useSimulationError.mockImplementation(() => {});
});

afterEach(() => {
	clearSimulationEntries();
	localStorage.clear();
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe("buildPayload", () => {
	it("takes only enabled entries whose message is in the DBC", () => {
		const entries: SimulationEntry[] = [
			{
				id: "a",
				messageId: String(speed.id),
				values: { Value: 1 },
				periodMs: 20,
				checksumSignal: "",
				checksumAuto: false,
				enabled: true,
			},
			{
				id: "b",
				messageId: String(gear.id),
				values: {},
				periodMs: 50,
				checksumSignal: "",
				checksumAuto: false,
				enabled: false,
			},
			{
				id: "c",
				messageId: "9999",
				values: {},
				periodMs: 50,
				checksumSignal: "",
				checksumAuto: false,
				enabled: true,
			},
		];

		expect(buildPayload(entries, dbc)).toEqual([
			{ message: speed, values: { Value: 1 }, period_ms: 20 },
		]);
	});

	it("is empty without a DBC", () => {
		expect(buildPayload([], undefined)).toEqual([]);
	});
});

describe("frameRate", () => {
	it("adds up what the whole board asks of the adapter", () => {
		expect(
			frameRate([
				{ message: speed, values: {}, period_ms: 20 },
				{ message: gear, values: {}, period_ms: 1000 },
			]),
		).toBeCloseTo(51);
	});
});

describe("SimulationPanel", () => {
	it("cannot start with nothing on the board", () => {
		renderPanel();

		expect(startButton()).toBeDisabled();
	});

	it("cannot start without a writable connection", () => {
		useConnectionStatus.mockReturnValue({
			data: { port_name: "tty", bitrate: 500_000, read_only: true },
		});
		addSimulationEntry(String(speed.id));
		renderPanel();

		expect(startButton()).toBeDisabled();
		expect(screen.getByText(/read-only mode/i)).toBeInTheDocument();
	});

	it("starts with the enabled, resolvable entries", async () => {
		const id = addSimulationEntry(String(speed.id));
		updateSimulationEntry(id, { values: { Value: 3 }, periodMs: 20 });
		const disabled = addSimulationEntry(String(gear.id));
		updateSimulationEntry(disabled, { enabled: false });
		renderPanel();

		await userEvent.click(startButton());

		expect(start).toHaveBeenCalledWith([
			{ message: speed, values: { Value: 3 }, period_ms: 20 },
		]);
	});

	it("stops a running simulation", async () => {
		addSimulationEntry(String(speed.id));
		useSimulationStatus.mockReturnValue(idle({ running: true }));
		renderPanel();

		await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));

		expect(stop).toHaveBeenCalled();
	});

	it("reports a run that died mid-flight", () => {
		// The real hook reports from an event listener, i.e. after render.
		useSimulationError.mockImplementation((onError: (m: string) => void) => {
			useEffect(() => onError("Device not configured (os error 6)"), [onError]);
		});
		renderPanel();

		expect(
			screen.getByText("Device not configured (os error 6)"),
		).toBeInTheDocument();
	});

	it("reports why a start was refused", () => {
		useStartSimulation.mockReturnValue({
			mutate: start,
			isPending: false,
			error: new Error("Entry 1 (Speed): Signal 'Value' value 300 is outside"),
		});
		renderPanel();

		expect(screen.getByText(/Entry 1 \(Speed\)/)).toBeInTheDocument();
	});

	it("warns when the board asks for more than the adapter can carry", () => {
		const id = addSimulationEntry(String(speed.id));
		updateSimulationEntry(id, { periodMs: 1 });
		renderPanel();

		expect(screen.getByText(/more than the adapter can carry/)).toBeVisible();
	});

	it("does not warn about a reasonable load", () => {
		const id = addSimulationEntry(String(speed.id));
		updateSimulationEntry(id, { periodMs: 20 });
		renderPanel();

		expect(screen.getByText(/≈ 50 frames\/s/)).toBeInTheDocument();
		expect(screen.queryByText(/more than the adapter/)).toBeNull();
	});

	it("says when there is no DBC to pick messages from", () => {
		useCurrentDbc.mockReturnValue({ data: undefined });
		renderPanel();

		expect(screen.getByText(/No DBC loaded/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /add message/i })).toBeDisabled();
	});
});

describe("SimulationPanel restart-on-edit", () => {
	it("restarts once after an edit settles, not once per keystroke", async () => {
		vi.useFakeTimers();
		const id = addSimulationEntry(String(speed.id));
		updateSimulationEntry(id, { values: { Value: 1 }, periodMs: 20 });
		useSimulationStatus.mockReturnValue(idle({ running: true }));
		renderPanel();

		// Three edits in quick succession, as typing a value would produce —
		// spaced far enough apart to render separately, so each one really does
		// get its own chance to schedule a restart.
		updateSimulationEntry(id, { values: { Value: 2 } });
		await vi.advanceTimersByTimeAsync(50);
		updateSimulationEntry(id, { values: { Value: 3 } });
		await vi.advanceTimersByTimeAsync(50);
		updateSimulationEntry(id, { values: { Value: 4 } });
		await vi.advanceTimersByTimeAsync(1000);

		expect(start).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenLastCalledWith([
			{ message: speed, values: { Value: 4 }, period_ms: 20 },
		]);
	});

	it("does not restart a simulation that was just started", async () => {
		vi.useFakeTimers();
		addSimulationEntry(String(speed.id));
		const { rerender } = render(
			<SimulationPanel filter="" onFilterChange={() => {}} />,
		);

		// Press Start, then let the polled status catch up to it.
		startButton().click();
		useSimulationStatus.mockReturnValue(idle({ running: true }));
		rerender(<SimulationPanel filter="" onFilterChange={() => {}} />);
		await vi.advanceTimersByTimeAsync(1000);

		expect(start).toHaveBeenCalledTimes(1);
	});

	it("does not restart while stopped", async () => {
		vi.useFakeTimers();
		const id = addSimulationEntry(String(speed.id));
		renderPanel();

		updateSimulationEntry(id, { periodMs: 50 });
		await vi.advanceTimersByTimeAsync(1000);

		expect(start).not.toHaveBeenCalled();
	});
});
