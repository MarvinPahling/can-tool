import { Store } from "@tanstack/react-store";

export const CONNECT_SETTINGS_STORAGE_KEY = "can-tool:connect-settings";

export interface ConnectSettings {
	/**
	 * Open the adapter in slcan listen-only mode (`L` rather than `O`): it
	 * receives frames but never transmits or ACKs. Off by default — a fair
	 * number of adapters stop delivering frames entirely in this mode, and the
	 * CANable 2.0 firmware in particular stops delivering the full CAN FD
	 * traffic.
	 */
	readOnly: boolean;
	/**
	 * The CAN FD data-phase bitrate (`Y2`/`Y5`), or `null` for classic CAN.
	 * Like `readOnly` this is a property of the bus rather than of the session,
	 * so it is worth remembering between runs.
	 */
	dataBitrate: number | null;
}

export const DEFAULT_CONNECT_SETTINGS: ConnectSettings = {
	readOnly: false,
	// The buses this tool is pointed at are CAN FD at 2 Mbit/s; a classic-CAN
	// bus is a `null` away, and auto-detect overwrites this either way.
	dataBitrate: 2_000_000,
};

/**
 * Applies stored or user-supplied values over a base, ignoring anything of the
 * wrong type — storage is user-writable and survives across app versions, so
 * nothing read back from it is trusted.
 */
function merge(
	base: ConnectSettings,
	patch: Partial<ConnectSettings> | undefined,
): ConnectSettings {
	const next = { ...base };
	if (!patch) return next;

	if (typeof patch.readOnly === "boolean") {
		next.readOnly = patch.readOnly;
	}
	if (patch.dataBitrate === null || typeof patch.dataBitrate === "number") {
		next.dataBitrate = patch.dataBitrate;
	}
	return next;
}

/** Reads persisted settings, falling back to the defaults for anything missing. */
export function loadConnectSettings(): ConnectSettings {
	if (typeof localStorage === "undefined") return DEFAULT_CONNECT_SETTINGS;
	try {
		const raw = localStorage.getItem(CONNECT_SETTINGS_STORAGE_KEY);
		if (!raw) return DEFAULT_CONNECT_SETTINGS;
		return merge(
			DEFAULT_CONNECT_SETTINGS,
			JSON.parse(raw) as Partial<ConnectSettings>,
		);
	} catch {
		return DEFAULT_CONNECT_SETTINGS;
	}
}

export const connectSettingsStore = new Store<ConnectSettings>(
	loadConnectSettings(),
);

connectSettingsStore.subscribe(() => {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(
		CONNECT_SETTINGS_STORAGE_KEY,
		JSON.stringify(connectSettingsStore.state),
	);
});

/** Updates one or more settings, persisting the result. */
export function setConnectSettings(patch: Partial<ConnectSettings>): void {
	connectSettingsStore.setState((state) => merge(state, patch));
}

export function resetConnectSettings(): void {
	connectSettingsStore.setState(() => ({ ...DEFAULT_CONNECT_SETTINGS }));
}
