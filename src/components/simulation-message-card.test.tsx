import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addSimulationEntry,
	clearSimulationEntries,
	simulationEntriesStore,
	updateSimulationEntry,
} from "@/lib/simulation-entries";
import { makeMessage, makeSignal } from "@/test/fixtures";
import { SimulationMessageCard } from "./simulation-message-card";

const { encodeCanMessage, useGenerateChecksum, useSendCanMessage, send } =
	vi.hoisted(() => ({
		encodeCanMessage: vi.fn(),
		useGenerateChecksum: vi.fn(),
		useSendCanMessage: vi.fn(),
		send: vi.fn(),
	}));

vi.mock("@/api/can", () => ({ encodeCanMessage }));
vi.mock("@/queries/can", () => ({ useGenerateChecksum, useSendCanMessage }));

const speed = makeMessage({
	id: 0x1a0,
	name: "Speed",
	size: 2,
	signals: [
		makeSignal({ name: "Value", start_bit: 0, size: 8 }),
		makeSignal({ name: "Checksum", start_bit: 8, size: 8 }),
	],
});
const gear = makeMessage({
	id: 0x2b0,
	name: "Gear",
	signals: [makeSignal({ name: "Position", start_bit: 0, size: 4 })],
});
const messages = [speed, gear];

/** Adds an entry to the store and returns it, since the card is store-backed. */
function seedEntry(messageId: string) {
	const id = addSimulationEntry(messageId);
	return () =>
		simulationEntriesStore.state.find((entry) => entry.id === id) ?? never();
}

function never(): never {
	throw new Error("entry vanished from the store");
}

function renderCard(
	entryOf: () => ReturnType<typeof seedEntry> extends () => infer T ? T : never,
	{ running = false, canSend = true } = {},
) {
	return render(
		<SimulationMessageCard
			entry={entryOf()}
			messages={messages}
			running={running}
			canSend={canSend}
		/>,
	);
}

beforeEach(() => {
	encodeCanMessage.mockResolvedValue([0x11, 0x22]);
	useGenerateChecksum.mockReturnValue({
		mutateAsync: vi.fn(),
		isPending: false,
		isError: false,
	});
	useSendCanMessage.mockReturnValue({ mutate: send, isPending: false });
});

afterEach(() => {
	clearSimulationEntries();
	localStorage.clear();
	vi.clearAllMocks();
});

describe("SimulationMessageCard", () => {
	it("renders one control per signal of the selected message", () => {
		const entry = seedEntry(String(speed.id));
		renderCard(entry);

		// "Speed" appears twice — the card title and the message picker — so
		// the id is the unambiguous thing to assert on.
		expect(screen.getByText("0x1A0")).toBeInTheDocument();
		expect(screen.getByText("2 bytes")).toBeInTheDocument();
		expect(screen.getAllByRole("spinbutton")).toHaveLength(
			// One per signal, plus the period.
			speed.signals.length + 1,
		);
	});

	it("resets the values and checksum when a different message is picked", async () => {
		const entry = seedEntry(String(speed.id));
		updateSimulationEntry(entry().id, {
			values: { Value: 9 },
			checksumSignal: "Checksum",
		});
		renderCard(entry);

		await userEvent.click(screen.getByLabelText("Message"));
		await userEvent.click(await screen.findByRole("option", { name: "Gear" }));

		// Carrying Value over would leave a signal the new message has no field
		// for, silently encoded into whatever bits happen to overlap.
		expect(entry().values).toEqual({ Position: 0 });
		expect(entry().checksumSignal).toBe("");
	});

	it("seeds a newly picked message so it encodes straight away", async () => {
		const entry = seedEntry("");
		renderCard(entry);

		await userEvent.click(screen.getByLabelText("Message"));
		await userEvent.click(await screen.findByRole("option", { name: "Speed" }));

		expect(entry().values).toEqual({ Value: 0, Checksum: 0 });
	});

	it("writes a signal value through to the store", async () => {
		const entry = seedEntry(String(gear.id));
		updateSimulationEntry(entry().id, { values: { Position: 1 } });
		renderCard(entry);

		await userEvent.type(
			screen.getByRole("spinbutton", { name: /Position/ }),
			"2",
		);

		expect(entry().values.Position).toBe(12);
	});

	it("writes the period through to the store", async () => {
		const entry = seedEntry(String(gear.id));
		renderCard(entry);

		const period = screen.getByRole("spinbutton", { name: /period/i });
		await userEvent.clear(period);
		await userEvent.type(period, "20");

		expect(entry().periodMs).toBe(20);
	});

	it("toggles enabled through to the store", async () => {
		const entry = seedEntry(String(gear.id));
		renderCard(entry);

		await userEvent.click(screen.getByRole("switch", { name: "Enabled" }));

		expect(entry().enabled).toBe(false);
	});

	it("sends the entry's values once", async () => {
		const entry = seedEntry(String(gear.id));
		updateSimulationEntry(entry().id, { values: { Position: 3 } });
		renderCard(entry);

		const button = await screen.findByRole("button", { name: /send once/i });
		await vi.waitFor(() => expect(button).toBeEnabled());
		await userEvent.click(button);

		expect(send).toHaveBeenCalledWith({
			message: gear,
			values: { Position: 3 },
		});
	});

	it("cannot send without a writable connection", () => {
		const entry = seedEntry(String(gear.id));
		renderCard(entry, { canSend: false });

		expect(screen.getByRole("button", { name: /send once/i })).toBeDisabled();
	});

	it("cannot send a frame that does not encode", async () => {
		encodeCanMessage.mockRejectedValue(
			new Error("Signal 'Position' value 99 is outside [0, 15]"),
		);
		const entry = seedEntry(String(gear.id));
		updateSimulationEntry(entry().id, { values: { Position: 99 } });
		renderCard(entry);

		expect(
			await screen.findByText("Signal 'Position' value 99 is outside [0, 15]"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /send once/i })).toBeDisabled();
	});

	it("shows the encoded frame", async () => {
		const entry = seedEntry(String(speed.id));
		renderCard(entry);

		expect(await screen.findByText("11 22")).toBeInTheDocument();
	});

	it("says so when the entry outlived its DBC", () => {
		const entry = seedEntry("1911");
		renderCard(entry);

		expect(screen.getByText("Not in DBC")).toBeInTheDocument();
		expect(screen.getByText("Unknown message")).toBeInTheDocument();
		// Nothing below the header: there are no signals to dial in.
		expect(screen.queryByRole("button", { name: /send once/i })).toBeNull();
	});

	it("marks an enabled message as sending while the scheduler runs", () => {
		const entry = seedEntry(String(gear.id));
		renderCard(entry, { running: true });

		expect(screen.getByText("Sending")).toBeInTheDocument();
	});

	it("does not mark a disabled message as sending", () => {
		const entry = seedEntry(String(gear.id));
		updateSimulationEntry(entry().id, { enabled: false });
		renderCard(entry, { running: true });

		expect(screen.queryByText("Sending")).toBeNull();
	});

	it("removes the entry from the store", async () => {
		const entry = seedEntry(String(gear.id));
		renderCard(entry);

		await userEvent.click(
			screen.getByRole("button", { name: /remove message/i }),
		);

		expect(simulationEntriesStore.state).toHaveLength(0);
	});
});
