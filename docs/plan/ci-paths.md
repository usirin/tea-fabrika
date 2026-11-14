Approved by the lead agent, builds 0175 and experiment 288 with the owner's yes to narrowing two laws; body aefe6564da75
Plancheck-Version: 3

# Plan: CI stops running every `next` test for a change that cannot reach them

This plan is about today's CI tooling, which serves both versions. It changes no product code.

```text
# node .github/ci/changes.mjs, on a pull request, in the merge queue and on a push to main
#
#                    comment-only .ts   lint rule files    experiments/      skill file that is
#                    under next/        alone              script alone      no script, alone
#                    before  after      before  after      before  after     before  after
# check              on      on         on      on         on      on        on      on
# typecheck          on      on         on      on         on      off       on      on
# test (tooling)     off     off        on      on         on      off       on      on
# next               all     readers    all     readers    all     off       all     off
#
# all     = every test under next/, six machines, 36 to 44 machine-minutes
# readers = only the next/ tests that read source files as text, lint them or bundle them
# A path nobody listed, or a file the parser cannot judge, still runs everything.
```

## The answer first

- **Cases 3 and 4 are safe to skip, by path alone.** No `next/` test reads a file under
  `experiments/` or under a skill folder. One of today's tests reads one experiments file; that
  folder keeps today's behavior.
- **Case 2 is safe only if the reader tests stay on.** The lint tests in `next/` copy
  `.oxlintrc.json` and the plugin folder and run oxlint. They are 13 files, 12 of them in one
  folder.
- **Case 1 is safe only if the reader tests stay on too.** A doc comment cannot change what a
  program does. It can change what a test sees when the test reads the file as text. And the
  bundler this repo uses keeps doc blocks in its output (measured, below).
- **CI can tell a comment-only change exactly,** with the parser the repo already locks,
  `oxc-parser` 0.157.0. Node 26.13.0 has no built-in that removes comments. The cost is about
  15 seconds in the `changes` job, and only on a run whose changed lines all look like comments.
- **Both the pull request and the merge queue go light.** Decisions 0174 and 0175 already say a
  queue run and a push follow the same paths as a pull request.

## How others do it

- **GitHub's own filters look at paths only.** `paths` and `paths-ignore` decide "by evaluating
  the changed files" against a list of patterns. The docs also warn that a workflow skipped this
  way leaves a required check "Pending". This repo already solved that with `ci-required`.
  Source: [workflow syntax](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions).
