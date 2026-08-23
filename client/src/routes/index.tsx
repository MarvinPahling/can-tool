import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="page">
      <h1>Welcome</h1>
      <p>
        This app is wired up with TanStack Router: a generated route tree,
        typed params and search schemas, loaders, intent preloading, and
        automatic per-route code splitting.
      </p>
      <p>
        Head to <Link to="/posts">Posts</Link> and try filtering — the filter
        and page live in the URL, so the view is fully shareable and
        back-button friendly.
      </p>
    </div>
  );
}
