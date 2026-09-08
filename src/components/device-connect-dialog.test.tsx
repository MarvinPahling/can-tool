import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "@/commands";
import {
	connectSettingsStore,
	DEFAULT_CONNECT_SETTINGS,
} from "@/lib/connect-settings";
import { DeviceConnectDialog } from "./device-connect-dialog";

const {
	connectMutate,
	useConnectCanDevice,
	useConnectionStatus,
	useDisconnectCanDevice,
	useListCanDevices,
} = vi.hoisted(() => ({
	connectMutate: vi.fn(),
	useConnectCanDevice: vi.fn(),
	useConnectionStatus: vi.fn(),
	useDisconnectCanDevice: vi.fn(),
	useListCanDevices: vi.fn(),
}));

vi.mock("@/queries/can", () => ({
	useConnectCanDevice,
	useConnectionStatus,
	useDisconnectCanDevice,
	useListCanDevices,
}));

const device = {
	port_name: "/dev/tty.usbmodem1",
	manufacturer: "CANable",
	vid: 0xad50,
	pid: 0x60c4,
	is_canable: true,
};

/** The dialog is only reachable through the "device.connect" command. */
async function openDialog() {
	render(<DeviceConnectDialog />);
	await act(async () => {
		runCommand("device.connect");
	});
	return screen.findByRole("switch", { name: /read-only/i });
}

beforeEach(() => {
	useListCanDevices.mockReturnValue({
		data: [device],
		isFetching: false,
		refetch: vi.fn(),
	});
	useConnectionStatus.mockReturnValue({ data: null });
	useConnectCanDevice.mockReturnValue({
		mutate: connectMutate,
		isPending: false,
		isError: false,
	});
	useDisconnectCanDevice.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

afterEach(() => {
	connectSettingsStore.setState(() => ({ ...DEFAULT_CONNECT_SETTINGS }));
	localStorage.clear();
	vi.clearAllMocks();
});

describe("DeviceConnectDialog", () => {
	it("connects in normal mode by default", async () => {
		const toggle = await openDialog();
		expect(toggle).not.toBeChecked();

		await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));

		expect(connectMutate).toHaveBeenCalledWith({
			portName: device.port_name,
			bitrate: 500_000,
			readOnly: false,
		});
	});

	it("connects read-only once the toggle is on", async () => {
		const toggle = await openDialog();

		await userEvent.click(toggle);
		await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));

		expect(connectMutate).toHaveBeenCalledWith({
			portName: device.port_name,
			bitrate: 500_000,
			readOnly: true,
		});
	});

	it("remembers the toggle across a remount", async () => {
		const toggle = await openDialog();
		await userEvent.click(toggle);

		expect(connectSettingsStore.state.readOnly).toBe(true);
		expect(
			JSON.parse(localStorage.getItem("can-tool:connect-settings") ?? "{}")
				.readOnly,
		).toBe(true);

		screen.getByRole("switch", { name: /read-only/i }).remove();
		const remounted = await openDialog();
		expect(remounted).toBeChecked();
	});

	it("says so in the status alert when connected read-only", async () => {
		useConnectionStatus.mockReturnValue({
			data: { port_name: device.port_name, bitrate: 500_000, read_only: true },
		});
		await openDialog();

		// Scoped to the alert: the toggle's own label also says "read-only".
		const alert = screen.getByText(/500,000 bit\/s/);
		expect(alert.textContent).toMatch(/read-only/i);
		expect(screen.getByRole("button", { name: /disconnect/i })).toBeVisible();
	});

	it("does not mention read-only when connected normally", async () => {
		useConnectionStatus.mockReturnValue({
			data: { port_name: device.port_name, bitrate: 500_000, read_only: false },
		});
		render(<DeviceConnectDialog />);
		await act(async () => {
			runCommand("device.connect");
		});

		const alert = await screen.findByText(/500,000 bit\/s/);
		expect(alert.textContent).not.toMatch(/read-only/i);
	});
});
