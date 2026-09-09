import { LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { popScope, pushScope, useCommandHandler } from "@/commands";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConnectSettings } from "@/hooks/use-connect-settings";
import { cn } from "@/lib/utils";
import {
	useAutodetectBitrate,
	useConnectCanDevice,
	useConnectionStatus,
	useDisconnectCanDevice,
	useListCanDevices,
	useProbeProgress,
} from "@/queries/can";

const BITRATES = [
	{ value: 10_000, label: "10 kbit/s" },
	{ value: 20_000, label: "20 kbit/s" },
	{ value: 50_000, label: "50 kbit/s" },
	{ value: 100_000, label: "100 kbit/s" },
	{ value: 125_000, label: "125 kbit/s" },
	{ value: 250_000, label: "250 kbit/s" },
	{ value: 500_000, label: "500 kbit/s" },
	// The CANable firmware's `S7` is 750 kbit/s, not the 800 of the original
	// LAWICEL table; see `bitrate_code` in `src-tauri/src/can.rs`.
	{ value: 750_000, label: "750 kbit/s" },
	{ value: 1_000_000, label: "1 Mbit/s" },
];

/** The data-phase rates the slcan `Y<n>` command can express, plus classic CAN. */
const DATA_BITRATE_OPTIONS = [
	{ value: null, label: "Off (classic CAN)" },
	{ value: 2_000_000, label: "2 Mbit/s" },
	{ value: 5_000_000, label: "5 Mbit/s" },
	{ value: 8_000_000, label: "8 Mbit/s" },
];

/** Select components need a string; `null` is a real choice, not an absence. */
const CLASSIC = "classic";

function formatBitrate(value: number) {
	return (
		BITRATES.find((option) => option.value === value)?.label ??
		`${value.toLocaleString()} bit/s`
	);
}

function formatDataBitrate(value: number | null) {
	const option = DATA_BITRATE_OPTIONS.find((entry) => entry.value === value);
	if (option) return option.label;
	return value === null
		? "Off (classic CAN)"
		: `${value.toLocaleString()} bit/s`;
}

/** How a swept or configured timing reads in one line: `500 kbit/s / 2 Mbit/s`. */
function formatTiming(bitrate: number, dataBitrate: number | null) {
	return dataBitrate === null
		? formatBitrate(bitrate)
		: `${formatBitrate(bitrate)} / ${formatDataBitrate(dataBitrate)} data`;
}

