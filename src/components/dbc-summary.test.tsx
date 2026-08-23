import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeDbcFile, makeMessage } from "@/test/fixtures";
import { DbcSummary } from "./dbc-summary";

describe("DbcSummary", () => {
	it("renders the DBC version", () => {
		render(<DbcSummary dbc={makeDbcFile({ version: "2.1" })} />);
		expect(screen.getByText('DBC version "2.1"')).toBeInTheDocument();
	});

	it("renders node and message counts", () => {
		const dbc = makeDbcFile({
			nodes: ["ECU1", "ECU2"],
			messages: [
				makeMessage({ id: 1 }),
				makeMessage({ id: 2 }),
				makeMessage({ id: 3 }),
			],
		});
		render(<DbcSummary dbc={dbc} />);
		expect(screen.getByText("2 node(s) and 3 message(s).")).toBeInTheDocument();
	});

	it("renders zero counts for an empty DBC", () => {
		render(<DbcSummary dbc={makeDbcFile()} />);
		expect(screen.getByText("0 node(s) and 0 message(s).")).toBeInTheDocument();
	});
});
