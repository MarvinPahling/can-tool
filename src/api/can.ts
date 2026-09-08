import {
	autodetectBitrate as autodetectBitrateCommand,
	canConnectionStatus as canConnectionStatusCommand,
	connectCanDevice as connectCanDeviceCommand,
	disconnectCanDevice as disconnectCanDeviceCommand,
	encodeCanMessage as encodeCanMessageCommand,
	generateChecksum as generateChecksumCommand,
	listCanDevices as listCanDevicesCommand,
	sendCanMessage as sendCanMessageCommand,
} from "../generated/commands";
import type {
	CanConnectionStatus,
	CanDeviceInfo,
	DbcMessage,
} from "../generated/types";

export type { CanConnectionStatus, CanDeviceInfo };

/**
 * One CAN frame received from the bus, as carried by the `can-frames` event.
 *
 * Hand-written rather than re-exported from `src/generated/`: tauri-typegen
 * derives its types from `#[tauri::command]` signatures, and a frame only ever
 * travels over an event, so it never appears there. Keep this in sync with
 * `CanFrame` in `src-tauri/src/can.rs`.
 */
export interface CanFrame {
	id: number;
	extended: boolean;
	data: number[];
	timestamp_ms: number;
}

/**
 * One update from a bitrate sweep, as carried by the `can-probe` event.
 *
 * tauri-typegen does emit a `ProbeProgress` (it recognizes the named struct at
 * the `app.emit` call site), but it models the Rust `Option<u32>` as an
 * optional field — `number | undefined` — while serde actually serializes
 * `None` as `null`. Events are delivered straight from `listen` and never run
 * through the generated Zod schema, so that mismatch would be a lie at every
 * use site. Keep this in sync with `ProbeProgress` in `src-tauri/src/can.rs`.
 */
export interface ProbeProgress {
	bitrate: number;
	frames: number;
	/** True on the final update of a sweep, whatever the outcome. */
	done: boolean;
	/** Set only on the final update: the winning bitrate, or null if none. */
	detected: number | null;
}

export async function listCanDevices(): Promise<CanDeviceInfo[]> {
	return listCanDevicesCommand();
}

export async function connectCanDevice(
	portName: string,
	bitrate: number,
	readOnly: boolean,
): Promise<void> {
	return connectCanDeviceCommand({ portName, bitrate, readOnly });
}

/** Sweeps the common bitrates on `portName`, returning the one that saw traffic. */
export async function autodetectBitrate(
	portName: string,
	readOnly: boolean,
): Promise<number | null> {
	return autodetectBitrateCommand({ portName, readOnly });
}

export async function disconnectCanDevice(): Promise<void> {
	return disconnectCanDeviceCommand();
}

export async function canConnectionStatus(): Promise<CanConnectionStatus | null> {
	return canConnectionStatusCommand();
}

export async function encodeCanMessage(
	message: DbcMessage,
	values: Record<string, number>,
): Promise<number[]> {
	return encodeCanMessageCommand({ message, values });
}

export async function sendCanMessage(
	message: DbcMessage,
	values: Record<string, number>,
): Promise<void> {
	return sendCanMessageCommand({ message, values });
}

export async function generateChecksum(
	message: DbcMessage,
	values: Record<string, number>,
	checksumSignal: string,
): Promise<number> {
	return generateChecksumCommand({ message, values, checksumSignal });
}
