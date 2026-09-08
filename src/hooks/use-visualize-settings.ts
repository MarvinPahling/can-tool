import { useStore } from "@tanstack/react-store";
import {
	resetVisualizeSettings,
	setVisualizeSettings,
	type VisualizeSettings,
	visualizeSettingsStore,
} from "@/lib/visualize-settings";

/** Live highlight settings plus setters, persisted across restarts. */
export function useVisualizeSettings(): {
	settings: VisualizeSettings;
	setSettings: (patch: Partial<VisualizeSettings>) => void;
	resetSettings: () => void;
} {
	const settings = useStore(visualizeSettingsStore, (state) => state);

	return {
		settings,
		setSettings: setVisualizeSettings,
		resetSettings: resetVisualizeSettings,
	};
}
