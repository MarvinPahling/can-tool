import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMessage, makeSignal } from "@/test/fixtures";
import { ChecksumField } from "./checksum-field";

const { useGenerateChecksum, mutateAsync } = vi.hoisted(() => ({
	useGenerateChecksum: vi.fn(),
	mutateAsync: vi.fn(),
}));

vi.mock("@/queries/can", () => ({ useGenerateChecksum }));

const message = makeMessage({
	signals: [
		makeSignal({ name: "Value", start_bit: 0, size: 8 }),
		makeSignal({ name: "Checksum", start_bit: 8, size: 8 }),
	],
});

beforeEach(() => {
	mutateAsync.mockReset().mockResolvedValue(0x42);
	useGenerateChecksum.mockReturnValue({
		mutateAsync,
		isPending: false,
		isError: false,
	});
});

describe("ChecksumField", () => {
	it("cannot generate until a signal is picked", () => {
		render(
			<ChecksumField
				message={message}
				values={{}}
				signalName=""
				onSignalNameChange={() => {}}
				onGenerated={() => {}}
			/>,
		);

		expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
	});

	it("hands the computed value back under the chosen signal", async () => {
		const onGenerated = vi.fn();
		render(
			<ChecksumField
				message={message}
				values={{ Value: 7 }}
				signalName="Checksum"
				onSignalNameChange={() => {}}
				onGenerated={onGenerated}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /generate/i }));

		expect(mutateAsync).toHaveBeenCalledWith({
			message,
			values: { Value: 7 },
			checksumSignal: "Checksum",
		});
		expect(onGenerated).toHaveBeenCalledWith("Checksum", 0x42);
	});

	it("reports a failure to compute", () => {
		useGenerateChecksum.mockReturnValue({
			mutateAsync,
			isPending: false,
			isError: true,
			error: new Error("Unknown signal 'Checksum'"),
		});

		render(
			<ChecksumField
				message={message}
				values={{}}
				signalName="Checksum"
				onSignalNameChange={() => {}}
				onGenerated={() => {}}
			/>,
		);

		expect(screen.getByText("Unknown signal 'Checksum'")).toBeInTheDocument();
	});

	it("is inert when disabled", () => {
		render(
			<ChecksumField
				message={message}
				values={{}}
				signalName="Checksum"
				onSignalNameChange={() => {}}
				onGenerated={() => {}}
				disabled
			/>,
		);

		expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
	});
});
