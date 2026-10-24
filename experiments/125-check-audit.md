# 125. Every check that can turn main red: where it came from, and how often it was wrong

The question: every check on main that can fail a pull request. Where did its rule and its
numbers come from? How often has it raised a false alarm? Does it meet industry practice?

**Answer: most checks on main are sound, but four are not.** Two of them have the same flaws we
found in the unmerged branch: a number that is only a tool's default, and a rule that is wrong
nearly every time it fires.

- **vitest's 5-second time limit** is a tool default. It caused 6 of the 10 red pushes to main.
  None of the 6 was a bug: each was fixed by raising the limit.
- **`no-node-sqlite-test-backing`** fired 8 times. All 8 are wrong here, because the rule bans
  a fake of Cloudflare D1 in phoenix, and here `node:sqlite` is the real driver.
- **`no-effect-promise`** fired 8 times, and 8 places kept their code. 7 of the 8 reasons are
  the very case Effect's own docs give for `Effect.promise`: a promise that cannot reject.
- **`no-raw-try-catch`** fired 21 times, and 21 places kept their code. 18 are in
  `experiments/`, mostly plain Node calls at the edge.

Everything else either never fired a false alarm or has no record of one. The layer gate's 32
allowlist entries are one deliberate fence, not 32 dodges. PR 44's dead-export gate, which is not
on main, is wrong on 11 of its 12 entries.

- Spent: $0. No agent, no model, no Jev, no key. Network: `gh` reads of this repo's CI runs and
  web searches.
- Main at `04dc2df`: `pnpm typecheck`, `pnpm lint`, `pnpm test` (2206 tests) and
  `pnpm promises gate` all green.
- Confidence 80% in the counts. 70% in the verdicts, because most checks have too little history
  to judge (see the end).

## The idea in one picture

A false alarm is a fire where nobody fixed the code: they changed an ignore, an allowlist or a
limit instead. This is the definition Google's analysis teams use, called an "effective false
positive" (Sadowski et al., CACM 2018). Two real cases from main:

```ts
// biome-ignore lint/plugin: the ledger's own SQLite driver (the solo ledger), not a fake of D1.
import {DatabaseSync} from "node:sqlite";
// The rule's own header: "an in-process SQLite engine is NOT Cloudflare D1 ... so a faked-D1
// engine is strictly more permissive than real D1". This repo has no D1 to fake. All 8 hits
// are this shape.
```

```ts
// packages/pipeline/src/laws/ship-pbt.test.ts, commit 1687d65 (#46)
-	it("each planted mistake of ./ship.ts is caught, ...", () => { ... });
+	it("each planted mistake of ./ship.ts is caught, ...", () => { ... }, 30_000);
// "The planted-mistake test took 4.1 s on a passing CI run and passed vitest's 5 s default on
// others, so main went red." Same laws, same runs. Only the limit changed. 5 red pushes.
```

## The checks

"Fires wrong" counts ignores, allowlist entries and red CI runs where the fix changed the check,
not the code. "Fires right" counts the code fixes we can see. Both are lower bounds: a fire fixed
on someone's machine before a push leaves no trace.

