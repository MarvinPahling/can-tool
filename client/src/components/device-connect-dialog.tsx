import { RefreshCw } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
	useConnectCanDevice,
	useConnectionStatus,
	useDisconnectCanDevice,
	useListCanDevices,
} from "@/queries/can";

const BITRATES = [
	{ value: 10_000, label: "10 kbit/s" },
	{ value: 20_000, label: "20 kbit/s" },
	{ value: 50_000, label: "50 kbit/s" },
	{ value: 100_000, label: "100 kbit/s" },
	{ value: 125_000, label: "125 kbit/s" },
	{ value: 250_000, label: "250 kbit/s" },
	{ value: 500_000, label: "500 kbit/s" },
	{ value: 800_000, label: "800 kbit/s" },
	{ value: 1_000_000, label: "1 Mbit/s" },
];

export function DeviceConnectDialog() {
	const [open, setOpen] = useState(false);
	const [selectedPort, setSelectedPort] = useState<string | null>(null);
	const [bitrate, setBitrate] = useState(500_000);

	useCommandHandler("device.connect", () => setOpen(true));

	useEffect(() => {
		if (!open) return;
		pushScope("dialog");
		return () => popScope("dialog");
	}, [open]);

	const devices = useListCanDevices(open);
	const status = useConnectionStatus();
	const connect = useConnectCanDevice();
	const disconnect = useDisconnectCanDevice();

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
							{status.data.port_name} @ {status.data.bitrate.toLocaleString()}{" "}
							bit/s
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

				<div className="flex items-center gap-2">
					<Select
						value={String(bitrate)}
						onValueChange={(value) => value && setBitrate(Number(value))}
					>
						<SelectTrigger className="w-40">
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
								connect.mutate({ portName: selectedPort, bitrate })
							}
							disabled={!selectedPort || connect.isPending}
						>
							{connect.isPending ? "Connecting…" : "Connect"}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
