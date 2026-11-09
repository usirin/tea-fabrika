#!/bin/sh
# redact.sh <answer> <events>: scrub saved bytes, print only a count.
# --run <cwd> <prompt> <answer> <events> <command>... runs with isolated auth first.
set -eu
# Some system Python launchers print platform diagnostics before Python starts. Resolve the
# interpreter quietly, then keep Python's own errors visible. The public result is only a count.
python=$(python3 -c 'import sys; print(sys.executable)' 2>/dev/null)
exec "$python" - "$@" <<'PY'
import fcntl, hashlib, json, os, pathlib, re, signal, subprocess, sys, tempfile, urllib.parse
secret_name = re.compile(r"TOKEN|SECRET|KEY|PASSWORD|_AUTH|^NPM_CONFIG_", re.I)
secrets = [v for k, v in os.environ.items() if secret_name.search(k) and v]
patterns = [re.compile(r"(?:npm_|ghp_|gho_|github_pat_|sk-)[A-Za-z0-9_-]{16,}"),
            # A block cut short by a crash still holds key bytes: it runs to the end of the file.
            re.compile(r"-----BEGIN ([A-Z ]*PRIVATE KEY)-----.*?(?:-----END \1-----|\Z)", re.S)]
# A surrogate pair first, so an escaped emoji decodes as one character.
encoded = re.compile(r'\\u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\\[nrtbf"/\\]|(?:%[0-9a-fA-F]{2})+')
def found(text, spans):
    # Match at every decoding depth, so a value that itself holds %HH or a backslash is found raw.
    hits = []
    for pattern in patterns:
        hits.extend((m.start(), m.end()) for m in pattern.finditer(text))
    for secret in secrets:
        start = 0
        while True:
            i = text.find(secret, start)
            if i < 0: break
            hits.append((i, i + len(secret))); start = i + len(secret)
    return [(spans[a][0], spans[b-1][1]) for a, b in hits if b > a]
def scrub(path):
    if not path.exists(): return 0
    original = path.read_bytes().decode("utf-8", "surrogateescape")
    # Track each decoded character back to its original byte spelling. Only matched spans change.
    text, spans = original, [(i, i + 1) for i in range(len(original))]
    ranges = found(text, spans)
    for _ in range(6):
        out, mapped, at = [], [], 0
        for m in encoded.finditer(text):
            out.append(text[at:m.start()]); mapped.extend(spans[at:m.start()])
            word = m[0]
            try:
                value = urllib.parse.unquote(word) if word.startswith("%") else json.loads('"' + word + '"')
            except (ValueError, UnicodeError): value = word
            out.append(value); mapped.extend([(spans[m.start()][0], spans[m.end()-1][1])] * len(value)); at = m.end()
        out.append(text[at:]); mapped.extend(spans[at:])
        decoded = "".join(out)
        if decoded == text: break
        text, spans = decoded, mapped
        ranges.extend(found(text, spans))
    merged = []
    for a, b in sorted(ranges):
        if merged and a <= merged[-1][1]: merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else: merged.append((a, b))
    for a, b in reversed(merged): original = original[:a] + "[redacted]" + original[b:]
    if merged: path.write_bytes(original.encode("utf-8", "surrogateescape"))
    return len(merged)
args = sys.argv[1:]
status = 0
if args and args[0] == "--run":
    _, cwd, prompt, answer, events, *command = args
    answer, events = pathlib.Path(answer).absolute(), pathlib.Path(events).absolute()
    receipt = pathlib.Path(str(events) + ".redacted")
    receipt.unlink(missing_ok=True)
    answer.parent.mkdir(parents=True, exist_ok=True); events.parent.mkdir(parents=True, exist_ok=True)
    interrupted = [None]
    child = [None]
    def stop(sig, frame):
        interrupted[0] = sig
        if child[0] and child[0].poll() is None: child[0].send_signal(sig)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP): signal.signal(sig, stop)
    # Serialize the temporary project config swap. HOME and PATH are kept as given.
    lockname = hashlib.sha256(os.path.realpath(cwd).encode()).hexdigest()
    with open(pathlib.Path(tempfile.gettempdir()) / ("npm-isolate-" + lockname + ".lock"), "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix="npm-isolate-") as tmp:
            empty = pathlib.Path(tmp) / "empty"; empty.write_text("")
            project = pathlib.Path(cwd) / ".npmrc"
            # The backup sits beside the config, not in tmp, so a failed restore never deletes it.
            backup = pathlib.Path(cwd) / ".npmrc.redact-backup"
            had_project = project.exists() or project.is_symlink()
            try:
                if had_project:
                    project.rename(backup)
                    project.write_text("")
                env = {k: v for k, v in os.environ.items() if not secret_name.search(k)}
                env.update(NPM_CONFIG_USERCONFIG=str(empty), NPM_CONFIG_GLOBALCONFIG=str(pathlib.Path(tmp) / "global"))
                pathlib.Path(env["NPM_CONFIG_GLOBALCONFIG"]).write_text("")
                with open(prompt, "rb") as source, open(events, "wb") as log:
                    child[0] = subprocess.Popen(command, cwd=cwd, env=env, stdin=source, stdout=log, stderr=subprocess.STDOUT)
                    code = child[0].wait()
                    status = 128 - code if code < 0 else code
                if interrupted[0]: status = 128 + interrupted[0]
            finally:
                # Scrub first: a restore that fails must not leave secrets in either output.
                try:
                    count = scrub(answer) + scrub(events)
                    receipt.write_text(str(count) + "\n")
                    print("redacted " + str(count))
                except OSError:
                    # Never release a file whose scrub could not finish.
                    answer.unlink(missing_ok=True); events.unlink(missing_ok=True)
                    print("redaction failed", file=sys.stderr)
                    status = status or 1
                if had_project:
                    try:
                        if project.is_dir() and not project.is_symlink(): project.rmdir()
                        else: project.unlink(missing_ok=True)
                        backup.rename(project)
                    except OSError:
                        print("config restore failed; the original is at .npmrc.redact-backup", file=sys.stderr)
                        status = status or 1
else:
    count = 0
    for name in args:
        path = pathlib.Path(name)
        try: count += scrub(path)
        except OSError:
            # An unreadable file is removed, not skipped: the rest are still scrubbed.
            try: path.unlink(missing_ok=True)
            except OSError: pass
            print("redaction failed", file=sys.stderr)
            status = 1
    print("redacted " + str(count))
sys.exit(status)
PY
