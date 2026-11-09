#!/bin/sh
# Today's tooling: compare exam content at two local refs. No checkout or network.
set -eu
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || { echo 'usage: loosening.sh <base> <head> [mapping.md]' >&2; exit 2; }
python3 - "$(dirname "$0")/../../step-commit/scripts/exam.py" "$@" <<'PY'
from collections import Counter
from pathlib import Path
import json
import re
import subprocess
import sys

classifier, base, head, *mapping = sys.argv[1:]

def git(*args):
    result = subprocess.run(["git", *args], capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr.decode(errors="replace").strip())
    return result.stdout

def content(ref, path):
    exists = subprocess.run(["git", "cat-file", "-e", f"{ref}:{path}"], capture_output=True)
    return git("show", f"{ref}:{path}").decode(errors="replace") if exists.returncode == 0 else ""

# A small lexer, rather than line counts: comments, strings, wrapping and moving
# an assertion to a new line must not look like a weaker exam. Tokens retain lines.
token = re.compile(r'''//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|=>|[^\s]''')

def lex(text):
    return [(m.group(), text.count("\n", 0, m.start()) + 1) for m in token.finditer(text)
            if not m.group().startswith(("//", "/*"))]

def paired(tokens):
    stack = []; pairs = {}
    for i, (value, _) in enumerate(tokens):
        if value in ("(", "[", "{"):
            stack.append((value, i))
        elif value in (")", "]", "}") and stack and stack[-1][0] == {")": "(", "]": "[", "}": "{"}[value]:
            _, start = stack.pop(); pairs[start] = i
    return pairs

def quoted(value):
    return value[:1] in ("'", '"', '`')

def name(value):
    if value.startswith('"'):
        try: return json.loads(value)
        except ValueError: pass
    return value[1:-1].replace(r"\'", "'").replace(r'\"', '"')

def laws(tokens, pairs):
    found = {}
    for i, (value, line) in enumerate(tokens):
        if value not in ("it", "test") or (i and tokens[i - 1][0] in (".", "function")):
            continue
        j = i + 1
        while j + 1 < len(tokens) and tokens[j][0] == ".":
            member = tokens[j + 1][0]; j += 2
            if member in ("each", "for", "skipIf", "runIf") and j in pairs:
                j = pairs[j] + 1
        if j not in pairs or j + 1 >= len(tokens) or not quoted(tokens[j + 1][0]):
            continue
        title = name(tokens[j + 1][0])
        # Keep duplicate names separate instead of silently dropping a law.
        ordinal = sum(k[0] == title for k in found)
        found[(title, ordinal)] = (i, pairs[j] + 1, line)
    return found

def muted(tokens):
    result = Counter()
    named = laws(tokens, paired(tokens))
    for i, (value, line) in enumerate(tokens):
        if value not in ("it", "test", "describe") or (i and tokens[i - 1][0] == "."):
            continue
        j = i + 1
        while j + 1 < len(tokens) and tokens[j][0] == ".":
            member = tokens[j + 1][0]
            if member in ("skip", "todo", "fails", "only"):
                title = next((key[0] for key, (start, end, _) in named.items() if start <= i < end), f"line {line}")
                if value == "describe":
                    call = j + 2
                    if call + 1 < len(tokens) and tokens[call][0] == "(" and quoted(tokens[call + 1][0]):
                        title = "describe " + name(tokens[call + 1][0])
                result[("it.fails" if member == "fails" else member, title)] += 1
            j += 2
    return result

def bounds(tokens):
    pairs = paired(tokens); groups = []; active = []
    for i in range(len(tokens) - 3):
        if tokens[i][0] == "fc" and tokens[i + 1][0] == "." and tokens[i + 3][0] == "(" and i + 3 in pairs:
            active.append((i + 3, pairs[i + 3], tokens[i + 2][0]))
    for start, end, function in active:
        values = []
        for j in range(start + 1, end - 1):
            key = tokens[j][0].strip("\"'")
            if key not in ("numRuns", "min", "max", "minLength", "maxLength") or tokens[j + 1][0] != ":":
                continue
            # Attribute the option only to its nearest enclosing fc call.
            if any(start < a < j < b < end for a, b, _ in active):
                continue
            n = j + 2; sign = 1
            if tokens[n][0] == "-": sign = -1; n += 1
            if re.fullmatch(r"\d+(?:\.\d+)?", tokens[n][0]):
                values.append((key, sign * float(tokens[n][0]), tokens[j][1]))
        groups.append((function, values))
    # Shared assert options, such as const options = {seed: 318, numRuns: 50}.
    for i in range(len(tokens) - 2):
        if tokens[i][0].strip("\"'") == "numRuns" and tokens[i + 1][0] == ":" and not any(a < i < b for a, b, _ in active) and re.fullmatch(r"\d+", tokens[i + 2][0]):
            groups.append(("options", [("numRuns", float(tokens[i + 2][0]), tokens[i][1])]))
    # fc.assert options often sit after fc.property; assertion itself is an fc call.
    return groups

