# can-tool

A desktop app for poking at CAN FD buses, brought to you by the ancient and time-honored engineering practice of vibe coding. No, that's not a disclaimer buried in the fine print — it's the whole methodology. There is no design doc. There was never a design doc. There is an `AGENTS.md` that an AI wrote to explain the codebase to other AIs, which should tell you everything you need to know.

It mostly works. Load a `.dbc` file, browse messages and signals, stare at a very satisfying grid of colored bits. More CAN FD functionality (actual bus connections, live frame streaming, signal decoding) is "expected to grow" here, in the sense that someone will eventually vibe it into existence.

## Stack

- **Frontend**: React + TanStack Router/Query/Table + Tailwind + shadcn/ui, because reinventing a date picker is not a personality trait.
- **Backend**: Rust via Tauri 2, so the app can pretend to be a native binary while still being a website in a trenchcoat.
- **DBC parsing**: the `can-dbc` crate, doing the one (1) real thing this app currently does.
- **Package managers**: `bun` for JS, `cargo` for Rust. Yes, two. No, we're not sorry.

## Prerequisites

- [Bun](https://bun.sh)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain, via `rustup`)
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS — Xcode command line tools on macOS, `webkit2gtk` and friends on Linux, the usual Visual Studio build tools on Windows.
- [`just`](https://github.com/casey/just) (optional but recommended — it's a command runner, not a personality quirk)

## Installation

```bash
git clone <this-repo>
cd can-tool/client
bun install
```

That's it. That's the install. If it doesn't work, it's almost certainly a Tauri/Rust toolchain problem, not a `bun` problem — check the prerequisites link above before opening an issue about it.

## Running it

All commands run from `client/`:

```bash
just dev      # full Tauri app window, hot-reloaded (Rust backend + Vite frontend)
just build    # production build, packaged as a desktop app
just clean    # nuke build artifacts when something feels cursed
```

No `just`? Use `bun run tauri dev` / `bun run tauri build` instead.

There's also `bun run dev` for the frontend alone (Vite only, no Tauri window, no Rust backend) — useful for UI work when you don't feel like waiting on a Rust compile.

## Testing

There isn't any. There is no test runner configured. There is no linter configured. We are, as previously established, vibing. Type errors from `tsc` and `cargo check` are the closest thing to a safety net you're going to get, so at least run those before you commit something embarrassing.

## Contributing

Read `AGENTS.md` first — it's the closest thing this repo has to documentation, and it's more thorough than most human-written READMEs anyway.
