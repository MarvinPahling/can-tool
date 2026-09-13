#!/usr/bin/env bash
# Samples a running can-tool's resident memory into a CSV.
#
# The frontend readout (`can-tool:perf` -> {"hud":true}) covers what the
# webview holds; this covers what the *process* holds, which is where the Rust
# side and the IPC queue show up. Run it alongside a replay:
#
#   scripts/sample-rss.sh > runs/release-5x.csv
#
# Columns: seconds since start, RSS in MB, CPU percent.
set -euo pipefail

process="${1:-can-tool}"
interval="${2:-2}"

pid="$(pgrep -x "$process" | head -1 || true)"
if [ -z "$pid" ]; then
	echo "No process named '$process' is running." >&2
	echo "Pass the name as the first argument if the binary is called something else." >&2
	exit 1
fi

echo "sampling pid $pid every ${interval}s; ctrl-c to stop" >&2
echo "seconds,rss_mb,cpu_percent"

start="$(date +%s)"
while kill -0 "$pid" 2>/dev/null; do
	# `ps` reports RSS in kilobytes on both macOS and Linux.
	read -r rss cpu <<<"$(ps -o rss=,pcpu= -p "$pid" | tr -s ' ')"
	printf '%s,%.1f,%s\n' "$(($(date +%s) - start))" "$(echo "$rss / 1024" | bc -l)" "$cpu"
	sleep "$interval"
done

echo "process $pid exited" >&2
