# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Tauri desktop app for interacting with a CAN FD bus.

Frontend: React + TanStack Router + TanStack Query + Tailwind + shadcn/ui (base-ui style). Backend: Rust via Tauri 2. Package managers: bun (JS) and cargo (Rust). Task runner: `justfile`.

The starter scaffold's CRUD demo (posts) has been removed. Two domain features exist so far: opening and parsing a DBC file (`src-tauri/src/dbc.rs`, driven by the `can-dbc` crate) and browsing it, and connecting to a CAN adapter to send and receive frames — see "DBC feature" and "Live traffic feature" below. Expect this to grow into fuller CAN FD functionality as the project develops.

## Commands

All commands run from the repo root (the justfile assumes this cwd).

```
just dev      # bun run tauri dev — full Tauri app window (Rust backend + Vite frontend, hot-reloaded)
just build    # bun run tauri build — tsc typecheck + vite build + Rust release build, packaged as a desktop app
just clean    # removes dist/, node_modules/.vite, and cargo-cleans src-tauri
just test     # frontend (vitest) + backend (cargo test) unit tests
just test-report  # both suites with junit/html reports collected under test-results/
just lint     # bunx biome check .
```

Other useful commands (no justfile target yet):
- `bun run dev` / `bun run build` — Vite alone, frontend only (no Tauri window, no Rust backend).
- `bun run test` / `bun run test:watch` / `bun run test:coverage` — vitest directly (jsdom + React Testing Library, config in `vitest.config.ts`, setup in `src/test/setup.ts`, fixtures in `src/test/fixtures.ts`). Colocated as `*.test.ts(x)` next to the source file.
- `cargo test --manifest-path src-tauri/Cargo.toml` — Rust unit tests (colocated `#[cfg(test)] mod tests` in each module, e.g. `dbc.rs`, `can.rs`).
- `cargo nextest run --manifest-path src-tauri/Cargo.toml` — same Rust tests via nextest, which also emits a junit XML report (config in `src-tauri/.config/nextest.toml`); requires `cargo install cargo-nextest`.
- `cargo check --manifest-path src-tauri/Cargo.toml` — typecheck Rust without a full build.
- `cargo tauri-typegen generate` — regenerate `src/generated/{types,commands,index}.ts` from the Rust `#[tauri::command]` definitions. Re-run this after adding/changing a Tauri command; it also runs automatically at build time via `build.rs`.

Test reports (junit XML + HTML, gitignored) land under `test-results/` — `frontend-junit.xml`/`frontend-html/` from vitest, `backend/junit.xml` from `just test-report`'s nextest run.

## Workflow: TDD for new features

New features and bug fixes are implemented test-first, not test-after:

1. **Write a test first** for the behavior you're about to add or fix — a frontend unit test (`*.test.ts(x)` colocated next to the source file, see "Commands" above for conventions) or a Rust `#[cfg(test)] mod tests` block (colocated in the module, e.g. `dbc.rs`, `can.rs`). The test should fail (or fail to compile) at this point, since the behavior doesn't exist yet.
2. **Implement** the minimal code to make it pass.
3. **Verify by running the test through `just`** — `just test-frontend` or `just test-backend` for a quick loop on one side, `just test` for both. Don't declare the feature done until the new test (and the rest of the suite) is green.

This applies to both sides of the stack: a new `#[tauri::command]` gets its Rust-side logic covered by a backend test before/alongside the command itself; a new pure function in `src/lib/` or `src/commands/` gets a frontend test first. Purely presentational/layout changes with no testable logic are the exception — use judgment, but default to writing the test first.

## Architecture

### End-to-end type safety via tauri-typegen

Rust `#[tauri::command]` functions in `src-tauri/src/*.rs` are the single source of truth for backend API shape. `tauri-typegen` (invoked from `build.rs` at build time, or manually via `cargo tauri-typegen generate`) generates Zod-validated TypeScript bindings into `src/generated/` (`types.ts`, `commands.ts`, `index.ts`). **Never hand-edit files in `src/generated/`** — they're regenerated and marked as such.

