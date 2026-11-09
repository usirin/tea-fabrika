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
import tempfile

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

def arguments(tokens, pairs, start, end):
    parts = []; left = start + 1; i = left
    while i < end:
        if tokens[i][0] == ",":
            parts.append((left, i)); left = i + 1
        i = pairs[i] + 1 if i in pairs else i + 1
    if left < end: parts.append((left, end))
    return parts

def declarations(tokens, pairs):
    found = {}
    for i in range(len(tokens) - 3):
        if tokens[i][0] not in ("const", "let", "var") or tokens[i + 2][0] != "=": continue
        start = i + 3; end = start
        while end < len(tokens) and tokens[end][0] not in (";", ","):
            end = pairs[end] + 1 if end in pairs else end + 1
        found[tokens[i + 1][0]] = (start, end)
    return found

def api_names(tokens, pairs):
    names = {word: word for word in ("it", "test", "describe", "suite")}
    values = [v for v, _ in tokens]
    for i, value in enumerate(values):
        if value != "import": continue
        end = next((j for j in range(i + 1, len(values)) if values[j] == ";"), len(values))
        part = values[i:end]
        if "from" not in part or name(part[part.index("from") + 1]) != "vitest": continue
        if "*" in part and "as" in part:
            namespace = part[part.index("as") + 1]
            names.update({f"{namespace}.{word}": word for word in ("it", "test", "describe", "suite")})
        for j in range(len(part) - 1):
            if part[j] in names and part[j + 1] == "as" and j + 2 < len(part):
                names[part[j + 2]] = names[part[j]]
    # Follow local aliases, including aliases of aliases. Never guess their spelling.
    pending = declarations(tokens, pairs)
    for _ in range(len(pending)):
        for alias, (start, end) in pending.items():
            target = "".join(values[start:end])
            if target in names: names[alias] = names[target]
            # Vitest's extended and parameterized functions keep being test functions.
            for width in (3, 1):
                root = "".join(values[start:start + width])
                if root in names and start + width < end and values[start + width] == ".":
                    names[alias] = names[root]
    for i in range(len(tokens) - 4):
        if values[i] not in ("const", "let", "var") or values[i + 1] != "{": continue
        end = pairs.get(i + 1)
        if end is None or end + 2 >= len(tokens) or values[end + 1] != "=": continue
        namespace = values[end + 2]
        for left, right in arguments(tokens, pairs, i + 1, end):
            root = f"{namespace}.{values[left]}"
            if root in names:
                alias = values[left + 2] if left + 2 < right and values[left + 1] == ":" else values[left]
                names[alias] = names[root]
    return names

def test_calls(tokens, pairs):
    names = api_names(tokens, pairs); found = []
    for i, (value, line) in enumerate(tokens):
        if i and tokens[i - 1][0] in (".", "function"): continue
        j = i + 1; root = value
        if j + 1 < len(tokens) and tokens[j][0] == "." and f"{root}.{tokens[j + 1][0]}" in names:
            root += "." + tokens[j + 1][0]; j += 2
        if root not in names: continue
        modifiers = []
        while j + 1 < len(tokens) and tokens[j][0] == ".":
            member = tokens[j + 1][0]; modifiers.append(member); j += 2
            if member in ("each", "for", "skipIf", "runIf") and j in pairs: j = pairs[j] + 1
        if j not in pairs or j + 1 >= len(tokens) or not quoted(tokens[j + 1][0]): continue
        found.append((names[root], name(tokens[j + 1][0]), i, j, pairs[j], line, modifiers))
    return found

def laws(tokens, pairs):
    found = {}
    for kind, title, start, _, end, line, _ in test_calls(tokens, pairs):
        if kind not in ("it", "test"): continue
        # Keep duplicate names separate instead of silently dropping a law.
        ordinal = sum(k[0] == title for k in found)
        found[(title, ordinal)] = (start, end + 1, line)
    return found

def fields(tokens, pairs, variables, start, end, seen=(), external=None):
    if end - start == 1 and tokens[start][0] in variables:
        key = tokens[start][0]
        if key in seen: return {}
        return fields(tokens, pairs, variables, *variables[key], (*seen, key), external)
    if end - start == 1 and external and tokens[start][0] in external:
        return external[tokens[start][0]]
    if start >= end or tokens[start][0] != "{" or pairs.get(start) != end - 1: return {}
    answer = {}
    for left, right in arguments(tokens, pairs, start, end - 1):
        values = [v for v, _ in tokens[left:right]]
        if values[:3] == [".", ".", "."]:
            answer.update(fields(tokens, pairs, variables, left + 3, right, seen, external))
        elif len(values) >= 3 and values[1] == ":":
            answer[values[0].strip("\"'")] = values[2:]
        elif len(values) == 1:
            answer[values[0]] = values # A shorthand or unknown value needs an owner read.
    return answer

