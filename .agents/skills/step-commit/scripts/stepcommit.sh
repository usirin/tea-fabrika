#!/bin/sh
# stepcommit.sh <step> <ticket> <subject> <path>...: stage these paths, refuse a build that holds an
# exam path, commit as the bot, and sign as the step, in one go. mutation signs as tests for now.
# Run it from the repo root (a box or a worktree). The person rides as Co-authored-by: set
# FABRIKA_COAUTHOR="Name <email>", or it reads your global git config (never the box's own config).
set -e
step=$1; ticket=$2; subject=$3; shift 3
[ "$step" = mutation ] && step=tests
case $step in tests|build|lead) ;; *) echo "stepcommit: unknown step $step" >&2; exit 2;; esac
[ $# -gt 0 ] || { echo "stepcommit: name the paths to stage" >&2; exit 2; }
here=$(dirname "$0")
coauthor=${FABRIKA_COAUTHOR:-"$(git config --global user.name) <$(git config --global user.email)>"}
git add -- "$@"
if [ "$step" = build ]; then
	staged=$(git diff --cached --name-only)
	if python3 "$here/exam.py" exam-paths.json $staged; then :; else
		echo "stepcommit: a build may not commit the exam paths above; answer send to tests" >&2
		git reset -q -- $staged; exit 3
	fi
fi
git -c user.name="fabrikalfa[bot]" -c user.email="353269643+fabrikalfa[bot]@users.noreply.github.com" \
	commit -q -m "$subject" -m "Co-authored-by: $coauthor"
pnpm commits sign --step "$step" --ticket "$ticket" --key "$HOME/.fabrika/step-keys/$step"
git log --oneline -1
