import { Store } from "@tanstack/react-store";

export const VISUALIZE_SETTINGS_STORAGE_KEY = "can-tool:visualize-settings";

export interface VisualizeSettings {
	/** CSS color a value flashes in when it changes. */
	highlightColor: string;
	/** How long that flash takes to fade back to normal. */
	fadeMs: number;
	/** Whether small changes are ignored rather than highlighted. */
	thresholdEnabled: boolean;
	/** How large a change must be, as a percentage of the signal's range. */
	thresholdPercent: number;
}

export const DEFAULT_VISUALIZE_SETTINGS: VisualizeSettings = {
	highlightColor: "#f5b942",
	fadeMs: 800,
	thresholdEnabled: false,
	thresholdPercent: 5,
};

const FADE_MS_RANGE = { min: 100, max: 5000 } as const;
const THRESHOLD_PERCENT_RANGE = { min: 0, max: 100 } as const;

function clamp(value: number, { min, max }: { min: number; max: number }) {
	return Math.min(Math.max(value, min), max);
}

/**
 * Applies stored or user-supplied values over a base, ignoring anything of the
 * wrong type and clamping the numbers.
 *
 * Storage is user-writable and survives across app versions, so nothing read
 * back from it is trusted: a hand-edited `fadeMs` of 0 would freeze every
 * highlight on permanently.
 */
function merge(
	base: VisualizeSettings,
	patch: Partial<VisualizeSettings> | undefined,
): VisualizeSettings {
	const next = { ...base };
	if (!patch) return next;

	if (typeof patch.highlightColor === "string") {
		next.highlightColor = patch.highlightColor;
	}
	if (typeof patch.thresholdEnabled === "boolean") {
		next.thresholdEnabled = patch.thresholdEnabled;
	}
	if (typeof patch.fadeMs === "number" && Number.isFinite(patch.fadeMs)) {
		next.fadeMs = clamp(patch.fadeMs, FADE_MS_RANGE);
	}
	if (
		typeof patch.thresholdPercent === "number" &&
		Number.isFinite(patch.thresholdPercent)
	) {
		next.thresholdPercent = clamp(
			patch.thresholdPercent,
			THRESHOLD_PERCENT_RANGE,
		);
	}
	return next;
}

/** Reads persisted settings, falling back to the defaults for anything missing. */
export function loadVisualizeSettings(): VisualizeSettings {
	if (typeof localStorage === "undefined") return DEFAULT_VISUALIZE_SETTINGS;
	try {
		const raw = localStorage.getItem(VISUALIZE_SETTINGS_STORAGE_KEY);
		if (!raw) return DEFAULT_VISUALIZE_SETTINGS;
		return merge(
			DEFAULT_VISUALIZE_SETTINGS,
			JSON.parse(raw) as Partial<VisualizeSettings>,
		);
	} catch {
		return DEFAULT_VISUALIZE_SETTINGS;
	}
}

export const visualizeSettingsStore = new Store<VisualizeSettings>(
	loadVisualizeSettings(),
);

visualizeSettingsStore.subscribe(() => {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(
		VISUALIZE_SETTINGS_STORAGE_KEY,
		JSON.stringify(visualizeSettingsStore.state),
	);
});

/** Updates one or more settings, clamping and persisting the result. */
export function setVisualizeSettings(patch: Partial<VisualizeSettings>): void {
	visualizeSettingsStore.setState((state) => merge(state, patch));
}

export function resetVisualizeSettings(): void {
	visualizeSettingsStore.setState(() => ({ ...DEFAULT_VISUALIZE_SETTINGS }));
}
