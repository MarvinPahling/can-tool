import { createRouter } from "@tanstack/react-router";
import { queryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";

function DefaultPending() {
	return (
		<div className="mx-auto max-w-xl p-8 text-muted-foreground">Loading…</div>
	);
}

function DefaultError({ error }: { error: Error }) {
	return (
		<div className="mx-auto max-w-xl p-8">
			<p className="text-destructive">Something went wrong: {error.message}</p>
		</div>
	);
}

export const router = createRouter({
	routeTree,
	context: { queryClient },
	defaultPreload: "intent",
	// Query owns staleness; let the router re-run loaders on every preload
	// and defer to `ensureQueryData` to decide whether a fetch is needed.
	defaultPreloadStaleTime: 0,
	defaultPendingComponent: DefaultPending,
	defaultErrorComponent: DefaultError,
	defaultPendingMs: 150,
	defaultPendingMinMs: 200,
	scrollRestoration: true,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
