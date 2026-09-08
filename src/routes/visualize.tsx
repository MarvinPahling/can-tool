import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LiveTraffic } from "@/components/live-traffic";

const searchSchema = z.object({
	q: z.string().optional(),
});

export const Route = createFileRoute("/visualize")({
	validateSearch: searchSchema,
	component: VisualizeComponent,
});

function VisualizeComponent() {
	const { q = "" } = Route.useSearch();
	const navigate = Route.useNavigate();

	return (
		<div className="p-4">
			<h1 className="text-xl font-semibold">Live Traffic</h1>
			<div className="mt-4">
				<LiveTraffic
					filter={q}
					// Kept in the URL rather than component state, matching the DBC
					// browser's filter.
					onFilterChange={(value) =>
						navigate({
							search: (prev) => ({ ...prev, q: value || undefined }),
							replace: true,
						})
					}
				/>
			</div>
		</div>
	);
}
