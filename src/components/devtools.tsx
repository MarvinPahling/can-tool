import { lazy, Suspense } from "react";
import { perfFlags } from "@/lib/perf-flags";

/**
 * The TanStack devtools, kept out of production builds entirely.
 *
 * They were mounted unconditionally: both subscribe to the thing they inspect
 * (the query cache, the router), retain their own state, and shipped inside
 * the release bundle where nothing could ever open them.
 *
 * The `import.meta.env.DEV` test is outside the `lazy` call rather than inside
 * the component on purpose. Vite substitutes `false` there at build time, so
 * the whole ternary folds away and the `import()` becomes unreachable — no
 * chunk is emitted and neither package is bundled. A guard inside the
 * component would still leave the chunk in `dist`.
 *
 * `perfFlags.devtools` is the second switch, for turning them off in a *dev*
 * build while measuring; see `src/lib/perf-flags.ts`.
 */
const LazyQueryDevtools = import.meta.env.DEV
	? lazy(() =>
			import("@tanstack/react-query-devtools").then((module) => ({
				default: module.ReactQueryDevtools,
			})),
		)
	: null;

const LazyRouterDevtools = import.meta.env.DEV
	? lazy(() =>
			import("@tanstack/react-router-devtools").then((module) => ({
				default: module.TanStackRouterDevtools,
			})),
		)
	: null;

export function QueryDevtools() {
	if (!LazyQueryDevtools || !perfFlags.devtools) return null;
	return (
		<Suspense fallback={null}>
			<LazyQueryDevtools initialIsOpen={false} />
		</Suspense>
	);
}

export function RouterDevtools() {
	if (!LazyRouterDevtools || !perfFlags.devtools) return null;
	return (
		<Suspense fallback={null}>
			<LazyRouterDevtools position="bottom-right" />
		</Suspense>
	);
}
