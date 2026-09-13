import { describe, expect, it } from "vitest";
import type { CanFrame } from "@/api/can";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";
import {
	applyFrames,
	buildMessageIndex,
	evictOldest,
	type LiveState,
} from "./live-messages";

const settings = { thresholdEnabled: false, thresholdPercent: 0 };

function makeFrame(overrides: Partial<CanFrame> = {}): CanFrame {
	return {
		id: 100,
		extended: false,
		fd: false,
		bitrate_switch: false,
		remote: false,
		data: [0, 0],
		timestamp_ms: 1000,
		...overrides,
	};
}

const dbc = makeDbcFile({
	messages: [
		makeMessage({
			id: 100,
			name: "Status",
			signals: [
				makeSignal({ name: "A", start_bit: 0, size: 8 }),
				makeSignal({ name: "B", start_bit: 8, size: 8 }),
			],
		}),
	],
});

const index = buildMessageIndex(dbc);

/**
 * `applyFrames` mutates and returns an eviction count now, so the tests fold
 * through this and keep reading the state they passed in.
 */
function fold(
	state: LiveState,
	frames: CanFrame[],
	options: {
		index?: ReturnType<typeof buildMessageIndex>;
		maxIds?: number;
		settings?: typeof settings;
	} = {},
): LiveState {
	applyFrames(
		state,
		frames,
		options.index ?? index,
		options.settings ?? settings,
		options.maxIds ?? null,
	);
	return state;
}

/** A fresh map per use: the fold writes into whatever it is given. */
function empty(): LiveState {
	return new Map();
}

