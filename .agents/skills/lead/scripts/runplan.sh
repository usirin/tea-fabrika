#!/bin/sh
# runplan.sh <name> <brief-file>: run a read-only plan writer in the main checkout.
# The plan is Codex's last message, saved as $BOXES/<name>-plan.md; its events go to <name>-plan.jsonl.
# Run it in the background: a plan takes 10 to 30 minutes.
set -eu
. "$(dirname "$0")/env.sh"
name=$1; brief=$2
mkdir -p "$BOXES"
cd "$MAIN"
exec nice -n 15 codex exec --ignore-user-config -m "$CODEX_MODEL" -c model_reasoning_effort="$CODEX_EFFORT" \
	-s read-only -C . --json -o "$BOXES/$name-plan.md" - < "$brief" > "$BOXES/$name-plan.jsonl" 2>&1
