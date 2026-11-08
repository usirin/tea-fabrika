#!/bin/sh
# plancheck.sh <plan.md>: list every exam path the plan names, root-level files included, and check
# that each row of a files table naming one gives it to the tests step. A files table is one whose
# header has an "owner" or "step" column. Exits 1 when an exam path in such a table has another owner.
here=$(cd "$(dirname "$0")" && pwd -P)
plan=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
cd "$here/../../../.." && python3 - "$plan" "$here/../../step-commit/scripts/exam.py" <<'EOF'
import re, subprocess, sys
plan, exam = sys.argv[1], sys.argv[2]
def hits(words):
    words = sorted(set(w for w in words if w))
    if not words: return {}
    out = subprocess.run([sys.executable, exam, "exam-paths.json", *words], capture_output=True, text=True).stdout
    return dict(l.split("\t", 1) for l in out.splitlines())
def words(text):
    return [w.strip("`()[],;:") for w in re.split(r"[\s,]+", text)]
lines = open(plan).read().splitlines()
named = hits(re.findall(r"`([^`\s]+)`", "\n".join(lines)))
for p, g in sorted(named.items()): print(f"exam path named: {p}\t{g}")
bad, col = [], None
for i, l in enumerate(lines):
    if not l.startswith("|"): col = None; continue
    cells = [c.strip() for c in l.strip().strip("|").split("|")]
    if col is None:
        heads = [c.lower() for c in cells]
        col = next((j for j, c in enumerate(heads) if "owner" in c), None)
        if col is None: col = next((j for j, c in enumerate(heads) if c == "step"), -1)
        continue
    if col < 0 or set(l) <= set("|-: ") or col >= len(cells): continue
    owner = cells[col].split()[0].strip("*`") if cells[col] else ""
    found = hits(w for j, c in enumerate(cells) if j != col for w in words(c))
    for p in found:
        if owner != "tests": bad.append(f"line {i + 1}: {p} is an exam path owned by {owner or 'nobody'}, not tests")
for b in bad: print(b)
if not named and not bad: print("no exam paths named")
sys.exit(1 if bad else 0)
EOF
