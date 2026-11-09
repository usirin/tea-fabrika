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
# The clock is read after every answer and before a green one can break out to the merge.
missing=$need; pending=1; finished=no
deadline=$(($(date +%s) + 3600))
for _ in $(seq 120); do
	runs=$(read_gh api "repos/$GH_REPO/commits/$tip/check-runs?per_page=100" \
		-q '.check_runs[]|"\(.name)\t\(.status)\t\(.conclusion)"')
	bad=$(printf '%s\n' "$runs" | awk -F'\t' '$2=="completed" && $3!="success" && $3!="skipped" && $3!="neutral" {print $1": "$3}')
	[ -z "$bad" ] || { echo "pr $pr: red at $tip: $bad" >&2; exit 1; }
	missing=""
	for n in $need; do printf '%s\n' "$runs" | grep -q "^$n	" || missing="$missing $n"; done
	pending=$(printf '%s\n' "$runs" | awk -F'\t' 'NF && $2!="completed"' | wc -l | tr -d ' ')
	[ "$(date +%s)" -lt "$deadline" ] || break
	if [ -z "$missing" ] && [ "$pending" = 0 ]; then finished=yes; break; fi
	sleep 30
done
if [ "$finished" != yes ]; then
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
# A landed merge stays successful even if cleanup must keep a working copy.
if cd "$MAIN"; then
python3 - "$pr" "$head" "$tip" "$W" "$LEAD/box.sh" <<'PY' || echo "kept cleanup: inspection failed"
from pathlib import Path
import os
import re
import subprocess
import sys

pr, branch, tip, checkout, box_script = sys.argv[1:]
main = Path(os.environ["MAIN"]).resolve()
boxes = Path(os.environ["BOXES"]).resolve()

def kept(item, why):
    # Paths from Git may contain newlines. Keep each result on one line.
    label = str(item).replace("\n", "\\n").replace("\r", "\\r")
    print(f"kept {label}: {why}", flush=True)

def git(*args):
    try:
        return subprocess.run(["git", "-C", str(main), *args], capture_output=True)
    except OSError:
        return subprocess.CompletedProcess(args, 1)

