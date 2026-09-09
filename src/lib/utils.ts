import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Formats frame bytes as uppercase space-separated hex, e.g. `DE AD BE EF`. */
export function bytesToHex(bytes: number[]): string {
	return bytes
		.map((b) => b.toString(16).padStart(2, "0").toUpperCase())
		.join(" ");
}

/**
 * Formats a CAN id the way it is written on a bus: hex, width by frame format
 * — three nibbles for a standard id, eight for an extended one.
 */
export function formatCanId(id: number, extended: boolean): string {
	return `0x${id
		.toString(16)
		.toUpperCase()
		.padStart(extended ? 8 : 3, "0")}`;
}
