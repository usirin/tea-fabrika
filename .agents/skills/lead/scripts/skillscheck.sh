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
# Today's tooling, T321 slice 1a. Each clause has one source and one section.
# An empty section means the whole skill. No spelling aliases or legacy phrase list.
clauses = [
    ("lead", "Scripts", "K19", "box.sh run and runplan.sh strip secret settings and redact saved output."),
    ("lead", "Scripts", "K1", "fetch --sign checks owners and signs missing notes in MAIN."),
    ("step-commit", "", "K1", "fetch --sign checks owners and signs missing notes in MAIN."),
    ("lead", "Steps", "K2", "box.sh new checks the approved plan, base and ticket."),
    ("lead", "Steps", "K3", "box.sh run --step checks order and slots, and saves the run row."),
    ("step-commit", "", "K4", "stepcommit.sh checks named paths, owners, exam paths and staged formatting."),
    ("plan", "", "K11", "plancheck.sh checks the draft; only the lead session reads and approves the whole plan and amendments."),
]
import re
def sections(text):
    found = {"": []}
    section, fence = "", None
    for line in text.splitlines():
        mark = re.match(r"^\s{0,3}(`{3,}|~{3,})(.*)$", line)
        if fence:
            if mark and mark[1][0] == fence[0] and len(mark[1]) >= len(fence) and not mark[2].strip():
                fence = None
            continue
        if mark:
            fence = mark[1]
            continue
        heading = re.match(r"^##\s+(.+?)\s*#*\s*$", line)
        if heading:
            section = heading[1]
        found.setdefault(section, []).append(line)
        if section:
            found[""].append(line)
    return {key: " ".join(" ".join(lines).split()) for key, lines in found.items()}

for skill, section, check, clause in clauses:
    source = sources / skill / "SKILL.md"
    if source.is_file() and clause not in sections(source.read_text()).get(section, ""):
        bad.append(f".agents/skills/{skill}/SKILL.md: {check} missing clause in {section or 'skill'}: {clause}")
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
