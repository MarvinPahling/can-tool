import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X, Keyboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { runCommand, useCommandHandler } from "@/commands";
import { cycleTheme } from "@/lib/theme";

const appWindow = getCurrentWindow();

export function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useCommandHandler("app.toggleTheme", cycleTheme);

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-sidebar select-none"
    >
      <div data-tauri-drag-region className="flex h-full flex-1 items-center px-3">
        <span className="text-xs font-medium text-sidebar-foreground">client</span>
      </div>
      <div className="flex h-full items-center">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-10 rounded-none"
          title="Keyboard Shortcuts…"
          onClick={() => runCommand("app.showShortcuts")}
        >
          <Keyboard />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-10 rounded-none"
          onClick={() => appWindow.minimize()}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-10 rounded-none"
          onClick={() => appWindow.toggleMaximize()}
        >
          {isMaximized ? <Copy className="rotate-90" /> : <Square />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-10 rounded-none hover:bg-destructive hover:text-white"
          onClick={() => appWindow.close()}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
