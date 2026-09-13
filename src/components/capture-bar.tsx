import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { Circle, FileDown, FolderOpen, Square, Wand2 } from "lucide-react";
import { useState } from "react";
import type { CaptureSpec } from "@/api/recording";
import { GenerateCaptureDialog } from "@/components/generate-capture-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	defaultCaptureFilename,
	formatBytes,
	SPEED_OPTIONS,
} from "@/lib/capture-file";
import { useConnectionStatus } from "@/queries/can";
import { useCurrentDbc } from "@/queries/dbc";
import {
	useGenerateCapture,
	useRecordingStatus,
	useReplayStatus,
	useStartRecording,
	useStartReplay,
	useStopRecording,
	useStopReplay,
} from "@/queries/recording";

const CSV_FILTER = [{ name: "CAN capture", extensions: ["csv"] }];

/** `Select` needs a string; as-fast-as-possible is a real choice, not an absence. */
const UNBOUNDED = "unbounded";

function speedKey(speed: number | null): string {
	return speed === null ? UNBOUNDED : String(speed);
}

function speedLabel(key: string | null): string {
	return (
		SPEED_OPTIONS.find((option) => speedKey(option.value) === key)?.label ??
		"Speed"
	);
}

/**
 * Record what is on the bus, replay a capture, or generate one.
 *
 * Sits above the live grid rather than inside its toolbar, and — importantly —
 * *above* the "no DBC" and "not connected" guards. A replay is the way to get
 * frames with no adapter attached, so the control that starts one has to be
 * reachable from a cold app.
 */
export function CaptureBar() {
	const connection = useConnectionStatus();
	const dbc = useCurrentDbc();
	const recording = useRecordingStatus();
	const replay = useReplayStatus();

	const startRecording = useStartRecording();
	const stopRecording = useStopRecording();
	const startReplay = useStartReplay();
	const stopReplay = useStopReplay();
	const generateCapture = useGenerateCapture();

	const [speed, setSpeed] = useState<number | null>(1);
	const [repeat, setRepeat] = useState(false);
	const [generating, setGenerating] = useState(false);

	const connected = Boolean(connection.data);
	const isRecording = recording.data?.recording ?? false;
	const isReplaying = replay.data?.running ?? false;

	async function handleRecord() {
		if (isRecording) {
			stopRecording.mutate();
			return;
		}
		const path = await save({
			defaultPath: defaultCaptureFilename(new Date()),
			filters: CSV_FILTER,
		});
		if (typeof path === "string") startRecording.mutate(path);
	}

	async function handleOpenCapture() {
		if (isReplaying) {
			stopReplay.mutate();
			return;
		}
		const path = await openDialog({ multiple: false, filters: CSV_FILTER });
		if (typeof path === "string") {
			startReplay.mutate({ path, options: { speed, repeat } });
		}
	}

	async function handleGenerate(spec: CaptureSpec) {
		const path = await save({
			defaultPath: "synthetic-capture.csv",
			filters: CSV_FILTER,
		});
		if (typeof path !== "string") return;

		await generateCapture.mutateAsync({ path, spec });
		setGenerating(false);
		// Straight into a replay: generating a file is never the goal, seeing
		// what it does to the page is.
		startReplay.mutate({ path, options: { speed, repeat } });
	}

	const errors = [
		recording.data?.stopped_reason,
		replay.data?.last_error,
		startRecording.error?.message,
		stopRecording.error?.message,
		startReplay.error?.message,
		generateCapture.error?.message,
	].filter((message): message is string => Boolean(message));

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant={isRecording ? "destructive" : "outline"}
					disabled={!connected && !isRecording}
					title={
						connected || isRecording
							? undefined
							: "Connect a CAN adapter to record what it receives"
					}
					onClick={handleRecord}
				>
					{isRecording ? <Square /> : <Circle />}
					{isRecording ? "Stop recording" : "Record"}
				</Button>

				{recording.data && (isRecording || recording.data.frames > 0) && (
					<span className="font-mono text-xs text-muted-foreground">
						{`${recording.data.frames.toLocaleString()} frames · ${formatBytes(recording.data.bytes)}`}
					</span>
				)}

				<span className="mx-1 h-4 w-px bg-border" />

				<Button
					size="sm"
					variant={isReplaying ? "destructive" : "outline"}
					disabled={connected && !isReplaying}
					title={
						connected && !isReplaying
							? "Disconnect the adapter first — two frame sources would interleave"
							: undefined
					}
					onClick={handleOpenCapture}
				>
					{isReplaying ? <Square /> : <FolderOpen />}
					{isReplaying ? "Stop replay" : "Open capture…"}
				</Button>

				{isReplaying && replay.data && (
					<span className="font-mono text-xs text-muted-foreground">
						{`${replay.data.frames_emitted.toLocaleString()} / ${replay.data.frames_total.toLocaleString()}`}
						{replay.data.loops > 0 && ` · pass ${replay.data.loops + 1}`}
					</span>
				)}

				<Select
					value={speedKey(speed)}
					onValueChange={(value) =>
						value && setSpeed(value === UNBOUNDED ? null : Number(value))
					}
				>
					<SelectTrigger className="w-44" aria-label="Playback speed">
						<SelectValue placeholder="Speed">
							{(value: string | null) => speedLabel(value)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{SPEED_OPTIONS.map((option) => (
							<SelectItem
								key={speedKey(option.value)}
								value={speedKey(option.value)}
							>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Label
					htmlFor="replay-repeat"
					className="flex items-center gap-1.5 text-xs"
				>
					Repeat
					<Switch
						id="replay-repeat"
						aria-label="Repeat"
						checked={repeat}
						onCheckedChange={setRepeat}
					/>
				</Label>

				<Button
					size="sm"
					variant="ghost"
					className="ml-auto"
					onClick={() => setGenerating(true)}
				>
					<Wand2 />
					Generate…
				</Button>
			</div>

			{recording.data?.path && !isRecording && recording.data.frames > 0 && (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<FileDown className="size-3" />
					{`Wrote ${recording.data.frames.toLocaleString()} frames to ${recording.data.path}`}
				</p>
			)}

			{errors.map((message) => (
				<Alert key={message} variant="destructive">
					<AlertTitle>Capture</AlertTitle>
					<AlertDescription>{message}</AlertDescription>
				</Alert>
			))}

			<GenerateCaptureDialog
				open={generating}
				onOpenChange={setGenerating}
				onGenerate={handleGenerate}
				pending={generateCapture.isPending}
				dbc={dbc.data}
			/>
		</div>
	);
}
