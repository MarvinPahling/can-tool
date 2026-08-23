import { createFileRoute } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DbcSummary } from "@/components/dbc-summary";
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
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">CAN Tool</h1>

      <div className="mt-6">
        <Button onClick={handleOpenDbcFile} disabled={parseDbcFile.isPending}>
          {parseDbcFile.isPending ? "Parsing…" : "Open DBC file"}
        </Button>

        {parseDbcFile.isError && (
          <Alert variant="destructive" className="mt-3">
            <AlertTitle>Failed to parse DBC file</AlertTitle>
            <AlertDescription>
              {parseDbcFile.error instanceof Error
                ? parseDbcFile.error.message
                : "Unknown error"}
            </AlertDescription>
          </Alert>
        )}

        {parseDbcFile.isSuccess && (
          <div className="mt-3">
            <DbcSummary dbc={parseDbcFile.data} />
          </div>
        )}
      </div>
    </div>
  );
}
