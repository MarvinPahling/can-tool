import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SimulationPanel } from "@/components/simulation-panel";

const searchSchema = z.object({
	q: z.string().optional(),
});

export const Route = createFileRoute("/simulate")({
	validateSearch: searchSchema,
	component: SimulateComponent,
});

function SimulateComponent() {
	const { q = "" } = Route.useSearch();
	const navigate = Route.useNavigate();

	return (
		<div className="p-4">
			<h1 className="text-xl font-semibold">Simulation</h1>
			<div className="mt-4">
				<SimulationPanel
					filter={q}
					// Kept in the URL like the other two routes' filters.
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
