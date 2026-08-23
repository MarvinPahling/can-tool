import {
	columnFilteringFeature,
	createExpandedRowModel,
	createFilteredRowModel,
	createSortedRowModel,
	filterFn_includesString,
	globalFilteringFeature,
	rowExpandingFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_text,
	tableFeatures,
} from "@tanstack/react-table";

/**
 * The full set of feature plugins, row-model factories, and fn registries the
 * DBC grid needs: row expanding (message -> signal sub-rows), global text
 * filtering, and column sorting. Declared once, statically, per the v9
 * headless pattern — never recreated per render.
 */
export const dbcTableFeatures = tableFeatures({
	rowExpandingFeature,
	columnFilteringFeature,
	globalFilteringFeature,
	rowSortingFeature,
	expandedRowModel: createExpandedRowModel(),
	filteredRowModel: createFilteredRowModel(),
	sortedRowModel: createSortedRowModel(),
	filterFns: { includesString: filterFn_includesString },
	sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

export type DbcTableFeatures = typeof dbcTableFeatures;
