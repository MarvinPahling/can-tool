import { memo, useEffect, useRef } from "react";
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

/**
 * The reduced-motion preference, read once and kept current by its own
 * listener.
 *
 * This used to call `matchMedia` inside the fade effect — once per animation,
 * so up to once per flush per changing signal. Every call allocates a
 * `MediaQueryList` that the document's media-query matcher registers, and
 * thousands a second is a known way to grow a renderer. Created lazily rather
 * than at import so it costs nothing in a context without `matchMedia`.
 */
let reducedMotionQuery: MediaQueryList | null | undefined;
let reducedMotion = false;

function prefersReducedMotion(): boolean {
	if (reducedMotionQuery === undefined) {
		reducedMotionQuery =
			typeof matchMedia === "undefined"
				? null
				: matchMedia("(prefers-reduced-motion: reduce)");

		if (reducedMotionQuery) {
			reducedMotion = reducedMotionQuery.matches;
			reducedMotionQuery.addEventListener?.("change", (event) => {
				reducedMotion = event.matches;
			});
		}
	}
	return reducedMotion;
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
 *
 * Memoized, which is only worth anything because `applyFrames` returns an
 * unchanged `LiveSignal` by identity: a message with twenty signals where two
 * moved re-renders two rows, not twenty.
 */
export const LiveSignalValue = memo(function LiveSignalValue({
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

	// The fade reads the settings through a ref, so changing the colour or the
	// duration does not restart a fade already running — but the *next* one
	// picks it up. Reading them directly meant a settings change did nothing
	// until the signal happened to move again. Declared above the fade effect
	// so it has already run by the time that one fires in the same commit.
	const settingsRef = useRef(settings);
	useEffect(() => {
		settingsRef.current = settings;
	});

	// Keyed on `changedAt` alone, so re-renders that do not carry a new change
	// (a sibling signal updating, a settings tweak) leave the fade running.
	useEffect(() => {
		if (changedAt === undefined) return;
		const element = ref.current;
		if (!element) return;

		const { highlightColor, fadeMs } = settingsRef.current;
		const animation = element.animate(
			[{ backgroundColor: highlightColor }, { backgroundColor: "transparent" }],
			{
				duration: fadeMs,
				// Reduced motion still gets the highlight — it just holds and
				// snaps back instead of sweeping through the intermediate colors.
				easing: prefersReducedMotion() ? "steps(1, end)" : "linear",
				fill: "forwards",
			},
		);

		// A finished `fill: "forwards"` animation does not go away: it stays
		// alive on the element, holding a reference to it and remaining in
		// `document.getAnimations()`, because it is still responsible for the
		// computed background. One per rendered row, for as long as the row
		// exists. Committing the final style and cancelling hands that
		// responsibility back to the element and lets the animation go.
		animation.onfinish = () => {
			try {
				animation.commitStyles();
			} catch {
				// Throws if the row was detached mid-fade. The fade is
				// cosmetic; never let it take the row down.
			}
			animation.cancel();
		};

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
});
