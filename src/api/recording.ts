import {
	generateCapture as generateCaptureCommand,
	recordingStatus as recordingStatusCommand,
	replayStatus as replayStatusCommand,
	startRecording as startRecordingCommand,
	startReplay as startReplayCommand,
	stopRecording as stopRecordingCommand,
	stopReplay as stopReplayCommand,
} from "../generated/commands";
import type { DbcFile } from "./dbc";

/**
 * What the recorder is doing.
 *
 * Hand-declared rather than re-exported from `src/generated/types.ts`, for the
 * reason spelled out on `SimulationStatus` in `src/api/simulation.ts`: typegen
 * models a Rust `Option<T>` as an optional field (`T | undefined`) while serde
 * serializes `None` as `null`, and a command's *return* never runs through the
 * generated Zod schema — only its params do. The generated type would be wrong
 * at every use site. Keep in sync with `RecordingStatus` in
 * `src-tauri/src/recording.rs`.
 */
export interface RecordingStatus {
	recording: boolean;
	/** Kept after a stop, so the UI can still say what was written where. */
	path: string | null;
	frames: number;
	bytes: number;
	/**
	 * Set only when the recorder stopped *itself* — a ceiling or a write
	 * error. A deliberate stop leaves it null.
	 */
	stopped_reason: string | null;
}

/** What a finished recording, or a generated capture, produced. */
export interface RecordingSummary {
	path: string;
	frames: number;
	bytes: number;
}

/** What the replay is doing. Hand-declared for the same reason as above. */
export interface ReplayStatus {
	running: boolean;
	path: string | null;
	frames_total: number;
	frames_emitted: number;
	loops: number;
	last_error: string | null;
}

/** Playback controls. `speed: null` replays as fast as possible. */
export interface ReplayOptions {
	speed: number | null;
	repeat: boolean;
}

/**
 * What to generate. Mirrors `CaptureSpec` in `src-tauri/src/generator.rs`;
 * `from_dbc` is `null` rather than optional here so the UI has one shape to
 * hold, and the omission happens at the call below.
 */
export interface CaptureSpec {
	seed: number;
	duration_ms: number;
	id_count: number;
	extended: boolean;
	cycle_ms: number;
	fd_ratio: number;
	brs_ratio: number;
	/**
	 * How much of a payload moves between frames, 0 to 1. Defaulted high on
	 * purpose: a static capture never trips `hasSignificantChange`, so it
	 * creates no highlight and exercises none of the render path worth
	 * measuring.
	 */
	churn: number;
	from_dbc: DbcFile | null;
}

export const defaultCaptureSpec: CaptureSpec = {
	seed: 1,
	duration_ms: 30_000,
	id_count: 40,
	extended: false,
	cycle_ms: 20,
	fd_ratio: 0.5,
	brs_ratio: 1,
	churn: 0.3,
	from_dbc: null,
};

export async function startRecording(path: string): Promise<void> {
	return startRecordingCommand({ path });
}

export async function stopRecording(): Promise<RecordingSummary> {
	return stopRecordingCommand();
}

export async function recordingStatus(): Promise<RecordingStatus> {
	const status = await recordingStatusCommand();
	// The generated type says `string | undefined`, the wire carries `null`.
	// Normalizing here means every consumer sees one shape, and `??` copes
	// whichever of the two it is actually handed.
	return {
		...status,
		path: status.path ?? null,
		stopped_reason: status.stopped_reason ?? null,
	};
}

export async function startReplay(
	path: string,
	options: ReplayOptions,
): Promise<void> {
	// Unlike a status, params *are* run through the generated Zod schema, and
	// it models the Rust `Option<f64>` as an optional field — which rejects an
	// explicit null outright. As-fast-as-possible has to omit the key, the same
	// trap `connectCanDevice` hits with `dataBitrate` in `src/api/can.ts`.
	return startReplayCommand({
		path,
		options:
			options.speed === null
				? { repeat: options.repeat }
				: { speed: options.speed, repeat: options.repeat },
	});
}

export async function stopReplay(): Promise<void> {
	return stopReplayCommand();
}

export async function replayStatus(): Promise<ReplayStatus> {
	const status = await replayStatusCommand();
	return {
		...status,
		path: status.path ?? null,
		last_error: status.last_error ?? null,
	};
}

export async function generateCapture(
	path: string,
	spec: CaptureSpec,
): Promise<RecordingSummary> {
	// Same omit-rather-than-null rule as `startReplay`, for `Option<DbcFile>`.
	const { from_dbc, ...rest } = spec;
	return generateCaptureCommand({
		path,
		spec: from_dbc === null ? rest : { ...rest, from_dbc },
	});
}
