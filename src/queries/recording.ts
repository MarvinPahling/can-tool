import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CaptureSpec, ReplayOptions } from "../api/recording";
import {
	generateCapture,
	recordingStatus,
	replayStatus,
	startRecording,
	startReplay,
	stopRecording,
	stopReplay,
} from "../api/recording";

export const recordingKeys = {
	all: ["recording"] as const,
	status: ["recording", "status"] as const,
};

export const replayKeys = {
	all: ["replay"] as const,
	status: ["replay", "status"] as const,
};

/**
 * How often the recorder and replay report in. Matches the simulation's poll:
 * both back buttons the user just pressed, and Record has to flip to Stop
 * without a visible lag.
 */
const STATUS_POLL_MS = 500;

/**
 * Polled rather than pushed, like `useSimulationStatus`. Both statuses are a
 * handful of scalars, and the two things that would justify an event — a
 * recording hitting a ceiling, a replay running out — are already visible in
 * the next poll as `recording: false` with a `stopped_reason`.
 */
export function useRecordingStatus() {
	return useQuery({
		queryKey: recordingKeys.status,
		queryFn: recordingStatus,
		refetchInterval: STATUS_POLL_MS,
	});
}

export function useReplayStatus() {
	return useQuery({
		queryKey: replayKeys.status,
		queryFn: replayStatus,
		refetchInterval: STATUS_POLL_MS,
	});
}

export function useStartRecording() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (path: string) => startRecording(path),
		// On failure too: a rejected start leaves the cached status stale either
		// way, and invalidating only onSuccess would let the page keep claiming
		// whatever it last saw.
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: recordingKeys.status });
		},
	});
}

export function useStopRecording() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: stopRecording,
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: recordingKeys.status });
		},
	});
}

export function useStartReplay() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ path, options }: { path: string; options: ReplayOptions }) =>
			startReplay(path, options),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: replayKeys.status });
		},
	});
}

export function useStopReplay() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: stopReplay,
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: replayKeys.status });
		},
	});
}

/**
 * Writing a synthetic capture is a plain one-shot: it touches no state the
 * status queries report, so nothing is invalidated. The caller decides whether
 * to replay what it just wrote.
 */
export function useGenerateCapture() {
	return useMutation({
		mutationFn: ({ path, spec }: { path: string; spec: CaptureSpec }) =>
			generateCapture(path, spec),
	});
}
