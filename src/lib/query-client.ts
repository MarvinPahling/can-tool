import { QueryClient } from "@tanstack/react-query";
import { currentDbcKey } from "@/queries/dbc";

export function createQueryClient() {
	const client = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				retry: 1,
			},
		},
	});

	// The current DBC file is seeded with setQueryData and never fetched, so
	// there is nothing to re-fetch it if it is garbage-collected. Without this
	// it survives only as long as some component happens to observe it.
	client.setQueryDefaults(currentDbcKey, {
		gcTime: Number.POSITIVE_INFINITY,
	});

	return client;
}

export const queryClient = createQueryClient();
