import { Trash2 } from "lucide-react";
import type { DbcMessage } from "@/api/dbc";
import { ChecksumField } from "@/components/checksum-field";
import { PeriodInput } from "@/components/period-input";
import { SignalValueGrid } from "@/components/signal-value-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useEncodedPreview } from "@/hooks/use-encoded-preview";
import { defaultSignalValues } from "@/lib/signal-values";
import {
	removeSimulationEntry,
	type SimulationEntry,
	setSimulationValue,
	updateSimulationEntry,
} from "@/lib/simulation-entries";
import { bytesToHex, formatCanId } from "@/lib/utils";
import { useSendCanMessage } from "@/queries/can";

/**
 * One message on the simulation board: which message, what its signals hold,
 * and how often it goes out.
 *
 * Laid out like `LiveMessageCard` on purpose — the same card in the same place
 * means the same CAN id, whether you are watching it or sending it.
 *
 * Edits stay live while the simulation runs: changing a value mid-run is the
 * point of a restbus, and the panel restarts the scheduler behind a debounce.
 */
export function SimulationMessageCard({
	entry,
	messages,
	running,
	canSend,
}: {
	entry: SimulationEntry;
	messages: DbcMessage[];
	/** The scheduler is cycling this board right now. */
	running: boolean;
	/** A writable connection exists, so a one-shot send can go out. */
	canSend: boolean;
}) {
	const message = messages.find(
		(candidate) => String(candidate.id) === entry.messageId,
	);
	const preview = useEncodedPreview(message, entry.values);
	const sendMessage = useSendCanMessage();

	// An entry outlives the DBC it was made against: the board is persisted and
	// the file is not. Say so rather than silently rendering an empty card.
	const missingFromDbc = entry.messageId !== "" && !message;

	const setValue = (signalName: string, value: number) =>
		setSimulationValue(entry.id, signalName, value);

	return (
		<Card data-slot="simulation-message-card" className="gap-2 py-3">
			<CardHeader className="px-3">
				<CardTitle className="flex items-baseline justify-between gap-2">
					<span className="truncate">
						{message?.name ??
							(missingFromDbc ? "Unknown message" : "New entry")}
					</span>
					{entry.messageId !== "" && (
						<span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">
							{formatCanId(
								message?.id ?? Number(entry.messageId),
								message?.extended ?? false,
							)}
						</span>
					)}
				</CardTitle>
				<div className="flex items-center gap-2 text-[10px] text-muted-foreground">
					{message ? (
						<span>{`${message.size} bytes`}</span>
					) : missingFromDbc ? (
						<Badge variant="outline">Not in DBC</Badge>
					) : null}
					{running && entry.enabled && message && (
						<Badge variant="outline">Sending</Badge>
					)}
				</div>
			</CardHeader>

			<CardContent className="flex flex-col gap-3 px-3">
				<div className="flex items-center gap-2">
					<Select
						value={entry.messageId}
						onValueChange={(value: string | null) => {
							const picked = messages.find(
								(candidate) => String(candidate.id) === value,
							);
							// Values belong to the message they were dialled in for;
							// carrying them over would mean signals that no longer exist.
							updateSimulationEntry(entry.id, {
								messageId: value ?? "",
								values: picked ? defaultSignalValues(picked) : {},
								checksumSignal: "",
							});
						}}
					>
						<SelectTrigger className="w-56" aria-label="Message">
							<SelectValue placeholder="Select a message">
								{(value: string | null) =>
									messages.find((candidate) => String(candidate.id) === value)
										?.name ?? "Select a message"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{messages.map((candidate) => (
								<SelectItem key={candidate.id} value={String(candidate.id)}>
									{candidate.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
						<span aria-hidden>Enabled</span>
						<Switch
							checked={entry.enabled}
							aria-label="Enabled"
							onCheckedChange={(checked: boolean) =>
								updateSimulationEntry(entry.id, { enabled: checked })
							}
						/>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Remove message"
						onClick={() => removeSimulationEntry(entry.id)}
					>
						<Trash2 className="size-4" />
					</Button>
				</div>

				{message && (
					<>
						<SignalValueGrid
							signals={message.signals}
							values={entry.values}
							onChange={setValue}
						/>

						<ChecksumField
							message={message}
							values={entry.values}
							signalName={entry.checksumSignal}
							onSignalNameChange={(signalName) =>
								updateSimulationEntry(entry.id, { checksumSignal: signalName })
							}
							onGenerated={setValue}
						/>

						<PeriodInput
							valueMs={entry.periodMs}
							onChange={(periodMs) =>
								updateSimulationEntry(entry.id, { periodMs })
							}
						/>

						<div className="flex items-center justify-between gap-2">
							<span className="font-mono text-[10px] break-all text-muted-foreground">
								{preview.error ??
									(preview.bytes ? bytesToHex(preview.bytes) : "—")}
							</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={!canSend || !preview.bytes || sendMessage.isPending}
								onClick={() =>
									sendMessage.mutate({ message, values: entry.values })
								}
							>
								Send once
							</Button>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
