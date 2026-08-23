import { useHotkeyRecorder } from "@tanstack/react-hotkeys";
import { useEffect, useState } from "react";
import {
	COMMANDS,
	findBindingConflicts,
	formatBinding,
	isSequenceBinding,
	popScope,
	pushScope,
	resetCommandBinding,
	setCommandBinding,
	useCommandHandler,
	useEffectiveBinding,
} from "@/commands";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function ShortcutRow({
	id,
	label,
	description,
	isRecording,
	onStartRecording,
}: {
	id: string;
	label: string;
	description?: string;
	isRecording: boolean;
	onStartRecording: () => void;
}) {
	const binding = useEffectiveBinding(id);
	const customizable = !isSequenceBinding(binding);

	return (
		<div className="flex flex-col gap-1.5 py-2.5">
			<div className="min-w-0">
				<div className="font-medium">{label}</div>
				{description && (
					<div className="text-muted-foreground">{description}</div>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Badge
					variant="outline"
					className={cn("font-mono", isRecording && "animate-pulse")}
				>
					{isRecording ? "Press keys…" : formatBinding(binding)}
				</Badge>
				{customizable ? (
					<>
						<Button
							size="sm"
							variant="ghost"
							onClick={onStartRecording}
							disabled={isRecording}
						>
							Change
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => resetCommandBinding(id)}
						>
							Reset
						</Button>
					</>
				) : (
					<span className="text-muted-foreground">sequence</span>
				)}
			</div>
		</div>
	);
}

export function ShortcutsDialog() {
	const [open, setOpen] = useState(false);
	const [recordingId, setRecordingId] = useState<string | null>(null);
	const [conflictMessage, setConflictMessage] = useState<string | null>(null);

	useCommandHandler("app.showShortcuts", () => setOpen(true));

	useEffect(() => {
		if (!open) return;
		pushScope("dialog");
		return () => popScope("dialog");
	}, [open]);

	const recorder = useHotkeyRecorder({
		onRecord: (hotkey) => {
			if (!recordingId) return;
			const conflicts = findBindingConflicts(recordingId, hotkey);
			if (conflicts.length > 0) {
				setConflictMessage(
					`That shortcut is already used by "${conflicts.map((c) => c.label).join(", ")}".`,
				);
				return;
			}
			setCommandBinding(recordingId, hotkey);
			setRecordingId(null);
			setConflictMessage(null);
		},
		onCancel: () => {
			setRecordingId(null);
			setConflictMessage(null);
		},
	});

	function startRecording(id: string) {
		setRecordingId(id);
		setConflictMessage(null);
		recorder.startRecording();
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					recorder.cancelRecording();
					setRecordingId(null);
					setConflictMessage(null);
				}
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Keyboard Shortcuts</DialogTitle>
					<DialogDescription>
						Click "Change" and press a new key combination to customize a
						shortcut.
					</DialogDescription>
				</DialogHeader>

				{conflictMessage && (
					<p className="rounded-md bg-destructive/10 px-2 py-1.5 text-destructive">
						{conflictMessage}
					</p>
				)}

				<div className="max-h-[60vh] divide-y divide-border overflow-y-auto">
					{COMMANDS.map((command) => (
						<ShortcutRow
							key={command.id}
							id={command.id}
							label={command.label}
							description={command.description}
							isRecording={recordingId === command.id && recorder.isRecording}
							onStartRecording={() => startRecording(command.id)}
						/>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
