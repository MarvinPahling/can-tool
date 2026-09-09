import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MIN_PERIOD_MS } from "@/lib/period";
import { PeriodInput } from "./period-input";

/** A controlled host, since the input reports milliseconds and shows them back. */
function Host({
	initialMs,
	onChange,
}: {
	initialMs: number;
	onChange?: (ms: number) => void;
}) {
	const [ms, setMs] = useState(initialMs);
	return (
		<PeriodInput
			valueMs={ms}
			onChange={(next) => {
				setMs(next);
				onChange?.(next);
			}}
		/>
	);
}

function period() {
	return screen.getByRole("spinbutton", { name: /period/i });
}

describe("PeriodInput", () => {
	it("shows a sub-second period in milliseconds", () => {
		render(<Host initialMs={20} />);

		expect(period()).toHaveValue(20);
		expect(screen.getByLabelText(/period unit/i)).toHaveTextContent("ms");
	});

	it("shows a whole-second period in seconds", () => {
		render(<Host initialMs={1000} />);

		expect(period()).toHaveValue(1);
		expect(screen.getByLabelText(/period unit/i)).toHaveTextContent("s");
	});

	it("reports what was typed, in milliseconds", async () => {
		const onChange = vi.fn();
		render(<Host initialMs={20} onChange={onChange} />);

		await userEvent.clear(period());
		await userEvent.type(period(), "50");

		expect(onChange).toHaveBeenLastCalledWith(50);
	});

	it("converts rather than reinterprets when the unit changes", async () => {
		const onChange = vi.fn();
		render(<Host initialMs={20} onChange={onChange} />);

		await userEvent.click(screen.getByLabelText(/period unit/i));
		await userEvent.click(await screen.findByRole("option", { name: "s" }));

		// 20 ms is 0.02 s. Reading the 20 as seconds instead would silently
		// slow the message by a factor of a thousand.
		expect(period()).toHaveValue(0.02);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("keeps reporting milliseconds once the unit is seconds", async () => {
		const onChange = vi.fn();
		render(<Host initialMs={1000} onChange={onChange} />);

		await userEvent.clear(period());
		await userEvent.type(period(), "2");

		expect(onChange).toHaveBeenLastCalledWith(2000);
	});

	it("clamps a period below the floor and shows the clamped value", async () => {
		const onChange = vi.fn();
		render(<Host initialMs={20} onChange={onChange} />);

		await userEvent.clear(period());
		await userEvent.type(period(), "0");
		await userEvent.tab();

		expect(onChange).toHaveBeenLastCalledWith(MIN_PERIOD_MS);
		expect(period()).toHaveValue(MIN_PERIOD_MS);
	});

	it("lets the field be emptied without reporting a period", async () => {
		const onChange = vi.fn();
		render(<Host initialMs={20} onChange={onChange} />);

		await userEvent.clear(period());

		expect(period()).toHaveValue(null);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("shows the rate the period works out to", () => {
		const { rerender } = render(
			<PeriodInput valueMs={20} onChange={() => {}} />,
		);
		expect(screen.getByText("= 50 Hz")).toBeInTheDocument();

		rerender(<PeriodInput valueMs={1000} onChange={() => {}} />);
		expect(screen.getByText("= 1.0 Hz")).toBeInTheDocument();
	});
});
