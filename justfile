default: dev

dev:
    bun run tauri dev

build:
    bun run tauri build

# Windows-only: stage the WebView2 fixed version runtime, then build an
# enterprise-ready NSIS installer that needs no admin rights and no internet
# access on the target machine.
build-windows-enterprise:
    pwsh -File ./scripts/fetch-webview2-runtime.ps1
    bun run tauri build --bundles nsis

# A release build that can be profiled. The Tauri CLI has no --profile flag,
# so the release profile is overridden through cargo's environment variables
# rather than by adding a profile to Cargo.toml that nothing could select.
# Keeps LTO and opt-level as shipped: the point is to measure the real build.
build-profiling:
    CARGO_PROFILE_RELEASE_DEBUG=true \
    CARGO_PROFILE_RELEASE_STRIP=false \
    bun run tauri build

# `just dev` without the devtools plugin, which buffers every event in memory
# and sits in front of every `can-frames` emit. The first variable to rule out
# in any memory measurement.
dev-no-devtools:
    CAN_TOOL_NO_DEVTOOLS=1 bun run tauri dev

clean:
    rm -rf dist node_modules/.vite
    cargo clean --manifest-path src-tauri/Cargo.toml

gen-icon:
    cd ./src-tauri/ && bunx tauri icon --output ./icons/ ./icons/net.svg

lint:
    bunx biome check .

lint-fix:
    bunx biome check --write .

test: test-frontend test-backend

test-frontend:
    bun run test

test-backend:
    cargo test --manifest-path src-tauri/Cargo.toml

# Runs both suites with junit/html report generation, collected under test-results/.
test-report: test-frontend
    mkdir -p test-results/backend
    cargo nextest run --manifest-path src-tauri/Cargo.toml
    cp src-tauri/target/nextest/default/junit.xml test-results/backend/junit.xml

