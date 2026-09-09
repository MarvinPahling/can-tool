import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeSignal } from "@/test/fixtures";
import { SignalValueGrid } from "./signal-value-grid";

const speed = makeSignal({ name: "Speed", start_bit: 0, size: 8 });
const flag = makeSignal({ name: "Flag", start_bit: 8, size: 1 });

describe("SignalValueGrid", () => {
	it("renders a switch for a one-bit signal and a number input otherwise", () => {
		render(
			<SignalValueGrid
				signals={[speed, flag]}
				values={{ Speed: 10, Flag: 0 }}
				onChange={() => {}}
			/>,
		);

		expect(screen.getByRole("switch")).toBeInTheDocument();
		expect(screen.getByRole("spinbutton")).toHaveValue(10);
	});

	it("reports a typed number", async () => {
		const onChange = vi.fn();
		render(
			<SignalValueGrid
				signals={[speed]}
				values={{ Speed: 1 }}
				onChange={onChange}
			/>,
		);

		await userEvent.type(screen.getByRole("spinbutton"), "2");

		// Typed onto the existing "1", and reported as a number rather than text.
		expect(onChange).toHaveBeenLastCalledWith("Speed", 12);
	});

	it("reports a toggled flag as one or zero", async () => {
		const onChange = vi.fn();
		render(
			<SignalValueGrid
				signals={[flag]}
				values={{ Flag: 0 }}
				onChange={onChange}
			/>,
		);

		await userEvent.click(screen.getByRole("switch"));

		expect(onChange).toHaveBeenCalledWith("Flag", 1);
	});

	it("marks an out-of-range value and names the bounds", () => {
		render(
			<SignalValueGrid
				signals={[speed]}
				values={{ Speed: 300 }}
				onChange={() => {}}
			/>,
		);

		expect(screen.getByRole("spinbutton")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
		expect(screen.getByText("Must be between 0 and 255")).toBeInTheDocument();
	});

	it("marks a signal with no value at all as required", () => {
		render(
			<SignalValueGrid signals={[speed]} values={{}} onChange={() => {}} />,
		);

		expect(screen.getByText("Required")).toBeInTheDocument();
	});

	it("disables every control when disabled", () => {
		render(
			<SignalValueGrid
				signals={[speed, flag]}
				values={{ Speed: 1, Flag: 0 }}
				onChange={() => {}}
				disabled
			/>,
		);

		expect(screen.getByRole("spinbutton")).toBeDisabled();
		// Base UI's Switch is a span with the real input hidden behind it, so
		// it reports being disabled through aria rather than the attribute.
		expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
	});
});
