import type { MouseEvent } from "react";
import type { DbcMessage, DbcSignal } from "@/api/dbc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAddToSimulation } from "@/hooks/use-add-to-simulation";
import { buildSignalBitMap } from "@/lib/signal-bits";
import { getSignalColor } from "@/lib/signal-colors";
import { cn } from "@/lib/utils";

const modKeyLabel =
	typeof navigator !== "undefined" && /mac/i.test(navigator.platform)
		? "⌘"
		: "Ctrl";

export function SignalBitGrid({
	message,
	hoveredSignal,
	onSignalHover,
}: {
	message: DbcMessage;
	hoveredSignal: DbcSignal | null;
	onSignalHover?: (signal: DbcSignal | null) => void;
}) {
	const bitMap = buildSignalBitMap(message.signals);
	const bitCount = message.size * 8;
	const addToSimulation = useAddToSimulation();

	return (
		<Card>
			<CardHeader>
				<CardTitle>Signal bit layout — {message.name}</CardTitle>
			</CardHeader>
			<CardContent>
				{message.signals.length > 0 ? (
					<div className="space-y-4">
						<div className="flex flex-wrap gap-1">
							{Array.from({ length: bitCount }).map((_, index) => {
								const owners = bitMap.get(index);
								const owner = owners?.[owners.length - 1];
								const ownerIndex = owner ? message.signals.indexOf(owner) : -1;
								const isHovered = owner === hoveredSignal;
								return (
									<BitBox
										// biome-ignore lint/suspicious/noArrayIndexKey: a bit's index is its identity — the grid is a fixed-length window onto the frame, and bit 7 is always bit 7
										key={index}
										index={index}
										color={
											ownerIndex >= 0 ? getSignalColor(ownerIndex) : undefined
										}
										dimmed={hoveredSignal != null && !isHovered}
										isHovered={isHovered}
										title={
											owner
												? `${owner.name} — bit ${index} (${modKeyLabel}-click to simulate this message)`
												: `bit ${index}`
										}
										onMouseEnter={() => owner && onSignalHover?.(owner)}
										onMouseLeave={() => owner && onSignalHover?.(null)}
										onClick={(e) => {
											if (e.metaKey || e.ctrlKey)
												addToSimulation(String(message.id));
										}}
									/>
								);
							})}
						</div>

						<div className="flex flex-wrap gap-x-4 gap-y-1.5">
							{message.signals.map((signal, index) => (
								// biome-ignore lint/a11y/noStaticElementInteractions: hover-only cross-highlighting with no keyboard equivalent to offer — the same signal is reachable, and readable, in the table beside this grid
								<div
									key={signal.name}
									className="flex cursor-default items-center gap-1.5"
									onMouseEnter={() => onSignalHover?.(signal)}
									onMouseLeave={() => onSignalHover?.(null)}
								>
									<span
										className={cn(
											"size-2.5 rounded-full",
											signal === hoveredSignal &&
												"ring-2 ring-foreground ring-offset-1",
										)}
										style={{ backgroundColor: getSignalColor(index) }}
									/>
									<span
										className={cn(
											"text-xs text-muted-foreground",
											signal === hoveredSignal && "text-foreground font-medium",
										)}
									>
										{signal.name}
									</span>
								</div>
							))}
						</div>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						This message has no signals to lay out.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function BitBox({
	index,
	color,
	dimmed,
	isHovered,
	title,
	onMouseEnter,
	onMouseLeave,
	onClick,
}: {
	index: number;
	color?: string;
	dimmed: boolean;
	isHovered: boolean;
	title: string;
	onMouseEnter?: () => void;
	onMouseLeave?: () => void;
	onClick?: (e: MouseEvent) => void;
}) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: see below
		// biome-ignore lint/a11y/useKeyWithClickEvents: making all 64 bit cells focusable would put 64 tab stops in front of a keyboard user to reach an action the DBC table already offers on one focusable row
		<div
			title={title}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			onClick={onClick}
			className={cn(
				"flex size-6 items-center justify-center rounded-sm text-[10px] font-medium tabular-nums",
				color ? "text-primary-foreground" : "bg-muted text-muted-foreground",
				color && "cursor-default",
				color && dimmed && "opacity-40",
				isHovered && "ring-2 ring-foreground",
			)}
			style={color ? { backgroundColor: color } : undefined}
		>
			{index}
		</div>
	);
}
