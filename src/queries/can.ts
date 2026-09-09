import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { CanFrame, ProbeProgress } from "../api/can";
import {
	autodetectBitrate,
	canConnectionStatus,
	connectCanDevice,
	disconnectCanDevice,
	generateChecksum,
	listCanDevices,
	sendCanMessage,
} from "../api/can";
import type { DbcMessage } from "../api/dbc";

export function useListCanDevices(enabled: boolean) {
	return useQuery({
		queryKey: ["can", "devices"],
		queryFn: listCanDevices,
		enabled,
		refetchInterval: enabled ? 2000 : false,
	});
}

export function useConnectionStatus() {
	return useQuery({
		queryKey: ["can", "status"],
		queryFn: canConnectionStatus,
		refetchInterval: 1000,
	});
}

export function useConnectCanDevice() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			portName,
			bitrate,
			dataBitrate,
			readOnly,
		}: {
			portName: string;
			bitrate: number;
			/** The CAN FD data bitrate, or null for a classic CAN channel. */
			dataBitrate: number | null;
			readOnly: boolean;
		}) => connectCanDevice(portName, bitrate, dataBitrate, readOnly),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["can", "status"] });
			queryClient.invalidateQueries({ queryKey: ["can", "devices"] });
		},
	});
}

/**
 * Runs a timing sweep on one port. Resolves to the detected arbitration and
 * data bitrate, or null when nothing was heard; on a hit the backend leaves the
 * device connected at that timing, hence the same invalidations as a plain
 * connect.
 */
export function useAutodetectBitrate() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			portName,
			readOnly,
		}: {
			portName: string;
			readOnly: boolean;
		}) => autodetectBitrate(portName, readOnly),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["can", "status"] });
			queryClient.invalidateQueries({ queryKey: ["can", "devices"] });
		},
	});
}

export function useDisconnectCanDevice() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: disconnectCanDevice,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["can", "status"] });
		},
	});
}

export function useSendCanMessage() {
	return useMutation({
		mutationFn: ({
			message,
			values,
		}: {
			message: DbcMessage;
			values: Record<string, number>;
		}) => sendCanMessage(message, values),
	});
}

export function useGenerateChecksum() {
	return useMutation({
		mutationFn: ({
			message,
			values,
			checksumSignal,
		}: {
			message: DbcMessage;
			values: Record<string, number>;
			checksumSignal: string;
		}) => generateChecksum(message, values, checksumSignal),
	});
}

/**
 * Subscribes to the batched `can-frames` events the Rust reader thread emits
 * (see `spawn_reader` in `src-tauri/src/can.rs`).
 *
 * Deliberately not React state: the backend already batches to ~33 events/s,
 * and pushing every batch through `setState` would undo that. Consumers keep
 * their own accumulator and flush on their own schedule.
 */
export function useCanFrames(onFrames: (frames: CanFrame[]) => void) {
	// The callback lives in a ref so a new identity each render does not tear
	// down and re-register the listener, which would drop frames in the gap.
	const handler = useRef(onFrames);
	useEffect(() => {
		handler.current = onFrames;
	});

	useEffect(() => {
		let cancelled = false;
		let unlisten: (() => void) | undefined;

		listen<CanFrame[]>("can-frames", (event) => {
			handler.current(event.payload);
		}).then((fn) => {
			// `listen` resolves asynchronously; if the effect was already torn
			// down by then, unlisten immediately rather than leaking it.
			if (cancelled) fn();
			else unlisten = fn;
		});

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, []);
}

/** Subscribes to bitrate-sweep progress; see `useCanFrames` for the pattern. */
export function useProbeProgress(
	onProgress: (progress: ProbeProgress) => void,
) {
	const handler = useRef(onProgress);
	useEffect(() => {
		handler.current = onProgress;
	});

	useEffect(() => {
		let cancelled = false;
		let unlisten: (() => void) | undefined;

		listen<ProbeProgress>("can-probe", (event) => {
			handler.current(event.payload);
		}).then((fn) => {
			if (cancelled) fn();
			else unlisten = fn;
		});

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, []);
}
