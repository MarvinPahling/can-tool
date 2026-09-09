import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";
import { DbcTable } from "./dbc-table";

vi.mock("@/hooks/use-add-to-simulation", () => ({
	useAddToSimulation: () => vi.fn(),
}));

const dbc = makeDbcFile({
	messages: [
		makeMessage({
			id: 0x1a0,
			name: "Speed",
			signals: [makeSignal({ name: "SpeedValue", start_bit: 0, size: 8 })],
		}),
		makeMessage({
			id: 0x2b0,
			name: "Gear",
			signals: [makeSignal({ name: "GearPosition", start_bit: 0, size: 4 })],
		}),
	],
});

function renderTable() {
	return render(
		<DbcTable dbc={dbc} globalFilter="" onGlobalFilterChange={() => {}} />,
	);
}

function expandAll() {
	return screen.getByRole("button", { name: /expand all/i });
}

function collapseAll() {
	return screen.getByRole("button", { name: /collapse all/i });
}

describe("DbcTable expand and collapse all", () => {
	it("starts with every message expanded", () => {
		renderTable();

		expect(screen.getByText("SpeedValue")).toBeInTheDocument();
		expect(screen.getByText("GearPosition")).toBeInTheDocument();
		// Nothing left to expand.
		expect(expandAll()).toBeDisabled();
		expect(collapseAll()).toBeEnabled();
	});

	it("hides every message's signals at once", async () => {
		renderTable();

		await userEvent.click(collapseAll());

		expect(screen.queryByText("SpeedValue")).toBeNull();
		expect(screen.queryByText("GearPosition")).toBeNull();
		// The messages themselves stay; only their signals fold away.
		expect(screen.getByText("Speed")).toBeInTheDocument();
		expect(screen.getByText("Gear")).toBeInTheDocument();
		expect(collapseAll()).toBeDisabled();
		expect(expandAll()).toBeEnabled();
	});

	it("brings every message's signals back at once", async () => {
		renderTable();

		await userEvent.click(collapseAll());
		await userEvent.click(expandAll());

		expect(screen.getByText("SpeedValue")).toBeInTheDocument();
		expect(screen.getByText("GearPosition")).toBeInTheDocument();
	});

	it("works from a partly collapsed table", async () => {
		renderTable();

		// Fold one message by its own row expander, leaving the other open.
		await userEvent.click(
			screen.getAllByRole("button", { name: "Collapse row" })[0],
		);
		expect(screen.queryByText("SpeedValue")).toBeNull();
		expect(screen.getByText("GearPosition")).toBeInTheDocument();

		// Neither button is a no-op in a mixed state.
		expect(expandAll()).toBeEnabled();
		expect(collapseAll()).toBeEnabled();

		await userEvent.click(expandAll());

		expect(screen.getByText("SpeedValue")).toBeInTheDocument();
		expect(screen.getByText("GearPosition")).toBeInTheDocument();
	});

	it("leaves the per-row expanders working afterwards", async () => {
		renderTable();

		await userEvent.click(collapseAll());
		await userEvent.click(
			screen.getAllByRole("button", { name: "Expand row" })[0],
		);

		// One message back open, the other still folded.
		expect(screen.getByText("SpeedValue")).toBeInTheDocument();
		expect(screen.queryByText("GearPosition")).toBeNull();
	});
});
