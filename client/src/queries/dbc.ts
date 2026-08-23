import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseDbcFile } from "../api/dbc";
import type { DbcFile } from "../api/dbc";

export function useParseDbcFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => parseDbcFile(path),
    onSuccess: (data) => {
      queryClient.setQueryData(["dbc", "current"], data);
    },
  });
}

/** Reads the most recently successfully-parsed DBC file, shared across the app. */
export function useCurrentDbc() {
  return useQuery<DbcFile | undefined>({
    queryKey: ["dbc", "current"],
    queryFn: skipToken,
  });
}
