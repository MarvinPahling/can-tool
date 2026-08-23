import { Store, useStore } from "@tanstack/react-store";
import { useEffect } from "react";
import type { CommandScope } from "./types";

/**
 * Stack of active scopes, topmost last. A command scoped to `"dbc-table"`
 * only fires while `"dbc-table"` is the topmost scope — e.g. an open dialog
 * pushes its own scope, which suppresses commands scoped to whatever is
 * underneath without the underlying view needing to know about the dialog.
 * Commands with no scope (or `"global"`) always fire, dialog or not.
 */
export const scopeStackStore = new Store<Array<CommandScope>>(["global"]);

export function pushScope(scope: CommandScope): void {
	scopeStackStore.setState((prev) => [...prev, scope]);
}

export function popScope(scope: CommandScope): void {
	scopeStackStore.setState((prev) => {
		const index = prev.lastIndexOf(scope);
		return index === -1
			? prev
			: [...prev.slice(0, index), ...prev.slice(index + 1)];
	});
}

export function isScopeActive(scope: CommandScope | undefined): boolean {
	if (!scope || scope === "global") return true;
	const stack = scopeStackStore.state;
	return stack[stack.length - 1] === scope;
}

/** React hook returning whether `scope` is currently the active (topmost) scope. */
export function useIsScopeActive(scope: CommandScope | undefined): boolean {
	return useStore(scopeStackStore, () => isScopeActive(scope));
}

/**
 * Pushes `scope` onto the stack while the calling component is mounted, and
 * pops it on unmount. Use this in a view (e.g. a table or dialog) to make its
 * scoped commands active only while that view is showing.
 */
export function useScope(scope: CommandScope): void {
	useEffect(() => {
		pushScope(scope);
		return () => popScope(scope);
	}, [scope]);
}
