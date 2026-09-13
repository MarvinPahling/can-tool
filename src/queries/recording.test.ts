import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query-client";
import type { RecordingStatus, ReplayStatus } from "../api/recording";
import {
	recordingKeys,
	replayKeys,
	useGenerateCapture,
	useRecordingStatus,
	useReplayStatus,
	useStartRecording,
	useStartReplay,
	useStopRecording,
	useStopReplay,
} from "./recording";

const {
	generateCapture,
	recordingStatus,
	replayStatus,
	startRecording,
	startReplay,
	stopRecording,
	stopReplay,
} = vi.hoisted(() => ({
	generateCapture: vi.fn(),
	recordingStatus: vi.fn(),
	replayStatus: vi.fn(),
	startRecording: vi.fn(),
	startReplay: vi.fn(),
	stopRecording: vi.fn(),
	stopReplay: vi.fn(),
}));

vi.mock("../api/recording", async (importOriginal) => ({
	...(await importOriginal<typeof import("../api/recording")>()),
	generateCapture,
	recordingStatus,
	replayStatus,
	startRecording,
	startReplay,
	stopRecording,
	stopReplay,
}));

const idleRecording: RecordingStatus = {
	recording: false,
	path: null,
	frames: 0,
	bytes: 0,
	stopped_reason: null,
};

const idleReplay: ReplayStatus = {
	running: false,
	path: null,
	frames_total: 0,
	frames_emitted: 0,
	loops: 0,
	last_error: null,
};

function withClient() {
	const queryClient = createQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client: queryClient }, children);
	return { queryClient, wrapper };
}

const { wrapper } = withClient();

beforeEach(() => {
	recordingStatus.mockReset().mockResolvedValue(idleRecording);
	replayStatus.mockReset().mockResolvedValue(idleReplay);
	startRecording.mockReset().mockResolvedValue(undefined);
	stopRecording
		.mockReset()
		.mockResolvedValue({ path: "/tmp/c.csv", frames: 1, bytes: 1 });
	startReplay.mockReset().mockResolvedValue(undefined);
	stopReplay.mockReset().mockResolvedValue(undefined);
	generateCapture
		.mockReset()
		.mockResolvedValue({ path: "/tmp/s.csv", frames: 1, bytes: 1 });
});

describe("useRecordingStatus", () => {
	it("reads the recorder status", async () => {
		const running: RecordingStatus = {
			recording: true,
			path: "/tmp/capture.csv",
			frames: 4_212,
			bytes: 300_000,
			stopped_reason: null,
		};
		recordingStatus.mockResolvedValue(running);

		const { result } = renderHook(() => useRecordingStatus(), { wrapper });

		await waitFor(() => expect(result.current.data).toEqual(running));
	});
});

describe("useReplayStatus", () => {
	it("reads the replay status", async () => {
		const running: ReplayStatus = {
			running: true,
			path: "/tmp/capture.csv",
			frames_total: 662,
			frames_emitted: 120,
			loops: 0,
			last_error: null,
		};
		replayStatus.mockResolvedValue(running);

		const { result } = renderHook(() => useReplayStatus(), { wrapper });

		await waitFor(() => expect(result.current.data).toEqual(running));
	});
});

describe("useStartRecording", () => {
	it("starts at the chosen path", async () => {
		const { result } = renderHook(() => useStartRecording(), { wrapper });

		await act(async () => {
			await result.current.mutateAsync("/tmp/capture.csv");
		});

		expect(startRecording).toHaveBeenCalledWith("/tmp/capture.csv");
	});

	it("refreshes the status even when starting failed", async () => {
		startRecording.mockRejectedValue(new Error("Cannot write /nope"));
		const { queryClient, wrapper } = withClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useStartRecording(), { wrapper });

		await act(async () => {
			await result.current.mutateAsync("/nope").catch(() => {});
		});

		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({
				queryKey: recordingKeys.status,
			}),
		);
	});
});

describe("useStopRecording", () => {
	it("returns the summary so the UI can say what it wrote", async () => {
		const { result } = renderHook(() => useStopRecording(), { wrapper });

		let summary: unknown;
		await act(async () => {
			summary = await result.current.mutateAsync();
		});

		expect(summary).toEqual({ path: "/tmp/c.csv", frames: 1, bytes: 1 });
	});
});

describe("useStartReplay", () => {
	it("passes the path and options through", async () => {
		const { result } = renderHook(() => useStartReplay(), { wrapper });

		await act(async () => {
			await result.current.mutateAsync({
				path: "/tmp/capture.csv",
				options: { speed: 5, repeat: true },
			});
		});

		expect(startReplay).toHaveBeenCalledWith("/tmp/capture.csv", {
			speed: 5,
			repeat: true,
		});
	});

	it("refreshes the replay status even when starting failed", async () => {
		startReplay.mockRejectedValue(new Error("Line 12: not hex"));
		const { queryClient, wrapper } = withClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useStartReplay(), { wrapper });

		await act(async () => {
			await result.current
				.mutateAsync({
					path: "/bad.csv",
					options: { speed: 1, repeat: false },
				})
				.catch(() => {});
		});

		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({ queryKey: replayKeys.status }),
		);
	});
});

describe("useStopReplay", () => {
	it("stops the replay", async () => {
		const { result } = renderHook(() => useStopReplay(), { wrapper });

		await act(async () => {
			await result.current.mutateAsync();
		});

		expect(stopReplay).toHaveBeenCalled();
	});
});

describe("useGenerateCapture", () => {
	it("writes a capture at the chosen path", async () => {
		const { result } = renderHook(() => useGenerateCapture(), { wrapper });
		const spec = {
			seed: 1,
			duration_ms: 1_000,
			id_count: 20_000,
			extended: true,
			cycle_ms: 1_000,
			fd_ratio: 0,
			brs_ratio: 0,
			churn: 1,
			from_dbc: null,
		};

		await act(async () => {
			await result.current.mutateAsync({ path: "/tmp/s.csv", spec });
		});

		expect(generateCapture).toHaveBeenCalledWith("/tmp/s.csv", spec);
	});
});
