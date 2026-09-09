import { describe, expect, it } from "vitest";
import type { CanFrame } from "@/api/can";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";
import { applyFrames, type LiveState } from "./live-messages";

const settings = { thresholdEnabled: false, thresholdPercent: 0 };

function makeFrame(overrides: Partial<CanFrame> = {}): CanFrame {
	return {
		id: 100,
		extended: false,
		fd: false,
		bitrate_switch: false,
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

const empty: LiveState = new Map();

describe("applyFrames", () => {
	it("carries the CAN FD flags of the latest frame", () => {
		const state = applyFrames(
			empty,
			[
				makeFrame({
					fd: true,
					bitrate_switch: true,
					data: new Array(16).fill(1),
				}),
			],
			dbc,
			settings,
		);

		const live = state.get(100);
		expect(live?.fd).toBe(true);
		expect(live?.bitrateSwitch).toBe(true);
		// A 16-byte payload is FD-only, and nothing in the fold truncates it.
		expect(live?.data).toHaveLength(16);
	});

	it("decodes a frame into its named signals", () => {
		const state = applyFrames(
			empty,
			[makeFrame({ data: [0x11, 0x22] })],
			dbc,
			settings,
		);

		const live = state.get(100);
		expect(live?.message?.name).toBe("Status");
		expect(live?.data).toEqual([0x11, 0x22]);
		expect(live?.signals.A?.value).toBe(0x11);
		expect(live?.signals.B?.value).toBe(0x22);
	});

	it("does not mark anything as changed on the first frame", () => {
		const state = applyFrames(empty, [makeFrame()], dbc, settings);

		const live = state.get(100);
		expect(live?.count).toBe(1);
		expect(live?.signals.A?.previous).toBeUndefined();
		expect(live?.signals.A?.changedAt).toBeUndefined();
	});

	it("leaves changedAt untouched when the payload repeats", () => {
		const first = applyFrames(
			empty,
			[makeFrame({ data: [1, 2] })],
			dbc,
			settings,
		);
		const changed = applyFrames(
			first,
			[makeFrame({ data: [9, 2], timestamp_ms: 2000 })],
			dbc,
			settings,
		);
		const repeated = applyFrames(
			changed,
			[makeFrame({ data: [9, 2], timestamp_ms: 3000 })],
			dbc,
			settings,
		);

		// A still-fading highlight must keep fading, not restart on every
		// frame of an otherwise-static signal.
		expect(repeated.get(100)?.signals.A?.changedAt).toBe(2000);
	});

	it("bumps changedAt only for the signal that actually changed", () => {
		const first = applyFrames(
			empty,
			[makeFrame({ data: [1, 2] })],
			dbc,
			settings,
		);
		const second = applyFrames(
			first,
			[makeFrame({ data: [1, 3], timestamp_ms: 2000 })],
			dbc,
			settings,
		);

		expect(second.get(100)?.signals.A?.changedAt).toBeUndefined();
		expect(second.get(100)?.signals.B?.changedAt).toBe(2000);
		expect(second.get(100)?.signals.B?.previous).toBe(2);
	});

	it("advances count and receivedAt on every frame", () => {
		let state = applyFrames(empty, [makeFrame()], dbc, settings);
		state = applyFrames(
			state,
			[makeFrame({ timestamp_ms: 2000 })],
			dbc,
			settings,
		);
		state = applyFrames(
			state,
			[makeFrame({ timestamp_ms: 3000 })],
			dbc,
			settings,
		);

		expect(state.get(100)?.count).toBe(3);
		expect(state.get(100)?.receivedAt).toBe(3000);
	});

	it("collapses a batch to the latest value with the preceding previous", () => {
		const state = applyFrames(
			empty,
			[
				makeFrame({ data: [1, 0], timestamp_ms: 1000 }),
				makeFrame({ data: [2, 0], timestamp_ms: 2000 }),
				makeFrame({ data: [3, 0], timestamp_ms: 3000 }),
			],
			dbc,
			settings,
		);

		const a = state.get(100)?.signals.A;
		expect(a?.value).toBe(3);
		expect(a?.previous).toBe(2);
		expect(a?.changedAt).toBe(3000);
		expect(state.get(100)?.count).toBe(3);
	});

	it("records frames whose id is not in the DBC", () => {
		const state = applyFrames(
			empty,
			[makeFrame({ id: 999, data: [0xaa] })],
			dbc,
			settings,
		);

		const live = state.get(999);
		expect(live?.message).toBeUndefined();
		expect(live?.data).toEqual([0xaa]);
		expect(live?.signals).toEqual({});
	});

	it("treats every frame as unknown when no DBC is loaded", () => {
		const state = applyFrames(empty, [makeFrame()], undefined, settings);
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

		const first = applyFrames(
			empty,
			[makeFrame({ data: [0, 0x11] })],
			muxDbc,
			settings,
		);
		const second = applyFrames(
			first,
			[makeFrame({ data: [1, 0x22], timestamp_ms: 2000 })],
			muxDbc,
			settings,
		);

		expect(second.get(100)?.signals.OnZero?.value).toBe(0x11);
		expect(second.get(100)?.signals.OnOne?.value).toBe(0x22);
	});

	it("respects the threshold when deciding what changed", () => {
		const first = applyFrames(
			empty,
			[makeFrame({ data: [100, 0] })],
			dbc,
			settings,
		);
		const second = applyFrames(
			first,
			[makeFrame({ data: [140, 0], timestamp_ms: 2000 })],
			dbc,
			{ thresholdEnabled: true, thresholdPercent: 20 },
		);

		// 40 of a 0–255 range is under the 51-wide threshold.
		expect(second.get(100)?.signals.A?.value).toBe(140);
		expect(second.get(100)?.signals.A?.changedAt).toBeUndefined();
	});

	it("does not mutate the state it was given", () => {
		const first = applyFrames(
			empty,
			[makeFrame({ data: [1, 2] })],
			dbc,
			settings,
		);
		const snapshot = structuredClone(first.get(100));

		applyFrames(first, [makeFrame({ data: [9, 9] })], dbc, settings);

		expect(first.get(100)).toEqual(snapshot);
		expect(empty.size).toBe(0);
	});

	it("returns the state unchanged for an empty batch", () => {
		const first = applyFrames(empty, [makeFrame()], dbc, settings);
		expect(applyFrames(first, [], dbc, settings)).toBe(first);
	});
});
