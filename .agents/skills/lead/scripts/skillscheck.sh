#!/bin/sh
# Today's tooling: one source per shared skill, with a Claude link to that source.
# Run from the repo root, or name a generated repo for the check's laws.
set -eu
python3 - "${1:-.}" <<'PY'
from pathlib import Path
import re, sys

root = Path(sys.argv[1])
sources = root / ".agents/skills"
bad = []
# Today's tooling, T321 slice 1a and T325 slice 1b: one clause table, one parser.
# Each clause has one source and one section. An empty section means the whole skill.
# No spelling aliases or legacy phrase list. Source: approved skills-friction plan, Amendment 1,
# required clauses. K20's source is the dated addition to five-steps-for-every-check.md.
leak = "leakgrep.sh checks added text; private words stay outside the repo."
caps = "The test config and typecheck.sh hold worker, home and typecheck limits."
effect = "For a new property, use @effect/vitest's it.prop or it.effect.prop with an existing Schema, or its own Effect Arbitrary exported beside it; write fast-check data only where Effect has nothing or to push edge cases."
clauses = [
    ("lead", "Scripts", "K19", "box.sh run and runplan.sh strip secret settings and redact saved output."),
    ("lead", "Scripts", "K1", "fetch --sign checks owners and signs missing notes in MAIN."),
    ("step-commit", "", "K1", "fetch --sign checks owners and signs missing notes in MAIN."),
    ("lead", "Steps", "K2", "box.sh new checks the approved plan, base and ticket."),
    ("lead", "Steps", "K3", "box.sh run --step checks order and slots, and saves the run row."),
    ("step-commit", "", "K4", "stepcommit.sh checks named paths, owners, exam paths and staged formatting."),
    ("plan", "", "K11", "plancheck.sh checks the draft; only the lead session reads and approves the whole plan and amendments."),
    ("lead", "Scripts", "K6", leak),
    ("plan", "Scripts", "K6", leak),
    ("guidelines", "10. Open a docs-only pull request", "K6", leak),
    ("tests", "Go easy on the machine", "K9", caps),
    ("build", "Go easy on the machine", "K9", caps),
    ("mutation", "Go easy on the machine", "K9", caps),
    ("tests", "Steps", "K20", effect),
]
def normalized(text):
    return " ".join(text.replace("`", "").replace("**", "").split())
def sections(text):
    # CommonMark fences: a closing fence uses the opening's character, is at least as long and has
    # no info string. A section holds its subsections; "" holds every line.
    found, open_, fence = {"": []}, [], None
    for line in text.splitlines():
        mark = re.match(r"^\s{0,3}(`{3,}|~{3,})(.*)$", line)
        if fence:
            if mark and mark[1][0] == fence[0] and len(mark[1]) >= len(fence) and not mark[2].strip():
                fence = None
            continue
        if mark:
            fence = mark[1]
            continue
        heading = re.match(r"^(#{2,6})\s+(.+?)\s*#*\s*$", line)
        if heading:
            level = len(heading[1])
            open_ = [(n, l) for n, l in open_ if l < level] + [(normalized(heading[2]), level)]
            for name, _ in open_:
                found.setdefault(name, [])
            continue
        found[""].append(line)
        for name, _ in open_:
            found[name].append(line)
    return {key: normalized(" ".join(lines)) for key, lines in found.items()}

# A tree holding none of the clause sources is a links-only tree (the laws' generated repos).
# Once any clause source exists, a removed one drops no clause: each it held is reported.
clause_tree = any((sources / skill / "SKILL.md").is_file() for skill, *_ in clauses)
for skill, section, check, clause in clauses:
    source = sources / skill / "SKILL.md"
    if not clause_tree:
        continue
    if not source.is_file():
        bad.append(f".agents/skills/{skill}/SKILL.md: {check} source missing for clause: {clause}")
    elif normalized(clause) not in sections(source.read_text()).get(section, ""):
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
