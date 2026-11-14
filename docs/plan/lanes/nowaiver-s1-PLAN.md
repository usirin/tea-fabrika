Approved by the lead agent, builds 0524 and 0168 (owner ruling 2026-11-13); body 38e58a0e85f8
Plancheck-Version: 3

# Plan: no list lets broken code pass, slice 1: CI refuses a row added to a list file (ticket 933)

Version: CI and lint tooling, serving both versions. The new check lives in `next/`'s exam folder,
beside `compiler.ts` and `edges.ts`, and guards three list files: `next-ledger.json` (`next/`),
`agents-ledger.json` (lead tooling) and `unreachable-ledger.json` (today's code-graph list). All
counts were read on `origin/main` at `59cb6a311`.

It builds [0524](.decisions/0524-no-list-lets-broken-code-pass.md) ("No list
grows. A check holds that for the list files until they go", and "a list file is an exam path until
it is deleted"), [0168](.decisions/0168-old-lint-breaks-are-fixed.md) and slice 1,
laws L1 and L2 of [the whole plan](docs/plan/no-waiver-lists.md). 0524 and the
whole plan are in an open docs pull request, not on main yet.

```ts
// The whole idea (a sketch): one step in CI's `check` job, after `pnpm lint`.
//   node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"
for (const list of LISTS) {
  const before = yield* rowsAt(base, list);   // [] when the file is absent at the base
  const after = yield* rowsAt("HEAD", list);  // [] when the pull request deleted it
  const grew = added(before.map(list.key), after.map(list.key));
  // grew = [] -> done. Shrinking, pruning, reordering and a new reason pass.
  // grew = [row] -> stuck "row_added", exit 1: the pull request is refused.
}
```

## How others do it

- **A ratchet.** The industry name for a list of old findings that may only shrink is a ratchet:
  Betterer's `.betterer.results` fails CI when a result gets worse, and code-graph itself ships a
  ratchet (`src/ratchet/scope-count.ts` in `@demlik/code-graph@0.15.0`'s `dist/index.js`, which
  fails when a scope's count rises above its ceiling). Read: code-graph, installed here. Betterer:
  from memory, not fetched. The plain way compares the list at the base with the list at the head,
  which is what this plan does.
- **Compare against the base, never trust the head's own claim.** `field-check.ts`
  (`.github/ci/field-check.ts`, `selectAdded`) already counts lines the head has beyond the base,
  as a multiset, so a line twice needs two at the base. The same counting fits here, keyed by
  finding, not by text.
- **The base comes from the event.** The `promises` step in `check.yaml` fetches `$BASE` by sha
  (`git fetch --no-tags --depth=1 origin "$BASE"`) because the `check` job's checkout is shallow.
  `commits.ts` fetches by sha with `effect/process` inside the script (its `--fetch` flag), and
  `edges.ts` reads git the same way. This plan does the second, so the workflow line stays one
  command.
- **No list file can be trusted to say what it holds.** CI's three "ledger committed" steps run
  `git diff --exit-code` on each file. That proves the pruned file was committed, not that no row
  was added (the whole plan, "Code-graph files").

## What makes two rows the same finding

The check counts a row as added unless the base holds the same finding. "Same" is what each list's
own reader matches on, read from the code on main:

| List | Reader | Same finding when | Not part of it |
|---|---|---|---|
| `next-ledger.json`, `agents-ledger.json` | `oxlint-plugins/ledger.ts`, `settle` and `key` | `file`, `rule` and `code` are equal strings, counted: each entry covers one finding, so a second equal row is a new row | extra keys (`lint.ts` reads the JSON raw and `settle` keys only the three), the order |
| `unreachable-ledger.json` | code-graph 0.15.0, `findingKey` in `src/unreachable/ledger.ts` | `scope`, `kind` and `id` are equal | `reason`, the order; code-graph refuses a duplicate key, so counting changes nothing |

Two cases worth naming:

- A `code` that changes only by spaces is a new finding. `lint.ts` matches the finding's
  `fingerprint` exactly against the entry's `code`, so the edited row could start waiving a line
  the old one did not. It counts as added.
- An unreachable row whose `scope` or `kind` changes is a new key. code-graph's `covers2` lets a
  row of one kind or scope cover a finding of another, so a moved row can hide more. It counts as
  added. A changed `reason` hides nothing and passes.

A file present at the head and absent at the base is all added rows. A file deleted at the head
passes: that is where every list is going.

## The shape

The check is `next/apps/fabrika/src/exam/ratchet.ts`, run by `node`, with Effect and
`@effect/platform-node`, which `@kampus/fabrika` already depends on, so no dependency and no
lockfile line is added. Why this folder and not `.github/ci/`, where the whole plan's slice 1 put
it: `.github/ci` depends on `effect` but not `@effect/platform-node`, so a script there would need
a new dependency or `node:child_process` (as `field-check.ts` uses), and it is not linted by
`next/`'s rules. The exam folder already holds the scripts that guard lists and run in CI
(`compiler.ts` reads `compiler-ledger.json`; `edges.ts` takes `--base`), and every file in it is an
exam path. 85% sure; the doubt is a reader who expects all CI scripts under `.github/ci`.

Why `ratchet` and not `ledgers`: in `next/` "ledger" is the event log (`.glossary/TERMS.md`, the
Ledger context), and 0212 gives a word one meaning. The build adds a glossary row for `ratchet
(exam)`.

```ts
// next/apps/fabrika/src/exam/ratchet.ts (a sketch; names are the build's to settle within this)
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Schema } from "effect";
import { ChildProcess } from "effect/process";

const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

/** Where the change starts. "" and forty zeros are `none`: a first push has no base. */
export const Base = Schema.TaggedUnion({ none: {}, at: { sha: Sha } });

const LintRow = Schema.Struct({ file: Schema.String, rule: Schema.String, code: Schema.String });
const DeadRow = Schema.Struct({ scope: Schema.String, kind: Schema.String, id: Schema.String });
const entries = <S extends Schema.Top>(row: S) =>
  Schema.fromJsonString(Schema.Struct({ entries: Schema.Array(row) }));

/** Each list file, and the key its own reader matches a row on. */
export const LISTS = [
  { file: "next-ledger.json", decode: entries(LintRow), key: (r) => JSON.stringify([r.file, r.rule, r.code]) },
  { file: "agents-ledger.json", decode: entries(LintRow), key: (r) => JSON.stringify([r.file, r.rule, r.code]) },
  { file: "unreachable-ledger.json", decode: entries(DeadRow), key: (r) => JSON.stringify([r.scope, r.kind, r.id]) },
] as const;

/** The keys `head` holds beyond `base`, counted, in head order (ledger.ts's one entry per finding). */
export const added = (base: ReadonlyArray<string>, head: ReadonlyArray<string>): ReadonlyArray<string> => {
  const left = new Map<string, number>();
  for (const k of base) left.set(k, (left.get(k) ?? 0) + 1);
  return head.filter((k) => {
    const n = left.get(k) ?? 0;
    left.set(k, n - 1);
    return n <= 0;
  });
};

export const Answer = Schema.TaggedUnion({
  done: { file: Schema.String },
  stuck: {
    file: Schema.String,
    reason: Schema.Literals(["row_added", "not_a_list"]),
    rows: Schema.Array(Schema.String),
  },
});
export type Answer = typeof Answer.Type;

/** One list's answer from its text at the base and at the head; null means the file is absent. */
export const judge: (list: List, base: string | null, head: string | null) => Effect.Effect<Answer, BaseUnreadable>;
```

The edge, in the same file, as `edges.ts` does it:

- Reads `--base`, decodes it to `Base`. Anything that is neither a sha, `""`, nor forty zeros fails
  with exit 2.
- `none`: prints `ratchet: no base, nothing to compare` and exits 0.
- `at`: finds the top with `git rev-parse --show-toplevel`. If `git cat-file -e <sha>^{commit}`
  fails (the `check` job's shallow checkout), runs `git fetch --no-tags -q --depth=1 origin <sha>`.
- For each list, reads `<sha>:<file>` and `HEAD:<file>` with `git cat-file -e` then `git show`. It
  reads the committed `HEAD`, never the working tree, so `pnpm lint`'s pruning before it changes
  nothing, and the step's place among the others does not matter.
- Prints each answer as one JSON line on stdout, and for a `stuck` one GitHub annotation,
  `::error file=<file>::<n> row(s) added against <sha>. A list only shrinks (0524): fix the code, or
  mark the one right line with an edge: comment and its reason.`, each added key on its own line.
- Exits 1 on any `stuck`, 0 when all three are `done`, 2 when git fails or the base's file does not
  decode (main itself is broken, so the check fails closed).
- Every export is called by the script's own main, so `pnpm lint:dead` sees no
  `only-called-from-tests` export. That matters here: the list it would need is the one this check
  guards.

The workflow step, in `.github/workflows/check.yaml`'s `check` job, after the three "ledger
committed" steps:

```yaml
      # 0524: a list file only shrinks until it is deleted. Each list's rows at the head, against the
      # base, keyed as its reader matches them (ratchet.ts). Pruning and deleting pass.
      - name: lists only shrink
        env:
          BASE: ${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || (github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}
        run: node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"
```

It has no `if`, which `workflow-lint.ts` already demands of every `check` step but `promises` and
the build ("only promises and build skip, on the build flag"). The `BASE` expression is
`workflow-lint.ts`'s `TEST_BASE`, the one that maps a first push's zeros to empty. It adds no job,
no action and no required check: a red step fails `check`, and `ci-required` already needs `check`.
It runs on drafts too, since the `check` job does.

`workflow-lint.ts` gains one rule: the `check` job has exactly that step, with that `BASE`, no `if`
and no `continue-on-error`. Without it, a pull request could delete the step and pass.

`exam-paths.json` gains three rows, beside `unreachable-ledger.json`'s:

```json
  { "glob": "next-ledger.json", "why": "next/'s list of old lint breaks, which only shrinks (0524)" },
  { "glob": "agents-ledger.json", "why": "lead tooling's list of old lint breaks, which only shrinks (0524)" },
  { "glob": "node-kinds.json", "why": "names code-graph treats as used; each must be bound by that name (0524)" },
```

`commits.test.ts` pins this file's bytes in `format: exam-paths.json bytes`, so the same commit
updates that snapshot and adds the four list files to the scenario's path list.

### L2: every name in `node-kinds.json` is real

code-graph treats a name under `entryExportConventions` as used. A made-up name would hide a dead
export. The law, in `next/apps/fabrika/src/exam/node-kinds.test.ts`:

```ts
// A sketch. `files` is package-relative in code-graph 0.15.0 (`conventionMatcher`): "src/brain.ts"
// matches `src/brain.ts` inside any workspace package.
for (const [name, { files, exports }] of Object.entries(kinds.entryExportConventions)) {
  const homes = tracked.filter((p) => matchesInPackage(files, p) && !isTest(p));
  expect(homes, `${name}: its glob matches no file`).not.toEqual([]);
  for (const binding of exports) {
    // exported: oxc-parser's `staticExports` of a home names it
    // bound: a string literal equal to it in a non-test next/ file that is not a home
    expect(problems(binding, homes)).toEqual([]);
  }
}
```

A test file is `*.test.ts`, `*.test.tsx`, `*Test.ts` and `*.test-support.ts`, the classes
`exam-paths.json` names. The binding must sit outside the home, since `brain.ts` itself says
`Bridge("RecordPart")`. On main both names pass: `RecordPart` is bound by
`Cloudflare.DurableObject("RecordPart")` in `next/apps/fabrika/alchemy.run.ts` (and named in
`next/packages/libfabrika/src/cloudflare/objects.ts`), and `IsolateTail` by
`getLoopbackEntrypoint(ctx.exports, "IsolateTail", ...)` in
`next/packages/libfabrika/src/cloudflare/tail.ts`. Both are exported by
`next/apps/fabrika/src/brain.ts` (lines 352 and 354).

## One value traced

A pull request adds one row to `next-ledger.json` (the file name and its line are made up; the rule
and the list are real):
`{"file": "next/packages/libfabrika/src/runtime/Spawn.ts", "rule": "eslint(no-restricted-imports)", "code": "import { Log } from \"../ledger/internal/Log.ts\";"}`.

1. `check` runs `pnpm lint`. The row waives the new import, so lint passes. The three "ledger
   committed" steps pass: nothing was pruned.
2. `lists only shrink` runs `ratchet.ts --base 59cb6a3...` (40 hex). `Base` decodes to
   `{_tag: "at", sha}`.
3. `git cat-file -e <sha>^{commit}` fails on the shallow clone, so the script fetches the sha.
4. `next-ledger.json` at the base has 84 rows, at `HEAD` 85. `added` returns one key,
   `["next/packages/libfabrika/src/runtime/Spawn.ts","eslint(no-restricted-imports)",...]`.
5. The answer is `{_tag: "stuck", file: "next-ledger.json", reason: "row_added", rows: [that key]}`.
   `agents-ledger.json` and `unreachable-ledger.json` answer `done`.
6. The step prints the JSON lines and one `::error` annotation, and exits 1. `check` is red,
   `ci-required` is red, the pull request cannot merge.
7. The same pull request with the import fixed and the row gone: `added` returns `[]`, all three
   answer `done`, exit 0.

## Laws

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| L1. `added` returns exactly the keys the head holds beyond the base, counted: a head drawn from the base (any subset, any order) gives `[]`; that head plus one key, new or one more copy of a base key, gives that key | test, 100 runs | fc.array: keys from a five-letter alphabet, so repeats are common, with fc.subarray and fc.shuffledSubarray for the head | count with a `Set` in place of the counted map: the extra copy passes | `ratchet.test.ts` |
| L2. Row identity follows each reader: for the two lint lists, a change to `file`, `rule` or `code` (spaces included) of one row is an added row, and an extra key or a new order is not; for `unreachable-ledger.json`, a change to `scope`, `kind` or `id` is added, and a new `reason` or order is not | test, 100 runs | fc.record: rows with fc.string fields, one field picked by fc.constantFrom to change | add `reason` to the unreachable key: a reason edit is refused; drop `code` from the lint key: a changed code passes | `ratchet.test.ts` |
| L3. A file absent at the base and present at the head is all added; a file deleted at the head is `done`; a head file that does not decode is `stuck` `not_a_list` | test | scenario: three cases on `judge`, one per list | treat an absent base as an error: the new-file case exits 2, not 1 | `ratchet.test.ts` |
| L4. The real script on a real git repo: a head that adds a row exits 1 with the row in its JSON line; a head that prunes rows and deletes `unreachable-ledger.json` exits 0; `--base ""` and forty zeros exit 0 and say there is no base; `--base nothex` exits 2; a committed edit read through `HEAD` wins over a dirty working tree | test | scenario: a temp repo made in a scope with `Effect.acquireRelease` (0061), two commits, the script run as a child process with that repo as its cwd | read the working tree in place of `HEAD`: the dirty-tree case answers wrong | `ratchet.test.ts` |
| L5. `exam-paths.json` names `next-ledger.json`, `agents-ledger.json`, `unreachable-ledger.json` and `node-kinds.json`, and its bytes are pinned | test | format: the file's bytes, and the existing scenario's path list with the four added | delete the `node-kinds.json` row: the snapshot and the path check fail | `commits.test.ts` |
| L6. Every name in `node-kinds.json` is exported by a file its glob matches, and bound by that string in a non-test `next/` file outside those files; each glob matches at least one file | test | scenario: the real `node-kinds.json` and tracked tree, two names | add `"Ghost"` to the exports in a copy: refused as not exported and not bound; a name bound only in its own home: refused | `node-kinds.test.ts` |
| L7. `check.yaml`'s `check` job runs `node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"` with `TEST_BASE`, no `if` and no `continue-on-error` | lint | scenario: `check.yaml` on the tree passes, and copies with the step deleted, given an `if`, or given another `BASE` each fail | delete the step from a copy: `lintWorkflow` names the missing step | `workflow-lint.test.ts`, rule in `workflow-lint.ts` |

Lint, type or test: L7 judges a workflow's shape, so it is a rule in `workflow-lint.ts`, the
workflow linter `pnpm lint` runs; its examples sit in that rule's test file. L1 to L4 test data and
a program's behavior. L5 and L6 read config files against the tree, across files, which no oxlint
rule sees, so they are tests, as `compiler.ts` and `rows.ts` read their config. None is a type law.

No law here is host-only: L4 runs `git` in a temp folder, which CI's `next` job has.

### False alarms, measured before it blocks

A blocking check needs about 0% false alarms (`AGENTS.md`, "Checks").

| Measure | Count | Note |
|---|---|---|
| The last 40 merged pull requests, base to merge base against head, all three lists | 0 added rows, 3 files changed (each a prune) | 0 false alarms, 0 hits; counted with the same keys on 2026-11-13 |
| Every first-parent commit on `origin/main` that changed a list file | 7 commits added rows: `next-ledger.json` once (115 rows, T727), `agents-ledger.json` five times (154, 83, 12, 12 and 1 rows), `unreachable-ledger.json` once (4 rows, the day it began) | each was a rule joining with a first-day list, or one row for new code (T341). Under 0524 each is what the check is for, so none is a false alarm |
| `node-kinds.json` names | 2 of 2 exported and bound | L6 starts green |

## Wiring `commits.ts` into CI: not in this slice

The answer is no. `pnpm commits check` would refuse nearly every real pull request, and a decided
note turned its CI gate off on purpose.

What it does. Its scope rule (`inScope`) judges a change that touches `next/**` or any exam path.
For each commit from the base to the head, `check` answers `stuck unsigned_commit` unless a note on
`refs/notes/fabrika` holds a step's signature over that commit's trees that verifies against
the step keys file at the repo top, or the commit carries an SSH signature from a person key there. It answers
`stuck build_touched_exam` only for a commit a verified `build` note signs. A plain commit has no
role, so it can never be `build_touched_exam`: the rule this slice would want is unreachable
without signatures.

Measured on the last 40 merged pull requests, running the real script
(`node next/apps/fabrika/src/exam/commits.ts check --base <base> --head <head>`) on each, with
`refs/notes/fabrika` and each `refs/pull/<n>/head` fetched on 2026-11-13:

| Answer | Pull requests | Note |
|---|---|---|
| not in scope, `done` | 23 of 40 | docs, decisions, experiments and field rows |
| in scope, `stuck unsigned_commit` | 17 of 17 in scope (100%) | 338 `unsigned_commit` answers over their commits; 0 `build_touched_exam`, 0 `stale_link` |
| in scope, `done` | 0 | |

Only one of the 17 carried notes at all (1146: 136 notes on 207 commits, still 195 commits
answered `unsigned_commit`). As a blocking step it would have refused every in-scope pull request
of the last 40. It needs no key, and the network it uses (fetching the notes ref from `origin`) is
what CI already has, but its false-alarm rate here is 100%, not 0%.

Why it does not fit:

- [0161](.decisions/0161-no-step-signing-by-hand.md) (2026-11-13) made today's
  commits plain, with no step note, and says "CI's `commits` job stops gating a merge." Wiring it
  back is a new call that 0161 already made the other way.
- [0010](.decisions/0010-allow-pull-request-target-for-the-commit-check.md) ran it
  under `pull_request_target`, so main's copy graded the pull request. A step in `check` runs the
  pull request's own copy, which the pull request can edit. That needs a new workflow, outside this
  slice's limits.
- It would fail most real pull requests, so it fails the 0% bar before it could block.

What holds the exam rule meanwhile, by 0161: practice (tests before build, by another agent), the
loosening check the lead reads at the merge, and the owner's read of a change under an exam path.
For the list files this slice adds a guard that needs no signature: the ratchet refuses an added
row whoever commits it. The one thing left to practice is a build commit that prunes a list, which
is allowed anyway.

What is wrong is the text that still says CI decides: `commits.ts`'s header. That is one finding
row below. The whole plan's finding `2026-11-13-exam-commit-check-not-in-ci` should not be saved as
written, since 0161 decided it; the lead drops it from that plan.

## Files

| File | Owner | Product lines expected |
|---|---|---|
| `next/apps/fabrika/src/exam/ratchet.ts` | tests | 150 |
| `next/apps/fabrika/src/exam/ratchet.test.ts` | tests | tests |
| `next/apps/fabrika/src/exam/node-kinds.test.ts` | tests | tests |
| `next/apps/fabrika/src/exam/commits.test.ts` | tests | tests |
| `.github/workflows/check.yaml` | tests | 7 |
| `.github/ci/workflow-lint.ts` | tests | 12 |
| `.github/ci/workflow-lint.test.ts` | tests | tests |
| `exam-paths.json` | tests | 3 |
| `.glossary/TERMS.md` | build | docs |

Every file but the glossary is an exam path, so the tests step writes the check, its laws and the
workflow line together, as the whole plan's slice 3 does for its exam files. The build step owns
only the glossary row; it then runs the laws and `pnpm lint` and confirms them green. This builds a
decided note, so the lead approves it.

### Read, not changed

Read by the laws above, not changed (each an exam path, so the tests step owns it):

| File | Owner | Product lines expected |
|---|---|---|
| `next-ledger.json` | tests | 0, read by the check |
| `agents-ledger.json` | tests | 0, read by the check |
| `unreachable-ledger.json` | tests | 0, read by the check |
| `node-kinds.json` | tests | 0, read by L6 |
| `next/apps/fabrika/src/exam/commits.ts` | tests | 0, measured above; its `examMatcher` is read by L5 |
| `next/apps/fabrika/src/exam/edges.ts` | tests | 0, the pattern the edge follows |
| `next/apps/fabrika/src/exam/compiler.ts` | tests | 0, the pattern the main follows |
| `next/apps/fabrika/src/exam/rows.ts` | tests | 0 |
| `next/apps/fabrika/src/exam/commits-git.test-support.ts` | tests | 0, not used: it releases with `afterAll`, a listed row |
| `oxlint-plugins/ledger.ts` | tests | 0, the lint lists' key |
| `oxlint-plugins/lint.ts` | tests | 0, how it reads the lists |
| `.github/ci/field-check.ts` | tests | 0, the counting it mirrors |
| `.github/ci/changes.mjs` | tests | 0: a list file is not quiet, so `check` and `next` run |
| `.github/ci/required.mjs` | tests | 0 |
| `.github/ci` | tests | 0, the folder |
| `.github/ci/` | tests | 0, the folder |
| `next/apps/fabrika/src/exam/` | tests | 0, the folder |
| `apps/fabrika/e2e.ts` | tests | 0, named by a finding below |
| `.github/workflows` | tests | 0 |
| `.github/workflows/` | tests | 0 |
| `.oxlintrc.json` | tests | 0 |
| `layer-rules.json` | tests | 0 |
| `compiler-ledger.json` | tests | 0 |
| `package.json` | tests | 0 |
| `pnpm-lock.yaml` | tests | 0, no dependency added |
| `vitest.config.ts` | tests | 0, `next/**` tests already run |
| `next/**/*.test.ts` | tests | 0, a class glob |
| `next/**/*.test.tsx` | tests | 0, a class glob |
| `next/**/*Test.ts` | tests | 0, a class glob L6 reads |
| `next/**/*.test-support.ts` | tests | 0, a class glob L6 reads |
| `next/apps/fabrika/src/exam/**` | tests | 0, the folder glob |

## Size

One pull request, about 400 lines, most of them laws.

1. Slice 1: the ratchet check, its workflow step and lint rule, three exam rows and L6, 400 lines
   (150 script, 200 tests, 50 config and lint).

Size confidence: 80%. The doubt is L4: a real git repo per case in a scope may take more lines
than the sketch, as `commits-git` laws did.

Priced from the last 200 rows of `field/runs.jsonl`, list price: tests median $1.39, build $1.32,
review $1.08. Steps: tests, build, review, plus one likely send-back of the tests step, about $5.

Estimate: 4 steps, $6

## Records

What fact is lost if not recorded now: why a pull request was refused. The step's JSON lines and
annotation name the file, the base sha and each added key, so a red run says what grew without a
rerun. GitHub keeps run logs for 90 days only, so the lane's `field/` row the same day carries the
answer of its own pull request's run. Nothing new is stored by the check itself; the list files and
git hold the rest.

## What this cannot tell

- The step runs the pull request's own copy of `ratchet.ts`, `check.yaml` and `workflow-lint.ts`,
  as every `check` step does. A pull request that edits them can turn the ratchet off. All three
  are exam paths, so that edit is the lead's loosening read and the owner's exam read under 0161,
  not this check's. Running main's copy needs `pull_request_target`, a new workflow (0010), which
  this slice may not add.
- The fetch path (`git fetch --depth=1` of the base inside the script) runs only in CI's shallow
  checkout. L4's temp repo has the base already. The pull request's own CI run is the first real
  test of it; the review reads that run's step log.
- Whether the pull request's base and the merge commit's first parent ever differ in a way that
  makes a row look added. If main added a row between them, it would. The ratchet itself stops main
  from adding rows, so I expect none; I did not measure it.
- The false-alarm count is 40 pull requests and main's history. It says nothing about a list file
  someone hand-formats with a duplicate key code-graph would refuse anyway.
- `node-kinds.json`'s glob semantics come from reading code-graph 0.15.0's built source
  (`conventionMatcher`, `compileConventions`), not from a run of `pnpm lint:dead` with a planted
  name.

## Open questions

None.

## Findings

```json
{"_tag": "finding", "id": "2026-11-13-commits-header-says-ci-decides", "date": "2026-11-13", "by": "plan", "model": "claude-opus-5-5", "rule": "doc_drift", "location": {"path": "next/apps/fabrika/src/exam/commits.ts", "line": 3}, "says": "The header of commits.ts says CI decides from each step's signature, but decision 0161 made commits plain and turned CI's commits gate off, and no workflow on main runs the script.", "proof": "commits.ts lines 3-4 read 'CI decides from the signature, never from the author, the message or a trailer'; .decisions/0161-no-step-signing-by-hand.md says 'CI's commits job stops gating a merge'; nice -n 19 rg -n 'commits' .github/workflows/ on 59cb6a311 finds no step that runs commits.ts. Run on the last 40 merged pull requests, the script answers stuck unsigned_commit on 17 of 17 in-scope pull requests (338 answers) and build_touched_exam on none.", "cost": "A reader trusts that CI holds the exam rule for build commits, as the whole no-waiver plan's first draft did, and plans around a guard that is off.", "head": "59cb6a311b62cc6af2adc02d38aa26d41a84f120", "ticket": "933", "pr": null}
{"_tag": "finding", "id": "2026-11-13-exam-paths-lists-one-glob-three-times", "date": "2026-11-13", "by": "plan", "model": "claude-opus-5-5", "rule": "duplicate", "location": {"path": "exam-paths.json", "line": 43}, "says": "exam-paths.json lists the glob apps/fabrika/e2e.ts three times, each with a different why, so the list reads longer than it is and a reader cannot tell which why is current.", "proof": "grep -n '\"apps/fabrika/e2e.ts\"' exam-paths.json on 59cb6a311 prints lines 34, 43 and 92, each with glob apps/fabrika/e2e.ts.", "cost": "Small: dropping one of the three rows looks like removing an exam path when it is not, and the loosening read has to work that out by hand.", "head": "59cb6a311b62cc6af2adc02d38aa26d41a84f120", "ticket": "933", "pr": null}
```
