import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_VISUALIZE_SETTINGS,
	VISUALIZE_SETTINGS_STORAGE_KEY as KEY,
	resetVisualizeSettings,
	setVisualizeSettings,
	visualizeSettingsStore,
} from "./visualize-settings";

function stored() {
	return JSON.parse(localStorage.getItem(KEY) ?? "{}");
}

afterEach(() => {
	visualizeSettingsStore.setState(() => ({ ...DEFAULT_VISUALIZE_SETTINGS }));
	localStorage.clear();
});

describe("visualizeSettingsStore", () => {
	it("starts from the defaults when nothing is stored", () => {
		expect(visualizeSettingsStore.state).toEqual(DEFAULT_VISUALIZE_SETTINGS);
	});

	it("persists a changed setting as JSON", () => {
		setVisualizeSettings({ fadeMs: 1200 });

		expect(visualizeSettingsStore.state.fadeMs).toBe(1200);
		expect(stored().fadeMs).toBe(1200);
	});

	it("leaves the other settings alone when one changes", () => {
		setVisualizeSettings({ thresholdEnabled: true });

		expect(visualizeSettingsStore.state.highlightColor).toBe(
			DEFAULT_VISUALIZE_SETTINGS.highlightColor,
		);
		expect(visualizeSettingsStore.state.thresholdEnabled).toBe(true);
	});

	it("clamps out-of-range values on the way in", () => {
		setVisualizeSettings({ fadeMs: 99999, thresholdPercent: 500 });
		expect(visualizeSettingsStore.state.fadeMs).toBe(5000);
		expect(visualizeSettingsStore.state.thresholdPercent).toBe(100);

		setVisualizeSettings({ fadeMs: 0, thresholdPercent: -5 });
		expect(visualizeSettingsStore.state.fadeMs).toBe(100);
		expect(visualizeSettingsStore.state.thresholdPercent).toBe(0);
	});

	it("restores the defaults on reset", () => {
		setVisualizeSettings({ fadeMs: 2000, thresholdEnabled: true });
		resetVisualizeSettings();

		expect(visualizeSettingsStore.state).toEqual(DEFAULT_VISUALIZE_SETTINGS);
		expect(stored()).toEqual(DEFAULT_VISUALIZE_SETTINGS);
	});
});

describe("loading stored settings", () => {
	// The loader runs at module import, so these exercise it directly.
	it("merges stored values over the defaults", async () => {
		localStorage.setItem(KEY, JSON.stringify({ fadeMs: 1500 }));
		const { loadVisualizeSettings } = await import("./visualize-settings");

		expect(loadVisualizeSettings()).toEqual({
			...DEFAULT_VISUALIZE_SETTINGS,
			fadeMs: 1500,
		});
	});

	it("falls back to the defaults on corrupt JSON", async () => {
		localStorage.setItem(KEY, "{not json");
		const { loadVisualizeSettings } = await import("./visualize-settings");

		expect(loadVisualizeSettings()).toEqual(DEFAULT_VISUALIZE_SETTINGS);
	});

	it("clamps and ignores nonsense that was already stored", async () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({ fadeMs: -10, thresholdPercent: 900, bogus: 1 }),
		);
		const { loadVisualizeSettings } = await import("./visualize-settings");

		const loaded = loadVisualizeSettings();
		expect(loaded.fadeMs).toBe(100);
		expect(loaded.thresholdPercent).toBe(100);
		expect(loaded).not.toHaveProperty("bogus");
	});

	it("ignores stored values of the wrong type", async () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({ fadeMs: "soon", thresholdEnabled: "yes" }),
		);
		const { loadVisualizeSettings } = await import("./visualize-settings");

		expect(loadVisualizeSettings()).toEqual(DEFAULT_VISUALIZE_SETTINGS);
	});
});

describe("maxLiveIds", () => {
	it("is off by default, because a cap hides real traffic", () => {
		expect(DEFAULT_VISUALIZE_SETTINGS.maxLiveIds).toBeNull();
	});

	it("keeps an explicit null rather than reading it as absent", () => {
		setVisualizeSettings({ maxLiveIds: 512 });
		setVisualizeSettings({ maxLiveIds: null });

		expect(visualizeSettingsStore.state.maxLiveIds).toBeNull();
	});

	it("clamps a hand-edited cap into something renderable", () => {
		setVisualizeSettings({ maxLiveIds: 0 });
		expect(visualizeSettingsStore.state.maxLiveIds).toBe(1);

		setVisualizeSettings({ maxLiveIds: 10_000_000 });
		expect(visualizeSettingsStore.state.maxLiveIds).toBe(100_000);
	});

	it("rounds a fractional cap", () => {
		setVisualizeSettings({ maxLiveIds: 12.7 });
		expect(visualizeSettingsStore.state.maxLiveIds).toBe(13);
	});

	it("ignores a cap of the wrong type", () => {
		setVisualizeSettings({ maxLiveIds: 64 });
		setVisualizeSettings({
			maxLiveIds: "lots",
		} as unknown as Partial<typeof DEFAULT_VISUALIZE_SETTINGS>);

		expect(visualizeSettingsStore.state.maxLiveIds).toBe(64);
	});
});
