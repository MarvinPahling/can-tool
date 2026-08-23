import type {
  HotkeyOptions,
  HotkeySequence,
  RegisterableHotkey,
} from "@tanstack/hotkeys";

/**
 * Names of the input contexts a command's binding can be limited to. Commands
 * without a `scope` (or with `"global"`) fire no matter which scope is active;
 * a scoped command only fires while its scope is the topmost one on the stack
 * (see `src/commands/scopes.ts`).
 */
export type CommandScope = "global" | "dbc-table";

/** A single chord (e.g. `"Mod+O"`) or a Vim-style sequence (e.g. `["G", "F"]`). */
export type CommandBinding = RegisterableHotkey | Readonly<HotkeySequence>;

export function isSequenceBinding(
  binding: CommandBinding,
): binding is Readonly<HotkeySequence> {
  return Array.isArray(binding);
}

/**
 * A command is the "what" (id, label, default binding) kept separate from the
 * "how" (the handler attached at runtime by whichever component owns the
 * behavior, via `useCommandHandler`). This is what lets users remap bindings
 * without touching the code that implements the command.
 */
export interface CommandDefinition {
  id: string;
  label: string;
  description?: string;
  /** Which input context this command's binding is active in. Omit for global commands. */
  scope?: CommandScope;
  /** The binding used unless the user has customized it (see `src/commands/bindings.ts`). */
  defaultBinding: CommandBinding;
  /** Overrides for the underlying hotkey/sequence registration options. */
  hotkeyOptions?: Partial<HotkeyOptions>;
}
