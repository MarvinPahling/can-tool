import type { DbcFile, DbcMessage, DbcSignal } from "@/api/dbc";

export type MessageRow = {
	kind: "message";
	id: string;
	message: DbcMessage;
};

export type SignalRow = {
	kind: "signal";
	id: string;
	signal: DbcSignal;
	message: DbcMessage;
};

export type DbcRow = MessageRow | SignalRow;

/**
 * Flattens messages (and the signals of expanded messages) into a single row
 * list. Expansion is resolved here, up front, rather than through the table's
 * row-expanding feature, since the row list is what the table sorts/filters.
 */
export function buildDbcRows(
	dbc: DbcFile,
	expandedMessageIds: ReadonlySet<number>,
): DbcRow[] {
	return dbc.messages.flatMap((message) => {
		const messageRow: MessageRow = {
			kind: "message",
			id: `msg-${message.id}`,
			message,
		};
		if (!expandedMessageIds.has(message.id)) return [messageRow];
		const signalRows: SignalRow[] = message.signals.map((signal) => ({
			kind: "signal",
			id: `msg-${message.id}-sig-${signal.name}`,
			signal,
			message,
		}));
		return [messageRow, ...signalRows];
	});
}
