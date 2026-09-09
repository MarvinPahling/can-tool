import { Link, useNavigate } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Keyboard, Minus, Send, Square, Usb, X } from "lucide-react";
import { useEffect, useState } from "react";
import { runCommand, useCommandHandler } from "@/commands";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cycleTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useConnectionStatus } from "@/queries/can";

const appWindow = getCurrentWindow();

const NAV_LINKS = [
	{ to: "/", label: "DBC" },
	{ to: "/visualize", label: "Live" },
	{ to: "/simulate", label: "Simulate" },
] as const;

export function Titlebar() {
	const [isMaximized, setIsMaximized] = useState(false);
	const status = useConnectionStatus();
	const navigate = useNavigate();

	useCommandHandler("app.toggleTheme", cycleTheme);
	useCommandHandler("view.dbc", () => navigate({ to: "/" }));
	useCommandHandler("view.visualize", () => navigate({ to: "/visualize" }));
	useCommandHandler("view.simulate", () => navigate({ to: "/simulate" }));

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
			<div
				data-tauri-drag-region
				className="flex h-full flex-1 items-center px-3"
			>
				<span className="text-xs font-medium text-sidebar-foreground">
					CAN Tool
				</span>
				<nav className="ml-4 flex items-center gap-1">
					{NAV_LINKS.map((link) => (
						<Link
							key={link.to}
							to={link.to}
							className="rounded-sm px-2 py-0.5 text-xs text-muted-foreground hover:text-sidebar-foreground"
							activeProps={{
								className: "bg-sidebar-accent text-sidebar-accent-foreground",
							}}
							activeOptions={{ exact: true }}
						>
							{link.label}
						</Link>
					))}
				</nav>
			</div>
			<div className="flex h-full items-center">
				<ThemeToggle />
				<Button
					variant="ghost"
					size="icon"
					className="h-full w-10 rounded-none"
					title="Send CAN Message…"
					onClick={() => runCommand("message.send")}
				>
					<Send />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="relative h-full w-10 rounded-none"
					title={
						status.data
							? `Connected to ${status.data.port_name}`
							: "Connect Device…"
					}
					onClick={() => runCommand("device.connect")}
				>
					<Usb />
					<span
						className={cn(
							"absolute right-2.5 top-2 size-1.5 rounded-full",
							status.data ? "bg-emerald-500" : "bg-muted-foreground/40",
						)}
					/>
				</Button>
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
