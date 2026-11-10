#!/bin/sh
# catchup.sh <pr> <ticket>
# Bring a pull request up to date with main, sign the new merge as the lead, push, wait for every
# check on that exact head, then squash it pinned to that head. We only squash.
# Run it in the background.
#   - each pull request gets its own checkout (BOXES/catchup-<pr>), force-removed when the run ends
#     unless it holds MAIN's Git storage, and one lock is held while it fetches, merges, signs and
#     pushes, so two catch-ups never share a tree or the notes ref
#   - merges origin/main in as fabrikalfa[bot] (the person as co-author) when the head lacks it,
#     and signs only that new merge commit as lead. It never signs a step's commit: an unsigned
#     step commit fails the commits check, and goes back to its own step to sign
#   - pushes notes and branch together, so the push itself starts CI; a branch the bot may not
#     push (a person's) is pushed with the person's gh login, notes by the bot
#   - no auto-merge: it waits for check, e2e, next, commits and the tests on the pushed sha, then
#     merges with --match-head-commit, so a newer head or a red check stops it (hand PRs only). A PR
#     in a gh stack must merge through the stack API, which takes no head pin: its head is read
#     again first, then `gh stack merge <pr> --squash --yes` lands it
#   - trusts commits only as one pull_request_target run of main's commits.yaml for this ticket
set -eu
usage() { echo "usage: catchup.sh <pr> <ticket>" >&2; exit 1; }
[ "$#" = 2 ] || usage
pr=$1; ticket=$2
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
# sweep <mode> <pr> <branch> <tip> <checkout> <box.sh>: `checkout` removes this run's own
# checkout, forced, unless it holds MAIN's Git storage; `landed` keeps the checked head and removes
# the branch's boxes and its one driver worktree, each only when that is safe.
sweep() {
python3 - "$@" <<'PY'
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys

mode, pr, branch, tip, checkout, box_script = sys.argv[1:]
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

        def walk(gitdir, common, objects):
            # Every entry below MAIN's storage roots counts, at any depth: packs, loose folders,
            # refs, logs, the index and names Git may add later. A link anywhere is followed and
            # both ends are kept; a link that cannot be followed stops cleanup. Other worktrees'
            # admin folders are their own storage, not MAIN's.
            others = common / "worktrees"
            stack, walked = [gitdir, common, *objects], set()
            while stack:
                real = resolve(stack.pop())
                if real in walked or not real.is_dir():
                    continue
                walked.add(real)
                for child in sorted(os.listdir(real)):
                    entry = real / child
                    protected.add(entry)
                    if entry == others and entry != gitdir:
                        continue
                    if entry.is_symlink() or entry.is_dir():
                        stack.append(entry)

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
        walk(gitdir, common, seen)
        return protected, gitdir

    def storage_reason(path, pointer_required):
        """Why the path must stay, or None when nothing of MAIN's lives in it."""
        root = path.resolve()
        state = boxes / "state"
        try:
            protected, gitdir = main_storage()
            # Worktree removal also deletes the worktree's admin folder, outside its checkout.
            # Read the checkout's own pointer from outside; never ask its Git config.
            places, admin = [root], None
            pointer = path / ".git"
            if pointer_required or os.path.lexists(pointer):
                if pointer.is_symlink() or not pointer.is_file():
                    raise ValueError("unsupported worktree pointer")
                line = pointer.read_text().removesuffix("\n")
                if not line.startswith("gitdir: ") or any(c in line for c in "\0\r\n"):
                    raise ValueError("unsupported worktree pointer")
                admin = (path / line[8:]).resolve(strict=True)
                places.append(admin)
            if any(holds(place, kept_path) for place in places for kept_path in protected) \
                    or (admin is not None and holds(admin, gitdir)):
                return "holds MAIN Git storage"
        except (OSError, ValueError, RuntimeError):
            return "cannot read MAIN Git storage"
        if path.is_symlink() or any(holds(root, protected)
                                   for protected in (main, state, state.resolve())):
            return "MAIN, saved state or symlinked target"
        return None

    def remove_worktree(path, fields):
        label = f"worktree {path.name}"
        reason = storage_reason(path, True)
        if reason:
            kept(label, reason)
        elif not retained:
            kept(label, "checked head not retained")
        elif any(field.split(" ", 1)[0] in ("locked", "prunable") for field in fields):
            kept(label, "locked or unreadable worktree")
        elif git("worktree", "remove", str(path)).returncode:
            kept(label, "worktree removal refused or failed")

    def remove_checkout(path):
        # This run's own checkout goes on every exit, forced, unless it holds MAIN's storage.
        if path.is_symlink():
            kept(f"worktree {path.name}", "symlinked target")
            return
        if not os.path.lexists(path):
            return
        reason = storage_reason(path, False)
        if reason:
            kept(f"worktree {path.name}", reason)
            return
        git("worktree", "remove", "--force", "--force", str(path))
        if os.path.lexists(path):
            shutil.rmtree(path)

    if mode == "checkout":
        remove_checkout(Path(checkout))
    else:
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
}
mkdir -p "$BOXES"
until mkdir "$LOCK" 2>/dev/null; do sleep 5; done
# EXIT drops the lock while it is held and force-removes this run's own checkout, success or
# failure, unless the checkout holds MAIN's Git storage: then it stays, with a line saying why.
# INT and TERM end the run (and so run EXIT), never carry on past a signal.
held=yes
cleanup() {
	[ "$held" = no ] || rmdir "$LOCK" 2>/dev/null || true
	cd "$BOXES" || return 0
	sweep checkout "$pr" "" "" "$W" "" || echo "kept worktree catchup-$pr: inspection failed"
}
trap cleanup EXIT
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
rmdir "$LOCK"; held=no
# Wait for every check on this exact sha, up to an hour. A skipped job (no code changed) is done.
need="check e2e commits"
# The clock is read after every answer and before a green one can break out to the merge.
missing=$need; pending=1; finished=no
deadline=$(($(date +%s) + 3600))
for _ in $(seq 120); do
	runs=$(read_gh api "repos/$GH_REPO/commits/$tip/check-runs?per_page=100" \
		-q '.check_runs[]|"\(.name)\t\(.status)\t\(.conclusion)"')
	bad=$(printf '%s\n' "$runs" | awk -F'\t' '$2=="completed" && $3!="success" && $3!="skipped" && $3!="neutral" {print $1": "$3}')
	[ -z "$bad" ] || { echo "pr $pr: red at $tip: $bad" >&2; exit 1; }
	missing=$(printf '%s\n' "$runs" | awk -F'\t' -v need="$need" '
		{ present[$1]=1 }
		$1=="next" && $2=="completed" && $3=="skipped" { skipped=1 }
		$1 ~ /^next \([0-9]+\)$/ { matrix=1 }
		END {
			count=split(need, required, " ")
			for (i=1; i<=count; i++)
				if (!(required[i] in present)) printf " %s", required[i]
			# A skipped matrix job has one bare check; any member requires all six names.
			if (skipped && !matrix) exit
			for (i=1; i<=6; i++) {
				name="next (" i ")"
				if (!(name in present)) printf " %s", name
			}
		}')
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
# completed with success, and its own check run made by GitHub Actions. A run that never started
# (`startup_failure`: no job ran and no check run exists, as in GitHub's pull_request_target
# pause of 2026-11-09) is not counted; reopening the PR starts a fresh one.
trusted=$(read_gh api "repos/$GH_REPO/actions/runs?head_sha=$tip&per_page=100" \
	-q '.workflow_runs[]|select(.path==".github/workflows/commits.yaml")|"\(.id)\t\(.event)\t\(.status)\t\(.conclusion)\t\(.check_suite_id)"')
target=$(printf '%s\n' "$trusted" | awk -F'\t' '$2=="pull_request_target" && $4!="startup_failure"')
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
if ! said=$(gh pr merge "$pr" -R "$GH_REPO" --squash --match-head-commit "$tip" 2>&1); then
	case $said in
	*"part of a stack"*)
		now=$(read_gh pr view "$pr" -R "$GH_REPO" --json headRefOid -q .headRefOid)
		[ "$now" = "$tip" ] || { echo "pr $pr: head moved to $now after the checks at $tip" >&2; exit 1; }
		gh stack merge "$pr" --squash --yes >/dev/null
		;;
	*) echo "pr $pr: merge refused: $said" >&2; exit 1 ;;
	esac
fi
echo "pr $pr: merged at $(git rev-parse --short "$tip"), signed for ticket $ticket"
# A landed merge stays successful even if cleanup must keep a working copy. The EXIT trap then
# removes the catch-up checkout itself.
if cd "$MAIN"; then
	sweep landed "$pr" "$head" "$tip" "$W" "$LEAD/box.sh" || echo "kept cleanup: inspection failed"
else
	echo "kept cleanup: cannot leave catch-up checkout"
fi
exit 0
