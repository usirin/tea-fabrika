#!/bin/sh
# catchup.sh <pr> <ticket> [--merge-method squash|merge]
# Bring a pull request up to date with main, sign the new merge as the lead, push, wait for every
# check on that exact head, then merge it pinned to that head. Squash is the default.
# Run it in the background.
#   - each pull request gets its own checkout (BOXES/catchup-<pr>), and one lock is held while it
#     fetches, merges, signs and pushes, so two catch-ups never share a tree or the notes ref
#   - merges origin/main in as fabrikalfa[bot] (the person as co-author) when the head lacks it,
#     and signs only that new merge commit as lead. It never signs a step's commit: an unsigned
#     step commit fails the commits check, and goes back to its own step to sign
#   - pushes notes and branch together, so the push itself starts CI; a branch the bot may not
#     push (a person's) is pushed with the person's gh login, notes by the bot
#   - no auto-merge: it waits for check, e2e, next, commits and the tests on the pushed sha, then
#     merges with --match-head-commit, so a newer head or a red check stops it (hand PRs only)
#   - trusts commits only as one pull_request_target run of main's commits.yaml for this ticket
set -eu
usage() { echo "usage: catchup.sh <pr> <ticket> [--merge-method squash|merge]" >&2; exit 1; }
[ "$#" = 2 ] || [ "$#" = 4 ] || usage
pr=$1; ticket=$2; shift 2
method=squash
if [ "$#" != 0 ]; then
	[ "$1" = --merge-method ] || usage
	case $2 in squash|merge) method=$2 ;; *) usage ;; esac
fi
. "$(dirname "$0")/env.sh"
W=$BOXES/catchup-$pr; LOCK=$BOXES/catchup.lock; LEAD=$lead_here
AS='-c user.name=fabrikalfa[bot] -c user.email=353269643+fabrikalfa[bot]@users.noreply.github.com'
# Only command failures are retried. Callers inspect successful answers, including red ones.
read_gh() {
	attempt=1
	while :; do
		if output=$(gh "$@"); then printf '%s\n' "$output"; return 0; fi
		if [ "$attempt" -ge 3 ]; then
			echo "pr $pr: gh $* failed after 3 attempts at head ${tip:-unknown}" >&2
			return 1
		fi
		sleep "$attempt"
		attempt=$((attempt + 1))
	done
}
mkdir -p "$BOXES"
until mkdir "$LOCK" 2>/dev/null; do sleep 5; done
# EXIT drops the lock; INT and TERM end the run (and so run EXIT), never carry on past a signal.
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM
head=$(read_gh pr view "$pr" -R "$GH_REPO" --json headRefName -q .headRefName)
[ -d "$W" ] || git -C "$MAIN" worktree add -q --detach "$W" origin/main
cd "$W"
git fetch -q origin main "refs/notes/fabrika:refs/notes/fabrika" 2>/dev/null || git fetch -q origin main
git fetch -q origin "pull/$pr/head"
git checkout -q --detach FETCH_HEAD
[ -d node_modules ] || nice -n 15 pnpm install --silent >/dev/null 2>&1
tip=$(git rev-parse HEAD)
if ! git merge-base --is-ancestor origin/main HEAD; then
	if ! git $AS merge -q --no-edit origin/main -m "Merge main into $head" -m "Co-authored-by: $FABRIKA_COAUTHOR"; then
		git merge --abort 2>/dev/null || true
		echo "pr $pr: merging main conflicts; aborted, nothing pushed" >&2
		exit 1
	fi
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
deadline=$(($(date +%s) + 3600))
for _ in $(seq 120); do
	runs=$(read_gh api "repos/$GH_REPO/commits/$tip/check-runs?per_page=100" \
		-q '.check_runs[]|"\(.name)\t\(.status)\t\(.conclusion)"')
	bad=$(printf '%s\n' "$runs" | awk -F'\t' '$2=="completed" && $3!="success" && $3!="skipped" && $3!="neutral" {print $1": "$3}')
	[ -z "$bad" ] || { echo "pr $pr: red at $tip: $bad" >&2; exit 1; }
	missing=""
	for n in $need; do printf '%s\n' "$runs" | grep -q "^$n	" || missing="$missing $n"; done
	pending=$(printf '%s\n' "$runs" | awk -F'\t' 'NF && $2!="completed"' | wc -l | tr -d ' ')
	[ -z "$missing" ] && [ "$pending" = 0 ] && break
	[ "$(date +%s)" -lt "$deadline" ] || break
	sleep 30
done
if [ -n "$missing" ] || [ "$pending" != 0 ]; then
	echo "pr $pr: checks not done at $tip after an hour (missing:${missing:- none}, pending: $pending)" >&2
	exit 1
fi
# The commits check is never trusted by its name: any workflow can name a job `commits`
# (docs/how-to/sign-a-step-commit.md). Read the runs of main's `.github/workflows/commits.yaml` on
# this head instead: exactly one, from `pull_request_target` (so main's copy ran, not the PR's),
# completed with success, and its own check run made by GitHub Actions.
trusted=$(read_gh api "repos/$GH_REPO/actions/runs?head_sha=$tip&per_page=100" \
	-q '.workflow_runs[]|select(.path==".github/workflows/commits.yaml")|"\(.id)\t\(.event)\t\(.status)\t\(.conclusion)\t\(.check_suite_id)"')
target=$(printf '%s\n' "$trusted" | awk -F'\t' '$2=="pull_request_target"')
if [ "$(printf '%s\n' "$target" | grep -c .)" != 1 ]; then
	echo "pr $pr: want exactly one pull_request_target run of commits.yaml at $tip, got: ${trusted:-none}" >&2
	exit 1
fi
run_id=$(printf '%s' "$target" | cut -f1); suite=$(printf '%s' "$target" | cut -f5)
[ "$(printf '%s' "$target" | cut -f3,4)" = "completed	success" ] ||
	{ echo "pr $pr: commits.yaml run $run_id at $tip is not a success" >&2; exit 1; }
apps=$(read_gh api "repos/$GH_REPO/commits/$tip/check-runs?check_name=commits&per_page=100" \
	-q ".check_runs[]|select(.check_suite.id==$suite)|.app.slug")
[ "$apps" = github-actions ] ||
	{ echo "pr $pr: run $run_id's commits check is not GitHub Actions' own (${apps:-none})" >&2; exit 1; }
# The check's `check` step prints one count line: `commits: N commits, ticket T`, or "not in scope".
logs=$(read_gh run view "$run_id" -R "$GH_REPO" --log)
said=$(printf '%s\n' "$logs" |
	awk -F'\t' '$1=="commits" && $2=="check" {sub(/^[^ ]* /, "", $3); if ($3 ~ /^commits: ([0-9]+ commits|not in scope)/) print $3}')
[ "$(printf '%s\n' "$said" | grep -c .)" = 1 ] ||
	{ echo "pr $pr: run $run_id printed no single result: ${said:-nothing}" >&2; exit 1; }
case $said in
"commits: not in scope"* | "commits: "*" commits, ticket $ticket") ;;
*) echo "pr $pr: run $run_id is not for ticket $ticket: $said" >&2; exit 1 ;;
esac
gh pr merge "$pr" -R "$GH_REPO" "--$method" --match-head-commit "$tip" >/dev/null
echo "pr $pr: merged at $(git rev-parse --short "$tip"), signed for ticket $ticket"
