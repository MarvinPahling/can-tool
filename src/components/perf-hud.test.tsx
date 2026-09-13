import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerfHud } from "./perf-hud";

beforeEach(() => {
	vi.useFakeTimers();
	document.getAnimations = vi.fn(
		() => [],
	) as unknown as typeof document.getAnimations;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("PerfHud", () => {
	it("renders nothing until the first sample lands", () => {
		render(<PerfHud sample={() => ({ ids: 0, frames: 0, batches: 0 })} />);
		expect(screen.queryByText("dom nodes")).not.toBeInTheDocument();
	});

	it("reports what the live view is holding", () => {
		render(<PerfHud sample={() => ({ ids: 1_234, frames: 0, batches: 0 })} />);

		act(() => {
			vi.advanceTimersByTime(1_000);
		});

		expect(screen.getByText("1,234")).toBeInTheDocument();
		expect(screen.getByText("animations")).toBeInTheDocument();
	});

	it("turns cumulative counters into rates", () => {
		let frames = 0;
		render(<PerfHud sample={() => ({ ids: 0, frames, batches: 0 })} />);

		frames = 3_000;
		act(() => {
			vi.advanceTimersByTime(1_000);
		});

		expect(screen.getByText("3,000")).toBeInTheDocument();
	});

	it("samples once a second, not on every render", () => {
		// An instrument that costs as much as the thing it measures is not an
		// instrument; this is the assertion that keeps it cheap.
		const sample = vi.fn(() => ({ ids: 0, frames: 0, batches: 0 }));
		render(<PerfHud sample={sample} />);

		act(() => {
			vi.advanceTimersByTime(3_000);
		});

		// One call to seed the baseline, then one per elapsed second.
		expect(sample).toHaveBeenCalledTimes(4);
	});

	it("stops sampling when it unmounts", () => {
		const sample = vi.fn(() => ({ ids: 0, frames: 0, batches: 0 }));
		const { unmount } = render(<PerfHud sample={sample} />);

		unmount();
		const calls = sample.mock.calls.length;
		act(() => {
			vi.advanceTimersByTime(5_000);
		});

		expect(sample).toHaveBeenCalledTimes(calls);
	});
});
