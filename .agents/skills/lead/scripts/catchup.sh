#!/bin/sh
# catchup.sh <pr> <ticket> [all]
# Bring a pull request up to date with main and sign it as the lead, in one go, then arm auto-merge.
#   - merges origin/main in as fabrikalfa[bot] (the person as co-author) when the head lacks it
#   - "all": lead-signs every commit since main that has no step signature (a person's PR);
#     otherwise only a new merge commit is signed
#   - pushes commit and notes in one push, so the push itself starts CI (no rerun by hand);
#     a branch the bot may not push (a person's) is pushed with the person's gh login, notes by the bot
#   - arms GitHub auto-merge (hand PRs only, never a live run)
set -eu
. "$(dirname "$0")/env.sh"
pr=$1; ticket=$2; mode=${3:-}
W=${CATCHUP_TREE:-$(dirname "$MAIN")/tf-catchup}; LEAD=$lead_here
AS='-c user.name=fabrikalfa[bot] -c user.email=353269643+fabrikalfa[bot]@users.noreply.github.com'
head=$(gh pr view "$pr" -R "$GH_REPO" --json headRefName -q .headRefName)
[ -d "$W" ] || git -C "$MAIN" worktree add -q --detach "$W" origin/main
cd "$W"
git fetch -q origin main "refs/notes/fabrika:refs/notes/fabrika" 2>/dev/null || git fetch -q origin main
git fetch -q origin "pull/$pr/head"
git checkout -q --detach FETCH_HEAD
[ -d node_modules ] || nice -n 15 pnpm install --silent >/dev/null 2>&1
sign() { git checkout -q --detach "$1"; git notes --ref=fabrika remove HEAD 2>/dev/null || true
	nice -n 15 pnpm -s commits sign --step lead --ticket "$ticket" --key ~/.fabrika/step-keys/lead >/dev/null; }
tip=$(git rev-parse HEAD); old=$tip
if [ "$mode" = all ]; then
	for c in $(git rev-list --reverse "origin/main..$tip"); do
		git notes --ref=fabrika show "$c" 2>/dev/null | grep -q '"step":"\(tests\|build\)"' || sign "$c"
	done
	git checkout -q --detach "$tip"
fi
if ! git merge-base --is-ancestor origin/main HEAD; then
	git $AS merge -q --no-edit origin/main -m "Merge main into $head" -m "Co-authored-by: $FABRIKA_COAUTHOR"
	tip=$(git rev-parse HEAD); sign "$tip"
fi
case $head in
fabrikalfa/*) node "$LEAD/botpush.mjs" . "$head" "$tip" ;;
*) node "$LEAD/botpush.mjs" . - ; git push -q origin "$tip:refs/heads/$head" ;;
esac
# Only new signatures and no new commit: no push starts CI, so rerun the commit check once.
if [ "$tip" = "$old" ]; then
	run=$(gh pr checks "$pr" -R "$GH_REPO" --json name,link -q '.[]|select(.name=="commits")|.link' | grep -o 'runs/[0-9]*' | cut -d/ -f2)
	[ -n "$run" ] && gh run rerun "$run" -R "$GH_REPO"
fi
gh pr merge "$pr" -R "$GH_REPO" --auto --merge >/dev/null && echo "pr $pr: up to date at $(git rev-parse --short "$tip"), signed for ticket $ticket, auto-merge armed"
