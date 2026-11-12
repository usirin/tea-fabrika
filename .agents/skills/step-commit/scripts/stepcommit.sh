#!/bin/sh
# stepcommit.sh [--commit-only] <step> <ticket> <subject> <file>...
# The unsigned route is for boxes; MAIN signs the saved run at fetch.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
exec python3 - "$here" "$@" <<'PY'
import hashlib, json, os, pathlib, re, subprocess, sys, tempfile
here = pathlib.Path(sys.argv[1])
args = sys.argv[2:]
only = bool(args and args[0] == "--commit-only")
if only: args.pop(0)
def refuse(why, code=1):
    print("stepcommit: " + why, file=sys.stderr); sys.exit(code)
if len(args) < 4: refuse("name step, ticket, subject and named paths", 2)
step, ticket, subject, *paths = args
if step not in ("tests", "build", "mutation", "lead"): refuse("unknown step " + step, 2)
role = "tests" if step == "mutation" else step
def git(*args, **kw):
    return subprocess.run(["git", *args], capture_output=True, **kw)
if git("diff", "--cached", "--quiet").returncode:
    refuse("the index already holds staged changes; commit only your own paths", 4)
root = pathlib.Path(git("rev-parse", "--show-toplevel").stdout.decode().strip())
named = []
for p in paths:
    n = os.path.normpath(p)
    if p.startswith("-") or n in (".", "..") or n.startswith("../") or os.path.isabs(p) or (root / n).is_dir() or p.endswith("/"):
        refuse("named file paths required, no folders: " + p)
    # A folder whose files were all deleted is gone from disk; git still knows it as a folder.
    if git("ls-files", "--cached", "--", n + "/").stdout or git("ls-tree", "-r", "--name-only", "HEAD", "--", n + "/").stdout:
        refuse("named file paths required, no folders: " + p)
    named.append(n)
branch = git("branch", "--show-current").stdout.decode().strip()
# A lead link for a ticket whose open PR is on another branch becomes that ticket's newest lead
# link, outside that PR's chain, so the commits check reads the PR's own lead links as stale_link
# (staleSteps in next/apps/fabrika/src/exam/commits.ts; PRs 609, 614, 615 and 617). The PR's
# ticket is any note on its commits, signed or not: a refusal here only asks for another ticket.
if step == "lead" and not only:
    lane = branch.removesuffix("-wip")
    # gh pr list --json commits asks for every author too, which GitHub refuses as too big.
    query = "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:100){totalCount nodes{number headRefName commits(first:250){totalCount nodes{commit{oid}}}}}}}"
    cannot = "open PRs cannot be read, so a lead link cannot be checked: "
    try: listed = subprocess.run(["gh", "api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", "query=" + query], capture_output=True, text=True)
    except OSError as e: refuse(cannot + str(e), 5)
    if listed.returncode: refuse(cannot + listed.stderr.strip(), 5)
    try: prs = json.loads(listed.stdout)["data"]["repository"]["pullRequests"]
    except (ValueError, KeyError, TypeError): refuse(cannot + "unexpected answer", 5)
    if prs["totalCount"] > len(prs["nodes"]) or any(pr["commits"]["totalCount"] > len(pr["commits"]["nodes"]) for pr in prs["nodes"]):
        refuse(cannot + "more open PRs or commits than one read holds", 5)
    notes = dict(reversed(l.split()) for l in git("notes", "--ref=fabrika", "list").stdout.decode().splitlines() if len(l.split()) == 2)
    def ticket_of(sha):
        if sha not in notes: return None
        try: note = json.loads(git("cat-file", "blob", notes[sha]).stdout)
        except ValueError: return None
        return note.get("ticket") if isinstance(note, dict) else None
    for pr in prs["nodes"]:
        other = pr["headRefName"].removesuffix("-wip")
        if other != lane and any(ticket_of(c["commit"]["oid"]) == ticket for c in pr["commits"]["nodes"]):
            refuse(f"stale_link: ticket {ticket}'s open PR {pr['number']} is on {pr['headRefName']}; a lead link here would make that PR's lead links stale. Sign under a lead ticket of your own instead.", 5)
# A box tree sits in BOXES/box (lead/scripts/lane.ts boxTree); a sign worktree, and an older tree, in BOXES.
boxes = pathlib.Path(os.environ.get("BOXES", str(root.parent.parent if root.parent.name == "box" else root.parent)))
def facts(path):
    return dict(l.split(": ", 1) for l in path.read_text().splitlines() if ": " in l)
# The box this runs in: STEPCOMMIT_BOX (drive's detached sign worktree), else the checkout's own
# folder. Only outside a box, a live box on the branch (its folder still there); never a stale file.
named_box = os.environ.get("STEPCOMMIT_BOX")
own = boxes / "state" / ((named_box or root.name) + ".box")
state = None
if named_box and not own.exists(): refuse("not_owner: no facts for box " + named_box)
if own.exists():
    state = facts(own)
    if not named_box and state.get("branch") != branch: refuse("not_owner: branch differs from box")
else:
    for path in sorted((boxes / "state").glob("*.box")):
        found = facts(path)
        if found.get("branch") == branch and any((d / path.stem).is_dir() for d in (boxes / "box", boxes)): state = found; break
