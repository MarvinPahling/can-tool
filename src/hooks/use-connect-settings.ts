import { useStore } from "@tanstack/react-store";
import {
	type ConnectSettings,
	connectSettingsStore,
	resetConnectSettings,
	setConnectSettings,
} from "@/lib/connect-settings";

/** Device connection settings plus setters, persisted across restarts. */
export function useConnectSettings(): {
	settings: ConnectSettings;
	setSettings: (patch: Partial<ConnectSettings>) => void;
	resetSettings: () => void;
} {
	const settings = useStore(connectSettingsStore, (state) => state);

	return {
		settings,
		setSettings: setConnectSettings,
		resetSettings: resetConnectSettings,
	};
}
