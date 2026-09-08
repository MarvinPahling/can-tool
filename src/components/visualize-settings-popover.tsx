import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useVisualizeSettings } from "@/hooks/use-visualize-settings";

/**
 * Reads the single value out of Base UI's slider, which reports an array.
 *
 * Values are passed *in* as arrays too: given a scalar the primitive falls
 * back to `[min, max]` and renders two thumbs.
 */
function single(value: number | readonly number[]): number {
	return Array.isArray(value) ? (value[0] as number) : (value as number);
}

/** Configures how changed values are highlighted, persisted across restarts. */
export function VisualizeSettingsPopover() {
	const { settings, setSettings, resetSettings } = useVisualizeSettings();

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button variant="ghost" size="icon-sm" title="Highlight settings">
						<Settings2 />
						<span className="sr-only">Highlight settings</span>
					</Button>
				}
			/>
			<PopoverContent className="w-72">
				<div className="flex flex-col gap-4">
					<div className="flex items-center justify-between gap-2">
						<Label htmlFor="highlight-color">Highlight color</Label>
						<input
							id="highlight-color"
							type="color"
							className="h-6 w-10 cursor-pointer rounded-sm border border-border bg-transparent"
							value={settings.highlightColor}
							onChange={(event) =>
								setSettings({ highlightColor: event.target.value })
							}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<Label htmlFor="fade-duration">Fade duration</Label>
							<span className="font-mono text-xs text-muted-foreground">
								{settings.fadeMs} ms
							</span>
						</div>
						<Slider
							id="fade-duration"
							aria-label="Fade duration"
							min={100}
							max={5000}
							step={100}
							value={[settings.fadeMs]}
							onValueChange={(value) => setSettings({ fadeMs: single(value) })}
						/>
					</div>

					<Separator />

					<div className="flex items-center justify-between gap-2">
						<Label htmlFor="threshold-enabled" className="leading-tight">
							Only highlight significant changes
						</Label>
						<Switch
							id="threshold-enabled"
							checked={settings.thresholdEnabled}
							onCheckedChange={(checked) =>
								setSettings({ thresholdEnabled: checked })
							}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<Label htmlFor="threshold-percent">Threshold</Label>
							<span className="font-mono text-xs text-muted-foreground">
								{settings.thresholdPercent}%
							</span>
						</div>
						<Slider
							id="threshold-percent"
							aria-label="Threshold"
							min={0}
							max={100}
							step={1}
							disabled={!settings.thresholdEnabled}
							value={[settings.thresholdPercent]}
							onValueChange={(value) =>
								setSettings({ thresholdPercent: single(value) })
							}
						/>
						<p className="text-[10px] text-muted-foreground">
							As a percentage of each signal's full range.
						</p>
					</div>

					<Button variant="outline" size="sm" onClick={resetSettings}>
						Reset to defaults
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
