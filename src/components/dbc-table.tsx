import { useTable } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import type { Ref } from "react";
import type { DbcFile, DbcMessage, DbcSignal } from "@/api/dbc";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { dbcColumns } from "@/lib/dbc-table/columns";
import { dbcTableFeatures } from "@/lib/dbc-table/features";
import { buildDbcRows, type DbcRow, getDbcSubRows } from "@/lib/dbc-table/rows";
import { useRequestSendMessage } from "@/lib/pending-send";
import { cn } from "@/lib/utils";

const modKeyLabel =
	typeof navigator !== "undefined" && /mac/i.test(navigator.platform)
		? "⌘"
		: "Ctrl";

export function DbcTable({
	dbc,
	globalFilter,
	onGlobalFilterChange,
	filterInputRef,
	hoveredSignal,
	onSignalHover,
}: {
	dbc: DbcFile;
	/** Owned by the route (synced to the URL `q` search param), not by the table. */
	globalFilter: string;
	onGlobalFilterChange: (value: string) => void;
	/** Exposed so the route can focus it for the "table.focusFilter" command ("G F"). */
	filterInputRef?: Ref<HTMLInputElement>;
	/** Signal currently hovered, for row highlighting. */
	hoveredSignal?: DbcSignal | null;
	onSignalHover?: (signal: DbcSignal | null, message?: DbcMessage) => void;
}) {
	const data = buildDbcRows(dbc);
	const requestSendMessage = useRequestSendMessage();

	const table = useTable({
		features: dbcTableFeatures,
		columns: dbcColumns,
		data,
		getSubRows: getDbcSubRows,
		getRowId: (row: DbcRow) => row.id,
		state: { globalFilter },
		onGlobalFilterChange: (updater) =>
			onGlobalFilterChange(
				typeof updater === "function" ? updater(globalFilter) : updater,
			),
		globalFilterFn: "includesString",
		initialState: { expanded: true },
	});

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				<Input
					ref={filterInputRef}
					placeholder="Filter messages and signals…"
					value={globalFilter}
					onChange={(e) => table.setGlobalFilter(e.target.value)}
					className="max-w-xs"
				/>
				<table.Subscribe selector={(state) => state.globalFilter}>
					{() => (
						<span className="text-xs text-muted-foreground">
							{table.getRowModel().rows.length} message(s)
						</span>
					)}
				</table.Subscribe>
			</div>

			<Table>
				<TableCaption className="sr-only">
					DBC messages and signals from "{dbc.version}"
				</TableCaption>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<TableHead
									key={header.id}
									className={
										header.column.id === "expander" ? "w-8" : undefined
									}
								>
									{header.isPlaceholder ? null : header.column.getCanSort() ? (
										<button
											type="button"
											onClick={header.column.getToggleSortingHandler()}
											className="flex items-center gap-1 hover:text-foreground"
										>
											<table.FlexRender header={header} />
											{{ asc: "↑", desc: "↓" }[
												header.column.getIsSorted() as string
											] ?? null}
										</button>
									) : (
										<table.FlexRender header={header} />
									)}
								</TableHead>
							))}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{table.getRowModel().rows.map((row) => (
						<TableRow
							key={row.id}
							title={`${modKeyLabel}-click to send this message`}
							className={cn(
								row.original.kind === "signal" && "bg-muted/20",
								row.original.kind === "signal" &&
									row.original.signal === hoveredSignal &&
									"bg-accent",
							)}
							onMouseEnter={() =>
								row.original.kind === "signal" &&
								onSignalHover?.(row.original.signal, row.original.message)
							}
							onMouseLeave={() =>
								row.original.kind === "signal" && onSignalHover?.(null)
							}
							onClick={(e) => {
								if (e.metaKey || e.ctrlKey) {
									requestSendMessage(String(row.original.message.id));
								}
							}}
						>
							{row.getAllCells().map((cell) => (
								<TableCell key={cell.id}>
									{cell.column.id === "expander" ? (
										row.getCanExpand() ? (
											<button
												type="button"
												onClick={row.getToggleExpandedHandler()}
												aria-expanded={row.getIsExpanded()}
												aria-label={
													row.getIsExpanded() ? "Collapse row" : "Expand row"
												}
												className="text-muted-foreground hover:text-foreground"
											>
												<ChevronRight
													className={cn(
														"size-3.5 transition-transform",
														row.getIsExpanded() && "rotate-90",
													)}
												/>
											</button>
										) : null
									) : (
										<table.FlexRender cell={cell} />
									)}
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