export function DeviceConnectDialog() {
	const [open, setOpen] = useState(false);
	const [selectedPort, setSelectedPort] = useState<string | null>(null);
	const [bitrate, setBitrate] = useState(500_000);
	// Persisted, unlike the port and bitrate: read-only is a property of the
	// bus you are on, so it is almost always the same choice every session.
	const { settings, setSettings } = useConnectSettings();

	useCommandHandler("device.connect", () => setOpen(true));

	useEffect(() => {
		if (!open) return;
		pushScope("dialog");
		return () => popScope("dialog");
	}, [open]);

	// Transient: what the running sweep is trying, or how it ended. `null` once
	// there is nothing to say.
	const [probeStatus, setProbeStatus] = useState<string | null>(null);

	const devices = useListCanDevices(open);
	const status = useConnectionStatus();
	const connect = useConnectCanDevice();
	const disconnect = useDisconnectCanDevice();
	const autodetect = useAutodetectBitrate();

	useProbeProgress((progress) => {
		if (progress.done) return;
		setProbeStatus(
			`Trying ${formatTiming(progress.bitrate, progress.data_bitrate)} — ${
				progress.frames
			} ${progress.frames === 1 ? "frame" : "frames"}`,
		);
	});

	function handleAutodetect() {
		if (!selectedPort) return;
		setProbeStatus("Starting…");
		autodetect.mutate(
			{ portName: selectedPort, readOnly: settings.readOnly },
			{
				onSuccess: (detected) => {
					if (!detected) {
						// Deliberately left on screen: a silent bus and a wrong
						// adapter setup look identical from here, so the user has to
						// read this one.
						setProbeStatus(
							"No traffic found at any bitrate. The bus may be idle, or the adapter may not be on it.",
						);
						return;
					}
					// The backend reports an absent data bitrate as a missing key,
					// so normalize it back to the null this form is built around.
					setBitrate(detected.bitrate);
					setSettings({ dataBitrate: detected.data_bitrate ?? null });
					setProbeStatus(null);
				},
				onError: (error) => {
					setProbeStatus(
						error instanceof Error ? error.message : "Auto-detect failed",
					);
				},
			},
		);
	}

	const isConnected = Boolean(status.data);

	useEffect(() => {
		if (!selectedPort && devices.data && devices.data.length > 0) {
			const preferred =
				devices.data.find((d) => d.is_canable) ?? devices.data[0];
			setSelectedPort(preferred.port_name);
		}
	}, [devices.data, selectedPort]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Connect CAN Device</DialogTitle>
					<DialogDescription>
						Find and connect to a CANable-compatible adapter (slcan firmware).
					</DialogDescription>
				</DialogHeader>

				{status.data && (
					<Alert>
						<AlertTitle>Connected</AlertTitle>
						<AlertDescription>
							{status.data.port_name} @{" "}
							{formatTiming(
								status.data.bitrate,
								status.data.data_bitrate ?? null,
							)}
							{status.data.read_only && " · read-only"}
						</AlertDescription>
					</Alert>
				)}

				{connect.isError && (
					<Alert variant="destructive">
						<AlertTitle>Failed to connect</AlertTitle>
						<AlertDescription>
							{connect.error instanceof Error
								? connect.error.message
								: "Unknown error"}
						</AlertDescription>
					</Alert>
				)}

				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">Devices</span>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => devices.refetch()}
						disabled={devices.isFetching}
					>
						<RefreshCw
							className={cn("size-4", devices.isFetching && "animate-spin")}
						/>
						Refresh
					</Button>
				</div>

				<div className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
					{devices.data?.length ? (
						devices.data.map((device) => (
							<button
								key={device.port_name}
								type="button"
								onClick={() => setSelectedPort(device.port_name)}
								className={cn(
									"flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
									selectedPort === device.port_name && "bg-accent",
								)}
							>
								<span className="min-w-0">
									<span className="block truncate font-medium">
										{device.port_name}
									</span>
									{device.manufacturer && (
										<span className="block truncate text-muted-foreground">
											{device.manufacturer}
										</span>
									)}
								</span>
								{device.is_canable && <Badge variant="outline">CANable</Badge>}
							</button>
						))
					) : (
						<div className="px-3 py-6 text-center text-sm text-muted-foreground">
							{devices.isFetching ? "Searching…" : "No serial devices found."}
						</div>
					)}
				</div>

				{/* biome-ignore lint/a11y/noLabelWithoutControl: the Switch it wraps is the control, behind a component boundary biome cannot see through */}
				<label className="flex items-start justify-between gap-3">
					<span className="min-w-0">
						<span className="block text-sm font-medium">Read-only mode</span>
						<span className="block text-xs text-muted-foreground">
							Receive only; the adapter will not transmit or ACK. Some adapters
							stop receiving entirely in this mode, and the CANable 2.0 firmware
							stops delivering the full CAN FD traffic.
						</span>
					</span>
					<Switch
						checked={settings.readOnly}
						onCheckedChange={(checked: boolean) =>
							setSettings({ readOnly: checked })
						}
					/>
				</label>

				<div className="flex flex-wrap items-center gap-2">
					<Select
						value={String(bitrate)}
						onValueChange={(value) => value && setBitrate(Number(value))}
					>
						<SelectTrigger className="w-36" aria-label="Bitrate">
							<SelectValue placeholder="Bitrate">
								{(value: string | null) =>
									BITRATES.find((option) => String(option.value) === value)
										?.label ?? "Bitrate"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{BITRATES.map((option) => (
								<SelectItem key={option.value} value={String(option.value)}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select
						value={
							settings.dataBitrate === null
								? CLASSIC
								: String(settings.dataBitrate)
						}
						onValueChange={(value) =>
							value &&
							setSettings({
								dataBitrate: value === CLASSIC ? null : Number(value),
							})
						}
					>
						<SelectTrigger className="w-44 flex-1" aria-label="Data bitrate">
							<SelectValue placeholder="Data bitrate">
								{(value: string | null) =>
									DATA_BITRATE_OPTIONS.find(
										(option) =>
											(option.value === null
												? CLASSIC
												: String(option.value)) === value,
									)?.label ?? "Data bitrate"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{DATA_BITRATE_OPTIONS.map((option) => (
								<SelectItem
									key={option.label}
									value={option.value === null ? CLASSIC : String(option.value)}
								>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Button
						variant="outline"
						onClick={handleAutodetect}
						disabled={
							!selectedPort || autodetect.isPending || connect.isPending
						}
					>
						{autodetect.isPending ? (
							<>
								<LoaderCircle className="size-4 animate-spin" />
								Detecting…
							</>
						) : (
							"Auto"
						)}
					</Button>

					{isConnected ? (
						<Button
							variant="destructive"
							onClick={() => disconnect.mutate()}
							disabled={disconnect.isPending}
						>
							{disconnect.isPending ? "Disconnecting…" : "Disconnect"}
						</Button>
					) : (
						<Button
							onClick={() =>
								selectedPort &&
								connect.mutate({
									portName: selectedPort,
									bitrate,
									dataBitrate: settings.dataBitrate,
									readOnly: settings.readOnly,
								})
							}
							disabled={
								!selectedPort || connect.isPending || autodetect.isPending
							}
						>
							{connect.isPending ? "Connecting…" : "Connect"}
						</Button>
					)}
				</div>

				{probeStatus && (
					<p className="text-xs text-muted-foreground">{probeStatus}</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
