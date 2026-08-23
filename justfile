default: dev

dev:
    bun run tauri dev

build:
    bun run tauri build

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

