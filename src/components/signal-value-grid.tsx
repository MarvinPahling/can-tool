import { useId } from "react";
import type { DbcSignal } from "@/api/dbc";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getSignalRange } from "@/lib/signal-range";
import { isBooleanSignal, validateSignalValue } from "@/lib/signal-values";

/**
 * One editable field per signal of a message: a switch for a flag, a bounded
 * number input for everything else.
 *
 * Controlled and free of any form library, so both the send dialog (which
 * keeps its values in a TanStack Form) and the simulation card (which keeps
 * them in a store) can render the same fields.
 */
export function SignalValueGrid({
	signals,
	values,
	onChange,
	disabled,
}: {
	signals: DbcSignal[];
	values: Record<string, number>;
	onChange: (signalName: string, value: number) => void;
	disabled?: boolean;
}) {
	const gridId = useId();

	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-3">
			{signals.map((signal) => {
				const range = getSignalRange(signal);
				const value = values[signal.name];
				const error = validateSignalValue(signal, value);
				const errorId = error ? `${gridId}-${signal.name}-error` : undefined;

				if (isBooleanSignal(signal)) {
					return (
						// biome-ignore lint/a11y/noLabelWithoutControl: the Switch it wraps is the control, behind a component boundary biome cannot see through
						<label
							key={signal.name}
							className="flex items-center justify-between gap-2 text-xs"
						>
							<span className="text-muted-foreground">{signal.name}</span>
							<Switch
								checked={value === 1}
								disabled={disabled}
								aria-invalid={Boolean(error)}
								aria-describedby={errorId}
								onCheckedChange={(checked: boolean) =>
									onChange(signal.name, checked ? 1 : 0)
								}
							/>
							{errorId && (
								<span id={errorId} className="text-destructive">
									{error}
								</span>
							)}
						</label>
					);
				}

				return (
					// biome-ignore lint/a11y/noLabelWithoutControl: the Input it wraps is the control, behind a component boundary biome cannot see through
					<label key={signal.name} className="flex flex-col gap-0.5 text-xs">
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
							disabled={disabled}
							title={`Valid range: ${range.min} to ${range.max}`}
							value={value ?? ""}
							aria-invalid={Boolean(error)}
							aria-describedby={errorId}
							onChange={(event) =>
								onChange(signal.name, event.target.valueAsNumber)
							}
						/>
						{errorId && (
							<span id={errorId} className="text-destructive">
								{error}
							</span>
						)}
					</label>
				);
			})}
		</div>
	);
}
