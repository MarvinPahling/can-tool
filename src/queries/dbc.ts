import {
	skipToken,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { DbcFile } from "../api/dbc";
import { parseDbcFile } from "../api/dbc";

/** The single entry holding the most recently parsed DBC file. */
export const currentDbcKey = ["dbc", "current"] as const;

export function useParseDbcFile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (path: string) => parseDbcFile(path),
		onSuccess: (data) => {
			queryClient.setQueryData(currentDbcKey, data);
		},
	});
}

/** Reads the most recently successfully-parsed DBC file, shared across the app. */
export function useCurrentDbc() {
	return useQuery<DbcFile | undefined>({
		queryKey: currentDbcKey,
		queryFn: skipToken,
	});
}
