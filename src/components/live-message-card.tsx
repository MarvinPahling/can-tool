import { LiveSignalValue } from "@/components/live-signal-value";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LiveMessage } from "@/lib/live-messages";
import { bytesToHex } from "@/lib/utils";
import type { VisualizeSettings } from "@/lib/visualize-settings";

/** Formats a CAN id the way it is written on a bus: hex, width by frame format. */
function formatCanId(id: number, extended: boolean): string {
	return `0x${id
		.toString(16)
		.toUpperCase()
		.padStart(extended ? 8 : 3, "0")}`;
}

/**
 * The latest frame for one CAN id: its decoded signals, each flashing as it
 * changes, over the raw payload it came from.
 *
 * Ids absent from the loaded DBC still get a card — unknown traffic is often
 * the thing you opened this page to find — just with no signals to decode.
 */
export function LiveMessageCard({
	live,
	settings,
}: {
	live: LiveMessage;
	settings: VisualizeSettings;
}) {
	const signals = live.message?.signals ?? [];

	return (
		<Card data-slot="live-message-card" className="gap-2 py-3">
			<CardHeader className="px-3">
				<CardTitle className="flex items-baseline justify-between gap-2">
					<span className="truncate">
						{live.message?.name ?? "Unknown message"}
					</span>
					<span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">
						{formatCanId(live.id, live.extended)}
					</span>
				</CardTitle>
				<div className="flex items-center gap-2 text-[10px] text-muted-foreground">
					{live.message ? (
						<span>{`${live.data.length} bytes`}</span>
					) : (
						<Badge variant="outline">Not in DBC</Badge>
					)}
					<span>·</span>
					<span>{`${live.count} frames`}</span>
					{/* Only worth the space when it is true: on a classic bus no card
					    would ever carry these, and on an FD bus the plain frames are
					    the ones that stand out. */}
					{live.fd && <Badge variant="outline">FD</Badge>}
					{live.bitrateSwitch && <Badge variant="outline">BRS</Badge>}
				</div>
			</CardHeader>

			<CardContent className="px-3">
				{signals.length > 0 && (
					<div className="mb-2 flex flex-col gap-px">
						{signals.map((signal) => {
							const value = live.signals[signal.name];
							// A multiplexed signal that no frame has carried yet has
							// nothing to show.
							if (!value) return null;
							return (
								<LiveSignalValue
									key={signal.name}
									signal={signal}
									live={value}
									settings={settings}
								/>
							);
						})}
					</div>
				)}
				<div className="font-mono text-[10px] break-all text-muted-foreground">
					{bytesToHex(live.data)}
				</div>
			</CardContent>
		</Card>
	);
}
