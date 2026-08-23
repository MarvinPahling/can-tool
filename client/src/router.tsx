import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

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
  defaultPreload: "intent",
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
