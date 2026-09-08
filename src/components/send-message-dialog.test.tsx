import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "@/commands";
import { createQueryClient } from "@/lib/query-client";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";
import { SendMessageDialog } from "./send-message-dialog";

const {
	encodeCanMessage,
	useConnectionStatus,
	useCurrentDbc,
	useGenerateChecksum,
	useSendCanMessage,
} = vi.hoisted(() => ({
	encodeCanMessage: vi.fn(),
	useConnectionStatus: vi.fn(),
	useCurrentDbc: vi.fn(),
	useGenerateChecksum: vi.fn(),
	useSendCanMessage: vi.fn(),
}));

vi.mock("@/queries/can", () => ({
	useConnectionStatus,
	useGenerateChecksum,
	useSendCanMessage,
}));
vi.mock("@/queries/dbc", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/queries/dbc")>()),
	useCurrentDbc,
}));
vi.mock("@/api/can", () => ({ encodeCanMessage }));

const dbc = makeDbcFile({
	messages: [
		makeMessage({
			id: 0x1a0,
			name: "Speed",
			signals: [makeSignal({ name: "Value", start_bit: 0, size: 8 })],
		}),
	],
});

function connected(readOnly: boolean) {
	return { data: { port_name: "tty", bitrate: 500_000, read_only: readOnly } };
}

async function openDialog() {
	// usePendingSendMessage reaches for the query cache.
	render(
		<QueryClientProvider client={createQueryClient()}>
			<SendMessageDialog />
		</QueryClientProvider>,
	);
	await act(async () => {
		runCommand("message.send");
	});
}

/** Adds a frame row and picks the one message in the fixture DBC. */
async function selectAMessage() {
	await userEvent.click(screen.getByRole("button", { name: /add frame/i }));
	await userEvent.click(await screen.findByRole("combobox"));
	await userEvent.click(await screen.findByRole("option", { name: /Speed/ }));
}

beforeEach(() => {
	encodeCanMessage.mockResolvedValue([0]);
	useCurrentDbc.mockReturnValue({ data: dbc });
	useGenerateChecksum.mockReturnValue({ mutate: vi.fn(), isPending: false });
	useSendCanMessage.mockReturnValue({
		mutate: vi.fn(),
		isPending: false,
		isError: false,
	});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("SendMessageDialog", () => {
	it("explains that a read-only connection cannot send", async () => {
		useConnectionStatus.mockReturnValue(connected(true));

		await openDialog();

		expect(await screen.findByText(/read-only mode/i)).toBeInTheDocument();

		// The Send button only exists once a frame row has a message selected.
		await selectAMessage();
		expect(
			await screen.findByRole("button", { name: /^send$/i }),
		).toBeDisabled();
	});

	it("leaves sending alone on a normal connection", async () => {
		useConnectionStatus.mockReturnValue(connected(false));

		await openDialog();

		expect(screen.queryByText(/read-only mode/i)).not.toBeInTheDocument();

		// Not asserting the button is *enabled* here: it also waits on the
		// debounced byte preview, which only runs after a signal value changes.
		// What this pins is that read-only is not what is holding it back.
		await selectAMessage();
		expect(
			await screen.findByRole("button", { name: /^send$/i }),
		).toBeInTheDocument();
	});
});