The flow for adding a new backend operation:
1. Add a `#[tauri::command]` fn (and any `Serialize`/`Deserialize` structs) in `src-tauri/src/<module>.rs`, register it in the `invoke_handler![...]` list in `lib.rs`.
2. Regenerate bindings (`cargo tauri-typegen generate`, or just build).
3. Wrap the generated command in `src/api/<domain>.ts` — this is the hand-written boundary layer that re-exports/narrows generated types and adapts call signatures (e.g. `fetchPost(id)` instead of `fetchPostCommand({ id })`).
4. Consume the api module from `src/queries/<domain>.ts`.

### Data layer: TanStack Query conventions

Each domain has a `queries/<domain>.ts` module built on:
- A `queryOptions()`-based options factory (e.g. `postsQueryOptions`, `postQueryOptions`) so route loaders and components share one definition.
- A hierarchical query-key factory (`{domain}Keys.all/lists/list/details/detail`) so list vs. detail caches can be invalidated independently.
- Mutation hooks (`useCreateX`/`useUpdateX`/`useDeleteX`) that do optimistic updates via `onMutate`/`onError`/`onSettled`, snapshotting previous cache state for rollback on error.

### Routing

TanStack Router with file-based routes under `src/routes/`, code-generated into `routeTree.gen.ts` (do not hand-edit). Two routes today: `/` (DBC browser) and `/visualize` (live traffic). Navigation lives in `src/components/titlebar.tsx` as `<Link>`s, mirrored by the `view.dbc`/`view.visualize` commands and a native View menu. Route loaders call `queryClient.ensureQueryData(...)` using the shared query-options factories so navigation and preloading populate the Query cache before render; components then read via `useSuspenseQuery`. Search-param state (filters, pagination) is validated with `zod` schemas in `validateSearch` and kept in the URL rather than component state. The router is configured in `src/router.tsx` (`defaultPreload: "intent"`, shared pending/error components).

### UI components

shadcn/ui components (base-ui style, "mist" base color) live in `src/components/ui/` (currently: `alert`, `badge`, `button`, `card`, `dialog`, `dropdown-menu`, `input`, `label`, `popover`, `select`, `separator`, `slider`, `switch`, `table`), configured via `components.json`. Follow shadcn conventions when adding new primitives (`bunx shadcn add <component>`). General principle: build the frontend from small reusable components rather than large page-specific ones.

Custom-chrome window: the OS titlebar is disabled (see `tauri.conf.json`) and replaced by `src/components/titlebar.tsx`, which drags via `data-tauri-drag-region` and drives `@tauri-apps/api/window`'s `getCurrentWindow()` for minimize/maximize/close, plus hosts the route nav links, `ThemeToggle` and the shortcuts-dialog trigger. `src/routes/__root.tsx` renders `Titlebar` above the routed content.

### Theming

`src/lib/theme.ts` holds a framework-free `Store<Theme>` (`"light" | "dark" | "system"`) persisted to `localStorage` (`can-tool:theme`) and applied by toggling the `dark` class on `document.documentElement`; it also listens for OS `prefers-color-scheme` changes while `theme === "system"`. `src/hooks/use-theme.ts` exposes this to components as `useTheme()`. `src/components/theme-toggle.tsx` is the dropdown UI; `cycleTheme()` (bound to the `app.toggleTheme` command) cycles light → dark → system.

### Commands & keyboard shortcuts

`src/commands/` is the single system behind every keyboard shortcut, native menu item, and (future) command palette entry:
- `definitions.ts` — `COMMANDS`, the source-of-truth array of `{ id, label, description?, scope?, defaultBinding, hotkeyOptions? }`. Add a new shortcut/menu action here first.
- `types.ts` — `CommandDefinition`, `CommandBinding` (a chord like `"Mod+O"` or a Vim-style sequence like `["G", "F"]`), and `CommandScope` (`"global" | "dbc-table"`) restricting a binding to a specific input context.
- `bindings.ts` — user overrides layered over the defaults, persisted to `localStorage` (`can-tool:command-bindings`) as a `Store`; `findBindingConflicts` warns when a customized binding collides with another command in the same scope.
- `scopes.ts` — a stack of active `CommandScope`s (`useScope(scope)` pushes/pops for the lifetime of the mounted view) so e.g. `dbc-table`-scoped bindings only fire while that view is showing.
- `useCommand.ts` — `useCommandHandler(id, fn)` attaches a command's actual behavior at runtime from whichever component owns it (decoupled from the binding); `runCommand(id)` invokes it directly (used by menu events and non-hotkey triggers like button clicks).
- `CommandsProvider.tsx` — registers every command's effective binding against `@tanstack/react-hotkeys`, and listens for the Tauri `menu-command` event (emitted by `src-tauri/src/lib.rs`'s native menu, which shares command ids with `COMMANDS` so a menu click and its keyboard shortcut run the same handler) via `runCommand`. Mounted once near the app root (`src/routes/__root.tsx`).
- `display.ts` — `formatBinding()` for showing a platform-aware binding string (e.g. `⌘O` vs `Ctrl+O`) in UI.
- `src/components/shortcuts-dialog.tsx` — lists all commands and lets the user re-record a binding in place, wired to `app.showShortcuts`.

