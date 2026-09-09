import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addSimulationEntry,
	clearSimulationEntries,
	simulationEntriesStore,
} from "@/lib/simulation-entries";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";
import { useAddToSimulation } from "./use-add-to-simulation";

const { navigate, useNavigate, useCurrentDbc } = vi.hoisted(() => {
	const navigate = vi.fn();
	return {
		navigate,
		useNavigate: vi.fn(() => navigate),
		useCurrentDbc: vi.fn(),
	};
});

vi.mock("@tanstack/react-router", () => ({ useNavigate }));
vi.mock("@/queries/dbc", () => ({ useCurrentDbc }));

const speed = makeMessage({
	id: 0x1a0,
	name: "Speed",
	signals: [makeSignal({ name: "Value", start_bit: 0, size: 8 })],
});

beforeEach(() => {
	useCurrentDbc.mockReturnValue({ data: makeDbcFile({ messages: [speed] }) });
});

afterEach(() => {
	clearSimulationEntries();
	localStorage.clear();
	vi.clearAllMocks();
});

describe("useAddToSimulation", () => {
	it("adds the message and goes to the board", () => {
		const { result } = renderHook(() => useAddToSimulation());

		result.current(String(speed.id));

		expect(simulationEntriesStore.state).toHaveLength(1);
		expect(simulationEntriesStore.state[0]?.messageId).toBe(String(speed.id));
		expect(navigate).toHaveBeenCalledWith({ to: "/simulate" });
	});

	it("seeds the values so the new entry encodes", () => {
		const { result } = renderHook(() => useAddToSimulation());

		result.current(String(speed.id));

		expect(simulationEntriesStore.state[0]?.values).toEqual({ Value: 0 });
	});

	it("goes to the card that already exists rather than stacking duplicates", () => {
		addSimulationEntry(String(speed.id));
		const { result } = renderHook(() => useAddToSimulation());

		result.current(String(speed.id));

		expect(simulationEntriesStore.state).toHaveLength(1);
		expect(navigate).toHaveBeenCalledWith({ to: "/simulate" });
	});

	it("still adds an entry for a message the DBC does not describe", () => {
		useCurrentDbc.mockReturnValue({ data: undefined });
		const { result } = renderHook(() => useAddToSimulation());

		result.current("1911");

		// The card says "Not in DBC"; refusing to add would be less useful.
		expect(simulationEntriesStore.state[0]?.messageId).toBe("1911");
		expect(simulationEntriesStore.state[0]?.values).toEqual({});
	});
});
