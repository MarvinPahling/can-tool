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
				auto={false}
				onSignalNameChange={() => {}}
				onAutoChange={() => {}}
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
				auto={false}
				onSignalNameChange={() => {}}
				onAutoChange={() => {}}
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
				auto={false}
				onSignalNameChange={() => {}}
				onAutoChange={() => {}}
				onGenerated={() => {}}
			/>,
		);

		expect(screen.getByText("Unknown signal 'Checksum'")).toBeInTheDocument();
	});

	it("does not compute anything on its own while auto is off", async () => {
		vi.useFakeTimers();
		const { rerender } = render(
			<ChecksumField
				message={message}
				values={{ Value: 1 }}
				signalName="Checksum"
				auto={false}
				onSignalNameChange={() => {}}
				onAutoChange={() => {}}
				onGenerated={() => {}}
			/>,
		);

		rerender(
			<ChecksumField
				message={message}
				values={{ Value: 2 }}
				signalName="Checksum"
				auto={false}
				onSignalNameChange={() => {}}
				onAutoChange={() => {}}
				onGenerated={() => {}}
			/>,
		);
		await vi.advanceTimersByTimeAsync(1000);

		expect(mutateAsync).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("recomputes when a value changes while auto is on", async () => {
		vi.useFakeTimers();
		const onGenerated = vi.fn();
		const props = (values: Record<string, number>) => ({
			message,
			values,
			signalName: "Checksum",
			auto: true,
			onSignalNameChange: () => {},
			onAutoChange: () => {},
			onGenerated,
		});

		const { rerender } = render(<ChecksumField {...props({ Value: 1 })} />);
		await vi.advanceTimersByTimeAsync(1000);
		expect(mutateAsync).toHaveBeenCalledTimes(1);

		rerender(<ChecksumField {...props({ Value: 2 })} />);
		await vi.advanceTimersByTimeAsync(1000);

		expect(mutateAsync).toHaveBeenCalledTimes(2);
		expect(onGenerated).toHaveBeenLastCalledWith("Checksum", 0x42);
		vi.useRealTimers();
	});

	it("does not recompute in response to its own result", async () => {
		vi.useFakeTimers();
		const props = (values: Record<string, number>) => ({
			message,
			values,
			signalName: "Checksum",
			auto: true,
			onSignalNameChange: () => {},
			onAutoChange: () => {},
			onGenerated: () => {},
		});

		const { rerender } = render(<ChecksumField {...props({ Value: 1 })} />);
		await vi.advanceTimersByTimeAsync(1000);

		// What writing the result back looks like from here: the checksum
		// signal appears in values, everything else is untouched.
		rerender(<ChecksumField {...props({ Value: 1, Checksum: 0x42 })} />);
		await vi.advanceTimersByTimeAsync(1000);

		// Without excluding the checksum from the change key this would run
		// away, one round trip per result, forever.
		expect(mutateAsync).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it("debounces a burst of edits into one computation", async () => {
		vi.useFakeTimers();
		const props = (values: Record<string, number>) => ({
			message,
			values,
			signalName: "Checksum",
			auto: true,
			onSignalNameChange: () => {},
			onAutoChange: () => {},
			onGenerated: () => {},
		});

		const { rerender } = render(<ChecksumField {...props({ Value: 1 })} />);
		rerender(<ChecksumField {...props({ Value: 2 })} />);
		rerender(<ChecksumField {...props({ Value: 3 })} />);
		await vi.advanceTimersByTimeAsync(1000);

		expect(mutateAsync).toHaveBeenCalledTimes(1);
		expect(mutateAsync).toHaveBeenCalledWith({
			message,
			values: { Value: 3 },
			checksumSignal: "Checksum",
		});
		vi.useRealTimers();
	});

	it("cannot turn auto on without a checksum signal to write into", () => {
		render(
			<ChecksumField
				message={message}
				values={{}}
				signalName=""
				auto={false}
				onSignalNameChange={() => {}}
				onAutoChange={() => {}}
				onGenerated={() => {}}
			/>,
		);

		expect(
			screen.getByRole("switch", { name: /auto checksum/i }),
		).toHaveAttribute("aria-disabled", "true");
	});

	it("is inert when disabled", () => {
		render(
			<ChecksumField
				message={message}
				values={{}}
				signalName="Checksum"
				auto={false}
				onSignalNameChange={() => {}}
				onAutoChange={() => {}}
				onGenerated={() => {}}
				disabled
			/>,
		);

		expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
	});
});
