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
