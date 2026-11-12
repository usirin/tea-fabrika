#!/bin/sh
# plancheck.sh [--draft|--approved|--owners-json] <plan.md>: list exam paths and check files tables.
# The listing is a total scan that reads no Markdown: the whole file, fences, link titles and
# comments included, is split into words on every character outside `A-Z a-z 0-9 . _ / -`, and each
# word the exam list matches, as it stands or with its leading dots removed, is listed. Saved-plan
# mode checks owners in table rows. Draft and approved modes also require each listed path in a
# files table. A files table is one whose first header starts with "file" or
# "path", or that has an owner column ("owner", "step", "writer" or "writes it"). Exits 1 when a
# files table has no owner column, a row has an empty owner, or an exam path in a row is owned by a
# step other than tests. Version 2 checks the generator grammar on laws tables (a "plant" column).
# Version 3, the one a draft must carry, also needs one `Estimate: <n> steps, $<d>` line ending the
# Size section in draft and approved modes; plans approved at version 2 keep passing. Legacy plans keep their owner checks. Fixed inputs need one of the four labels in
# five-steps-for-every-check.md. Paths are read as the repo reads them: `./package.json` is
# `package.json`. Draft mode also prints sizecap.ts's size line (0099), which never changes the exit,
# and fails a files-table path that is no repo path: one with a `:`, or a word with no `/` or `.`.
# A versioned plan also gets `advice:` lines, which never change the exit: a type or lint law with
# an fc. generator, a test law with an fc. generator and no run count, and a Validation section that
# tells a boxed step to run `--changed` or a typecheck.
set -eu
draft=0
case ${1:-} in --draft) draft=1; shift;; --approved) draft=approved; shift;; --owners-json) draft=owners; shift;; esac
[ "$#" = 1 ] || { echo "usage: plancheck.sh [--draft|--approved] <plan.md>" >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd -P)
plan=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
# A lane runs this script from a pin: a copy of `.agents/` at one commit, which is no git checkout
# (ticket 835). The plan is checked against the repo, so from a pin the repo is MAIN, the main
# checkout the pinned process was started with.
root="$here/../../../.."
if ! git -C "$root" rev-parse --show-toplevel >/dev/null 2>&1; then
    root=${MAIN:-}
    [ -n "$root" ] || { echo "plancheck: this script is outside a git checkout and MAIN is not set" >&2; exit 1; }
fi
cd "$root"
if [ "$draft" != owners ]; then
    sh "$here/../../lead/scripts/leakgrep.sh" --text "$plan" >&2
fi
# Draft mode also prints the plan's size and names each slice with no estimate. Advice only: no
# number caps a pull request (0099), so it never fails the check.
if [ "$draft" = 1 ]; then
    node "$here/../../lead/scripts/sizecap.ts" plan "$plan" || echo "size: not checked"
fi
python3 - "$plan" "$here/../../step-commit/scripts/exam.py" "$draft" <<'PY'
import hashlib, json, re, subprocess, sys
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
def bare(word):
    # Strip the punctuation around a word, as a plan writer types it: `x`, [x], (x), "x", 'x', x, x; x: x.
    while True:
        out = plain(word).lstrip("`[(\"'").rstrip("`])\"',;:.")
        if out == word: return out
        word = out
HOME = {"repository", "repo", "root", "project", "workspace", "monorepo", "top-level"}
def tokens(text):
    # The words of a piece of plan text, each stripped of the punctuation around it. A Markdown link
    # [text](target) gives its text's words and its target as words of their own.
    text = re.sub(r"\[([^\]]*)\]\(([^)\s]*)\)", r" \1 \2 ", text)
    return [bare(w) for w in re.split(r"[\s,;]+|<br\s*/?>", text) if bare(w)]
