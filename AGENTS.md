# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Tauri desktop app for interacting with a CAN FD bus.

Frontend: React + TanStack Router + TanStack Query + Tailwind + shadcn/ui (base-ui style). Backend: Rust via Tauri 2. Package managers: bun (JS) and cargo (Rust). Task runner: `justfile`.

The starter scaffold's CRUD demo (posts) has been removed. Three domain features exist so far: opening and parsing a DBC file (`src-tauri/src/dbc.rs`, driven by the `can-dbc` crate) and browsing it, connecting to a CAN adapter to receive and decode frames, and cycling composed messages back onto the bus — see "DBC feature", "Live traffic feature" and "Simulation feature" below. Expect this to grow into fuller CAN FD functionality as the project develops.

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

TanStack Router with file-based routes under `src/routes/`, code-generated into `routeTree.gen.ts` (do not hand-edit). Three routes today: `/` (DBC browser), `/visualize` (live traffic) and `/simulate` (periodic transmit). Navigation lives in `src/components/titlebar.tsx` as `<Link>`s, mirrored by the `view.dbc`/`view.visualize`/`view.simulate` commands (Mod+1/2/3) and a native View menu. Route loaders call `queryClient.ensureQueryData(...)` using the shared query-options factories so navigation and preloading populate the Query cache before render; components then read via `useSuspenseQuery`. Search-param state (filters, pagination) is validated with `zod` schemas in `validateSearch` and kept in the URL rather than component state. The router is configured in `src/router.tsx` (`defaultPreload: "intent"`, shared pending/error components).

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

`src-tauri/src/lib.rs` wires plugins, the native menu (macOS app/File/Edit menus, built with `tauri::menu`, forwarding clicks to the frontend as a `menu-command` event whose payload is a command id from `src/commands/definitions.ts`), and the `invoke_handler![...]` command registry — this is the map of everything callable from the frontend. Domain logic is split into modules (`dbc.rs`, `can.rs`, `simulation.rs`) each exposing `#[tauri::command]` functions and any managed state structs; the registry holds 13 commands, and both `CanState` and `SimulationState` are `manage`d.

## DBC feature

The only implemented domain feature: pick a `.dbc` file from disk, parse it into a typed message/signal tree, and browse it (sortable/filterable message+signal table, per-message bit layout) — entirely client-side (no persisted state, no backend store).

**Backend (`src-tauri/src/dbc.rs`)**
- Wraps the `can-dbc` crate. `parse_dbc_file(path: String) -> Result<DbcFile, String>` reads the file, parses it with `Dbc::try_from`, and converts it via `From<Dbc> for DbcFile` into serde-serializable types — `DbcFile { version, nodes, messages }`, `DbcMessage { id, extended, name, size, transmitter, signals }`, `DbcSignal { name, start_bit, size, little_endian, signed, factor, offset, min, max, unit, receivers, multiplexer }`, and the `DbcMultiplexer` enum (`Plain` / `Multiplexor` / `MultiplexedSignal { switch_value }` / `MultiplexorAndMultiplexedSignal { switch_value }`, serialized with a `kind` tag). Errors (bad path, parse failure) are mapped to `String` and surface as a rejected promise on the frontend.
- Registered as the sole command in `invoke_handler![...]` in `lib.rs`.

