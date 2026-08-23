import { describe, expect, it } from "vitest";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";
import { buildDbcRows } from "./rows";

describe("buildDbcRows", () => {
	it("produces one message row per message when nothing is expanded", () => {
		const dbc = makeDbcFile({
			messages: [makeMessage({ id: 1 }), makeMessage({ id: 2 })],
		});

		const rows = buildDbcRows(dbc, new Set());

		expect(rows).toEqual([
			{ kind: "message", id: "msg-1", message: dbc.messages[0] },
			{ kind: "message", id: "msg-2", message: dbc.messages[1] },
		]);
	});

	it("inserts signal rows immediately after an expanded message's row", () => {
		const sigA = makeSignal({ name: "A" });
		const sigB = makeSignal({ name: "B" });
		const message = makeMessage({ id: 1, signals: [sigA, sigB] });
		const dbc = makeDbcFile({ messages: [message] });

		const rows = buildDbcRows(dbc, new Set([1]));

		expect(rows).toEqual([
			{ kind: "message", id: "msg-1", message },
			{ kind: "signal", id: "msg-1-sig-A", signal: sigA, message },
			{ kind: "signal", id: "msg-1-sig-B", signal: sigB, message },
		]);
	});

	it("only expands the messages present in the expanded set", () => {
		const collapsed = makeMessage({ id: 1, signals: [makeSignal()] });
		const expanded = makeMessage({
			id: 2,
			signals: [makeSignal({ name: "X" })],
		});
		const dbc = makeDbcFile({ messages: [collapsed, expanded] });

		const rows = buildDbcRows(dbc, new Set([2]));

		expect(rows.map((r) => r.id)).toEqual(["msg-1", "msg-2", "msg-2-sig-X"]);
	});

	it("returns an empty array for a DBC file with no messages", () => {
		expect(buildDbcRows(makeDbcFile(), new Set())).toEqual([]);
	});
});
