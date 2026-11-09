#!/bin/sh
# box.sh: a Codex agent's own copy of tea-fabrika, whose git data is outside any folder named .git,
# so Codex's sandbox lets it commit. The lead never runs git inside a box; it only fetches from it.
#   box.sh new   <name> <base-ref> <branch>   make the box, install, print its paths
#   box.sh run   <name> <prompt-file> <out>   run codex in it (CODEX_MODEL, CODEX_EFFORT, standard tier), writable: box + its git data
#   box.sh fetch <name> <branch>              pull the box's branch and step notes into the main checkout
# Paths come from env.sh beside this script.
set -eu
. "$(dirname "$0")/env.sh"
cmd=$1; name=$2
work=$BOXES/$name; gitdata=$BOXES/$name-gitdata
case $cmd in
new)
	base=$3; branch=$4
	mkdir -p "$BOXES"
	git -C "$MAIN" fetch -q origin
	git clone -q --reference "$MAIN" --separate-git-dir="$gitdata" "$REMOTE" "$work"
	git -C "$work" fetch -q "$MAIN" "$base:refs/heads/$branch" 2>/dev/null || git -C "$work" fetch -q origin "$base:refs/heads/$branch"
	git -C "$work" checkout -q "$branch"
	git -C "$MAIN" fetch -q origin 'refs/notes/fabrika:refs/notes/fabrika' 2>/dev/null || true
	git -C "$work" fetch -q "$MAIN" 'refs/notes/fabrika:refs/notes/fabrika' 2>/dev/null || true
	(cd "$work" && nice -n 15 pnpm install --silent >/dev/null 2>&1)
	echo "box $work, git data $gitdata, branch $branch"
	;;
run)
	prompt=$3; out=$4
	cd "$work"
	exec nice -n 15 codex exec --ignore-user-config -m "$CODEX_MODEL" -c model_reasoning_effort="$CODEX_EFFORT" \
		-s workspace-write -c "sandbox_workspace_write.writable_roots=[\"$work\",\"$work/.agents\",\"$gitdata\"]" \
		-C "$work" --json -o "$out" - < "$prompt"
	;;
fetch)
	branch=$3
	# Fetch only. Never status, commit or any other git command inside the box: its config and hooks are the agent's.
	git -C "$MAIN" -c core.hooksPath=/dev/null fetch -q -f "$work" "refs/heads/$branch:refs/heads/$branch"
	git -C "$MAIN" -c core.hooksPath=/dev/null fetch -q -f "$work" "refs/notes/fabrika:refs/notes/box-$name" 2>/dev/null &&
		git -C "$MAIN" notes --ref=fabrika merge -q -s cat_sort_uniq "box-$name" 2>/dev/null || true
	git -C "$MAIN" log --format='%h %an | %s' -3 "$branch"
	;;
*) echo "usage: box.sh new|run|fetch <name> ..." >&2; exit 2 ;;
esac
