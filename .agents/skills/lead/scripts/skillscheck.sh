#!/bin/sh
# Today's tooling: one source per shared skill, with a Claude link to that source.
# Run from the repo root, or name a generated repo for the check's laws.
set -eu
python3 - "${1:-.}" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
sources = root / ".agents/skills"
bad = []
# Today's tooling, T321 slice 1a and T325 slice 1b: one clause table, one parser.
# Each clause has one source and one section. An empty section means the whole skill.
# No spelling aliases or legacy phrase list. Source: approved skills-friction plan, Amendment 1,
# required clauses. K20's source is the dated addition to five-steps-for-every-check.md.
leak = "leakgrep.sh checks added text; private words stay outside the repo."
caps = "The test config and typecheck.sh hold worker, home and typecheck limits."
outside = "Something wrong that your task does not cover is one finding row with proof, then keep going: never a fix, a ticket or only a mention, and never a security hole."
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
    # Decision 0035. The fields and the closed rule list are field/README.md's; field-schema.ts
    # checks a row's shape, so the skills keep only this clause and their own judgment.
    *(
        (skill, "Outside your task", "K21", outside)
        for skill in ("plan", "tests", "build", "mutation", "lead")
    ),
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
for source in sorted(sources.iterdir()) if sources.is_dir() else []:
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

# Fixed clauses, scoped to their owning section. Wrapping is free; changing their
# words changes this tests-owned writing format. These are instructions, not proof
# that a future reviewer followed them.
exam = (
    "Every new or changed law is a property, or an example labeled vector, format, pinned or scenario with its reason.",
    # 0066: mutation left the pull request's steps, so loosening.sh alone is the zero-hit check.
    "Zero hits from loosening.sh mean no owner read is needed.",
    "The lead records its output in the PR. A hit goes to the lead's hand check, with the hit list in the PR. Only real loosening waits on the owner.",
)
review = (
    "Sweep, do not sample. For each law in the plan's table, list every way in: each public call, each cut point, and each saved or binding state. Check each one.",
    "A finding names its class and every case of it.",
    "A law written as examples over a class the plan names is a defect when a found case escapes those examples.",
    "On a re-review, read every line the last fixes changed and what calls them first. Then finish the remaining checks.",
    "Read every decided note the PR builds, following the plan's references and the change itself.",
    "Block only on a broken decision in docs/direction or AGENTS.md, lost data, or a broken law. Each blocker cites that source and shows the missed case.",
)
answer = (
    "Start with merge-ready; findings: <m> or changes: <n>; findings: <m>.",
    "n counts blocking classes. Each class lists every affected case. m counts the finding rows in this answer.",
    "Give every finding in that answer, grouped by class, most serious first.",
    "Name each checked decided note and say where the change follows or breaks it.",
    "Any other actionable finding is one finding row with proof: never a ticket, a fix or only a mention, and never a security hole.",
    "Give each row as one JSON line in the answer. The lead saves it unchanged as its own file in field/findings/. Do not start another review round for it.",
    "End with exactly one answer: line, as the last line.",
)
cleanup = (
    "After a successful merge, retain the checked head under refs/keep/pr/<pr> in MAIN.",
    "Remove the registered catchup-<pr> worktree, exact-branch boxes through box.sh rm, and the driver's linked MAIN worktree on that exact branch. Never remove MAIN itself.",
    "Use git worktree remove without force. Keep dirty, locked, ambiguous or unreadable candidates and any box that fails its guard.",
    "Print one line per retained item and continue. Cleanup never changes a landed merge's success.",
    "Saved plans, reports, logs and state/ remain.",
)
rules = {
    ".agents/skills/review/SKILL.md": {
        "step:Check": review, "step:Answer": answer,
    },
    ".agents/skills/lead/SKILL.md": {
        "heading:Review brief template": (
            "Ticket:", "Version:", "Approved plan:", "Parent base:", "Reviewed head:",
            "Decided notes:", "Last fixes:", *review, *answer,
        ),
        "step:Land it": (*cleanup, *exam),
        # Ticket 652: a lane agent's last act is land.ts ready; the lead session lands.
        "heading:Lane brief template": ("land.ts ready",),
    },
    "AGENTS.md": {"bullet:Every pull request": exam},
}

def section(text, key):
    kind, title = key.split(":", 1)
    patterns = {
        "heading": r"^(#{1,6}) " + re.escape(title) + r"\s*$",
        "step": r"^\d+\. \*\*" + re.escape(title) + r"\b[^\n]*",
        "bullet": r"^- \*\*" + re.escape(title) + r"\b[^\n]*",
    }
    # Fenced examples cannot supply a missing owning section.
    lines = text.splitlines(); active = []; fence = None
    for i, line in enumerate(lines):
        if re.match(r"^\s*(`{3,}|~{3,})", line):
            fence = None if fence else line.strip()[0]
            continue
        if not fence:
            active.append((i, line))
    for pos, (i, line) in enumerate(active):
        match = re.match(patterns[kind], line, re.I)
        if not match:
            continue
        end = len(lines)
        for j, following in active[pos + 1:]:
            if (kind == "heading" and re.match(r"^#{1," + str(len(match[1])) + r"} ", following)) or (
                kind != "heading" and re.match(r"^(?:#{1,6} |\d+\. \*\*|- \*\*)", following)
            ):
                end = j; break
        return " ".join("\n".join(lines[i:end]).split())
    return ""

for path, sections in rules.items():
    try:
        text = (root / path).read_text()
    except OSError:
        bad.append(f"{path}: missing required file")
        continue
    for key, clauses in sections.items():
        body = section(text, key)
        for clause in clauses:
            if " ".join(clause.split()).lower() not in body.lower():
                bad.append(f"{path}: missing {key}: {clause}")
    if path == ".agents/skills/lead/SKILL.md":
        body = section(text, "heading:Review brief template")
        for pattern in (
            r"(?:only|restrict\w* to).{0,100}(?:real|live) run",
            r"(?:real|live) run (?:could|can|would) hit",
            r"(?:at most|no more than|under|within|limit(?:ed)? to|max(?:imum)?)\s+\d+\s+lines?",
            r"\b\d+[- ]lines?\s+(?:cap|limit|answer|report)",
            r"\b(?:line cap|line limit)\s*[:=]?\s*\d+",
        ):
            if re.search(pattern, body, re.I):
                bad.append(f"{path}: forbidden review restriction: {pattern}")
        # Ticket 652: no brief template hands an agent a lead-only step. The permission check
        # refuses a subagent the lead key, so a lane that is told to sign as lead stops (0056).
        # stepcommit.sh --commit-only lead stays allowed: it commits and signs nothing.
        lead_only = (
            r"commits\s+sign", r"step-keys", r"botpush", r"catchup\.sh", r"land\.ts\s+run",
            r"stepcommit\.sh\s+lead",
        )
        for title in re.findall(r"^#{1,6} (.*brief template.*?)\s*$", text, re.M | re.I):
            body = section(text, "heading:" + title)
            for pattern in lead_only:
                if re.search(pattern, body, re.I):
                    bad.append(f"{path}: lead-only step in {title}: {pattern}")
for message in bad:
    print(message, file=sys.stderr)
if not bad:
    print(f"skillscheck: {count} shared skills have the correct links")
sys.exit(1 if bad else 0)
PY