owners = None
if state:
    if state.get("ticket") != ticket: refuse("not_owner: ticket differs from box")
    data = pathlib.Path(state["plan"]).read_bytes().split(b"\n", 2)
    if len(data) < 3 or hashlib.sha256(data[2]).hexdigest() != state.get("plan-sha256"):
        refuse("plan approval body hash mismatch")
    if not re.fullmatch(rb"Approved by the lead agent, builds \S(?:.*\S)?; body " + state["plan-sha256"][:12].encode(), data[0]):
        refuse("plan approval line mismatch")
    read = subprocess.run(["sh", str(here / "../../plan/scripts/plancheck.sh"), "--owners-json", state["plan"]], capture_output=True, text=True)
    if read.returncode: refuse("not_owner: cannot read plan")
    owners = json.loads(read.stdout)
def owner_of(p):
    # A row ending in / owns every path under it; a plain prefix (owned.ts, owned.tsx) does not.
    if p in owners: return owners[p]
    if any(part in ("", ".", "..") for part in p.split("/")): return None
    under = [k for k in owners if k.endswith("/") and p.startswith(k)]
    return owners[max(under, key=len)] if under else None
def unlisted_exam(paths):
    # The exam is the test writer's (docs/direction/nobody-writes-their-own-exam.md), so a tests
    # commit may hold an exam path the plan gives to no step. The list is the box base's, never the
    # checkout's, so a step cannot widen the exam to take a path. exam.py prints "path<TAB>glob" per
    # hit and exits 1; any other answer allows nothing.
    unlisted = [p for p in paths if owner_of(p) is None]
    if step != "tests" or not unlisted: return set()
    listed = git("show", state.get("base", "") + ":exam-paths.json")
    if listed.returncode: return set()
    with tempfile.NamedTemporaryFile(suffix=".json") as exam_list:
        exam_list.write(listed.stdout); exam_list.flush()
        exam = subprocess.run([sys.executable, str(here / "exam.py"), exam_list.name, *unlisted], capture_output=True, text=True)
    if exam.returncode != 1: return set()
    return {l.rsplit("\t", 1)[0] for l in exam.stdout.splitlines() if "\t" in l}
def check(paths):
    if role == "build":
        exam = subprocess.run([sys.executable, str(here / "exam.py"), "exam-paths.json", *paths], capture_output=True)
        if exam.returncode: refuse("a build may not commit exam paths; answer send to tests", 3)
    if owners is not None:
        exam = unlisted_exam(paths)
        for p in paths:
            if owner_of(p) != step and not (step == "mutation" and owner_of(p) == "tests") and p not in exam:
                refuse("not_owner: " + p)
check(named)
# A case-only rename on a disk that ignores case (id.ts to Id.ts): git keeps the index's old name
# and stages nothing new under the new one, so the old entry goes first. Only a tracked path that
# differs from a named one by case alone, and is not itself named, is dropped (ticket 573).
tracked = [t for t in git("ls-files", "--cached", "-z").stdout.decode().split("\0") if t]
exact = set(tracked)
for n in named:
    if n in exact: continue
    for t in tracked:
        if t != n and t.lower() == n.lower() and t not in named:
            if git("--literal-pathspecs", "rm", "--cached", "-q", "--", t).returncode: refuse("case rename could not be staged: " + t)
added = git("--literal-pathspecs", "add", "--", *named)
if added.returncode: refuse("named path could not be staged")
# --no-renames lists both sides as add/delete, including a removed exam path.
staged = [p for p in git("diff", "--cached", "--name-only", "--no-renames", "-z").stdout.decode().split("\0") if p]
try:
    check(staged)
    # Check the index's bytes, not the working tree: a clean filter can change them.
    with tempfile.TemporaryDirectory(prefix="stepfmt-") as tmp:
        tmp = str(pathlib.Path(tmp).resolve())
        config = root / ".oxfmtrc.json"
        config_args = []
        if config.exists():
            pinned = pathlib.Path(tmp) / ".stepfmt-config.json"
            pinned.write_bytes(config.read_bytes())
            config_args = ["--config", str(pinned)]
        files = []
        for p in staged:
            blob = git("show", ":" + p)
            if blob.returncode: continue
            target = pathlib.Path(tmp) / p
            target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(blob.stdout)
            files.append(str(target))
        # Keep the pinned config beside the staged copy, so exclusions have the same relative
        # paths as the checkout. Nested config is still disabled.
        env = dict(os.environ, PATH=str(root / "node_modules/.bin") + os.pathsep + os.environ["PATH"])
        if files and subprocess.run(["pnpm", "exec", "oxfmt", "--check", "--disable-nested-config", "--no-error-on-unmatched-pattern", *config_args, *files], cwd=tmp, env=env, capture_output=True).returncode:
            refuse("not_formatted: staged files need formatting")
except SystemExit:
    git("--literal-pathspecs", "restore", "--staged", "--", *staged)
    raise
coauthor = os.environ.get("FABRIKA_COAUTHOR")
if not coauthor:
    name = git("config", "--global", "user.name").stdout.decode().strip()
    email = git("config", "--global", "user.email").stdout.decode().strip()
    coauthor = f"{name} <{email}>"
commit = subprocess.run(["git", "-c", "user.name=fabrikalfa[bot]", "-c", "user.email=353269643+fabrikalfa[bot]@users.noreply.github.com", "commit", "-q", "-m", subject, "-m", "Co-authored-by: " + coauthor])
if commit.returncode: sys.exit(commit.returncode)
if not only:
    # STEPCOMMIT_SIGNER: drive.ts names main's own signer when the tree holds an agent's edits.
    signer = os.environ.get("STEPCOMMIT_SIGNER", "pnpm commits").split()
    signed = subprocess.run([*signer, "sign", "--step", role, "--ticket", ticket, "--key", str(pathlib.Path.home() / ".fabrika/step-keys" / role)])
    if signed.returncode: sys.exit(signed.returncode)
subprocess.run(["git", "log", "--oneline", "-1"])
PY