def paths(text):
    # Every word in a path cell is a candidate path; hits() keeps the exam paths, whatever words
    # surround them. A cell that names another package with a possessive ("Counter's package.json")
    # holds that package's files, so only its qualified paths (with a "/") are candidates. A
    # possessive of a word meaning this repository ("the repo's package.json"), in any letter case,
    # names no other package and keeps every word.
    words = tokens(text)
    owners = [m[1].lower() for m in (re.fullmatch(r"([\w-]+)'s", w) for w in words) if m]
    return [w for w in words if "/" in norm(w)] if any(o not in HOME for o in owners) else words
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
data = open(plan, "rb").read()
parts = data.split(b"\n", 2)
digest = hashlib.sha256(parts[2] if len(parts) == 3 else b"").hexdigest()
# Split on LF only, as box.sh and stepcommit.sh read the bytes: a CR stays in the line and fails.
raw = data.decode("utf-8").split("\n")
opening, first_section, opened = False, False, False
for line in raw:
    mark = re.match(r"^\s{0,3}(`{3,}|~{3,})(.*)$", line)
    if fence:
        if mark and mark[1][0] == fence[0] and len(mark[1]) >= len(fence) and not mark[2].strip():
            fence = None
            if opened: opening = True
        lines.append(""); continue
    if mark:
        opened = not first_section
        fence = mark[1]; lines.append(""); continue
    if re.match(r"^##\s", line): first_section = True
    lines.append(line)
bad = []
# Version 3 adds the Estimate line. A new draft writes the current version; a plan approved at an
# older one keeps passing, so the lane it started is not stranded.
CURRENT, KNOWN = 3, ("Plancheck-Version: 2", "Plancheck-Version: 3")
if draft == "approved":
    approval = re.fullmatch(r"Approved by the lead agent, builds (\S(?:.*\S)?); body ([0-9a-f]{12})", raw[0] if raw else "")
    if not approval: bad.append("plan approval: invalid approval line")
    elif approval[2] != digest[:12]: bad.append("plan approval: body hash mismatch")
    if len(raw) < 2 or raw[1] not in KNOWN: bad.append("plan approval: missing version on line 2")
    if any(l.lstrip().startswith("Approved by the lead agent,") for l in lines[1:]):
        bad.append("plan approval: duplicate approval line")
if draft == "1":
    if not raw or raw[0].strip(): bad.append("draft: leave the first line blank for approval")
    if len(raw) < 2 or raw[1] != f"Plancheck-Version: {CURRENT}":
        bad.append(f"draft: put Plancheck-Version: {CURRENT} on line 2")
    if any(line.lstrip().startswith("Approved by the lead agent,") for line in lines):
        bad.append("draft: only the lead session may add an approval line")
markers = [line.strip() for line in lines if re.match(r"^\s*Plancheck-Version\b", line)]
versioned = len(markers) == 1 and markers[0] in KNOWN
version = int(markers[0].split()[-1]) if versioned else 0
if not markers and draft != "owners": print("legacy plan: generator checks skipped")
elif not versioned: bad.append("invalid or duplicate Plancheck-Version: expected one Plancheck-Version: 2 or 3")
fc = set()
if versioned and draft != "owners":
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
def scanned(word):
    # A word as the total scan reads it: no leading `./`, `_` or `-`, and no trailing `_`, `-` or `.`.
    # A leading `.` stays, since dotfiles start with one.
    while True:
        out = norm(word).lstrip("_-").rstrip("_-.")
        if out == word: return out
        word = out
# Advice, which never changes the exit. A blocking check needs its false alarms measured first, at
# about 0% (AGENTS.md). Over the 93 versioned saved plans on 2026-11-11, a type or lint row with an
# fc. generator hit 15 rows, about 7 of them a lint rule's own generated tests, so it advises too.
advice = []
def kinds(i, kind, gen, row):
    # A laws row's kind cell (`lint`, `type` or `test`, first word) against its generator cell. A
    # kind that also names a test ("type and runtime test") is a test too, so it may carry one.
    first = (re.match(r"[a-z]+", kind) or [""])[0]
    if not gen.startswith("fc."): return []
    if first in ("type", "lint") and not re.search(r"\btests?\b", kind):
        return [f"line {i + 1}: a {first} law carries an fc. generator; a {first} law's generator cell says {first}"]
    if first == "test" and not re.search(r"\b\d+\s+runs?\b|\bdefault runs\b", row, re.I):
        return [f'line {i + 1}: a test law with an fc. generator states no run count ("N runs" or "default runs")']
    return []
