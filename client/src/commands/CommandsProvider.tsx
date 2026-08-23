import { useEffect } from "react";
import type { ReactNode } from "react";
import { HotkeysProvider, useHotkeys, useHotkeySequences } from "@tanstack/react-hotkeys";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import type { UseHotkeySequenceDefinition } from "@tanstack/react-hotkeys";
import { useStore } from "@tanstack/react-store";
import { listen } from "@tauri-apps/api/event";
import { COMMANDS } from "./definitions";
import { bindingOverridesStore, getEffectiveBinding } from "./bindings";
import { isScopeActive, scopeStackStore } from "./scopes";
import { runCommand } from "./useCommand";
import { isSequenceBinding, type CommandDefinition } from "./types";

const ALL_COMMANDS: ReadonlyArray<CommandDefinition> = COMMANDS;

/**
 * Registers every command's effective binding against the singleton
 * HotkeyManager/SequenceManager, re-registering whenever a binding is
 * customized or the active scope changes. The actual behavior lives
 * wherever `useCommandHandler` was called for that command id — this only
 * decides *whether* a key press should run it.
 */
function CommandBindingsHost() {
  useStore(bindingOverridesStore, (state) => state);
  useStore(scopeStackStore, (state) => state);

  const chordDefinitions: Array<UseHotkeyDefinition> = [];
  const sequenceDefinitions: Array<UseHotkeySequenceDefinition> = [];

  for (const command of ALL_COMMANDS) {
    const binding = getEffectiveBinding(command.id);
    const enabled = isScopeActive(command.scope);
    const callback = () => runCommand(command.id);

    if (isSequenceBinding(binding)) {
      sequenceDefinitions.push({
        sequence: [...binding],
        callback,
        options: { enabled, ...command.hotkeyOptions },
      });
    } else {
      chordDefinitions.push({
        hotkey: binding,
        callback,
        options: { enabled, ...command.hotkeyOptions },
      });
    }
  }

  useHotkeys(chordDefinitions);
  useHotkeySequences(sequenceDefinitions);

  // Native OS menu bar items (see src-tauri/src/lib.rs) share command ids
  // with `COMMANDS`, so a click there runs the exact same implementation a
  // keyboard shortcut would.
  useEffect(() => {
    const unlisten = listen<string>("menu-command", (event) => {
      runCommand(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return null;
}

export function CommandsProvider({ children }: { children: ReactNode }) {
  return (
    <HotkeysProvider>
      <CommandBindingsHost />
      {children}
    </HotkeysProvider>
  );
}
