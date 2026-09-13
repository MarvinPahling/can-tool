import { useState } from "react";
import type { DbcFile } from "@/api/dbc";
import type { CaptureSpec } from "@/api/recording";
import { defaultCaptureSpec } from "@/api/recording";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { CAPTURE_PRESETS } from "@/lib/capture-file";

/** One labelled number field. The spec has eight of them; this is all of them. */
function SpecNumber({
	id,
	label,
	value,
	step,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	step?: number;
	onChange: (value: number) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor={id} className="text-xs">
				{label}
			</Label>
			<Input
				id={id}
				type="number"
				step={step}
				value={value}
				onChange={(event) => {
					const next = Number(event.target.value);
					// A half-typed field reads as NaN; keeping the old value beats
					// writing one into the spec.
					if (Number.isFinite(next)) onChange(next);
				}}
			/>
		</div>
	);
}

/**
 * Composes a `CaptureSpec` and writes it to a file.
 *
 * The presets are the point of the dialog: the two traffic shapes the live
 * view is known to struggle with, as one click each. Everything else is there
 * so a shape that turns up later can be reproduced without a code change.
 */
export function GenerateCaptureDialog({
	open,
	onOpenChange,
	onGenerate,
	pending,
	dbc,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onGenerate: (spec: CaptureSpec) => void;
	pending: boolean;
	/** Offered as a seed when one is loaded; the dialog attaches it itself. */
	dbc: DbcFile | undefined;
}) {
	const [spec, setSpec] = useState<CaptureSpec>(defaultCaptureSpec);
	const [useDbc, setUseDbc] = useState(false);

	const patch = (next: Partial<CaptureSpec>) =>
		setSpec((previous) => ({ ...previous, ...next }));

	const framesPerSecond = Math.round((spec.id_count * 1000) / spec.cycle_ms);
	const totalFrames = Math.ceil((framesPerSecond * spec.duration_ms) / 1000);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Generate a synthetic capture</DialogTitle>
					<DialogDescription>
						Deterministic from the seed: the same settings always write the same
						file, so a before-and-after measurement compares two runs of the
						same traffic.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						{CAPTURE_PRESETS.map((preset) => (
							<Button
								key={preset.id}
								variant="outline"
								className="h-auto flex-col items-start gap-0.5 py-2 text-left"
								onClick={() => patch(preset.spec)}
							>
								<span className="text-sm font-medium">{preset.label}</span>
								<span className="text-xs font-normal whitespace-normal text-muted-foreground">
									{preset.description}
								</span>
							</Button>
						))}
					</div>

					<Separator />

					<div className="grid grid-cols-2 gap-3">
						<SpecNumber
							id="spec-id-count"
							label="Distinct ids"
							value={spec.id_count}
							onChange={(id_count) => patch({ id_count })}
						/>
						<SpecNumber
							id="spec-cycle"
							label="Cycle (ms)"
							value={spec.cycle_ms}
							onChange={(cycle_ms) => patch({ cycle_ms })}
						/>
						<SpecNumber
							id="spec-duration"
							label="Duration (ms)"
							value={spec.duration_ms}
							onChange={(duration_ms) => patch({ duration_ms })}
						/>
						<SpecNumber
							id="spec-seed"
							label="Seed"
							value={spec.seed}
							onChange={(seed) => patch({ seed })}
						/>
						<SpecNumber
							id="spec-fd"
							label="CAN FD share (0–1)"
							step={0.05}
							value={spec.fd_ratio}
							onChange={(fd_ratio) => patch({ fd_ratio })}
						/>
						<SpecNumber
							id="spec-churn"
							label="Churn (0–1)"
							step={0.05}
							value={spec.churn}
							onChange={(churn) => patch({ churn })}
						/>
					</div>

					<Label
						htmlFor="spec-extended"
						className="flex items-center justify-between gap-2 text-sm"
					>
						29-bit (extended) ids
						<Switch
							id="spec-extended"
							checked={spec.extended}
							onCheckedChange={(extended: boolean) => patch({ extended })}
						/>
					</Label>

					{dbc && (
						<Label
							htmlFor="spec-from-dbc"
							className="flex items-center justify-between gap-2 text-sm"
						>
							<span className="leading-tight font-normal">
								Seed from the loaded DBC
								<span className="block text-xs text-muted-foreground">
									Ids and values come from the file, so frames decode to
									plausible readings instead of noise.
								</span>
							</span>
							<Switch
								id="spec-from-dbc"
								checked={useDbc}
								onCheckedChange={setUseDbc}
							/>
						</Label>
					)}

					<p className="text-xs text-muted-foreground">
						{`About ${framesPerSecond.toLocaleString()} frames/s, ${totalFrames.toLocaleString()} frames in total.`}
					</p>

					<Button
						disabled={pending}
						onClick={() =>
							onGenerate({ ...spec, from_dbc: useDbc ? (dbc ?? null) : null })
						}
					>
						{pending ? "Generating…" : "Generate capture"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