| Check | What it checks | Where its rule and numbers came from | Fires wrong / right | Verdict |
|---|---|---|---|---|
| biome formatter and import order | tabs, 100 columns, sorted imports | biome's formatter; the 100 columns are our own choice, no source | 0 / not counted (`pnpm format` fixes it) | keep blocking |
| biome `recommended` preset | biome's curated lint rules | biome's published default set | 8 (5 `noTemplateCurlyInString`, 3 `noControlCharactersInRegex`) / not counted | keep blocking |
| `noUnusedImports`, `noUnusedVariables`, `useImportExtensions` | dead names; a relative import names its `.ts` | our choice; the extensions because Node runs `.ts` as it is (experiment 82) | 0 / experiment 82 put back 1,132 extensions | keep blocking |
| `noNonNullAssertion`, `noTsIgnore` at "warn" | `x!` and `@ts-ignore` | our choice; the comment says "a nudge, not a gate" | 0 / not counted | keep, fix the comment: `--error-on-warnings` makes a warning block |
| `no-bare-tell` (ours) | a `tell` whose Effect is made and dropped | this repo's own rule, from a real bug shape (commit 57291ab) | 0 / 0 seen | keep blocking |
| `no-type-assertions` | `as any`, `as unknown as T`, `<T>x` | phoenix, copied unchanged | 3 / 2 at adoption (commit a9ac00b) | keep blocking |
| `no-effect-promise` | `Effect.promise` and one-argument `Effect.tryPromise` | phoenix (its issue #2736), copied unchanged | 8 / about 2 at adoption | change: allow `Effect.promise`, keep the `tryPromise` part |
| `no-raw-try-catch` | any `try` in a file that imports `effect` | phoenix (#2736), copied unchanged | 21 / a few at adoption | change: only inside `Effect.gen` and `Effect.fn`, or report only |
| `no-node-sqlite-test-backing` | no `node:sqlite` import | phoenix (its ADR 0082, about D1) | 8 / 0 | drop |
| `no-throw-in-effect-gen`, `no-context-tag`, `no-data-taggederror`, `no-numeric-duration`, `no-expect-in-if` | five Effect and test idioms | phoenix (#2736, #3196, its patterns docs) | 0 / 1 at adoption (a `throw` became `Effect.die`) | keep blocking |
| `no-implicit-effect-concurrency` | `Effect.all` and `forEach` name a `concurrency` | phoenix (#2567, a slow read chain there) | 0 / 1 at adoption; 40 `concurrency: 1` written since | keep, 60% sure (see below) |
| `lint:layers` | an import never points up the stack | our own order (experiments 82, 103, 114) and a fence (`property-tests-not-our-own-search.md`) | 0 / not counted (32 allowlist entries, one fence) | keep blocking |
| `lint:boundaries` | the pipeline uses only fabrika's public names | code-graph's model; our two roles (experiment 114) | 0 / not counted | keep blocking |
| `lint:browser` | fabrika's top level bundles for a browser | our own list of platforms (experiment 103) | 0 / not counted | keep blocking |
| `pnpm typecheck`, with `floatingEffect` | strict TypeScript; an Effect made and dropped | TypeScript's `strict`; two stricter flags our choice; Effect's own check (commit 57291ab) | 0 Effect suppressions / 1 real dropped Effect at adoption | keep blocking |
| every machine has laws | each `defineMachine(` has a laws spec, every Msg type sent | our own (experiment 90, `every-machine-has-laws.md`); 20,000 states is our own number, twice the largest spec | 0 / not counted | keep blocking, and say what it skips: 12 of 28 machines in shipped folders |
| test time limit | a test over 5 s fails | vitest's default `testTimeout`, never chosen | 6 red main pushes / 0 | change: one limit chosen for this repo |
| the rest of `pnpm test` | 2206 tests | each test's own author | 1 environment fault, 1 unknown / not counted | keep blocking |
| `promises gate` | a formal check is confirmed again when its code changes | our own (experiment 117) | 0 / 0: it has never fired | keep blocking, 60% sure |
| `pnpm build` | the two packages build | our own (experiment 108) | 0 / 0 | keep blocking |
| `lint:dead` (PR 44, not on main) | no export without a reader | code-graph 0.11.0's default | 11 of 12 entries / 0 | do not merge as blocking |

## How it was done

```sh
CI=1 PR44=origin/<PR 44's branch> node experiments/125-check-audit.ts
# writes experiments/results/125-check-audit.json
```

- The list of checks came from `package.json`'s scripts and `.github/workflows/check.yaml`.
- The script counts every `biome-ignore` in tracked files. A plugin ignore says only
  `lint/plugin`, so it reads the next line to tell which rule fired (`try {`, `Effect.promise`,
  `node:sqlite`, `as unknown as`). Each of the 48 was then read by hand.
- It counts `biome-ignore` lines added over main's history, Effect and TypeScript suppressions,
  the layer allowlist, the machines the laws test looks at, written time limits in tests, and
  promise records.
- It reads every CI run of this repo (126 since CI started on 2026-10-21) and the failing step
  of each red one. Most red logs are gone, so the cause is read from the commit that turned it
  green, written into the script by hand with that commit.
- Where each rule came from was read from the rule's own header, the commit that added it, and
  the direction notes and experiments it names.

## What came back

**The custom rules from phoenix.**

- All ten were copied unchanged from kamp-us/phoenix on 2026-10-12 (commit a9ac00b). Their
  reasons are phoenix's: its issues #2736, #3196 and #2567, its ADR 0082 about Cloudflare D1, its
  `FateWireCode`. None was checked against this repo before it was turned on.
- Eight of the ten headers say phoenix registered the rule at "warn". Four say it was "Phase 1"
  of #2736, one adds "warn keeps CI green while every site is remediated". Five still give their
  diagnostic at "warn". Here `biome check --error-on-warnings` makes every one of them block. So
  "blocking" was never a choice for these rules. It came with a flag.
- At adoption they caught about 7 kinds of real problem (a `throw` in `Effect.gen`, two double
  casts, a `try` around `JSON.parse`) and 12 places kept their code with an ignore. Today there
  are 40 plugin ignores. 52 ignore lines were added over 24 commits, and 4 removed.

**The plugin ignores, by rule, all 40 read.**

- `no-node-sqlite-test-backing`, 8: every one says "the solo ledger's driver, not a fake of D1".
  The rule is about a thing this repo does not have. 8 of 8 wrong.
- `no-raw-try-catch`, 21 (18 in `experiments/`, 3 in packages): signalling a process that may be
  gone, a `git` or `grep` exit code, a `JSON.parse` in a plain function, a law that must catch the
  throw it measures. The rule fires on any `try` in a file that imports `effect`, even in a plain
  function with no Effect in it. 0 of the 21 read as a real problem.
- `no-effect-promise`, 8: six say "closing a scope has no way to fail with a typed error" or "this
  Promise cannot reject", one says the promise is only ever resolved, one is a stand-in that must
  stop the run. Effect's docs say to use `Effect.promise` "when you are sure the operation will
  not reject". The rule bans the library's own tool for this case.
- `no-type-assertions`, 3: each is a real `as unknown as` that TypeScript cannot check. The ignore
  with its reason is what a reviewer should see. These are the rule working.

**The layer gate's allowlist.** All 32 entries were added in one commit (59b4961), each with the
same reason: old code that may still import our own search engine until it is deleted. This is a
frozen baseline, the same as ArchUnit's `FreezingArchRule` or ESLint's bulk suppressions: old
fires are recorded, new ones fail. No entry was added later to get one change past the gate.
The other six commits to `layer-rules.json` follow a package move.

**The red CI runs.** 126 runs, 12 red. 10 were pushes to main, out of 64.

```text
2  CI being set up (install, pnpm pin)                   not a check
6  a test over vitest's 5 s default                      fixed by a longer limit (1687d65, d16846b)
1  the runner had no expect or zsh; a search over 5 s    fixed in CI (7b4e440)
1  unknown, log gone
0  a real bug
2  PR 44 (not main): code-graph found 286 high smells    the size gate, later dropped
```

- Commit d16846b says it plainly: the walks "are bounded by states, not time, so vitest's 5 s
  default only measured how busy the machine was: under load the host walk took 7 to 12 s".
- The tests now carry 89 time limits of their own (76 as a third argument, 13 as `timeout:`).
  `vitest.config.ts` sets none. Every slow test has to learn the default the hard way.

**The laws test.** It finds machines by the text `defineMachine(`, in two folders only. In the
folders that ship (`packages`, `programs`, `packs`, `legacy`), 28 calls; it looks at 16. Not
looked at: 9 in `legacy/`, 2 in fabrika's shell (its own comment says so), 1 in the owner's desk
pack. The direction note says "a machine with no laws fails the test suite". Today that is true
for 16 of 28.

**The promises gate.** 2 records, both written in experiment 117. The code they cover has not
changed since, so the gate has never fired, right or wrong. By design it is a change detector:
it fires on any edit to `createShip` or the other blocks it names, even a rename that keeps the
promise.

**PR 44's dead-export ledger.** 12 entries. The ledger's own reason says 11 are "called in their
own file, so they are not dead": code-graph misses calls to an arrow function
(kamp-us/demlik#733). The 12th is in the finished video. 11 of 12 wrong.

## Industry practice

- **A check that blocks must not fire on correct code.** Google's compiler checks "produce no
  effective false positives (the analysis should never stop the build for correct code)". Only
  checks shown in code review, which do not block, may reach 10% (Sadowski et al., "Lessons from
  Building Static Analysis Tools at Google", CACM 2018). So the 10% bar is for advice, not for a
  gate.
- **A noisy check is turned off until it is fixed.** Tricorder disables an analyzer when its
  "Not useful" clicks pass 10% (same paper; Sadowski et al., "Tricorder", ICSE 2015).
- **No warnings.** Google's C++ and Java builds have a "compiler warnings-free default": a result
  is an error or a review comment, never a warning (CACM 2018). Our `--error-on-warnings` matches
  that. Its cost is that every rule we copy at "warn" becomes a gate.
- **Old fires go in a baseline, new ones fail.** ArchUnit's `FreezingArchRule` and ESLint's bulk
  suppressions (2025) both work this way. The layer allowlist is one.
- **Flaky runs.** At Google about 1.5% of test runs were flaky, and about 16% of tests flaked at
  least once (Micco, Google Testing Blog, 2016). Here 6 of 64 pushes to main (9.4%) went red from
  a time limit alone.
- **Change detectors.** Google's Testing on the Toilet calls a test that fails on any change to
  the code, good or bad, harmful ("Change-Detector Tests Considered Harmful", 2015). The promises
  gate is one on purpose. It is cheap only while its records are few and their code is quiet.

| Practice | Source | This repo |
|---|---|---|
| A blocking check has about 0 effective false positives | CACM 2018 | 3 rules far above it: 8 of 8, 21 of 21, 8 of 8 kept their code |
| Advice may reach 10% | CACM 2018 | we have no advice level; every rule blocks |
| Disable a noisy check until it is fixed | ICSE 2015, CACM 2018 | never done; 52 ignores added instead |
| No warnings, only errors | CACM 2018 | yes (`--error-on-warnings`) |
| Baseline for old fires | ArchUnit, ESLint | yes, the layer allowlist |
| Flaky runs about 1.5% | Micco 2016 | 9.4% of main pushes, all from one default |

## Recommendation

Each of these is a change for its own pull request. This experiment changes no check.

1. **Set one time limit for the whole suite in `vitest.config.ts`,** sized from measured run
   times on CI (for example, three times the slowest test on a green run), and remove the 89
   per-test limits that only work around the default. Why: 6 of 10 red main pushes, 0 bugs.
   Cost: a slow test hangs a little longer before it fails. 85% sure.
2. **Drop `no-node-sqlite-test-backing`.** Why: 8 of 8 wrong; the thing it guards does not exist
   here. Cost: none we can name. If a D1 fake ever comes, phoenix's rule can come back. 90% sure.
3. **Narrow `no-effect-promise` to the one-argument `Effect.tryPromise`, and allow
   `Effect.promise`.** Why: 8 of 8 ignored, and the library documents `Effect.promise` for this
   case. Cost: a rejection in a wrongly trusted promise becomes a defect, not a typed failure. A
   reviewer reads the call, as today they read the ignore. 75% sure. Doubt: phoenix may have
   seen real harm from `Effect.promise` that its header does not say; reading #2736 would settle
   it.
4. **Narrow `no-raw-try-catch` to a `try` inside `Effect.gen` or `Effect.fn`,** the place where
   it does escape the type system. Or make it report only. Why: 21 of 21 ignored, 18 in
   experiments. Cost: a `try` in a plain helper of an Effect file goes unflagged. 70% sure.
   Doubt: we cannot see the fires that were fixed locally; if most real fixes were in plain
   helpers, the narrow rule would lose them.
5. **Fix the "warn" comment in `biome.jsonc`.** It says `noNonNullAssertion` is "a nudge, not a gate", and with
   `--error-on-warnings` it is a gate, as is `noTsIgnore`. Either say so, or move them out of the gate. 90%
   sure the comment is wrong; no view on which way to go.
6. **Make the laws test say what it skips,** or search every shipped folder. Today it looks at
   16 of 28 machines and the direction note claims all. 80% sure.
7. **Keep PR 44's `lint:dead` out of the gate** until kamp-us/demlik#733 is fixed. Report only at
   most. Why: 11 of 12 wrong. 90% sure.
8. **Keep the rest as they are.** For `no-implicit-effect-concurrency` (60%): it is a style rule
   by Google's criteria, which keep style out of the blocking tier, but it costs one option per
   call and has never been ignored. For the promises gate (60%): it has never fired, so there is
   no record to judge. Look again after it fires ten times.

Going forward: a check copied from elsewhere, or a number taken from a tool, should be held to
the same bar before it blocks. Run it on main, read every fire, and count fires where the code
stays. Above 0 for a gate, or 10% for advice, it does not block.

**Applied:** 2 and 5 in PR 51 (the D1 rule is gone; the "warn" comment says it blocks), and in the same PR 3 and 4 in part: `no-effect-promise` and `no-raw-try-catch` only advise (`severity = "info"`), not yet narrowed.

**Applied:** 1 in PR 53: one `testTimeout` of 60 s in `vitest.config.ts`, from measured times;
79 limits written in tests removed, 3 kept.

**Missed by PR 53, applied in PR 56:** vitest's 10 s `hookTimeout` default, and limits written
inside tests with `Effect.timeout`. CI went red on three of them with no bug (run 40114997277).
PR 56 sets `hookTimeout` to the same 60 s, and removes 39 `Effect.timeout` calls, 3 hand-written
20 s deadlines and the two 60 s Miniflare hook limits. It keeps 3 `Effect.timeoutOption` calls
whose window is the check, or which the code under test needs. With three suites side by side,
the slowest test took 33.0 s and no file's hooks took more than 1.5 s.

**Corrected in PR 53, from logs:** all 12 red logs can still be read (`gh api .../actions/jobs/<job>/logs`).
The "unknown" push, 7b4e440, was law 30 failing on node:sqlite (wrong law, fixed by 0aba7f4).
a06a26a was law 17 failing on node:sqlite, not a 5 s limit: the guess above was wrong, and law 17
still fails under load. 075eb56 also hit the 5 s limit. So the 5 s limit still covers 6 red pushes.

## What it cannot tell us

- **Fires fixed before a push leave no trace.** Every "fires right" count is a lower bound, and
  for most checks it is "not counted". A rule with many local catches could look worse here than
  it is.
- **Most red CI logs are gone.** 6 of 10 causes are read from the commit that fixed them, not
  from the log; one is inferred from a commit message, and one is unknown.
- **CI is three days old here.** 64 main pushes is a small sample. The 9.4% flaky rate could move
  a lot.
- **Each ignore was judged by one reader,** against the rule's own stated reason. Another reader
  might call some of the 21 `try` ignores real.
- **The checks that never fired have no record.** "0 wrong" for the layers, boundaries, browser,
  promises and build checks means no evidence, not proof they are right.
- **The tests themselves were not audited.** 2206 tests can each raise a false alarm. Only the
  time limit stood out in CI.
- **We did not read phoenix's #2736, #3196 or ADR 0082.** They might give a reason for a rule that
  its header leaves out.

Sources:

- Sadowski, Aftandilian, Eagle, Miller-Cushon, Jaspan. "Lessons from Building Static Analysis
  Tools at Google." CACM 61(4), 2018. https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/
- Sadowski et al. "Tricorder: Building a Program Analysis Ecosystem." ICSE 2015.
  https://research.google.com/pubs/pub43322.html
- Micco. "Flaky Tests at Google and How We Mitigate Them." Google Testing Blog, 2016.
  https://testing.googleblog.com/2016/05/
- Eagle. "Change-Detector Tests Considered Harmful." Google Testing Blog, 2015.
  https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html
- ESLint. "Introducing bulk suppressions." 2025. https://eslint.org/blog/2025/04/introducing-bulk-suppressions/
- ArchUnit `FreezingArchRule`, release notes v0.11.0. https://newreleases.io/project/github/TNG/ArchUnit/release/v0.11.0
- Effect. "Creating Effects" (`Effect.promise`). https://effect.website/docs/getting-started/creating-effects/
- vitest `testTimeout` (default 5,000 ms). https://vitest.dev/config/testtimeout
