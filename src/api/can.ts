import {
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

export async function listCanDevices(): Promise<CanDeviceInfo[]> {
	return listCanDevicesCommand();
}

export async function connectCanDevice(
	portName: string,
	bitrate: number,
): Promise<void> {
	return connectCanDeviceCommand({ portName, bitrate });
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
