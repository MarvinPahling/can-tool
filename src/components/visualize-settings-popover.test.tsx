import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_VISUALIZE_SETTINGS,
	visualizeSettingsStore,
} from "@/lib/visualize-settings";
import { VisualizeSettingsPopover } from "./visualize-settings-popover";

afterEach(() => {
	visualizeSettingsStore.setState(() => ({ ...DEFAULT_VISUALIZE_SETTINGS }));
	localStorage.clear();
});

/**
 * Base UI hides slider thumbs until it has measured the control, which jsdom
 * never does, so they stay out of the accessibility tree. Reach them through
 * the labelled group that wraps them.
 */
function slider(name: RegExp) {
	return within(screen.getByRole("group", { name })).getByRole("slider", {
		hidden: true,
	});
}

async function openPopover() {
	const user = userEvent.setup();
	render(<VisualizeSettingsPopover />);
	await user.click(screen.getByRole("button", { name: /highlight settings/i }));
	return user;
}

describe("VisualizeSettingsPopover", () => {
	it("persists the threshold toggle", async () => {
		const user = await openPopover();

		await user.click(
			screen.getByRole("switch", { name: /only highlight significant/i }),
		);

		expect(visualizeSettingsStore.state.thresholdEnabled).toBe(true);
	});

	it("disables the threshold slider until the toggle is on", async () => {
		const user = await openPopover();
		expect(slider(/threshold/i)).toBeDisabled();

		await user.click(
			screen.getByRole("switch", { name: /only highlight significant/i }),
		);

		expect(slider(/threshold/i)).not.toBeDisabled();
	});

	it("updates the fade duration from its slider", async () => {
		await openPopover();

		fireEvent.change(slider(/fade/i), { target: { value: "2000" } });

		expect(visualizeSettingsStore.state.fadeMs).toBe(2000);
	});

	it("restores the defaults on reset", async () => {
		const user = await openPopover();

		await user.click(
			screen.getByRole("switch", { name: /only highlight significant/i }),
		);
		expect(visualizeSettingsStore.state.thresholdEnabled).toBe(true);

		await user.click(screen.getByRole("button", { name: /reset/i }));

		expect(visualizeSettingsStore.state).toEqual(DEFAULT_VISUALIZE_SETTINGS);
	});
});
