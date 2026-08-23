import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
	cleanup();
});

// Node 22+'s own experimental global `localStorage` shadows the one vitest's
// jsdom environment installs on `window` (which vitest aliases to
// `globalThis` itself), so code reading the bare `localStorage` global gets
// Node's non-functional version instead. Re-point it at jsdom's real store,
// reachable via the `jsdom` global vitest exposes for the active DOM.
// biome-ignore lint/suspicious/noExplicitAny: reaching into vitest's jsdom environment internals
const jsdomWindow = (globalThis as any).jsdom.window;
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	get: () => jsdomWindow.localStorage,
});
