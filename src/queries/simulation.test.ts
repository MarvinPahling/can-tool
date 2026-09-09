import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query-client";
import type { SimulationStatus } from "../api/simulation";
import {
	useSimulationError,
	useSimulationStatus,
	useStartSimulation,
	useStopSimulation,
} from "./simulation";

const { listen, unlisten, emit } = vi.hoisted(() => {
	// Captures the handler `listen` was called with, so tests can emit into it.
	let handler: ((event: { payload: unknown }) => void) | undefined;
	const unlisten = vi.fn();
	const listen = vi.fn(
		(_event: string, cb: (event: { payload: unknown }) => void) => {
			handler = cb;
			return Promise.resolve(unlisten);
		},
	);
	return {
		listen,
		unlisten,
		emit: (payload: unknown) => handler?.({ payload }),
	};
});

const { simulationStatus, startSimulation, stopSimulation } = vi.hoisted(
	() => ({
		simulationStatus: vi.fn(),
		startSimulation: vi.fn(),
		stopSimulation: vi.fn(),
	}),
);

vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("../api/simulation", async (importOriginal) => ({
	...(await importOriginal<typeof import("../api/simulation")>()),
	simulationStatus,
	startSimulation,
	stopSimulation,
}));

const idle: SimulationStatus = {
	running: false,
	frames_sent: 0,
	frame_count: 0,
	started_at_ms: 0,
	last_error: null,
};

/** A fresh client per test, plus the wrapper that provides it. */
function withClient() {
	const queryClient = createQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client: queryClient }, children);
	return { queryClient, wrapper };
}

const { wrapper } = withClient();

beforeEach(() => {
	listen.mockClear();
	unlisten.mockClear();
	simulationStatus.mockReset().mockResolvedValue(idle);
	startSimulation.mockReset().mockResolvedValue(undefined);
	stopSimulation.mockReset().mockResolvedValue(undefined);
});

describe("useSimulationStatus", () => {
	it("reads the scheduler status", async () => {
		const running: SimulationStatus = {
			running: true,
			frames_sent: 42,
			frame_count: 2,
			started_at_ms: 1_700_000_000_000,
			last_error: null,
		};
		simulationStatus.mockResolvedValue(running);

		const { result } = renderHook(() => useSimulationStatus(), { wrapper });

		await waitFor(() => expect(result.current.data).toEqual(running));
	});
});

describe("useStartSimulation", () => {
	it("passes the entries straight through", async () => {
		const entries = [
			{ message: { id: 0x116 }, values: { Value: 1 }, period_ms: 20 },
		];
		const { result } = renderHook(() => useStartSimulation(), { wrapper });

		await act(async () => {
			// biome-ignore lint/suspicious/noExplicitAny: a stub message, not a real DbcMessage
			await result.current.mutateAsync(entries as any);
		});

		expect(startSimulation).toHaveBeenCalledWith(entries);
	});

	it("refreshes the status even when starting failed", async () => {
		startSimulation.mockRejectedValue(new Error("Entry 1 (ESP_10): nope"));
		const { queryClient, wrapper } = withClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useStartSimulation(), { wrapper });

		await act(async () => {
			await result.current.mutateAsync([]).catch(() => {});
		});

		// A rejected start still stopped whatever was running, so the cached
		// status is stale either way — invalidating only onSuccess would leave
		// the page claiming a simulation is still running.
		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({
				queryKey: ["simulation", "status"],
			}),
		);
	});
});

describe("useStopSimulation", () => {
	it("stops the scheduler", async () => {
		const { result } = renderHook(() => useStopSimulation(), { wrapper });

		await act(async () => {
			await result.current.mutateAsync();
		});

		expect(stopSimulation).toHaveBeenCalled();
	});
});

describe("useSimulationError", () => {
	it("subscribes to the simulation-error event once on mount", () => {
		renderHook(() => useSimulationError(() => {}));

		expect(listen).toHaveBeenCalledTimes(1);
		expect(listen.mock.calls[0]?.[0]).toBe("simulation-error");
	});

	it("hands the message to the callback", () => {
		const onError = vi.fn();
		renderHook(() => useSimulationError(onError));

		emit("Device not configured (os error 6)");

		expect(onError).toHaveBeenCalledWith("Device not configured (os error 6)");
	});

	it("unlistens on unmount", async () => {
		const { unmount } = renderHook(() => useSimulationError(() => {}));
		// `listen` resolves asynchronously; let it settle before unmounting.
		await vi.waitFor(() => expect(listen).toHaveBeenCalled());

		unmount();

		await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
	});

	it("does not resubscribe when the callback identity changes", () => {
		const first = vi.fn();
		const second = vi.fn();
		const { rerender } = renderHook(({ cb }) => useSimulationError(cb), {
			initialProps: { cb: first },
		});

		rerender({ cb: second });
		emit("boom");

		expect(listen).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledWith("boom");
		expect(first).not.toHaveBeenCalled();
	});
});
