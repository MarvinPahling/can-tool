import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	generateCaptureCommand,
	recordingStatusCommand,
	replayStatusCommand,
	startRecordingCommand,
	startReplayCommand,
	stopRecordingCommand,
	stopReplayCommand,
} = vi.hoisted(() => ({
	generateCaptureCommand: vi.fn(),
	recordingStatusCommand: vi.fn(),
	replayStatusCommand: vi.fn(),
	startRecordingCommand: vi.fn(),
	startReplayCommand: vi.fn(),
	stopRecordingCommand: vi.fn(),
	stopReplayCommand: vi.fn(),
}));

vi.mock("../generated/commands", () => ({
	generateCapture: generateCaptureCommand,
	recordingStatus: recordingStatusCommand,
	replayStatus: replayStatusCommand,
	startRecording: startRecordingCommand,
	startReplay: startReplayCommand,
	stopRecording: stopRecordingCommand,
	stopReplay: stopReplayCommand,
}));

const {
	defaultCaptureSpec,
	generateCapture,
	recordingStatus,
	replayStatus,
	startRecording,
	startReplay,
	stopRecording,
	stopReplay,
} = await import("./recording");

beforeEach(() => {
	for (const command of [
		generateCaptureCommand,
		recordingStatusCommand,
		replayStatusCommand,
		startRecordingCommand,
		startReplayCommand,
		stopRecordingCommand,
		stopReplayCommand,
	]) {
		command.mockReset().mockResolvedValue(undefined);
	}
});

describe("recordingStatus", () => {
	it("normalizes the absent path and reason to null", async () => {
		// Serde sends `null`; typegen models the same fields as optional. Every
		// consumer should see one shape whichever of the two arrives.
		recordingStatusCommand.mockResolvedValue({
			recording: false,
			frames: 0,
			bytes: 0,
		});

		await expect(recordingStatus()).resolves.toEqual({
			recording: false,
			path: null,
			frames: 0,
			bytes: 0,
			stopped_reason: null,
		});
	});

	it("passes a present path and reason through", async () => {
		recordingStatusCommand.mockResolvedValue({
			recording: false,
			path: "/tmp/capture.csv",
			frames: 12,
			bytes: 900,
			stopped_reason: "Stopped at the 12 frame limit",
		});

		const status = await recordingStatus();
		expect(status.path).toBe("/tmp/capture.csv");
		expect(status.stopped_reason).toBe("Stopped at the 12 frame limit");
	});
});

describe("replayStatus", () => {
	it("normalizes the absent path and error to null", async () => {
		replayStatusCommand.mockResolvedValue({
			running: false,
			frames_total: 0,
			frames_emitted: 0,
			loops: 0,
		});

		await expect(replayStatus()).resolves.toEqual({
			running: false,
			path: null,
			frames_total: 0,
			frames_emitted: 0,
			loops: 0,
			last_error: null,
		});
	});
});

describe("startRecording", () => {
	it("narrows the call to a path", async () => {
		await startRecording("/tmp/capture.csv");
		expect(startRecordingCommand).toHaveBeenCalledWith({
			path: "/tmp/capture.csv",
		});
	});
});

describe("stopRecording", () => {
	it("returns the summary the backend reports", async () => {
		const summary = { path: "/tmp/capture.csv", frames: 3, bytes: 300 };
		stopRecordingCommand.mockResolvedValue(summary);
		await expect(stopRecording()).resolves.toEqual(summary);
	});
});

describe("startReplay", () => {
	it("sends a chosen speed", async () => {
		await startReplay("/tmp/capture.csv", { speed: 5, repeat: false });
		expect(startReplayCommand).toHaveBeenCalledWith({
			path: "/tmp/capture.csv",
			options: { speed: 5, repeat: false },
		});
	});

	it("omits the speed entirely for as-fast-as-possible", async () => {
		// The generated schema models the Rust `Option<f64>` as an optional
		// field and `safeParse` rejects an explicit null, so the only way to
		// express "no speed" over IPC is to leave the key out.
		await startReplay("/tmp/capture.csv", { speed: null, repeat: true });

		const options = startReplayCommand.mock.calls[0]?.[0]?.options;
		expect(options).toEqual({ repeat: true });
		expect("speed" in options).toBe(false);
	});
});

describe("stopReplay", () => {
	it("stops the replay", async () => {
		await stopReplay();
		expect(stopReplayCommand).toHaveBeenCalled();
	});
});

describe("generateCapture", () => {
	it("sends the spec alongside the path", async () => {
		const summary = { path: "/tmp/synthetic.csv", frames: 100, bytes: 7000 };
		generateCaptureCommand.mockResolvedValue(summary);

		const spec = { ...defaultCaptureSpec, id_count: 20_000, extended: true };
		await expect(generateCapture("/tmp/synthetic.csv", spec)).resolves.toEqual(
			summary,
		);

		// `from_dbc` is stripped rather than sent as null (see the test below);
		// everything else goes across untouched.
		const { from_dbc: _omitted, ...sent } = spec;
		expect(generateCaptureCommand).toHaveBeenCalledWith({
			path: "/tmp/synthetic.csv",
			spec: sent,
		});
	});

	it("omits from_dbc rather than sending null", async () => {
		await generateCapture("/tmp/synthetic.csv", {
			...defaultCaptureSpec,
			from_dbc: null,
		});

		const spec = generateCaptureCommand.mock.calls[0]?.[0]?.spec;
		expect("from_dbc" in spec).toBe(false);
	});
});

describe("defaultCaptureSpec", () => {
	it("churns, so a generated capture exercises the highlight path", () => {
		// A static capture never trips `hasSignificantChange`, so it creates no
		// animation and measures nothing that matters.
		expect(defaultCaptureSpec.churn).toBeGreaterThan(0);
	});
});
