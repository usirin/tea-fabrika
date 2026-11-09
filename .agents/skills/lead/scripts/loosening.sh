#!/bin/sh
# Today's tooling: compare exam content at two local refs. No checkout or network.
# Fail closed: a pattern parser cannot cover every form TypeScript can write.
# A hit goes to the lead's hand check, with the hit list in the PR.
# Only real loosening waits on the owner.
set -eu
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || {
    cat >&2 <<'HELP'
usage: loosening.sh <base> <head> [mapping.md]
Fail closed: a pattern parser cannot cover every form TypeScript can write.
A hit goes to the lead's hand check, with the hit list in the PR.
Only real loosening waits on the owner.
Exit 0: no hits; 1: hits; 2: operating error or bad arguments.
HELP
    exit 2
}
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
                # Name a removed assertion by subject and matcher. The separate
                # fail-closed check flags changes to its expected value too.
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

def values(tokens):
    return [value for value, _ in tokens]

def statement_ranges(tokens):
    """Only these boundaries permit insertions. Never descend into an old test.

    Unknown statements can stay byte-for-token identical. They cannot acquire
    inserts. An unfamiliar delimiter or statement shape simply fails closed.
    """
    pairs = paired(tokens); result = {}; boundaries = set()
    def block(left, right):
        boundaries.add(left); boundaries.add(right)
        start = left
        while start < right:
            end = start
            while end < right:
                if tokens[end][0] == ";":
                    end += 1; break
                end = pairs[end] + 1 if end in pairs else end + 1
                # ASI: a new declaration or test on a new line cannot continue
                # the preceding expression. Do not guess about other starts.
                if end < right and tokens[end][1] > tokens[end - 1][1] and tokens[end][0] in (
                    "const", "let", "var", "import", "it", "test", "describe", "suite"
                ):
                    break
            result[start] = end; boundaries.add(end)
            # A plain describe's synchronous arrow body is another statement
            # list. Other callbacks, functions and blocks are never opened.
            part = values(tokens[start:end])
            if part[:2] == ["describe", "("] and start + 1 in pairs:
                close = pairs[start + 1]
                args = arguments(tokens, pairs, start + 1, close)
                if len(args) == 2:
                    a, b = args[1]
                    if values(tokens[a:a + 4]) == ["(", ")", "=>", "{"] and pairs.get(a + 3) == b - 1:
                        block(a + 4, b - 1)
            start = end
    block(0, len(tokens))
    return result, boundaries

def shared_state(tokens):
    words = values(tokens)
    # These calls change other laws. Check the whole added statement, including
    # callbacks and const initializers. Computed access is too uncertain to clear.
    hooks = {"beforeEach", "afterEach", "beforeAll", "afterAll"}
    for i, word in enumerate(words):
        if word in hooks or word in ("vi", "process", "globalThis", "global"):
            return True
        if words[i:i + 3] in (["fc", ".", "configureGlobal"], ["expect", ".", "extend"]):
            return True
        if word in ("delete", "++", "--") or words[i:i + 2] in (["+", "+"], ["-", "-"]):
            return True
    return False

def safe_statement(tokens, old_names, new_names):
    words = values(tokens)
    if words[-1:] == [";"]: words = words[:-1]; tokens = tokens[:-1]
    if not words: return False
    pairs = paired(tokens)
    if words[0] == "import":
        # An import with bindings adds names. A bare import runs shared setup.
        return len(words) >= 4 and "from" in words and not quoted(words[1]) and quoted(words[-1])
    if shared_state(tokens): return False
    if words[0] == "const":
        if len(words) < 4 or not re.fullmatch(r"[A-Za-z_$][\w$]*", words[1]) or words[2] != "=": return False
        if words[1] in old_names or new_names[words[1]] != 1: return False
        # A helper may hold data, a function, or a fast-check generator. Unknown
        # eager calls and writes may change shared state, so request a hand check.
        for i in range(3, len(words)):
            if words[i] == "=" and words[i + 1:i + 2] != [">"]: return False
            if words[i] == "(" and i and re.fullmatch(r"[A-Za-z_$][\w$]*", words[i - 1]):
                if i < 3 or words[i - 3:i - 1] != ["fc", "."]: return False
        return True
    if words[0] not in ("it", "test", "describe") or words[1:2] != ["("] or pairs.get(1) != len(words) - 1: return False
    args = arguments(tokens, pairs, 1, len(words) - 1)
    if len(args) != 2 or args[0][1] - args[0][0] != 1: return False
    title = words[args[0][0]]
    if not quoted(title) or (title.startswith('`') and "${" in title): return False
    a, b = args[1]
    if words[a:a + 3] != ["(", ")", "=>"]: return False
    if words[0] == "describe":
        if words[a + 3:a + 4] != ["{"] or pairs.get(a + 3) != b - 1: return False
        body = tokens[a + 4:b - 1]
        spans, _ = statement_ranges(body)
        start = 0
        while start < len(body):
            end = spans[start]
            if not safe_statement(body[start:end], old_names, new_names): return False
            start = end
    return True

