#!/bin/sh
# Today's tooling. Check a unified diff on stdin, or a whole draft with --text <file>.
# Private words are literal, case-insensitive strings, one per line, outside the Git tree.
# Diagnostics name only the kind and added-line number, never matched text or private words.
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
    text = Path(sys.argv[1]).read_text()
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
    ('machine_path', re.compile(r'/(?:Users|home|tmp|private/tmp|private/var/folders|var/folders)/|[A-Za-z]:[\\/]Users[\\/]', re.I)),
    ('key', re.compile(r'\b(?:npm_[A-Za-z0-9]{36,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{82,}|sk-(?:[A-Za-z0-9]{48,}|(?:proj|svcacct|admin)-[A-Za-z0-9_-]{124,}))|-----BEGIN (?:[A-Z ]*PRIVATE )?KEY-----')),
    ('em_dash', re.compile(chr(0x2014))),
    ('canvas', re.compile(r'https?://(?:claude\.ai/(?:design|artifacts)|[^/\s]*\.claude\.site)(?:[/?#]|$)', re.I)),
]
bad = 0
in_hunk = False
old_header = False
for number, line in enumerate(text.splitlines(), 1):
    if sys.argv[2] == 'diff':
        if line.startswith('diff --git '): in_hunk = False
        if line.startswith('@@ '): in_hunk = True
        header = line.startswith('+++ ') and not in_hunk and old_header
        old_header = line.startswith('--- ') and not in_hunk
        if not line.startswith('+') or header:
            continue
        line = line[1:]
    public = own_url.sub('', line).casefold()
    kinds = ['private_word'] if any(w in public for w in words) else []
    kinds += [kind for kind, pattern in patterns if pattern.search(line)]
    for kind in kinds:
        print(f'leakgrep: leak {kind} at added line {number}', file=diagnostics)
        bad += 1
if not bad:
    print('leakgrep: added text clean')
sys.exit(1 if bad else 0)
PY
