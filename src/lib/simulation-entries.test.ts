import { afterEach, describe, expect, it } from "vitest";
import { MAX_PERIOD_MS, MIN_PERIOD_MS } from "./period";
import {
	addSimulationEntry,
	clearSimulationEntries,
	DEFAULT_PERIOD_MS,
	SIMULATION_ENTRIES_STORAGE_KEY as KEY,
	loadSimulationEntries,
	MAX_ENTRIES,
	parseSimulationEntries,
	removeSimulationEntry,
	setSimulationValue,
	simulationEntriesStore,
	updateSimulationEntry,
} from "./simulation-entries";

function stored() {
	return JSON.parse(localStorage.getItem(KEY) ?? "[]");
}

function entry(overrides: Record<string, unknown> = {}) {
	return {
		id: "e1",
		messageId: "278",
		values: { Value: 1 },
		periodMs: 20,
		checksumSignal: "",
		enabled: true,
		...overrides,
	};
}

afterEach(() => {
	clearSimulationEntries();
	localStorage.clear();
});

describe("simulationEntriesStore", () => {
	it("starts empty when nothing is stored", () => {
		expect(simulationEntriesStore.state).toEqual([]);
	});

	it("persists an added entry as JSON", () => {
		const id = addSimulationEntry("278");

		expect(simulationEntriesStore.state).toHaveLength(1);
		expect(stored()[0]).toMatchObject({
			id,
			messageId: "278",
			periodMs: DEFAULT_PERIOD_MS,
			enabled: true,
		});
	});

	it("gives every entry a distinct id", () => {
		const first = addSimulationEntry("1");
		const second = addSimulationEntry("1");

		expect(first).not.toBe(second);
	});

	it("stops adding once the board is full", () => {
		for (let i = 0; i < MAX_ENTRIES + 5; i++) addSimulationEntry(String(i));

		expect(simulationEntriesStore.state).toHaveLength(MAX_ENTRIES);
	});

	it("patches one entry and leaves the rest alone", () => {
		const first = addSimulationEntry("1");
		const second = addSimulationEntry("2");

		updateSimulationEntry(first, { periodMs: 20, enabled: false });

		expect(simulationEntriesStore.state[0]).toMatchObject({
			periodMs: 20,
			enabled: false,
		});
		expect(simulationEntriesStore.state[1]).toMatchObject({
			id: second,
			periodMs: DEFAULT_PERIOD_MS,
			enabled: true,
		});
	});

	it("clamps a period patched in below the floor", () => {
		const id = addSimulationEntry("1");

		updateSimulationEntry(id, { periodMs: 0 });

		expect(simulationEntriesStore.state[0]?.periodMs).toBe(MIN_PERIOD_MS);
	});

	it("sets one signal value without disturbing the others", () => {
		const id = addSimulationEntry("1");
		setSimulationValue(id, "Speed", 42);
		setSimulationValue(id, "Gear", 3);
		setSimulationValue(id, "Speed", 43);

		expect(simulationEntriesStore.state[0]?.values).toEqual({
			Speed: 43,
			Gear: 3,
		});
	});

	it("removes an entry by id", () => {
		const first = addSimulationEntry("1");
		const second = addSimulationEntry("2");

		removeSimulationEntry(first);

		expect(simulationEntriesStore.state.map((e) => e.id)).toEqual([second]);
	});
});

describe("parseSimulationEntries", () => {
	it("reads a well-formed board back", () => {
		expect(parseSimulationEntries([entry()])).toEqual([entry()]);
	});

	it("falls back to empty for anything that is not an array", () => {
		for (const raw of [null, undefined, 42, "[]", { id: "e1" }]) {
			expect(parseSimulationEntries(raw)).toEqual([]);
		}
	});

	it("drops entries without a usable id or message", () => {
		const raw = [
			entry({ id: undefined }),
			entry({ id: "" }),
			entry({ id: "ok1", messageId: 278 }),
			entry({ id: "ok2", messageId: "" }),
			entry({ id: "kept" }),
		];

		expect(parseSimulationEntries(raw).map((e) => e.id)).toEqual(["kept"]);
	});

	it("drops a duplicate id rather than giving two cards the same key", () => {
		const raw = [entry({ periodMs: 20 }), entry({ periodMs: 50 })];

		const parsed = parseSimulationEntries(raw);

		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.periodMs).toBe(20);
	});

	it("clamps a stored period into range", () => {
		expect(parseSimulationEntries([entry({ periodMs: 0 })])[0]?.periodMs).toBe(
			MIN_PERIOD_MS,
		);
		expect(
			parseSimulationEntries([entry({ periodMs: 1e12 })])[0]?.periodMs,
		).toBe(MAX_PERIOD_MS);
		expect(
			parseSimulationEntries([entry({ periodMs: "20" })])[0]?.periodMs,
		).toBe(DEFAULT_PERIOD_MS);
	});

	it("drops values that could never encode", () => {
		const raw = [
			entry({
				values: { Good: 1, Nan: Number.NaN, Text: "5", Nested: {} },
			}),
		];

		expect(parseSimulationEntries(raw)[0]?.values).toEqual({ Good: 1 });
	});

	it("defaults a missing enabled flag to on", () => {
		expect(
			parseSimulationEntries([entry({ enabled: undefined })])[0]?.enabled,
		).toBe(true);
		expect(
			parseSimulationEntries([entry({ enabled: "yes" })])[0]?.enabled,
		).toBe(true);
		expect(
			parseSimulationEntries([entry({ enabled: false })])[0]?.enabled,
		).toBe(false);
	});

	it("truncates a board past the maximum", () => {
		const raw = Array.from({ length: MAX_ENTRIES + 10 }, (_, i) =>
			entry({ id: `e${i}` }),
		);

		expect(parseSimulationEntries(raw)).toHaveLength(MAX_ENTRIES);
	});

	it("survives a checksum signal of the wrong type", () => {
		expect(
			parseSimulationEntries([entry({ checksumSignal: 7 })])[0]?.checksumSignal,
		).toBe("");
	});
});

describe("loadSimulationEntries", () => {
	it("reads a persisted board back", () => {
		localStorage.setItem(KEY, JSON.stringify([entry()]));

		expect(loadSimulationEntries()).toEqual([entry()]);
	});

	it("is empty when nothing has been stored", () => {
		expect(loadSimulationEntries()).toEqual([]);
	});

	it("does not throw on malformed JSON", () => {
		// Hand-editing the key badly must not stop the app from loading.
		localStorage.setItem(KEY, "{not json");

		expect(loadSimulationEntries()).toEqual([]);
	});
});
