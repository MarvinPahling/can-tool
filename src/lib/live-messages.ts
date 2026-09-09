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

/** Latest state per CAN id. */
export type LiveState = Map<number, LiveMessage>;

/** A DBC message plus a name lookup for its signals, prepared once per batch. */
interface MessageDefinition {
	message: DbcMessage;
	signalsByName: Map<string, DbcSignal>;
}

/**
 * Folds a batch of received frames into the latest-known state per CAN id.
 *
 * Pure: returns a new map and new entries, never touching the state it was
 * given. The visualize route keeps this in a ref and flushes to React on a
 * timer, so an accidental mutation would render as silently stale data.
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
 */
export function applyFrames(
	state: LiveState,
	frames: CanFrame[],
	dbc: DbcFile | undefined,
	settings: ChangeThresholdSettings,
): LiveState {
	if (frames.length === 0) return state;

	// Built once per batch, not per frame: looking a signal definition up with
	// `signals.find` inside the decode loop would be quadratic in the signal
	// count on every single frame.
	const definitions = new Map<number, MessageDefinition>(
		dbc?.messages.map((message) => [
			message.id,
			{
				message,
				signalsByName: new Map(
					message.signals.map((signal) => [signal.name, signal]),
				),
			},
		]),
	);

	const next: LiveState = new Map(state);
	for (const frame of frames) {
		const previous = next.get(frame.id);
		const definition = definitions.get(frame.id);

		const signals: Record<string, LiveSignal> = { ...previous?.signals };
		if (definition) {
			for (const [name, value] of Object.entries(
				decodeMessage(definition.message, frame.data),
			)) {
				const before = previous?.signals[name];
				const signal = definition.signalsByName.get(name);
				const changed =
					signal !== undefined &&
					hasSignificantChange(signal, before?.value, value, settings);

				signals[name] = {
					value,
					previous: before?.value,
					changedAt: changed ? frame.timestamp_ms : before?.changedAt,
				};
			}
		}

		next.set(frame.id, {
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
	return next;
}
