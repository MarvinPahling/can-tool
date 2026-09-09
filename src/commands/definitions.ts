import type { CommandDefinition } from "./types";

/**
 * The single source of truth for every command in the app: its id, label,
 * scope, and default binding. Add new commands here, then attach their
 * behavior elsewhere with `useCommandHandler(id, handler)`.
 */
export const COMMANDS = [
	{
		id: "file.open",
		label: "Open File…",
		description: "Open a DBC file",
		defaultBinding: "Mod+O",
	},
	{
		id: "table.focusFilter",
		label: "Focus Filter",
		description: "Jump to the message/signal filter box",
		scope: "dbc-table",
		defaultBinding: ["G", "F"],
	},
	{
		id: "view.dbc",
		label: "DBC Browser",
		description: "Show the parsed DBC message and signal table",
		defaultBinding: "Mod+1",
	},
	{
		id: "view.visualize",
		label: "Live Traffic",
		description: "Show incoming frames decoded into signal values",
		defaultBinding: "Mod+2",
	},
	{
		id: "view.simulate",
		label: "Simulation",
		description: "Compose messages and cycle them onto the bus",
		defaultBinding: "Mod+3",
	},
	{
		id: "app.showShortcuts",
		label: "Keyboard Shortcuts…",
		description: "Show all shortcuts and let you customize them",
		defaultBinding: "Mod+/",
	},
	{
		id: "app.toggleTheme",
		label: "Toggle Theme",
		description: "Cycle between light, dark, and system theme",
		defaultBinding: "Mod+Shift+L",
	},
	{
		id: "device.connect",
		label: "Connect Device…",
		description: "Find and connect to a CAN adapter",
		defaultBinding: "Mod+K",
	},
	{
		id: "message.send",
		label: "Send CAN Message…",
		description: "Compose and transmit a CAN frame from the loaded DBC",
		defaultBinding: "Mod+Shift+S",
	},
] as const;

// Type-only check: keeps each command's literal id/binding types (for
// `CommandId` below) while still validating the array against the general shape.
COMMANDS satisfies ReadonlyArray<CommandDefinition>;

export type CommandId = (typeof COMMANDS)[number]["id"];

export const COMMANDS_BY_ID: Record<string, CommandDefinition> =
	Object.fromEntries(COMMANDS.map((command) => [command.id, command]));
