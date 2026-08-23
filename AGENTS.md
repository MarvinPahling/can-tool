# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Tauri desktop app for interacting with a CAN FD bus. The app code lives entirely under `client/`; the repo root currently contains only `client/` and `docs/` (empty).

Frontend: React + TanStack Router + TanStack Query + Tailwind + shadcn/ui (base-ui style). Backend: Rust via Tauri 2. Package managers: bun (JS) and cargo (Rust). Task runner: `client/justfile`.

The starter scaffold's CRUD demo (posts) has been removed. The only domain feature so far is opening and parsing a DBC file (`src-tauri/src/dbc.rs`, driven by the `can-dbc` crate) — see "DBC feature" below. Expect this to grow into full CAN FD functionality (bus connections, frame streaming, live signal decoding, etc.) as the project develops.

## Commands

All commands run from `client/` (the justfile assumes this cwd).

```
just dev      # bun run tauri dev — full Tauri app window (Rust backend + Vite frontend, hot-reloaded)
just build    # bun run tauri build — tsc typecheck + vite build + Rust release build, packaged as a desktop app
just clean    # removes dist/, node_modules/.vite, and cargo-cleans src-tauri
```

Other useful commands (no justfile target yet):
- `bun run dev` / `bun run build` — Vite alone, frontend only (no Tauri window, no Rust backend).
- `cargo check --manifest-path client/src-tauri/Cargo.toml` — typecheck Rust without a full build.
- `cargo tauri-typegen generate` — regenerate `client/src/generated/{types,commands,index}.ts` from the Rust `#[tauri::command]` definitions. Re-run this after adding/changing a Tauri command; it also runs automatically at build time via `build.rs`.

There is no test runner or linter configured yet in `package.json`/Cargo.toml.

## Architecture

### End-to-end type safety via tauri-typegen

Rust `#[tauri::command]` functions in `src-tauri/src/*.rs` are the single source of truth for backend API shape. `tauri-typegen` (invoked from `build.rs` at build time, or manually via `cargo tauri-typegen generate`) generates Zod-validated TypeScript bindings into `client/src/generated/` (`types.ts`, `commands.ts`, `index.ts`). **Never hand-edit files in `src/generated/`** — they're regenerated and marked as such.

The flow for adding a new backend operation:
1. Add a `#[tauri::command]` fn (and any `Serialize`/`Deserialize` structs) in `src-tauri/src/<module>.rs`, register it in the `invoke_handler![...]` list in `lib.rs`.
2. Regenerate bindings (`cargo tauri-typegen generate`, or just build).
3. Wrap the generated command in `client/src/api/<domain>.ts` — this is the hand-written boundary layer that re-exports/narrows generated types and adapts call signatures (e.g. `fetchPost(id)` instead of `fetchPostCommand({ id })`).
4. Consume the api module from `client/src/queries/<domain>.ts`.

### Data layer: TanStack Query conventions

Each domain has a `queries/<domain>.ts` module built on:
- A `queryOptions()`-based options factory (e.g. `postsQueryOptions`, `postQueryOptions`) so route loaders and components share one definition.
- A hierarchical query-key factory (`{domain}Keys.all/lists/list/details/detail`) so list vs. detail caches can be invalidated independently.
- Mutation hooks (`useCreateX`/`useUpdateX`/`useDeleteX`) that do optimistic updates via `onMutate`/`onError`/`onSettled`, snapshotting previous cache state for rollback on error.

### Routing

TanStack Router with file-based routes under `client/src/routes/`, code-generated into `routeTree.gen.ts` (do not hand-edit). Route loaders call `queryClient.ensureQueryData(...)` using the shared query-options factories so navigation and preloading populate the Query cache before render; components then read via `useSuspenseQuery`. Search-param state (filters, pagination) is validated with `zod` schemas in `validateSearch` and kept in the URL rather than component state. The router is configured in `client/src/router.tsx` (`defaultPreload: "intent"`, shared pending/error components).

### UI components

shadcn/ui components (base-ui style, "mist" base color) live in `client/src/components/ui/`, configured via `client/components.json`. Follow shadcn conventions when adding new primitives (`bunx shadcn add <component>`). General principle: build the frontend from small reusable components rather than large page-specific ones.

### Tauri backend structure

`src-tauri/src/lib.rs` wires plugins and the `invoke_handler![...]` command registry — this is the map of everything callable from the frontend. Domain logic is split into modules (e.g. `dbc.rs`) each exposing `#[tauri::command]` functions and any managed state structs.

## DBC feature

The only implemented domain feature: pick a `.dbc` file from disk and parse it into a typed message/signal tree, entirely client-side (no persisted state, no backend store).

**Backend (`src-tauri/src/dbc.rs`)**
- Wraps the `can-dbc` crate. `parse_dbc_file(path: String) -> Result<DbcFile, String>` reads the file, parses it with `Dbc::try_from`, and converts it via `From<Dbc> for DbcFile` into serde-serializable types — `DbcFile { version, nodes, messages }`, `DbcMessage { id, extended, name, size, transmitter, signals }`, `DbcSignal { name, start_bit, size, little_endian, signed, factor, offset, min, max, unit, receivers, multiplexer }`, and the `DbcMultiplexer` enum (`Plain` / `Multiplexor` / `MultiplexedSignal { switch_value }` / `MultiplexorAndMultiplexedSignal { switch_value }`, serialized with a `kind` tag). Errors (bad path, parse failure) are mapped to `String` and surface as a rejected promise on the frontend.
- Registered as the sole command in `invoke_handler![...]` in `lib.rs`.

**Frontend, following the standard layering (see "End-to-end type safety" and "Data layer" above):**
- `src/generated/{types,commands}.ts` — auto-generated Zod schemas/types (`DbcFile`, `DbcMessage`, `DbcSignal`, `DbcMultiplexer`) and the `parseDbcFile` invoke wrapper. Do not hand-edit.
- `src/api/dbc.ts` — hand-written boundary: re-exports the `DbcFile` type and narrows `parseDbcFileCommand({ path })` to `parseDbcFile(path: string)`.
- `src/queries/dbc.ts` — `useParseDbcFile()`, a plain `useMutation` wrapping `parseDbcFile` (no query-key factory needed; this is a one-shot file-picker action, not cached list/detail data like the old posts domain).
- `src/routes/index.tsx` — the only route. Uses `@tauri-apps/plugin-dialog`'s `open()` to let the user pick a `.dbc` file, then calls `parseDbcFile.mutate(path)`. Renders the shadcn `Button` (pending state while parsing), a destructive `Alert`/`AlertTitle`/`AlertDescription` on error, and `DbcSummary` on success.
- `src/components/dbc-summary.tsx` — reusable presentational component; takes a parsed `DbcFile` and renders it in a shadcn `Card` (version in `CardTitle`, node/message counts in `CardContent`). Kept separate from the route so it can be reused wherever a `DbcFile` needs to be displayed (e.g. a future message/signal browser).

To extend this (e.g. list signals per message, decode live frames), keep the same shape: extend `DbcFile`/related structs in `dbc.rs`, regenerate bindings, then add focused presentational components under `src/components/` (following the shadcn-primitives-first, reusable-components guidance above) rather than growing `index.tsx` or `DbcSummary` directly.
