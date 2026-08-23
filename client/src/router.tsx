import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./lib/query-client";

function DefaultPending() {
  return <div className="page muted">Loading…</div>;
}

function DefaultError({ error }: { error: Error }) {
  return (
    <div className="page">
      <p className="error">Something went wrong: {error.message}</p>
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
