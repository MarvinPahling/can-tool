import { useStore } from "@tanstack/react-store";
import {
	addSimulationEntry,
	clearSimulationEntries,
	removeSimulationEntry,
	type SimulationEntry,
	setSimulationValue,
	simulationEntriesStore,
	updateSimulationEntry,
} from "@/lib/simulation-entries";

/** The simulation board plus its mutators, persisted across restarts. */
export function useSimulationEntries(): {
	entries: SimulationEntry[];
	addEntry: (messageId?: string) => string;
	updateEntry: (
		id: string,
		patch: Partial<Omit<SimulationEntry, "id">>,
	) => void;
	setValue: (id: string, signalName: string, value: number) => void;
	removeEntry: (id: string) => void;
	clearEntries: () => void;
} {
	const entries = useStore(simulationEntriesStore, (state) => state);

	return {
		entries,
		addEntry: addSimulationEntry,
		updateEntry: updateSimulationEntry,
		setValue: setSimulationValue,
		removeEntry: removeSimulationEntry,
		clearEntries: clearSimulationEntries,
	};
}
