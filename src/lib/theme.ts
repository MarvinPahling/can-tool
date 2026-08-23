import { Store } from "@tanstack/react-store";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "can-tool:theme";

function loadTheme(): Theme {
	if (typeof localStorage === "undefined") return "system";
	const raw = localStorage.getItem(STORAGE_KEY);
	return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function systemPrefersDark(): boolean {
	return (
		typeof matchMedia !== "undefined" &&
		matchMedia("(prefers-color-scheme: dark)").matches
	);
}

function resolveTheme(theme: Theme): ResolvedTheme {
	return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

export const themeStore = new Store<Theme>(loadTheme());

function applyResolvedTheme(theme: Theme): void {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle(
		"dark",
		resolveTheme(theme) === "dark",
	);
}

applyResolvedTheme(themeStore.state);

themeStore.subscribe(() => {
	const theme = themeStore.state;
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(STORAGE_KEY, theme);
	}
	applyResolvedTheme(theme);
});

if (typeof matchMedia !== "undefined") {
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
		if (themeStore.state === "system") applyResolvedTheme("system");
	});
}

export function setTheme(theme: Theme): void {
	themeStore.setState(() => theme);
}

const THEME_CYCLE: Array<Theme> = ["light", "dark", "system"];

export function cycleTheme(): void {
	const next =
		THEME_CYCLE[
			(THEME_CYCLE.indexOf(themeStore.state) + 1) % THEME_CYCLE.length
		]!;
	setTheme(next);
}