def validation():
    # A Validation section that tells a boxed step to run `--changed` or a typecheck: a box runs
    # neither (the lead does), and a step that waits on one never answers done (2026-11-11). Fenced
    # commands count; a line that names the lead, CI, the host or the chain, or says no, does not.
    heads = [j for j, l in enumerate(lines) if re.match(r"^##\s", l)]
    out = []
    for j in heads:
        if not re.match(r"^##\s+validation\b", lines[j], re.I): continue
        end = next((k for k in heads if k > j), len(lines))
        for k in range(j + 1, end):
            said = raw[k]
            if not re.search(r"--changed|\bchanged[- ]tests?\b|\btypecheck\b", said, re.I): continue
            if re.search(r"\b(lead|ci|host|chain|no|never|not|without)\b|outside (the|any) box", said, re.I): continue
            out.append(f"line {k + 1}: the Validation section tells a boxed step to run --changed or a typecheck; the lead runs those")
    return out
# The lead's backstop, a total scan: split the raw file on every character that cannot be in a repo
# path, and list each word the exam list matches, as it stands or with its leading dots removed.
# Saved-plan mode decides ownership from path cells. Draft and approved modes also require a
# files-table row for every exam path named by the total scan.
words = [scanned(w) for w in re.split(r"[^A-Za-z0-9._/-]+", open(plan).read())]
named = hits(words + [w.lstrip(".") for w in words])
owned, file_paths = {}, set()
files_table, laws_table = False, False
col, files, gen, path, law = None, False, None, None, None
owned, file_paths, laws_table, files_table = {}, set(), False, False
for i, l in enumerate(lines):
    l = l.strip()
    if not l.startswith("|"): col = gen = None; continue
    row = cells(l)
    if col is None:
        heads = [plain(c).lower() for c in row]
        j = owner_col(heads)
        path = next((k for k, c in enumerate(heads) if c.startswith(("file", "path"))), None)
        files = j is not None or path is not None
        if files and j is not None and path is not None: files_table = True
        if files and j is None: bad.append(f"line {i + 1}: a files table with no owner column")
        col = -1 if j is None else j
        gen = -1
        law = next((k for k, c in enumerate(heads) if c.startswith(("law", "property"))), None)
        kind = None
        if versioned and any("plant" in c for c in heads):
            laws_table = True
            gen = next((k for k, c in enumerate(heads) if "generator" in c or c.startswith("input")), None)
            kind = next((k for k, c in enumerate(heads) if c.startswith("kind") or "lint, type or test" in c), None)
            if gen is None:
                bad.append(f"line {i + 1}: a laws table with no generator column"); gen = -1
        continue
    if all(re.fullmatch(r":?-+:?", c) for c in row): continue
    if len(row) != len(heads):
        bad.append(f"line {i + 1}: table row has {len(row)} cells, expected {len(heads)}"); continue
    if draft != "owners" and gen >= 0 and not generator(row[gen]):
        bad.append(f"line {i + 1}: invalid generator: {row[gen]}")
    if gen >= 0 and law is not None and "[secrets]" in row[law] and not generated(row[gen]):
        bad.append(f"line {i + 1}: [secrets] requires generated inputs in the same row")
    if draft != "owners" and gen >= 0 and kind is not None:
        advice.extend(kinds(i, plain(row[kind]).lower(), plain(row[gen]), l))
    found = hits(paths(row[path])) if files and path is not None else {}
    named.update(found)
    if not files or col < 0: continue
    owner = plain(row[col]).split()[0].lower() if plain(row[col]) else ""
    if not owner: bad.append(f"line {i + 1}: a files table row with no owner"); continue
    for p in paths(row[path]) if path is not None else []:
        p = norm(p)
        # stepcommit matches owner keys to staged paths exactly, so a key that is no repo path owns
        # nothing: a `:line` anchor, a bare `:537`, or a word such as `new` (ticket 425).
        if draft == "1" and (":" in p or not ("/" in p or "." in p)):
            bad.append(f"line {i + 1}: {p} is not a repo path; anchors and notes go in another column")
        # A later files row can amend ownership without erasing the earlier plan.
        owned[p] = owner
        file_paths.add(p)
    for p in found:
        if owner != "tests": bad.append(f"line {i + 1}: {p} is an exam path owned by {owner}, not tests")
if draft == "owners":
    # Owner lookup uses the same fence and table parser, including appended amendments.
    print(json.dumps(owned)); sys.exit(0)
