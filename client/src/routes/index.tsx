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
import { SignalBitGrid } from "@/components/signal-bit-grid";
import { useParseDbcFile } from "@/queries/dbc";
import type { DbcMessage, DbcSignal } from "@/api/dbc";
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
  const [hoveredSignal, setHoveredSignal] = useState<DbcSignal | null>(null);

  function handleSignalHover(signal: DbcSignal | null, message?: DbcMessage) {
    setHoveredSignal(signal);
    if (signal && message) setSelectedMessageId(String(message.id));
  }

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
    <div className={cn("p-4", !parseDbcFile.isSuccess && "mx-auto max-w-xl")}>
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
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
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
                  hoveredSignal={hoveredSignal}
                  onSignalHover={handleSignalHover}
                />
              </DbcTableScope>
              {parseDbcFile.data.messages.length > 0 && (
                <div className="lg:sticky lg:top-4">
                  <SignalLayoutSection
                    messages={parseDbcFile.data.messages}
                    selectedMessageId={selectedMessageId}
                    onSelectMessageId={setSelectedMessageId}
                    hoveredSignal={hoveredSignal}
                    onSignalHover={handleSignalHover}
                  />
                </div>
              )}
            </div>
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
  hoveredSignal,
  onSignalHover,
}: {
  messages: DbcMessage[];
  selectedMessageId: string | null;
  onSelectMessageId: (id: string) => void;
  hoveredSignal: DbcSignal | null;
  onSignalHover: (signal: DbcSignal | null, message?: DbcMessage) => void;
}) {
  const selectedMessage =
    messages.find((message) => String(message.id) === selectedMessageId) ?? messages[0];
  const hoveredSignalInMessage = selectedMessage.signals.includes(hoveredSignal as DbcSignal)
    ? hoveredSignal
    : null;

  return (
    <div className="space-y-3">
      <Select
        value={String(selectedMessage.id)}
        onValueChange={(value) => {
          if (value) onSelectMessageId(value);
        }}
      >
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Select a message">
            {(value: string | null) =>
              messages.find((message) => String(message.id) === value)?.name ?? "Select a message"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {messages.map((message) => (
            <SelectItem key={message.id} value={String(message.id)}>
              {message.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SignalBitGrid
        message={selectedMessage}
        hoveredSignal={hoveredSignalInMessage}
        onSignalHover={(signal) => onSignalHover(signal, selectedMessage)}
      />
    </div>
  );
}