- **Nx picks tasks by which files changed.** It "selects each build and test task whose inputs
  include a changed file". A file can be left out of a task's inputs with a `!` pattern. Nothing on
  the page reads file content. Source: [Nx affected](https://nx.dev/ci/features/affected).
- **Bazel gets there through outputs, not sources.** An action reruns when the hash of an input
  changes. A Java target hands its users an interface jar, so a change that leaves the interface
  jar the same stops there. A test that reads a source file must declare it as an input, and then
  it reruns. That is this plan's rule in other words: tests that read text stay on. Sources:
  [interface jars](https://fzakaria.com/2024/10/29/bazel-knowledge-what-s-an-interface-jar),
  [the many caches of Bazel](https://blog.engflow.com/2024/05/13/the-many-caches-of-bazel/).
  Not fetched: Bazel's own docs on this.
- **One open-source repo does the comment check.** RIOT-OS has a CI helper that asks whether a
  `.c` or `.h` file changed only in comments. It runs both versions through the compiler's own
  preprocessor, which strips comments, and compares the hashes. Any error counts as a real
  change. Source: [RIOT commit 60f9cea](https://git.riot-os.org/RIOT-OS/RIOT/commit/60f9ceabd15c0ac55820d6102dbf8e5e279d3cb3).
  Two lessons are taken from it: use the language's real parser, and fail toward the full run.
- **Found none:** a general tool that skips CI for comment-only TypeScript changes. One web
  search, not a full survey.
- **Elm and Erlang/OTP have no answer here.** This is build tooling, not a machine.

## What was measured

All of it on 2026-11-13, at main commit 48460bdaa, with throwaway scripts outside the repo. No
test, lint or type check was run.

**The detector on the four pull requests.** The files of pull requests
[1162](https://github.com/kamp-us/tea-fabrika/pull/1162),
[1165](https://github.com/kamp-us/tea-fabrika/pull/1165),
[1166](https://github.com/kamp-us/tea-fabrika/pull/1166) and
[1167](https://github.com/kamp-us/tea-fabrika/pull/1167), each against its merge base: 32 of 32
files parse to the same tree. It took 0.2 to 0.4 seconds per pull request, file reads included.

**The last 100 merged pull requests** (1048 to 1179, 40 hours). Today's `classify` and the
proposed rules, on each one's paths:

| | Today | Proposed |
|---|---|---|
| Start `next`, every test | 39 | 34 |
| Start `next`, reader tests only | 0 | 5 |
| Start `test` | 23 | 23 |
| Start `typecheck` | 45 | 45 |

Five would have run fewer jobs. All five are case 1: 1128, 1162, 1165, 1166, 1167. Cases 2, 3 and 4
did not occur in these 100. They show up further back:

**The last 600 merged pull requests** (496 to 1179, six days): 26 would have run fewer jobs.

- Case 1, comment-only: 5.
- Case 2, lint rule files with no `next/` file: 11.
- Case 3, experiments files: 9.
- Case 4, a skill file that is no script: 1.

**The detector's refusals.** In those 600 pull requests, 7,137 changed `.ts` files exist on both
sides. 1,764 parse to the same tree; most come from two format sweeps (pull requests 659 and 736),
which shows that a whitespace-only change counts as the same program too. 11 more had the same
tree and were refused for a tool word in a changed comment: 6 `oxlint` lines and 5
`oxfmt-ignore` lines. All 11 are real tool comments. No plain sentence was refused.

**What a full `next` run costs.** Three runs of comment-only pull requests: 2,138, 2,436 and
2,660 machine-seconds over six machines. The slowest machine took 628, 604 and 799 seconds; on
pull request 1165's first run it took 961. Each of these pull requests ran it at least twice, once
on the pull request and once in the queue.

**The dangerous direction.** For each of the 26 pull requests above, every `check` run on its
branch and in the queue was listed, and each failed job was read. A `next` machine failed three
times:

- Pull request 1162, in the queue: `QueueRunnerTest.ts` line 410 timed out at 120 seconds.
- Pull request 708, experiments only: a mailbox test timed out at 60 seconds.
- Pull request 874, lint rule files only: a mail scenario about ticket 402 failed.

None of the three is a test that reads source text or lint config. All three pull requests later
passed with no change to those tests. So in this history a comment-only or lint-only change never
turned a `next` test red for a real reason, and the full run made three false reds.

**The bundler keeps doc blocks.** The pull requests' reviews showed the same output from
`esbuild`. This repo's build uses rolldown 1.2.13. A one-file bundle made with it, not minified,
keeps a `/** ... */` block and drops `//` and `/* */` comments. So a doc comment does reach the
bytes of a built program. No test found pins those bytes to a fixed value; some read them.

## Is each skip safe?

**Case 1, comment-only source files.** What can still see a comment:

- A test that reads source as text. Some match with a pattern, such as the exam's `laws-scan`
  test, which looks for `defineMachine(` and for `import` lines.
- A test that runs oxlint, the type checker or a parser over real files. A tool comment changes
  what they do. A plain comment does not.
- A test that builds the real app and reads the bundle. Doc blocks are in it.
- A test that pins a line number of a source file. None was found; the search was by reading
  names, not complete.

A `rg` for file reads in `next/` test files found 88 files. Most read only temp files they wrote.
These read real source, and are the first reader list:

- `next/apps/fabrika/src/exam/`: 29 test files, 337 measured seconds.
- `next/apps/fabrika/src/settings-generated.test.ts`: runs oxlint through the exam's plant helper.
- `next/apps/fabrika/src/build.test.ts`, `next/apps/fabrika/src/build-command.test.ts`,
  `next/apps/fabrika/src/instance-one-file.test.ts`: build the real app and read the result.
- `next/packages/libfabrika/src/node/build/`: its tests copy the app's `src` and bundle it.
- The end-to-end runner, `node next/apps/fabrika/e2e.ts`. It already runs on machine 1 only, and
  it stays.

Every other `next/` test meets the changed file only by importing it, and an import gives the same
program. `check` and `typecheck` stay on, so the docs rule, the format check, the edge comment
rule and every `@ts-` comment are still judged.

**Case 2, `.oxlintrc.json` and `oxlint-plugins/`.** In `next/`, these read them:

- `next/apps/fabrika/src/exam/plant.ts`, which copies the config, links the plugin folder and
  runs oxlint. Twelve exam tests and `settings-generated.test.ts` import it.
- `next/apps/fabrika/src/exam/one-store-hook.test.ts`, which does the same by hand.
- `next/apps/fabrika/src/exam/edge-comment.test.ts`, which parses the config.

All are on the reader list. No product file under `next/` names either path. `vitest.config.ts`
imports one plugin file, and every run loads that config, the reader run included.

**Case 3, `experiments/`.** No `next/` test and no tooling test reads a file there. The root
`tsconfig.json` says the experiments are not type-checked in CI, and no workspace package holds
them. Lint does read them, so `check` stays on. One exception:
`apps/fabrika/src/pipes.test.ts` reads
`experiments/177-themes/schemes/radix-colors-3.0.0.json`. That folder keeps today's behavior, and
the gap it shows is a finding below.

**Case 4, a skill file that is no script and no prose.** Today the only one is
`.agents/skills/lead/gc.plist`. `gcloop.ts` and `gcloop.test.ts` in the lead's scripts read it;
both are tooling, and `test` stays on. Nothing under `next/` reads a file under
`.agents/skills/`.

## How CI knows a change is comment-only

- **No built-in does it.** On Node 26.13.0, `module.stripTypeScriptTypes` takes only
  `mode: "strip"`. It blanks types and keeps every comment.
- **The parser is already locked.** `oxc-parser` 0.157.0 is a root dev dependency. It returns the
  tree and the comments as two separate lists.
- **Same program means:** both versions parse with no error, and the two trees are equal once the
  position fields are dropped. Literal text (`raw`) stays in the comparison, so `16` and `0x10`
  differ. Text inside a string, a template or a regex is part of the tree, so it differs too.
- **Tool comments are refused.** A comment that was added, removed or changed may not look like
  a tool comment: an `@` word with a dash or underscore (`@ts-expect-error`,
  `@vitest-environment`, `@__PURE__`), `#__`, a leading `!`, `@jsx...`, `@license`, `@preserve`,
  `<reference`, `sourceMappingURL`, an `ignore` pair such as `v8 ignore`, or the name of a lint or
  format tool. JSDoc tags such as `@since` and `@stability` pass.
- **When it cannot tell, everything runs.** A parse error, a file added or deleted, a file that is
  not `.ts` or `.tsx`, a failed `git show`, a missing parser, a failed install: each leaves the
  file out of the set, and a file out of the set runs every `next` test.
- **The cost.** The field job already does this install: pnpm setup 5 to 8 s, Node setup 4 s, a
  filtered install 4 to 5 s. Parsing takes under half a second. The `changes` job takes 17 to
  38 s today.
- **Who pays.** Only a run where every changed line of every candidate file starts like a
  comment (`//`, `/*`, `*`) or is blank. That first look reads `git diff -U0` and needs no
  install. It never decides a skip. It only decides whether to install the parser.
- **No hand-written stripper.** The real parser finds the comments. The laws below still attack
  it with comment-like text in strings, templates and regexes.

## The shape

A sketch. The names are the test writer's to settle, inside the rules on names.

```js
// .github/ci/changes.mjs
/** @typedef {"none" | "readers" | "all"} Scope */
const lint = (path) =>
  path === ".oxlintrc.json" || path.startsWith("oxlint-plugins/");
const skill = (path) => path.startsWith(".agents/skills/");
const read = ["experiments/177-themes/schemes/"];
const experiment = (path) =>
  path.startsWith("experiments/") && !read.some((r) => path.startsWith(r));

/** The next/ tests that read source as text, lint it or bundle it. */
export const readers = [
  "next/apps/fabrika/src/exam/",
  "next/apps/fabrika/src/settings-generated.test.ts",
  "next/apps/fabrika/src/build.test.ts",
  "next/apps/fabrika/src/build-command.test.ts",
  "next/apps/fabrika/src/instance-one-file.test.ts",
  "next/packages/libfabrika/src/node/build/",
];

/** @returns {Scope} what of next/ one path needs */
const needs = (path, same) => {
  if (quiet(path) || script(path) || old(path)) return "none";
  if (experiment(path) || skill(path)) return "none";
  if (lint(path)) return "readers";
  if (path.startsWith("next/") && same.includes(path)) return "readers";
  return "all"; // a path nobody listed lands here
};

/** The widest need of any path. `same` holds paths the parser proved. */
export const scope = (paths, event, same = []) => /* max of needs */;
// classify: next = scope !== "none"
//           typecheck = some path is neither quiet nor an experiment
//           test = today's rule, with experiment paths left out
```

```ts
// .github/ci/program.ts, new. Runs only after the filtered install.
import { parseSync } from "oxc-parser";

/** True only when both parse clean, the trees match and no tool comment changed. */
export const sameProgram = (name: string, before: string, after: string): boolean

/** The paths of `paths` that are the same program at `base` and `head`. */
export const samePaths = (base: string, head: string, paths: readonly string[], run: Runner): string[]
```

```yaml
# .github/workflows/check.yaml, the changes job (sketch). No new action: the field job
# already uses these two.
- id: diff
  run: node .github/ci/changes.mjs          # as today, plus probe=true|false
- uses: pnpm/action-setup@v6
  if: steps.diff.outputs.probe == 'true'
  continue-on-error: true
# setup-node 26.13.0 and the filtered install, same `if`, same continue-on-error
- id: same
  if: steps.diff.outputs.probe == 'true'
  continue-on-error: true
  run: node .github/ci/changes.mjs --same   # prints next= and filter= again
# outputs:  next:   steps.same.outputs.next   || steps.diff.outputs.next
#           filter: steps.same.outputs.filter || steps.diff.outputs.filter

# the next job: six machines as today; only the path argument moves
env:
  FILTER: ${{ needs.changes.outputs.filter || 'next/' }}
run: pnpm exec vitest run $FILTER --shard "$SHARD" ...
```

- **The six machines stay.** `workflow-lint.ts` pins six and `/6`. A reader run splits about 35
  files over them. Each machine then runs for about 2 to 3 minutes, set-up included, and machine 1
  adds the end-to-end runner, about 100 s. This is an estimate from the measured seconds per file.
- **`ci-required` does not change.** `next` is still on or off, and a reader run must pass.
- **A draft is unchanged.** It starts no `next` job, so it never installs the parser.
- **The `field` job is unchanged.** It runs the path-only pass.

## One value traced through

Pull request 1165, six files under `next/packages/libfabrika/src/transport/`:

1. `changes.mjs`, first pass: six `next/` paths, nobody proved anything, so `scope` is `all`.
   Every changed line starts like a comment, so `probe=true`.
2. The parser is installed, about 15 s.
3. `changes.mjs --same`: `samePaths` reads each file at the merge base and at the head.
   `sameProgram` says true six times. The new blocks carry `@stability`, and one holds a word
   with `@openssh` in it; neither is a tool comment.
4. `scope` is now `readers`. The job prints `next=true` and `filter=` with the six reader paths.
5. `check` and `typecheck` run in full. `test` stays off, as today. `next` starts six machines,
   and each runs its share of the reader tests.
6. In the merge queue the same steps run on the group's own base and head. If the group also
   holds a pull request that changes code, a path is unproven and `scope` is `all`.

Had one file changed a `@ts-expect-error` line, step 3 would say false for it, and step 4 would
print `filter=next/`.

## Laws

Each row is a law in `.github/ci/changes.test.ts` or the new `.github/ci/program.test.ts`,
except the two lint rows. Seed 119120, 100 runs, as the file does today.

| Law | Lint, type or test | Generator | Plant |
|---|---|---|---|
| 1. A path nobody listed gives scope `all` and every flag on, whatever `same` holds. This keeps the classifier closed. | test, 100 runs | fc.oneof: today's `shared` and `unusual/` paths, any `same` list | make `needs` end in `"readers"` |
| 2. Adding paths never lowers the scope and never turns a flag off; adding to `same` never raises it. | test, 100 runs | fc.array: path lists and `same` lists | return the last path's need, not the widest |
| 3. `same` counts only for a `next/` path that is in `paths`. | test, 100 runs | fc.array: `same` lists holding paths outside `next/` and outside `paths` | drop the `startsWith("next/")` test |
| 4. `next/` files that are all in `same`: check and typecheck on, test off, scope `readers`. One file not in `same`: scope `all`. | test, 100 runs | fc.array: today's `next` generator | treat every `next/` path as `same` |
| 5. Lint rule files alone: check, typecheck and test on, scope `readers`. | test, 100 runs | fc.oneof: `.oxlintrc.json` and paths under `oxlint-plugins/` | make `lint` paths need `none` |
| 6. Experiments files alone: check on; typecheck, test and next off. | test, 100 runs | fc.tuple: a folder, a name and one of `ts`, `mjs`, `json`, `txt`, `tsx` | let `experiment` cover `fixtures/` |
| 7. The one experiments folder a test reads runs as an unknown path does. | test | pinned: `apps/fabrika/src/pipes.test.ts` reads the color scheme file there | empty the `read` list |
| 8. A skill file that is no script and no prose: check, typecheck and test on, next off. A file under `.claude/skills/<name>/` still runs everything. | test, 100 runs | fc.tuple: today's `otherSkill` generator, split in its two arms | let `skill` match `.claude/skills/` |
| 9. Comments added, removed or rewritten between tokens give the same program. | test, 100 runs | fc.array: tokens that include strings, templates and regexes holding `//` and `/*`, with comments placed between them | compare with comments left in |
| 10. One changed token never gives the same program. | test, 100 runs | fc.tuple: a program from law 9 and one token to swap | compare the count of tree nodes only |
| 11. A tool comment that changed is refused, in a line comment, a block or a doc block. | test, 100 runs | fc.constantFrom: each word on the tool list, written from the installed tools' docs | delete one word from the list |
| 12. Comment-like text that changed inside a string, a template or a regex is not the same program. | test | pinned: a hand-written stripper gets these wrong; the three pairs tried in this plan | strip comments with a regex before parsing |
| 13. A parse error on either side, or a parser that throws, is not the same program. | test | scenario: broken source on the old side, then on the new side, then a parser that throws | return true on a thrown error |
| 14. When the program is the same, `esbuild` gives the same output for both sides. A second tool agrees with the first. | test, 100 runs | fc.array: the pairs of law 9 | drop a `const` on one side only |
| 15. `samePaths` leaves out a file that was added or deleted, is not `.ts` or `.tsx`, or whose `git show` failed. | test, 100 runs | fc.tuple: a path, a status and a fake runner, as the NUL law does today | read a missing side as empty text |
| 16. With no parser to import, `--same` prints what the first pass printed. | test | scenario: the import of `program.ts` rejects | catch the error and print `next=false` |
| 17. `probe` changes no flag: the first pass prints the same flags for any diff text. | test, 100 runs | fc.string: diff text | read `probe` inside `classify` |
| 18. Real pairs are the same program. | test | vector: three file pairs from pull request 1165, old and new, saved as they were | change one token in a saved file |
| 19. Each entry of `readers` is a tracked path that holds a test file. | test | format: a renamed folder would leave the reader run empty | add a path that does not exist |
| 20. Only a file on the reader list imports the exam's plant helper. | lint | lint | import it from a test outside the list |
| 21. In `check.yaml`, the `next` job's path comes from `filter` with the fallback `next/`, and the `changes` job's parser steps carry `continue-on-error`. | lint | lint | remove the fallback |

- **Lint, type or test?** Laws 1 to 19 are about what two functions answer, so they are tests.
  Law 20 is the shape of imports, so it is oxlint's own `no-restricted-imports`. Law 21 is the
  shape of a workflow file, so it is a rule in `workflow-lint.ts`, this repo's lint for
  workflows, with its cases in `workflow-lint.test.ts`.
- **Law 20 has a known limit.** It catches a new test that lints through the helper. It does not
  catch a new test that reads source text with its own `readFile`. See what this cannot tell us.
- **Laws that get narrower,** and so need the owner's yes (question 2): "other skill-tree paths
  still run check, typecheck, test and next" loses `next` for `.agents/skills/`; "shared paths run
  check, typecheck, test and next" keeps its generators but no longer covers lint rule files.
- **No host-only law.** Nothing here needs the real machine.

## Is it a setting?

Decision 0069 asks this of each new choice. A `fabrika.toml` value is read by the product while it
runs. Every choice here is read by CI before anything is installed.

- **The reader list:** no. It is a fact about which tests read text, not a preference.
- **The tool-comment list:** no. It is a safety list that only grows.
- **The one experiments folder a test reads:** no. It is a fact about one test.
- **Which events go light:** no. Decisions 0174 and 0175 fixed that.
- **No new number.** The six machines and their time limit stay as they are.

## What does not change

- No new third-party action. `pnpm/action-setup` and `actions/setup-node` are already in this
  workflow.
- No new workflow file.
- No change to the checks a merge requires. `ci-required` and `required.mjs` stay as they are.
- No new shell or Python script (decision 0113). The new code is one `.ts` file and edits.
- `e2e`, `build`, `field` and today's tests follow the same rules as today.
- A comment-only change in today's version (`packages/`, `apps/`, `programs/`) is not touched.
  Its tests already follow imports.

## Files and ownership

Every file is on the exam list (the CI folder, the lockfile, the lint config), so the tests step
writes all of it. There is no build step.

| Path | Owner | Slice | Product lines expected | What changes |
|---|---|---|---|---|
| `.github/ci/changes.mjs` | tests | 1, 2 | tooling, 25 then 80 | the path rules, `scope`, `readers`, `probe`, `--same` |
| `.github/ci/changes.test.ts` | tests | 1, 2 | tests, 60 then 150 | laws 1 to 8, 16, 17, 19; two laws narrowed |
| `.github/ci/program.ts` | tests | 2 | tooling, 60 | new: `sameProgram`, `samePaths` |
| `.github/ci/program.test.ts` | tests | 2 | tests, 190 | new: laws 9 to 15, 18 |
| `.github/ci/fixtures/same` | tests | 2 | tests, 6 saved files | new: the three real pairs of law 18 |
| `.github/ci/package.json` | tests | 2 | 1 | `oxc-parser` from the catalog |
| `pnpm-lock.yaml` | tests | 2 | 3 | the new importer line; no new version |
| `.github/workflows/check.yaml` | tests | 1, 2 | 6 then 30 | comments; the parser steps; `filter` |
| `.github/ci/workflow-lint.ts` | tests | 2 | tooling, 25 | law 21; the pinned `next` script line |
| `.github/ci/workflow-lint.test.ts` | tests | 2 | tests, 40 | law 21's cases |
| `.oxlintrc.json` | tests | 2 | 12 | law 20 |

## Paths named and not changed

The plan checker wants every exam path a plan names in a files table. These are read or cited
here. No step changes them.

| Path | Owner | What it is here |
|---|---|---|
| `next/apps/fabrika/src/exam/` | tests | the first entry of the reader list |
| `next/apps/fabrika/src/exam/plant.ts` | tests | the plant helper that runs oxlint |
| `next/apps/fabrika/src/exam/one-store-hook.test.ts` | tests | a reader of the lint config |
| `next/apps/fabrika/src/exam/edge-comment.test.ts` | tests | a reader of the lint config |
| `next/apps/fabrika/src/settings-generated.test.ts` | tests | a reader, on the list |
| `next/apps/fabrika/src/build.test.ts` | tests | a reader, on the list |
| `next/apps/fabrika/src/build-command.test.ts` | tests | a reader, on the list |
| `next/apps/fabrika/src/instance-one-file.test.ts` | tests | a reader, on the list |
| `next/apps/fabrika/e2e.ts` | tests | the end-to-end runner, which stays on |
| `next/programs/pipeline/src/QueueRunnerTest.ts` | tests | where the first finding points |
| `apps/fabrika/src/pipes.test.ts` | tests | the one test that reads an experiments file |
| `oxlint-plugins/` | tests | the lint rules of case 2 |
| `vitest.config.ts` | tests | imports one plugin file |
| `.github/ci/required.mjs` | tests | the required check's judge, unchanged |

## Slices

1. **Slice 0, a measurement, never merged.** One branch plants a doc block at the top of every
   `next/` source file, and a second one plants a doc block that holds trap text (an `import`
   line, `defineMachine(`, a path-like string). Each gets one full `next` run. A test outside the
   reader list that goes red is a reader, and joins the list before slice 2 is built. The write-up
   is an `experiments/` file with the next free number. Cost: two full runs, about 90
   machine-minutes.
2. **Slice 1, cases 3 and 4.** Path rules only. Nothing blocks it, so it lands first.
3. **Slice 2, cases 1 and 2.** The reader scope, the lint rule, the parser. It saves the most:
   case 1 is every doc fill still to come, and each one runs `next` at least twice.

One decision file comes before slice 1, in its own docs pull request, once the owner answers the
two questions. It records that the `next` job may run only its reader tests, or none, by what
changed. Decision 0175 left `next/`'s own checks undecided.

## Where this differs from settled notes

- **Decision 0175, "Not decided: nothing about `next/`'s own checks."** This plan decides
  something there. That is why it needs a decision file.
- **Decision 0175's law that a queue group and a push get a pull request's flags** holds. The
  parser pass runs on each event's own base and head.
- **`AGENTS.md`, Checks:** "A script under `experiments/`" already says lint only. CI now agrees.
- **The docs plan** ([ticket 900](./ticket-900-docs-lint.md)) has the lead check each fill "parses
  to the same tree with comments left out". Slice 2 turns that hand check into code. The lead's
  check can stop once slice 2 lands; that is the lead skill's call, not this plan's.

## What this records

- **Each run prints why it went light.** `changes.mjs --same` prints one line per candidate
  file: same program, or the reason it was refused. It prints the parser's version. The same
  lines go to the job summary.
- **What is lost if this is not recorded:** when a hidden red shows up later, nobody could tell
  which run skipped the test and on what proof. GitHub keeps the log for its normal time. No
  longer record is planned; a field row per light run would be noise.
- **The reader list's proof** is the slice 0 write-up, kept in `experiments/`.

## Size

About 70% sure of the line counts. The laws of `sameProgram` are the part that may grow.

1. Slice 0: the two planted branches and the write-up. About 60 lines of write-up, no code kept.
2. Slice 1: 3 files, about 90 lines, 60 of them tests.
3. Slice 2: 11 files, about 590 lines, 380 of them tests, plus 6 saved files.

Slice 1 is a tests step and a review. Slice 2 is a tests step, a review, and one send-back to
each. Priced as the docs plan priced its steps, from list-price medians in `field/runs.jsonl`
since 2026-11-09 (tests $1.14, review $1.15), with slice 2's tests step at ticket 477's $3.84.

Estimate: 6 steps, $12

## Findings

```json
{"_tag":"finding","id":"2026-11-13-queue-runner-law-times-out-in-the-queue","date":"2026-11-13","by":"plan","model":"claude-fable-5-2","rule":"flaky_test","location":{"path":"next/programs/pipeline/src/QueueRunnerTest.ts","line":410},"says":"The S2 secrets property of the queue runner timed out at 120 s in a merge queue run of a pull request that changed only doc comments in other files.","proof":"CI run 43549881944 (merge_group, pull request 1162), job 132310393513, next (3): the check run's annotation reads 'next/programs/pipeline/src/QueueRunnerTest.ts:410 Error: Test timed out in 120000ms.' Pull request 1162 changes eight files under next/packages/libfabrika/src/ and all eight parse to the same tree as their base with oxc-parser 0.157.0.","cost":"A pull request that cannot have caused the failure is put out of the merge queue and must be queued again.","head":"48460bdaa583aa193bdb86bf5b16cb27e793c324","ticket":null,"pr":null}
```

```json
{"_tag":"finding","id":"2026-11-13-a-todays-test-reads-an-experiments-file-ci-does-not-count","date":"2026-11-13","by":"plan","model":"claude-fable-5-2","rule":"bug","location":{"path":".github/ci/changes.mjs","line":61},"says":"A change to experiments/177-themes/schemes/radix-colors-3.0.0.json starts none of today's tests, yet apps/fabrika/src/pipes.test.ts reads that file.","proof":"apps/fabrika/src/pipes.test.ts line 26 reads the file with readFileSync. Importing .github/ci/changes.mjs in node and calling jobs(['experiments/177-themes/schemes/radix-colors-3.0.0.json'], 'pull_request', false) prints today false, e2e false and build false, so the test job runs the tooling tests alone.","cost":"A wrong color value in that file passes CI and turns the test red on the next change to today's app.","head":"48460bdaa583aa193bdb86bf5b16cb27e793c324","ticket":null,"pr":null}
```

## What this cannot tell us

- **The reader list is not proven complete.** It comes from a search, from the matching lines of the
  88 files it found, and from a close read of about ten of them. Slice 0 tests it with two planted changes; a test that only reacts
  to some other comment text would still be missed. What would settle it: a guard in the test
  set-up that fails a `next/` test outside the list when it opens a product source file. That is
  not planned here.
- **How a hidden red would show.** The next change to real `next/` code runs every `next` test.
  At this week's pace that is about once an hour (34 of the last 100 merged pull requests in 40
  hours). The red would land on a pull request that did not cause it.
- **The reader run's time is an estimate.** 145 of the 258 `next/` test files have no measured
  seconds; they count as 1 s each. The first real reader run gives the number.
- **The tool-comment list was written from memory of the tools,** not from the installed
  versions' docs. The test writer reads vitest 5.0.5, vite 8.3.2, rolldown 1.2.13, esbuild 0.28.2
  and oxlint 1.90.0 for their comment forms first. A tool comment in plain words that the list
  misses would pass; `check` and `typecheck` still run on it.
- **Line numbers.** A comment-only change moves lines. A test that pins a line of a source file
  would go red. None was found, and the first planted branch in slice 0 measures exactly this.
- **The history check saw merged pull requests only.** A comment-only pull request that was closed
  after a real red would not be in it.
- **Why the three `next` failures happened** was not traced. Only the failing test's name and
  place were read.
- **Case 4's tooling tests.** Whether vitest's `--changed` picks `gcloop.test.ts` for a change to
  `gc.plist` alone was not checked. This plan does not change it.
- **The savings for cases 2 to 4 are small in count:** 21 of 600 merged pull requests. Case 1 is
  where the time is.

## Answered questions

Both were answered on 2026-11-14:

1. A comment-only change under `next/` runs the reader tests, in the pull request and in the
   queue. Experiment 288 (two plants, `experiments/288-ci-reader-list-two-plants.md`) found the
   reader list complete, so the lean holds; the lead approved it as building that experiment.
2. The owner said yes to narrowing the two laws, so lint rule files run only the reader tests of
   `next/`, and experiments and skill files run none. That is the owner's ruling, so a
   loosening.sh hit on those two laws is expected and read against this line.

## Open questions

None.
