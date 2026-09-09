import { useForm, useStore } from "@tanstack/react-form";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DbcMessage } from "@/api/dbc";
import { popScope, pushScope, useCommandHandler } from "@/commands";
import { ChecksumField } from "@/components/checksum-field";
import { SignalValueGrid } from "@/components/signal-value-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { useEncodedPreview } from "@/hooks/use-encoded-preview";
import { usePendingSendMessage } from "@/lib/pending-send";
import { bytesToHex } from "@/lib/utils";
import { useConnectionStatus, useSendCanMessage } from "@/queries/can";
import { useCurrentDbc } from "@/queries/dbc";

interface FrameValues {
	messageId: string;
	values: Record<string, number>;
}

interface SendFormValues {
	frames: FrameValues[];
}

export function SendMessageDialog() {
	const [open, setOpen] = useState(false);
	const dbc = useCurrentDbc();
	const status = useConnectionStatus();
	const sendMessage = useSendCanMessage();
	// Stable per-frame ids, parallel to `frames`, so React keys stay attached
	// to the right row when new frames are inserted at the front.
	const [frameIds, setFrameIds] = useState<number[]>([]);
	const nextFrameId = useRef(0);

	useCommandHandler("message.send", () => setOpen(true));

	useEffect(() => {
		if (!open) return;
		pushScope("dialog");
		return () => popScope("dialog");
	}, [open]);

	const messages = dbc.data?.messages ?? [];

	const form = useForm({
		defaultValues: { frames: [] } as SendFormValues,
	});

	const pending = usePendingSendMessage();
	const lastHandledNonce = useRef<number | undefined>(undefined);

	useEffect(() => {
		if (!pending.data || pending.data.nonce === lastHandledNonce.current)
			return;
		lastHandledNonce.current = pending.data.nonce;

		setOpen(true);
		const frames = form.state.values.frames;
		const existingIndex = frames.findIndex(
			(frame) => frame.messageId === pending.data!.messageId,
		);
		if (existingIndex === -1) {
			form.insertFieldValue("frames", 0, {
				messageId: pending.data.messageId,
				values: {},
			});
			setFrameIds((prev) => [nextFrameId.current++, ...prev]);
		}
	}, [pending.data, form]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>Send CAN Message</DialogTitle>
					<DialogDescription>
						Compose frames from the loaded DBC's message definitions and
						transmit them.
					</DialogDescription>
				</DialogHeader>

				{!dbc.data ? (
					<Alert>
						<AlertTitle>No DBC loaded</AlertTitle>
						<AlertDescription>
							Open a .dbc file before composing messages.
						</AlertDescription>
					</Alert>
				) : !status.data ? (
					<Alert>
						<AlertTitle>No device connected</AlertTitle>
						<AlertDescription>
							Connect a CAN adapter before sending. You can still compose and
							validate frames.
						</AlertDescription>
					</Alert>
				) : status.data.read_only ? (
					<Alert>
						<AlertTitle>Connected in read-only mode</AlertTitle>
						<AlertDescription>
							The adapter is listening only and will not transmit. Reconnect
							with read-only off to send. You can still compose and validate
							frames.
						</AlertDescription>
					</Alert>
				) : null}

				{sendMessage.isError && (
					<Alert variant="destructive">
						<AlertTitle>Failed to send</AlertTitle>
						<AlertDescription>
							{sendMessage.error instanceof Error
								? sendMessage.error.message
								: "Unknown error"}
						</AlertDescription>
					</Alert>
				)}

				<form.Field name="frames" mode="array">
					{(framesField) => (
						<div className="max-h-[60vh] space-y-3 overflow-y-auto">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={messages.length === 0}
								onClick={() => {
									framesField.insertValue(0, { messageId: "", values: {} });
									setFrameIds((prev) => [nextFrameId.current++, ...prev]);
								}}
							>
								<Plus className="size-4" />
								Add frame
							</Button>

							{framesField.state.value.map((_, index) => (
								<FrameRow
									key={frameIds[index]}
									form={form}
									index={index}
									messages={messages}
									canSend={Boolean(status.data) && !status.data?.read_only}
									onSend={(message, values) =>
										sendMessage.mutate({ message, values })
									}
									onRemove={() => {
										framesField.removeValue(index);
										setFrameIds((prev) => prev.filter((_, i) => i !== index));
									}}
								/>
							))}
						</div>
					)}
				</form.Field>
			</DialogContent>
		</Dialog>
	);
}

function FrameRow({
	form,
	index,
	messages,
	canSend,
	onSend,
	onRemove,
}: {
	// biome-ignore lint/suspicious/noExplicitAny: TanStack Form's array-field form type is not expressible here
	form: any;
	index: number;
	messages: DbcMessage[];
	canSend: boolean;
	onSend: (message: DbcMessage, values: Record<string, number>) => void;
	onRemove: () => void;
}) {
	const frame = useStore(
		form.store,
		(state: { values: SendFormValues }) => state.values.frames[index],
	);
	const [checksumSignal, setChecksumSignal] = useState("");
	const [checksumAuto, setChecksumAuto] = useState(false);

	const selectedMessage = messages.find(
		(message) => String(message.id) === frame?.messageId,
	);
	const values = frame?.values ?? {};
	const preview = useEncodedPreview(selectedMessage, values);

	const setValue = (signalName: string, value: number) =>
		form.setFieldValue(`frames[${index}].values.${signalName}`, value);

	return (
		<div className="space-y-2 rounded-md border border-border p-3">
			<div className="flex items-center gap-2">
				<Select
					value={frame?.messageId ?? ""}
					onValueChange={(value: string | null) => {
						form.setFieldValue(`frames[${index}].messageId`, value ?? "");
						form.setFieldValue(`frames[${index}].values`, {});
						setChecksumSignal("");
						setChecksumAuto(false);
					}}
				>
					<SelectTrigger className="w-56">
						<SelectValue placeholder="Select a message">
							{(value: string | null) =>
								messages.find((message) => String(message.id) === value)
									?.name ?? "Select a message"
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{messages.map((message) => (
							<SelectItem key={message.id} value={String(message.id)}>
								{message.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{selectedMessage && (
					<span className="text-xs text-muted-foreground">
						ID 0x{selectedMessage.id.toString(16).toUpperCase()} ·{" "}
						{selectedMessage.size} bytes
					</span>
				)}

				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="ml-auto"
					onClick={onRemove}
				>
					<Trash2 className="size-4" />
				</Button>
			</div>

			{selectedMessage && (
				<>
					<SignalValueGrid
						signals={selectedMessage.signals}
						values={values}
						onChange={setValue}
					/>

					<ChecksumField
						message={selectedMessage}
						values={values}
						signalName={checksumSignal}
						auto={checksumAuto}
						onSignalNameChange={setChecksumSignal}
						onAutoChange={setChecksumAuto}
						onGenerated={setValue}
					/>

					<div className="flex items-center justify-between gap-2">
						<span className="font-mono text-xs text-muted-foreground">
							{preview.error
								? preview.error
								: preview.bytes
									? bytesToHex(preview.bytes)
									: "—"}
						</span>
						<Button
							type="button"
							size="sm"
							disabled={!canSend || !preview.bytes}
							onClick={() => onSend(selectedMessage, values)}
						>
							Send
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