**Frontend, following the standard layering (see "End-to-end type safety" and "Data layer" above):**
- `src/generated/{types,commands}.ts` — auto-generated Zod schemas/types (`DbcFile`, `DbcMessage`, `DbcSignal`, `DbcMultiplexer`) and the `parseDbcFile` invoke wrapper. Do not hand-edit.
- `src/api/dbc.ts` — hand-written boundary: re-exports the `DbcFile`/`DbcMessage`/`DbcSignal` types and narrows `parseDbcFileCommand({ path })` to `parseDbcFile(path: string)`.
- `src/queries/dbc.ts` — `useParseDbcFile()`, a `useMutation` wrapping `parseDbcFile` whose `onSuccess` writes the result into the shared cache under `currentDbcKey` (`["dbc", "current"]`), and `useCurrentDbc()`, the `skipToken` query every consumer reads it back through. The mutation is a one-shot file-picker action, so its own state is only good for pending/error — anything that renders the file must read `useCurrentDbc()`, or it will lose the file when its route unmounts on navigation. `createQueryClient()` (`src/lib/query-client.ts`) pins that entry with `gcTime: Infinity`, since nothing can re-fetch it.
- `src/routes/index.tsx` — the DBC browser route (`/`). Uses `@tauri-apps/plugin-dialog`'s `open()` to let the user pick a `.dbc` file (also wired to the `file.open` command, see "Commands & keyboard shortcuts"), then calls `parseDbcFile.mutate(path)`. Renders the shadcn `Button` (pending state while parsing) and a destructive `Alert`/`AlertTitle`/`AlertDescription` on error from the mutation, but renders `DbcSummary`, `DbcTable`, and `SignalBitGrid` from `useCurrentDbc()` so the file survives navigating to `/visualize` and back. The message/signal filter text is kept in the `q` URL search param (validated with `zod` in `validateSearch`), and hovering a signal (in either the table or the bit grid) highlights it in the other.
- `src/components/dbc-summary.tsx` — reusable presentational component; takes a parsed `DbcFile` and renders it in a shadcn `Card` (version in `CardTitle`, node/message counts in `CardContent`).
- `src/components/dbc-table.tsx` — expandable message → signal table built on `@tanstack/react-table`'s `useTable`; row shapes (`MessageRow`/`SignalRow`) and expansion come from `src/lib/dbc-table/rows.ts`, columns from `src/lib/dbc-table/columns.tsx`, and enabled table features from `src/lib/dbc-table/features.ts`. Global filter is controlled by the route (URL-backed), not owned by the table.
- `src/components/signal-bit-grid.tsx` — renders one message's bytes as a grid of per-bit boxes, colored by owning signal (`src/lib/signal-colors.ts`) with a legend below; bit ownership comes from `src/lib/signal-bits.ts`'s `buildSignalBitMap`, which implements DBC's big-/little-endian bit-numbering to map each signal to its occupied bit indices.

To extend this, keep the same shape: extend `DbcFile`/related structs in `dbc.rs`, regenerate bindings, then add focused presentational components under `src/components/` (following the shadcn-primitives-first, reusable-components guidance above) rather than growing `index.tsx` directly.

## Live traffic feature

The `/visualize` route decodes incoming frames against the loaded DBC and shows one card per CAN id, with changed values flashing in a configurable highlight that fades back.

