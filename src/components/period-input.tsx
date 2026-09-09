import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	clampPeriodMs,
	MIN_PERIOD_MS,
	PERIOD_UNITS,
	type PeriodUnit,
	periodFromMs,
	periodToMs,
} from "@/lib/period";

/** The rate a period works out to, at a precision worth reading. */
function formatRate(periodMs: number): string {
	const hz = 1000 / periodMs;
	if (hz >= 10) return `${Math.round(hz)} Hz`;
	if (hz >= 1) return `${hz.toFixed(1)} Hz`;
	return `${hz.toFixed(2)} Hz`;
}

/**
 * How often one message is sent: a number and the unit it is written in.
 *
 * Milliseconds are canonical — that is what `onChange` reports and what the
 * scheduler is given. The unit is held locally rather than derived from
 * `valueMs` on every render, because a derived unit would flip under the
 * cursor: typing the fourth digit of `1000` in milliseconds would rewrite the
 * field as `1 s` mid-keystroke.
 */
export function PeriodInput({
	valueMs,
	onChange,
	disabled,
}: {
	valueMs: number;
	onChange: (ms: number) => void;
	disabled?: boolean;
}) {
	const [unit, setUnit] = useState<PeriodUnit>(
		() => periodFromMs(valueMs).unit,
	);
	// While the field is being edited it shows exactly what was typed, so a
	// value can be cleared and retyped without the canonical number snapping
	// back into it. Null hands display back to `valueMs`.
	const [draft, setDraft] = useState<string | null>(null);

	const shown = unit === "s" ? valueMs / 1000 : valueMs;

	return (
		<div className="flex items-center gap-2 text-xs">
			<span className="text-muted-foreground">every</span>
			<Input
				type="number"
				min={unit === "s" ? MIN_PERIOD_MS / 1000 : MIN_PERIOD_MS}
				step="any"
				disabled={disabled}
				className="w-24"
				aria-label="Period"
				value={draft ?? String(shown)}
				onChange={(event) => {
					setDraft(event.target.value);
					const typed = event.target.valueAsNumber;
					// A half-typed value ("", "-", "1e") is not a period yet; the
					// draft keeps it on screen without reporting it.
					if (Number.isFinite(typed)) {
						onChange(clampPeriodMs(periodToMs(typed, unit)));
					}
				}}
				onBlur={() => setDraft(null)}
			/>
			<Select
				value={unit}
				disabled={disabled}
				onValueChange={(next: string | null) => {
					// Converting, not reinterpreting: 20 ms becomes 0.02 s, so the
					// period the user set is the period that keeps being sent.
					if (next) setUnit(next as PeriodUnit);
					setDraft(null);
				}}
			>
				<SelectTrigger className="w-20" aria-label="Period unit">
					<SelectValue>{(value: string | null) => value ?? "ms"}</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{PERIOD_UNITS.map((option) => (
						<SelectItem key={option} value={option}>
							{option}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<span className="font-mono text-[10px] text-muted-foreground/70">
				= {formatRate(valueMs)}
			</span>
		</div>
	);
}
