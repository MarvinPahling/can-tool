# can-tool

![vibe status](https://img.shields.io/badge/vibe-coded-ff69b4?style=flat-square) ![design doc](https://img.shields.io/badge/design%20doc-nonexistent-critical?style=flat-square) ![test coverage](https://img.shields.io/badge/tests-technically%20present-yellowgreen?style=flat-square) ![build](https://img.shields.io/badge/build-works%20on%20my%20machine-lightgrey?style=flat-square) ![package managers](https://img.shields.io/badge/package%20managers-two%2C%20unapologetically-blueviolet?style=flat-square) ![stability](https://img.shields.io/badge/stability-expected%20to%20grow-orange?style=flat-square) ![license](https://img.shields.io/badge/license-vibes-informational?style=flat-square) ![latest release](https://img.shields.io/github/v/release/MarvinPahling/can-tool?style=flat-square&label=latest%20release)

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
git clone https://github.com/MarvinPahling/can-tool.git
cd can-tool
bun install
```

That's it. That's the install. If it doesn't work, it's almost certainly a Tauri/Rust toolchain problem, not a `bun` problem — check the prerequisites link above before opening an issue about it.

## Running it

```bash
just dev       # full Tauri app window, hot-reloaded (Rust backend + Vite frontend)
just build     # production build, packaged as a desktop app
just clean     # nuke build artifacts when something feels cursed
just lint      # check formatting and lint rules with Biome
just lint-fix  # same, but fixes what it safely can
```

No `just`? Use `bun run tauri dev` / `bun run tauri build` / `bunx biome check .` instead.

There's also `bun run dev` for the frontend alone (Vite only, no Tauri window, no Rust backend) — useful for UI work when you don't feel like waiting on a Rust compile.

## Testing

There is now! Turns out even a vibe-coded app eventually accumulates enough surface area that "seemed fine when I looked at it" stops being a testing strategy. Frontend unit tests run on Vitest + React Testing Library, backend unit tests run on `cargo test`/`cargo nextest`, and both flavors will happily generate junit XML and HTML reports so you can admire your coverage in a browser tab instead of just believing it exists.

```bash
just test         # frontend (vitest) + backend (cargo test)
just test-report  # both, plus junit/HTML reports under test-results/
```

No `just`? `bun run test` and `cargo test --manifest-path src-tauri/Cargo.toml` work fine on their own. There is also a linter — [Biome](https://biomejs.dev), configured in `biome.json` — so run `just lint` (and `tsc` / `cargo check` for type errors) before you commit something embarrassing. The tests won't catch everything the vibes missed, but they'll catch some of it, which is technically an improvement.

## Linting & pre-commit hooks

Because vibing is not the same as having no standards, there's now a [Lefthook](https://github.com/evilmartians/lefthook) pre-commit hook (`lefthook.yml`) that runs Biome on staged frontend files and `cargo fmt` / `cargo clippy --fix` on staged Rust files, and auto-applies whatever it can before letting you commit. It's installed automatically via the `prepare` script when you `bun install`, so you get code quality whether you wanted it or not.

Clippy runs with `-D warnings`, meaning it will actually block your commit over things it can't auto-fix — a wild concept for a codebase whose entire architecture was decided by vibes. If you get stopped, that's the hook working as intended, not a bug to `--no-verify` your way around.

## Contributing

Read `AGENTS.md` first — it's the closest thing this repo has to documentation, and it's more thorough than most human-written READMEs anyway.
