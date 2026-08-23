import { parseDbcFile as parseDbcFileCommand } from "../generated/commands";
import type { DbcFile } from "../generated/types";

export type { DbcFile };

export async function parseDbcFile(path: string): Promise<DbcFile> {
  return parseDbcFileCommand({ path });
}
