#!/bin/sh
# catchup.sh <pr> <ticket>
# Land a pull request, squashed and pinned to its head, only when every check is green on a head
# that holds the main just fetched (0146). A head that lacks main never lands as it is, whatever its
# checks say: main is merged in, the new merge signed as the lead and pushed, and every check waited
# for on that exact head. We only squash. Run it in the background.
#   - each pull request gets its own checkout (BOXES/catchup-<pr>), force-removed when the run ends
#     unless it holds MAIN's Git storage, and one lock is held while it fetches, merges, signs and
#     pushes, so two catch-ups never share a tree or the notes ref. The lock is dropped for each
#     wait on the checks and taken again for the next look at main
#   - a merge of main that conflicts is refused: aborted, nothing pushed, exit 1. The lane merges
#     main and pushes
#   - catching up, merges origin/main in as fabrikalfa[bot] (the person as co-author), and signs
#     only that new merge commit as lead. It never signs a step's commit: an unsigned
#     step commit fails the commits check, and goes back to its own step to sign
#   - pushes notes and branch together, so the push itself starts CI; a branch the bot may not
#     push (a person's) is pushed with the person's gh login, notes by the bot
#   - no auto-merge: it needs check, e2e, next, commits and the tests green on the head it lands
#     (after a catch-up, it waits for them on the pushed sha), then
#     merges with --match-head-commit, so a newer head or a red check stops it (hand PRs only). A PR
#     in a gh stack must merge through the stack API, which takes no head pin: its head is read
#     again first, then `gh stack merge <pr> --squash --yes` lands it. Both land only after the
#     last look at main below, with no override flag (0049)
#   - just before the squash it fetches main once more. When main moved while it waited and the
#     head lacks it, it goes around again: merge main in, sign, push, wait for every check on the
#     new head. Each round prints `pr <n>: main moved to <sha>; merging main in (round <k>)`. After
#     5 rounds a main that moved again ends the run, exit 1, with a line naming what it waited for.
#     A fetch that fails ends it too. No flag skips the look (0146; ticket 552)
#   - prints sizecap.ts's one line, the pull request's product lines, before it waits on the
#     checks. It is advice only: no number caps a pull request (0099), so it never stops a merge
#   - trusts commits only as one pull_request_target run of main's commits.yaml for this ticket
#   - once the squash is on main, closes each ticket the PR description names on a line of its
#     own, `fabrika close ticket <N>`, and prints what it closed (0015)
#   - ends at once on a pull request that is not open and ready: on start and on every round of
#     each wait. `pr <n>: already merged at <sha>` exits 0; closed or draft exits 1. Every wait has
#     a bound and ends with a line naming what it waited for
#   - after a landed merge, kicks one box cleanup sweep (`gcloop.ts kick`, 0101): it starts in the
#     background and the merge's own exit never waits on it
set -eu
usage() { echo "usage: catchup.sh <pr> <ticket>" >&2; exit 1; }
[ "$#" = 2 ] || usage
pr=$1; ticket=$2
. "$(dirname "$0")/env.sh"
W=$BOXES/catchup-$pr; LOCK=$BOXES/catchup.lock; LEAD=$lead_here
AS='-c user.name=fabrikalfa[bot] -c user.email=353269643+fabrikalfa[bot]@users.noreply.github.com'
# Only command failures are retried. Callers inspect successful answers, including red ones. A pull
# request GitHub does not know is no network trouble: it stops at once, never retried.
read_gh() {
	attempt=1
	while :; do
		err=$(mktemp)
		if output=$(gh "$@" 2>"$err"); then rm -f "$err"; printf '%s\n' "$output"; return 0; fi
		failed=$(cat "$err"); rm -f "$err"
		[ -z "$failed" ] || printf '%s\n' "$failed" >&2
		case $failed in
		*"Could not resolve to a PullRequest"*)
			echo "pr $pr: no such pull request in $GH_REPO" >&2
			return 1
			;;
		esac
		if [ "$attempt" -ge 3 ]; then
			echo "pr $pr: gh $* failed after 3 attempts at head ${tip:-unknown}" >&2
			return 1
		fi
		sleep "$attempt"
		attempt=$((attempt + 1))
	done
}
# gate <state> <draft> <merge commit>: only an open pull request that is ready for review goes on.
# Merged is done, so it exits 0; closed, draft or a state we do not know exits 1. Each says one
# line.
gate() {
	case "$1 $2" in
	"OPEN false") return 0 ;;
	"OPEN true") echo "pr $pr: draft, not merged; refused until it is ready for review" >&2; exit 1 ;;
	MERGED\ *) echo "pr $pr: already merged at $3"; exit 0 ;;
	CLOSED\ *) echo "pr $pr: closed, not merged" >&2; exit 1 ;;
	*) echo "pr $pr: in state ${1:-unknown}, not merged; refused" >&2; exit 1 ;;
	esac
}
# look: read the pull request's state again and gate it, inside each wait.
look() {
	standing=$(read_gh pr view "$pr" -R "$GH_REPO" --json state,isDraft,mergeCommit \
		-q '"\(.state) \(.isDraft) \(.mergeCommit.oid // "-")"')
	# Unquoted on purpose: GitHub's state, a boolean and a hex sha, with no glob or space in any.
	gate $standing
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
	# A stack merges asynchronously: give it five minutes to say MERGED, one read a minute.
	for _ in 1 2 3 4 5; do
		landed=$(read_gh pr view "$pr" -R "$GH_REPO" --json state,mergeCommit \
			-q '"\(.state) \(.mergeCommit.oid // "")"') || landed=""
		case $landed in "MERGED "?*) break ;; esac
		sleep 60
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
# A draft's run names its lint job `lint` and its verdict `ci-required (draft)` (check.yaml, 0134's
# amendment): they are not read here. The run that marking ready starts gives this head its `check`,
# which `need` waits for, so a draft's answer never lands a pull request.
checks_at() {
	runs=$(read_gh api "repos/$GH_REPO/commits/$1/check-runs?per_page=100" \
		-q '.check_runs[]|"\(.name)\t\(.status)\t\(.conclusion)\t\(.html_url // "")"') || exit 1
	runs=$(printf '%s\n' "$runs" | awk -F'\t' '$1!="lint" && $1!="ci-required (draft)"')
	# A skipped job keeps its name's expression unevaluated, so on a docs-only change GitHub reports
	# check.yaml's `check` job by its raw text. It counts as `check` only beside the ready run's own
	# `ci-required`, so a draft run's skip never stands in for it.
	runs=$(printf '%s\n' "$runs" | awk -F'\t' -v OFS='\t' '
		{ row[NR]=$0; if ($1=="ci-required") ready=1 }
		END { for (i=1; i<=NR; i++) { $0=row[i]
			if (ready && $3=="skipped" && $1 ~ /^github\.event\.pull_request\.draft && /) $1="check"
			print } }')
	# A red job prints with its link, so nobody has to look it up.
	bad=$(printf '%s\n' "$runs" | awk -F'\t' '$2=="completed" && $3!="success" && $3!="skipped" && $3!="neutral" {
		print $1": "$3 ($4 == "" ? "" : ", " $4) }')
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
mkdir -p "$BOXES"
# take_lock <what the run did so far>: the lock is held for minutes, while one catch-up fetches,
# merges, signs and pushes. A run killed with SIGKILL runs no trap and leaves it behind, so the wait
# has the checks' own bound: an hour.
take_lock() {
	deadline=$(($(date +%s) + 3600))
	until mkdir "$LOCK" 2>/dev/null; do
		[ "$(date +%s)" -lt "$deadline" ] ||
			{ echo "pr $pr: waited an hour for the catch-up lock $LOCK; $1" >&2; exit 1; }
		sleep 5
	done
}
take_lock "nothing done"
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
# The state comes first: a merged, closed or draft pull request ends here, before any fetch or push.
view=$(read_gh pr view "$pr" -R "$GH_REPO" --json headRefName,state,isDraft,mergeCommit \
	-q '"\(.state) \(.isDraft) \(.mergeCommit.oid // "-") \(.headRefName)"')
gate $view
head=${view#* * * }
[ -d "$W" ] || git -C "$MAIN" worktree add -q --detach "$W" origin/main
cd "$W"
git fetch -q origin main "refs/notes/fabrika:refs/notes/fabrika" 2>/dev/null || git fetch -q origin main
git fetch -q origin "pull/$pr/head"
git checkout -q --detach FETCH_HEAD
[ -d node_modules ] || nice -n 15 pnpm install --silent >/dev/null 2>&1
tip=$(git rev-parse HEAD)
# 0146: it lands only when every check is green on a head that holds the main just fetched. Each
# time round: a head that lacks main has main merged in, signed and pushed; every check is waited
# for on that exact head; then main is fetched again. Main that did not move ends the loop, and
# main that moved goes around once more, up to $rounds merges.
rounds=5; round=0; checked=no
while :; do
	if git merge-base --is-ancestor origin/main HEAD; then
		[ "$checked" = no ] || break
	else
		if [ "$round" -ge "$rounds" ]; then
			echo "pr $pr: not merged after $rounds rounds of merging main in: it waited for every check on $tip and main moved again" >&2
			exit 1
		fi
		round=$((round + 1))
		echo "pr $pr: main moved to $(git rev-parse origin/main); merging main in (round $round)"
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
	# One line with the pull request's product lines, which asks about slicing past sizecap.ts's
	# advice number. Advice only: no number caps a pull request (0099), so it never stops a merge.
	if [ "$checked" = no ]; then
		if size=$(node "$LEAD/sizecap.ts" diff origin/main "$tip"); then echo "pr $pr: $size"; else echo "pr $pr: size not counted"; fi
	fi
	# Wait for every check on this exact sha, up to an hour, then for a trusted commits run. The
	# clock is read after every answer and before a green one can break out to the merge. It asks
	# once a minute, two gh calls each time (the state and the check runs): three or four catch-ups
	# asking every 30 seconds used up the account's hourly calls (2026-11-12).
	missing=$need; pending=1; finished=no
	deadline=$(($(date +%s) + 3600))
	for _ in $(seq 60); do
		# Someone may merge or close it while we wait: then nothing here can land it.
		look
		checks_at "$tip"
		[ -z "$bad" ] || { echo "pr $pr: red at $tip: $bad" >&2; exit 1; }
		[ "$(date +%s)" -lt "$deadline" ] || break
		if [ -z "$missing" ] && [ "$pending" = 0 ]; then finished=yes; break; fi
		sleep 60
	done
	if [ "$finished" != yes ]; then
		echo "pr $pr: checks not done at $tip after an hour (missing:${missing:- none}, pending: $pending)" >&2
		exit 1
	fi
	commits_trusted "$tip" || { echo "pr $pr: $why" >&2; exit 1; }
	checked=yes
	# The last look at main (ticket 552, 0146): it may have moved while the checks ran.
	take_lock "not merged"; held=yes
	git fetch -q origin main ||
		{ echo "pr $pr: cannot fetch main for the last look at $tip; not merged" >&2; exit 1; }
done
# The lock stays held through the squash, so no other catch-up takes its last look at main between
# this one's look and its merge (0146).
if ! said=$(gh pr merge "$pr" -R "$GH_REPO" --squash --match-head-commit "$tip" 2>&1); then
	case $said in
	*"part of a stack"*)
		now=$(read_gh pr view "$pr" -R "$GH_REPO" --json headRefOid -q .headRefOid)
		[ "$now" = "$tip" ] || { echo "pr $pr: head moved to $now after the checks at $tip" >&2; exit 1; }
		gh stack merge "$pr" --squash --yes >/dev/null
		;;
	# Merged or closed by someone else since the last look: say that, not a refusal.
	*) look; echo "pr $pr: merge refused: $said" >&2; exit 1 ;;
	esac
fi
rmdir "$LOCK"; held=no
echo "pr $pr: merged at $(git rev-parse --short "$tip"), signed for ticket $ticket"
close_named || echo "pr $pr: closing tickets failed; close them by hand"
# A landed merge stays successful even if cleanup must keep a working copy. The EXIT trap then
# removes the catch-up checkout itself.
if cd "$MAIN"; then
	sweep landed "$pr" "$head" "$tip" "$W" "$LEAD/box.sh" || echo "kept cleanup: inspection failed"
else
	echo "kept cleanup: cannot leave catch-up checkout"
fi
# One box cleanup sweep after each merge (0101). kick returns at once and the sweep runs on, so
# trouble here prints a line and never turns a landed merge red.
node "$LEAD/gcloop.ts" kick --trigger merge || echo "pr $pr: box cleanup not started"
exit 0
