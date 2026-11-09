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
    "Zero hits from loosening.sh and the mutation arm-a vs arm-b comparison mean no owner read is needed.",
    "The lead records both outputs in the PR. Any hit waits on the owner.",
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
    "Start with merge-ready; tickets: <m> or changes: <n>; tickets: <m>.",
    "n counts blocking classes. Each class lists every affected case. m counts distinct confirmed tracker tickets linked in this answer.",
    "Give every finding in that answer, grouped by class, most serious first.",
    "Name each checked decided note and say where the change follows or breaks it.",
    "Use tracker_query to find an existing ticket, or tracker_file with value: {title, body, from: {_tag: \"pr\", url, step: \"review\"}}. Record the returned ID.",
    "If filing fails, include the exact pending payload for lead to retry. Do not count it as filed or start another review round for it.",
)
cleanup = (
    "After a successful merge, retain the checked head under refs/keep/pr/<pr> in MAIN.",
    "Remove the registered catchup-<pr> worktree, exact-branch boxes through box.sh rm, and the driver's linked MAIN worktree on that exact branch. Never remove MAIN itself.",
    "Use git worktree remove without force. Keep dirty, locked, ambiguous or unreadable candidates and any box that fails its guard.",
    "Print one line per retained item and continue. Cleanup never changes a landed merge's success.",
    "Saved plans, reports, logs and state/ remain.",
)
handoff = (
    "A ticket's driver is not the lead session. Every plan and amendment returns unsigned.",
    "Before handing it to lead, the driver runs plancheck.sh --draft, saves the approval wait and ends.",
    "Only the lead session reads and signs each plan and amendment itself.",
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
        "heading:Saved driver state": (
            "$BOXES/state/<name>.md", "Ticket or row:", "Branch and full SHA:", "Plan path:",
            "Parent branch and signed head:", "Children and merge method:", "Worktree and box names:",
            "Wait: kind, target, report or log path", "Cleared when: exact fact to read", "Next step:",
            "Field rows already written: run IDs, note IDs, commits", "Saved at:",
            "A Codex box, parent build, CI, plan approval or owner read is a wait.",
            "Before ending, save completed field work and replace a temporary sibling with this file. Then end the driver session.",
            "Lead checks the saved clearing condition and starts a fresh driver when it holds.",
            "The new driver reads the current branch, SHA, reports and checks again before acting. It does not rerun completed steps or duplicate listed field rows.",
            "Missing or unclear state sends it back to those facts.",
        ),
        "heading:Driver brief template": handoff,
        "step:Land it": (*cleanup, *exam),
    },
    ".agents/skills/plan/SKILL.md": {"heading:Scripts": handoff},
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
for message in bad:
    print(message, file=sys.stderr)
if not bad:
    print(f"skillscheck: {count} shared skills have the correct links")
sys.exit(1 if bad else 0)
PY