FORM = "`Estimate: <n> steps, $<d>`, both above zero"
def estimate():
    # Version 3: the Size section ends with one Estimate line, the lane's budget (.decisions/0076).
    # The lane chain's estimateIn reads the first line anywhere, fences included, that says "estimate",
    # "<n> steps" and "$<d>", so any second such line is refused: it could set the backstop.
    reads = lambda l: re.search(r"\bestimate\b.*?\b\d+\s+steps?\b.*?\$\s?\d", l, re.I)
    seen = [i for i, l in enumerate(raw) if reads(l) or re.match(r"\s*estimate\s*:", lines[i], re.I)]
    if len(seen) > 1:
        return [f"plan estimate: {len(seen)} estimate lines (lines {', '.join(str(i + 1) for i in seen)}); keep one"]
    if not seen: return [f"plan estimate: end the Size section with {FORM}"]
    i = seen[0]
    m = re.fullmatch(r"Estimate: ([1-9][0-9]*) steps?, \$([0-9]+(?:\.[0-9]+)?)", lines[i].rstrip())
    if not m or float(m[2]) <= 0:
        return [f"plan estimate: line {i + 1} must read {FORM}, outside a code block"]
    heads = [j for j, l in enumerate(lines) if re.match(r"^##\s", l)]
    size = next((j for j in heads if re.match(r"^##\s+size\b", lines[j], re.I)), None)
    end = next((j for j in heads if size is not None and j > size), len(lines))
    last = next((j for j in range(end - 1, size, -1) if lines[j].strip()), None) if size is not None else None
    return [] if last == i else [f"plan estimate: line {i + 1} must be the last line of the Size section"]
if draft in ("1", "approved"):
    if not opening: bad.append("plan_section_missing: opening fenced block")
    if not laws_table: bad.append("plan_section_missing: laws table")
    if not files_table: bad.append("plan_section_missing: files table")
    text = "\n".join(lines)
    if not re.search(r"(?:size[^\n]*|[^\n]*agent hours?[^\n]*)\d+(?:\.\d+)?%", text, re.I):
        # A Size heading can put its value on the next line.
        if not re.search(r"^## Size\s*\n[^#]*\d+(?:\.\d+)?%", text, re.M | re.I):
            bad.append("plan_section_missing: size with confidence percent")
    sections = {}
    current = None
    for line in lines:
        heading = re.match(r"^##\s+(.+)", line)
        if heading:
            current = heading[1].strip().lower(); sections.setdefault(current, [])
        elif current: sections[current].append(line)
    if version >= CURRENT:
        bad.extend(estimate())
    for needle in ("records", "cannot tell", "open questions"):
        if not any(needle in k for k in sections): bad.append("plan_section_missing: " + needle)
    for key, content in sections.items():
        if "open questions" not in key: continue
        value = "\n".join(content).strip()
        # "None" counts only when no question follows it: no numbered item and no question mark,
        # in a list item of any marker or in prose.
        if re.match(r"^none\.?(?:\n|$)", value, re.I) and not re.search(r"(?m)^\s*\d+[.)]\s+|\?", value): continue
        questions = re.split(r"(?m)^\s*(?:\d+[.)]|[-*+])\s+", value)
        questions = [q.strip() for q in questions if q.strip()]
        if not questions or any(not re.search(r"\blean\b", q, re.I) or not re.search(r"\d+(?:\.\d+)?%", q) for q in questions):
            bad.append("plan questions: each needs a lean and percent, or none")
    # Include paths in fences and bare paths, not just backtick words outside them.
    mentions = re.findall(r"[.\w@-]+(?:/[.\w@*-]+)+|\b(?:package\.json|vitest\.config\.ts|exam-paths\.json)\b", data.decode("utf-8"))
    named.update(hits(mentions))
    for p in named:
        if p not in file_paths: bad.append("plan files: exam path missing from files table: " + p)
    print("plan-sha256: " + digest)
for p, g in sorted(named.items()): print(f"exam path named: {p}\t{g}")
if versioned: advice.extend(validation())
for a in advice: print("advice: " + a)
for b in bad: print(b)
if not named and not bad: print("no exam paths named")
sys.exit(1 if bad else 0)
PY
