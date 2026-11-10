#!/bin/sh
# box.sh: a Codex agent's own copy of tea-fabrika, whose git data is outside any folder named .git,
# so Codex's sandbox lets it commit. The lead never runs git inside a box; it only fetches from it.
#   box.sh new   <name> <base-ref> <branch> --ticket <n> --plan <path> [--root <lane root>] [--lane <lane>]
#   box.sh run   <name> <prompt-file> <out> --step tests|build|mutation|review
#   box.sh fetch <name> <branch> [--sign <step> --ticket <n>]
#   box.sh gc [--dry-run]                     remove boxes whose work is safe elsewhere (gc.ts says how)
#   box.sh rm    <name>                       remove a clean pair whose commits MAIN retains
# Paths come from env.sh beside this script.
set -eu
. "$(dirname "$0")/env.sh"
if [ "${1:-}" = gc ]; then
	shift
	exec node "$(dirname "$0")/gc.ts" "$@"
fi
if [ "${1:-}" = rm ]; then
	name=${2:-}
	[ "$#" = 2 ] || { echo "usage: box.sh rm <name>" >&2; exit 2; }
	python3 - "$name" <<'PY'
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata

name = sys.argv[1]

def keep(why, code=1):
    print(f"kept box {name}: {why}")
    sys.exit(code)

if not name or name in (".", "..") or any(c in name for c in "/\\") or any(unicodedata.category(c) == "Cc" for c in name):
    # Escape control characters so even a bad name has one result line.
    name = repr(name)
    keep("invalid name", 2)

# Git sees neither inherited settings nor the box's config and hooks.
env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
           GIT_CONFIG_SYSTEM=os.devnull, GIT_ATTR_NOSYSTEM="1",
           GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0",
           GIT_NO_REPLACE_OBJECTS="1", GIT_PAGER="cat", LC_ALL="C")

