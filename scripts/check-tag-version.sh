#!/usr/bin/env bash
# Pre-push hook: if any pushed ref is a tag, verify the app version files
# already match it so we never publish a release build with a stale version.
set -euo pipefail

# No ref info piped in (e.g. `lefthook run pre-push` invoked manually, or a
# GUI git client that doesn't feed the hook's stdin): nothing to check.
if [ -t 0 ]; then
	exit 0
fi

while read -r -t 5 local_ref local_sha remote_ref remote_sha; do
	if [[ "$local_ref" == refs/tags/* ]]; then
		tag="${local_ref#refs/tags/}"
		node scripts/sync-version.mjs "$tag" --check
	fi
done
