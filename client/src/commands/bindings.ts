import { Store, useStore } from "@tanstack/react-store";
import { formatHotkeySequence, normalizeRegisterableHotkey } from "@tanstack/hotkeys";
import { COMMANDS, COMMANDS_BY_ID } from "./definitions";
import { isSequenceBinding, type CommandBinding, type CommandDefinition } from "./types";

const ALL_COMMANDS: ReadonlyArray<CommandDefinition> = COMMANDS;

const STORAGE_KEY = "can-tool:command-bindings";

/** User overrides, keyed by command id. Missing entries fall back to the command's default. */
type BindingOverrides = Record<string, CommandBinding>;

function loadOverrides(): BindingOverrides {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BindingOverrides) : {};
  } catch {
    return {};
  }
}

export const bindingOverridesStore = new Store<BindingOverrides>(loadOverrides());

bindingOverridesStore.subscribe(() => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindingOverridesStore.state));
});

export function getEffectiveBinding(commandId: string): CommandBinding {
  const override = bindingOverridesStore.state[commandId];
  if (override) return override;
  return COMMANDS_BY_ID[commandId]!.defaultBinding;
}

export function setCommandBinding(commandId: string, binding: CommandBinding): void {
  bindingOverridesStore.setState((prev) => ({ ...prev, [commandId]: binding }));
}

export function resetCommandBinding(commandId: string): void {
  bindingOverridesStore.setState((prev) => {
    const next = { ...prev };
    delete next[commandId];
    return next;
  });
}

/** React hook returning the live effective binding for a command (default, unless overridden). */
export function useEffectiveBinding(commandId: string): CommandBinding {
  return useStore(bindingOverridesStore, (state) => state[commandId] ?? COMMANDS_BY_ID[commandId]!.defaultBinding);
}

function bindingKey(binding: CommandBinding, platform?: "mac" | "windows" | "linux"): string {
  return isSequenceBinding(binding)
    ? formatHotkeySequence([...binding])
    : normalizeRegisterableHotkey(binding, platform);
}

/**
 * Finds other commands whose effective binding collides with `binding`, so a
 * "customize shortcut" UI can warn before saving. Commands in different
 * scopes never collide with each other, since only one scope is active at a time.
 */
export function findBindingConflicts(
  commandId: string,
  binding: CommandBinding,
  platform?: "mac" | "windows" | "linux",
): Array<{ id: string; label: string }> {
  const targetScope = COMMANDS_BY_ID[commandId]?.scope;
  const key = bindingKey(binding, platform);

  return ALL_COMMANDS.filter((command) => {
    if (command.id === commandId) return false;
    if (command.scope !== targetScope) return false;
    return bindingKey(getEffectiveBinding(command.id), platform) === key;
  }).map((command) => ({ id: command.id, label: command.label }));
}
