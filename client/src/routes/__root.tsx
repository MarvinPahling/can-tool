import {
  createRootRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => (
    <div className="page">
      <h1>404</h1>
      <p>That page doesn't exist.</p>
      <Link to="/">Go home</Link>
    </div>
  ),
});

function RootComponent() {
  const isLoading = useRouterState({ select: (s) => s.status === "pending" });

  return (
    <>
      <nav className="nav">
        <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: "active" }}>
          Home
        </Link>
        <Link to="/posts" activeProps={{ className: "active" }}>
          Posts
        </Link>
        <Link to="/about" activeProps={{ className: "active" }}>
          About
        </Link>
        {isLoading && <span className="nav-spinner" aria-label="Loading">⋯</span>}
      </nav>
      <Outlet />
      <TanStackRouterDevtools position="bottom-right" />
    </>
  );
}
