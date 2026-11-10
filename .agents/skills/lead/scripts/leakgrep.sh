#!/bin/sh
# Today's tooling. Check a unified diff on stdin, or a whole draft with --text <file>.
# Private words are literal, case-insensitive strings, one per line, outside the Git tree.
# Diagnostics name only the kind and added-line number, never matched text or private words.
# In a diff, an added line that only respaces a line the same file's diff removes is old text.
# A line is read the way git writes it: up to the newline, and nothing else ends one.
set -eu
# Only deliberate diagnostics use fd 3. Shell and tool failures may contain private paths.
exec 3>&2 2>/dev/null
input=$(mktemp "${TMPDIR:-/tmp}/lg.XXXXXX" 2>/dev/null) || {
    echo 'leakgrep: cannot create check input' >&3; exit 2;
}
trap 'rm -f "$input" 2>/dev/null || :' EXIT HUP INT TERM
case $# in
    0) cat > "$input" || { echo 'leakgrep: cannot read check input' >&3; exit 2; }; mode=diff ;;
    2) [ "$1" = --text ] || { echo 'leakgrep: usage: leakgrep.sh [--text file]' >&3; exit 2; }
       cat -- "$2" > "$input" || { echo 'leakgrep: cannot read check input' >&3; exit 2; }; mode=text ;;
    *) echo 'leakgrep: usage: leakgrep.sh [--text file]' >&3; exit 2 ;;
esac
python3 - "$input" "$mode" <<'PY'
from pathlib import Path
import os, re, subprocess, sys
diagnostics = os.fdopen(3, 'w')

def refuse(why):
    print('leakgrep: ' + why, file=diagnostics)
    sys.exit(2)

where = Path(os.environ.get('FABRIKA_LEAK_WORDS', str(Path.home() / '.fabrika/leak-words')))
tree = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
if tree.returncode:
    refuse('cannot find repository')
try:
    words_path = where.resolve()
    if words_path.is_relative_to(Path(tree.stdout.strip()).resolve()):
        refuse('private words must stay outside the repo')
    try:
        words = [w.strip().casefold() for w in words_path.read_text().splitlines() if w.strip()]
    except FileNotFoundError:
        words = []
        print('leakgrep: private word list is missing; checking built-in shapes only', file=diagnostics)
    # Bytes, then UTF-8: reading as text would rewrite the line ends before the check saw them.
    text = Path(sys.argv[1]).read_bytes().decode('utf-8')
except (OSError, UnicodeError):
    refuse('cannot read check input')

# Only this repository's exact GitHub URL may contain a private account or repo name.
repo_url = 'https://github.com/usirin/tea-fabrika'
own_url = re.compile(re.escape(repo_url) + r'(?:\.git)?(?=$|[\s/#?)>]|\.(?=$|[\s)>]))')
# Provider lengths from https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
# npm/GitHub: 36; fine-grained GitHub: 82; OpenAI: 48 legacy, 124 project/service/admin.
# Keep the provider alphabets and minimum lengths, without relying on embedded brand markers.
# OpenSSH's short sk- type names contain punctuation outside these key payloads.
patterns = [
    # Decision 0011: a plain path under /tmp passes; a first part ending in -<number> may hold a user id.
    # Home folders match in their real case (/Users on a Mac, /home on Linux), so a lowercase API
    # path such as GitHub's /users/<name>/keys passes. The temp folders and C:\Users match in any case.
    ('machine_path', re.compile(r'/(?:Users|home)/|(?i:/(?:private/tmp|private/var/folders|var/folders)/|/tmp/[^/\s]*-[0-9]+(?![^/\s"\'`)\]>,;:])|[A-Za-z]:[\\/]Users[\\/])')),
    ('key', re.compile(r'\b(?:npm_[A-Za-z0-9]{36,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{82,}|sk-(?:[A-Za-z0-9]{48,}|(?:proj|svcacct|admin)-[A-Za-z0-9_-]{124,}))|-----BEGIN (?:[A-Z ]*PRIVATE )?KEY-----')),
    ('em_dash', re.compile(chr(0x2014))),
    ('canvas', re.compile(r'https?://(?:claude\.ai/(?:design|artifacts)|[^/\s]*\.claude\.site)(?:[/?#]|$)', re.I)),
]
def kinds_of(line):
    public = own_url.sub('', line).casefold()
    kinds = ['private_word'] if any(w in public for w in words) else []
    return kinds + [kind for kind, pattern in patterns if pattern.search(line)]

# Ticket 500 (owner, 2026-11-09): a line that only changes spacing is old text. Two lines hold the
# same text when they are equal after each run of spaces and tabs becomes one space, the ends are
# trimmed and one last ; or , is dropped. Runs are collapsed, never deleted, so two words never join.
# A carriage return before the newline is part of the line end here, as it always was. The scan
# itself still reads it.
def same_text(line):
    text = re.sub(r'[ \t]+', ' ', line.removesuffix('\r')).strip(' ')
    return text[:-1].rstrip(' ') if text.endswith((';', ',')) else text

added = []
# The hits of each removed line, by file and text. Only a hunk under git's own `diff --git` header
# counts, so a removal never reaches another file, another commit's diff or a diff git did not write.
removed = {}
file = None
in_hunk = False
old_header = False
# Git ends a diff line at the newline only, so the check does too.
for number, line in enumerate(text.split('\n'), 1):
    if sys.argv[2] == 'diff':
        if line.startswith('diff '): file = number if line.startswith('diff --git ') else None
        if line.startswith('diff --git '): in_hunk = False
        if line.startswith('@@ '): in_hunk = True
        header = line.startswith('+++ ') and not in_hunk and old_header
        old_header = line.startswith('--- ') and not in_hunk
        if line.startswith('-') and in_hunk and file is not None:
            removed.setdefault((file, same_text(line[1:])), []).append(kinds_of(line[1:]))
        if not line.startswith('+') or header:
            continue
        added.append((number, file if in_hunk else None, line[1:]))
    else:
        added.append((number, None, line))
bad = 0
respaced = 0
for number, file, line in added:
    kinds = kinds_of(line)
    # One removed line clears one added line, and only the kinds of hit it had itself.
    old = removed.get((file, same_text(line))) if kinds else None
    if old:
        cleared = old.pop(0)
        respaced += all(kind in cleared for kind in kinds)
        kinds = [kind for kind in kinds if kind not in cleared]
    for kind in kinds:
        print(f'leakgrep: leak {kind} at added line {number}', file=diagnostics)
        bad += 1
if respaced:
    print(f'leakgrep: {respaced} flagged lines only respace a removed line of their file; read as old text', file=diagnostics)
if not bad:
    print('leakgrep: added text clean')
sys.exit(1 if bad else 0)
PY
