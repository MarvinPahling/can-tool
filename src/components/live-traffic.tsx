import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runCommand } from "@/commands";
import { CaptureBar } from "@/components/capture-bar";
import { LiveMessageCard } from "@/components/live-message-card";
import { PerfHud } from "@/components/perf-hud";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VisualizeSettingsPopover } from "@/components/visualize-settings-popover";
import { useVisualizeSettings } from "@/hooks/use-visualize-settings";
import {
	applyFrames,
	type LiveMessage,
	type LiveState,
} from "@/lib/live-messages";
import { perfFlags } from "@/lib/perf-flags";
import { useCanFrames, useConnectionStatus } from "@/queries/can";
import { useCurrentDbc } from "@/queries/dbc";
import { useReplayStatus } from "@/queries/recording";

/**
 * How often decoded state is handed to React. The backend already batches to
 * ~33 events/s; this second gate keeps a busy bus from re-rendering the page
 * faster than anyone can read it.
 */
const RENDER_INTERVAL_MS = 50;

function matchesFilter(live: LiveMessage, filter: string): boolean {
	const needle = filter.trim().toLowerCase();
	if (!needle) return true;
	const hex = `0x${live.id.toString(16)}`;
	return (
		(live.message?.name ?? "").toLowerCase().includes(needle) ||
		hex.includes(needle.toLowerCase())
	);
}

/**
 * Live bus traffic: one card per CAN id, each showing the latest decoded
 * values with changes flashing in the highlight color.
 *
 * Frames are folded into a ref and flushed to React on an interval rather
 * than driving state directly, so the render rate stays bounded no matter how
 * loud the bus is.
 */
export function LiveTraffic({
	filter,
	onFilterChange,
}: {
	filter: string;
	onFilterChange: (value: string) => void;
}) {
	const dbc = useCurrentDbc();
	const status = useConnectionStatus();
	const replay = useReplayStatus();
	const { settings } = useVisualizeSettings();

	const stateRef = useRef<LiveState>(new Map());
	const dirtyRef = useRef(false);
	// Cumulative, and counted unconditionally: a rate the readout only starts
	// counting when it is switched on would be a rate of the readout.
	const receivedRef = useRef({ frames: 0, batches: 0 });
	const [messages, setMessages] = useState<LiveMessage[]>([]);

	const dbcFile = dbc.data;
	useCanFrames((frames) => {
		stateRef.current = applyFrames(stateRef.current, frames, dbcFile, settings);
		dirtyRef.current = true;
		receivedRef.current.frames += frames.length;
		receivedRef.current.batches += 1;
	});

	const sample = useCallback(
		() => ({
			ids: stateRef.current.size,
			frames: receivedRef.current.frames,
			batches: receivedRef.current.batches,
		}),
		[],
	);

	// A newly loaded DBC decodes the same ids differently, so nothing decoded
	// under the old one should survive.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetting is the point of watching dbcFile
	useEffect(() => {
		stateRef.current = new Map();
		setMessages([]);
	}, [dbcFile]);

	useEffect(() => {
		const id = setInterval(() => {
			if (!dirtyRef.current) return;
			dirtyRef.current = false;
			setMessages([...stateRef.current.values()].sort((a, b) => a.id - b.id));
		}, RENDER_INTERVAL_MS);
		return () => clearInterval(id);
	}, []);

	const visible = useMemo(
		() => messages.filter((live) => matchesFilter(live, filter)),
		[messages, filter],
	);

	// A replay is a frame source in its own right — that is the whole point of
	// it — so "connected" here means "something is producing frames", not
	// "an adapter is plugged in".
	const hasSource = Boolean(status.data) || Boolean(replay.data?.running);

	const guard = !dbcFile ? (
		<Alert>
			<AlertTitle>No DBC loaded</AlertTitle>
			<AlertDescription className="flex flex-col items-start gap-2">
				Open a .dbc file so incoming frames can be decoded.
				<Button size="sm" onClick={() => runCommand("file.open")}>
					Open DBC file
				</Button>
			</AlertDescription>
		</Alert>
	) : !hasSource ? (
		<Alert>
			<AlertTitle>No frames arriving</AlertTitle>
			<AlertDescription className="flex flex-col items-start gap-2">
				Connect a CAN adapter, or replay a recorded capture with the controls
				above.
				<Button size="sm" onClick={() => runCommand("device.connect")}>
					Connect device…
				</Button>
			</AlertDescription>
		</Alert>
	) : null;

	// Rendered above the guard, not inside it: replaying a capture is how you
	// get frames without an adapter, so the control that starts one cannot be
	// hidden behind "not connected".
	const hud = perfFlags.hud ? <PerfHud sample={sample} /> : null;

	if (guard) {
		return (
			<div className="flex flex-col gap-3">
				<CaptureBar />
				{guard}
				{hud}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<CaptureBar />
			<div className="flex items-center gap-2">
				<Input
					value={filter}
					onChange={(event) => onFilterChange(event.target.value)}
					placeholder="Filter by message name or id…"
					className="max-w-xs"
				/>
				<span className="text-xs text-muted-foreground">
					{`${messages.length} messages`}
				</span>
				<div className="ml-auto">
					<VisualizeSettingsPopover />
				</div>
			</div>

			{messages.length === 0 ? (
				<p className="text-sm text-muted-foreground">Waiting for traffic…</p>
			) : (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{visible.map((live) => (
						<LiveMessageCard key={live.id} live={live} settings={settings} />
					))}
				</div>
			)}
			{hud}
		</div>
	);
}
