import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";

interface PendingSendMessage {
	messageId: string;
	nonce: number;
}

const PENDING_SEND_KEY = ["send", "pendingMessage"];

/** Requests that the send-message dialog open with `messageId` pre-selected. */
export function useRequestSendMessage() {
	const queryClient = useQueryClient();
	return (messageId: string) => {
		queryClient.setQueryData<PendingSendMessage>(PENDING_SEND_KEY, {
			messageId,
			nonce: Date.now(),
		});
	};
}

export function usePendingSendMessage() {
	return useQuery<PendingSendMessage | undefined>({
		queryKey: PENDING_SEND_KEY,
		queryFn: skipToken,
	});
}
