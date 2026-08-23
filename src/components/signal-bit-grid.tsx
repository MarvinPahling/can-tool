import type { MouseEvent } from "react";
import type { DbcMessage, DbcSignal } from "@/api/dbc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRequestSendMessage } from "@/lib/pending-send";
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
	const requestSendMessage = useRequestSendMessage();

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
										key={index}
										index={index}
										color={
											ownerIndex >= 0 ? getSignalColor(ownerIndex) : undefined
										}
										dimmed={hoveredSignal != null && !isHovered}
										isHovered={isHovered}
										title={
											owner
												? `${owner.name} — bit ${index} (${modKeyLabel}-click to send this message)`
												: `bit ${index}`
										}
										onMouseEnter={() => owner && onSignalHover?.(owner)}
										onMouseLeave={() => owner && onSignalHover?.(null)}
										onClick={(e) => {
											if (e.metaKey || e.ctrlKey)
												requestSendMessage(String(message.id));
										}}
									/>
								);
							})}
						</div>

						<div className="flex flex-wrap gap-x-4 gap-y-1.5">
							{message.signals.map((signal, index) => (
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