describe("applyFrames", () => {
	it("carries the CAN FD flags of the latest frame", () => {
		const state = fold(empty(), [
			makeFrame({
				fd: true,
				bitrate_switch: true,
				data: new Array(16).fill(1),
			}),
		]);

		const live = state.get(100);
		expect(live?.fd).toBe(true);
		expect(live?.bitrateSwitch).toBe(true);
		// A 16-byte payload is FD-only, and nothing in the fold truncates it.
		expect(live?.data).toHaveLength(16);
	});

	it("decodes a frame into its named signals", () => {
		const state = fold(empty(), [makeFrame({ data: [0x11, 0x22] })]);

		const live = state.get(100);
		expect(live?.message?.name).toBe("Status");
		expect(live?.data).toEqual([0x11, 0x22]);
		expect(live?.signals.A?.value).toBe(0x11);
		expect(live?.signals.B?.value).toBe(0x22);
	});

	it("does not mark anything as changed on the first frame", () => {
		const state = fold(empty(), [makeFrame()]);

		const live = state.get(100);
		expect(live?.count).toBe(1);
		expect(live?.signals.A?.previous).toBeUndefined();
		expect(live?.signals.A?.changedAt).toBeUndefined();
	});

	it("leaves changedAt untouched when the payload repeats", () => {
		const first = fold(empty(), [makeFrame({ data: [1, 2] })]);
		const changed = fold(first, [
			makeFrame({ data: [9, 2], timestamp_ms: 2000 }),
		]);
		const repeated = fold(changed, [
			makeFrame({ data: [9, 2], timestamp_ms: 3000 }),
		]);

		// A still-fading highlight must keep fading, not restart on every
		// frame of an otherwise-static signal.
		expect(repeated.get(100)?.signals.A?.changedAt).toBe(2000);
	});

	it("bumps changedAt only for the signal that actually changed", () => {
		const first = fold(empty(), [makeFrame({ data: [1, 2] })]);
		const second = fold(first, [
			makeFrame({ data: [1, 3], timestamp_ms: 2000 }),
		]);

		expect(second.get(100)?.signals.A?.changedAt).toBeUndefined();
		expect(second.get(100)?.signals.B?.changedAt).toBe(2000);
		expect(second.get(100)?.signals.B?.previous).toBe(2);
	});

	it("advances count and receivedAt on every frame", () => {
		let state = fold(empty(), [makeFrame()]);
		state = fold(state, [makeFrame({ timestamp_ms: 2000 })]);
		state = fold(state, [makeFrame({ timestamp_ms: 3000 })]);

		expect(state.get(100)?.count).toBe(3);
		expect(state.get(100)?.receivedAt).toBe(3000);
	});

	it("collapses a batch to the latest value with the preceding previous", () => {
		const state = fold(empty(), [
			makeFrame({ data: [1, 0], timestamp_ms: 1000 }),
			makeFrame({ data: [2, 0], timestamp_ms: 2000 }),
			makeFrame({ data: [3, 0], timestamp_ms: 3000 }),
		]);

		const a = state.get(100)?.signals.A;
		expect(a?.value).toBe(3);
		expect(a?.previous).toBe(2);
		expect(a?.changedAt).toBe(3000);
		expect(state.get(100)?.count).toBe(3);
	});

	it("records frames whose id is not in the DBC", () => {
		const state = fold(empty(), [makeFrame({ id: 999, data: [0xaa] })]);

		const live = state.get(999);
		expect(live?.message).toBeUndefined();
		expect(live?.data).toEqual([0xaa]);
		expect(live?.signals).toEqual({});
	});

	it("treats every frame as unknown when no DBC is loaded", () => {
		const state = fold(empty(), [makeFrame()], {
			index: buildMessageIndex(undefined),
		});
		expect(state.get(100)?.message).toBeUndefined();
	});

	it("keeps signals that this frame did not carry", () => {
		// Multiplexed messages deliver a different subset each frame; the last
		// known value of the others should stay on screen.
		const muxDbc = makeDbcFile({
			messages: [
				makeMessage({
					id: 100,
					signals: [
						makeSignal({
							name: "Mux",
							start_bit: 0,
							size: 8,
							multiplexer: { kind: "Multiplexor" },
						}),
						makeSignal({
							name: "OnZero",
							start_bit: 8,
							size: 8,
							multiplexer: { kind: "MultiplexedSignal", switch_value: 0 },
						}),
						makeSignal({
							name: "OnOne",
							start_bit: 8,
							size: 8,
							multiplexer: { kind: "MultiplexedSignal", switch_value: 1 },
						}),
					],
				}),
			],
		});

		const muxIndex = buildMessageIndex(muxDbc);
		const first = fold(empty(), [makeFrame({ data: [0, 0x11] })], {
			index: muxIndex,
		});
		const second = fold(
			first,
			[makeFrame({ data: [1, 0x22], timestamp_ms: 2000 })],
			{ index: muxIndex },
		);

		expect(second.get(100)?.signals.OnZero?.value).toBe(0x11);
		expect(second.get(100)?.signals.OnOne?.value).toBe(0x22);
	});

	it("respects the threshold when deciding what changed", () => {
		const first = fold(empty(), [makeFrame({ data: [100, 0] })]);
		const second = fold(
			first,
			[makeFrame({ data: [140, 0], timestamp_ms: 2000 })],
			{ settings: { thresholdEnabled: true, thresholdPercent: 20 } },
		);

		// 40 of a 0–255 range is under the 51-wide threshold.
		expect(second.get(100)?.signals.A?.value).toBe(140);
		expect(second.get(100)?.signals.A?.changedAt).toBeUndefined();
	});

	it("folds into the state it was given rather than copying it", () => {
		// The deliberate contract change. The one caller owns this map in a
		// ref and flushes on its own timer, so copying it every batch bought
		// nothing and grew more expensive with every id ever seen.
		const state = empty();
		fold(state, [makeFrame({ data: [1, 2] })]);
		fold(state, [makeFrame({ data: [9, 9], timestamp_ms: 2000 })]);

		expect(state.size).toBe(1);
		expect(state.get(100)?.count).toBe(2);
		expect(state.get(100)?.data).toEqual([9, 9]);
	});

	it("leaves the state alone for an empty batch", () => {
		const state = fold(empty(), [makeFrame()]);
		const live = state.get(100);

		fold(state, []);

		expect(state.get(100)).toBe(live);
	});

	describe("referential stability", () => {
		it("keeps a signal that did not change, by identity", () => {
			// What makes `React.memo` on the rows worth anything: without it
			// every row of every card re-renders on every flush.
			const state = fold(empty(), [makeFrame({ data: [1, 2] })]);
			fold(state, [makeFrame({ data: [1, 2], timestamp_ms: 2000 })]);
			const settled = state.get(100)?.signals.A;

			fold(state, [makeFrame({ data: [1, 2], timestamp_ms: 3000 })]);

			expect(state.get(100)?.signals.A).toBe(settled);
		});

		it("keeps the whole signals record when nothing in it moved", () => {
			const state = fold(empty(), [makeFrame({ data: [1, 2] })]);
			fold(state, [makeFrame({ data: [1, 2], timestamp_ms: 2000 })]);
			const settled = state.get(100)?.signals;

			fold(state, [makeFrame({ data: [1, 2], timestamp_ms: 3000 })]);

			expect(state.get(100)?.signals).toBe(settled);
		});

		it("replaces only the signal that moved", () => {
			const state = fold(empty(), [makeFrame({ data: [1, 2] })]);
			fold(state, [makeFrame({ data: [1, 2], timestamp_ms: 2000 })]);
			const a = state.get(100)?.signals.A;
			const b = state.get(100)?.signals.B;

			fold(state, [makeFrame({ data: [1, 7], timestamp_ms: 3000 })]);

			expect(state.get(100)?.signals.A).toBe(a);
			expect(state.get(100)?.signals.B).not.toBe(b);
			expect(state.get(100)?.signals.B?.value).toBe(7);
		});

		it("still gives the message a new object, because count moved", () => {
			const state = fold(empty(), [makeFrame({ data: [1, 2] })]);
			const live = state.get(100);

			fold(state, [makeFrame({ data: [1, 2], timestamp_ms: 2000 })]);

			expect(state.get(100)).not.toBe(live);
			expect(state.get(100)?.count).toBe(2);
		});
	});

	describe("the key set", () => {
		it("counts an id only the first time it is seen", () => {
			const state = empty();
			expect(
				applyFrames(
					state,
					[makeFrame({ id: 1 }), makeFrame({ id: 2 })],
					index,
					settings,
				).inserted,
			).toBe(2);

			// The caller re-sorts for display only when this moves, so a
			// repeat frame reporting an insertion would sort on every batch.
			expect(
				applyFrames(state, [makeFrame({ id: 1 })], index, settings).inserted,
			).toBe(0);
		});
	});

	describe("eviction", () => {
		it("is off unless a cap is given", () => {
			const state = empty();
			for (let id = 0; id < 50; id++) {
				fold(state, [makeFrame({ id })]);
			}
			expect(state.size).toBe(50);
		});

		it("drops the least recently seen ids and reports how many", () => {
			const state = empty();
			for (let id = 0; id < 5; id++) {
				fold(state, [makeFrame({ id })]);
			}
			// Id 0 is the stalest, so touching it moves it to the back.
			fold(state, [makeFrame({ id: 0, timestamp_ms: 2000 })]);

			const result = applyFrames(
				state,
				[makeFrame({ id: 99, timestamp_ms: 3000 })],
				index,
				settings,
				3,
			);

			expect(result.evicted).toBe(3);
			expect(result.inserted).toBe(1);
			expect([...state.keys()]).toEqual([3, 4, 0, 99].slice(-3));
			expect(state.has(0)).toBe(true);
			expect(state.has(1)).toBe(false);
		});
	});
});

describe("evictOldest", () => {
	it("leaves a state inside the cap alone", () => {
		const state = fold(empty(), [makeFrame()]);
		expect(evictOldest(state, 4)).toBe(0);
		expect(state.size).toBe(1);
	});

	it("empties the state for a cap of zero", () => {
		const state = fold(empty(), [makeFrame()]);
		expect(evictOldest(state, 0)).toBe(1);
		expect(state.size).toBe(0);
	});
});

describe("buildMessageIndex", () => {
	it("indexes messages by id and signals by name", () => {
		const built = buildMessageIndex(dbc);
		expect(built.get(100)?.message.name).toBe("Status");
		expect(built.get(100)?.signalsByName.get("B")?.start_bit).toBe(8);
	});

	it("is empty without a DBC", () => {
		expect(buildMessageIndex(undefined).size).toBe(0);
	});
});