def properties(tokens):
    return sum(tokens[i][0] == "fc" and tokens[i + 1][0] == "." and tokens[i + 2][0] in ("property", "asyncProperty") for i in range(max(0, len(tokens) - 2)))

def expects(tokens):
    calls = Counter(); pairs = paired(tokens)
    for i, (value, _) in enumerate(tokens):
        if value != "expect": continue
        j = i + 1; subject = False; signature = [value]
        while j < len(tokens):
            if j in pairs and tokens[j][0] == "(":
                end = pairs[j] + 1
                # Keep the observed value and matcher. An updated expected count
                # is still the same assertion; changing its subject is not.
                if not subject: signature.extend(v for v, _ in tokens[j:end])
                else: signature.append("()")
                subject = True; j = end
            elif j + 1 < len(tokens) and tokens[j][0] == ".":
                signature.extend(v for v, _ in tokens[j:j + 2]); j += 2
            else: break
        if j > i + 1: calls[tuple(signature)] += 1
    return calls

def replacements(path):
    if not path: return {}
    lines = Path(path).read_text().splitlines(); answer = {}; columns = None
    for line in lines:
        if "|" not in line:
            columns = None; continue
        cells = [s.strip().strip('`').strip().replace(r"\|", "|") for s in re.split(r"(?<!\\)\|", line.strip().strip('|'))]
        lower = [s.lower() for s in cells]
        if "removed" in lower and "replacement" in lower:
            columns = (lower.index("removed"), lower.index("replacement")); continue
        if columns and len(cells) > max(columns):
            old, new = (cells[i] for i in columns)
            if old and new and not re.fullmatch(r"[:\- ]+", old):
                answer[old] = new
    return answer

try:
    # Resolve both refs first. A typo is an operating error, never a clean result.
    for ref in (base, head): git("rev-parse", "--verify", f"{ref}^{{commit}}")
    paths = [p.decode() for p in git("diff", "--name-only", "-z", "--no-renames", base, head, "--").split(b"\0") if p]
    selected = subprocess.run(["python3", classifier, "exam-paths.json", *paths], capture_output=True, text=True)
    if selected.returncode not in (0, 1): raise ValueError(selected.stderr.strip())
    files = [line.split("\t", 1)[0] for line in selected.stdout.splitlines()]
    moved = replacements(mapping[0] if mapping else None)
    records = {}
    for file in files:
        old, new = (lex(content(ref, file)) for ref in (base, head))
        records[file] = (old, new, laws(old, paired(old)), laws(new, paired(new)))
    destinations = {key for _, _, _, after in records.values() for key in after}
    hits = []
    def hit(file, kind, title):
        row = f"{file}: {kind}: {title}"
        if row not in hits: hits.append(row)
    for file, (old, new, before, after) in records.items():
        for (kind, title), count in (muted(new) - muted(old)).items():
            if count: hit(file, kind, title)
        comparisons = []
        for key, (start, end, line) in before.items():
            target = key if key in after else (moved.get(key[0]), key[1])
            if target not in destinations:
                hit(file, "removed law", key[0]); continue
            owner = records[file] if target in after else next((r for r in records.values() if target in r[3]), None)
            if owner:
                a, b, _ = owner[3][target]
                comparisons.append((key[0], old[start:end], owner[1][a:b]))
        # Also inspect unnamed properties and shared settings outside named tests.
        covered_old = {i for start, end, _ in before.values() for i in range(start, end)}
        covered_new = {i for start, end, _ in after.values() for i in range(start, end)}
        comparisons.append(("line 1", [t for i, t in enumerate(old) if i not in covered_old], [t for i, t in enumerate(new) if i not in covered_new]))
        for title, left, right in comparisons:
            if properties(right) < properties(left): hit(file, "removed law", title)
            if expects(left) - expects(right): hit(file, "removed expect", title)
            a, b = bounds(left), bounds(right)
            # Match unchanged calls first. Adding a new call with a smaller range
            # must not steal the match from an unchanged, existing call.
            unmatched = []
            for function, prior in a:
                same = next((i for i, (other, values) in enumerate(b) if function == other and [(k, v) for k, v, _ in prior] == [(k, v) for k, v, _ in values]), None)
                if same is None: unmatched.append((function, prior))
                else: b.pop(same)
            for function, prior in unmatched:
                following = next((i for i, (other, _) in enumerate(b) if function == other), None)
                if following is None: continue
                _, current = b.pop(following)
                by_key = {key: value for key, value, _ in current}
                for key, value, line in prior:
                    if key not in by_key: continue
                    now = by_key[key]
                    if (key in ("min", "minLength") and now > value) or (key in ("max", "maxLength", "numRuns") and now < value):
                        hit(file, "fewer numRuns" if key == "numRuns" else "tighter fast-check bound", title if title != "line 1" else f"line {line}")
    print("\n".join(hits) if hits else f"loosening: 0 hits in {len(files)} exam files")
    sys.exit(1 if hits else 0)
except (OSError, ValueError) as error:
    print(f"loosening: {error}", file=sys.stderr)
    sys.exit(2)
PY
