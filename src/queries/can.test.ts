import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanFrame, ProbeProgress } from "../api/can";
import { useCanError, useCanFrames, useProbeProgress } from "./can";

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

vi.mock("@tauri-apps/api/event", () => ({ listen }));

const frame: CanFrame = {
	id: 0x1a0,
	extended: false,
	fd: false,
	bitrate_switch: false,
	remote: false,
	data: [0xde, 0xad],
	timestamp_ms: 1,
};

beforeEach(() => {
	listen.mockClear();
	unlisten.mockClear();
});

describe("useCanFrames", () => {
	it("subscribes to the can-frames event once on mount", () => {
		renderHook(() => useCanFrames(() => {}));

		expect(listen).toHaveBeenCalledTimes(1);
		expect(listen.mock.calls[0]?.[0]).toBe("can-frames");
	});

	it("unpacks the wire tuple into a readable batch", () => {
		// The event carries `[frames, dropped]` because a named struct at the
		// Rust emit site makes typegen generate a schema that does not compile.
		// Consumers should never see that.
		const onBatch = vi.fn();
		renderHook(() => useCanFrames(onBatch));

		emit([[frame], 12]);

		expect(onBatch).toHaveBeenCalledWith({ frames: [frame], dropped: 12 });
	});

	it("unlistens on unmount", async () => {
		const { unmount } = renderHook(() => useCanFrames(() => {}));
		// `listen` resolves asynchronously; let it settle before unmounting.
		await vi.waitFor(() => expect(listen).toHaveBeenCalled());

		unmount();

		await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
	});

	it("does not resubscribe when the callback identity changes", () => {
		const first = vi.fn();
		const second = vi.fn();
		const { rerender } = renderHook(({ cb }) => useCanFrames(cb), {
			initialProps: { cb: first },
		});

		rerender({ cb: second });
		emit([[frame], 0]);

		// One subscription for the lifetime of the hook, and the *latest*
		// callback receives the batch — a re-subscribe would drop frames.
		expect(listen).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledWith({ frames: [frame], dropped: 0 });
		expect(first).not.toHaveBeenCalled();
	});
});

const progress: ProbeProgress = {
	bitrate: 250_000,
	data_bitrate: 2_000_000,
	frames: 14,
	done: false,
	detected: null,
};

describe("useProbeProgress", () => {
	it("subscribes to the can-probe event once on mount", () => {
		renderHook(() => useProbeProgress(() => {}));

		expect(listen).toHaveBeenCalledTimes(1);
		expect(listen.mock.calls[0]?.[0]).toBe("can-probe");
	});

	it("hands each emitted update to the callback", () => {
		const onProgress = vi.fn();
		renderHook(() => useProbeProgress(onProgress));

		emit(progress);

		expect(onProgress).toHaveBeenCalledWith(progress);
	});

	it("unlistens on unmount", async () => {
		const { unmount } = renderHook(() => useProbeProgress(() => {}));
		await vi.waitFor(() => expect(listen).toHaveBeenCalled());

		unmount();

		await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
	});

	it("does not resubscribe when the callback identity changes", () => {
		const first = vi.fn();
		const second = vi.fn();
		const { rerender } = renderHook(({ cb }) => useProbeProgress(cb), {
			initialProps: { cb: first },
		});

		rerender({ cb: second });
		emit(progress);

		expect(listen).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledWith(progress);
		expect(first).not.toHaveBeenCalled();
	});
});

describe("useCanError", () => {
	it("subscribes to the can-error event once on mount", () => {
		renderHook(() => useCanError(() => {}));

		expect(listen).toHaveBeenCalledTimes(1);
		expect(listen.mock.calls[0]?.[0]).toBe("can-error");
	});

	it("hands the rejection count to the callback", () => {
		const onRejections = vi.fn();
		renderHook(() => useCanError(onRejections));

		emit({ rejections: 7 });

		expect(onRejections).toHaveBeenCalledWith({ rejections: 7 });
	});

	it("unlistens on unmount", async () => {
		const { unmount } = renderHook(() => useCanError(() => {}));
		await vi.waitFor(() => expect(listen).toHaveBeenCalled());

		unmount();

		await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
	});
});
