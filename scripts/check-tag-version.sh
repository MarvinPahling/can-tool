#!/usr/bin/env bash
# Pre-push hook: if any pushed ref is a tag, verify the app version files
# already match it so we never publish a release build with a stale version.
set -euo pipefail

while read -r local_ref local_sha remote_ref remote_sha; do
	if [[ "$local_ref" == refs/tags/* ]]; then
		tag="${local_ref#refs/tags/}"
		node scripts/sync-version.mjs "$tag" --check
	fi
done
