#!/bin/sh
# keepruns.sh <folder>: before a box or worktree folder is removed, move its runs/ into the main
# checkout's runs/<folder name>/, so raw samples kept there privately survive the removal (AGENTS.md:
# raw samples live under runs/, never in git). Today's lead tooling, run on our own laptop.
#   nothing to keep (no runs/, or an empty one)  exit 0, prints nothing
#   moved                                        exit 0, prints "kept runs of <name> at <dest>"
#   cannot move (a symlink, MAIN itself, mv failed)  exit 1: the caller keeps the folder
# A name already taken under MAIN's runs/ gets a -<n> suffix; nothing there is ever overwritten.
# Field note 2026-11-09: a landed worktree's removal deleted experiment 244's raw answers.
set -u
. "$(dirname "$0")/env.sh"
[ "$#" = 1 ] || { echo "usage: keepruns.sh <folder>" >&2; exit 2; }
dir=$1
name=$(basename "$dir")
src=$dir/runs
[ -e "$src" ] || [ -L "$src" ] || exit 0
if [ -L "$src" ] || [ ! -d "$src" ]; then
	echo "runs of $name: not a plain folder" >&2
	exit 1
fi
[ -n "$(ls -A "$src")" ] || exit 0
here=$(cd "$dir" && pwd -P)
main=$(cd "$MAIN" && pwd -P)
[ "$here" != "$main" ] || { echo "runs of $name: that is MAIN's own runs/" >&2; exit 1; }
mkdir -p "$MAIN/runs" || exit 1
dest=$MAIN/runs/$name
n=1
while [ -e "$dest" ] || [ -L "$dest" ]; do
	dest=$MAIN/runs/$name-$n
	n=$((n + 1))
done
mv "$src" "$dest" || { echo "runs of $name: move failed" >&2; exit 1; }
echo "kept runs of $name at runs/$(basename "$dest")"
