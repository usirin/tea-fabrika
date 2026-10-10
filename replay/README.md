# Replay set

An answer key. 23 closed kamp-us/demlik issues, each fixed by one merged PR.
For each one we keep the report as it was filed, the ticket fabrika's triage
wrote from it, and what the PR really changed and tested.

Until now tea-fabrika was judged by eye on one ticket at a time
(kamp-us/demlik#558). With this set, triage can be run on 22 real reports and
compared with what shipped. Later the lane can be run on the same base commits
and compared with the real PRs.

A scorer for triage is built (`src/score.ts`), with a runner that replays one
issue (`src/replay-run.ts`). Experiment 47 says what each number means and
has the first 5 results. The sketch it started from is at the end.

## What is in the folder

- `index.json`: one row per issue, with a one-line summary, and the mix counts.
- `issues/<n>.json`: the full record for one issue.

## How the issues were picked

From every closed issue in kamp-us/demlik (316 on 2026-10-10), keep one when:

- it was closed as completed;
- exactly one merged PR closes it, and that PR's body says `Closes #N` or
  `Fixes #N`;
- the PR closes no other issue (this drops the docs-sweep PR #553, which
  closed eleven);
- it is not an epic, a decision, a release chore, roadmap bookkeeping, or
  #558 itself;
- the PR touches 1 to 12 files, mostly in `packages/tea` or
  `packages/code-graph`.

That left about 85. From those I picked for a mix: bugs, features and chores;
type-level, runtime and docs fixes; small and medium diffs; and chains where
one issue came out of another's review (#460 then #463, #529 then #534, #556
then #567, #568, #569 and #579). I preferred issues whose original report can be
recovered, and dropped three whose report or triaged body names a person.

## Where the raw report comes from

fabrika's triage rewrites an issue's body and keeps the report as filed in a
`<details>` block titled "Original report (verbatim)". `src/github.ts` reads
that block (`splitEnriched`) and starts triage from it. `rawReport` here is
that same block, cut the same way.

GitHub keeps every revision of an issue body. For all 22 issues that have the
block, the block is byte-for-byte the first revision
(`rawReportMatchesFirstRevision: true`). So the block is the real report.

One issue, #155, has no block. It was filed already triaged, with its own
acceptance criteria, and never edited. Seeding triage from it hands triage the
answer, so it is marked `useFor: ["lane"]` only.

## Fields in `issues/<n>.json`

| Field | Meaning |
|---|---|
| `number`, `title`, `url`, `closedAt` | The issue. |
| `packages` | The `@demlik/*` packages the PR touched. |
| `labelsAtClose` | The `type:*` and `p0`-`p2` labels at close, rebuilt from the label timeline. |
| `labelHistory` | Every type and priority label added (`+`) or removed (`-`), in order. |
| `useFor` | `triage`, `lane`, or both. Only #155 is lane-only. |
| `rawReport` | The report as filed, or `null`. |
| `rawReportSource` | Where `rawReport` came from. |
| `rawReportMatchesFirstRevision` | `true` when it equals the first body revision on GitHub. |
| `rawReportMissing` | Why `rawReport` is `null`, else `null`. |
| `seed` | What `rawIssueFrom` in `src/github.ts` would build: `from` (the block, or the whole body) and `filedBy` (`agent` when the report carries fabrika's "Filed by an agent" footer, else `human`). |
| `enriched` | The ticket fabrika's triage wrote, above the original-report block. Our triage's output is scored against this and against the PR. |
| `pr` | `number`, `url`, `title`, `mergedAt`, `mergeSha`, and `baseSha`: the first parent of the squash merge, the tree the change was applied to. |
| `size` | `small` (1-3 files) or `medium` (4-12). |
| `filesChanged` | Every file the PR touched: `path`, `additions`, `deletions`, `kind`. |
| `testsAdded` | Each test file added or changed: `status` (`added` or `changed`) and the test names the diff adds. |
| `publishedApiTouched` | What the change does to the published surface: `package`, `subpath`, `names`, `change`. `null` when nothing published changed. |
| `level` | `type`, `runtime`, `docs` or `mixed`: where the fix lives. My call. |
| `levelReason` | One line on why. |
| `changeset` | The changesets the PR added (`package`, `bump`, `file`), or `"none"`. An entry with `status: "edited-pending"` means the PR edited an unreleased changeset instead of adding one. |
| `preMonorepoLayout` | `true` when the PR is from before tea moved to `packages/tea` (#155, #296). Paths are `src/...` at the repo root. |
| `notes` | What a scorer must know: scope changes in triage, review-added criteria, follow-ups, traps. Read these. |

`kind` in `filesChanged`:

| Kind | Rule |
|---|---|
| `changeset` | `.changeset/*` |
| `type-test` | `*.test-d.ts` |
| `test` | `*.test.*`, anything under a package's `test/`, `test-helpers/` or `__tests__/`, and tea's `src/docs/**` (the doc-test harness, not shipped) |
| `generated` | tea's `docs/reference/**`, made by `docs:reference` |
| `docs` | any other `*.md` (README, SPEC, `.patterns`, `.decisions`, CHANGELOG), and `examples/**` (typechecked doc samples) |
| `src` | anything else under a package's `src/` |
| `other` | the rest (none in this set) |

`index.json` rows add `filedAt`, `shaAtFiling` (the last `main` commit before
the issue was filed), `baseSha` and `commitsFilingToBase`.

## Which commit to run on

- **Triage**: check out `shaAtFiling`. That is the code the reporter and
  fabrika's triage saw. `baseSha` is a fair second choice when the two are
  close (`commitsFilingToBase` is 0 to 16 here).
- **Lane**: check out `baseSha`, hand it the triaged ticket, and compare with
  the real diff to `mergeSha`.

## Known gaps

- **Most reports were filed by agents** (20 of 23). They already name files
  and line numbers, so finding the right files is easier than it would be from
  a person's report. Only #333, #460 and #534 seed as `human`.
- **The labels lean one way.** 19 of 23 are `p1`; there is no `p0`, and no
  `decision`, `investigation` or `epic` type (excluded on purpose). A triage
  that always says `p1` scores 19/23 on priority, so compare with that.
- **Only 3 type-level fixes** (#155, #296, #568), plus 2 mixed (#477, #576).
  Few small closed issues fix types alone.
- **`enriched` is not pure triage output.** Review added a criterion after the
  PR opened in #463 and #576 (marked `<!-- ac:review ... -->`); drop it when
  scoring triage. #367's body repeats the report under "## Original report".
- **Decisions made in comments are missing.** Comments were not captured. #568
  (which option won), #567 (a direction comment that made it a feature) and
  #355 (a folded-in item) changed scope in a comment. The notes say so.
- **Test names are pulled from the diff by a pattern.** `it.each` titles keep
  their `%s` or `$name`, a `describe` title is listed like a test, a fixture
  file has no names, and a `.test-d.ts` lists its `@ts-expect-error` comments
  instead. #579's names were added by hand.
- **`publishedApiTouched` and `level` are read by hand** from the diff and the
  export maps, not computed. code-graph exports `./dist/*`, so almost any of
  its files is reachable; for it I wrote down the CLI flag and JSON surface
  that changed instead.
- **No PR over 12 files**, so the set says nothing about large changes.
- **Some reports came from this project's own work.** #576 describes a
  consumer with a diff judge and an issue sorter, which is tea-fabrika. Watch
  for leaks when replaying it.
- **GitHub is the source of truth.** The data was read with `gh` on
  2026-10-10 by a one-off script that is not kept here. A body edited after
  that date will differ.

## Scoring triage: a sketch

Parts 1 to 3 are built (experiment 47), with a rough stand-in for 4 and a
yes/no for 5; 6 and 7 are not. Run tea-fabrika's triage on each `useFor: triage` issue, seeded with
`{ id, title, body: rawReport, filedBy: seed.filedBy }`, at `shaAtFiling`. It
returns an `Issue` (`goal`, `criteria`, `openDecision`) and a sort (`type`,
`priority`, `value`). Then score:

1. **Files.** Compare `namedFiles(issue)` (what example calls import from,
   existing tests, and the files other criteria name) with `filesChanged`,
   leaving out `changeset` and `generated`. Report recall on `src` files on
   its own: did triage find the file the fix lives in? Count a test file the
   criteria name as a hit for that test.
2. **Level.** Map the criteria to a level: `example` criteria mean `runtime`;
   `type` criteria, and unchecked rules about `type`, mean `type`; unchecked
   rules about `doc`, and an `existing_test` that guards a doc page, mean
   `docs`; a mix means `mixed`. Compare with `level`, with half credit when
   one side is `mixed`.
3. **Type and priority.** Compare the sort with `labelsAtClose`. Show a
   confusion table and the always-`p1` baseline, not one accuracy number.
   #567 (retyped after a comment) and #569 (priority moved by a held release)
   are hard cases; list them apart.
4. **Would the criteria catch what the PR tests?** The strongest check is
   free of judgment: write the criteria's examples and type snippets as
   tests, then run them at `baseSha` and at `mergeSha`. Each should stand at
   `baseSha` the way it says (`fails`, or `holds` for a guard) and hold at
   `mergeSha`. One that fails at both is wrong; one that holds at both and
   claims to fail today shows nothing.
   A softer second check maps each name in `testsAdded` to a criterion, by
   hand or by Jev later, and scores the share covered.
5. **Open decision.** #568 rested on a choice a person made. Triage should set
   `openDecision` there and, mostly, not elsewhere. Count both kinds of miss.
6. **Traps from the notes.** A short yes/no list per issue: #367 does not ask
   to loosen the test; #534 does not keep the filer's vacuous fixture; #537
   widens the existing link gate instead of adding a new one; #483 covers
   both packages; #490 asks for no test and no changeset.
7. **A reference line.** Score fabrika's own `enriched` the same way (files,
   level, criteria). That shows how far the current pipeline gets, so our
   numbers have something to stand next to.

For the lane later: start at `baseSha` with the triaged ticket, then compare
its diff with `filesChanged`, and run the PR's own tests (taken from
`mergeSha`) against the lane's result as hidden tests.
