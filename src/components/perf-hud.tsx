import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/capture-file";
import { perSecond } from "@/lib/perf-flags";

/** What the live view is currently holding, sampled from its owner. */
export interface PerfSample {
	/** Entries in the per-id state map. */
	ids: number;
	/** Frames received since the page loaded. */
	frames: number;
	/** `can-frames` events received since the page loaded. */
	batches: number;
}

interface Readout {
	ids: number;
	nodes: number;
	animations: number;
	heapBytes: number | null;
	framesPerSecond: number;
	batchesPerSecond: number;
}

/** How often the readout samples. Slow on purpose — see the note below. */
const SAMPLE_MS = 1_000;

function heapBytes(): number | null {
	// Chromium-only and non-standard, which is fine: this is a measurement
	// tool for a WebKit/Chromium desktop app, not a shipped feature.
	const memory = (
		performance as Performance & { memory?: { usedJSHeapSize: number } }
	).memory;
	return memory ? memory.usedJSHeapSize : null;
}

/**
 * The numbers the memory baseline is built from, on screen.
 *
 * Off by default (`can-tool:perf`), and sampled once a second rather than on
 * the render flush: an instrument that costs as much as the thing it measures
 * is not an instrument. Counting DOM nodes is the expensive part, and once a
 * second it is noise next to a 20 Hz grid re-render.
 *
 * `document.getAnimations()` is here because a finished `fill: "forwards"`
 * animation stays alive on its element, so the count tracks rendered signal
 * rows rather than running fades — which is exactly the thing worth watching.
 */
export function PerfHud({ sample }: { sample: () => PerfSample }) {
	const [readout, setReadout] = useState<Readout | null>(null);

	useEffect(() => {
		let previous = sample();
		let previousAt = performance.now();

		const id = setInterval(() => {
			const current = sample();
			const now = performance.now();
			const elapsed = now - previousAt;

			setReadout({
				ids: current.ids,
				nodes: document.getElementsByTagName("*").length,
				animations: document.getAnimations().length,
				heapBytes: heapBytes(),
				framesPerSecond: perSecond(current.frames - previous.frames, elapsed),
				batchesPerSecond: perSecond(
					current.batches - previous.batches,
					elapsed,
				),
			});

			previous = current;
			previousAt = now;
		}, SAMPLE_MS);

		return () => clearInterval(id);
	}, [sample]);

	if (!readout) return null;

	const rows: [string, string][] = [
		["ids", readout.ids.toLocaleString()],
		["dom nodes", readout.nodes.toLocaleString()],
		["animations", readout.animations.toLocaleString()],
		["frames/s", readout.framesPerSecond.toLocaleString()],
		["events/s", readout.batchesPerSecond.toLocaleString()],
		[
			"js heap",
			readout.heapBytes === null ? "n/a" : formatBytes(readout.heapBytes),
		],
	];

	return (
		<div
			data-slot="perf-hud"
			className="pointer-events-none fixed right-3 bottom-3 z-50 rounded-md border border-border bg-background/95 px-2.5 py-2 font-mono text-[10px] shadow-md"
		>
			<table>
				<tbody>
					{rows.map(([label, value]) => (
						<tr key={label}>
							<td className="pr-3 text-muted-foreground">{label}</td>
							<td className="text-right tabular-nums">{value}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
