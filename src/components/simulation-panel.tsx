import { Play, Plus, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DbcFile } from "@/api/dbc";
import type { SimulationEntryPayload } from "@/api/simulation";
import { runCommand } from "@/commands";
import { SimulationMessageCard } from "@/components/simulation-message-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSimulationEntries } from "@/hooks/use-simulation-entries";
import type { SimulationEntry } from "@/lib/simulation-entries";
import { useConnectionStatus } from "@/queries/can";
import { useCurrentDbc } from "@/queries/dbc";
import {
	useSimulationError,
	useSimulationStatus,
	useStartSimulation,
	useStopSimulation,
} from "@/queries/simulation";

/**
 * How long an edit settles before the scheduler is restarted around it.
 * Long enough that typing a three-digit period is one restart, not three.
 */
const RESTART_DEBOUNCE_MS = 300;

/**
 * Roughly what 115200-baud slcan can carry. Past this the writes queue up
 * behind the port and every message drifts late, with nothing to show for it.
 */
const FRAME_RATE_WARNING = 400;

/** The entries that will actually go on the bus, in the shape the backend takes. */
export function buildPayload(
	entries: SimulationEntry[],
	dbc: DbcFile | undefined,
): SimulationEntryPayload[] {
	if (!dbc) return [];

	return entries.flatMap((entry) => {
		if (!entry.enabled) return [];
		const message = dbc.messages.find(
			(candidate) => String(candidate.id) === entry.messageId,
		);
		// An entry whose message is gone is shown as such on its card; it is
		// not something to fail a start over.
		if (!message) return [];
		return [{ message, values: entry.values, period_ms: entry.periodMs }];
	});
}

/** Frames per second the whole board adds up to. */
export function frameRate(payload: SimulationEntryPayload[]): number {
	return payload.reduce((total, entry) => total + 1000 / entry.period_ms, 0);
}

function matchesFilter(
	entry: SimulationEntry,
	dbc: DbcFile | undefined,
	filter: string,
): boolean {
	const needle = filter.trim().toLowerCase();
	if (!needle) return true;

	const message = dbc?.messages.find(
		(candidate) => String(candidate.id) === entry.messageId,
	);
	const hex = `0x${Number(entry.messageId).toString(16)}`;
	return (
		(message?.name ?? "").toLowerCase().includes(needle) || hex.includes(needle)
	);
}

/**
 * The simulation board: a card per message, and one Start/Stop for all of them.
 *
 * The schedule lives in Rust once started, so an edit while running is a stop
 * and a fresh start rather than a mutation. That is debounced, and it resets
 * every message's phase — the cost of never having the scheduler thread take a
 * lock in its hot loop.
 */
export function SimulationPanel({
	filter,
	onFilterChange,
}: {
	filter: string;
	onFilterChange: (value: string) => void;
}) {
	const dbc = useCurrentDbc();
	const connection = useConnectionStatus();
	const { entries, addEntry } = useSimulationEntries();
	const status = useSimulationStatus();
	const startSimulation = useStartSimulation();
	const stopSimulation = useStopSimulation();

	const [liveError, setLiveError] = useState<string | null>(null);
	useSimulationError(setLiveError);

	const dbcFile = dbc.data;
	const payload = useMemo(
		() => buildPayload(entries, dbcFile),
		[entries, dbcFile],
	);
	const payloadKey = JSON.stringify(payload);

	const running = status.data?.running ?? false;
	const canSend = Boolean(connection.data) && !connection.data?.read_only;
	const rate = frameRate(payload);

	// The schedule Rust is currently running. Set when a start is issued so the
	// effect below can tell "the user just pressed Start" from "the board
	// changed underneath a running scheduler".
	const startedKey = useRef<string | null>(null);

	const start = () => {
		setLiveError(null);
		startedKey.current = payloadKey;
		startSimulation.mutate(payload);
	};

	useEffect(() => {
		if (!running) {
			startedKey.current = null;
			return;
		}
		if (startedKey.current === payloadKey) return;

		const timer = setTimeout(() => {
			startedKey.current = payloadKey;
			startSimulation.mutate(JSON.parse(payloadKey));
		}, RESTART_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [running, payloadKey, startSimulation.mutate]);

	const startError =
		startSimulation.error instanceof Error
			? startSimulation.error.message
			: null;
	const error = liveError ?? startError ?? status.data?.last_error ?? null;

	return (
		<div className="flex flex-col gap-3">
			{!dbcFile && (
				<Alert>
					<AlertTitle>No DBC loaded</AlertTitle>
					<AlertDescription className="flex flex-col items-start gap-2">
						Open a .dbc file to choose the messages to simulate.
						<Button size="sm" onClick={() => runCommand("file.open")}>
							Open DBC file
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{dbcFile && !connection.data && (
				<Alert>
					<AlertTitle>Not connected</AlertTitle>
					<AlertDescription className="flex flex-col items-start gap-2">
						Connect a CAN adapter to start the simulation. You can still compose
						messages and check how they encode.
						<Button size="sm" onClick={() => runCommand("device.connect")}>
							Connect device…
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{connection.data?.read_only && (
				<Alert>
					<AlertTitle>Connected in read-only mode</AlertTitle>
					<AlertDescription>
						The adapter is listening only and will not transmit. Reconnect with
						read-only off to simulate.
					</AlertDescription>
				</Alert>
			)}

			{error && (
				<Alert variant="destructive">
					<AlertTitle>Simulation stopped</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={!dbcFile}
					onClick={() => addEntry()}
				>
					<Plus className="size-4" />
					Add message
				</Button>

				<Button
					type="button"
					size="sm"
					disabled={
						running
							? stopSimulation.isPending
							: !canSend || payload.length === 0 || startSimulation.isPending
					}
					onClick={() => (running ? stopSimulation.mutate() : start())}
				>
					{running ? (
						<Square className="size-4" />
					) : (
						<Play className="size-4" />
					)}
					{running ? "Stop" : "Start"}
				</Button>

				<span className="text-xs text-muted-foreground">
					{running
						? `${status.data?.frame_count ?? 0} messages · ${status.data?.frames_sent ?? 0} frames sent`
						: `${payload.length} of ${entries.length} ready`}
				</span>

				{payload.length > 0 && (
					<span
						className={
							rate > FRAME_RATE_WARNING
								? "text-xs text-destructive"
								: "text-xs text-muted-foreground/70"
						}
					>
						{`≈ ${Math.round(rate)} frames/s`}
						{rate > FRAME_RATE_WARNING && " — more than the adapter can carry"}
					</span>
				)}

				<Input
					value={filter}
					onChange={(event) => onFilterChange(event.target.value)}
					placeholder="Filter by message name or id…"
					className="ml-auto max-w-xs"
				/>
			</div>

			{entries.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No messages yet. Add one to start building a simulation.
				</p>
			) : (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{entries
						.filter((entry) => matchesFilter(entry, dbcFile, filter))
						.map((entry) => (
							<SimulationMessageCard
								key={entry.id}
								entry={entry}
								messages={dbcFile?.messages ?? []}
								running={running}
								canSend={canSend}
							/>
						))}
				</div>
			)}
		</div>
	);
}
