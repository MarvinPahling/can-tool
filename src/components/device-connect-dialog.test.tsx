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
	autodetectMutate,
	connectMutate,
	emitProgress,
	useAutodetectBitrate,
	useConnectCanDevice,
	useConnectionStatus,
	useDisconnectCanDevice,
	useListCanDevices,
	useProbeProgress,
} = vi.hoisted(() => {
	let handler: ((progress: unknown) => void) | undefined;
	return {
		autodetectMutate: vi.fn(),
		connectMutate: vi.fn(),
		useAutodetectBitrate: vi.fn(),
		useConnectCanDevice: vi.fn(),
		useConnectionStatus: vi.fn(),
		useDisconnectCanDevice: vi.fn(),
		useListCanDevices: vi.fn(),
		useProbeProgress: vi.fn((cb: (progress: unknown) => void) => {
			handler = cb;
		}),
		emitProgress: (progress: unknown) => handler?.(progress),
	};
});

vi.mock("@/queries/can", () => ({
	useAutodetectBitrate,
	useConnectCanDevice,
	useConnectionStatus,
	useDisconnectCanDevice,
	useListCanDevices,
	useProbeProgress,
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
	useAutodetectBitrate.mockReturnValue({
		mutate: autodetectMutate,
		isPending: false,
	});
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

	describe("auto-detecting the bitrate", () => {
		it("is disabled until a port is selected", async () => {
			useListCanDevices.mockReturnValue({
				data: [],
				isFetching: false,
				refetch: vi.fn(),
			});
			await openDialog();

			expect(screen.getByRole("button", { name: /^auto$/i })).toBeDisabled();
		});

		it("sweeps the selected port with the current read-only setting", async () => {
			const toggle = await openDialog();
			await userEvent.click(toggle);

			await userEvent.click(screen.getByRole("button", { name: /^auto$/i }));

			expect(autodetectMutate).toHaveBeenCalledWith(
				{ portName: device.port_name, readOnly: true },
				expect.anything(),
			);
		});

		it("reports which bitrate is being tried and what it heard", async () => {
			await openDialog();

			await act(async () => {
				emitProgress({
					bitrate: 250_000,
					frames: 14,
					done: false,
					detected: null,
				});
			});

			expect(screen.getByText(/250 kbit\/s/)).toBeInTheDocument();
			expect(screen.getByText(/14 frames/)).toBeInTheDocument();
		});

		it("selects the detected bitrate and clears the progress line", async () => {
			autodetectMutate.mockImplementation(
				(_vars: unknown, opts: { onSuccess?: (v: number | null) => void }) =>
					opts.onSuccess?.(250_000),
			);
			await openDialog();
			await act(async () => {
				emitProgress({
					bitrate: 250_000,
					frames: 14,
					done: false,
					detected: null,
				});
			});

			await userEvent.click(screen.getByRole("button", { name: /^auto$/i }));

			expect(screen.queryByText(/14 frames/)).not.toBeInTheDocument();
			await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));
			expect(connectMutate).toHaveBeenCalledWith(
				expect.objectContaining({ bitrate: 250_000 }),
			);
		});

		it("shows a spinner and locks both buttons while sweeping", async () => {
			useAutodetectBitrate.mockReturnValue({
				mutate: autodetectMutate,
				isPending: true,
			});
			await openDialog();

			const auto = screen.getByRole("button", { name: /detecting/i });
			expect(auto).toBeDisabled();
			expect(auto.querySelector(".animate-spin")).toBeTruthy();
			// Connecting mid-sweep would fight the sweep for the port.
			expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();
		});

		it("keeps the failure on screen and leaves the bitrate alone", async () => {
			autodetectMutate.mockImplementation(
				(_vars: unknown, opts: { onSuccess?: (v: number | null) => void }) =>
					opts.onSuccess?.(null),
			);
			await openDialog();

			await userEvent.click(screen.getByRole("button", { name: /^auto$/i }));

			expect(screen.getByText(/no traffic/i)).toBeInTheDocument();
			await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));
			expect(connectMutate).toHaveBeenCalledWith(
				expect.objectContaining({ bitrate: 500_000 }),
			);
		});
	});
});
