import { useEffect, useMemo, useRef } from "react";
import type { DbcMessage } from "@/api/dbc";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useGenerateChecksum } from "@/queries/can";

/** How long edits settle before an automatic checksum is recomputed. */
const AUTO_DEBOUNCE_MS = 300;

/**
 * The values that feed a checksum, as a stable key.
 *
 * The checksum signal itself is left out, and that omission is what makes
 * automatic regeneration terminate: writing the result back changes `values`,
 * and a key that included it would see its own output as a fresh edit and
 * recompute forever. Leaving it out is also correct rather than merely
 * convenient — `generate_checksum` zeroes that signal before computing, so its
 * current value cannot affect the answer.
 */
function checksumInputsKey(
	values: Record<string, number>,
	signalName: string,
): string {
	return JSON.stringify(
		Object.entries(values)
			.filter(([name]) => name !== signalName)
			.sort(([a], [b]) => a.localeCompare(b)),
	);
}

/**
 * Picks which signal holds the message's checksum and fills it in, on demand
 * or automatically.
 *
 * The value is computed over the frame with that signal zeroed, so it goes
 * stale the moment any other value changes. Automatic mode exists because
 * keeping it fresh by hand is exactly the kind of bookkeeping that is easy to
 * forget on a bus that is already running.
 */
export function ChecksumField({
	message,
	values,
	signalName,
	auto,
	onSignalNameChange,
	onAutoChange,
	onGenerated,
	disabled,
}: {
	message: DbcMessage;
	values: Record<string, number>;
	signalName: string;
	/** Recompute the checksum whenever another value changes. */
	auto: boolean;
	onSignalNameChange: (signalName: string) => void;
	onAutoChange: (auto: boolean) => void;
	onGenerated: (signalName: string, value: number) => void;
	disabled?: boolean;
}) {
	const generateChecksum = useGenerateChecksum();
	const { mutateAsync } = generateChecksum;

	// Read through refs so the effect below depends on what the checksum is
	// computed *from*, not on identities that change every render.
	const valuesRef = useRef(values);
	const onGeneratedRef = useRef(onGenerated);
	useEffect(() => {
		valuesRef.current = values;
		onGeneratedRef.current = onGenerated;
	});

	const inputsKey = useMemo(
		() => checksumInputsKey(values, signalName),
		[values, signalName],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: inputsKey is never read in the body — it *is* the change signal. Dropping it, as biome suggests, would leave the checksum frozen at whatever it was when auto was switched on.
	useEffect(() => {
		if (!auto || !signalName || disabled) return;

		let cancelled = false;
		const timer = setTimeout(async () => {
			try {
				const value = await mutateAsync({
					message,
					values: valuesRef.current,
					checksumSignal: signalName,
				});
				if (!cancelled) onGeneratedRef.current(signalName, value);
			} catch {
				// Surfaced through the mutation's error state below.
			}
		}, AUTO_DEBOUNCE_MS);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [auto, signalName, disabled, inputsKey, message, mutateAsync]);

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Select
				value={signalName}
				disabled={disabled}
				onValueChange={(value: string | null) =>
					onSignalNameChange(value ?? "")
				}
			>
				<SelectTrigger className="w-48" aria-label="Checksum field">
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
					const value = await mutateAsync({
						message,
						values,
						checksumSignal: signalName,
					});
					onGenerated(signalName, value);
				}}
			>
				Generate
			</Button>
			<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
				<span aria-hidden>Auto</span>
				<Switch
					checked={auto}
					disabled={disabled || !signalName}
					aria-label="Auto checksum"
					onCheckedChange={onAutoChange}
				/>
			</div>
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
