import { formatForDisplay } from "@tanstack/hotkeys";
import { type CommandBinding, isSequenceBinding } from "./types";

/** Platform-aware display string for a binding, e.g. "⌘O" on macOS, "Ctrl+O" elsewhere. */
export function formatBinding(binding: CommandBinding): string {
	if (isSequenceBinding(binding)) {
		return binding.map((chord) => formatForDisplay(chord)).join(" then ");
	}
	return formatForDisplay(binding);
}
