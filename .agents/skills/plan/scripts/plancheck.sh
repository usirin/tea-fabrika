#!/bin/sh
# plancheck.sh [--draft] <plan.md>: list every exam path the plan names and check
# the plan's files tables. A files table is one whose first header starts with "file" or "path", or
# that has an owner column ("owner", "step", "writer" or "writes it"). Exits 1 when a files table has no owner
# column, a row has an empty owner, or an exam path in a row is owned by a step other than tests.
# Version 2 checks the generator grammar on laws tables (a "plant" column). Legacy plans keep
# their owner checks. Fixed inputs need one of the four labels in five-steps-for-every-check.md.
# Paths are read as the repo reads them: `./package.json` is `package.json`.
set -eu
draft=0
if [ "${1:-}" = --draft ]; then draft=1; shift; fi
[ "$#" = 1 ] || { echo "usage: plancheck.sh [--draft] <plan.md>" >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd -P)
plan=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
cd "$here/../../../.." && python3 - "$plan" "$here/../../step-commit/scripts/exam.py" "$draft" <<'PY'
import json, re, subprocess, sys
plan, exam, draft = sys.argv[1:]
def norm(w):
    while w.startswith("./"): w = w[2:]
    return w
def hits(words):
    words = sorted(set(norm(w) for w in words if norm(w)))
    if not words: return {}
    out = subprocess.run([sys.executable, exam, "exam-paths.json", *words], capture_output=True, text=True).stdout
    return dict(l.split("\t", 1) for l in out.splitlines())
def plain(text):
    text = text.strip()
    while True:
        marker = next((m for m in ("`", "**", "__", "*", "_")
                       if text.startswith(m) and text.endswith(m) and len(text) >= 2 * len(m)), None)
        if marker is None: return text
        text = text[len(marker):-len(marker)].strip()
def paths(text):
    # A path item must be complete. A sentence mentioning package.json is not a path.
    return [p for item in re.split(r",|<br\s*/?>", text)
            if (p := plain(item)) and not re.search(r"\s", p)]
def cells(text):
    out, start, slashes = [], 0, 0
    for j, char in enumerate(text):
        if char == "|" and slashes % 2 == 0:
            out.append(text[start:j].strip()); start = j + 1
        slashes = slashes + 1 if char == "\\" else 0
    out.append(text[start:].strip())
    if text.startswith("|"): out = out[1:]
    if start == len(text): out = out[:-1]
    return out
def owner_col(heads):
    j = next((j for j, c in enumerate(heads) if "owner" in c), None)
    if j is None: j = next((j for j, c in enumerate(heads) if c in ("step", "writer", "writes it")), None)
    return j
lines, fence = [], None
raw = open(plan).read().splitlines()
for line in raw:
    mark = re.match(r"^\s{0,3}(`{3,}|~{3,})(.*)$", line)
    if fence:
        if mark and mark[1][0] == fence[0] and len(mark[1]) >= len(fence) and not mark[2].strip(): fence = None
        lines.append(""); continue
    if mark:
        fence = mark[1]; lines.append(""); continue
    lines.append(line)
bad = []
if draft == "1":
    if not raw or raw[0].strip(): bad.append("draft: leave the first line blank for approval")
    if len(raw) < 2 or raw[1] != "Plancheck-Version: 2":
        bad.append("draft: put Plancheck-Version: 2 on line 2")
    if any(line.lstrip().startswith("Approved by the lead agent,") for line in lines):
        bad.append("draft: only the lead session may add an approval line")
markers = [line.strip() for line in lines if re.match(r"^\s*Plancheck-Version\b", line)]
versioned = markers == ["Plancheck-Version: 2"]
if not markers: print("legacy plan: generator checks skipped")
elif not versioned: bad.append("invalid or duplicate Plancheck-Version: expected one Plancheck-Version: 2")
fc = set()
if versioned:
    exported = subprocess.run(["node", "--input-type=module", "-e",
        'import fc from "fast-check"; console.log(JSON.stringify(Object.keys(fc).filter(k => typeof fc[k] === "function")))'],
        capture_output=True, text=True)
    if exported.returncode: sys.exit("cannot read installed fast-check exports: " + exported.stderr)
    fc = set(json.loads(exported.stdout))
def generated(text):
    text = plain(text)
    match = re.fullmatch(r"fc\.([A-Za-z_$][\w$]*)(?::\s*\S.*)?", text)
    if match: return match[1] in fc
    if re.fullmatch(r"@demlik/tea/pbt\.(arbMsg|arbRecordMsg|arbMsgSequence|arbGuidedSequence)(?::\s*\S.*)?", text): return True
    if re.fullmatch(r"Effect Arbitrary:\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*", text): return True
    return False
def generator(text):
    text = plain(text)
    if text in ("lint", "type") or generated(text): return True
    match = re.fullmatch(r"(vector|format|pinned|scenario):\s*(.+)", text)
    return bool(match and any(c.isalnum() for c in match[2]))
# Explicit qualified paths still get reported outside files tables. Bare root files do not.
named = hits(p for p in re.findall(r"`([^`\s]+)`", "\n".join(lines)) if "/" in norm(p))
col, files, gen, path, law = None, False, None, None, None
for i, l in enumerate(lines):
    l = l.strip()
    if not l.startswith("|"): col = gen = None; continue
    row = cells(l)
    if col is None:
        heads = [plain(c).lower() for c in row]
        j = owner_col(heads)
        path = next((k for k, c in enumerate(heads) if c.startswith(("file", "path"))), None)
        files = j is not None or path is not None
        if files and j is None: bad.append(f"line {i + 1}: a files table with no owner column")
        col = -1 if j is None else j
        gen = -1
        law = next((k for k, c in enumerate(heads) if c.startswith(("law", "property"))), None)
        if versioned and any("plant" in c for c in heads):
            gen = next((k for k, c in enumerate(heads) if "generator" in c or c.startswith("input")), None)
            if gen is None:
                bad.append(f"line {i + 1}: a laws table with no generator column"); gen = -1
        continue
    if all(re.fullmatch(r":?-+:?", c) for c in row): continue
    if len(row) != len(heads):
        bad.append(f"line {i + 1}: table row has {len(row)} cells, expected {len(heads)}"); continue
    if gen >= 0 and not generator(row[gen]):
        bad.append(f"line {i + 1}: invalid generator: {row[gen]}")
    if gen >= 0 and law is not None and "[secrets]" in row[law] and not generated(row[gen]):
        bad.append(f"line {i + 1}: [secrets] requires generated inputs in the same row")
    found = hits(paths(row[path])) if files and path is not None else {}
    named.update(found)
    if not files or col < 0: continue
    owner = plain(row[col]).split()[0].lower() if plain(row[col]) else ""
    if not owner: bad.append(f"line {i + 1}: a files table row with no owner"); continue
    for p in found:
        if owner != "tests": bad.append(f"line {i + 1}: {p} is an exam path owned by {owner}, not tests")
for p, g in sorted(named.items()): print(f"exam path named: {p}\t{g}")
for b in bad: print(b)
if not named and not bad: print("no exam paths named")
sys.exit(1 if bad else 0)
PY
