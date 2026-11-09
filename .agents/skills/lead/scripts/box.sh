#!/bin/sh
# box.sh: a Codex agent's own copy of tea-fabrika, whose git data is outside any folder named .git,
# so Codex's sandbox lets it commit. The lead never runs git inside a box; it only fetches from it.
#   box.sh new   <name> <base-ref> <branch> --ticket <n> --plan <path>
#   box.sh run   <name> <prompt-file> <out> --step tests|build|mutation|review
#   box.sh fetch <name> <branch> [--sign <step> --ticket <n>]
# Paths come from env.sh beside this script.
set -eu
. "$(dirname "$0")/env.sh"
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
def rows():
    path = state_dir / (name + ".rows.jsonl")
    return [json.loads(l) for l in path.read_text().splitlines() if l] if path.exists() else []
def new_box():
    if len(args) < 2: refuse("new needs base and branch")
    base, branch = args[:2]; ticket, plan = flag("--ticket"), flag("--plan")
    if not branch.startswith("fabrikalfa/"): refuse("branch prefix must be fabrikalfa/")
    if not ticket or not plan: refuse("plan and ticket required")
    plan = str(pathlib.Path(plan).absolute())
    checked = call(["sh", str(here / "../../plan/scripts/plancheck.sh"), "--approved", plan])
    if checked.returncode: refuse("plan_unapproved: " + checked.stdout.decode().strip())
    digest = hashlib.sha256(pathlib.Path(plan).read_bytes().split(b"\n", 2)[2]).hexdigest()
    must(git("fetch", "-q", "origin"), "base fetch failed")
    head, parent = rev(base), "none"
    if head != rev("origin/main"):
        if not verified(head, "build"): refuse("base_not_signed: verified build head required")
        branches = must(git("for-each-ref", "--format=%(refname:short)", "--points-at=" + head, "refs/heads/fabrikalfa/"), "parent lookup failed").splitlines()
        if not branches: refuse("base_not_signed: no parent branch at head")
        parent = branches[0] + "@" + head
    for other in must(git("for-each-ref", "--format=%(refname:short)", "refs/heads/", "refs/remotes/origin/"), "branch lookup failed").splitlines():
        if other in (branch, "origin/" + branch, "main", "origin/main", "origin/HEAD"): continue
        for sha in commits("origin/main", other):
            note = read_note(sha)
            if isinstance(note, dict) and note.get("ticket") == ticket: refuse("shared_ticket " + ticket + " on " + other)
    must(git("clone", "-q", "--no-checkout", "--reference", str(main), "--separate-git-dir=" + str(gitdata), os.environ["REMOTE"], str(work)), "box clone failed")
    edge = ["--git-dir=" + str(gitdata), "--work-tree=" + str(work)]
    must(git(*edge, "fetch", "-q", str(main), head + ":refs/heads/" + branch), "box base fetch failed")
    must(git(*edge, "checkout", "-q", branch), "box checkout failed")
    # An absent notes ref is fine. Any existing note is copied as one immutable JSON value.
    if git("rev-parse", "--verify", "refs/notes/fabrika").returncode == 0:
        must(git(*edge, "fetch", "-q", str(main), "refs/notes/fabrika:refs/notes/fabrika"), "box notes fetch failed")
    installed = subprocess.run(["nice", "-n", "15", "pnpm", "install", "--silent"], cwd=work, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if installed.returncode: refuse("box install failed")
    save({"ticket": ticket, "branch": branch, "base": head, "parent": parent, "children": "none", "plan": plan, "plan-sha256": digest})
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
    if step == "build" and not any(verified(sha, "tests") for sha in commits(state["base"], state["branch"])):
        refuse("step_out_of_order: verified tests since base required")
    if step == "review" and not any(r.get("step", r.get("role")) == "mutation" and str(r.get("ticket")) == ticket and r.get("outcome") in ("done", "skip") for r in rows()):
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
        incoming = "refs/notes/box-" + name + "-" + uuid.uuid4().hex
        has_notes = git("ls-remote", "--exit-code", str(work), "refs/notes/fabrika")
        if has_notes.returncode == 0:
            must(git("fetch", "-q", str(work), "refs/notes/fabrika:" + incoming), "notes fetch failed")
            try:
                # Check every note before copying any, so a conflict leaves MAIN's notes as they were.
                # Notes are copied one by one, never merged as a ref: a note the box deleted stays in
                # MAIN, and a commit MAIN already links is never linked again.
                copies = []
                for line in must(git("notes", "--ref=" + incoming, "list"), "notes list failed").splitlines():
                    blob, sha = line.split()
                    current = git("notes", "--ref=fabrika", "show", sha)
                    if current.returncode != 0: copies.append((blob, sha))
                    elif current.stdout != git("cat-file", "blob", blob).stdout: refuse("note conflict " + sha)
                for blob, sha in copies:
                    must(git("notes", "--ref=fabrika", "add", "-C", blob, sha), "note copy failed " + sha)
            finally: git("update-ref", "-d", incoming)
        elif has_notes.returncode != 2: refuse("notes read failed")
        chain = commits(state["base"], head)
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
                    if owners.get(p) != step and not (step == "mutation" and owners.get(p) == "tests"): refuse("not_owner " + p)
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
        checked = call(["pnpm", "commits", "check", "--base", state["base"], "--head", head])
        answers, unreadable = [], 0
        for l in checked.stdout.splitlines():
            if not l.strip(): continue
            try: a = json.loads(l)
            except (ValueError, UnicodeError): a = None
            if isinstance(a, dict) and a.get("_tag") in ("done", "stuck", "ask", "send", "skip"):
                answers.append(a); print(json.dumps(a))
            else: unreadable += 1
        # The checker skips paths outside its scope; every run commit still needs a valid link.
        for sha in chain:
            note = read_note(sha)
            if person(sha): continue
            if not isinstance(note, dict) or not isinstance(note.get("step"), str) or not verified(sha, note["step"]):
                print(json.dumps({"_tag": "stuck", "why": "unlinked_commit", "commit": sha}))
                answers.append({"_tag": "stuck"})
        if unreadable or not answers: refuse("commits check unreadable output")
        if checked.returncode or any(a["_tag"] == "stuck" for a in answers): refuse("commits check failed")
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