try:
    retained = git("update-ref", f"refs/keep/pr/{pr}", tip).returncode == 0
    if not retained:
        kept(f"head {tip}", "MAIN retention failed")

    listing = git("worktree", "list", "--porcelain", "-z")
    worktrees = []
    if listing.returncode:
        kept("worktrees", "cannot read registered worktrees")
    else:
        try:
            for record in listing.stdout.split(b"\0\0"):
                if not record:
                    continue
                fields = record.rstrip(b"\0").decode().split("\0")
                if not fields[0].startswith("worktree "):
                    raise ValueError("unreadable registration")
                paths = [field[9:] for field in fields if field.startswith("worktree ")]
                branches = [field[7:] for field in fields if field.startswith("branch ")]
                if len(paths) != 1 or len(branches) > 1:
                    raise ValueError("ambiguous registration")
                worktrees.append((Path(paths[0]), branches, fields))
        except (UnicodeError, ValueError):
            worktrees = []
            kept("worktrees", "ambiguous or unreadable registration")

    def holds(root, protected):
        return any(root == parent or (root.exists() and parent.exists() and root.samefile(parent))
                   for parent in (protected, *protected.parents))

    def main_storage():
        protected = set()

        def resolve(path):
            # Keep each link as well as its destination. Removing either breaks MAIN.
            if path == path.parent:
                return path
            parent = resolve(path.parent)
            current = parent / path.name
            protected.add(current)
            if current.is_symlink():
                return resolve(parent / os.readlink(current))
            current.stat()
            return parent.parent if path.name == ".." else current

        def read_path(path):
            value = resolve(path).read_text().removesuffix("\n")
            if not value or any(c in value for c in "\0\r\n"):
                raise ValueError("unsupported MAIN storage path")
            return value

        # Read only MAIN's bindings from outside. Never ask a candidate's Git config.
        gitdir = resolve(main / ".git")
        if gitdir.is_file():
            pointer = read_path(main / ".git")
            if not pointer.startswith("gitdir: "):
                raise ValueError("unsupported MAIN gitdir")
            gitdir = resolve(main / pointer[8:])
        common = gitdir
        if os.path.lexists(gitdir / "commondir"):
            common = resolve(gitdir / read_path(gitdir / "commondir"))
        pending, seen = [common / "objects"], set()
        while pending:
            objects = resolve(pending.pop())
            if not objects.is_dir():
                raise ValueError("unsupported MAIN object directory")
            if objects in seen:
                continue
            seen.add(objects)
            info = objects / "info"
            if os.path.lexists(info):
                info = resolve(info)
                alternates = info / "alternates"
                if os.path.lexists(alternates):
                    for value in resolve(alternates).read_text().splitlines():
                        if not value or value.startswith('"') or "\0" in value:
                            raise ValueError("unsupported MAIN alternate")
                        pending.append(objects / value)
        return protected

    def remove_worktree(path, fields):
        label = f"worktree {path.name}"
        root = path.resolve()
        state = boxes / "state"
        try:
            if any(holds(root, protected) for protected in main_storage()):
                kept(label, "holds MAIN Git storage")
                return
        except (OSError, ValueError, RuntimeError):
            kept(label, "cannot read MAIN Git storage")
            return
        if path.is_symlink() or any(holds(root, protected)
                                   for protected in (main, state, state.resolve())):
            kept(label, "MAIN, saved state or symlinked target")
        elif not retained:
            kept(label, "checked head not retained")
        elif any(field.split(" ", 1)[0] in ("locked", "prunable") for field in fields):
            kept(label, "locked or unreadable worktree")
        elif git("worktree", "remove", str(path)).returncode:
            kept(label, "worktree removal refused or failed")

    # Git records canonical paths. BOXES may have arrived through a system directory link.
    own = [(path, fields) for path, _, fields in worktrees if path.resolve() == Path(checkout).resolve()]
    if Path(checkout).is_symlink():
        kept(f"worktree {Path(checkout).name}", "symlinked target")
    elif len(own) == 1:
        remove_worktree(*own[0])
    else:
        kept(f"worktree {Path(checkout).name}", "missing or ambiguous registration")

    # Read only plain HEAD files from outside the boxes. Never ask their Git config.
    for data in sorted(boxes.glob("*-gitdata")):
        name = data.name[:-8]
        try:
            head = data / "HEAD"
            if data.is_symlink() or head.is_symlink() or not head.is_file():
                raise ValueError("unreadable HEAD")
            value = head.read_text()
            target = f"ref: refs/heads/{branch}"
            if value not in (target, target + "\n"):
                if not re.fullmatch(r"(?:ref: refs/heads/[^\x00-\x20\x7f]+|[0-9a-f]{40})\n?", value):
                    kept(f"box {name}", "unreadable HEAD")
                continue
            if not retained:
                kept(f"box {name}", "checked head not retained")
                continue
            result = subprocess.run(["sh", box_script, "rm", name], capture_output=True, text=True)
            if result.stdout.strip():
                print(result.stdout.rstrip(), flush=True)
            else:
                kept(f"box {name}", "box removal failed")
        except (OSError, ValueError, UnicodeError):
            kept(f"box {name}", "unreadable metadata or removal failed")

    drivers = [(path, fields) for path, branches, fields in worktrees
               if branches == [f"refs/heads/{branch}"] and path.resolve() != Path(checkout).resolve() and path.resolve() != main]
    for path, fields in drivers:
        if len(drivers) != 1:
            kept(f"worktree {path.name}", "ambiguous driver branch")
        else:
            remove_worktree(path, fields)
except OSError:
    kept("cleanup", "operating error")
PY
else
	echo "kept cleanup: cannot leave catch-up checkout"
fi
exit 0
