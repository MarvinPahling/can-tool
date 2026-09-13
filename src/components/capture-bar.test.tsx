import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingStatus, ReplayStatus } from "@/api/recording";
import { CaptureBar } from "./capture-bar";

const { open, save } = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open, save }));

const {
	useRecordingStatus,
	useReplayStatus,
	useStartRecording,
	useStopRecording,
	useStartReplay,
	useStopReplay,
	useGenerateCapture,
	startRecording,
	stopRecording,
	startReplay,
	stopReplay,
	generate,
} = vi.hoisted(() => {
	const startRecording = vi.fn();
	const stopRecording = vi.fn();
	const startReplay = vi.fn();
	const stopReplay = vi.fn();
	const generate = vi.fn();
	const asMutation = (mutate: ReturnType<typeof vi.fn>) => () => ({
		mutate,
		mutateAsync: mutate,
		isPending: false,
		error: null,
	});
	return {
		useRecordingStatus: vi.fn(),
		useReplayStatus: vi.fn(),
		useStartRecording: vi.fn(asMutation(startRecording)),
		useStopRecording: vi.fn(asMutation(stopRecording)),
		useStartReplay: vi.fn(asMutation(startReplay)),
		useStopReplay: vi.fn(asMutation(stopReplay)),
		useGenerateCapture: vi.fn(asMutation(generate)),
		startRecording,
		stopRecording,
		startReplay,
		stopReplay,
		generate,
	};
});

const { useConnectionStatus } = vi.hoisted(() => ({
	useConnectionStatus: vi.fn(),
}));
const { useCurrentDbc } = vi.hoisted(() => ({ useCurrentDbc: vi.fn() }));

vi.mock("@/queries/recording", () => ({
	useRecordingStatus,
	useReplayStatus,
	useStartRecording,
	useStopRecording,
	useStartReplay,
	useStopReplay,
	useGenerateCapture,
}));
vi.mock("@/queries/can", () => ({ useConnectionStatus }));
vi.mock("@/queries/dbc", () => ({ useCurrentDbc }));

const idleRecording: RecordingStatus = {
	recording: false,
	path: null,
	frames: 0,
	bytes: 0,
	stopped_reason: null,
};

const idleReplay: ReplayStatus = {
	running: false,
	path: null,
	frames_total: 0,
	frames_emitted: 0,
	loops: 0,
	last_error: null,
};

beforeEach(() => {
	open.mockReset().mockResolvedValue(null);
	save.mockReset().mockResolvedValue(null);
	startRecording.mockReset();
	stopRecording.mockReset();
	startReplay.mockReset();
	stopReplay.mockReset();
	generate.mockReset().mockResolvedValue({
		path: "/tmp/s.csv",
		frames: 10,
		bytes: 700,
	});
	useRecordingStatus.mockReturnValue({ data: idleRecording });
	useReplayStatus.mockReturnValue({ data: idleReplay });
	useConnectionStatus.mockReturnValue({ data: null });
	useCurrentDbc.mockReturnValue({ data: undefined });
});

describe("recording", () => {
	it("cannot record without a device, because nothing would arrive", () => {
		render(<CaptureBar />);
		expect(screen.getByRole("button", { name: /record/i })).toBeDisabled();
	});

	it("records to the chosen path", async () => {
		useConnectionStatus.mockReturnValue({ data: { port_name: "/dev/tty" } });
		save.mockResolvedValue("/tmp/capture.csv");
		render(<CaptureBar />);

		await userEvent.click(screen.getByRole("button", { name: /record/i }));

		await waitFor(() =>
			expect(startRecording).toHaveBeenCalledWith("/tmp/capture.csv"),
		);
	});

	it("offers the reference tool's filename by default", async () => {
		useConnectionStatus.mockReturnValue({ data: { port_name: "/dev/tty" } });
		render(<CaptureBar />);

		await userEvent.click(screen.getByRole("button", { name: /record/i }));

		await waitFor(() => expect(save).toHaveBeenCalled());
		expect(save.mock.calls[0]?.[0]?.defaultPath).toMatch(
			/^capture-\d{8}-\d{6}\.csv$/,
		);
	});

	it("starts nothing when the save dialog is cancelled", async () => {
		useConnectionStatus.mockReturnValue({ data: { port_name: "/dev/tty" } });
		save.mockResolvedValue(null);
		render(<CaptureBar />);

		await userEvent.click(screen.getByRole("button", { name: /record/i }));

		await waitFor(() => expect(save).toHaveBeenCalled());
		expect(startRecording).not.toHaveBeenCalled();
	});

	it("shows progress while recording", () => {
		useRecordingStatus.mockReturnValue({
			data: {
				...idleRecording,
				recording: true,
				path: "/tmp/capture.csv",
				frames: 4_212,
				bytes: 2_500_000,
			},
		});
		render(<CaptureBar />);

		expect(screen.getByText(/4,?212 frames/)).toBeInTheDocument();
		expect(screen.getByText(/2\.5 MB/)).toBeInTheDocument();
	});

	it("says why the recorder stopped itself", () => {
		useRecordingStatus.mockReturnValue({
			data: {
				...idleRecording,
				stopped_reason: "Stopped at the 20000000 frame limit",
				frames: 20_000_000,
			},
		});
		render(<CaptureBar />);

		expect(screen.getByText(/20000000 frame limit/)).toBeInTheDocument();
	});
});

