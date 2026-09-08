import { useEffect, useRef } from "react";
import type { DbcSignal } from "@/api/dbc";
import type { LiveSignal } from "@/lib/live-messages";
import { cn } from "@/lib/utils";
import type { VisualizeSettings } from "@/lib/visualize-settings";

/**
 * How many decimals a signal's factor implies. A factor of 0.01 can express
 * hundredths, so showing 12.340000000000002 (or rounding to 12) both misread
 * the resolution the bus actually carries.
 */
function precisionFor(factor: number): number {
	if (!Number.isFinite(factor) || Number.isInteger(factor)) return 0;
	const decimals = String(factor).split(".")[1]?.length ?? 0;
	return Math.min(decimals, 6);
}

function formatValue(signal: DbcSignal, value: number): string {
	if (signal.size === 1) return value ? "on" : "off";
	return value.toFixed(precisionFor(signal.factor));
}

function prefersReducedMotion(): boolean {
	return (
		typeof matchMedia !== "undefined" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * One signal's latest value, flashing in the highlight color whenever it
 * changes and fading back.
 *
 * The fade runs on the Web Animations API rather than React state or a
 * requestAnimationFrame loop: a busy bus updates hundreds of these many times
 * a second, and driving the colour through render would put the whole page's
 * frame budget behind it. Here the effect fires once per change and the
 * compositor does the rest.
 */
export function LiveSignalValue({
	signal,
	live,
	settings,
}: {
	signal: DbcSignal;
	live: LiveSignal;
	settings: VisualizeSettings;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const { changedAt } = live;

	// Keyed on `changedAt` alone, so re-renders that do not carry a new change
	// (a sibling signal updating, a settings tweak) leave the fade running.
	// biome-ignore lint/correctness/useExhaustiveDependencies: restarting the fade is exactly what a new changedAt means
	useEffect(() => {
		if (changedAt === undefined) return;
		const element = ref.current;
		if (!element) return;

		const animation = element.animate(
			[
				{ backgroundColor: settings.highlightColor },
				{ backgroundColor: "transparent" },
			],
			{
				duration: settings.fadeMs,
				// Reduced motion still gets the highlight — it just holds and
				// snaps back instead of sweeping through the intermediate colors.
				easing: prefersReducedMotion() ? "steps(1, end)" : "linear",
				fill: "forwards",
			},
		);
		return () => animation.cancel();
	}, [changedAt]);

	return (
		<div
			ref={ref}
			data-slot="live-signal-value"
			className="flex items-baseline justify-between gap-2 rounded-sm px-1.5 py-0.5"
		>
			<span className="truncate text-xs text-muted-foreground">
				{signal.name}
			</span>
			<span className="flex shrink-0 items-baseline gap-1">
				<span
					className={cn(
						"font-mono text-xs tabular-nums",
						signal.size === 1 && "uppercase",
					)}
				>
					{formatValue(signal, live.value)}
				</span>
				{signal.unit && (
					<span className="text-[10px] text-muted-foreground">
						{signal.unit}
					</span>
				)}
			</span>
		</div>
	);
}
