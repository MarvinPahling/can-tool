import { useEffect, useRef } from "react";
import { COMMANDS_BY_ID } from "./definitions";

/**
 * A command's implementation, attached at runtime by whichever component
 * currently owns the behavior (e.g. the route that knows how to open a file).
 * Kept separate from the binding so multiple views can implement the same
 * command id without the hotkey registration caring which one is active.
 */
type CommandHandler = () => void;

const handlers = new Map<string, CommandHandler>();

/**
 * Registers the implementation for `commandId` while the calling component is
 * mounted. Safe to call from multiple components over time (e.g. route
 * changes) — the most recently mounted implementation wins, and unmounting
 * restores whatever was registered before it, if anything.
 */
export function useCommandHandler(
	commandId: string,
	handler: CommandHandler,
): void {
	if (import.meta.env.DEV && !COMMANDS_BY_ID[commandId]) {
		console.warn(`useCommandHandler: unknown command id "${commandId}"`);
	}

	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		const previous = handlers.get(commandId);
		handlers.set(commandId, () => handlerRef.current());
		return () => {
			if (previous) {
				handlers.set(commandId, previous);
			} else {
				handlers.delete(commandId);
			}
		};
	}, [commandId]);
}

/** Runs a command's currently-attached implementation, if any is mounted. */
export function runCommand(commandId: string): void {
	handlers.get(commandId)?.();
}

export function hasCommandHandler(commandId: string): boolean {
	return handlers.has(commandId);
}