**Receive path (`src-tauri/src/can.rs`)**
- `parse_slcan_frame(line) -> Option<CanFrame>` parses `t`/`T` classic data frames, `r`/`R` remote frames, and `d`/`D` (CAN FD) and `b`/`B` (CAN FD with bit-rate switch), rejecting adapter chatter (bare `\r`, the BEL rejection byte, version replies, bad hex, DLC/payload mismatch, over-wide ids). **An FD frame's length field is a DLC nibble indexing `CAN_FD_DLC`, not a byte count** — reading it as one is why the classic-only parser silently dropped every frame on an FD bus. `format_slcan_frame` is its transmit counterpart, shared with `write_frame`; it pads an FD payload up to the next expressible length (`fd_dlc_for`), because CAN FD has no arbitrary sizes above eight bytes.
- `connect_can_device` spawns a reader thread over `port.try_clone()`, so the reader never contends with the writer for the `CanState` mutex. `drain_lines` splits complete lines out of the read buffer (keeping a trailing partial for the next read) and `should_flush` gates batching; frames go to the frontend as a `can-frames` event roughly every 30 ms or every 256 frames.
- Teardown sets an `AtomicBool` and joins the thread; reconnecting stops the previous reader first.
- CAN FD timing: a channel is configured by `configure_channel` as `C` → `S<n>` → `Y<n>` → `O`/`L`, the same sequence `python-can`'s `slcanBus.set_bitrate` writes. **`Y<n>` (`data_bitrate_code`, digit = Mbit/s: `Y2`/`Y5`/`Y8`) is what puts the adapter in FD mode**; without it the CANable stays classic and an FD bus produces nothing but rejections. `python-can` knows only `Y2` and `Y5`, so `Y8` is the same encoding extended and unverified against the firmware — an adapter that rejects it answers with BEL and leaves the channel shut. `bitrate_code` follows the CANable firmware's table rather than the LAWICEL one, so `S7` is 750 kbit/s and `S9` is 83.3 kbit/s. `POST_OPEN_SETTLE` waits two seconds after opening the serial port before writing anything, because opening the CDC-ACM device re-enumerates it and swallows whatever is written meanwhile — `python-can` waits the same `_SLEEP_AFTER_SERIAL_OPEN`. `tx_format` derives `fd`/`bitrate_switch` from the channel, not the payload length: on an FD bus even the eight-byte frames are FD+BRS.
- Auto-detect (`autodetect_bitrate`): sweeps `PROBE_CANDIDATES` — `TimingCandidate`s ordered by how common each is, FD before classic — reconfiguring **one** open handle per candidate via `probe_candidate` (reopening per candidate would pay `POST_OPEN_SETTLE` eight times over) and counting frames with the same `drain_lines` the reader uses. Every candidate is tried, then `best_candidate` ranks them with the reference tool's weights (`SCORE_FD`/`SCORE_BRS` above `SCORE_FRAME`, rejections negative): a classic candidate listening to an FD bus half-decodes its arbitration phase into a trickle of frames, so a first-hit sweep would settle on the wrong timing. Ties go to the earlier candidate, which is what makes the FD-first ordering mean anything. `probe_hit` (>= `PROBE_MIN_FRAMES`) is the floor a winner must clear; one frame can be garbage decoded at the wrong rate, two rarely are. Progress goes out as `can-probe` events (`ProbeProgress`), which is what the dialog's transient status line renders. The command is `async` and hands the work to `tauri::async_runtime::spawn_blocking`: **sync Tauri commands run on the main thread**, so running the sweep there froze the webview. For the same reason `run_bitrate_sweep` takes the `connection` mutex only twice — to hand the port over and to install the result — never across the sweep, since `can_connection_status` is polled every second from the main thread and would block on it. Overlapping sweeps and connects are kept apart by `CanState::probing` instead, claimed through `ProbeGuard` so an early return cannot leave the flag stuck. `open_connection` is shared by `connect_can_device` and the sweep's reconnect so the two cannot drift apart.
- Read-only (slcan listen-only) mode: `open_command(read_only)` picks `L` over the usual `O`, so the adapter receives but never transmits or ACKs. It is opt-in and off by default — a fair number of adapters stop delivering frames entirely under `L`, and the CANable 2.0 firmware stops delivering the full CAN FD traffic (the reference tool's CLI defaults it off for exactly that reason). `CanConnectionStatus.read_only` carries it to the frontend, and `ensure_writable` guards both `send_can_frame` and `send_can_message`. The toggle lives in the connect dialog, persisted via `src/lib/connect-settings.ts` (`can-tool:connect-settings`); `start_simulation` refuses while it is on, and the simulation card disables its one-shot send.
- **`write_frame` does not read the transmit ack.** That read raced the reader thread for the same bytes. The reader recognizes the BEL rejection and emits `can-error` instead, so sends no longer report adapter rejection synchronously.
- Event payload types are hand-declared in `src/api/can.ts` and must be kept in sync with `can.rs`. `CanFrame` because tauri-typegen derives from command signatures and never sees it; `ProbeProgress` for a subtler reason — typegen *does* emit it (it recognizes the named struct at the `app.emit` call site, into `src/generated/types.ts` plus an `onCanProbe` helper in a generated `events.ts`), but it models Rust's `Option<u32>` as an optional field (`number | undefined`) while serde serializes `None` as `null`. Events come straight off `listen` and never run through the generated Zod schema, so the generated type would be wrong at every use site.
- `src/generated/index.ts` and `src/generated/events.ts` are excluded in `tsconfig.json`: nothing imports them (the api layer pulls `commands`/`types` directly, and the query hooks call `listen` themselves), and `events.ts` ships an unused type import that trips `noUnusedLocals` in a file that must not be hand-edited.

**Frontend**
- `src/queries/can.ts` — `useCanFrames(onFrames)` wraps the event, holding the callback in a ref so a re-rendering consumer does not re-subscribe.
- `src/lib/decode-message.ts` — `decodeSignal`/`decodeMessage`, the inverse of `encode_can_message`, reusing `getSignalBitIndices`. Uses arithmetic rather than bitwise operators (which coerce to 32 bits), gates multiplexed signals on the multiplexor's *raw* value, and omits signals that overrun the frame. Only single-level multiplexing is resolved.
- `src/lib/signal-change.ts` — `hasSignificantChange`, the highlight gate. The threshold is a percentage of the signal's full physical range (via `getSignalRange`), not of the previous value, which is undefined when that value is 0.
- `src/lib/live-messages.ts` — `applyFrames`, the pure reducer. Unchanged signals keep their `changedAt` so a fading highlight is not restarted, and signals absent from the current frame are retained so multiplexed cards do not flicker.
- `src/lib/visualize-settings.ts` + `src/hooks/use-visualize-settings.ts` — highlight color, fade duration and threshold, persisted to `localStorage` (`can-tool:visualize-settings`). Nothing read back from storage is trusted: wrong types are ignored and numbers clamped.
- `src/lib/connect-settings.ts` + `src/hooks/use-connect-settings.ts` — the same store pattern for device connection settings (`can-tool:connect-settings`): `readOnly` and `dataBitrate`. Both are properties of the bus rather than of the session, so they are worth remembering; `dataBitrate` defaults to 2 Mbit/s and `null` means classic CAN, which is a real choice the merge has to preserve rather than treat as absent. The selected port and arbitration bitrate are deliberately still session-only.
- `src/components/live-signal-value.tsx` — one signal row. The fade runs on the Web Animations API keyed on `changedAt`, keeping it off the React render path.
- `src/components/live-message-card.tsx`, `visualize-settings-popover.tsx`, `live-traffic.tsx` — the card, the settings popover, and the view that folds frames into a ref and flushes to React at ~20 Hz. Note Base UI's `Slider` needs array values; a scalar makes it render two thumbs.
- `src/routes/visualize.tsx` — thin route keeping the filter in the `q` search param.

## Simulation feature

The `/simulate` route composes messages from the loaded DBC and cycles them onto the bus, each at its own period, all driven by one Start/Stop. It replaced a modal Send dialog that could only transmit one frame per click; the dialog and its `["send","pendingMessage"]` query-cache handshake are gone.

**Scheduler (`src-tauri/src/simulation.rs`)**
- Modelled on the reference restbus simulator in `ignore/canable/src/canable/simulation.py`. **One thread for every message**, not one per message: N threads would interleave slcan commands on a single serial port.
- Deadlines accumulate **absolutely** (`advance_deadline`: `next_send + cycle`, never `now + cycle`), so the cost of encoding and writing does not compound a 20 ms message out to 22. The exception is a deadline already in the past — after the machine slept, or a write blocked — which resnaps to `now + cycle` rather than emitting one backdated frame per missed cycle in a burst.
- The loop sleeps to `min(next_send)` (`next_deadline`) capped at `MAX_SLEEP` (50 ms), so a stop is never held up by a once-a-second message. A fixed tick was rejected: it would add its own granularity on top of the cycle jitter.
- `wait_until` is a **three-phase ladder** — park for the bulk of it, `sleep` in 500 µs slices, then busy-wait the last millisecond. A single timed wait on a background thread is coalesced; measured here it overshot each 20 ms deadline by 1.879 ms on average (p95 2.833 ms) against 0.110 ms (p95 0.778 ms) for the ladder. `POLL_INTERVAL < SPIN_MARGIN < COARSE_MARGIN` is what makes the phases a ladder rather than three arbitrary numbers, and a test pins it. The coarse phase *parks* rather than sleeps so `stop_running`'s `unpark` cuts it short.
- **The thread owns a `try_clone()`d port handle and never touches the `CanState` mutex again.** `can::clone_write_handle` checks writability, captures `tx_format` and clones the port under one brief lock at start; after that the loop only writes. This is the hazard at `can.rs:143-146`/`:484-490` avoided by construction — `can_connection_status` is polled from the main thread every second, and a `write_all` that can block for `SERIAL_TIMEOUT` must never sit inside that lock. `open_connection` already gives the reader its own handle for the same reason.
- **Three writers now share one fd** (reader clone, main port, simulation clone). Safe only because every slcan command goes out in a single `write_all` — do not add a path that writes one in two pieces.
- Frames are **encoded once, at start**, in Rust. `validate_entries` runs every entry through `encode_can_message` and `cycle_time` *before* any state is touched, so a bad value fails the whole start atomically with nothing on the bus, and the error names the entry (`Entry 2 (ESP_21): …`). The frontend sends `DbcMessage` + values — the same shape `send_can_message` takes — rather than pre-encoded bytes, so one encoder stays authoritative and a card's hex preview cannot drift from what is sent.
- `MIN_CYCLE` is 1 ms because at 115200 baud one slcan command costs roughly 2.5 ms on the wire; anything faster only builds a write backlog. The panel warns past ~400 frames/s for the same reason.
- `disconnect_can_device`, `connect_can_device` and `autodetect_bitrate` all **stop the simulation first**, which fixes the lock order as `SimulationState` → `CanState` and never the reverse. It matters most for the sweep: `probe_candidate` rewrites the channel with `C`/`S`/`Y`/`O`, and `T` frames interleaved into that sequence would corrupt it and poison the scoring.
- A write error stores `last_error`, emits a `simulation-error` event (a bare `String`, sidestepping the `Option`→`null` typegen mismatch) and ends the run. `Running` outlives its thread so the page can still say why traffic stopped. One dead port stops everything — every message shares the thread — and a blocked `flush` stalls all of them, bounded by `SERIAL_TIMEOUT`.
- Use `saturating_duration_since` throughout: `Instant - Instant` panics on a negative delta, and a deadline that has just passed is the normal case at the bottom of the ladder.

**Frontend**
- `src/api/simulation.ts` — hand-declares `SimulationStatus` rather than re-exporting it, because typegen models the Rust `Option<String>` as optional (`string | undefined`) while serde sends `null`, and a command's *return* is never run through the generated Zod schema. `simulationStatus()` normalizes with `?? null`.
- `src/queries/simulation.ts` — status is **polled** (it is a few slow scalars); the one thing that needs pushing, a run dying mid-flight, has `useSimulationError`. Both mutations invalidate `onSettled`, not `onSuccess`: a rejected start has still torn down whatever was running.
- `src/lib/simulation-entries.ts` + `src/hooks/use-simulation-entries.ts` — the board, in the `visualize-settings.ts` store shape (`can-tool:simulation-entries`). Sanitizing is exported as `parseSimulationEntries` rather than hidden in the loader, since a module-level store reads storage once at import and leaves a private parser untestable. It clamps `periodMs`, drops non-finite signal values, and drops duplicate ids (two cards with one React key). An entry holds `messageId` as a **string reference**, never a copy of the `DbcMessage`: the board is persisted and the DBC is not, which is what lets a card say "Not in DBC" instead of lying.
- `src/lib/period.ts` — milliseconds are canonical everywhere; the unit is display only. Only *whole* seconds render as seconds, so 1500 ms stays `1500 ms` rather than becoming a `1.5 s` that steps by a whole second when nudged.
- `src/components/signal-value-grid.tsx`, `checksum-field.tsx`, `src/hooks/use-encoded-preview.ts` — extracted from the old send dialog. The grid is controlled and **free of any form library**, which is what lets a store-backed card and a form-backed dialog share it. `useEncodedPreview` gates responses on a request sequence: encoding is async, and a slow response can land after a newer one.
- `ChecksumField`'s auto mode recomputes on every other value's change. Its change key **excludes the checksum signal itself** — that omission is what makes it terminate, since writing the result back changes `values`. It is also correct: `generate_checksum` zeroes that signal before computing. Biome flags the key as an unnecessary dependency; it is not read in the body, it *is* the change signal, hence the `biome-ignore`.
- `src/components/period-input.tsx` — the unit is local state, not derived from the value, or it would flip under the cursor while typing the fourth digit of `1000`. A draft string holds half-typed input so the field can be cleared. Changing the unit **converts** (20 ms → 0.02 s); reinterpreting would silently slow a message by 1000×.
- `src/components/simulation-message-card.tsx` — laid out like `LiveMessageCard` on purpose. Picking a message reseeds its values via `defaultSignalValues` rather than clearing them, so a fresh card encodes instead of showing "Required" everywhere.
- `src/components/simulation-panel.tsx` — `buildPayload`/`frameRate` are exported so the "what actually reaches the bus" rule is testable. **Editing while running is a debounced stop-and-restart**, not a mutation, so the scheduler thread never takes a lock in its hot loop; the accepted cost is that a restart resnaps every message's phase. A `startedKey` ref holds the schedule Rust is currently running, without which pressing Start immediately queues a redundant restart. The guard alerts do not block the board — unlike `/visualize`, frames can still be composed and checked offline.
- `src/hooks/use-add-to-simulation.ts` — Mod-clicking a row in the DBC table or the bit grid adds the message and navigates. It reuses an existing entry for the same message rather than stacking duplicates.
