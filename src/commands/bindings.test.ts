import { afterEach, describe, expect, it } from "vitest";
import {
	bindingOverridesStore,
	findBindingConflicts,
	getEffectiveBinding,
	resetCommandBinding,
	setCommandBinding,
} from "./bindings";

afterEach(() => {
	bindingOverridesStore.setState(() => ({}));
	localStorage.clear();
});

describe("getEffectiveBinding", () => {
	it("falls back to the command's default binding when unset", () => {
		expect(getEffectiveBinding("file.open")).toBe("Mod+O");
	});

	it("returns the overridden binding once set", () => {
		setCommandBinding("file.open", "Mod+Shift+O");
		expect(getEffectiveBinding("file.open")).toBe("Mod+Shift+O");
	});
});

describe("resetCommandBinding", () => {
	it("clears an override, reverting to the default", () => {
		setCommandBinding("file.open", "Mod+Shift+O");
		resetCommandBinding("file.open");
		expect(getEffectiveBinding("file.open")).toBe("Mod+O");
	});

	it("is a no-op for a command with no override", () => {
		resetCommandBinding("file.open");
		expect(getEffectiveBinding("file.open")).toBe("Mod+O");
	});
});

describe("setCommandBinding persistence", () => {
	it("persists overrides to localStorage", () => {
		setCommandBinding("file.open", "Mod+Shift+O");
		const raw = localStorage.getItem("can-tool:command-bindings");
		expect(raw).not.toBeNull();
		const stored = JSON.parse(raw as string);
		expect(stored["file.open"]).toBe("Mod+Shift+O");
	});
});

describe("findBindingConflicts", () => {
	it("finds another global command already using the target binding", () => {
		const conflicts = findBindingConflicts("app.toggleTheme", "Mod+K");
		expect(conflicts).toEqual([
			{ id: "device.connect", label: "Connect Device…" },
		]);
	});

	it("excludes the command being checked from its own conflict list", () => {
		const conflicts = findBindingConflicts("device.connect", "Mod+K");
		expect(conflicts).toEqual([]);
	});

	it("does not flag a collision across different scopes", () => {
		// table.focusFilter is scoped to "dbc-table"; app.showShortcuts is global.
		setCommandBinding("app.showShortcuts", ["G", "F"]);
		const conflicts = findBindingConflicts("table.focusFilter", ["G", "F"]);
		expect(conflicts).toEqual([]);
	});

	it("returns no conflicts for an unused binding", () => {
		expect(findBindingConflicts("file.open", "Mod+Alt+Z")).toEqual([]);
	});
});
