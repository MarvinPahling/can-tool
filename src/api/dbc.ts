import { parseDbcFile as parseDbcFileCommand } from "../generated/commands";
import type { DbcFile, DbcMessage, DbcSignal } from "../generated/types";

export type { DbcFile, DbcMessage, DbcSignal };

export async function parseDbcFile(path: string): Promise<DbcFile> {
	return parseDbcFileCommand({ path });
}
