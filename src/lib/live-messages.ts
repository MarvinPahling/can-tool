import type { CanFrame } from "@/api/can";
import type { DbcFile, DbcMessage, DbcSignal } from "@/api/dbc";
import { decodeMessage } from "./decode-message";
import {
	type ChangeThresholdSettings,
	hasSignificantChange,
} from "./signal-change";

/** The latest value of one signal, plus what it takes to fade its highlight. */
export interface LiveSignal {
	value: number;
	/** The value carried by the previous frame; unset on the very first one. */
	previous?: number;
	/** When this signal last changed *significantly*; unset if it never has. */
	changedAt?: number;
}

/** The latest frame seen for one CAN id, decoded as far as the DBC allows. */
export interface LiveMessage {
	/** Unset when this id is not in the loaded DBC. */
	message?: DbcMessage;
	id: number;
	extended: boolean;
	/** The latest frame for this id was CAN FD. */
	fd: boolean;
	/** The latest frame for this id switched to the faster data bitrate. */
	bitrateSwitch: boolean;
	data: number[];
	receivedAt: number;
	count: number;
	signals: Record<string, LiveSignal>;
}

/**
 * Latest state per CAN id.
 *
 * Iteration order is **last-seen first to last-seen last** — `applyFrames`
 * re-inserts on every frame — which is what lets `evictOldest` drop the
 * stalest ids by taking from the front.
 */
export type LiveState = Map<number, LiveMessage>;

/**
 * What a batch did to the set of ids, as opposed to their contents.
 *
 * The caller renders in id order but the map is kept in recency order, so it
 * has to sort — and re-sorting thousands of ids twenty times a second for a
 * set that has not changed is most of the cost of a flush. Either number being
 * non-zero is what makes the cached order stale.
 */
export interface ApplyResult {
	/** Ids seen for the first time. */
	inserted: number;
	/** Ids dropped to stay within the cap. Always 0 when there is no cap. */
	evicted: number;
}

/** A DBC message plus a name lookup for its signals. */
interface MessageDefinition {
	message: DbcMessage;
	signalsByName: Map<string, DbcSignal>;
}

/**
 * The DBC, indexed for decoding.
 *
 * Built once per loaded file rather than once per batch. The index is
 * O(messages x signals) to build and does not depend on the frames at all, so
 * rebuilding it inside `applyFrames` cost a large DBC on the order of a
 * hundred thousand Map entries thirty times a second, every second, all of it
 * immediately garbage.
 */
export type MessageIndex = Map<number, MessageDefinition>;

export function buildMessageIndex(dbc: DbcFile | undefined): MessageIndex {
	const index: MessageIndex = new Map();
	for (const message of dbc?.messages ?? []) {
		index.set(message.id, {
			message,
			signalsByName: new Map(
				message.signals.map((signal) => [signal.name, signal]),
			),
		});
	}
	return index;
}

/** Shared, never written to: `signals` is cloned before any change. */
const NO_SIGNALS: Record<string, LiveSignal> = Object.freeze({});

/**
 * Folds a batch of received frames into the latest-known state per CAN id.
 *
 * **Mutates `state` in place**, and this is a deliberate change from the
 * original contract. The one caller keeps the state in a ref and flushes to
 * React on its own timer, so it is the sole owner; copying the whole map on
 * every batch bought nothing and grew more expensive with every distinct id
 * ever seen. Do not "restore purity" here without also changing that owner —
 * and note the two consequences below are what React actually renders from.
 *
 * Two behaviors carry the feature:
 *
 * A signal that did not change keeps its existing `changedAt`, so a highlight
 * already fading keeps fading instead of restarting on every frame of an
 * otherwise-static signal.
 *
 * Signals absent from this particular frame are retained. Multiplexed
 * messages carry a different subset each frame, and the last known value of
 * the others should stay on screen rather than flickering away.
 *
 * And one that carries the *cost*: an unchanged `LiveSignal` is returned by
 * **identity**, and a message whose signals all held keeps its `signals`
 * record by identity too. Nothing about the rendered output depends on that,
 * but `React.memo` on the rows does — without it every row of every card
 * re-renders on every flush, and memoizing them would be pure overhead.
 *
 * Reports what the batch did to the *key set* — see `ApplyResult`.
 */
export function applyFrames(
	state: LiveState,
	frames: CanFrame[],
	index: MessageIndex,
	settings: ChangeThresholdSettings,
	maxIds: number | null = null,
): ApplyResult {
	let inserted = 0;

	for (const frame of frames) {
		const previous = state.get(frame.id);
		if (previous === undefined) inserted += 1;
		const definition = index.get(frame.id);

		let signals = previous?.signals ?? NO_SIGNALS;
		let cloned = false;

		if (definition) {
			const decoded = decodeMessage(definition.message, frame.data);
			for (const name in decoded) {
				const value = decoded[name] as number;
				const before = previous?.signals[name];
				const signal = definition.signalsByName.get(name);
				const changedAt =
					signal !== undefined &&
					hasSignificantChange(signal, before?.value, value, settings)
						? frame.timestamp_ms
						: before?.changedAt;

				// Compared field by field rather than by building the
				// replacement and discarding it: allocating to decide whether
				// to allocate would defeat the point.
				if (
					before !== undefined &&
					before.value === value &&
					before.previous === before.value &&
					before.changedAt === changedAt
				) {
					continue;
				}

				if (!cloned) {
					signals = { ...signals };
					cloned = true;
				}
				signals[name] = { value, previous: before?.value, changedAt };
			}
		}

		// Deleted before re-inserting so the map's iteration order tracks how
		// recently each id was seen; `evictOldest` depends on it.
		state.delete(frame.id);
		state.set(frame.id, {
			message: definition?.message,
			id: frame.id,
			extended: frame.extended,
			fd: frame.fd,
			bitrateSwitch: frame.bitrate_switch,
			data: frame.data,
			receivedAt: frame.timestamp_ms,
			count: (previous?.count ?? 0) + 1,
			signals,
		});
	}

	return {
		inserted,
		evicted: maxIds === null ? 0 : evictOldest(state, maxIds),
	};
}

/**
 * Drops the least recently seen ids until at most `cap` remain, returning how
 * many went.
 *
 * Off by default. A bus with an id per source address — J1939, UDS responses —
 * has no natural bound, and one card plus one DOM node per signal per id is
 * what the page cannot survive. But a cap silently hides real traffic, so it
 * is the user's choice to make and the count is surfaced rather than swallowed.
 */
export function evictOldest(state: LiveState, cap: number): number {
	let evicted = 0;
	while (state.size > cap) {
		const oldest = state.keys().next();
		if (oldest.done) break;
		state.delete(oldest.value);
		evicted += 1;
	}
	return evicted;
}
