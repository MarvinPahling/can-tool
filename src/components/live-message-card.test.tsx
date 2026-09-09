import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveMessage } from "@/lib/live-messages";
import { DEFAULT_VISUALIZE_SETTINGS } from "@/lib/visualize-settings";
import { makeMessage, makeSignal } from "@/test/fixtures";
import { LiveMessageCard } from "./live-message-card";

beforeEach(() => {
	HTMLElement.prototype.animate = vi.fn(() => ({
		cancel: vi.fn(),
	})) as unknown as Element["animate"];
});

const known: LiveMessage = {
	message: makeMessage({
		id: 0x1a0,
		name: "Status",
		size: 2,
		signals: [
			makeSignal({ name: "Speed", start_bit: 0, size: 8, unit: "km/h" }),
			makeSignal({ name: "Gear", start_bit: 8, size: 8 }),
		],
	}),
	id: 0x1a0,
	extended: false,
	fd: false,
	bitrateSwitch: false,
	data: [0x11, 0x22],
	receivedAt: 1000,
	count: 7,
	signals: {
		Speed: { value: 0x11 },
		Gear: { value: 0x22 },
	},
};

describe("LiveMessageCard", () => {
	it("names the message and shows its id in hex", () => {
		render(
			<LiveMessageCard live={known} settings={DEFAULT_VISUALIZE_SETTINGS} />,
		);

		expect(screen.getByText("Status")).toBeInTheDocument();
		expect(screen.getByText("0x1A0")).toBeInTheDocument();
	});

	it("renders a row per decoded signal", () => {
		render(
			<LiveMessageCard live={known} settings={DEFAULT_VISUALIZE_SETTINGS} />,
		);

		expect(screen.getByText("Speed")).toBeInTheDocument();
		expect(screen.getByText("17")).toBeInTheDocument();
		expect(screen.getByText("Gear")).toBeInTheDocument();
		expect(screen.getByText("34")).toBeInTheDocument();
	});

	it("shows the raw payload and how many frames have arrived", () => {
		render(
			<LiveMessageCard live={known} settings={DEFAULT_VISUALIZE_SETTINGS} />,
		);

		expect(screen.getByText("11 22")).toBeInTheDocument();
		expect(screen.getByText("7 frames")).toBeInTheDocument();
	});

	it("marks a CAN FD frame and its bit-rate switch", () => {
		render(
			<LiveMessageCard
				live={{ ...known, fd: true, bitrateSwitch: true }}
				settings={DEFAULT_VISUALIZE_SETTINGS}
			/>,
		);

		expect(screen.getByText("FD")).toBeInTheDocument();
		expect(screen.getByText("BRS")).toBeInTheDocument();
	});

	it("leaves the badges off a classic frame", () => {
		render(
			<LiveMessageCard live={known} settings={DEFAULT_VISUALIZE_SETTINGS} />,
		);

		expect(screen.queryByText("FD")).not.toBeInTheDocument();
		expect(screen.queryByText("BRS")).not.toBeInTheDocument();
	});

	it("marks a frame whose id is not in the DBC", () => {
		const unknown: LiveMessage = {
			id: 0x999,
			extended: true,
			fd: false,
			bitrateSwitch: false,
			data: [0xde, 0xad],
			receivedAt: 1000,
			count: 1,
			signals: {},
		};

		render(
			<LiveMessageCard live={unknown} settings={DEFAULT_VISUALIZE_SETTINGS} />,
		);

		expect(screen.getByText("Not in DBC")).toBeInTheDocument();
		expect(screen.getByText("0x00000999")).toBeInTheDocument();
		expect(screen.getByText("DE AD")).toBeInTheDocument();
	});
});
