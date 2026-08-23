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
