import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
    mutationFn: ({ portName, bitrate }: { portName: string; bitrate: number }) =>
      connectCanDevice(portName, bitrate),
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
    mutationFn: ({ message, values }: { message: DbcMessage; values: Record<string, number> }) =>
      sendCanMessage(message, values),
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
