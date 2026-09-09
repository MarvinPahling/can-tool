import { useNavigate } from "@tanstack/react-router";
import { defaultSignalValues } from "@/lib/signal-values";
import {
	addSimulationEntry,
	simulationEntriesStore,
	updateSimulationEntry,
} from "@/lib/simulation-entries";
import { useCurrentDbc } from "@/queries/dbc";

/**
 * Puts a message on the simulation board and goes there.
 *
 * Replaces the query-cache handshake the send dialog needed: it was mounted
 * globally and had to be woken from anywhere, so a request had to travel
 * through `["send","pendingMessage"]`. A route and a persisted store make that
 * indirection unnecessary — this writes the entry and navigates.
 */
export function useAddToSimulation(): (messageId: string) => void {
	const navigate = useNavigate();
	const dbc = useCurrentDbc();

	return (messageId: string) => {
		// Clicking the same message twice should take you to the card you
		// already have, not stack up duplicates of it.
		const existing = simulationEntriesStore.state.find(
			(entry) => entry.messageId === messageId,
		);

		if (!existing) {
			const id = addSimulationEntry(messageId);
			const message = dbc.data?.messages.find(
				(candidate) => String(candidate.id) === messageId,
			);
			// Seed the values the way picking a message on the card does, so the
			// new entry encodes instead of opening on a wall of "Required".
			if (message) {
				updateSimulationEntry(id, { values: defaultSignalValues(message) });
			}
		}

		navigate({ to: "/simulate" });
	};
}