describe("replay", () => {
	it("replays the chosen capture at the chosen speed", async () => {
		open.mockResolvedValue("/tmp/capture.csv");
		render(<CaptureBar />);

		await userEvent.click(
			screen.getByRole("button", { name: /open capture/i }),
		);

		await waitFor(() =>
			expect(startReplay).toHaveBeenCalledWith({
				path: "/tmp/capture.csv",
				options: { speed: 1, repeat: false },
			}),
		);
	});

	it("passes as-fast-as-possible through as a null speed", async () => {
		open.mockResolvedValue("/tmp/capture.csv");
		render(<CaptureBar />);

		await userEvent.click(
			screen.getByRole("combobox", { name: /playback speed/i }),
		);
		await userEvent.click(
			await screen.findByRole("option", { name: /as fast as possible/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /open capture/i }),
		);

		await waitFor(() =>
			expect(startReplay.mock.calls[0]?.[0]?.options.speed).toBeNull(),
		);
	});

	it("passes the repeat toggle through", async () => {
		open.mockResolvedValue("/tmp/capture.csv");
		render(<CaptureBar />);

		await userEvent.click(screen.getByRole("switch", { name: /repeat/i }));
		await userEvent.click(
			screen.getByRole("button", { name: /open capture/i }),
		);

		await waitFor(() =>
			expect(startReplay.mock.calls[0]?.[0]?.options.repeat).toBe(true),
		);
	});

	it("cannot replay while a device is connected, because two sources would interleave", () => {
		useConnectionStatus.mockReturnValue({ data: { port_name: "/dev/tty" } });
		render(<CaptureBar />);

		expect(
			screen.getByRole("button", { name: /open capture/i }),
		).toBeDisabled();
	});

	it("shows progress and stops a running replay", async () => {
		useReplayStatus.mockReturnValue({
			data: {
				...idleReplay,
				running: true,
				path: "/tmp/capture.csv",
				frames_total: 662,
				frames_emitted: 120,
			},
		});
		render(<CaptureBar />);

		expect(screen.getByText(/120\s*\/\s*662/)).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: /stop replay/i }));
		expect(stopReplay).toHaveBeenCalled();
	});

	it("surfaces a replay that died", () => {
		useReplayStatus.mockReturnValue({
			data: { ...idleReplay, last_error: "Line 12: data `ZZ` is not hex" },
		});
		render(<CaptureBar />);

		expect(screen.getByText(/Line 12/)).toBeInTheDocument();
	});
});

describe("generating", () => {
	it("fills the spec from a preset", async () => {
		save.mockResolvedValue("/tmp/synthetic.csv");
		render(<CaptureBar />);

		await userEvent.click(screen.getByRole("button", { name: /generate/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /20 000 extended ids/i }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /^generate capture$/i }),
		);

		await waitFor(() => expect(generate).toHaveBeenCalled());
		const spec = generate.mock.calls[0]?.[0]?.spec;
		expect(spec.id_count).toBe(20_000);
		expect(spec.extended).toBe(true);
	});

	it("generates nothing when the save dialog is cancelled", async () => {
		save.mockResolvedValue(null);
		render(<CaptureBar />);

		await userEvent.click(screen.getByRole("button", { name: /generate/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /^generate capture$/i }),
		);

		await waitFor(() => expect(save).toHaveBeenCalled());
		expect(generate).not.toHaveBeenCalled();
	});
});
