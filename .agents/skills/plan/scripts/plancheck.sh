#!/bin/sh
# plancheck.sh <plan.md>: list every exam path the plan names, root-level files included, and check
# the plan's files tables. A files table is one whose first header starts with "file" or "path", or
# that has an owner column ("owner", "step", "writer" or "writes it"). Exits 1 when a files table has no owner
# column, a row has an empty owner, or an exam path in a row is owned by a step other than tests.
# A laws table is one with a "plant" column. Each law is a property over generated inputs, so it
# needs a "generator" or "input" column, filled on every row: what the generator draws, or "lint" or
# "type" for a law that is a lint rule or a type (docs/direction/five-steps-for-every-check.md).
# Paths are read as the repo reads them: `./package.json` is `package.json`.
here=$(cd "$(dirname "$0")" && pwd -P)
plan=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
cd "$here/../../../.." && python3 - "$plan" "$here/../../step-commit/scripts/exam.py" <<'PY'
import re, subprocess, sys
plan, exam = sys.argv[1], sys.argv[2]
def norm(w):
    while w.startswith("./"): w = w[2:]
    return w
def hits(words):
    words = sorted(set(norm(w) for w in words if norm(w)))
    if not words: return {}
    out = subprocess.run([sys.executable, exam, "exam-paths.json", *words], capture_output=True, text=True).stdout
    return dict(l.split("\t", 1) for l in out.splitlines())
def words(text):
    return [w.strip("`()[],;:") for w in re.split(r"[\s,]+", text)]
def owner_col(heads):
    j = next((j for j, c in enumerate(heads) if "owner" in c), None)
    if j is None: j = next((j for j, c in enumerate(heads) if c in ("step", "writer", "writes it")), None)
    return j
lines = open(plan).read().splitlines()
named = hits(re.findall(r"`([^`\s]+)`", "\n".join(lines)))
for p, g in sorted(named.items()): print(f"exam path named: {p}\t{g}")
bad, col, files, gen = [], None, False, None
for i, l in enumerate(lines):
    if not l.startswith("|"): col = gen = None; continue
    cells = [c.strip() for c in l.strip().strip("|").split("|")]
    if col is None:
        heads = [c.lower().strip("*` ") for c in cells]
        j = owner_col(heads)
        files = j is not None or heads[0].startswith(("file", "path"))
        if files and j is None: bad.append(f"line {i + 1}: a files table with no owner column")
        col = -1 if j is None else j
        gen = -1
        if any("plant" in c for c in heads):
            gen = next((k for k, c in enumerate(heads) if "generator" in c or c.startswith("input")), None)
            if gen is None:
                bad.append(f"line {i + 1}: a laws table with no generator column"); gen = -1
        continue
    if set(l) <= set("|-: "): continue
    drawn = cells[gen].strip("*` ").lower() if 0 <= gen < len(cells) else ""
    if gen >= 0 and drawn in ("", "-", "none", "n/a", "example", "examples"):
        bad.append(f"line {i + 1}: a law with no generator: say what its inputs are drawn from")
    if not files or col < 0: continue
    owner = cells[col].split()[0].strip("*`").lower() if col < len(cells) and cells[col].split() else ""
    if not owner: bad.append(f"line {i + 1}: a files table row with no owner"); continue
    found = hits(w for j, c in enumerate(cells) if j != col for w in words(c))
    for p in found:
        if owner != "tests": bad.append(f"line {i + 1}: {p} is an exam path owned by {owner}, not tests")
for b in bad: print(b)
if not named and not bad: print("no exam paths named")
sys.exit(1 if bad else 0)
PY
