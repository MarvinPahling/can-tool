import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbcFile } from "@/api/dbc";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { makeDbcFile, makeMessage, makeSignal } from "@/test/fixtures";

// The real chrome around the routes reaches for Tauri windows, events and the
// live CAN stream, none of which exist under jsdom. Stubbing it keeps the test
// about the one thing it is checking: what the "/" route renders after a
// round-trip to "/visualize".
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@/components/titlebar", () => ({ Titlebar: () => null }));
vi.mock("@/components/shortcuts-dialog", () => ({
	ShortcutsDialog: () => null,
}));
vi.mock("@/components/device-connect-dialog", () => ({
	DeviceConnectDialog: () => null,
}));
// Deliberately stubbed out: the real dialog observes useCurrentDbc from the
// root route, which would keep the cache entry alive on its own and hide the
// garbage-collection case below.
vi.mock("@/components/send-message-dialog", () => ({
	SendMessageDialog: () => null,
}));
vi.mock("@/components/live-traffic", () => ({
	LiveTraffic: () => <div>live traffic</div>,
}));
vi.mock("@tanstack/react-router-devtools", () => ({
	TanStackRouterDevtools: () => null,
}));

const { openDialog, parseDbcFile } = vi.hoisted(() => ({
	openDialog: vi.fn(),
	parseDbcFile: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialog }));
vi.mock("@/api/dbc", () => ({ parseDbcFile }));

const dbc = makeDbcFile({
	messages: [
		makeMessage({
			id: 0x1a0,
			name: "Speed",
			signals: [makeSignal({ name: "Value", start_bit: 0, size: 8 })],
		}),
	],
});

let queryClient: QueryClient;

/** "Speed" renders both as a table row and in the message picker. */
function findDbcContent() {
	return screen.findAllByText("Speed");
}

function renderApp(seed?: DbcFile) {
	if (seed) queryClient.setQueryData(["dbc", "current"], seed);
	const router = createRouter({
		routeTree,
		context: { queryClient },
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	const utils = render(
		<QueryClientProvider client={queryClient}>
			{/* biome-ignore lint/suspicious/noExplicitAny: the test router is not the app's registered router */}
			<RouterProvider router={router as any} />
		</QueryClientProvider>,
	);
	return { ...utils, router };
}

/** The reported repro: leave the DBC tab for the live tab and come back. */
async function roundTripThroughVisualize(router: {
	navigate: (opts: { to: string }) => Promise<void>;
}) {
	await act(async () => {
		await router.navigate({ to: "/visualize" });
	});
	await screen.findByText("live traffic");
	await act(async () => {
		await router.navigate({ to: "/" });
	});
}

beforeEach(() => {
	// The real factory, so the test sees the app's own cache defaults.
	queryClient = createQueryClient();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("the DBC route", () => {
	it("renders a DBC that is already in the shared cache", async () => {
		renderApp(dbc);

		expect(await findDbcContent()).not.toHaveLength(0);
		expect(parseDbcFile).not.toHaveBeenCalled();
	});

	it("keeps the loaded file after a round-trip to the live tab", async () => {
		const { router } = renderApp(dbc);
		await findDbcContent();

		await roundTripThroughVisualize(router);

		expect(await findDbcContent()).not.toHaveLength(0);
		expect(
			screen.getByRole("button", { name: /open dbc file/i }),
		).toBeVisible();
	});

	it("keeps a file opened through the dialog after a round-trip", async () => {
		openDialog.mockResolvedValue("/tmp/example.dbc");
		parseDbcFile.mockResolvedValue(dbc);
		const { router } = renderApp();

		const openButton = await screen.findByRole("button", {
			name: /open dbc file/i,
		});
		await act(async () => {
			openButton.click();
		});
		await findDbcContent();

		await roundTripThroughVisualize(router);

		expect(await findDbcContent()).not.toHaveLength(0);
	});

	it("shows the empty state when no file has been opened", async () => {
		renderApp();

		expect(
			await screen.findByRole("button", { name: /open dbc file/i }),
		).toBeInTheDocument();
		expect(screen.queryAllByText("Speed")).toHaveLength(0);
	});

	it("reports a failed parse without discarding the loaded file", async () => {
		openDialog.mockResolvedValue("/tmp/broken.dbc");
		parseDbcFile.mockRejectedValue(new Error("unexpected token"));
		renderApp(dbc);
		await findDbcContent();

		const openButton = screen.getByRole("button", { name: /open dbc file/i });
		await act(async () => {
			openButton.click();
		});

		expect(await screen.findByText(/failed to parse dbc file/i)).toBeVisible();
		expect(screen.getByText("unexpected token")).toBeInTheDocument();
		expect(screen.getAllByText("Speed").length).toBeGreaterThan(0);
	});

	it("does not garbage-collect the cached file while nothing observes it", async () => {
		vi.useFakeTimers();
		try {
			queryClient.setQueryData(["dbc", "current"], dbc);
			// No component is mounted at all, so the entry has no observers —
			// the default gcTime is 5 minutes.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
			});

			expect(queryClient.getQueryData(["dbc", "current"])).toEqual(dbc);
		} finally {
			vi.useRealTimers();
		}

		renderApp();
		await waitFor(() => {
			expect(screen.getAllByText("Speed").length).toBeGreaterThan(0);
		});
	});
});
