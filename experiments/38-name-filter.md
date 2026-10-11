# 38. A free filter before the missing-file check

`38-name-filter.ts`. The missing-file check of experiment 36 asks Jev about every
untouched file in the touched packages: about 1,500 files, 13,000 tokens each,
about $0.80 a review. Can plain code (git and text search, no Jev) cut that
list first and still keep the forgotten file? The script rebuilds the same 28
trials and 9 controls (`lib/missing-trials.ts`, now shared with the probe) and
checks that each has the very candidates Jev scored. No Jev call; it runs in
about 45s.

Each filter keeps a candidate when:

- **paths**: it names a changed file the way an import does: the changed
  file's stem (its name up to the first dot, so `check-verb.unit.test.ts` is
  `check-verb`) right after `/`, `'`, `"` or a backtick and right before `.`
  or a quote.
- **uses**: the other way round: a changed file, as the PR left it, names the
  candidate's stem that way.
- **stems**: it holds a changed file's stem as a whole word anywhere.
- **names@N%**: it holds, as a whole identifier, a name from the diff's added
  or removed lines (`[A-Za-z_$][\w$]*`, 4 letters or more, not a keyword or a
  stock word like `value` or `expect`), counting only names found in N% of
  the candidates or fewer. A name in most files matches everything.
- **folder**: it sits in the same folder as a changed file.
- **twin**: same folder and stem as a changed file (`x.ts` and `x.unit.test.ts`).
- **cochange**: it changed in the same commit as a changed file, over the last
  50 commits touching one, skipping commits of more than 20 files.
- **+**: the union of filters.

Jev scores each file on its own, so its saved scores still hold on any shorter
list. "Caught" is the forgotten file kept and at 0.5 or more; "wrong flags"
are other kept files at 0.5 or more. Cost is kept files × 13,000 tokens ×
$0.042 a million, per review.

| Filter | Forgotten file kept | Jev's 22 wins kept | Caught | Wrong flags | Files kept, median / max | $ a review, median / max | Controls, median kept |
|---|---|---|---|---|---|---|---|
| none (today) | 28 / 28 | 22 | 22 | 5 | 1,500 / 1,591 | 0.82 / 0.87 | 1,509 |
| paths | 21 / 28 | 17 | 17 | 3 | 24 / 163 | 0.013 / 0.089 | 26 |
| uses | 22 / 28 | 18 | 18 | 1 | 113 / 369 | 0.061 / 0.20 | 116 |
| **paths + uses** | 28 / 28 | 22 | 22 | 3 | 119 / 462 | 0.065 / 0.25 | 122 |
| stems | 27 / 28 | 21 | 21 | 3 | 132 / 448 | 0.072 / 0.25 | 136 |
| names@1% | 24 / 28 | 20 | 20 | 1 | 61 / 170 | 0.033 / 0.093 | 71 |
| names@2% | 28 / 28 | 22 | 22 | 3 | 155 / 419 | 0.085 / 0.23 | 182 |
| names@5% | 28 / 28 | 22 | 22 | 4 | 344 / 947 | 0.19 / 0.52 | 349 |
| names@20% | 28 / 28 | 22 | 22 | 5 | 1,328 / 1,538 | 0.73 / 0.84 | 1,349 |
| paths + names@2% | 28 / 28 | 22 | 22 | 4 | 184 / 419 | 0.10 / 0.23 | 215 |
| paths + names@5% | 28 / 28 | 22 | 22 | 5 | 361 / 947 | 0.20 / 0.52 | 389 |
| folder | 28 / 28 | 22 | 22 | 2 | 30 / 97 | 0.016 / 0.053 | 29 |
| paths + folder | 28 / 28 | 22 | 22 | 3 | 44 / 247 | 0.024 / 0.14 | 54 |
| paths + uses + folder | 28 / 28 | 22 | 22 | 3 | 133 / 475 | 0.073 / 0.26 | 136 |
| twin | 24 / 28 | 20 | 20 | 0 | 1 / 2 | 0.001 / 0.001 | 0 |
| cochange | 5 / 28 | 4 | 4 | 0 | 0 / 102 | 0 / 0.056 | 1 |
| cochange, no size cap | 28 / 28 | 22 | 22 | 5 | 1,328 / 1,464 | 0.73 / 0.80 | 1,327 |

No forgotten file was dropped by every filter. Each one-way filter loses a
direction. **paths** keeps files that import a changed file, so it drops a
source file that imports nothing the change touched, typically one whose own
test changed (`leaks.ts`, `flags.ts`, `index-table.ts`, `spec.ts`,
`signatures.ts`, `sync-verb.ts`), and in #8770 `port.ts`, which `shape.ts`
imports, not the other way. **uses** keeps what a changed file imports, so it
drops a forgotten test: tests import the code, the code never imports its
tests. Together they keep all 28. **names@1%** drops `port.ts` too: the names
it shares with the diff are in more than 1% of the package, which is what a
widely used type looks like. **twin** misses files with no namesake in the
change (`command.ts`, `port.ts`, `bin.ts`, `boot.unit.test.ts`). **cochange**
fails on phoenix's history: the commits touching a file are mostly big
squashes (the only three before #10239 touching `leaks.ts` or its test
changed 89, 134 and 4,591 files), so with a size cap almost nothing is left, and without one
almost everything is.

**paths + uses** (an import neighbour one step either way, by name) keeps
every forgotten file and every Jev win, at about a twelfth of the list: $0.065
a review at the median, $0.25 at worst, against $0.82. It also drops 2 of the
5 wrong flags. On the controls the list is the same size (median 122), so the
cut does not depend on something being hidden.

**folder** looks better still (median 30), but these PRs were picked to stay
inside one or two folders (the scout probe's list), so every forgotten file
here shares a folder with a changed file by construction. It is not evidence
that a forgotten file usually sits next to the change. The misses of
experiment 36 were knock-ons across a type or a caller, the kind a folder
filter would lose on other PRs.

Caveats: 28 trials from 9 PRs in one repo, mostly pairs of code and test.
"Paths" and "uses" match names, not a resolved import graph: a stem like
`index` or `types` matches any file of that name. How much of the 462-file
maximum (#10500) that explains was not checked. The cost assumes every kept
file costs 13,000 tokens like the average one; the size of the kept files was
not measured. A forgotten file that nothing imports and that imports nothing
changed (a doc, a config listing) would be lost by paths + uses; there was
none in these trials.

Open: resolve imports with the typechecker instead of by name, to cut the
stem noise? Try PRs that cross folders, so the folder filter gets a fair test.

Since then: paths + uses is the missing-file check's default
(`missing_scope = "imports"`; `"package"` is the old behaviour). The rule lives
in `src/imports.ts`, and this script imports it from there, so the measured
rule and the shipped one are the same code; a rerun on it gave the same table.
