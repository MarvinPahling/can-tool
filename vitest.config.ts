// @ts-expect-error type error without @types/node package
import path from "node:path";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Separate from vite.config.ts: the TanStack Router plugin generates
// routeTree.gen.ts on every dev/build run, which unit tests don't need and
// which would otherwise touch the filesystem on every test run.
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(process.cwd(), "./src"),
		},
	},
	test: {
		environment: "jsdom",
		environmentOptions: {
			jsdom: {
				url: "http://localhost:3000",
			},
		},
		setupFiles: ["./src/test/setup.ts"],
		globals: false,
		reporters: ["default", "junit", "html"],
		outputFile: {
			junit: "./test-results/frontend-junit.xml",
			html: "./test-results/frontend-html/index.html",
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			reportsDirectory: "./test-results/coverage",
			exclude: [
				"src/generated/**",
				"src/routeTree.gen.ts",
				"src/components/ui/**",
				"**/*.config.*",
			],
		},
		exclude: ["node_modules", "dist", "src-tauri", "e2e"],
	},
});