Import from the `src/commands` barrel (`index.ts`), not the individual files.

### Tauri backend structure

`src-tauri/src/lib.rs` wires plugins, the native menu (macOS app/File/Edit menus, built with `tauri::menu`, forwarding clicks to the frontend as a `menu-command` event whose payload is a command id from `src/commands/definitions.ts`), and the `invoke_handler![...]` command registry — this is the map of everything callable from the frontend. Domain logic is split into modules (e.g. `dbc.rs`) each exposing `#[tauri::command]` functions and any managed state structs.

## DBC feature

The only implemented domain feature: pick a `.dbc` file from disk, parse it into a typed message/signal tree, and browse it (sortable/filterable message+signal table, per-message bit layout) — entirely client-side (no persisted state, no backend store).

**Backend (`src-tauri/src/dbc.rs`)**
- Wraps the `can-dbc` crate. `parse_dbc_file(path: String) -> Result<DbcFile, String>` reads the file, parses it with `Dbc::try_from`, and converts it via `From<Dbc> for DbcFile` into serde-serializable types — `DbcFile { version, nodes, messages }`, `DbcMessage { id, extended, name, size, transmitter, signals }`, `DbcSignal { name, start_bit, size, little_endian, signed, factor, offset, min, max, unit, receivers, multiplexer }`, and the `DbcMultiplexer` enum (`Plain` / `Multiplexor` / `MultiplexedSignal { switch_value }` / `MultiplexorAndMultiplexedSignal { switch_value }`, serialized with a `kind` tag). Errors (bad path, parse failure) are mapped to `String` and surface as a rejected promise on the frontend.
- Registered as the sole command in `invoke_handler![...]` in `lib.rs`.

**Frontend, following the standard layering (see "End-to-end type safety" and "Data layer" above):**
- `src/generated/{types,commands}.ts` — auto-generated Zod schemas/types (`DbcFile`, `DbcMessage`, `DbcSignal`, `DbcMultiplexer`) and the `parseDbcFile` invoke wrapper. Do not hand-edit.
- `src/api/dbc.ts` — hand-written boundary: re-exports the `DbcFile`/`DbcMessage`/`DbcSignal` types and narrows `parseDbcFileCommand({ path })` to `parseDbcFile(path: string)`.
- `src/queries/dbc.ts` — `useParseDbcFile()`, a plain `useMutation` wrapping `parseDbcFile` (no query-key factory needed; this is a one-shot file-picker action, not cached list/detail data like the old posts domain).
- `src/routes/index.tsx` — the only route. Uses `@tauri-apps/plugin-dialog`'s `open()` to let the user pick a `.dbc` file (also wired to the `file.open` command, see "Commands & keyboard shortcuts"), then calls `parseDbcFile.mutate(path)`. Renders the shadcn `Button` (pending state while parsing), a destructive `Alert`/`AlertTitle`/`AlertDescription` on error, `DbcSummary`, `DbcTable`, and `SignalBitGrid` on success. The message/signal filter text is kept in the `q` URL search param (validated with `zod` in `validateSearch`), and hovering a signal (in either the table or the bit grid) highlights it in the other.
- `src/components/dbc-summary.tsx` — reusable presentational component; takes a parsed `DbcFile` and renders it in a shadcn `Card` (version in `CardTitle`, node/message counts in `CardContent`).
- `src/components/dbc-table.tsx` — expandable message → signal table built on `@tanstack/react-table`'s `useTable`; row shapes (`MessageRow`/`SignalRow`) and expansion come from `src/lib/dbc-table/rows.ts`, columns from `src/lib/dbc-table/columns.tsx`, and enabled table features from `src/lib/dbc-table/features.ts`. Global filter is controlled by the route (URL-backed), not owned by the table.
- `src/components/signal-bit-grid.tsx` — renders one message's bytes as a grid of per-bit boxes, colored by owning signal (`src/lib/signal-colors.ts`) with a legend below; bit ownership comes from `src/lib/signal-bits.ts`'s `buildSignalBitMap`, which implements DBC's big-/little-endian bit-numbering to map each signal to its occupied bit indices.

