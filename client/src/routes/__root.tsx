import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { QueryClient } from "@tanstack/react-query";

import { Titlebar } from "@/components/titlebar";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { CommandsProvider } from "@/commands";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">404</h1>
      <p className="mt-3 text-muted-foreground">That page doesn't exist.</p>
      <Link to="/" className="text-primary underline-offset-4 hover:underline">
        Go home
      </Link>
    </div>
  ),
});

function RootComponent() {
  return (
    <CommandsProvider>
      <div className="flex h-screen flex-col">
        <Titlebar />
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
        <TanStackRouterDevtools position="bottom-right" />
      </div>
      <ShortcutsDialog />
    </CommandsProvider>
  );
}
