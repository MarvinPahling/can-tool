import { useStore } from "@tanstack/react-store";
import {
	cycleTheme,
	type ResolvedTheme,
	setTheme,
	type Theme,
	themeStore,
} from "@/lib/theme";

function systemPrefersDark(): boolean {
	return (
		typeof matchMedia !== "undefined" &&
		matchMedia("(prefers-color-scheme: dark)").matches
	);
}

/** Live theme state plus setters. `resolvedTheme` follows the OS when `theme` is `"system"`. */
export function useTheme(): {
	theme: Theme;
	resolvedTheme: ResolvedTheme;
	setTheme: (theme: Theme) => void;
	cycleTheme: () => void;
} {
	const theme = useStore(themeStore, (state) => state);
	const resolvedTheme: ResolvedTheme =
		theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;

	return { theme, resolvedTheme, setTheme, cycleTheme };
}