def muted(tokens):
    result = Counter(); pairs = paired(tokens); variables = declarations(tokens, pairs)
    for kind, title, _, start, end, _, modifiers in test_calls(tokens, pairs):
        if kind in ("describe", "suite"): title = "describe " + title
        flags = list(modifiers)
        for left, right in arguments(tokens, pairs, start, end)[1:]:
            flags.extend(key for key, value in fields(tokens, pairs, variables, left, right).items() if value != ["false"])
        for member in flags:
            if member in ("skip", "todo", "fails", "only", "skipIf", "runIf"):
                result[("it.fails" if member == "fails" else member, title)] += 1
    return result

def bounds(tokens, scope):
    pairs = paired(tokens); groups = {}; active = []; variables = declarations(tokens, pairs)
    scope_pairs = paired(scope); scope_variables = declarations(scope, scope_pairs)
    external = {key: fields(scope, scope_pairs, scope_variables, start, end) for key, (start, end) in scope_variables.items()}
    for i in range(len(tokens) - 3):
        if tokens[i][0] == "fc" and tokens[i + 1][0] == "." and tokens[i + 3][0] == "(" and i + 3 in pairs:
            active.append((i + 3, pairs[i + 3], tokens[i + 2][0]))

    def binding(position):
        owners = [(end - start, key) for key, (start, end) in variables.items() if start <= position < end]
        return min(owners)[1] if owners else ""

    def argument(start, position):
        return next((i for i, (a, b) in enumerate(arguments(tokens, pairs, start, pairs[start])) if a <= position < b), -1)

    def context(position):
        return tuple((function, argument(start, position)) for start, end, function in active if start < position < end)

    # Calls match by binding and enclosing argument, not by equal option values.
    # An unused call cannot stand in for the generator passed to a property.
    counts = Counter()
    for start, end, function in active:
        identity = (binding(start), context(start), function)
        ordinal = counts[identity]; counts[identity] += 1
        options = {}
        for left, right in arguments(tokens, pairs, start, end):
            options.update(fields(tokens, pairs, variables, left, right, external=external))
        groups[(*identity, ordinal)] = (options, tokens[start][1])
    # Compare shared objects too. Their uses can be outside a named test.
    for variable, (start, end) in variables.items():
        options = fields(tokens, pairs, variables, start, end)
        if options: groups[(variable, (), "options", 0)] = (options, tokens[start][1])
    return groups

def numeric(value):
    text = "".join(value)
    return float(text) if re.fullmatch(r"-?\d+(?:\.\d+)?", text) else None

def narrowing(left, right):
    for identity in left.keys() | right.keys():
        prior, line = left.get(identity, ({}, right.get(identity, ({}, 1))[1]))
        current, _ = right.get(identity, ({}, line))
        # A whole new call or object is an addition, not a change to an old range.
        if identity not in left: continue
        for key in ("numRuns", "min", "max", "minLength", "maxLength"):
            if key not in prior and key not in current: continue
            before = numeric(prior[key]) if key in prior else None
            now = numeric(current[key]) if key in current else None
            if key == "numRuns":
                # fast-check 4.10.2, readNumRuns: absent numRuns means 100.
                before = 100 if key not in prior else before
                now = 100 if key not in current else now
            if prior.get(key) == current.get(key): continue
            unsure = (key in prior and before is None) or (key in current and now is None)
            added = key != "numRuns" and key not in prior and key in current
            tighter = before is not None and now is not None and (now > before if key in ("min", "minLength") else now < before)
            if unsure or added or tighter:
                yield "fewer numRuns" if key == "numRuns" else "tighter fast-check bound", line

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
    selected_paths = set()
    with tempfile.TemporaryDirectory(prefix="exam-lists-") as temporary:
        for ref in (base, head):
            source = Path(temporary) / "exam-paths.json"
            source.write_text(content(ref, "exam-paths.json") or "[]")
            selected = subprocess.run(["python3", classifier, str(source), *paths], capture_output=True, text=True)
            if selected.returncode not in (0, 1): raise ValueError(selected.stderr.strip())
            selected_paths.update(line.split("\t", 1)[0] for line in selected.stdout.splitlines())
    files = [path for path in paths if path in selected_paths]
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
                comparisons.append((key[0], old[start:end], owner[1][a:b], owner[1]))
        # Also inspect unnamed properties and shared settings outside named tests.
        covered_old = {i for start, end, _ in before.values() for i in range(start, end)}
        covered_new = {i for start, end, _ in after.values() for i in range(start, end)}
        comparisons.append(("line 1", [t for i, t in enumerate(old) if i not in covered_old], [t for i, t in enumerate(new) if i not in covered_new], new))
        for title, left, right, scope in comparisons:
            if properties(right) < properties(left): hit(file, "removed law", title)
            if expects(left) - expects(right): hit(file, "removed expect", title)
            for kind, line in narrowing(bounds(left, old), bounds(right, scope)):
                hit(file, kind, title if title != "line 1" else f"line {line}")
    print("\n".join(hits) if hits else f"loosening: 0 hits in {len(files)} exam files")
    sys.exit(1 if hits else 0)
except (OSError, ValueError) as error:
    print(f"loosening: {error}", file=sys.stderr)
    sys.exit(2)
PY