try:
    boxes = Path(os.environ["BOXES"]).resolve()
    work, data = boxes / name, boxes / f"{name}-gitdata"
    if work.is_symlink() or data.is_symlink():
        keep("symlinked target")
    if not work.exists() and not data.exists():
        print(f"absent box {name}")
        sys.exit(0)
    if not work.is_dir() or not data.is_dir():
        keep("missing or invalid pair")
    main = Path(os.environ["MAIN"]).resolve(strict=True)
    if work.resolve(strict=True).parent != boxes or data.resolve(strict=True).parent != boxes:
        keep("target outside BOXES")
    def holds(root, protected):
        # File identity also catches different path casing on a case-insensitive disk.
        return any(root == parent or (root.exists() and parent.exists() and root.samefile(parent))
                   for parent in (protected, *protected.parents))

    state = boxes / "state"
    if any(holds(root, protected)
           for root in (work, data) for protected in (main, state, state.resolve())):
        keep("pair holds MAIN or saved state")

    def protect_main_storage():
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

        # Read only MAIN's bindings from outside. Never ask the box's Git config.
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
        if any(holds(root, path) for root in (work, data) for path in protected):
            keep("pair holds MAIN Git storage")

    protect_main_storage()

    def plain(path):
        if path.is_symlink() or not path.is_file():
            raise ValueError("missing or unsupported metadata")
        return path.read_bytes()

    pointer = re.fullmatch(rb"gitdir: ([^\x00\r\n]+)\n?", plain(work / ".git"))
    if pointer is None:
        keep("invalid gitdir pointer")
    if (work / pointer[1].decode()).resolve(strict=True) != data:
        keep("gitdir pointer does not name this pair")
    head = plain(data / "HEAD")
    if not re.fullmatch(rb"(?:ref: refs/heads/[^\x00-\x20\x7f]+|[0-9a-f]{40})\n?", head):
        keep("unsupported HEAD")
    for folder in ("refs", "objects"):
        if (data / folder).is_symlink() or not (data / folder).is_dir():
            keep("missing or unsupported metadata")
    if any(os.path.lexists(data / p) for p in ("commondir", "shallow", "info/grafts")) or list(data.glob("sharedindex.*")):
        keep("unsupported shared, shallow or graft metadata")
    # Operation state and linked worktrees can hold commits and staged files outside this index.
    # Unknown metadata also stays: deletion needs proof for every saved state.
    ordinary = {"HEAD", "ORIG_HEAD", "index", "config", "config.worktree", "description",
                "hooks", "info", "logs", "refs", "objects", "packed-refs", "branches",
                "FETCH_HEAD", "COMMIT_EDITMSG"}
    if any(entry.name not in ordinary for entry in data.iterdir()):
        keep("operation, linked worktree or unknown metadata")

    def git(args, inspect=None):
        command = ["git", "-C", str(main)]
        if inspect is not None:
            command += [f"--git-dir={inspect}", f"--work-tree={work}"]
        command += ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
                    "-c", "core.attributesFile=/dev/null", "-c", "core.untrackedCache=false"]
        result = subprocess.run(command + args, env=env, capture_output=True)
        if result.returncode or result.stderr:
            raise ValueError("Git inspection failed")
        return result.stdout

    def unreadable(error):
        raise error

    tips, symbolic = set(), set()
    original = data / "ORIG_HEAD"
    if os.path.lexists(original):
        value = plain(original)
        if not re.fullmatch(rb"[0-9a-f]{40}\n?", value):
            keep("unsupported ORIG_HEAD")
        tips.add(value.strip())
    # Read saved reflogs, including older stashes. Remote reflogs are fetched copies.
    # Do not copy logs or config.
    logs = data / "logs"
    if os.path.lexists(logs):
        if logs.is_symlink() or not logs.is_dir():
            keep("unsupported reflog metadata")
        for folder, dirs, files in os.walk(logs, followlinks=False, onerror=unreadable):
            if any((Path(folder) / entry).is_symlink() for entry in dirs):
                keep("symlinked reflog metadata")
            if Path(folder) == logs / "refs":
                dirs[:] = [entry for entry in dirs if entry != "remotes"]
            for entry in files:
                for line in plain(Path(folder) / entry).splitlines():
                    match = re.fullmatch(rb"([0-9a-f]{40}) ([0-9a-f]{40}) [^\x00\r\n]+", line)
                    if match is None:
                        keep("unsupported reflog entry")
                    tips.update(oid for oid in match.groups() if oid != b"0" * 40)
    # FETCH_HEAD records fetched copies, not saved work.
    fetched = data / "FETCH_HEAD"
    if os.path.lexists(fetched):
        for line in plain(fetched).splitlines():
            match = re.fullmatch(rb"([0-9a-f]{40})\t(?:not-for-merge)?\t[^\x00\r\n]*", line)
            if match is None:
                keep("unsupported fetch metadata")

    # Only small metadata is copied. Object files stay where they are, read through an alternate.
    with tempfile.TemporaryDirectory(prefix="box-inspect-") as temporary:
        inspect = Path(temporary)
        (inspect / "HEAD").write_bytes(head)
        (inspect / "index").write_bytes(plain(data / "index"))
        # Keep Git's original racy-index check. A fresh timestamp could hide a same-size edit.
        stamp = (data / "index").stat()
        os.utime(inspect / "index", ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        (inspect / "config").write_text("[core]\nrepositoryformatversion = 0\nbare = false\n")
        for folder, dirs, files in os.walk(data / "refs", followlinks=False, onerror=unreadable):
            relative = Path(folder).relative_to(data)
            saved = relative.parts[:2] != ("refs", "remotes")
            (inspect / relative).mkdir(parents=True, exist_ok=True)
            for entry in dirs:
                if (Path(folder) / entry).is_symlink():
                    raise ValueError("symlinked ref metadata")
            for entry in files:
                source = Path(folder) / entry
                value = plain(source)
                if re.fullmatch(rb"[0-9a-f]{40}\n?", value):
                    if saved:
                        tips.add(value.strip())
                elif re.fullmatch(rb"ref: refs/[^\x00-\x20\x7f]+\n?", value):
                    if saved:
                        symbolic.add(value[5:].strip().decode())
                else:
                    raise ValueError("unsupported ref metadata")
                (inspect / relative / entry).write_bytes(value)
        packed = data / "packed-refs"
        if packed.exists() or packed.is_symlink():
            value = plain(packed)
            for line in value.splitlines():
                if not line.startswith(b"#") and not re.fullmatch(rb"(?:[0-9a-f]{40} refs/[^\x00-\x20\x7f]+|\^[0-9a-f]{40})", line):
                    raise ValueError("unsupported packed refs")
            (inspect / "packed-refs").write_bytes(value)
        objects = str(data / "objects")
        if "\n" in objects or "\r" in objects:
            keep("unsupported object path")
        (inspect / "objects/info").mkdir(parents=True)
        (inspect / "objects/info/alternates").write_text(objects + "\n")
        entries = git(["ls-files", "--stage", "-v", "-z"], inspect).split(b"\0")
        if any(entry and not entry.startswith(b"H ") for entry in entries):
            keep("unsupported index flags")
        # Status must never enter a submodule and read its own config or hooks.
        if any(entry.startswith(b"H 160000 ") for entry in entries):
            keep("unsupported submodule metadata")
        if git(["status", "--porcelain=v1", "-z", "--untracked-files=no"], inspect):
            keep("tracked changes")
        for line in git(["for-each-ref", "--format=%(refname) %(objectname)"], inspect).splitlines():
            ref, tip = line.split(b" ", 1)
            if ref.startswith(b"refs/remotes/"):
                continue
            tips.add(tip)
            # A replace ref also saves the original object's name in its path.
            if ref.startswith(b"refs/replace/"):
                tips.add(ref[len(b"refs/replace/"):])
        for ref in symbolic | {"HEAD"}:
            tips.update(git(["rev-parse", "--verify", f"{ref}^{{object}}"], inspect).splitlines())
        retained = git(["for-each-ref", "--format=%(objectname)", "refs/heads/", "refs/tags/", "refs/keep/", "refs/stash", "refs/notes/"]).splitlines()
        # Enumerate only MAIN's retained history. Mere object presence and remote refs prove nothing.
        # Keep annotation objects themselves, including signatures and nested tags.
        reachable = set()
        if retained:
            reachable.update(git(["rev-list", "--objects", "--no-object-names",
                                  *[tip.decode() for tip in retained]]).splitlines())
        if any(tip not in reachable for tip in tips):
            keep("tip not retained in MAIN")

    try:
        protect_main_storage()
        shutil.rmtree(work)
    except OSError:
        keep("work removal failed; pair may be partly removed")
    try:
        protect_main_storage()
        shutil.rmtree(data)
    except OSError:
        keep("work removed; git data removal failed and may be partial")
    print(f"removed box {name}")
except (OSError, ValueError, RuntimeError) as error:
    keep(str(error) if type(error) is ValueError else "inspection or removal failed")
PY
	exit "$?"
fi
here=$(cd "$(dirname "$0")" && pwd -P)
exec python3 - "$here" "$@" <<'PY'
import contextlib, datetime, fcntl, hashlib, json, os, pathlib, re, signal, subprocess, sys, tempfile, uuid
here = pathlib.Path(sys.argv[1])
main, boxes = pathlib.Path(os.environ["MAIN"]), pathlib.Path(os.environ["BOXES"])
args = sys.argv[2:]
def refuse(why):
    print("stuck " + why, file=sys.stderr); raise SystemExit(1)
if len(args) < 2: refuse("box command and name required")
cmd, name, *args = args
if not re.fullmatch(r"[A-Za-z0-9_-]+", name): refuse("invalid box name")
work, gitdata = boxes / name, boxes / (name + "-gitdata")
state_dir = boxes / "state"; state_dir.mkdir(parents=True, exist_ok=True)
state_path = state_dir / (name + ".box")
def call(argv, **kw):
    return subprocess.run(argv, cwd=main, capture_output=True, **kw)
def git(*argv, **kw):
    return call(["git", "-C", str(main), "-c", "core.hooksPath=/dev/null", *argv], **kw)
def must(result, why):
    if result.returncode: refuse(why)
    return result.stdout.decode().strip()
def rev(ref): return must(git("rev-parse", "--verify", ref), "unknown ref " + ref)
def ancestor(a, b): return git("merge-base", "--is-ancestor", a, b).returncode == 0
def facts(path):
    return dict(l.split(": ", 1) for l in path.read_text().splitlines() if ": " in l)
def save(state):
    tmp = state_path.with_suffix(".tmp")
    tmp.write_text("".join(f"{k}: {v}\n" for k, v in state.items())); tmp.replace(state_path)
def flag(option, default=None):
    if option not in args: return default
    i = args.index(option)
    if i + 1 >= len(args): refuse("missing " + option)
    return args[i+1]
@contextlib.contextmanager
def lock(label):
    with open(state_dir / (label + ".lock"), "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX); yield
def read_note(sha, ref="fabrika"):
    got = git("notes", "--ref=" + ref, "show", sha)
    if got.returncode: return None
    try:
        note = json.loads(got.stdout)
        return note if isinstance(note, dict) else {}
    except (ValueError, UnicodeError): return {}
def keys(): return must(git("show", "origin/main:allowed_signers"), "base_not_signed: no allowed signers")
def verified(sha, role):
    note = read_note(sha)
    if not isinstance(note, dict) or note.get("step") != role: return False
    if note.get("_tag") != "attested" or not isinstance(note.get("key"), str) or not isinstance(note.get("sig"), str): return False
    if not isinstance(note.get("ticket"), str) or not re.fullmatch(r"[0-9]+", note["ticket"]): return False
    if type(note.get("version")) is not int or note["version"] <= 0: return False
    if note.get("from") != rev(sha + "^1^{tree}") or note.get("to") != rev(sha + "^{tree}"): return False
    if not all(k in note for k in ("ticket", "version", "sig")): return False
    text = "fabrika-step attested v2\n" + "".join(f"{k} {note[k]}\n" for k in ("step", "ticket", "version", "from", "to"))
    with tempfile.TemporaryDirectory(prefix="boxverify-") as tmp:
        allowed, sig = pathlib.Path(tmp) / "allowed", pathlib.Path(tmp) / "sig"
        allowed.write_text(keys()); sig.write_text(note["sig"])
        checked = call(["ssh-keygen", "-Y", "verify", "-f", str(allowed), "-I", role, "-n", "fabrika-step", "-s", str(sig)], input=text.encode())
        used = re.search(r" key (SHA256:[A-Za-z0-9+/=]+)\s*$", checked.stdout.decode())
        return checked.returncode == 0 and used is not None and used[1] == note["key"]
def person(sha):
    people = "\n".join(l for l in keys().splitlines() if l.startswith("person:")) + "\n"
    with tempfile.TemporaryDirectory(prefix="boxperson-") as tmp:
        allowed = pathlib.Path(tmp) / "allowed"; allowed.write_text(people)
        return git("-c", "gpg.format=ssh", "-c", "gpg.ssh.program=ssh-keygen", "-c", "gpg.ssh.allowedSignersFile=" + str(allowed), "verify-commit", sha).returncode == 0
def commits(base, head):
    return must(git("rev-list", "--topo-order", "--reverse", base + ".." + head), "base commit walk failed").splitlines()
def plan_owners(state):
    data = pathlib.Path(state["plan"]).read_bytes().split(b"\n", 2)
    if len(data) < 3 or hashlib.sha256(data[2]).hexdigest() != state["plan-sha256"]: refuse("plan approval body hash mismatch")
    if not re.fullmatch(rb"Approved by the lead agent, builds \S(?:.*\S)?; body " + state["plan-sha256"][:12].encode(), data[0]): refuse("plan approval line mismatch")
    result = call(["sh", str(here / "../../plan/scripts/plancheck.sh"), "--owners-json", state["plan"]])
    if result.returncode: refuse("not_owner: plan cannot be read")
    return json.loads(result.stdout)
def fetched_head(branch):
    # Even start/end reads go through MAIN's fetch. No Git command runs in work.
    target = "refs/box-reads/" + uuid.uuid4().hex
    must(git("fetch", "-q", str(work), "refs/heads/" + branch + ":" + target), "run head fetch failed")
    head = rev(target); git("update-ref", "-d", target)
    return head
def rows(state=None):
    # The box's own rows, and the lane's, where drive writes each step's row (BOXES/<lane>-rows.jsonl).
    lane = (state or {}).get("lane")
    paths = [state_dir / (name + ".rows.jsonl")] + ([boxes / (lane + "-rows.jsonl")] if lane else [])
    return [json.loads(l) for p in paths if p.exists() for l in p.read_text().splitlines() if l]
def new_box():
    if len(args) < 2: refuse("new needs base and branch")
    base, branch = args[:2]; ticket, plan, root, lane = flag("--ticket"), flag("--plan"), flag("--root"), flag("--lane")
    if lane is not None and not re.fullmatch(r"[A-Za-z0-9_-]+", lane): refuse("invalid lane name")
    if not branch.startswith("fabrikalfa/"): refuse("branch prefix must be fabrikalfa/")
    if not ticket or not plan: refuse("plan and ticket required")
    plan = str(pathlib.Path(plan).absolute())
    checked = call(["sh", str(here / "../../plan/scripts/plancheck.sh"), "--approved", plan])
    if checked.returncode: refuse("plan_unapproved: " + checked.stdout.decode().strip())
    digest = hashlib.sha256(pathlib.Path(plan).read_bytes().split(b"\n", 2)[2]).hexdigest()
    must(git("fetch", "-q", "origin"), "base fetch failed")
    head, parent = rev(base), "none"
    root_sha = rev(root) if root else head
    if not ancestor(root_sha, head): refuse("root is not an ancestor of the base")
    # A lane that starts one box per step continues its own branch: that head is a valid base too.
    own = any(git("rev-parse", "-q", "--verify", r + "^{commit}").stdout.decode().strip() == head for r in ("refs/heads/" + branch, "refs/remotes/origin/" + branch))
    if head != rev("origin/main") and not own:
        # A lead commit (a merge of main, a lockfile commit) is signed and checked like a step's, so
        # it is a base too (layers and themes, 2026-11-09: a lead commit left both lanes stuck).
        if not (verified(head, "build") or verified(head, "lead")): refuse("base_not_signed: verified build or lead head required")
        branches = must(git("for-each-ref", "--format=%(refname:short)", "--points-at=" + head, "refs/heads/fabrikalfa/", "refs/remotes/origin/fabrikalfa/"), "parent lookup failed").splitlines()
        if not branches: refuse("base_not_signed: no parent branch at head")
        parent = branches[0] + "@" + head
    # Two live lanes must not write one ticket. A branch that shares the ticket blocks only while it
    # is live: an open PR, or a box on disk whose state names it. A branch the base already holds,
    # or one with no open PR and no box, is history (an old or merged lane) and does not block.
    open_heads = [None]
    def live(other):
        lane = other.removeprefix("origin/").removesuffix("-wip")
        if open_heads[0] is None:
            got = call(["gh", "pr", "list", "--state", "open", "--limit", "500", "--json", "headRefName", "-q", ".[].headRefName"])
            if got.returncode: refuse("shared_ticket " + ticket + " on " + other + ": open PRs cannot be read")
            open_heads[0] = set(got.stdout.decode().split())
        if lane in open_heads[0]: return True
        return any(facts(p).get("branch") == lane and (boxes / p.stem).is_dir() for p in state_dir.glob("*.box") if p.stem != name)
    # A branch whose change is only field/*.jsonl rows is the lead logging runs, not a lane writing
    # the ticket (field-rows PR 601 on ticket 276, 2026-11-09). Judged by its paths, not its name,
    # from where it left main: a lane base on an older main would count main's newer files as its.
    def rows_only(other):
        changed = must(git("diff", "--name-only", "--no-renames", "origin/main..." + other), "branch paths unreadable").splitlines()
        return bool(changed) and all(re.fullmatch(r"field/[^/]+\.jsonl", p) for p in changed)
    for other in must(git("for-each-ref", "--format=%(refname:short)", "refs/heads/", "refs/remotes/origin/"), "branch lookup failed").splitlines():
        # The branch itself and its own backup copy (<branch>-wip) are not other branches.
        if other in (branch, "origin/" + branch, branch + "-wip", "origin/" + branch + "-wip", "main", "origin/main", "origin/HEAD"): continue
        # Only links this lane's base lacks: an older branch of the same lane, already merged into
        # the base, is history, not another lane holding the ticket.
        if any(isinstance(n, dict) and n.get("ticket") == ticket for n in map(read_note, commits(head, other))) and not rows_only(other) and live(other):
            refuse("shared_ticket " + ticket + " on " + other)
    must(git("clone", "-q", "--no-checkout", "--reference", str(main), "--separate-git-dir=" + str(gitdata), os.environ["REMOTE"], str(work)), "box clone failed")
    edge = ["--git-dir=" + str(gitdata), "--work-tree=" + str(work)]
    must(git(*edge, "fetch", "-q", str(main), head + ":refs/heads/" + branch), "box base fetch failed")
    must(git(*edge, "checkout", "-q", branch), "box checkout failed")
    # An absent notes ref is fine. Any existing note is copied as one immutable JSON value.
    if git("rev-parse", "--verify", "refs/notes/fabrika").returncode == 0:
        must(git(*edge, "fetch", "-q", str(main), "refs/notes/fabrika:refs/notes/fabrika"), "box notes fetch failed")
    installed = subprocess.run(["nice", "-n", "15", "pnpm", "install", "--silent"], cwd=work, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if installed.returncode: refuse("box install failed")
    facts_new = {"ticket": ticket, "branch": branch, "base": head, "parent": parent, "children": "none", "plan": plan, "plan-sha256": digest}
    # The lane's root: where it left main. Order and the commits check read the whole lane from
    # here, so a later step's box still sees the earlier steps' links.
    if root: facts_new["root"] = root_sha
    if lane: facts_new["lane"] = lane
    save(facts_new)
    if parent != "none":
        for path in state_dir.glob("*.box"):
            state = facts(path)
            if state.get("branch") == parent.split("@")[0]:
                children = [] if state.get("children", "none") == "none" else state["children"].split(", ")
                state["children"] = ", ".join(dict.fromkeys([*children, branch]))
                path.write_text("".join(f"{k}: {v}\n" for k, v in state.items()))
    print("box created " + name + " on " + branch)
def run_box():
    if len(args) < 2: refuse("run needs prompt and answer paths")
    prompt, out = map(lambda p: str(pathlib.Path(p).absolute()), args[:2])
    state = facts(state_path); step = flag("--step"); ticket = flag("--ticket", state["ticket"])
    if step not in ("tests", "build", "mutation", "review"): refuse("run step required")
    if ticket != state["ticket"]: refuse("run ticket mismatch")
    plan_owners(state)  # the approval and body hash, checked again before every step
    if step == "build" and not any(verified(sha, "tests") for sha in commits(state.get("root", state["base"]), state["branch"])):
        refuse("step_out_of_order: verified tests since base required")
    if step == "review" and not any(r.get("step", r.get("role")) == "mutation" and str(r.get("ticket")) == ticket and r.get("outcome") in ("done", "skip", "pass") for r in rows(state)):
        refuse("step_out_of_order: mutation row or skip required")
    pid = state_dir / (name + ".pid")
    with lock("slots"):
        live = []
        for p in state_dir.glob("*.pid"):
            try: os.kill(int(p.read_text().strip()), 0); live.append(p)
            except (ProcessLookupError, ValueError): p.unlink(missing_ok=True)
            except PermissionError: live.append(p)
        if pid in live or len(live) >= 8: refuse("running slot limit")
        pid.write_text(str(os.getpid()) + "\n")
    run = name + "-" + step + "-" + uuid.uuid4().hex
    started = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    status, interrupted, runner = 1, [None], [None]
    def stop(sig, frame):
        interrupted[0] = sig
        if runner[0] and runner[0].poll() is None: runner[0].send_signal(sig)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP): signal.signal(sig, stop)
    events = state_dir / (run + ".jsonl")
    try:
        start = fetched_head(state["branch"])
        for key in ("run-end", "run-status", "fetched-head"): state.pop(key, None)
        state.update({"run": run, "run-step": step, "run-ticket": ticket, "run-start": start, "run-started": started})
        save(state)
        command = ["sh", str(here / "redact.sh"), "--run", str(work), prompt, out, str(events), "nice", "-n", "15", "codex", "exec", "--ignore-user-config", "-m", os.environ["CODEX_MODEL"], "-c", "model_reasoning_effort=" + os.environ["CODEX_EFFORT"], "-s", "workspace-write", "-c", "sandbox_workspace_write.writable_roots=" + json.dumps([str(work), str(work / ".agents"), str(gitdata)]), "-C", str(work), "--json", "-o", out, "-"]
        runner[0] = subprocess.Popen(command, cwd=main)
        code = runner[0].wait(); status = 128 - code if code < 0 else code
        if interrupted[0]: status = 128 + interrupted[0]
    finally:
        try:
            try: state["run-end"] = fetched_head(state["branch"])
            except SystemExit:
                status = status or 1
                state["run-end"] = "unknown"
            state["run-status"] = str(status); save(state)
            if not pathlib.Path(str(events) + ".redacted").exists():
                # redact.sh was killed before its own scrub: scrub here, or remove the outputs.
                scrubbed = call(["sh", str(here / "redact.sh"), out, str(events)])
                if scrubbed.returncode:
                    for left in (pathlib.Path(out), events): left.unlink(missing_ok=True)
                    status = status or 1
            ended = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
            row = call([sys.executable, str(here / "fieldrow.py"), "--step", step, "--started", started, "--ended", ended, "--start", state.get("run-start", state["base"]), "--end", state["run-end"], "--status", str(status), str(events), run, ticket, "done" if status == 0 else "stuck", "runner exit " + str(status)])
            if row.returncode:
                status = status or 1
                print("stuck run_row_failed", file=sys.stderr)
            elif not any(r.get("run") == run for r in rows()):
                with open(state_dir / (name + ".rows.jsonl"), "ab") as f: f.write(row.stdout)
            if events.exists() and pathlib.Path(str(events) + ".redacted").exists(): sys.stdout.write(events.read_text())
        finally: pid.unlink(missing_ok=True)
    return status
def fetch_box():
    if not args: refuse("fetch branch required")
    branch, state = args[0], facts(state_path)
    step, ticket = flag("--sign"), flag("--ticket")
    if branch != state["branch"]: refuse("run branch mismatch")
    with lock("notes"):
        fetched = git("fetch", "-q", str(work), "refs/heads/" + branch + ":refs/heads/" + branch)
        if fetched.returncode: refuse("rewrite: non-fast-forward fetch rejected")
        head = rev(branch)
        if not ancestor(state["base"], head): refuse("base is not an ancestor")
        chain = commits(state["base"], head)
        incoming = "refs/notes/box-" + name + "-" + uuid.uuid4().hex
        has_notes = git("ls-remote", "--exit-code", str(work), "refs/notes/fabrika")
        if has_notes.returncode == 0:
            must(git("fetch", "-q", str(work), "refs/notes/fabrika:" + incoming), "notes fetch failed")
            try:
                # Check every note before copying any, so a conflict leaves MAIN's notes as they were.
                # Notes are copied one by one, never merged as a ref: a note the box deleted stays in
                # MAIN, and a commit MAIN already links is never linked again. Only the run's own
                # commits are read: the rest of the box's notes are MAIN's copy from box start, and
                # MAIN may have re-signed one since (themes and layers tests, 2026-11-09).
                copies, own = [], set(chain)
                for line in must(git("notes", "--ref=" + incoming, "list"), "notes list failed").splitlines():
                    blob, sha = line.split()
                    if sha not in own: continue
                    current = git("notes", "--ref=fabrika", "show", sha)
                    if current.returncode != 0: copies.append((blob, sha))
                    elif current.stdout != git("cat-file", "blob", blob).stdout: refuse("note conflict " + sha)
                for blob, sha in copies:
                    must(git("notes", "--ref=fabrika", "add", "-C", blob, sha), "note copy failed " + sha)
            finally: git("update-ref", "-d", incoming)
        elif has_notes.returncode != 2: refuse("notes read failed")
        if step:
            if step not in ("tests", "build", "mutation", "review") or ticket != state.get("ticket") or step != state.get("run-step") or ticket != state.get("run-ticket"):
                refuse("run step or ticket mismatch")
            start, end = state.get("run-start"), state.get("run-end")
            if not start or not end or not ancestor(start, end) or not ancestor(end, head): refuse("run bounds missing or invalid")
            bounded = set(commits(start, end)); owners = plan_owners(state)
            candidates = []
            for sha in chain:
                if read_note(sha) is not None or person(sha): continue
                if step == "review": refuse("review makes no commits " + sha)
                if sha not in bounded: refuse("unsigned commit outside recorded run " + sha)
                changed = git("diff", "--name-only", "--no-renames", "-z", sha + "^1", sha)
                if changed.returncode: refuse("paths unreadable " + sha)
                paths = [p for p in changed.stdout.decode().split("\0") if p]
                exam = call([sys.executable, str(here / "../../step-commit/scripts/exam.py"), str(main / "exam-paths.json"), *paths])
                if exam.returncode not in (0, 1): refuse("exam list unreadable")
                if step == "build" and exam.returncode: refuse("build exam paths " + sha)
                for p in paths:
                    if owners.get(p) != step and not (step == "mutation" and owners.get(p) == "tests"): refuse("not_owner " + p + " in " + sha[:8])
                candidates.append(sha)
            # All candidates pass before any note is made. HEAD and index belong to a private gitdir.
            common = must(git("rev-parse", "--path-format=absolute", "--git-common-dir"), "gitdir lookup failed")
            with tempfile.TemporaryDirectory(prefix="boxsign-") as tmp:
                private = pathlib.Path(tmp)
                (private / "commondir").write_text(common + "\n")
                role = "tests" if step == "mutation" else step
                for sha in candidates:
                    (private / "HEAD").write_text(sha + "\n")
                    env = dict(os.environ, GIT_DIR=tmp, GIT_WORK_TREE=str(main), GIT_INDEX_FILE=str(private / "index"))
                    signed = call(["pnpm", "commits", "sign", "--step", role, "--ticket", ticket, "--key", str(pathlib.Path.home() / ".fabrika/step-keys" / role)], env=env)
                    if signed.returncode: refuse("sign failed " + sha)
            state["fetched-head"] = head; save(state)
        lane_root = state.get("root", state["base"])
        # A lead merge of main brings main's own commits into root..head, and the checker calls each
        # one unsigned (layers tests10, 2026-11-09). Start at the merge-base with origin/main when it
        # holds the root, so only the lane's commits are judged; a root off main keeps its root.
        joined = must(git("merge-base", head, "origin/main"), "merge-base with origin/main failed")
        if ancestor(lane_root, joined): lane_root = joined
        checked = call(["pnpm", "commits", "check", "--base", lane_root, "--head", head])
        # A stale link is judged here only for a step the lane itself has signed. A step the lane
        # has not reached yet (lead, before catch-up) may hold a newer link from an older PR on the
        # same ticket; CI judges that on the PR (themes tests, 2026-11-09: PR 565's lead link).
        lane_steps = {n.get("step") for n in map(read_note, commits(lane_root, head)) if isinstance(n, dict)}
        answers, unreadable, waived = [], 0, 0
        for l in checked.stdout.splitlines():
            if not l.strip(): continue
            try: a = json.loads(l)
            except (ValueError, UnicodeError): a = None
            if isinstance(a, dict) and a.get("_tag") in ("done", "stuck", "ask", "send", "skip"):
                if a["_tag"] == "stuck" and a.get("why") == "stale_link" and a.get("step") not in lane_steps:
                    waived += 1; print(json.dumps({**a, "_tag": "skip", "why": "stale_link_outside_lane"})); continue
                answers.append(a); print(json.dumps(a))
            else: unreadable += 1
        # The checker skips paths outside its scope; every run commit still needs a valid link.
        for sha in chain:
            note = read_note(sha)
            if person(sha): continue
            if not isinstance(note, dict) or not isinstance(note.get("step"), str) or not verified(sha, note["step"]):
                print(json.dumps({"_tag": "stuck", "why": "unlinked_commit", "commit": sha}))
                answers.append({"_tag": "stuck", "why": "unlinked_commit", "commit": sha})
        if unreadable or not (answers or waived): refuse("commits check unreadable output")
        # The checker exits 1 for any stuck answer; when every stuck it gave was waived, that exit is
        # explained. Any other failing exit still refuses.
        if (checked.returncode and not (checked.returncode == 1 and waived)) or any(a["_tag"] == "stuck" for a in answers):
            # Name each rule and commit that held it, so the lead sends the step to the right place
            # (ticket 429: 18 fetches on 2026-11-09 said only "commits check failed").
            def said(a):
                sha = a.get("sha") or a.get("commit") or ""
                step = " step " + a["step"] if isinstance(a.get("step"), str) else ""
                paths = " " + " ".join(map(str, a["paths"][:3])) if isinstance(a.get("paths"), list) and a["paths"] else ""
                return str(a.get("why") or a["_tag"]) + (" " + str(sha)[:8] if sha else "") + step + paths
            held = [said(a) for a in answers if a["_tag"] == "stuck"]
            refuse("commits check failed: " + ("; ".join(held[:5]) + (f"; and {len(held) - 5} more" if len(held) > 5 else "") if held else "exit " + str(checked.returncode)))
    return 0
try:
    if cmd == "new": new_box(); status = 0
    elif cmd == "run": status = run_box()
    elif cmd == "fetch": status = fetch_box()
    else: refuse("unknown box command")
    sys.exit(status)
except (OSError, ValueError, KeyError) as error:
    refuse("box facts unreadable: " + type(error).__name__)
PY
