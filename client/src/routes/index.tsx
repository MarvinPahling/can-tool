import { createFileRoute, Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { useParseDbcFile } from "@/queries/dbc";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const parseDbcFile = useParseDbcFile();

  async function handleOpenDbcFile() {
    const path = await open({
      multiple: false,
      filters: [{ name: "DBC", extensions: ["dbc"] }],
    });
    if (typeof path === "string") {
      parseDbcFile.mutate(path);
    }
  }

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

      <div style={{ marginTop: "1.5rem" }}>
        <Button onClick={handleOpenDbcFile} disabled={parseDbcFile.isPending}>
          {parseDbcFile.isPending ? "Parsing…" : "Open DBC file"}
        </Button>

        {parseDbcFile.isError && (
          <p style={{ color: "var(--destructive, crimson)" }}>
            {parseDbcFile.error instanceof Error
              ? parseDbcFile.error.message
              : "Failed to parse DBC file"}
          </p>
        )}

        {parseDbcFile.isSuccess && (
          <p>
            Parsed DBC version "{parseDbcFile.data.version}" with{" "}
            {parseDbcFile.data.nodes.length} node(s) and{" "}
            {parseDbcFile.data.messages.length} message(s).
          </p>
        )}
      </div>
    </div>
  );
}
