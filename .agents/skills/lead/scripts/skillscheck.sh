#!/bin/sh
# Today's tooling: one source per shared skill, with a Claude link to that source.
# Run from the repo root, or name a generated repo for the check's laws.
set -eu
python3 - "${1:-.}" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
sources = root / ".agents/skills"
bad = []
count = 0
for source in sorted(sources.iterdir()):
    if not (source / "SKILL.md").is_file():
        continue
    count += 1
    alias = root / ".claude/skills" / source.name
    if not alias.is_symlink():
        bad.append(f".claude/skills/{source.name}: expected a link to .agents/skills/{source.name}")
        continue
    try:
        target = alias.resolve(strict=True)
    except (OSError, RuntimeError):
        bad.append(f".claude/skills/{source.name}: dangling or cyclic link")
        continue
    if target != source.resolve(strict=True):
        bad.append(f".claude/skills/{source.name}: link points to the wrong source")
for message in bad:
    print(message, file=sys.stderr)
if not bad:
    print(f"skillscheck: {count} shared skills have the correct links")
sys.exit(1 if bad else 0)
PY
