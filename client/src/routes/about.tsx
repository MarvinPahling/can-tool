import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: AboutComponent,
});

function AboutComponent() {
  return (
    <div className="page">
      <h1>About</h1>
      <p>A small demo of TanStack Router inside a Tauri + React app.</p>
    </div>
  );
}