def pure_additions(old, new):
    if values(old) == values(new): return True
    spans, _ = statement_ranges(new)
    _, boundaries = statement_ranges(old)
    old_names = set(values(old))
    # Duplicate const bindings cannot count as new names, even in two inserts.
    new_names = Counter(new[i + 1][0] for i in range(len(new) - 1) if new[i][0] == "const")
    inserts = {a: b for a, b in spans.items() if safe_statement(new[a:b], old_names, new_names)}
    pending = [(0, 0)]; visited = set()
    while pending:
        a, b = pending.pop()
        if (a, b) in visited: continue
        visited.add((a, b))
        if a == len(old) and b == len(new): return True
        if a in boundaries and b in inserts: pending.append((a, inserts[b]))
        if a < len(old) and b < len(new) and old[a][0] == new[b][0]: pending.append((a + 1, b + 1))
    return False

def mapped_tokens(records, moved):
    # A mapping is permission for exactly a title swap, never a changed body.
    # Match once across all exam files, so a law may move between retained files.
    removed = {file: set() for file in records}; added = {file: set() for file in records}
    normalized = {file: list(old) for file, (old, _, _, _) in records.items()}
    used = set()
    for file, (old, _, before, _) in records.items():
        for (title, ordinal), (start, end, _) in before.items():
            if title not in moved: continue
            for destination, (_, new, _, after) in records.items():
                key = (moved[title], ordinal)
                if key not in after or (destination, key) in used: continue
                a, b, _ = after[key]
                left, right = values(old[start:end]), values(new[a:b])
                old_call = next((c for c in test_calls(old, paired(old)) if c[2] == start), None)
                new_call = next((c for c in test_calls(new, paired(new)) if c[2] == a), None)
                if not old_call or not new_call: continue
                offset = old_call[3] + 1 - start
                if offset != new_call[3] + 1 - a: continue
                left[offset] = right[offset]
                if left != right: continue
                used.add((destination, key))
                if destination == file:
                    normalized[file][start + offset] = new[a + offset]
                else:
                    # Consume a whole statement, including its optional terminator.
                    removed[file].update(range(start, end + (end < len(old) and old[end][0] == ";")))
                    added[destination].update(range(a, b + (b < len(new) and new[b][0] == ";")))
                break
    return {file: ([t for i, t in enumerate(normalized[file]) if i not in removed[file]],
                   [t for i, t in enumerate(record[1]) if i not in added[file]])
            for file, record in records.items()}

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
    deleted = {p.decode() for p in git("diff", "--name-only", "-z", "--no-renames", "--diff-filter=D", base, head, "--").split(b"\0") if p}
    records = {}
    for file in files:
        old, new = (lex(content(ref, file)) for ref in (base, head))
        records[file] = (old, new, laws(old, paired(old)), laws(new, paired(new)))
    destinations = {key for _, _, _, after in records.values() for key in after}
    normalized = mapped_tokens(records, moved)
    hits = []
    def hit(file, kind, title):
        row = f"{file}: {kind}: {title}"
        if row not in hits: hits.append(row)
    for file, (old, new, before, after) in records.items():
        left, right = normalized[file]
        if file in deleted or not re.search(r"\.(?:test|spec)\.[cm]?[jt]sx?$", file) or not pure_additions(left, right):
            position = next((i for i, (a, b) in enumerate(zip(old, new)) if a[0] != b[0]), min(len(old), len(new)))
            line = new[min(position, len(new) - 1)][1] if new else (old[min(position, len(old) - 1)][1] if old else 1)
            hit(file, "unrecognized change", f"line {line}")
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
