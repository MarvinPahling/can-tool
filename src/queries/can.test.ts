import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanFrame } from "../api/can";
import { useCanFrames } from "./can";

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

	it("hands each emitted batch to the callback", () => {
		const onFrames = vi.fn();
		renderHook(() => useCanFrames(onFrames));

		emit([frame]);

		expect(onFrames).toHaveBeenCalledWith([frame]);
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
		emit([frame]);

		// One subscription for the lifetime of the hook, and the *latest*
		// callback receives the batch — a re-subscribe would drop frames.
		expect(listen).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledWith([frame]);
		expect(first).not.toHaveBeenCalled();
	});
});
