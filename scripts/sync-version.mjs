#!/usr/bin/env node
// Syncs the app version across package.json, src-tauri/tauri.conf.json, and
// src-tauri/Cargo.toml to match a git tag (e.g. "v1.2.3" -> "1.2.3").
//
// Usage: node scripts/sync-version.mjs [tag] [--check]
// If no tag is given, uses `git describe --tags --abbrev=0`.
// --check verifies the files already match the tag without writing anything,
// exiting non-zero on mismatch (used by the pre-push hook).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const check = process.argv.includes("--check");
const rawTag = process.argv.slice(2).find((arg) => arg !== "--check") ?? execSync("git describe --tags --abbrev=0").toString().trim();
const version = rawTag.replace(/^v/, "");

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
	console.error(`Refusing to use "${version}" (from tag "${rawTag}") as a version: doesn't look like semver.`);
	process.exit(1);
}

let mismatched = false;

function updateJson(relPath) {
	const filePath = path.join(root, relPath);
	const contents = readFileSync(filePath, "utf8");
	const updated = contents.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
	if (check) {
		if (updated !== contents) {
			console.error(`${relPath} does not match tag "${rawTag}" (expected version ${version})`);
			mismatched = true;
		}
		return;
	}
	if (updated === contents) {
		console.warn(`No "version" field updated in ${relPath}`);
	}
	writeFileSync(filePath, updated);
	console.log(`${relPath} -> ${version}`);
}

function updateCargoToml(relPath) {
	const filePath = path.join(root, relPath);
	const contents = readFileSync(filePath, "utf8");
	const updated = contents.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
	if (check) {
		if (updated !== contents) {
			console.error(`${relPath} does not match tag "${rawTag}" (expected version ${version})`);
			mismatched = true;
		}
		return;
	}
	if (updated === contents) {
		console.warn(`No "version" field updated in ${relPath}`);
	}
	writeFileSync(filePath, updated);
	console.log(`${relPath} -> ${version}`);
}

function updateCargoLock(relPath) {
	const filePath = path.join(root, relPath);
	const contents = readFileSync(filePath, "utf8");
	const updated = contents.replace(
		/(name = "can-tool"\nversion = ")[^"]*(")/,
		`$1${version}$2`,
	);
	if (check) {
		if (updated !== contents) {
			console.error(`${relPath} does not match tag "${rawTag}" (expected version ${version})`);
			mismatched = true;
		}
		return;
	}
	if (updated === contents) {
		console.warn(`No "can-tool" entry updated in ${relPath}`);
	}
	writeFileSync(filePath, updated);
	console.log(`${relPath} -> ${version}`);
}

updateJson("package.json");
updateJson("src-tauri/tauri.conf.json");
updateCargoToml("src-tauri/Cargo.toml");
updateCargoLock("src-tauri/Cargo.lock");

if (check && mismatched) {
	console.error(`\nRun "node scripts/sync-version.mjs ${rawTag}" and commit the result before pushing this tag.`);
	process.exit(1);
}
