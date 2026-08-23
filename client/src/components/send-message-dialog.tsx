import { useForm, useStore } from "@tanstack/react-form";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { encodeCanMessage } from "@/api/can";
import type { DbcMessage } from "@/api/dbc";
import { popScope, pushScope, useCommandHandler } from "@/commands";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePendingSendMessage } from "@/lib/pending-send";
import { getSignalRange } from "@/lib/signal-range";
import {
	useConnectionStatus,
	useGenerateChecksum,
	useSendCanMessage,
} from "@/queries/can";
import { useCurrentDbc } from "@/queries/dbc";

interface FrameValues {
	messageId: string;
	values: Record<string, number>;
}

interface SendFormValues {
	frames: FrameValues[];
}

function bytesToHex(bytes: number[]): string {
	return bytes
		.map((b) => b.toString(16).padStart(2, "0").toUpperCase())
		.join(" ");
}

export function SendMessageDialog() {
	const [open, setOpen] = useState(false);
	const dbc = useCurrentDbc();
	const status = useConnectionStatus();
	const sendMessage = useSendCanMessage();
	const [previews, setPreviews] = useState<
		Record<number, { bytes?: number[]; error?: string }>
	>({});
	const [checksumSignals, setChecksumSignals] = useState<
		Record<number, string>
	>({});
	// Stable per-frame ids, parallel to `frames`, so previews/checksumSignals
	// (keyed by id, not array index) stay attached to the right row when new
	// frames are inserted at the front instead of appended.
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

							{framesField.state.value.map((_, index) => {
								const id = frameIds[index];
								return (
									<FrameRow
										key={id}
										form={form}
										index={index}
										messages={messages}
										preview={previews[id]}
										onPreviewChange={(preview) =>
											setPreviews((prev) => ({ ...prev, [id]: preview }))
										}
										checksumSignal={checksumSignals[id] ?? ""}
										onChecksumSignalChange={(signalName) =>
											setChecksumSignals((prev) => ({
												...prev,
												[id]: signalName,
											}))
										}
										canSend={Boolean(status.data)}
										onSend={(message, values) =>
											sendMessage.mutate({ message, values })
										}
										onRemove={() => {
											framesField.removeValue(index);
											setFrameIds((prev) => prev.filter((_, i) => i !== index));
											setPreviews((prev) => {
												const next = { ...prev };
												delete next[id];
												return next;
											});
											setChecksumSignals((prev) => {
												const next = { ...prev };
												delete next[id];
												return next;
											});
										}}
									/>
								);
							})}
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
	preview,
	onPreviewChange,
	checksumSignal,
	onChecksumSignalChange,
	canSend,
	onSend,
	onRemove,
}: {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	form: any;
	index: number;
	messages: DbcMessage[];
	preview?: { bytes?: number[]; error?: string };
	onPreviewChange: (preview: { bytes?: number[]; error?: string }) => void;
	checksumSignal: string;
	onChecksumSignalChange: (signalName: string) => void;
	canSend: boolean;
	onSend: (message: DbcMessage, values: Record<string, number>) => void;
	onRemove: () => void;
}) {
	const frame = useStore(
		form.store,
		(state: { values: SendFormValues }) => state.values.frames[index],
	);
	const selectedMessage = messages.find(
		(m) => String(m.id) === frame?.messageId,
	);
	const generateChecksum = useGenerateChecksum();

	return (
		<div className="space-y-2 rounded-md border border-border p-3">
			<div className="flex items-center gap-2">
				<form.Field
					name={`frames[${index}].messageId`}
					validators={{
						onChange: ({ value }: { value: string }) =>
							value ? undefined : "Select a message",
					}}
				>
					{(field: any) => (
						<Select
							value={field.state.value}
							onValueChange={(value: string) => {
								field.handleChange(value);
								form.setFieldValue(`frames[${index}].values`, {});
								onPreviewChange({});
								onChecksumSignalChange("");
							}}
						>
							<SelectTrigger
								className="w-56"
								aria-invalid={field.state.meta.errors.length > 0}
							>
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
					)}
				</form.Field>

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
					<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-3">
						{selectedMessage.signals.map((signal) => {
							const range = getSignalRange(signal);
							return (
								<form.Field
									key={signal.name}
									name={`frames[${index}].values.${signal.name}`}
									validators={{
										onChange: ({ value }: { value: number | undefined }) => {
											if (value === undefined || Number.isNaN(value))
												return "Required";
											if (value < range.min || value > range.max) {
												return `Must be between ${range.min} and ${range.max}`;
											}
											return undefined;
										},
										onChangeAsyncDebounceMs: 300,
										onChangeAsync: async () => {
											const currentValues = form.getFieldValue(
												`frames[${index}].values`,
											) as Record<string, number>;
											try {
												const bytes = await encodeCanMessage(
													selectedMessage,
													currentValues,
												);
												onPreviewChange({ bytes });
												return undefined;
											} catch (error) {
												const message =
													error instanceof Error
														? error.message
														: String(error);
												onPreviewChange({ error: message });
												return message;
											}
										},
									}}
								>
									{(field: any) => {
										const isBoolean = signal.size === 1;
										const errorId =
											field.state.meta.errors.length > 0
												? `${signal.name}-error-${index}`
												: undefined;

										return isBoolean ? (
											<label className="flex items-center justify-between gap-2 text-xs">
												<span className="text-muted-foreground">
													{signal.name}
												</span>
												<Switch
													checked={field.state.value === 1}
													aria-invalid={field.state.meta.errors.length > 0}
													aria-describedby={errorId}
													onCheckedChange={(checked: boolean) =>
														field.handleChange(checked ? 1 : 0)
													}
													onBlur={field.handleBlur}
												/>
												{errorId && (
													<span id={errorId} className="text-destructive">
														{String(field.state.meta.errors[0])}
													</span>
												)}
											</label>
										) : (
											<label className="flex flex-col gap-0.5 text-xs">
												<span className="flex items-baseline justify-between gap-1 text-muted-foreground">
													<span>
														{signal.name}
														{signal.unit && ` (${signal.unit})`}
													</span>
													<span className="font-mono text-[10px] text-muted-foreground/70">
														[{range.min}, {range.max}]
													</span>
												</span>
												<Input
													type="number"
													min={range.min}
													max={range.max}
													title={`Valid range: ${range.min} to ${range.max}`}
													value={field.state.value ?? ""}
													aria-invalid={field.state.meta.errors.length > 0}
													aria-describedby={errorId}
													onChange={(e) =>
														field.handleChange(e.target.valueAsNumber)
													}
													onBlur={field.handleBlur}
												/>
												{errorId && (
													<span id={errorId} className="text-destructive">
														{String(field.state.meta.errors[0])}
													</span>
												)}
											</label>
										);
									}}
								</form.Field>
							);
						})}
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Select
							value={checksumSignal}
							onValueChange={(value) => onChecksumSignalChange(value ?? "")}
						>
							<SelectTrigger className="w-48">
								<SelectValue placeholder="Checksum field">
									{(value: string | null) =>
										selectedMessage.signals.find((s) => s.name === value)
											?.name ?? "Checksum field"
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{selectedMessage.signals.map((s) => (
									<SelectItem key={s.name} value={s.name}>
										{s.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={!checksumSignal || generateChecksum.isPending}
							onClick={async () => {
								if (!checksumSignal) return;
								const currentValues = form.getFieldValue(
									`frames[${index}].values`,
								) as Record<string, number>;
								const result = await generateChecksum.mutateAsync({
									message: selectedMessage,
									values: currentValues,
									checksumSignal,
								});
								form.setFieldValue(
									`frames[${index}].values.${checksumSignal}`,
									result,
								);
							}}
						>
							Generate
						</Button>
						{generateChecksum.isError && (
							<span className="text-xs text-destructive">
								{generateChecksum.error instanceof Error
									? generateChecksum.error.message
									: "Failed to generate checksum"}
							</span>
						)}
					</div>

					<div className="flex items-center justify-between gap-2">
						<span className="font-mono text-xs text-muted-foreground">
							{preview?.error
								? preview.error
								: preview?.bytes
									? bytesToHex(preview.bytes)
									: "—"}
						</span>
						<Button
							type="button"
							size="sm"
							disabled={!canSend || !preview?.bytes}
							onClick={() =>
								selectedMessage && onSend(selectedMessage, frame.values)
							}
						>
							Send
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
