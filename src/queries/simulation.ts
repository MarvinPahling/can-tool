import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { SimulationEntryPayload } from "../api/simulation";
import {
	SIMULATION_ERROR_EVENT,
	simulationStatus,
	startSimulation,
	stopSimulation,
} from "../api/simulation";

export const simulationKeys = {
	all: ["simulation"] as const,
	status: ["simulation", "status"] as const,
};

/**
 * How often the scheduler's status is polled. Faster than the connection
 * poll because this one backs a button the user just pressed: Start has to
 * flip to Stop without a visible lag.
 */
const STATUS_POLL_MS = 500;

/**
 * Polled rather than pushed. The status is a handful of scalars that change
 * slowly, and the one thing that genuinely needs pushing — a run dying
 * mid-flight — has its own event (see `useSimulationError`).
 */
export function useSimulationStatus() {
	return useQuery({
		queryKey: simulationKeys.status,
		queryFn: simulationStatus,
		refetchInterval: STATUS_POLL_MS,
	});
}

export function useStartSimulation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (entries: SimulationEntryPayload[]) => startSimulation(entries),
		// On failure too: a rejected start still stopped whatever was running.
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: simulationKeys.status });
		},
	});
}

export function useStopSimulation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: stopSimulation,
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: simulationKeys.status });
		},
	});
}

/**
 * Subscribes to the failure the scheduler thread emits when a write dies.
 *
 * Same shape as `useCanFrames`: the callback lives in a ref so a re-rendering
 * consumer does not tear down and re-register the listener, and a `listen`
 * that resolves after unmount unlistens immediately rather than leaking.
 */
export function useSimulationError(onError: (message: string) => void) {
	const handler = useRef(onError);
	useEffect(() => {
		handler.current = onError;
	});

	useEffect(() => {
		let cancelled = false;
		let unlisten: (() => void) | undefined;

		listen<string>(SIMULATION_ERROR_EVENT, (event) => {
			handler.current(event.payload);
		}).then((fn) => {
			if (cancelled) fn();
			else unlisten = fn;
		});

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, []);
}
