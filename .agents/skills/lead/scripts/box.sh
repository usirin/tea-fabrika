#!/bin/sh
# box.sh: a Codex agent's own copy of tea-fabrika, whose git data is outside any folder named .git,
# so Codex's sandbox lets it commit. The lead never runs git inside a box; it only fetches from it.
#   box.sh new   <name> <base-ref> <branch>   make the box, install, print its paths
#   box.sh run   <name> <prompt-file> <out>   run codex in it (CODEX_MODEL, CODEX_EFFORT, standard tier), writable: box + its git data
#   box.sh fetch <name> <branch>              pull the box's branch and step notes into the main checkout
#   box.sh rm    <name>                       remove a clean pair whose commits MAIN retains
# Paths come from env.sh beside this script.
set -eu
. "$(dirname "$0")/env.sh"
[ "$#" -ge 2 ] || { echo "usage: box.sh new|run|fetch|rm <name> ..." >&2; exit 2; }
cmd=$1; name=$2
if [ "$cmd" = rm ]; then
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
    if any((data / p).exists() for p in ("commondir", "shallow")) or list(data.glob("sharedindex.*")):
        keep("unsupported shared or shallow metadata")

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
            (inspect / relative).mkdir(parents=True, exist_ok=True)
            for entry in dirs:
                if (Path(folder) / entry).is_symlink():
                    raise ValueError("symlinked ref metadata")
            for entry in files:
                source = Path(folder) / entry
                value = plain(source)
                if not re.fullmatch(rb"[0-9a-f]{40}\n?", value):
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
        tips = git(["for-each-ref", "--format=%(objectname)", "refs/heads/", "refs/stash", "refs/notes/"], inspect).splitlines()
        tips += git(["rev-parse", "--verify", "HEAD^{commit}"], inspect).splitlines()
        retained = git(["for-each-ref", "--format=%(objectname)", "refs/heads/", "refs/tags/", "refs/keep/", "refs/stash", "refs/notes/"]).splitlines()
        # Enumerate only MAIN's retained history. Mere object presence and remote refs prove nothing.
        reachable = set()
        if retained:
            reachable.update(git(["rev-list", *[tip.decode() for tip in retained]]).splitlines())
        if any(tip not in reachable for tip in tips):
            keep("tip not retained in MAIN")

    try:
        shutil.rmtree(work)
    except OSError:
        keep("work removal failed; pair may be partly removed")
    try:
        shutil.rmtree(data)
    except OSError:
        keep("work removed; git data removal failed and may be partial")
    print(f"removed box {name}")
except (OSError, ValueError, RuntimeError) as error:
    keep(str(error) if type(error) is ValueError else "inspection or removal failed")
PY
	exit "$?"
fi
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
*) echo "usage: box.sh new|run|fetch|rm <name> ..." >&2; exit 2 ;;
esac
