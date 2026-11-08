#!/bin/sh
# catchup.sh <pr> <ticket>
# Bring a pull request up to date with main, sign the new merge as the lead, push, wait for every
# check on that exact head, then squash-merge it pinned to that head. Run it in the background.
#   - each pull request gets its own checkout (BOXES/catchup-<pr>), and one lock is held while it
#     fetches, merges, signs and pushes, so two catch-ups never share a tree or the notes ref
#   - merges origin/main in as fabrikalfa[bot] (the person as co-author) when the head lacks it,
#     and signs only that new merge commit as lead. It never signs a step's commit: an unsigned
#     step commit fails the commits check, and goes back to its own step to sign
#   - pushes notes and branch together, so the push itself starts CI; a branch the bot may not
#     push (a person's) is pushed with the person's gh login, notes by the bot
#   - no auto-merge: it waits for check, e2e, next, commits and the tests on the pushed sha, then
#     merges with --match-head-commit, so a newer head or a red check stops it (hand PRs only)
set -eu
. "$(dirname "$0")/env.sh"
pr=$1; ticket=$2
W=$BOXES/catchup-$pr; LOCK=$BOXES/catchup.lock; LEAD=$lead_here
AS='-c user.name=fabrikalfa[bot] -c user.email=353269643+fabrikalfa[bot]@users.noreply.github.com'
mkdir -p "$BOXES"
until mkdir "$LOCK" 2>/dev/null; do sleep 5; done
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM
head=$(gh pr view "$pr" -R "$GH_REPO" --json headRefName -q .headRefName)
[ -d "$W" ] || git -C "$MAIN" worktree add -q --detach "$W" origin/main
cd "$W"
git fetch -q origin main "refs/notes/fabrika:refs/notes/fabrika" 2>/dev/null || git fetch -q origin main
git fetch -q origin "pull/$pr/head"
git checkout -q --detach FETCH_HEAD
[ -d node_modules ] || nice -n 15 pnpm install --silent >/dev/null 2>&1
tip=$(git rev-parse HEAD)
if ! git merge-base --is-ancestor origin/main HEAD; then
	git $AS merge -q --no-edit origin/main -m "Merge main into $head" -m "Co-authored-by: $FABRIKA_COAUTHOR"
	tip=$(git rev-parse HEAD)
	nice -n 15 pnpm -s commits sign --step lead --ticket "$ticket" --key ~/.fabrika/step-keys/lead >/dev/null
	case $head in
	fabrikalfa/*) node "$LEAD/botpush.mjs" . "$head" "$tip" ;;
	*) node "$LEAD/botpush.mjs" . - ; git push -q origin "$tip:refs/heads/$head" ;;
	esac
fi
rmdir "$LOCK"; trap - EXIT INT TERM
# Wait for every check on this exact sha, up to an hour. A skipped job (no code changed) is done.
need="check e2e next commits"
missing=$need; pending=1
for _ in $(seq 120); do
	runs=$(gh api "repos/$GH_REPO/commits/$tip/check-runs?per_page=100" \
		-q '.check_runs[]|"\(.name)\t\(.status)\t\(.conclusion)"')
	bad=$(printf '%s\n' "$runs" | awk -F'\t' '$2=="completed" && $3!="success" && $3!="skipped" && $3!="neutral" {print $1": "$3}')
	[ -z "$bad" ] || { echo "pr $pr: red at $tip: $bad" >&2; exit 1; }
	missing=""
	for n in $need; do printf '%s\n' "$runs" | grep -q "^$n	" || missing="$missing $n"; done
	pending=$(printf '%s\n' "$runs" | awk -F'\t' 'NF && $2!="completed"' | wc -l | tr -d ' ')
	[ -z "$missing" ] && [ "$pending" = 0 ] && break
	sleep 30
done
if [ -n "$missing" ] || [ "$pending" != 0 ]; then
	echo "pr $pr: checks not done at $tip after an hour (missing:${missing:- none}, pending: $pending)" >&2
	exit 1
fi
gh pr merge "$pr" -R "$GH_REPO" --squash --match-head-commit "$tip" >/dev/null
echo "pr $pr: merged at $(git rev-parse --short "$tip"), signed for ticket $ticket"
