import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMessage, makeSignal } from "@/test/fixtures";
import { useEncodedPreview } from "./use-encoded-preview";

const { encodeCanMessage } = vi.hoisted(() => ({
	encodeCanMessage: vi.fn(),
}));

vi.mock("@/api/can", () => ({ encodeCanMessage }));

const message = makeMessage({
	signals: [makeSignal({ name: "Speed", start_bit: 0, size: 8 })],
});

beforeEach(() => {
	encodeCanMessage.mockReset().mockResolvedValue([1, 0]);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useEncodedPreview", () => {
	it("encodes nothing without a message", () => {
		const { result } = renderHook(() =>
			useEncodedPreview(undefined, { Speed: 1 }),
		);

		expect(result.current).toEqual({ pending: false });
		expect(encodeCanMessage).not.toHaveBeenCalled();
	});

	it("returns the encoded frame", async () => {
		const { result } = renderHook(() =>
			useEncodedPreview(message, { Speed: 1 }, 0),
		);

		await waitFor(() => expect(result.current.bytes).toEqual([1, 0]));
		expect(result.current.pending).toBe(false);
		expect(encodeCanMessage).toHaveBeenCalledWith(message, { Speed: 1 });
	});

	it("surfaces the reason a frame does not encode", async () => {
		encodeCanMessage.mockRejectedValue(
			new Error("Signal 'Speed' value 300 is outside [0, 255]"),
		);

		const { result } = renderHook(() =>
			useEncodedPreview(message, { Speed: 300 }, 0),
		);

		await waitFor(() =>
			expect(result.current.error).toBe(
				"Signal 'Speed' value 300 is outside [0, 255]",
			),
		);
		expect(result.current.bytes).toBeUndefined();
	});

	it("debounces a burst of edits into one encode", async () => {
		vi.useFakeTimers();
		const { rerender } = renderHook(
			({ values }) => useEncodedPreview(message, values, 300),
			{ initialProps: { values: { Speed: 1 } } },
		);

		rerender({ values: { Speed: 2 } });
		rerender({ values: { Speed: 3 } });
		await vi.advanceTimersByTimeAsync(500);

		// Only the value that was still on screen when typing stopped.
		expect(encodeCanMessage).toHaveBeenCalledTimes(1);
		expect(encodeCanMessage).toHaveBeenCalledWith(message, { Speed: 3 });
	});

	it("ignores a slow response that lands after a newer one", async () => {
		// The first encode resolves *after* the second, which is exactly the
		// race that would otherwise leave a stale preview on screen.
		let resolveFirst: ((bytes: number[]) => void) | undefined;
		encodeCanMessage
			.mockImplementationOnce(
				() =>
					new Promise<number[]>((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockResolvedValueOnce([9]);

		const { result, rerender } = renderHook(
			({ values }) => useEncodedPreview(message, values, 0),
			{ initialProps: { values: { Speed: 1 } } },
		);

		await waitFor(() => expect(encodeCanMessage).toHaveBeenCalledTimes(1));
		rerender({ values: { Speed: 2 } });
		await waitFor(() => expect(result.current.bytes).toEqual([9]));

		resolveFirst?.([1]);
		// Let the late resolution actually run its `.then` before asserting;
		// without this the assertion passes whether or not it was ignored.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		expect(result.current.bytes).toEqual([9]);
	});

	it("clears the preview when the message goes away", async () => {
		const { result, rerender } = renderHook(
			({ msg }) => useEncodedPreview(msg, { Speed: 1 }, 0),
			{ initialProps: { msg: message as typeof message | undefined } },
		);

		await waitFor(() => expect(result.current.bytes).toEqual([1, 0]));
		rerender({ msg: undefined });

		expect(result.current).toEqual({ pending: false });
	});
});
