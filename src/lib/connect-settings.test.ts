import { afterEach, describe, expect, it } from "vitest";
import {
	connectSettingsStore,
	DEFAULT_CONNECT_SETTINGS,
	CONNECT_SETTINGS_STORAGE_KEY as KEY,
	loadConnectSettings,
	resetConnectSettings,
	setConnectSettings,
} from "./connect-settings";

function stored() {
	return JSON.parse(localStorage.getItem(KEY) ?? "{}");
}

afterEach(() => {
	connectSettingsStore.setState(() => ({ ...DEFAULT_CONNECT_SETTINGS }));
	localStorage.clear();
});

describe("connectSettingsStore", () => {
	it("defaults to read-only off, so the normal open path is unchanged", () => {
		expect(connectSettingsStore.state).toEqual(DEFAULT_CONNECT_SETTINGS);
		expect(DEFAULT_CONNECT_SETTINGS.readOnly).toBe(false);
	});

	it("persists a changed setting as JSON", () => {
		setConnectSettings({ readOnly: true });

		expect(connectSettingsStore.state.readOnly).toBe(true);
		expect(stored().readOnly).toBe(true);
	});

	it("reads a stored setting back", () => {
		localStorage.setItem(KEY, JSON.stringify({ readOnly: true }));

		expect(loadConnectSettings()).toEqual({
			...DEFAULT_CONNECT_SETTINGS,
			readOnly: true,
		});
	});

	it("round-trips the CAN FD data bitrate, null included", () => {
		setConnectSettings({ dataBitrate: 5_000_000 });
		expect(stored().dataBitrate).toBe(5_000_000);

		// Null is a real choice — classic CAN — not a missing value, so it has
		// to survive the merge rather than fall back to the FD default.
		setConnectSettings({ dataBitrate: null });
		expect(connectSettingsStore.state.dataBitrate).toBeNull();
		expect(loadConnectSettings().dataBitrate).toBeNull();
	});

	it("falls back to the defaults on corrupt JSON", () => {
		localStorage.setItem(KEY, "{not json");

		expect(loadConnectSettings()).toEqual(DEFAULT_CONNECT_SETTINGS);
	});

	it("ignores a stored value of the wrong type", () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({ readOnly: "yes", dataBitrate: "2M" }),
		);

		expect(loadConnectSettings()).toEqual(DEFAULT_CONNECT_SETTINGS);
	});

	it("restores the defaults on reset", () => {
		setConnectSettings({ readOnly: true });

		resetConnectSettings();

		expect(connectSettingsStore.state).toEqual(DEFAULT_CONNECT_SETTINGS);
		expect(stored().readOnly).toBe(false);
	});
});
