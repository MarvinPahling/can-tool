import type { DbcMessage } from "@/api/dbc";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useGenerateChecksum } from "@/queries/can";

/**
 * Picks which signal holds the message's checksum and fills it in.
 *
 * The value is computed over the frame with that signal zeroed, so it has to
 * be regenerated after any other value changes — hence a button rather than
 * something automatic: the user decides when the frame is final.
 */
export function ChecksumField({
	message,
	values,
	signalName,
	onSignalNameChange,
	onGenerated,
	disabled,
}: {
	message: DbcMessage;
	values: Record<string, number>;
	signalName: string;
	onSignalNameChange: (signalName: string) => void;
	onGenerated: (signalName: string, value: number) => void;
	disabled?: boolean;
}) {
	const generateChecksum = useGenerateChecksum();

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Select
				value={signalName}
				disabled={disabled}
				onValueChange={(value: string | null) =>
					onSignalNameChange(value ?? "")
				}
			>
				<SelectTrigger className="w-48">
					<SelectValue placeholder="Checksum field">
						{(value: string | null) =>
							message.signals.find((signal) => signal.name === value)?.name ??
							"Checksum field"
						}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{message.signals.map((signal) => (
						<SelectItem key={signal.name} value={signal.name}>
							{signal.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={disabled || !signalName || generateChecksum.isPending}
				onClick={async () => {
					if (!signalName) return;
					const value = await generateChecksum.mutateAsync({
						message,
						values,
						checksumSignal: signalName,
					});
					onGenerated(signalName, value);
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
	);
}
