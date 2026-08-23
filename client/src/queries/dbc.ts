import { useMutation } from "@tanstack/react-query";
import { parseDbcFile } from "../api/dbc";

export function useParseDbcFile() {
  return useMutation({
    mutationFn: (path: string) => parseDbcFile(path),
  });
}
