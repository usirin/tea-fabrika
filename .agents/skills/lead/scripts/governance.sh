#!/bin/sh
# List the .decisions/ files a diff's words touch, so the review step and the lead read them.
# Advice only for now: it always exits 0. Blocking comes once its false alarms are measured.
# Usage: governance.sh [base]   (default origin/main; the diff is base...HEAD)
set -eu
base="${1:-origin/main}"
root="$(git rev-parse --show-toplevel)"
python3 - "$root" "$base" <<'PY'
from pathlib import Path
import re
import subprocess
import sys

STOP = {
    "the", "and", "for", "not", "never", "every", "each", "one", "two", "its", "with", "from",
    "into", "when", "that", "this", "than", "only", "stays", "goes", "lands", "made", "make",
    "turn", "file", "files", "live", "lives", "decision", "decisions", "owner", "repo",
}
WORD = re.compile(r"[a-z][a-z0-9]+")

def words(text):
    return {w for w in WORD.findall(text.lower()) if len(w) >= 4 and w not in STOP}

root, base = Path(sys.argv[1]), sys.argv[2]
diff = subprocess.run(
    ["git", "-C", str(root), "diff", "--unified=0", f"{base}...HEAD"],
    check=True, capture_output=True, text=True,
).stdout
touched = set()
changed = []
for line in diff.splitlines():
    if line.startswith(("+++ b/", "--- a/")):
        path = line[6:]
        if path.startswith(".decisions/"):
            touched.add(Path(path).name)
        changed.append(path)
    elif line[:1] in "+-" and not line.startswith(("+++", "---")):
        changed.append(line[1:])
seen = words("\n".join(changed))

folder = root / ".decisions"
hits = []
for record in sorted(folder.glob("[0-9][0-9][0-9][0-9]-*.md")):
    text = record.read_text()
    title = re.search(r"^title:\s*(.*)$", text, re.M)
    tags = re.search(r"^tags:\s*\[(.*)\]$", text, re.M)
    keys = words(record.stem[5:].replace("-", " "))
    keys |= words(title.group(1) if title else "")
    keys |= words(tags.group(1) if tags else "")
    match = sorted(keys & seen)
    if record.name in touched or match:
        why = "edited" if record.name in touched else ", ".join(match)
        hits.append((record.name in touched, len(match), record.name, why))

if not hits:
    print("governance: no decision file matched this diff. Search .decisions/ by hand too.")
for _, _, name, why in sorted(hits, key=lambda h: (not h[0], -h[1], h[2])):
    print(f".decisions/{name}: {why}")
PY
