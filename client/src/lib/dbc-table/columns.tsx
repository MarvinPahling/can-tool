import { createColumnHelper } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import type { DbcTableFeatures } from "./features";
import type { DbcRow } from "./rows";

const columnHelper = createColumnHelper<DbcTableFeatures, DbcRow>();

function toHex(id: number) {
	return `0x${id.toString(16).toUpperCase().padStart(3, "0")}`;
}

export const dbcColumns = columnHelper.columns([
	columnHelper.display({
		id: "expander",
		header: "",
		enableSorting: false,
	}),
	columnHelper.accessor(
		(row) => (row.kind === "message" ? row.message.name : row.signal.name),
		{
			id: "name",
			header: "Name",
			sortFn: "alphanumeric",
		},
	),
	columnHelper.accessor(
		(row) => (row.kind === "message" ? row.message.id : row.signal.start_bit),
		{
			id: "idOrStartBit",
			header: "ID / Start bit",
			cell: (info) => {
				const row = info.row.original;
				return row.kind === "message"
					? toHex(row.message.id)
					: row.signal.start_bit;
			},
			enableGlobalFilter: false,
		},
	),
	columnHelper.accessor(
		(row) => (row.kind === "message" ? row.message.size : row.signal.size),
		{
			id: "size",
			header: "Size",
			cell: (info) => {
				const row = info.row.original;
				return row.kind === "message"
					? `${row.message.size} B`
					: `${row.signal.size} bit`;
			},
			enableGlobalFilter: false,
		},
	),
	columnHelper.display({
		id: "typeInfo",
		header: "Type",
		cell: (info) => {
			const row = info.row.original;
			if (row.kind === "message") {
				return (
					<Badge variant={row.message.extended ? "secondary" : "outline"}>
						{row.message.extended ? "Extended" : "Standard"}
					</Badge>
				);
			}
			const endianness = row.signal.little_endian
				? "little-endian"
				: "big-endian";
			const sign = row.signal.signed ? "signed" : "unsigned";
			return (
				<span className="text-muted-foreground">
					{sign}, {endianness}
				</span>
			);
		},
	}),
	columnHelper.display({
		id: "factorOffset",
		header: "Factor · Offset",
		cell: (info) => {
			const row = info.row.original;
			if (row.kind !== "signal") return null;
			return `${row.signal.factor} · ${row.signal.offset}`;
		},
	}),
	columnHelper.display({
		id: "range",
		header: "Range",
		cell: (info) => {
			const row = info.row.original;
			if (row.kind !== "signal") return null;
			return `${row.signal.min} – ${row.signal.max}`;
		},
	}),
	columnHelper.accessor(
		(row) => (row.kind === "signal" ? row.signal.unit : ""),
		{
			id: "unit",
			header: "Unit",
			enableGlobalFilter: false,
		},
	),
	columnHelper.accessor(
		(row) =>
			row.kind === "message"
				? (row.message.transmitter ?? "")
				: row.signal.receivers.join(", "),
		{
			id: "nodes",
			header: "Transmitter / Receivers",
		},
	),
]);
