import { createFileRoute } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DbcSummary } from "@/components/dbc-summary";
import { DbcTable } from "@/components/dbc-table";
import { useParseDbcFile } from "@/queries/dbc";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  q: z.string().optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  component: HomeComponent,
});

function HomeComponent() {
  const parseDbcFile = useParseDbcFile();
  const { q = "" } = Route.useSearch();
  const navigate = Route.useNavigate();

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
    <div className={cn("mx-auto p-8", parseDbcFile.isSuccess ? "max-w-4xl" : "max-w-xl")}>
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
          <div className="mt-3 space-y-4">
            <DbcSummary dbc={parseDbcFile.data} />
            <DbcTable
              dbc={parseDbcFile.data}
              globalFilter={q}
              onGlobalFilterChange={(value) =>
                navigate({
                  search: (prev) => ({ ...prev, q: value || undefined }),
                  replace: true,
                })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
