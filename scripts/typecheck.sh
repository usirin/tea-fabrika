#!/bin/sh
# Today's tooling. Every shell shares this lock, regardless of its temp settings.
set -eu
# pnpm -r refuses a node_modules that is no folder (ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH). A link is
# replaced by this worktree's own install below, under the lock. Anything else that is no folder is
# not ours to remove, so say so before pnpm or the lock starts.
if [ ! -L node_modules ] && [ -e node_modules ] && [ ! -d node_modules ]; then
  echo "typecheck: node_modules is no folder; remove it and run pnpm install --offline --frozen-lockfile" >&2
  exit 1
fi
exec python3 - <<'PY'
import fcntl, os, subprocess, sys

INSTALL = ["pnpm", "install", "--offline", "--frozen-lockfile"]
commands = [["pnpm", "exec", "effect-tsgo", "patch", "--typescript"],
            ["pnpm", "-r", "typecheck"]]

# Keep this file in place. Unlinking it could give waiters different locks.
# The OS releases a dead holder's lock, including after SIGKILL.
# One fixed system folder, never TMPDIR: agents' TMPDIR differs, and the lock must be shared.
with open(os.path.join(os.sep, "tmp", "fabrika-typecheck.lock"), "a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    # A linked node_modules (a worktree pointed at another checkout's) is never written through:
    # the patch would change the other checkout's compiler, and an install through the link rewrites
    # its install state. Only the link goes, never what it points at, and this worktree gets its own
    # install from the warm store, with no network. Under the lock, since the install's `prepare`
    # runs the same patch and a second typecheck here must find the folder, not the link.
    if os.path.islink("node_modules"):
        os.unlink("node_modules")
        commands.insert(0, INSTALL)
    for command in commands:
        # A compiler keeps the lock if this wrapper dies before it does.
        status = subprocess.call(command, pass_fds=(lock.fileno(),))
        if status == 0 and command is INSTALL and not os.path.isdir("node_modules"):
            status = 1
        if status:
            if command is INSTALL:
                sys.stderr.write("typecheck: node_modules was a link and is removed, but the offline install failed;"
                                 " run pnpm install --frozen-lockfile\n")
            sys.exit(status if status > 0 else 128 - status)
PY
