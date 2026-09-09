import {
	simulationStatus as simulationStatusCommand,
	startSimulation as startSimulationCommand,
	stopSimulation as stopSimulationCommand,
} from "../generated/commands";
import type { DbcMessage } from "./dbc";

/** The event name the scheduler reports a mid-run failure on. */
export const SIMULATION_ERROR_EVENT = "simulation-error";

/**
 * One message to cycle: a DBC message, the physical values to encode into it,
 * and how often to send it.
 *
 * The backend encodes this — the same shape `send_can_message` takes — rather
 * than accepting bytes, so one encoder stays authoritative and a card's hex
 * preview can never disagree with what actually goes on the bus.
 */
export interface SimulationEntryPayload {
	message: DbcMessage;
	values: Record<string, number>;
	/** Milliseconds between frames. Clamped by the backend to [1, 3600000]. */
	period_ms: number;
}

/**
 * What the scheduler is doing.
 *
 * Hand-declared rather than re-exported from `src/generated/types.ts` for the
 * same reason `CanFrame` and `ProbeProgress` are in `src/api/can.ts`: typegen
 * models the Rust `Option<String>` as an optional field (`string | undefined`)
 * while serde serializes `None` as `null`. A command's *return* is never run
 * through the generated Zod schema — only its params are — so the generated
 * type would be a lie at every use site. Keep in sync with `SimulationStatus`
 * in `src-tauri/src/simulation.rs`.
 */
export interface SimulationStatus {
	running: boolean;
	frames_sent: number;
	/** How many messages the current run was started with. */
	frame_count: number;
	/** Unix ms when the run started; 0 when nothing has ever run. */
	started_at_ms: number;
	/** The failure that ended the run, kept after the thread exits. */
	last_error: string | null;
}

/**
 * Starts cycling `entries`, replacing any run already in progress.
 *
 * Rejects the whole set if any entry fails to encode, so a bad value never
 * leaves a partial simulation on the bus.
 */
export async function startSimulation(
	entries: SimulationEntryPayload[],
): Promise<void> {
	return startSimulationCommand({ entries });
}

export async function stopSimulation(): Promise<void> {
	return stopSimulationCommand();
}

export async function simulationStatus(): Promise<SimulationStatus> {
	const status = await simulationStatusCommand();
	// The generated type says `string | undefined`, the wire actually carries
	// `null`. Normalizing here means every consumer sees one shape, and `??`
	// copes whichever of the two it is handed.
	return { ...status, last_error: status.last_error ?? null };
}
