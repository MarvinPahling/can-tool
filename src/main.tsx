import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { perfFlags } from "./lib/perf-flags";
import { queryClient } from "./lib/query-client";
import { router } from "./router";
import "./lib/theme";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
			{/* A variable in the memory baseline: the devtools subscribe to the
			    cache and retain their own state. Turn them off with
			    `can-tool:perf` rather than by editing this file, so a run can be
			    repeated without a rebuild. */}
			{perfFlags.devtools && <ReactQueryDevtools initialIsOpen={false} />}
		</QueryClientProvider>
	</React.StrictMode>,
);
