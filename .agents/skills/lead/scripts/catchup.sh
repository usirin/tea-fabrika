#!/bin/sh
# catchup.sh <pr> <ticket>
# Land a pull request, squashed and pinned to its head. A head that lacks main but is already green
# (every check below green on it, commits trusted) lands as it is (0097): no merge of main, no
# push, only freshmain.ts's lint on the true merge. Any other head is brought up to date with main,
# the new merge signed as the lead and pushed, and every check waited for on that exact head.
# We only squash. Run it in the background.
#   - each pull request gets its own checkout (BOXES/catchup-<pr>), force-removed when the run ends
#     unless it holds MAIN's Git storage, and one lock is held while it fetches, merges, signs and
#     pushes, so two catch-ups never share a tree or the notes ref
#   - reads the head's checks once when it lacks main, the same way the wait below reads them. A
#     red, missing or running check, or an untrusted commits run, takes the catch-up path; a read
#     that fails three times stops the run with nothing pushed
#   - catching up, merges origin/main in as fabrikalfa[bot] (the person as co-author), and signs
#     only that new merge commit as lead. It never signs a step's commit: an unsigned
#     step commit fails the commits check, and goes back to its own step to sign
#   - pushes notes and branch together, so the push itself starts CI; a branch the bot may not
#     push (a person's) is pushed with the person's gh login, notes by the bot
#   - no auto-merge: it needs check, e2e, next, commits and the tests green on the head it lands
#     (after a catch-up, it waits for them on the pushed sha), then
#     merges with --match-head-commit, so a newer head or a red check stops it (hand PRs only). A PR
#     in a gh stack must merge through the stack API, which takes no head pin: its head is read
#     again first, then `gh stack merge <pr> --squash --yes` lands it. A PR behind main lands on
#     purpose (0049): gh refuses BEHIND on its own side and never asks GitHub, so the squash goes
#     to the REST merge endpoint with `sha` as the head pin, and no override flag
#   - just before the squash it looks at main once more: when the head lacks it (a green head that
#     did not catch up, or main moved after the checks),
#     freshmain.ts runs `pnpm lint` on the head merged with it and refuses a red one, a conflict or
#     a fetch that fails. No flag skips it. The tests are not run again (ticket 552)
#   - prints sizecap.ts's one line, the product lines against 0087's cap, before it waits on the
#     checks. It is advice: it never stops a merge until a replay lets it block
#   - trusts commits only as one pull_request_target run of main's commits.yaml for this ticket
#   - once the squash is on main, closes each ticket the PR description names on a line of its
#     own, `fabrika close ticket <N>`, and prints what it closed (0015)
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
# close_named: once GitHub says MERGED and the squash commit is on main, close each ticket the PR
# description names on a line of its own, `fabrika close ticket <N>` (0015). Nothing else closes
# one: no GitHub keyword, trailer or signed ticket. Each close gets a comment naming the PR and
# its merge commit, through the tracker's own `post` command, as agent:lead. Its list shows only
# open tickets, so one not on it (already closed, or no such ticket) is said and skipped. Trouble
# here prints a line and never turns a landed merge red.
TRACKER_HOME=${FABRIKA_HOME:-$HOME/Library/Application Support/@kampus/fabrika-app}
tracker() { FABRIKA_HOME=$TRACKER_HOME node "$MAIN/apps/fabrika/src/cli.ts" post "$@" --as lead 2>&1; }
# The tracker's first ERROR line, never its stack, which names local paths.
first_error() { printf '%s\n' "$1" | grep -m 1 ERROR || echo "no reason given"; }
close_named() {
	landed=""
	# A stack merges asynchronously: give it a few minutes to say MERGED.
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		landed=$(read_gh pr view "$pr" -R "$GH_REPO" --json state,mergeCommit \
			-q '"\(.state) \(.mergeCommit.oid // "")"') || landed=""
		case $landed in "MERGED "?*) break ;; esac
		sleep 30
	done
	case $landed in
	"MERGED "?*) oid=${landed#MERGED } ;;
	*) landed=${landed% }; echo "pr $pr: not confirmed merged (${landed:-no answer}); closed no tickets"; return 0 ;;
	esac
	if ! { git fetch -q origin main && git merge-base --is-ancestor "$oid" origin/main; }; then
		echo "pr $pr: merge commit $oid is not on main; closed no tickets"
		return 0
	fi
	body=$(read_gh pr view "$pr" -R "$GH_REPO" --json body -q .body) ||
		{ echo "pr $pr: cannot read the description; closed no tickets"; return 0; }
	named=$(printf '%s\n' "$body" | tr -d '\r' |
		awk '/^[ \t]*fabrika close ticket [0-9]+[ \t]*$/ && !seen[$4 + 0]++ {print $4 + 0}')
	[ -n "$named" ] || { echo "pr $pr: no fabrika close ticket line; closed no tickets"; return 0; }
	listed=$(tracker list) || { echo "pr $pr: cannot read the tracker; closed no tickets: $(echo $named)"; return 0; }
	note=$W/.fabrika-close-note
	for n in $named; do
		state=$(printf '%s\n' "$listed" | sed -n "s/.*: #$n \([a-z]*\) .*/\1/p" | head -n 1)
		case $state in
		open)
			printf 'Closed by the merge of https://github.com/%s/pull/%s, merge commit %s.\n' \
				"$GH_REPO" "$pr" "$oid" >"$note"
			if ! said=$(tracker comment "$n" --body-file "$note"); then
				echo "pr $pr: ticket $n not closed, the comment failed: $(first_error "$said")"
			elif ! said=$(tracker close "$n"); then
				echo "pr $pr: ticket $n not closed: $(first_error "$said")"
			else
				echo "pr $pr: closed ticket $n"
			fi
			;;
		*) echo "pr $pr: ticket $n is not open (already closed, or no such ticket); left as it is" ;;
		esac
	done
}
# sweep <mode> <pr> <branch> <tip> <checkout> <box.sh>: `checkout` removes this run's own
# checkout, forced, unless it holds MAIN's Git storage; `landed` keeps the checked head and removes
# the branch's boxes and its one driver worktree, each only when that is safe.
# Before either removal, keepruns.sh moves the folder's runs/ into MAIN's runs/<name>/.
sweep() {
KEEPRUNS="$LEAD/keepruns.sh" python3 - "$@" <<'PY'
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys

mode, pr, branch, tip, checkout, box_script = sys.argv[1:]
main = Path(os.environ["MAIN"]).resolve()
boxes = Path(os.environ["BOXES"]).resolve()

def keep_runs(path):
    # Raw samples live under runs/, never in git: move them to MAIN before the folder goes.
    result = subprocess.run(["sh", os.environ["KEEPRUNS"], str(path)], capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout.rstrip(), flush=True)
    return result.returncode == 0

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
        elif not keep_runs(path):
            kept(label, "could not keep its runs/")
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
        if not keep_runs(path):
            kept(f"worktree {path.name}", "could not keep its runs/")
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
# checks_at <sha>: one read of the check runs on that sha. Sets `bad` (the red ones), `missing`
# (the names needed and not there) and `pending` (how many have not finished). A skipped job (no
# code changed) is done. A read that fails three times stops the run.
need="check e2e commits"
checks_at() {
	runs=$(read_gh api "repos/$GH_REPO/commits/$1/check-runs?per_page=100" \
		-q '.check_runs[]|"\(.name)\t\(.status)\t\(.conclusion)"') || exit 1
	bad=$(printf '%s\n' "$runs" | awk -F'\t' '$2=="completed" && $3!="success" && $3!="skipped" && $3!="neutral" {print $1": "$3}')
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
}
# commits_trusted <sha>: the commits check is never trusted by its name: any workflow can name a
# job `commits` (docs/how-to/sign-a-step-commit.md). Read the runs of main's
# `.github/workflows/commits.yaml` on this head instead: exactly one, from `pull_request_target` (so
# main's copy ran, not the PR's), completed with success, and its own check run made by GitHub
# Actions. A run that never started (`startup_failure`: no job ran and no check run exists, as in
# GitHub's pull_request_target pause of 2026-11-09) is not counted; reopening the PR starts a fresh
# one. Untrusted sets `why` and fails; a read that fails three times stops the run.
commits_trusted() {
	trusted=$(read_gh api "repos/$GH_REPO/actions/runs?head_sha=$1&per_page=100" \
		-q '.workflow_runs[]|select(.path==".github/workflows/commits.yaml")|"\(.id)\t\(.event)\t\(.status)\t\(.conclusion)\t\(.check_suite_id)"') || exit 1
	target=$(printf '%s\n' "$trusted" | awk -F'\t' '$2=="pull_request_target" && $4!="startup_failure"')
	if [ "$(printf '%s\n' "$target" | grep -c .)" != 1 ]; then
		why="want exactly one pull_request_target run of commits.yaml at $1, got: ${trusted:-none}"
		return 1
	fi
	run_id=$(printf '%s' "$target" | cut -f1); suite=$(printf '%s' "$target" | cut -f5)
	[ "$(printf '%s' "$target" | cut -f3,4)" = "completed	success" ] ||
		{ why="commits.yaml run $run_id at $1 is not a success"; return 1; }
	apps=$(read_gh api "repos/$GH_REPO/commits/$1/check-runs?check_name=commits&per_page=100" \
		-q ".check_runs[]|select(.check_suite.id==$suite)|.app.slug") || exit 1
	[ "$apps" = github-actions ] ||
		{ why="run $run_id's commits check is not GitHub Actions' own (${apps:-none})"; return 1; }
	# The check's `check` step prints one count line: `commits: N commits, ticket T`, or "not in scope".
	logs=$(read_gh run view "$run_id" -R "$GH_REPO" --log) || exit 1
	said=$(printf '%s\n' "$logs" |
		awk -F'\t' '$1=="commits" && $2=="check" {sub(/^[^ ]* /, "", $3); if ($3 ~ /^commits: ([0-9]+ commits|not in scope)/) print $3}')
	[ "$(printf '%s\n' "$said" | grep -c .)" = 1 ] ||
		{ why="run $run_id printed no single result: ${said:-nothing}"; return 1; }
	case $said in
	"commits: not in scope"* | "commits: "*" commits, ticket $ticket") ;;
	*) why="run $run_id is not for ticket $ticket: $said"; return 1 ;;
	esac
}
# green_at <sha>: true when one read finds every check done and none red, and commits is trusted,
# all on that sha (0097). Sets `why` when it is not.
green_at() {
	checks_at "$1"
	if [ -n "$bad" ]; then why="red: $(echo $bad)"; return 1; fi
	if [ -n "$missing" ] || [ "$pending" != 0 ]; then
		why="checks not done (missing:${missing:- none}, pending: $pending)"
		return 1
	fi
	commits_trusted "$1"
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
# A head that lacks main and is green on every check lands as it is (0097): nothing is merged or
# pushed here, and freshmain.ts below lints its true merge with main. Any other head catches up.
green=no
if git merge-base --is-ancestor origin/main HEAD; then
	:
elif green_at "$tip"; then
	green=yes
	echo "pr $pr: every check is green at $tip; it lands without catching up with main (0097)"
else
	echo "pr $pr: $why at $tip; merging main in"
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
# 0087's cap: one line with the pull request's product lines against `[review] lines`. Advice only
# until the replay on merged pull requests lets it block; it never stops a merge.
if size=$(node "$LEAD/sizecap.ts" diff origin/main "$tip"); then echo "pr $pr: $size"; else echo "pr $pr: size not counted"; fi
# A head that caught up (or already held main) waits for every check on this exact sha, up to an
# hour, then for a trusted commits run. A green head that did not catch up was read whole above.
if [ "$green" = no ]; then
	# The clock is read after every answer and before a green one can break out to the merge.
	missing=$need; pending=1; finished=no
	deadline=$(($(date +%s) + 3600))
	for _ in $(seq 120); do
		checks_at "$tip"
		[ -z "$bad" ] || { echo "pr $pr: red at $tip: $bad" >&2; exit 1; }
		[ "$(date +%s)" -lt "$deadline" ] || break
		if [ -z "$missing" ] && [ "$pending" = 0 ]; then finished=yes; break; fi
		sleep 30
	done
	if [ "$finished" != yes ]; then
		echo "pr $pr: checks not done at $tip after an hour (missing:${missing:- none}, pending: $pending)" >&2
		exit 1
	fi
	commits_trusted "$tip" || { echo "pr $pr: $why" >&2; exit 1; }
fi
# Main may have moved since those checks ran (ticket 552), or a green head never caught up (0097). freshmain.ts fetches it and, when it
# moved, runs pnpm lint on this head merged with it, in this checkout. A red lint, a conflict or a
# fetch that fails stops here: the lane merges main and pushes, and catch-up runs again.
node "$LEAD/freshmain.ts" "$pr" "$tip" || { echo "pr $pr: not merged" >&2; exit 1; }
if ! said=$(gh pr merge "$pr" -R "$GH_REPO" --squash --match-head-commit "$tip" 2>&1); then
	case $said in
	*"part of a stack"*)
		now=$(read_gh pr view "$pr" -R "$GH_REPO" --json headRefOid -q .headRefOid)
		[ "$now" = "$tip" ] || { echo "pr $pr: head moved to $now after the checks at $tip" >&2; exit 1; }
		gh stack merge "$pr" --squash --yes >/dev/null
		;;
	# gh 2.62.0 says this when it reads merge state BEHIND, and stops before any call. freshmain.ts
	# has just passed lint on this head merged with main, so it lands behind main on purpose (0049).
	# The REST endpoint takes `sha` as the head pin: a newer head is a 409, and GitHub's own rules
	# still decide (a 405). It is a write, so it is never retried.
	*"the head branch is not up to date with the base branch"*)
		said=$(gh api -X PUT "repos/$GH_REPO/pulls/$pr/merge" -f merge_method=squash -f sha="$tip" 2>&1) ||
			{ echo "pr $pr: merge behind main refused at $tip: $said" >&2; exit 1; }
		echo "pr $pr: landed behind main on purpose (0049)"
		;;
	*) echo "pr $pr: merge refused: $said" >&2; exit 1 ;;
	esac
fi
echo "pr $pr: merged at $(git rev-parse --short "$tip"), signed for ticket $ticket"
close_named || echo "pr $pr: closing tickets failed; close them by hand"
# A landed merge stays successful even if cleanup must keep a working copy. The EXIT trap then
# removes the catch-up checkout itself.
if cd "$MAIN"; then
	sweep landed "$pr" "$head" "$tip" "$W" "$LEAD/box.sh" || echo "kept cleanup: inspection failed"
else
	echo "kept cleanup: cannot leave catch-up checkout"
fi
exit 0
