#!/usr/bin/env python3
"""exam.py <exam-paths.json> <path>...: print each path that is an exam path, with its glob."""
import json, re, sys
def rx(glob):
    out = ""; i = 0
    while i < len(glob):
        c = glob[i]
        if glob.startswith("**/", i): out += "(?:.*/)?"; i += 3; continue
        if glob.startswith("**", i): out += ".*"; i += 2; continue
        out += "[^/]*" if c == "*" else re.escape(c); i += 1
    return re.compile("^" + out + "$")
rows = [(r["glob"], rx(r["glob"])) for r in json.load(open(sys.argv[1]))]
hit = 0
for p in sys.argv[2:]:
    for g, r in rows:
        if r.match(p): print(f"{p}\t{g}"); hit += 1; break
sys.exit(1 if hit else 0)
