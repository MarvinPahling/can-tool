import { useEffect, useRef, useState } from "react";
import { encodeCanMessage } from "@/api/can";
import type { DbcMessage } from "@/api/dbc";

export interface EncodedPreview {
	/** The frame as it would go on the bus, once it encodes. */
	bytes?: number[];
	/** Why it does not encode — a signal out of range, or too wide. */
	error?: string;
	/** An encode is scheduled or in flight. */
	pending: boolean;
}

/** How long typing settles before the backend is asked to encode. */
const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Keeps an encoded preview of `message` + `values` in step with what is typed,
 * debounced so a held-down arrow key does not fire one round trip per repeat.
 *
 * Doubles as validation: encoding is the only thing that knows whether a set of
 * values actually fits the frame, so the error it returns is the error worth
 * showing.
 *
 * Responses are gated on a request sequence. Encoding is async, so a slow
 * response can arrive after a newer one and would otherwise overwrite it with a
 * stale preview — the field-level validator this replaced got that ordering for
 * free from the form, a bare hook does not.
 */
export function useEncodedPreview(
	message: DbcMessage | undefined,
	values: Record<string, number>,
	debounceMs = DEFAULT_DEBOUNCE_MS,
): EncodedPreview {
	const [preview, setPreview] = useState<EncodedPreview>({ pending: false });
	const latest = useRef(0);

	// Values is a fresh object on every render; its content is what matters.
	const valuesKey = JSON.stringify(values);

	useEffect(() => {
		if (!message) {
			latest.current += 1;
			setPreview({ pending: false });
			return;
		}

		const sequence = ++latest.current;
		setPreview((previous) => ({ ...previous, pending: true }));

		const timer = setTimeout(async () => {
			try {
				const bytes = await encodeCanMessage(message, JSON.parse(valuesKey));
				if (sequence !== latest.current) return;
				setPreview({ bytes, pending: false });
			} catch (error) {
				if (sequence !== latest.current) return;
				setPreview({
					error: error instanceof Error ? error.message : String(error),
					pending: false,
				});
			}
		}, debounceMs);

		return () => clearTimeout(timer);
	}, [message, valuesKey, debounceMs]);

	return preview;
}
