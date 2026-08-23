import {
	columnFilteringFeature,
	createFilteredRowModel,
	createSortedRowModel,
	filterFn_includesString,
	globalFilteringFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_text,
	tableFeatures,
} from "@tanstack/react-table";

/**
 * The full set of feature plugins, row-model factories, and fn registries the
 * DBC grid needs: global text filtering and column sorting. Message/signal
 * expansion is resolved before rows reach the table (see `buildDbcRows`)
 * rather than through the table's own row-expanding feature.
 */
export const dbcTableFeatures = tableFeatures({
	columnFilteringFeature,
	globalFilteringFeature,
	rowSortingFeature,
	filteredRowModel: createFilteredRowModel(),
	sortedRowModel: createSortedRowModel(),
	filterFns: { includesString: filterFn_includesString },
	sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

export type DbcTableFeatures = typeof dbcTableFeatures;
