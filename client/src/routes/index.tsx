import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DbcSummary } from "@/components/dbc-summary";
import { DbcTable } from "@/components/dbc-table";
import { DbcSignalLayoutChart } from "@/components/dbc-signal-layout-chart";
import { useParseDbcFile } from "@/queries/dbc";
import type { DbcMessage } from "@/api/dbc";
import { cn } from "@/lib/utils";
import { formatBinding, useCommandHandler, useEffectiveBinding, useScope } from "@/commands";

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
  const filterInputRef = useRef<HTMLInputElement>(null);
  const openBinding = useEffectiveBinding("file.open");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  async function handleOpenDbcFile() {
    const path = await open({
      multiple: false,
      filters: [{ name: "DBC", extensions: ["dbc"] }],
    });
    if (typeof path === "string") {
      parseDbcFile.mutate(path);
    }
  }

  // "file.open" is bound to Mod+O by default and to the native File > Open File…
  // menu item (src-tauri/src/lib.rs); both trigger this same implementation.
  useCommandHandler("file.open", handleOpenDbcFile);

  // "table.focusFilter" ("G" then "F") is scoped to "dbc-table" (see
  // DbcTableScope below), so the sequence only fires while a file is loaded.
  useCommandHandler("table.focusFilter", () => filterInputRef.current?.focus());

  return (
    <div className={cn("mx-auto p-8", parseDbcFile.isSuccess ? "max-w-4xl" : "max-w-xl")}>
      <h1 className="text-xl font-semibold">CAN Tool</h1>

      <div className="mt-6">
        <Button onClick={handleOpenDbcFile} disabled={parseDbcFile.isPending}>
          {parseDbcFile.isPending ? "Parsing…" : "Open DBC file"}
        </Button>
        <span className="ml-2 text-xs text-muted-foreground">{formatBinding(openBinding)}</span>

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
            {parseDbcFile.data.messages.length > 0 && (
              <SignalLayoutSection
                messages={parseDbcFile.data.messages}
                selectedMessageId={selectedMessageId}
                onSelectMessageId={setSelectedMessageId}
              />
            )}
            <DbcTableScope>
              <DbcTable
                dbc={parseDbcFile.data}
                globalFilter={q}
                onGlobalFilterChange={(value) =>
                  navigate({
                    search: (prev) => ({ ...prev, q: value || undefined }),
                    replace: true,
                  })
                }
                filterInputRef={filterInputRef}
              />
            </DbcTableScope>
          </div>
        )}
      </div>
    </div>
  );
}

/** Activates the "dbc-table" command scope only while the table is mounted. */
function DbcTableScope({ children }: { children: ReactNode }) {
  useScope("dbc-table");
  return <>{children}</>;
}

function SignalLayoutSection({
  messages,
  selectedMessageId,
  onSelectMessageId,
}: {
  messages: DbcMessage[];
  selectedMessageId: string | null;
  onSelectMessageId: (id: string) => void;
}) {
  const selectedMessage =
    messages.find((message) => String(message.id) === selectedMessageId) ?? messages[0];

  return (
    <div className="space-y-3">
      <Select
        value={String(selectedMessage.id)}
        onValueChange={(value) => {
          if (value) onSelectMessageId(value);
        }}
      >
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Select a message" />
        </SelectTrigger>
        <SelectContent>
          {messages.map((message) => (
            <SelectItem key={message.id} value={String(message.id)}>
              {message.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DbcSignalLayoutChart message={selectedMessage} />
    </div>
  );
}