To extend this, keep the same shape: extend `DbcFile`/related structs in `dbc.rs`, regenerate bindings, then add focused presentational components under `src/components/` (following the shadcn-primitives-first, reusable-components guidance above) rather than growing `index.tsx` directly.

## Live traffic feature

The `/visualize` route decodes incoming frames against the loaded DBC and shows one card per CAN id, with changed values flashing in a configurable highlight that fades back.

**Receive path (`src-tauri/src/can.rs`)**
- `parse_slcan_frame(line) -> Option<CanFrame>` parses `t`/`T` data and `r`/`R` remote frames, rejecting adapter chatter (bare `\r`, the BEL rejection byte, version replies, bad hex, DLC/payload mismatch, over-wide ids). `format_slcan_frame` is its transmit counterpart, shared with `write_frame`.
- `connect_can_device` spawns a reader thread over `port.try_clone()`, so the reader never contends with the writer for the `CanState` mutex. `drain_lines` splits complete lines out of the read buffer (keeping a trailing partial for the next read) and `should_flush` gates batching; frames go to the frontend as a `can-frames` event roughly every 30 ms or every 256 frames.
- Teardown sets an `AtomicBool` and joins the thread; reconnecting stops the previous reader first.
- **`write_frame` does not read the transmit ack.** That read raced the reader thread for the same bytes. The reader recognizes the BEL rejection and emits `can-error` instead, so sends no longer report adapter rejection synchronously.
- `CanFrame` is event-only, so tauri-typegen (which derives from command signatures) does not emit it; it is hand-declared in `src/api/can.ts` and must be kept in sync.

**Frontend**
- `src/queries/can.ts` — `useCanFrames(onFrames)` wraps the event, holding the callback in a ref so a re-rendering consumer does not re-subscribe.
- `src/lib/decode-message.ts` — `decodeSignal`/`decodeMessage`, the inverse of `encode_can_message`, reusing `getSignalBitIndices`. Uses arithmetic rather than bitwise operators (which coerce to 32 bits), gates multiplexed signals on the multiplexor's *raw* value, and omits signals that overrun the frame. Only single-level multiplexing is resolved.
- `src/lib/signal-change.ts` — `hasSignificantChange`, the highlight gate. The threshold is a percentage of the signal's full physical range (via `getSignalRange`), not of the previous value, which is undefined when that value is 0.
- `src/lib/live-messages.ts` — `applyFrames`, the pure reducer. Unchanged signals keep their `changedAt` so a fading highlight is not restarted, and signals absent from the current frame are retained so multiplexed cards do not flicker.
- `src/lib/visualize-settings.ts` + `src/hooks/use-visualize-settings.ts` — highlight color, fade duration and threshold, persisted to `localStorage` (`can-tool:visualize-settings`). Nothing read back from storage is trusted: wrong types are ignored and numbers clamped.
- `src/components/live-signal-value.tsx` — one signal row. The fade runs on the Web Animations API keyed on `changedAt`, keeping it off the React render path.
- `src/components/live-message-card.tsx`, `visualize-settings-popover.tsx`, `live-traffic.tsx` — the card, the settings popover, and the view that folds frames into a ref and flushes to React at ~20 Hz. Note Base UI's `Slider` needs array values; a scalar makes it render two thumbs.
- `src/routes/visualize.tsx` — thin route keeping the filter in the `q` search param.
