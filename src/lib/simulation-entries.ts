import { Store } from "@tanstack/react-store";
import { clampPeriodMs } from "./period";

export const SIMULATION_ENTRIES_STORAGE_KEY = "can-tool:simulation-entries";

/**
 * Ceiling on how many messages can be on the board at once. Well past any
 * realistic restbus, and a bound on what a corrupted storage key can inflate
 * the page into.
 */
export const MAX_ENTRIES = 64;

/** The period a freshly added message starts at: a common restbus cycle. */
export const DEFAULT_PERIOD_MS = 100;

/** One message on the simulation board. */
export interface SimulationEntry {
	/** Stable local id, so cards keep identity across removal and reordering. */
	id: string;
	/**
	 * The CAN id as a string, matching `String(message.id)`.
	 *
	 * A reference rather than a copy of the `DbcMessage`: the DBC lives in the
	 * Query cache and can be replaced or absent, and an entry that outlived its
	 * file must not carry a stale definition of what it used to mean.
	 */
	messageId: string;
	values: Record<string, number>;
	periodMs: number;
	/** Which signal the checksum generator writes into; empty for none. */
	checksumSignal: string;
	/** Unchecked entries stay on the board but are left out of a run. */
	enabled: boolean;
}

/**
 * Ids only have to be unique within one board, and they are persisted, so they
 * cannot restart from zero on reload. Time plus a counter covers both without
 * depending on `crypto.randomUUID`.
 */
let idCounter = 0;
function nextEntryId(): string {
	idCounter += 1;
	return `${Date.now().toString(36)}-${idCounter}`;
}

function sanitizeValues(raw: unknown): Record<string, number> {
	if (typeof raw !== "object" || raw === null) return {};

	const values: Record<string, number> = {};
	for (const [name, value] of Object.entries(raw)) {
		// A non-finite value would fail to encode and take the whole start down
		// with it, so it is dropped rather than carried.
		if (typeof value === "number" && Number.isFinite(value)) {
			values[name] = value;
		}
	}
	return values;
}

/**
 * Turns whatever was in storage into entries, discarding anything malformed.
 *
 * Nothing read back is trusted. The storage key is user-writable and outlives
 * app versions, and unlike a display setting these values are transmitted:
 * a hand-edited period of `0` has to become the floor rather than a busy loop
 * on the adapter, and an entry without an id would break card identity.
 */
export function parseSimulationEntries(raw: unknown): SimulationEntry[] {
	if (!Array.isArray(raw)) return [];

	const seen = new Set<string>();
	const entries: SimulationEntry[] = [];

	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const entry = item as Partial<SimulationEntry>;

		if (typeof entry.id !== "string" || entry.id === "") continue;
		if (typeof entry.messageId !== "string" || entry.messageId === "") continue;
		// Duplicate ids would give two cards the same React key.
		if (seen.has(entry.id)) continue;
		seen.add(entry.id);

		entries.push({
			id: entry.id,
			messageId: entry.messageId,
			values: sanitizeValues(entry.values),
			periodMs: clampPeriodMs(
				typeof entry.periodMs === "number" ? entry.periodMs : DEFAULT_PERIOD_MS,
			),
			checksumSignal:
				typeof entry.checksumSignal === "string" ? entry.checksumSignal : "",
			// Absent means enabled: an entry the user put on the board is one
			// they meant to send.
			enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
		});

		if (entries.length === MAX_ENTRIES) break;
	}

	return entries;
}

/** Reads the persisted board, falling back to an empty one. */
export function loadSimulationEntries(): SimulationEntry[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const raw = localStorage.getItem(SIMULATION_ENTRIES_STORAGE_KEY);
		if (!raw) return [];
		return parseSimulationEntries(JSON.parse(raw));
	} catch {
		return [];
	}
}

export const simulationEntriesStore = new Store<SimulationEntry[]>(
	loadSimulationEntries(),
);

simulationEntriesStore.subscribe(() => {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(
		SIMULATION_ENTRIES_STORAGE_KEY,
		JSON.stringify(simulationEntriesStore.state),
	);
});

/**
 * Appends an entry, returning its id so the caller can scroll to or focus it.
 * Returns the id of nothing added once the board is full.
 */
export function addSimulationEntry(messageId = ""): string {
	const id = nextEntryId();
	simulationEntriesStore.setState((entries) =>
		entries.length >= MAX_ENTRIES
			? entries
			: [
					...entries,
					{
						id,
						messageId,
						values: {},
						periodMs: DEFAULT_PERIOD_MS,
						checksumSignal: "",
						enabled: true,
					},
				],
	);
	return id;
}

export function updateSimulationEntry(
	id: string,
	patch: Partial<Omit<SimulationEntry, "id">>,
): void {
	simulationEntriesStore.setState((entries) =>
		entries.map((entry) =>
			entry.id === id
				? {
						...entry,
						...patch,
						periodMs: clampPeriodMs(patch.periodMs ?? entry.periodMs),
					}
				: entry,
		),
	);
}

export function setSimulationValue(
	id: string,
	signalName: string,
	value: number,
): void {
	simulationEntriesStore.setState((entries) =>
		entries.map((entry) =>
			entry.id === id
				? { ...entry, values: { ...entry.values, [signalName]: value } }
				: entry,
		),
	);
}

export function removeSimulationEntry(id: string): void {
	simulationEntriesStore.setState((entries) =>
		entries.filter((entry) => entry.id !== id),
	);
}

export function clearSimulationEntries(): void {
	simulationEntriesStore.setState(() => []);
}
