#!/bin/sh
# Today's tooling. Every shell shares this lock, regardless of its temp settings.
set -eu
exec python3 - <<'PY'
import fcntl, os, subprocess, sys

# Keep this file in place. Unlinking it could give waiters different locks.
# The OS releases a dead holder's lock, including after SIGKILL.
# One fixed system folder, never TMPDIR: agents' TMPDIR differs, and the lock must be shared.
with open(os.path.join(os.sep, "tmp", "fabrika-typecheck.lock"), "a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    for command in (["pnpm", "exec", "effect-tsgo", "patch", "--typescript"],
                    ["pnpm", "-r", "typecheck"]):
        # A compiler keeps the lock if this wrapper dies before it does.
        status = subprocess.call(command, pass_fds=(lock.fileno(),))
        if status:
            sys.exit(status if status > 0 else 128 - status)
PY
