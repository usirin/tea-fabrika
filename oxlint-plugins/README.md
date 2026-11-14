These lint rules are the `fabrika` plugin for oxlint, written in TypeScript. `index.ts` lists them, `match.ts` holds what they share, and `.oxlintrc.json` at the top of the repo turns each one on, with the reason for every path it leaves out. Why oxlint: [`docs/direction/oxlint-and-oxfmt.md`](../docs/direction/oxlint-and-oxfmt.md).

```sh
pnpm lint                                   # runs lint.ts, then format.ts --check, then the code-graph checks
node oxlint-plugins/lint.ts packages/x      # the same oxlint step on one folder
```

`exact-versions.ts` is not an oxlint rule: `pnpm lint` runs it to refuse any ranged npm version in a tracked `package.json` or `pnpm-workspace.yaml` ([`docs/direction/pin-exact-versions.md`](../docs/direction/pin-exact-versions.md)).

`workspace-reach.ts` is not an oxlint rule either: `pnpm lint` runs it to refuse a workspace package of today's version that no app, tutorial, tool or the root `package.json` reaches through its dependencies, so a part nothing uses cannot stay ([0003](../.decisions/0003-a-clean-repo-kept-clean-by-code.md)). `next/` is left out while Tier 1 builds pieces before their app names them.

Run oxlint and oxfmt through `lint.ts` and `format.ts`, not on their own. These two pin the one config at the top of the repo and turn off nested configs and outside ignore files, so a plain file cannot take a folder out of the checks. `lint.ts` also fails when a `.gitignore` hides a tracked file.

They began as GritQL rules in the `biome-plugins/` folder of [kamp-us/phoenix](https://github.com/kamp-us/phoenix), the pipeline this repo rebuilds, copied here unchanged. On 2026-10-31 they became TypeScript rules here, so this folder is where they change now. Each one fired on the same lines as its GritQL rule, on the whole tree and on a set of odd spellings; the note above has the numbers. The counts below are from when the GritQL rules were added and are kept as history. A name like `no-secret-env.grit` in them means the rule that is now `no-secret-env.ts`, and a mention of `biome-ignore` means what is now `oxlint-disable-next-line`.

Five rules that only advised now block wherever their folder is at zero ([0523](../.decisions/0523-advice-rules-block-where-clean.md)): `law-shape`, `no-effect-promise`, `no-raw-try-catch`, `prefer-schema-arbitrary`, and oxlint's own `no-restricted-properties` (a bare `JSON.parse` in `next/`). Each is `"error"` in its base scope. The config's last overrides set it to `"warn"` for the folders that still have fires, and `lint.ts` prints a fire there as `advice, this folder is not at zero yet`, without failing. Any other fire fails, a warning included. `service-id` advised from ticket 737 until ticket 909, and blocks since. Oxlint has no level below `warn`, so `lint.ts` runs oxlint once and decides (`advice.ts`). Experiment 125 found `no-effect-promise` and `no-raw-try-catch` wrong far too often to block when they were written (8 of 8 and 21 of 21 fires kept their code); 0523 sets that count aside, and each pull request that makes a folder block reports what it met.

## Where a rule still advises

A warn line names one folder: a package's `src/<name>/**`, the files right in `src/` as `src/*`, or, outside a `src/`, one folder's own files as `<folder>/*`. So a dirty folder never holds back its clean siblings. `law-shape` and `prefer-schema-arbitrary` lines keep the rule's file kinds (`<folder>/**/*{.test.ts,.test.tsx,Test.ts}`), so a warn line never turns a rule on where its base scope has it off. A warn line goes the moment its folder reaches zero: a whole `pnpm lint` run reads the lines from `oxlint --print-config` and fails on one with no fire left, or one that names a file, and says which line to delete. A run on a path skips that check, since it does not see every fire. A folder that blocks never goes back to a warn line (0523).

`no-effect-promise` and `no-raw-try-catch` are `"error"` at the top level, so a new folder blocks from its first file. Today's version is frozen (0525): one override sets the two to `"warn"` for `apps/**`, `programs/**`, `packages/**` and `bin/**`, and a later one takes `packages/fabrika-design/**` back to `"error"`, since the design package stays live (0456). That frozen override is not a dirty-folder line: `advice.ts` names its globs, so the stale check never reads them, and both go when the freeze lane takes those paths out of lint. No warn line names a frozen path, and its 107 fires still print as advice.

Count on 2026-11-13, ticket 930, on `origin/main` at `7ae7cea0f` (the same as `59cb6a311`, a docs-only change), outside today's version:

| Rule | Fires | Folders that advise | Disable lines |
|---|---|---|---|
| `no-effect-promise` | 332 | 17 | 0 |
| `no-raw-try-catch` | 36, 29 after the 7 in `.agents/skills/lead/scripts/` were fixed | 7 | 0 |
| `no-restricted-properties` (`JSON.parse`) | 103 | 14 | 0 |
| `law-shape` | 323, 319 after the disable lines | 14 | 4 |
| `prefer-schema-arbitrary` | 21 | 8 | 0 |

The per-folder counts are in the pull request for ticket 930, which made them block. A hand read of every fire in a folder with three or fewer found seven type laws, tests whose `@ts-expect-error` or `expectTypeOf` lines are the check, which `law-shape` cannot read as a property or an example: four take a disable line with that reason (`access/ClientManager.test.ts`, two in `settings/Setting.test.ts`, `checklist/src/program.laws.test.ts`), which brings three folders to zero, and three (`counter/src/window.types.test.ts` twice, `node/ErrorCause.types.test.ts`) wait for the fills that clear their folders. Whether a type law should get its own label is the owner's call.

## Isolate boundary

| Rule | Checks | Cannot see |
|---|---|---|
| `isolate-boundary` | U11: `TraceItem`, `Fetcher` and `ctx.exports` stay in libfabrika's `cloudflare/`; the app's `tail` and `usage` return one call | Aliased platform names, dynamic property keys, or logic hidden inside the call |

Enabled for all of `next/`, including tests. Comments and strings pass. Optional reads and
literal computed `exports` reads are checked. The rule uses oxlint's syntax visitors; a type
checker cannot keep these names in one module. Main at `4359ea84` has zero hits. A temporary
`TraceItem` use in the app entrypoint produced one blocking hit and was restored.

## Decode and service-ID guards

Ticket 737 builds decision 0023 in `next/`: input is decoded with Effect Schema, and a service ID carries the package and its file's path, as Effect's own guide asks. Two guards keep it so. The `JSON.parse` one blocks in every folder at zero (0523). The service-ID guard was advice too, and blocks since ticket 909.

```ts
JSON.parse(text);                                            // blocks: Schema.fromJsonString(S) instead
class Doorbell extends Context.Service<Doorbell, Shape>()(
  "@kampus/libfabrika/ledger/Ledger.Doorbell",               // passes in ledger/Ledger.ts
) {}
class Bell extends Context.Service<Bell, Shape>()(
  "@kampus/libfabrika/Bell",                                 // blocks in ledger/Ledger.ts: no path
) {}
```

`no-restricted-properties` is oxlint's built-in, set for object `JSON`, property `parse`, on `next/**`. It fires on `JSON.parse(x)`, `JSON["parse"](x)`, `JSON?.parse(x)`, a reference `const f = JSON.parse` and `const { parse } = JSON`. It does not fire on another object's `parse`, a comment, a string, `typeof JSON.parse` or code outside `next/`. It does not read scope: a local `JSON` fires too (a false alarm), and an alias (`const J = JSON; J.parse(x)`) is missed. A test oracle that must parse as the old code did keeps it with `// oxlint-disable-next-line eslint/no-restricted-properties -- <why>`. `decode-guards.test.ts` holds each of these cases.

`service-id` is ours: oxlint's selectors cannot resolve a renamed import or a shadowed name, or compare an ID with its file (0040). Its options name the package and its source folder; outside that folder it says nothing. A class's ID is exactly `<package>/<path>`, or `<package>/<path>.<Class>` when the class is not named as its file. A Reference or a direct Service names nothing the rule trusts, so `<path>` or `<path>.<Name>` for one name passes. An ID that is not a literal is reported as unproved. The rule's head comment lists the import forms it resolves and what it misses (a local alias of `Context.Service`, a helper). `service-id.test.ts` plants each form, holds the plan's old-to-new mapping as a vector, and replays the rule over libfabrika.

Replay on 2026-11-11, at `8594eebc6` with this ticket's laws, before its build:

| Guard | Fires | True | False alarms | Unresolved | Reviewed misses |
|---|---|---|---|---|---|
| `service-id`, libfabrika `src/` | 35 | 35: 33 services, 1 Reference, `ProgramRunner` (next slice) | 0 | 0 | the app's `t502/RecordLaws.Wire` test service, outside the rule's folder |
| `JSON.parse`, `next/` | 75 | 2 in product code: `transport/Connection.ts` (this ticket) and `Testing.ts` (its round trip, outside it); 73 in tests and test kits, not yet read one by one | none in the 2 product hits; the 73 are unread, and the shadow case is possible | 0 | aliases |

After that build, `service-id` found only Runner's ID; it was a named hit, not an exemption. Promotion to blocking needs about 0% false alarms on main (Google, CACM 2018), measured by a fresh replay; up to 10% may keep advising, and above that the rule is repaired first.

**`service-id` blocks since ticket 909** (decision 0168: the pull request that turns a rule on fixes every break, so the rule starts at zero). The fresh replay, on 2026-11-13 at `c0aaf4a24`, `node oxlint-plugins/lint.ts next/packages/libfabrika/src`:

| Guard | Fires | True | False alarms | After the fix |
|---|---|---|---|---|
| `service-id`, libfabrika `src/` | 1 | 1: `ProgramRunner` in `runtime/Runner.ts`, written `@kampus/libfabrika/ProgramRunner` | 0 | 0 fires, with the ID as `@kampus/libfabrika/runtime/Runner.ProgramRunner` |

The rule is at `error` in `.oxlintrc.json`, out of `lint.ts`'s advice set, and its messages no longer start with "Advice, does not block". `service-id.test.ts` replays it over libfabrika and expects nothing. `decode-guards.test.ts` runs `lint.ts` itself: a clean report exits 0, and a bare `JSON.parse` in a clean folder, a wrong service ID or any other blocking diagnostic exits 1. `JSON.parse` blocks wherever its folder is at zero (0523).

## Effect property data

`prefer-schema-arbitrary` is today's tooling for `next/**/*.test.{ts,tsx}`. It asks for Effect data only when a fast-check data constructor has written schema evidence: an `Arbitrary<typeof S.Type>` annotation, a map through `S.make` or `S.cases.x.make`, or a generated binding passed to a named Effect Schema check. Imports, callback scopes and simple aliases are resolved. Nested constructors give one message at the outer constructor. Property runners pass. Names and shared record keys alone prove nothing.

The message names the schema. A reason beside the declaration keeps an edge-case or unsupported generator:

```ts
// fast-check: edge cases -- deliberately generate invalid fields to test refusal
const invalid: fc.Arbitrary<typeof Input.Type> = fc.record({text: fc.string()});
```

Use `unsupported Effect` in that comment for a generator Effect cannot make. This rule does not execute modules or read types from another file. Its generated syntax laws and four planted breaks are in `prefer-schema-arbitrary.test.ts`. One law runs `lint.ts` and proves a fire in a clean folder exits 1, alone or beside another warning.

Ticket 325, 2026-11-08, at [PR 532](https://github.com/usirin/tea-fabrika/pull/532)'s `1af180f6` next-test tree: the first scan found one false hit, `data/sink.test.ts:738`, where `Redacted.make` is not a schema. The match now excludes Effect modules other than Schema. The narrowed scan found 0 hits: 0 useful, 0 false and 0 unknown. Zero hits gives no false-alarm rate. The next-test files are unchanged in this tests commit, so its final-head count is the same. A separate parser scan found 189 named data constructors in 19 next-test files, including multiline calls. One useful miss is `data/log.test.ts:34`, checked through `parents(50).every(is)` at line 316. That helper flow needs review; it is outside the rule's direct binding matches. Effect 4.1.1 generated 10 valid `ParentText` values at seed 119120. Other constructor families exercise operation orders, invalid input or extra fields without direct schema evidence. These counts cannot show that every untyped generator should stay, or that Effect supports every domain schema.

## Effect modules imported by path

A library in `next/packages` imports each Effect module by its path (E7, [0023](../.decisions/0023-next-follows-effects-code-style.md)). This is not an oxlint rule: it is Effect's own type check, `preferNamespaceImport` in `@effect/tsgo` 0.63.0, turned on by one override in `tsconfig.base.json`, so `pnpm typecheck` is what fails. An oxlint ignore comment does not reach it.

```ts
import { Effect, Schema } from "effect";   // error in a listed folder: two names imported by name
import * as Effect from "effect/Effect";    // passes, and so does `import type * as Effect from "effect/Effect"`
import * as Schema from "effect/Schema";
```

The override sets `namespaceImportPackages: ["effect"]` and `preferNamespaceImport` to `error` for a list of folders, tests included. Its message names the module path for each name. Plan B of the Effect rules ([`docs/plan/effect-rules-big.md`](../docs/plan/effect-rules-big.md), B3) closes the list folder by folder: each slice fixes one group of modules and adds its folders in the same pull request, so there is no list of known breaks (0168). The last slice, `runtime/`, replaces the list with `next/packages/**/*.ts` and `next/packages/**/*.tsx`.

Listed today: `next/packages/libfabrika/src/ci/` and `next/packages/libfabrika/src/codehost/`, from B3.0 (ticket 912). `namespace-imports.test.ts` keeps the saved list and fails when a listed folder no longer ends at `error` for `effect` after every override in order: dropped from the list, excluded, or turned down or narrowed by a later override (law 6). Once the whole-tree globs are listed, it checks them the same way. Each slice adds its folders to that list too.

Tools looked at: the same check's quick fix in an editor, one import at a time; its oxlint form, `effecttsgo/prefer-namespace-import`, run by `effect-tsgo oxlint --type-aware`, which needs `oxlint-tsgolint` (not in the lockfile), and which B3.0 tried once in a scratch copy; ast-grep and jscodeshift, neither in the lockfile. The tryout's result: at `@effect/tsgo` 0.63.0 with oxlint 1.90.0 and `oxlint-tsgolint` 7.0.2005, `effect-tsgo oxlint --type-aware` lists the hits from the command line, but `--fix`, `--fix-suggestions` and `--fix-dangerously` each changed 0 files, so later slices fix imports by hand.

Count by module on `origin/main` at `9276a9606`, by the check through an inline config: 1,353 names in 299 files of `next/packages`, 125 product files and 174 tests.

| Module | Names | Module | Names | Module | Names |
|---|---|---|---|---|---|
| `node` | 309 | `ledger` | 85 | top files | 32 |
| `runtime` | 287 | `telemetry` | 72 | `packs` | 28 |
| `processes` | 129 | `access` | 52 | `jobs` | 20 |
| `cloudflare` | 119 | `transport` | 51 | `presence` | 8 |
| `settings` | 92 | `gateway` | 47 | `repositories`, `schedules`, `ci`, `codehost` | 6, 6, 5, 5 |

B3.0 fixed the 10 names of `ci` and `codehost`, all in their two shared test suites, `CiTest.ts` and `CodeHostTest.ts`. A run of `effect-tsgo diagnostics` on libfabrika's project then gave 0 errors. A planted `import { Option } from "effect"` in `ci/Ci.ts` and in `codehost/CodeHost.test.ts` each gave one error, and the same line in `schedules/ScheduledJob.ts`, not listed, gave none.

## Law shape

`law-shape` asks of every test in `next/**/*.test.{ts,tsx}`, a shared suite `next/**/*Test.ts` and `.agents/**/*.test.ts` what [0093](../.decisions/0093-laws-walk-plants-run-once.md) asks: is it a property, or is it labeled `vector:`, `format:`, `pinned:` or `scenario:` with its reason? The label starts the title, or comes right after one ticket or law id: one token of letters, digits and dots, then a space (`T652 scenario: ...`, `R3 format: ...`; the lead, 2026-11-11). A label deeper in the title, or only in a comment above the test, does not count.

```ts
it.prop("the window's client is the client machine's own fold", [Run], ([run]) => {/* ... */}); // a property
it("adds one", () => { fc.assert(fc.property(fc.nat(), (n) => add(n) > n)); });           // a property
it("format: every Msg the runner sends decodes", () => {/* ... */});                    // labeled
it("adds one to zero", () => { expect(add(0)).toBe(1); });                              // blocks
```

A property is `it.prop` or `it.effect.prop`, or a body that calls fast-check's `assert` or a `@demlik/tea/pbt` runner (`propertyTrace`, `propertyInvariant`, `propertyTerminates`), directly or through a function the same file declares. `syncTest` is not one: it checks one Msg list it is given. The rule's head comment lists what counts as a test, and `law-shape.test.ts` has one generated line per edge case. A title that is not written out (a helper's parameter) is not judged. Today's version's tests are left out: 0093 covers `next/`, and 0033 holds `.agents/` to `next/`'s rules. The exam's own rule tests under `next/apps/fabrika/src/exam/` are read too. 0093 says it covers laws on product code, so whether those tests belong in scope is still open; they stay in, and their folder advises until its fill.

Oxlint's [`jest/valid-title`](https://oxc.rs/docs/guide/usage/linter/rules/jest/valid-title.html) (also under the `vitest` plugin) and [`@vitest/eslint-plugin`'s `valid-title`](https://github.com/vitest-dev/eslint-plugin-vitest/blob/main/docs/rules/valid-title.md) can require a title pattern with `mustMatch`, but neither can say "or the body is a property", so this rule is ours (0040). [`eslint-plugin-jest`](https://github.com/jest-community/eslint-plugin-jest) has no rule that reads a test's body for a property runner either.

Count on 2026-11-11, on `origin/main` at `e2d553013`. Tests are call sites, so a loop or `it.each` counts once:

| Folder | Properties | Labeled | Neither (fires) | Title not written out |
|---|---|---|---|---|
| `next/apps` | 244 | 107 | 108 | 2 |
| `next/packages` | 556 | 23 | 167 | 0 |
| `next/programs` | 6 | 0 | 1 | 0 |
| `.agents` | 261 | 105 | 38 | 0 |
| today's `packages`, `apps`, `programs` (left out) | 266 | 16 | 4,198 | 37 |

The rule fires 314 times. A first hand read, of 30 fires out of 342 at seed 119120 on `b882a8062`, before ticket ids were allowed, found all 30 to be tests that are not a property and carry no label at the start of the title. But 5 of the 30 carried a label somewhere else: 4 after a ticket name (`"T652 scenario: ..."`, `"K2 scenario: ..."`) and 1 in a comment above the test (`// format: ...`). Read as false alarms, that is 17%, above the 10% an advice rule may have. So the lead let one leading id stand before the label, and the tests were not renamed. Those 4 now pass. Of the 26 left from that sample, 1 is labeled only in a comment, which still fires: 1 of 26 is 4%. Over all 314 fires, 2 have a label deeper in the title and 4 in a comment just above. 110 are plant tests, which 0093 stops keeping, and 79 are the exam's own rule tests.

Phoenix's `no-node-sqlite-test-backing.grit` is not here. It bans a fake of Cloudflare D1; this repo has no D1, and `node:sqlite` is the ledger's real driver. Experiment 125 found it wrong 8 of 8 times.

`use-import-extensions` was not a plugin before. It stands in for Biome's built-in `useImportExtensions`, because oxlint's `import/extensions` misses `import()`, `import x = require()` and a name like `./b.laws`. It also refuses `./thing.js` when only `thing.ts` is there, which tsc accepts and Node does not. It has no autofix, so a miss is fixed by hand. It fired 0 times on the tree when it was added.

`no-bare-disable` was not a plugin before either. Biome failed on an ignore comment with no reason, and oxlint does not: its bare `// oxlint-disable-next-line` silences every rule, the secret rules too. This rule refuses an ignore comment that names no rule, gives no `-- <why>`, or says `eslint-disable`. It reports at offset 0 of the file, so the comment it refuses cannot silence it. It fired 0 times on the tree when it was added.

`padding-line-between-statements` stands in for ESLint's rule of that name and `lines-between-class-members`, which oxlint 1.90.0 lacks ([0021](../.decisions/0021-a-blank-line-between-top-level-statements.md)). It asks for a blank line between top-level statements and between class members, unless both are one line, both are imports or re-exports, or the pair is one declaration (overloads, or a value then its same-name type). Its whitespace fix runs in `pnpm format`. Count on 2026-11-09, ticket 437: the first draft, with only the import and overload exceptions, fired 6,156 times in 847 files. 2,544 of those were two one-line statements and 424 a schema then its `typeof` type, both read as one group, so both became exceptions. The rule as merged fired 3,072 times in 583 files (2,920 once the `.claude/skills` link is counted once). A hand read of 40 fires at random found 0 false alarms; the earlier 30-fire read is what found the schema-type pairs. The sweep added only blank lines. `padding-line-between-statements.test.ts` generates files of imports, one-line and multi-line consts, schema-type pairs and overloads, and checks where it fires and that its fix adds only those lines.

On the same day (ticket 439) the rule took a second job: a blank line before and after every `if`, loop, `switch` and `try` in any block, unless it is first or last there, an `if` with its `else` chain and a labeled loop each counting as one statement. With `eslint/curly` set to `"all"` beside it, the tree had 14,959 padding fires and 8,378 curly fires (`.claude/skills` counted once) in 928 files. A hand read of 40 padding fires and 8 curly fires at random found 0 false alarms: each was a control statement with a neighbor and no blank line, or a body with no braces, which is what the owner asked to refuse. Many are runs of guard clauses, which now stand apart. The sweep took 8 `pnpm format` runs, since oxlint applies one fix per overlapping range a pass; every swept file parses to the same tree with a one-statement block read as its statement.

Four rules were this repo's own before the move too.

`no-secret-env.grit` and `no-redacted-value.grit` keep a secret in Effect's `Redacted` from the read to the one line that sends it (`docs/direction/secrets-are-redacted.md`). The first refuses a `process.env` read whose name looks like a secret; read it with `Config.Redacted("NAME")`. The second refuses `Redacted.value` anywhere but seven edge files, which `.oxlintrc.json` lists with their reasons. Both leave `experiments/` out, and the second leaves tests out (they hold made-up secrets and read them back). Both block. `packages/fabrika/src/redacted-lint.test.ts` plants each form and checks which ones fire.

Their count when they were added, on 2026-10-26:

- The first draft of `no-secret-env` fired 41 times on the whole tree. 12 were false alarms, and the rule was narrowed so they are left alone: a bare `KEY` or `REAL_KEY` that names a results or cache key (3), a name ending in `_HASH` (2), `delete process.env.X` (2), and a check that the value is set, as `!x` or `x === undefined` (5, two of them in the agents tutorial).
- What is left fires 29 times, and none is a false alarm. Outside `experiments/`, 5 were real plain-string reads: the Jev key in four of the old factory's scripts (`legacy/`) and the door's secret in `daemon.ts`. All 5 now read with `Config.Redacted`. In `experiments/`, left out, it would fire 24 times: 15 keys or tokens read into plain strings, 6 checks that a login is set written as `(x ?? "") !== ""` or `if (x)`, and 3 lists of values to scrub from output.
- `no-redacted-value` fired 8 times: 4 at the edges now listed (`http.ts`, `local.ts`, `worker-options.ts` twice), 3 in tests, 1 in `experiments/151`. The door, the Durable Object and `legacy/src/local.ts` were added to the list by this change, where tokens now leave their `Redacted`.
- After the change: 0 fires outside `experiments/`, and no `biome-ignore` was needed.
- The shared ledger (PR 130) landed beside this change and added 2 value fires. In `packages/ledger-server/src/stack.ts`, an empty-token check was not needed, because Effect's env provider already reads an empty value as none (`redacted.test.ts` checks this), so it was dropped. In `signer.ts`, an SSH key file's text goes to its parser, so that file joined the list. After that: 0 again.
- The sandbox (PR 156) and this rule (PR 132) landed on the same night and met only on main, with 4 value fires in `packages/fabrika/src/sandbox/sandbox.ts`. That file hands the box its logins, so it is not on the list: a new unwrap there must still be seen. Each of the 4 lines has its own `oxlint-disable-next-line fabrika/no-redacted-value` with its reason. Two send a lent login into the box (its env, its auth.json). Two read text that stays in the host, so a launch carrying a GitHub key can be refused.

`no-project-settings.grit` keeps a Claude run from loading a repository's own settings. Its hooks ran outside the sandbox in experiment 155, and the owner kept them out even where only trusted people work (`docs/direction/agents-read-rules-the-normal-way.md`). It refuses `settingSources` with a source in it, any `projectConfigRoot`, and the same CLI flags, anywhere but `packages/fabrika/src/agents/claude/rules.ts`, whose `ownRules` is the one place that says where a run's settings come from. `.oxlintrc.json` turns it off for that file and for tests. It blocks: of its 17 fires on the tree when it was added, 12 were on purpose and now say why in an `oxlint-disable-next-line fabrika/no-project-settings -- <why>`, 4 were tests (so tests are left out), and 1 was a real slip, in experiment 127. `rules.test.ts` plants each form it refuses and checks it fires.

The other is `no-bare-tell.grit`. A `tell` or `offer` to a program's input is an Effect, and written as a bare statement, or answered from a callback whose caller wants nothing back (`xs.forEach((x) => run.tell("n", x))`), it is made and dropped, so nothing is told.

`pnpm typecheck` catches every other dropped Effect statement through Effect's own `floatingEffect` check (`@effect/tsgo`, set up in `tsconfig.base.json`). That check does not look inside callbacks, so the callback shape stays this rule's job.

`plants.test.ts` plants one line per rule that no other test plants, and the built-in rules that must not be lost (unused imports and variables, non-null, ts-ignore), and sees each fire. It also runs `lint.ts`: a fire of an old advice rule in a folder at zero exits 1, and so does any other blocking fire. `advice.test.ts` runs `lint.ts` in a small repo of its own for the advice in a dirty folder and the stale warn line.

`builtin-plants.ts` holds a plant for each of oxlint's own rules that went on with 0 hits on 2026-11-09 (ticket 438): 124 rules from the eslint, oxc, unicorn, typescript, vitest, react, `import` and `promise` sets. With 0 hits a rule had shown nothing, so the plant is the only proof it works. Four quirks of oxlint 1.90.0 that the plants found: `no-implied-eval` reads `globalThis.setTimeout("...")` but not a bare `setTimeout("...")`; `no-non-null-asserted-nullish-coalescing` leaves a `declare const` alone; `promise/no-multiple-resolved` goes quiet when a second Promise follows in the file; and `require-awaited-expect-poll` and `import/no-commonjs` report one line twice. `react/preserve-manual-memoization` and `react/no-object-type-as-default-prop` stayed off: no plant made the first fire, and the second had 1 hit (`apps/fabrika/src/keys/window.tsx:98`). Two more stayed off after main moved on: `unicorn/prefer-type-error` had 12 hits once every `if` body got braces (it reads only a braced `throw`), and `eslint/no-unused-expressions` had 0 hits on the tree but refuses the bare `helper;` that `one-store-hook.test.ts` plants on purpose.

The same change turned on, as errors, Effect's 35 diagnostics that fired 0 times on the tree (28 suggestions and 7 that were off), plus `globalErrorInEffectCatch` and `globalErrorInEffectFailure` for `next/` files that are not tests, through the plugin's `overrides` in `tsconfig.base.json`. `effect-tsgo diagnostics --file` does not apply an override's `exclude`; `tsc` does, and `pnpm typecheck` is what blocks.

## The new version's exam rules

P16 adds `fabrika/program-package-layout` for `next/programs/` only. A package exports
its pure program at `.` and its real window at `./window`. A package awaiting a window needs
no stub. Worker entries and Worker runtime imports in the pure import graph fail, through
re-exports, helpers, cycles, literal dynamic imports, `require`, and `#` aliases in the package's
own `imports`. Type-only imports and re-exports pass, with either a declaration or a specifier
marked `type`, and so do `types` export conditions and declaration files. This follows
`docs/plan/tier-1-detail.md`, Packages, and the approved P16 plan. On 2026-11-10 it checked 3
files in the real program tree: 0 findings, 0 false alarms. The counter's pure entry links three
installed packages, which all resolve, so no link there went unresolved. Its 17 laws run the real
oxlint plugin over generated layouts at seed 119120; with the rule switched off, 15 fail (the 2
left are the accept law and the real-tree count). The rule blocks. What it cannot read it refuses
as "cannot judge", never passes: a dynamic import or `require` by a computed name, a file that
cannot be read or parsed, and a link that resolves to nothing. Two kinds of unresolved link stay
fine: a `node:` builtin, which no file stands for, and a bare package name the manifest lists in
`dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`, which is code
outside the package that may not be installed yet. A `#` alias that resolves to nothing is fine
only when every target its `imports` entry names is one of these two. A `#` alias is a Worker
runtime import when its `imports` entry names one under any condition, whatever the resolver
answers. It parses other files with `oxc-parser`, a dev dependency of this folder.

A Worker runtime import is one of the platform's names, the list
[0042](../.decisions/0042-platform-pieces-go-through-alchemy.md) gives (`cloudflare:*`, `miniflare`,
`workerd`, `wrangler`, `@cloudflare/*`), or Alchemy's local runtime
(`@alchemy.run/cloudflare-runtime`) or libfabrika's `box` and `workers` entries. The rule's
`platform` list cites 0042 and changes with it. A type-only import of any of them passes, so
`@cloudflare/workers-types` stays fine as types. A link is followed when it is relative or when it
resolves to a file that is not a dependency's, under `node_modules`: its own name, a `#` import or
an absolute path, in the package or out of it.

**Module resolution is a tool's, not ours** ([0040](../.decisions/0040-existing-tools-before-hand-written.md)).
The tools looked at:

- [`oxc-resolver`](https://github.com/oxc-project/oxc-resolver), 11.24.2, pinned in the catalog: the
  version the lockfile already held under Rolldown and oxlint. It implements
  [Node's ESM resolution](https://nodejs.org/api/esm.html#resolution-algorithm) with
  [enhanced-resolve](https://github.com/webpack/enhanced-resolve)'s options. **Used.**
- [`enhanced-resolve`](https://github.com/webpack/enhanced-resolve), webpack's resolver, which
  `oxc-resolver` ports: the same answers, and a new package that the lockfile does not hold.
- [`resolve.exports`](https://github.com/lukeed/resolve.exports): Node's `exports` lookup only, with
  no relative links, and also one answer for one set of conditions. Not in the lockfile either.
- [`typescript`](https://www.typescriptlang.org/docs/handbook/modules/reference.html)'s
  `resolveModuleName`: it always matches the `types` condition, so it finds declarations, not the
  file a runtime loads.

The rule resolves each relative link with `oxc-resolver`: TypeScript's bundler lookup, with the
extension added, a `.js` name standing for its `.ts` source and a folder's index. It resolves each
export target as a file path, as written, and it sends each pattern subpath back through the
package's own `exports`, by the package's name. So null targets and more specific keys apply as
Node applies them. Its conditions are `workerd`, `import` and `default`, plus each condition path
the package names. A package with no `name`, or a `name` that is not a string, cannot ask its own
`exports`, so the rule fails closed: every subpath a pattern matches counts as offered, and a
Worker behind it is refused. Any string name works, since 11.24.2 self-references by whatever the
manifest names.

What the resolver cannot do, with proof from 11.24.2 on a scratch package (2026-11-10):

- **It answers for one set of conditions, with the first match in key order.** For
  `"./ord": {"default": "./src/program.ts", "import": "./src/server.ts"}`, conditions `["import"]`
  give `src/program.ts`; `src/server.ts` never comes back. For
  `".": {"workerd": ["./src/server.ts"], "default": "./src/program.ts"}`, conditions `[]` give
  `src/program.ts`, and `["workerd", "import", "default"]` give `src/server.ts`. The rule judges
  every target a runtime condition names, so it lists the condition paths itself.
- **It resolves one subpath, and cannot list the subpaths a pattern offers.** `"./*": "./src/*.ts"`
  answers `@p16/x/server` with `src/server.ts`, but nothing asks it which subpaths exist. The rule
  lists the package files each target's `*` matches.
- **It names a `#` alias's module only in an error, and answers for one condition.** For
  `"imports": {"#cf": "cloudflare:workers"}`, `#cf` answers
  `{"error": "Cannot find module 'cloudflare:workers'"}`, with no field for the name. For
  `"#mix": {"default": "./src/program.ts", "workerd": "cloudflare:workers"}`, it answers
  `src/program.ts` (2026-11-10). So the rule reads the `imports` entry itself, every target under
  every condition and each pattern key, and judges each target by name.

The hand-written part, and the generated case that tests each edge in
`program-package-layout.test.ts`:

| Edge | Test |
|---|---|
| A string, an array or a conditions object as the whole `exports` value is `.` | "'.' written as the whole exports value", forms `string`, `array`, `conditions`, `array conditions` |
| Every runtime condition, custom ones included, nested, `types` never | "mixed export conditions", and entry `condition` |
| A target after `default` in the same object is still judged | "mixed export conditions" (`default` drawn before the planted condition) |
| Each element of a fallback array, on a key, in a condition, under `.` | entries `array key`, `array condition`, `array dot` |
| A window behind an array target is named at its key | entries `array key`, `array condition`, `array dot`, the moved window |
| A pattern's `*` matches one or more characters, folders included | entries `pattern`, `key pattern` (paths of two folders) |
| A pattern target without `*` maps every subpath to one file | entry `fixed pattern` |
| A pattern subpath a null target or a more specific key takes is not the pattern's | entry `null pattern` |
| Declaration files are never runtime code | "mixed export conditions", `.d.ts`, `.d.mts`, `.d.cts` |
| A package with no `name`, or a name that is not a string, keeps every subpath a pattern matches | manifests `no name`, `number name`, and the pinned nameless `"./*"` example |
| `./window` is judged for Worker code like every other subpath | entries `window`, `window tsx`, and the three pinned review 5 examples |
| Every `*` in a target is the same text | the plants' two-`*` target |
| A pattern target in build output, or under a symlinked folder, is listed | the plants' `dist/*.js` target and symlinked `src/lib` |
| A link by a non-relative name (its own name, a `#` import, an absolute path) is followed when it resolves to a file outside `node_modules` | the plants' `#server` import; link `absolute` and its pinned review 7 example |
| 0042's platform names are Worker runtime names, `@cloudflare/*` and `wrangler` included, even as declared dependencies | shapes 23 and 24 (`@cloudflare/containers`, `wrangler`), the drawn names of the runtime-import and dynamic-import plants, and the pinned review 7 `Container` example |
| A `#` alias whose `imports` entry names a Worker runtime anywhere (a string, an array, a condition after a file target, a pattern key) is a Worker runtime import | links `imports alias`, `imports array`, `imports condition`, `imports pattern`, and the pinned review 6 `#cf` example |
| A link that resolves to nothing is refused, save a `node:` builtin, a declared dependency, or a `#` alias whose every target is one | the plants' missing file, `#` with no entry, with a missing target or an undeclared target, undeclared package, own unexported subpath, `virtual:` scheme; the accept law's fine links |
| A literal link is a string or a template literal with no `${}`; `require` and `import x = require()` are links; any other name is refused, never skipped | the plants' template literal, `require`, `import =` and computed import |
| A file that cannot be read or parsed is refused, never read as empty | the plants' unparsable subpath and pure helper |
| Pure code that oxlint does not lint line by line (outside the package, by a symlink, under `fixtures/`) is reported for the package | links `symlink`, `outside`, `absolute` under `condition` and `array dot`, and their two pinned examples; `fixtures/` has no test, as the harness lints with `--no-ignore` |
| Package findings go on every file when the `.` entry is one oxlint skips (a test file is judged like any other) | the plants' `program.test.ts` and extensionless entries |
| A plain subpath must name a real file; an export key is `.` or starts with `./` | the plants' `src/server.ts`, missing target and `import` key |

fast-check 4.10.2 counts `examples` inside `numRuns`, so `withExamples` adds the generated runs on
top. Before 2026-11-10 the layout law ran its 7 examples and 1 generated input.

`one-id-module` keeps `next/`'s Id code in `libfabrika/src/id.ts`. It refuses the retired
`libfabrika/src/data/id.ts`, even empty or forwarding, so a second module cannot stay behind.
T518 A8's count on 2026-11-08 was one fire, the second module from P17a, with no false alarm.
Its property test generates file contents and checks nearby paths stay allowed.

### libfabrika's modules

Ticket 477, decision [0043](../.decisions/0043-rooms-on-floors.md), with the words of [0091](../.decisions/0091-modules-and-layers.md) (ticket 688): a folder of libfabrika is a module and its rank is a layer. One rule of ours and two of oxlint's own hold a module's shape in `next/packages/libfabrika/src`. `.oxlintrc.json` gives all three their paths and lists, and `modules.test.ts` plants each law at its real path with that config.

| Rule | Refuses | Lists, in `.oxlintrc.json` | Tests |
|---|---|---|---|
| `modules` | a module file that re-exports another module's names (`export ... from`, `export *`, or an imported name sent on); a file in a folder or at a top name `src/` does not list; an export in a module's `internal/` with no `/** @internal */` above it; a service or an error in a shared top file | `src`, `modules`, `folders`, `files`, `values` | on |

The other two laws are oxlint's own rules, since an existing rule comes before a hand-written one ([0040](../.decisions/0040-existing-tools-before-hand-written.md)). `eslint/no-restricted-imports` refuses an import or `export ... from` of another module's `internal/`, by one pattern group in an override for `src/**`; the override repeats the base rule's Radix entry, since an override replaces a rule's options. `unicorn/filename-case` holds a front file to PascalCase and an `internal/` file to camelCase, in two overrides.

Count on 2026-11-10, on main at `33a282f8` with this change, in that day's words (the rule was `rooms` until ticket 688): `rooms` 0, the `internal/` pattern 0, `filename-case` 0. Zero was expected and measures no false-alarm rate: no room has an `internal/` yet, and only `transport/` and `door/` exist. So the lists hold main's old names too (`data`, `coordination`, `app`, `id`, `testing`), and the two case overrides name only the six rooms with no file on main. Each old name leaves, and `transport` and `door` join the case overrides, in the pull request that moves its files. The top of `modules.ts` lists what the rule does not see: a package specifier, a name given a new binding before it is exported, and an error or service made by a helper under another name.

The old words do not come back as names in `next/`: oxlint's own `eslint/id-denylist` ([rule](https://oxc.rs/docs/guide/usage/linter/rules/eslint/id-denylist)), in a `next/**` override, refuses `room`, `rooms`, `floor` and `floors` in lower, title and upper case, and `otherRoom`, `floorsByName`, `floorRank`, `floored` and `unfloored`. Tests in `next/` are held too, and nothing outside `next/` is. It reads names only: a declaration, a reference to one, an object key and a type member. A property read (`row.floor`), a call through a member (`Math.floor`), a comment and a string pass, so the words' other meanings (a conversation room, a minimum, spare space) stay review work. A conversation room, which 0091 keeps, takes `// oxlint-disable-next-line eslint/id-denylist -- <why>` on its one line. `terminology.test.ts` plants each case at a real path with the repo's config. Count on 2026-11-11, on main at `0bb25969` after ticket 688's rename: 0 fires in `next/`, `.agents/` and `oxlint-plugins/`; the one fire before it, a local `room` meaning spare bytes in `transport/internal/connection.test.ts`, became `space`.

Nine rules apply to `next/` only, as Tier 1's exam (`docs/plan/tier-1-detail.md`, "The exam PR", items 1, 2, 4, 5 and 13, P35, and ticket 337). `.oxlintrc.json` turns them on in `next/**` and nowhere else, so today's code is untouched. Their planted tests use `next/apps/fabrika/src/exam/plant.ts` and lint each planted file at the `next/` path it names, in a temp folder with this repo's config, so the edge paths and globs meet it as they meet a real file.

| Rule | Refuses | Edges | Tests |
|---|---|---|---|
| `no-promises` | `async`, `await`, `for await`, `new Promise`, `Promise.x(...)`, `.then`, `import()`, `.catch` on anything not imported from Effect, and Effect 4.1.1's calls that take or make a Promise: `Effect.promise`, `Effect.tryPromise`, Schema's four `...Promise` calls, Stream's `fromAsyncIterable` and `toAsyncIterable` and its two variants, typed calls included | a line under an edge comment | left out |
| `no-effect-run-outside-edge` | any of Effect's twelve run functions, on `Effect` or a runtime, and `runtimePromise` and `makeRuntimePromise`; `NodeRuntime.runMain` passes | a line under an edge comment | left out |
| `edge-comment` | an ignore comment naming either rule above that is not `// oxlint-disable-next-line <rule> -- edge: <why>`: another form, another rule named beside them, or no `edge: ` reason | none | on |
| `no-of` | a declared name `of` or ending in `Of`, a named import of `of`; a module's top-level exported `of` and a use pass (0029) | none | on |
| `no-question-word-key` | a quoted, escaped, computed or template key named `where`, `why`, `what`, `who` or `how` in an object, class or type declaration; oxlint's own `eslint/id-denylist` holds the same names written as identifiers (0081) | none | on |
| `no-hand-tag` | an object key, class field or type member named `_tag`; a read passes | the log, `next/packages/libfabrika/src/data/log.ts` | left out |
| `one-store-hook` | `useSyncExternalStore` imported or read as a plain member anywhere in `next/`; a store hook's value dropped | none | left out |
| `no-wall-clock` | `Date.now()`, `new Date()` and `Date()` in a `next/` `.ts` file; `new Date(at)` passes | none | left out, test helpers too |
| `no-clock-in-view` | `Date.now()`, `new Date()`, `Date()`, `performance.now()`, `Math.random()`, `crypto.randomUUID()` in a `.tsx` file, handlers included | none | left out |

React's own `react/refs`, `react/immutability`, `react/display-name` and `react/purity` block in `next/**/*.tsx`, tests left out (`docs/direction/react-compiler.md`). `react/purity` refuses a clock or random read in render and lets a handler pass, as React means it; `no-clock-in-view` refuses the same reads anywhere in a `next/` `.tsx` file, handlers included, since the time comes through a Cmd (C1; owner, 2026-11-05). oxc-transform-react 0.157.0 stopped refusing a clock read in a handler a view passes down, which 0.156.0 did, so this rule holds that case now. `pnpm lint:compiler` runs the Compiler's compile step, `next/apps/fabrika/src/exam/compiler.ts`, over every `.tsx` file in `next/`, against `compiler-ledger.json`, which starts empty.

**`.agents/` is held to the same rules** (owner, 2026-11-09; [0033](../.decisions/0033-agents-code-follows-next-rules.md)). A second override names `.agents/**/*.ts` and `.agents/**/*.mjs` and repeats the `next/**` rule block, and `edge-comment.test.ts` checks the two blocks are equal. `.agents/` tests keep the edge rules on, since only `next/`'s tests may turn one off; their own override leaves out `effect-functions`, `no-hand-tag` and `one-store-hook`. `no-node-imports`, `no-node-filesystem` and `no-ledger-sql` check their path with `heldToNext` in `match.ts`. On the day it joined, 154 findings fired in 9 files: `no-promises` 51 (42 of them in two tests that drive real processes, `box.test.ts` 15 and `run.test.ts` 27), `no-hand-tag` 48, `no-node-imports` 23, `no-of` 21, `no-node-filesystem` 9, `no-effect-run-outside-edge` 2. Each is named in `agents-ledger.json` by file, rule and its line of code with spaces collapsed (`ledger.ts`), never a line number. `lint.ts` waives a finding only an entry names, refuses an entry outside `.agents/`, and on a whole-repo run writes back only the entries a finding still matched; CI fails until that pruned file is committed. Nothing adds an entry; that is the owner's call. `ledger.test.ts` holds the laws and plants a `.agents/` script.

**Edges are comments, not files** (owner, 2026-11-05; Tier 1, P35). The one line a platform demands, such as a Durable Object method that must answer a Promise, passes either rule only under `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, or the same for `fabrika/no-effect-run-outside-edge`, or one comment naming both. Until P35 the run rule held a list of 18 whole paths, which let a whole file wrap Promises; the list is gone. `edge-comment` keeps every such comment to one shape, reported at the top of the file as `no-bare-disable` is, so a comment cannot silence it. An edge comment over a line where nothing fires fails through `reportUnusedDisableDirectives`. CI's `edges` step (`next/apps/fabrika/src/exam/edges.ts`) lists each edge comment a pull request adds, with its reason, in the step summary and as a note on the diff, for the owner to read; it never blocks. Its industry match is clippy's `undocumented_unsafe_blocks`, with `edge:` for `SAFETY:`, and eslint-comments' `require-description` and `no-restricted-disable`.

The oxlint rules see syntax. A `.catch` is told apart by the name it is called on,
and `Effect.promise` and the run functions by their written names. P12 adds the typed
check below for Promises passed through helpers. `no-hand-tag` misses `x._tag = "a"`,
which the plan does not name. Report any miss.

### The docs rule, E6

Ticket 913, slice B2.1 of [Plan B](../docs/plan/effect-rules-big.md#b2-the-docs-rule), for `next/`: `fabrika/jsdocs` asks every public export of a `next/` library for a doc block in Effect's shape, and its file for a module block (E6, [0023](../.decisions/0023-next-follows-effects-code-style.md), [0120](../.decisions/0120-effect-code-guidelines.md)). `jsdocs.ts` finds the exports and their blocks through oxlint's syntax tree. Whether a block is right is Effect's own grammar: `effect-jsdocs.ts` is lines 973 to 1608 of `packages/tools/jsdocs/src/Jsdocs.ts` in [Effect-TS/effect at `effect@4.1.2`](https://github.com/Effect-TS/effect/blob/effect%404.1.2/packages/tools/jsdocs/src/Jsdocs.ts), with what those lines call, copied with Effect's MIT notice; its head lists every line taken and every change. On an Effect bump, diff those lines again.

| Rule | Asks | Edges | Tests |
|---|---|---|---|
| `jsdocs` | a block on `export const`, `let`, `function` (first overload), `class`, `interface`, `type`, `declare namespace` and each export in it, `export * as`, and each name of `export { a }`, with one description paragraph, Effect's sections, `**Example** (Title)` examples, and `@deprecated`, `@see`, `@stability`, `@category` in that order (`@stability` and `@category` required); tags alone on a re-export; a module block with `@stability` and no `@category` in a file with a checked export; a member's block, when there is one | `@internal` takes an export out; a type directly under its same-name schema shares its block (the owner, 2026-11-13: a kept difference in 0023); `since` is `absent` until libfabrika's first release (0118) | left out |

Which tools were looked at, and why none could hold the shape here, is the draft plan's table (`docs/plan/ticket-900-docs-lint.md` on the branch of [pull request 1131](https://github.com/kamp-us/tea-fabrika/pull/1131)): Effect's checker (private, needs TypeScript's JS API below 7, asks `@since`), oxlint's `jsdoc` rules (no rule that asks for a block), `eslint-plugin-jsdoc` (2,770 false alarms on Effect's own source), and TypeDoc and API Extractor (a block's presence only).

**On for the folders at zero, off for what is not public.** One `.oxlintrc.json` block turns it on at `error` for `ci/` and `codehost/` of libfabrika; each fill adds its folder in its own pull request, and the list ends as `next/packages/*/src/**` once the barrels become namespace re-exports (B2.8). A second block turns it off for `internal/`, tests, test support, shared suites (`*Test.ts`), fixtures and declaration files. A folder not yet listed has no ignore: the rule has not reached it ([0168](../.decisions/0168-old-lint-breaks-are-fixed.md)).

Count on 2026-11-14, on main at `c0aaf4a24`: `ci` 9 of 9 exports pass and `codehost` 12 of 12, with both module blocks, so 0 fires, as the draft's prototype found. With every block stripped from the two files, it fired 23 times: the 21 exports and the 2 files. On Effect 4.1.2's own source, 432 files outside `internal/`, with `since` set to `required`, it fires 10 times: the 6 exports of `StandardSchema.ts`, the one file Effect's config leaves out, and the 4 files whose only block above their first statement is that statement's own, as Effect's checker reads it (`encoding/Ini.ts`, `encoding/Yaml.ts`, `http/HttpStatus.ts`, `index.ts`). So 0 false alarms against Effect's own verdict.

Not yet on, for the fills to count against: all 136 public files of libfabrika fire 666 times, 346 exports with no block, 232 with a block out of shape (most lack `@stability` and `@category`) and 88 files with no module block or a wrong one.

| Module | Files | No block | Out of shape | Module block | Module | Files | No block | Out of shape | Module block |
|---|---|---|---|---|---|---|---|---|---|
| top files | 7 | 69 | 13 | 7 | `node` | 15 | 17 | 16 | 15 |
| `access` | 7 | 18 | 21 | 7 | `packs` | 4 | 11 | 2 | 4 |
| `ci` | 1 | 0 | 0 | 0 | `presence` | 1 | 1 | 0 | 1 |
| `cloudflare` | 16 | 65 | 11 | 15 | `processes` | 11 | 6 | 34 | 0 |
| `codehost` | 1 | 0 | 0 | 0 | `repositories` | 1 | 10 | 2 | 1 |
| `coordination` | 1 | 72 | 0 | 1 | `runtime` | 31 | 3 | 60 | 0 |
| `gateway` | 5 | 4 | 0 | 3 | `schedules` | 1 | 3 | 1 | 1 |
| `jobs` | 3 | 3 | 11 | 3 | `settings` | 11 | 26 | 23 | 10 |
| `ledger` | 9 | 8 | 16 | 9 | `telemetry` | 5 | 11 | 19 | 5 |
| | | | | | `transport` | 6 | 19 | 3 | 6 |

`jsdocs.test.ts` holds laws 3 to 9 of the draft: generated files through RuleTester at seed 119120 for which exports fire, the tag order, the module block, `@internal` and tags alone, and the `since` option; the real oxlint over Effect's source; and one planted file per left-out kind at its real path with this config. A `fixtures/` folder is also in the top `ignorePatterns`, which oxlint obeys even with `--no-ignore`, so no planted file there is linted. What the rule cannot see: whether a description is true, whether a `@see {@link x}` names a real thing, whether an example compiles, and a name sent on under a new binding.

### Ticket 682: question words are never names

A question word names the question, not the answer, so `where`, `why`, `what`, `who` and `how`
are never a key, field, option, parameter or binding in `next/` or `.agents/`, tests included
([0081](../.decisions/0081-no-question-word-names.md)). Two rules hold it, with the same five
words in both governed override blocks of `.oxlintrc.json`, and neither offers an autofix, since
a rule cannot pick the noun for a value and one renamed declaration alone can break its readers.

- **oxlint's own `eslint/id-denylist`** (0040) holds every name written as an identifier, escaped
  identifiers decoded: variables, parameters, rest parameters, defaults, catch and loop bindings,
  destructured bindings, tuple labels, object keys and shorthand, methods and accessors, class
  fields, methods and accessors (static, abstract and accessor ones too), constructor parameters
  with or without modifiers, type and interface members (optional and readonly ones too), Schema
  field maps and a member assignment such as `row.why = x`. It also reports a read of such a
  binding. Its diagnostic is oxlint's own, `Identifier 'why' is restricted.`
- **`no-question-word-key`** holds what the native rule does not decode: a quoted or escaped
  string key, a computed string key and an expression-free template key, in the same object,
  class and type declarations. Its diagnostic asks for the noun of the value and names all five
  words. It no longer checks identifier keys or constructor parameter properties, since the
  native rule reports those; the generated matrix checks that each line is reported by exactly
  one of the two.

What passes: reads such as `a.why` and `a["why"]`, `"why" in a`, an outside key destructured
into a good local (`const { why: reason } = row`), an import renamed on the way in, dynamic and
interpolated keys, string values, comments, SQL text, and exact-name neighbors such as `Who`,
`WHY`, `whyNot` and `whereé`. Neither rule sees an index-signature parameter
(`[who: string]: T`), a computed member assignment (`a["why"] = x`) or a key built at run time,
and neither reads shell or Python. Today's paths keep their words. An outside format keeps its
key at the edge, under an `oxlint-disable-next-line <rule> -- <why>` or an existing
`agents-ledger.json` entry.

`no-question-word-key.test.ts` generates, with seed 119120 and 12 runs per property: every
declaration and binding form for all five words in every run, in every spelling, with a
generated Unicode key, identifier and near neighbor beside them; the real config at generated
`next/`, exam, test, test-support and skill paths, and today's paths off; and generated values,
dynamic keys, outside reads, comments, SQL and neighbors that must pass. Two `format:` checks pin
the decoded spellings and the diagnostic with no fix. Plants, each run once on 2026-11-11 and
undone: dropping `how` from the config's list failed the matrix and path laws; skipping literal
keys failed the matrix, path and both format laws; matching substrings failed the matrix and the
passing law; turning both rules off for `next/**/*.test.ts` failed the path law; and a partial
autofix failed all four laws that read the rule's report.

The tests step's scan on 2026-11-11, at base `14513706e` with the tests changes, ran the real
config over `next/`, `.agents/` and `oxlint-plugins/`. Before the test renames both rules
reported 446 diagnostics, all from `eslint/id-denylist`; `no-question-word-key` reported 0, since
no literal-spelled question-word key exists on the tree. After them, 93 remain in 20 files: 89 in
the 18 product files the ticket's plan gives to the builder, and 4 in tests (`drive.test.ts:207`,
`box.test.ts:250,1534,1551`) that read today's outside formats and are named in
`agents-ledger.json` under the old rule's ID, which the build translates. Product still uses the old names, so this is deliberately red.

Ticket 337's earlier rule, `no-why-key`, checked `why` alone; its scans on 2026-11-09 found 294
diagnostics in 44 build-owned files before its build and 0 after, all read by hand.

### Ticket 681: instance, not stage, in next/

`no-stage-word` holds decision [0080](../.decisions/0080-a-running-copy-is-an-instance.md): in
`next/`, a running copy of fabrika is an instance. It reads identifiers, decoded string literals,
template text, JSX text, comments and the file's path below `next/`. A word is a run of letters
split at case changes, so `localStage`, `StageError`, `STAGE`, `P34_STAGE_DRIVER`, `stage-wire`
and a `stages/` folder fire, and `backstage`, `stagecoach`, `instance` and `startDev` pass.
Oxlint's own `id-denylist`, `no-restricted-properties` and `no-restricted-imports` each see one
of identifiers, properties or imports, never comments, paths and text together, so this is our
own rule (0040). It has its own `next/**` block in `.oxlintrc.json`, so the two equal rule blocks
for `next/` and `.agents/` stay equal; `.agents/` and today's version keep their pipeline stages.

An exception is one line under `// oxlint-disable-next-line fabrika/no-stage-word -- <why>`.
Template text and comments report on each line that holds the word, so one comment allows one
line. Of an ignore comment, only the reason after `--` is read: the rule name in it never fires,
and the reason is written without the word, since its own line is not the one it allows. A path
reports at the file's start, where no comment silences it. There is no autofix, since the rule
cannot choose `dev` or `instance`, or move a saved name.

What stays, each under its own exception: Alchemy's own `stage` key in `src/brain.ts`, the app's
deploy call and `sibling.laws.test.ts`, and experiment 238's saved driver name in
`instance-one-file.test.ts`. The one quote of today's app, "capture stages" in the pinned bytes
of `exam-paths.json`, sits inside one inline snapshot, a single template where no comment fits
beside the line. So `commits.test.ts` brackets that one `expect` with `oxlint-disable` and
`oxlint-enable` for this rule alone; the other lines of that snapshot are held by the snapshot
itself, which must equal `exam-paths.json` byte for byte.

What it cannot see: JSON and Markdown, such as `package.json`'s export keys, which the review's
`rg -i stage next/` audit reads; a word built at run time; and a regular expression's pattern.

`no-stage-word.test.ts` runs the real config over generated names (word parts, case, eight
spellings, up to twelve placements in `.ts` and `.tsx`), with seed 681080 and 12 runs per property. Every
run holds a retired spelling and its neighbors in the same places, including a fused lowercase
word around the letters. Further properties place an annotated exception at generated offsets
beside unannotated uses, and check generated `next/` paths against today's paths, `.agents/`
and top-level scripts, and `oxlint-plugins/` among absolute, relative and Windows spellings
of one path. Fixed cases pin escapes, each comment and text form, the Alchemy key, the two kept literals, directives and
empty files named for the word. Nine plants each turned at least one law red: lowercase
identifiers only, any property named stage allowed, a whole file excluded, a directive read
whole or skipped whole, no path check, raw spelling only, no Windows separators, and no split
at case changes.

The scan on 2026-11-11, main at `0bb25969`, through the real config over all 244 files oxlint
reads in `next/`: 302 fires in 33 files before the rename. `rg -n -i stage next/` finds 34 files.
Every line it finds in a linted file fired, and all eight files whose own path holds the word
fired by path; the 34th file is `package.json`, outside the rule. None was false. After the tests
step, the exam files show 0 fires; 37 remain in the 9 build-owned files the plan lists. Two of
those are Alchemy keys that keep their word under an exception; the other 35 are renames.

### P12 checks in lint

`no-node-filesystem` refuses `fs`, `fs/promises` and `path`, with or without `node:`,
in `next/` product files. It covers imports, re-exports, dynamic imports, `require`
and TypeScript import assignments. Tests, test support files, declarations, the
exam and browser test drivers are left out. Its generated plants use the real
config at these paths. The P12 review-6 sweep found one filesystem import in
`node/dev/dev-recording.ts`, plus six path imports: that file, `node/build.ts`,
and the app's `build.ts`, `dev.ts`, `src/local-instance.ts` and `src/instance.ts`.
These are seven findings in six files, all read by hand, with no false alarm.
All can use Effect's existing FileSystem or Path service. This rule deliberately
stays red until the builder removes those imports.

`pnpm lint:twin` runs `next/apps/fabrika/src/exam/twin.ts` on the real Alchemy stack.
It reads the installed providers, prints the finding count and exits nonzero for any
finding. Its generated plants stay in `twin.test.ts`, with seed 119120.

`pnpm lint:promise-types` adds types to `no-promises`. TypeScript 7.0.2's installed
sync API resolves every `next/` project. Calls, returns and function parameters may
not carry a Promise or a function returning one outside a marked edge line. Type
declarations, tests, test support files and today's code are left alone. The scanner does not emit code
or run type diagnostics. `no-promises.test.ts` plants imported aliases, inferred
returns, generic thunks, object methods and line-local edge comments. An edge comment
covers only the next physical line. History: the initial P12 head scan at `4577f6b0`
found 103 lines. It recorded false alarms inside wrapped statements whose first line
had an edge marker. A statement-wide exception left 60 real findings in P12's files
and 27 in unchanged files from main. P12's new files then reached zero. See
`field/notes.jsonl`, note `2026-11-08-275`. The statement-wide exception was dropped
because it walked back [no-promises.md](../docs/direction/no-promises.md). The build
restructured the code to keep each Promise on its marked line. `pnpm lint:promise-types`
reports 0 findings on the P12 tree at `97245dc7` with the narrowed rule below, with 0
false alarms. The check runs in `pnpm lint`. Unknown types still need the regular typecheck.

An untyped or `never` call needs an edge marker only inside an input to Effect's own
`tryPromise` or `promise`. The checker follows the declaration's symbol, including imported
aliases, parentheses, non-null assertions, `satisfies`, `as`, const aliases and their chains,
destructuring and renamed bindings. Computed keys work when the checker resolves every
possible key to one of those two declarations. A key that may select another function, or
whose type cannot be resolved, supplies no evidence of a Promise bridge. The RPC property
generates all 17 supported spellings for both bridges. Pinned laws keep two known gaps:
a key that may select `sync`, and a bare RPC call whose Workers type is `never`.

Replaying `97245dc7`'s broad rule on this tree still gives 75 findings: 9 real and 66 false
alarms, or 88%. Those 66 synchronous calls are outside Effect bridges. The narrowed rule
reports none of them. These nine real cases also sit outside bridges, so they remain for
the build step rather than making every unknown return a finding:

| File | Lines | Real or false | Why |
|---|---|---|---|
| `next/packages/libfabrika/src/app/program.ts` | 411 | real | A Standard Schema validator can create a Promise behind its `unknown` return type. |
| `next/packages/libfabrika/src/node/dev/dev.ts` | 349, 352, 353, 354, 359, 360, 362, 367 | real | `Reflect.get` erases the proxy's returned Promise thunks to `any`. |

`no-ledger-sql` refuses SQL strings naming the ledger's `entries` or `rings` outside
its three service files in `next/`. Tests, test support files and today's code are left alone. Its
generated plants cover reads, joins, writes, quoted names, SQL comments, templates
and allowed tables. The bootstrap read in `workers/runtime.ts` now uses `Ledger.read`;
P12's product files have zero findings. The first scan
also found a test helper reading rows for assertions. Leaving test support files
out removes that false alarm. This check
recognizes SQL text; it cannot resolve a table name assembled at runtime.

Their count on PR 223's tree at `7c1d073` (33 files), each fire read by hand, on 2026-11-05:

- `no-promises`: 225 fires on 195 lines, none false. 63 fires on 57 lines are the slice's own Promise plumbing (`app/process.ts` 26, `brain.ts` 13, `build.ts` 9, `data/project.ts` 4, `transport/gateway.ts` 4, `app/entry.ts` 2, `coordination/process-manager.ts` 2, `window/main.tsx`, `brain-host.ts` and `dev.ts` 1 each). The other 162 are in `e2e.ts`, the slice's Playwright script: true by the rule's words, and test code by role. The plan's thin runner moves those laws into `e2e/*.test.ts`, which the rule leaves out.
- `no-effect-run-outside-edge`: 3, none false, all in `window/main.tsx` (two `Effect.runPromise` in the `useRuntime` handle, one `Effect.runFork`). They move to the hook's edge file with T5. Placed at the plan's package paths, no slice file lands on an edge, so the count is the same.
- `no-of`: 1, none false: `sizeOf` in `desktop/fold.ts:63`.
- `react/purity`: 1, `window/main.tsx:146`, a clock read in a helper made in render that only a click handler calls. False by React's own reading (experiment 194 found the same), true by C1.
- `no-clock-in-view`: 2, none false by its words: `window/main.tsx:146` (the same read) and `main.tsx:19`, a module-level `crypto.randomUUID()` naming the tab. That one is not in a view function, only in a view file; whether a read at a view file's top level should pass is a later call.
- `no-hand-tag`, `one-store-hook`, `react/refs`, `react/immutability`, `react/display-name`: 0. The slice holds no `_tag` and no store hook, so for those two a zero measures nothing.
- `lint:compiler`: 0 findings on the slice's two `.tsx` files.

## Function tracing, T285 PR 1

`effect-functions` applies to product code in `next/`. A named function returning
an Effect with a whole-function `Effect.withSpan` chain uses named `Effect.fn`.
The rule also sees returned recovery and flush chains, direct `Effect.withSpan`,
curried wrappers, and aliased Effect imports. It leaves inner spans and
`Stream.withSpan` alone. Stream spans measure consumption.

Round 1 measured base `600c6449`, 2026-11-08, with
`node oxlint-plugins/lint.ts next`. Each finding was read against
[`the tracing decision`](../docs/direction/effect-fn-for-traced-functions.md).
Paths below start at `next/packages/libfabrika/src/`.

| Finding | Verdict |
|---|---|
| `data/ledger-store.ts:261`, `ring`, `ledger.ring` | Real. Fixed in round 1. Recovery stays outside the failed span. |
| `data/ledger-store.ts:312`, `append`, `ledger.append` | Real. Fixed in round 1. Validation refusals stay inside the span. |
| `data/ledger-store.ts:340`, `read`, `ledger.read` | Real. Fixed in round 1. One span per answered page. |
| `data/ledger-store.ts:370`, `wait`, `ledger.wait` | Real. Fixed in round 1. Ready and parked answers stay inside the span. |
| `app/runner.ts:436`, `cmdSpan`, `runner.cmd` | Real. Fixed in round 1. Handler recovery stays outside the failed span. |
| `app/runner.ts:470`, `commit`, `runner.write` | Real. Fixed in round 1. The signer's link and scope stay the same. |
| `app/runner.ts:592`, `call`, public runner spans | Real. Fixed in round 1. The span ends before flushing. |
| `data/ledger.ts:94`, `call`, `ledger.call` | Real. Still open in round 2. Use named `Effect.fn` and set argument attributes inside it. Forwarding methods need no second span. |
| `data/sink.test.ts:94`, `traced`, arbitrary span input | False alarm in the first scan. This helper manufactures test input, rather than tracing a product operation. Tests are now outside this rule. |

The first scan included tests: 9 findings, 8 real and 1 false alarm. The final
config leaves tests out, as the other Effect exam rules do. A second scan of all
`next/` had **8 findings, 8 real, 0 false alarms**.

Round 2 scanned all of `next/` again on base `c20a363c`, 2026-11-08, with the
same command after the door fixes landed. It has **1 finding, 1 real, 0 false
alarms**, at `next/packages/libfabrika/src/data/ledger.ts:94:5`. The five partial
door spans are accepted. Their scope stays covered by generated keep-laws in
`next/apps/fabrika/src/door-spans.test.ts`. Remote forwarding, argument tags,
pages and failed exits are covered by generated keep-laws in
`next/packages/libfabrika/src/data/ledger-call-spans.test.ts`.
The rule stays an **error**. The remaining finding is PR 1's red. It needs no
advice exception in the lint runner. The seven advice diagnostics in this scan
are from the existing advice rules.

The planted exam is `next/apps/fabrika/src/exam/effect-functions.test.ts`.
Nine rejected fixture sites are real violations. Seven allowed forms cover
inner spans, consumed streams, named functions, untraced helpers, forwarding
and one-use callbacks. Other fixtures check aliases, today's code and test span
makers. A rule that rejects every `withSpan` fails these plants.

This rule checks syntax, without types. It follows only the returned chain in an
expression body or a block containing one return. It does not inspect Effect
values such as `members` or `info`, infer indirect wrappers, or enforce every
helper's use of `fnUntraced`. Behavior properties in
`next/packages/libfabrika/src/app/effect-functions.test.ts` keep the names,
attributes, parents, failed exits, signer links and flush order. The sample is
one tree; zero false alarms here does not prove every future shape.

`effectFnOpportunity` remains off. Its earlier 11 false alarms among 17 findings
are not evidence for enabling it.

## Rules that joined with findings: `next-ledger.json`

Four laws joined `next/` on 2026-11-11 with findings already in the tree. Each blocks every new
finding. What each met on its first day is named in `next-ledger.json`, in `agents-ledger.json`'s
shape and under its laws (`ledger.ts`, `ledger.test.ts`): keyed by file, rule and line of code, read
only for `next/`, and written back by a whole-repo `pnpm lint` with the entries a finding still
matched, so it only shrinks. CI fails until that pruned file is committed. An entry leaves when its
line is fixed under its own ticket; nothing adds one but the owner. Advice was not used: it is this
repo's level for a rule that is often wrong (experiment 125), and these were never wrong in the read.

| Law | Rule | Files | Found | Read by hand |
|---|---|---|---|---|
| A question word is never a name (0081) | oxlint's `eslint/id-denylist` with the five words, and `no-question-word-key` | the `next/**` and `.agents/` blocks, tests too | 451: `next/packages/libfabrika` 159, `next/apps/fabrika` 168, `.agents` 124; `no-question-word-key` 0 | 30 at seed 119120: 30 real |
| `runtime/`, `access/` and `gateway/` never import `ledger/` (0043, rule 11; 0062) | oxlint's `eslint/no-restricted-imports`, one more pattern group | an override for the three modules | 69, all in `next/packages/libfabrika`: 16 product, 53 test | 30 at seed 119120: 30 real |
| A clock is read through Effect | `no-wall-clock` | `next/**/*.ts`, tests and test helpers left out | 8: `next/packages/libfabrika` 7, `next/apps/fabrika` 1 | all 8: 8 real |
| An after-hook does not release a resource (0061) | oxlint's `vitest/no-hooks`, allowing `beforeAll` and `beforeEach` | any `next/` file | 44: `next/packages/libfabrika` 27, `next/apps/fabrika` 16, `next/programs/counter` 1 | all 44: each closes a database, a socket, a browser or a child, or removes a folder |

The `.agents/` findings went into `agents-ledger.json`. The two edge comments in `flow/host.ts`
stay as comments, naming `eslint/id-denylist` as ticket 682 left them.

After the merge with main at `31810c83c` on 2026-11-11, where ticket 682 renamed the question
words, lint pruned what main fixed. `next-ledger.json` holds 115 entries: `id-denylist` 0,
`no-restricted-imports` 71, `no-wall-clock` 1 (`next/apps/fabrika`) and `no-hooks` 43.
`agents-ledger.json` holds main's 12 `id-denylist` entries and none from this rule set. The one
clock read whose line the rename changed, `cloudflare/connection.ts`'s `p.join`, now reads
`Clock.currentTimeMillis`.

The counts are of the tree merged with main at `1d2b3a5c` on 2026-11-11, after the noun sweep (ticket
682), the module rename (ticket 688) and the `stage` to `instance` rename. The first count, on the
older main, was 428, 57, 8 and 44: that lint run pruned 22 entries whose line was gone or renamed,
and 57 findings on main that the first count never saw were added the day the rules joined (29 and 7
`id-denylist` in `next/` and `.agents/`, 17 `no-restricted-imports`, 4 `no-hooks`). The hand reads
below were of the first count's findings.

**Why oxlint's rules, and where ours stay** ([0040](../.decisions/0040-existing-tools-before-hand-written.md)):

- [`eslint/id-denylist`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/id-denylist), as 0081
  asked. On oxlint 1.90.0 it reports a name written as a word wherever it is declared or read:
  object, class and type members, accessors, parameters, parameter properties, locals and their
  reads. It does not report a member read (`a.why`), a renamed destructure (`{why: r}`) or an
  import's outside name. It cannot see a key written as a string: `{"why": 1}`, `["how"]`,
  `` [`what`] ``. `no-question-word-key` holds those alone, so no key is reported twice.
- [`eslint/no-restricted-imports`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports).
  The group names `ledger/`'s PascalCase front files (`../ledger/[A-Z]*`), so a `ledger/internal/`
  import is the `internal/` group's alone. A `!` pattern cannot carve that out: oxlint 1.90.0 reads
  a `!` in one group as a pass for every group, which the modules test caught. It does not see a
  package specifier.
- [`eslint/no-restricted-properties`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-properties)
  sees `Date.now` but not `new Date()`, and
  [`eslint/no-restricted-globals`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-globals)
  refuses every `Date`, `Date.parse` and `new Date(at)` too. oxlint has no `no-restricted-syntax`.
  So `no-wall-clock` is `no-clock-in-view`'s rule with `Date.now` alone (`clockReads` in
  `no-clock-in-view.ts`). Three `new Date(at)` calls in product code format a time they were
  given and pass, as in `no-clock-in-view`.
- [`vitest/no-hooks`](https://oxc.rs/docs/guide/usage/linter/rules/vitest/no-hooks) refuses the
  call. An after-hook imported and never called is an unused import, which
  `eslint/no-unused-vars` refuses. `onTestFinished` is not refused.

The laws are in `no-question-word-key.test.ts`, the last describe of `modules.test.ts`,
`no-wall-clock.test.ts` and `after-hooks.test.ts`, each through the real config at generated paths.


## One machine per file, decision 0046

`fabrika/one-machine-per-file` blocks in `next/` and `.agents/`. Tests and shared law suites
are left out by `*.test.ts`, `*.test.tsx`, `*Test.ts` and `*.test-support.ts` under `next/`,
and `*.test.ts` under `.agents/`.

It counts exported tea `Machine.make` calls, including one inside an exported factory, object or
program. A second call fires. A private top-level helper used inside another machine's arguments
passes; a private machine wrapped by an exported program counts. Two calls in one exported factory
count twice. Named and namespace imports from `@demlik/tea` and `@demlik/tea/effect`, renamed
imports and literal `["make"]` access are recognized. Local shadows and type-only imports pass.

For each reached call, an imported value or imported member used directly as `model`, `msg` or
`update` fires. A local value, inline expression or schema built from imported fields passes.
Effect's `Schema.Never` as `msg` passes too: it says the machine has no messages, as approved
in plan amendment A1. Other imported Schema members still fire, and `Schema.Never` used as
`model` or `update` still fires.
Every file with a machine call, even a private call, also refuses imports from the closed I/O
list in the rule. That list covers the named Effect runtime, clock, storage and stream modules,
Effect's process/http/cli/unstable subpaths, `@effect/*`, `node:`, tea runners, and the platform
imports named in 0042. Pure `effect/encoding` and `effect/crypto` imports pass. Type-only imports
pass, both whole declarations and individual specifiers.

The approved plan measured 13 files with exported machines or factories and expected zero hits.
The first replay on 2026-11-11 found one false alarm, `msg: Schema.Never` in lead tooling's
`flow/machine.ts:101`. Amendment A1 allows that exact case. The corrected replay finds **0 hits**
over `next/` and `.agents/`, and all 13 measured file copies pass. Each copy with a second
exported call fires once for that added call. No disable or ledger entry hides a hit. This
zero-hit measurement says nothing about the false-alarm rate of forms not yet written.

Review keeps these parts of 0046:

- Whether changing data is control state and must be a tea machine.
- Input or output through relative/workspace imports, globals or dynamic imports.
- Building or editing another file's Model by hand.
- Whether a factory returns its machine and whether its config carries a service.

The syntax rule misses aliases of `Machine.make`, destructuring, re-exports and imported helpers
that make machines. Each new written form needs review. It has no type information.

### Plant replay, 2026-11-11

Ticket 509 replayed these temporary breaks against the existing laws. Each change was restored
by copying its saved original before the next run. No planted implementation remains.
Paths below are relative to `oxlint-plugins/`, except `.oxlintrc.json`.

| Law and check | Injected break | Observed result |
|---|---|---|
| L1, `one-machine-per-file.test.ts:59` and `:80` | In `one-machine-per-file.ts:192`, count private calls too; separately, at `:194`, count only one call per export | Both L1 properties fail for each break. The reduced cases contain a private helper, or a factory with two calls. |
| L2, `one-machine-per-file.test.ts:112` | At `one-machine-per-file.ts:223`, accept imported models; separately, reject calls that build a schema from imported fields | L2 fails on an imported model, then on `Schema.Struct({ f: Imported })`. |
| L3, `one-machine-per-file.test.ts:206` | At `one-machine-per-file.ts:234`, require an exported call before checking imports; separately, at `:239`, check type-only declarations too | L3 fails on a private machine with a `workerd` import, then on a type-only import. |
| L4, `one-machine-per-file.test.ts:247` | Remove `next/**/*Test.ts` from `.oxlintrc.json`'s shared-test override | L4 gets line 3 for `next/ExampleTest.ts`, where it expects no fire. |
| L5, `one-machine-per-file.test.ts:290` | At `one-machine-per-file.ts:102`, skip `.agents/`; separately, at `:141`, ignore exports whose declaration is a factory | L5 misses the added second export in the flow machine, then in `processTable.ts`. |
| L6, `plants.test.ts:628` | Add this rule to `lint.ts:14`'s `ADVICE` set | L6 gets exit 0 instead of exit 1 for its second-machine input. |
| L7, registration lint | Remove the import and registration from `index.ts:35` and `:78` | `lint.ts` exits 2 because the configured rule is missing. `pnpm lint:dead` stays green, contrary to the plan's prediction; it does not enforce registration here. |
| A1, `one-machine-per-file.test.ts:112` | At `one-machine-per-file.ts:124`, allow every imported Schema member as `msg`; separately, at `:224`, remove the exception, or allow `Schema.Never` in every part | L2 fails on `msg: Schema.String`, the pinned `msg: Schema.Never`, or `update: Schema["Never"]`, respectively. |

All property replays used seed 119120. Every replay ran on Node 26.13.0 with one Vitest worker.
The box refused `nice`'s priority change, so subsequent test commands ran without it.

## A service's type is written out, ticket 908

`fabrika/written-service-type` blocks in `next/` product code. A service's type is the contract a
reader looks up, so it is written out and never taken from the implementation
([0095](../.decisions/0095-a-service-file-holds-only-its-contract.md),
[the Effect code guidelines](../docs/direction/effect-code-guidelines.md)). Slice A2 of
[the plan](../docs/plan/effect-rules-small.md) fixes every site and turns the rule on in one pull
request, so it starts at zero with no list file
([0168](../.decisions/0168-old-lint-breaks-are-fixed.md)).

It reads the last type argument of Effect's `Context.Service`, in the class form
`Context.Service<Self, Type>()("id")` and the direct form `Context.Service<Type>("id")`. It fires
when that type holds, at any depth, `ReturnType<...>`, `Effect.Success<...>` or a `typeof` query.
A type alias or an interface declared in the same file is read through, an interface's `extends`
list included, so the break cannot hide one line up. One `typeof` passes: `typeof X.Type`, the type of a schema's value, inside a member of
a written object type. As the whole type, or joined to one with `&`, it fires. A name imported from
another file passes, since the rule reads one file. A `Context.Reference` is not read. The rule's
head comment lists the import forms it resolves and what it misses.

Tools looked at first (0040): Effect's checker has no check for a service type built from these
three forms, and `serviceNotAsClass` and `leakingRequirements` pass every site. oxlint 1.90.0 has
no `no-restricted-syntax`, and a selector could not resolve a renamed import or read through an
alias.

Tests are left out by `*.test.ts`, `*.test.tsx`, `*Test.ts` and `*.test-support.ts` under `next/`:
a test's stand-in service is not a contract file.

First replay, 2026-11-13, over `next/` with the repo's config: 50 lines in 38 product files write
`Context.Service<`, and the rule fires on **4**. Each fire was read, and none is a false alarm.

| Site | The type it holds | In the plan's count |
|---|---|---|
| `next/packages/libfabrika/src/cloudflare/runtime.ts:928` | `Effect.Success<ReturnType<typeof projectLogic>>` | yes |
| `next/packages/libfabrika/src/cloudflare/runtime.ts:1114` | `Effect.Success<ReturnType<typeof processLogic>>` | yes |
| `next/packages/libfabrika/src/gateway/Gateway.ts:1693` | `Effect.Success<ReturnType<typeof make>>` | yes |
| `next/packages/libfabrika/src/cloudflare/connection.ts:280` | `Effect.Success<ReturnType<typeof gatewayLogic>>` | no: the class is written over four lines, and the plan counted with a one-line search |

`written-service-type.test.ts` holds the law: a property over generated files, each with one to six
services drawn from every service spelling and type form, run through oxlint's `RuleTester`, then
one real oxlint run that proves the config's wiring. This count says nothing about the false alarms
of forms nobody has written yet.

## No static member on a service class, decision 0095

`fabrika/no-static-layer` blocks in the `next/` folders where its count is zero. A service file
holds only its contract, and each layer is a sibling file that exports `layer`
([0095](../.decisions/0095-a-service-file-holds-only-its-contract.md), E5 in
[`docs/direction/effect-code-guidelines.md`](../docs/direction/effect-code-guidelines.md)). The
rule refuses every static member of a class that extends `Context.Service`, not only one that
returns a Layer (owner, 2026-11-13): a syntax rule cannot read a member's type, and a guess from
names would miss.

```ts
export class Retries extends Context.Service<Retries, Shape>()("@kampus/libfabrika/jobs/Retries") {
  static readonly layer = Layer.succeed(Retries, shape); // fires: move it to RetriesMemory.ts
}
```

It fires on a static field (with or without a value), method, getter, setter, accessor and
`static {}` block, on a class declaration or a class expression. `Context` is resolved through the
file's scope, as `service-id` resolves it: a named, renamed or namespace import of `Context`, the
`effect` barrel as a namespace, and `Service` imported from `effect/Context`. An instance member, a
`declare` field and a class that extends anything else (`Schema.TaggedError`, `Schema.Opaque`) or
nothing pass. It misses a static added from outside (`Ledger.layer = ...`, which the type check
refuses) and a `Context.Service` reached through a local alias or a helper.

**Tools looked at** ([0040](../.decisions/0040-existing-tools-before-hand-written.md)):
Effect's checker, `@effect/tsgo` 0.63.0, has no check on a service class's static members;
oxlint 1.90.0 has no `no-restricted-syntax`; and oxlint's `typescript/no-extraneous-class` refuses
a class with only static members, which a class that extends `Context.Service` never is. So the rule
is ours.

**First-day count.** Replayed over all of `next/` on 2026-11-14, at `c0aaf4a24`, with the list
widened to `next/**` in a scratch copy of the config and tests left out: oxlint read all 470 `.ts`
and `.tsx` files in `next/`, tests included, and the rule ran on the 195 that are not tests. **26 fires, all
read by hand, all real**: every one is a static member of a class that extends `Context.Service`.
The plan's hand count was 27; the 27th, `access/SessionManager.ts:63` `static sign`, sits on
`SavedInput`, which extends `Schema.Opaque`, so it is not a service class and the rule is right to
pass it.

| Module | Fires | Where |
|---|---|---|
| top | 1 | `Id.ts:153` |
| `access` | 1 | `SessionManager.ts:102` |
| `gateway` | 1 | `Gateway.ts:1696` |
| `presence` | 1 | `Connections.ts:40` |
| `processes` | 3 | `Mailbox.ts:168`, `ProcessIdGenerator.ts:28`, `ProcessManager.ts:132` |
| `runtime` | 7 | `Entry.ts:115`, `Entry.ts:210`, `ProcessStore.ts:136`, `RecoveryStore.ts:220`, `Runner.ts:335`, `Runner.ts:345`, `Execution.ts:270` (`static make`) |
| `telemetry` | 6 | `Archive.ts:40`, `Archive.ts:53`, `Records.ts:420`, `Records.ts:424`, `Records.ts:429`, `Sink.ts:246` |
| `cloudflare` | 6 | `platform.ts:67`, `:188`, `:237`, `:258`, `:274`, `:305` (`static make`) |

All paths are under `next/packages/libfabrika/src/`. Nothing fired in `next/apps/`,
`next/programs/` or the other libfabrika folders.

**The folder list.** One block in `.oxlintrc.json`, its `files` the 13 folders at zero:
`next/apps/`, `next/programs/`, and libfabrika's `ci`, `codehost`, `coordination`, `jobs`,
`ledger`, `node`, `packs`, `repositories`, `schedules`, `settings` and `transport`. Its
`excludeFiles` leaves out tests, shared suites and test support (`*.test.ts`, `*.test.tsx`,
`*Test.ts`, `*.test-support.ts`): a test may build a stand-in service any way it likes. The top
files of libfabrika's `src/` are not listed yet: they share a folder with `Id.ts`, which still
fires.

**How it closes.** One folder a slice, each in the pull request that moves that folder's layers
(0168): `presence`, `access`, `gateway`, `Id.ts` with the top files, `processes`, `telemetry`,
`runtime`. `cloudflare/` closes last, when the Alchemy port (ticket 502) deletes
`cloudflare/platform.ts`, and that pull request makes the list `next/**`.

The laws are in `no-static-layer.test.ts`: a property through oxlint's RuleTester over generated
classes (a superclass kind, an import spelling, class declaration or expression, and a list of
static and instance members; 100 runs, seed 119120), one real lint run over a planted file per
listed folder and per left-out kind, and the saved list of the folders listed on the day the rule
landed, which only grows.

## No `Cause.squash`, ticket 907

`no-cause-squash` refuses every use of Effect's `Cause.squash` in `next/` product code and in
`.agents/` (E2 of [the Effect code guidelines](../docs/direction/effect-code-guidelines.md),
decision 0168). A squashed cause is one unknown value, and the next line then has to ask what it
is. Read the typed failure with `Cause.findErrorOption` or `Exit.findErrorOption`, and a thrown
value with `Cause.findDefect`.

It resolves the file's own imports, so it reads `Cause` from `effect` under any name, `effect/Cause`
and the `effect` barrel as a namespace, a plain, optional or string member, a reference with no
call, `const { squash } = Cause`, and `squash` imported by name, which fires once at the import.
Another object's `squash`, a local or a parameter named `Cause`, a comment, a string and a type
position pass. It misses an alias made at run time (`const c = Cause; c.squash(x)`) and a
re-export. An edge that must name whatever failed takes
`// oxlint-disable-next-line fabrika/no-cause-squash -- edge: <why>`, and an edge comment over a
line with no squash fails as an unused directive.

Tests, shared suites (`*Test.ts`) and test support (`*.test-support.ts`) are left out by one
override in `.oxlintrc.json`: a test reads a failed `Exit` whole to assert on it. `.agents/` is held
because its rule block repeats `next/**`'s (0033).

Tools looked at first (0040), neither used:

| Tool | Why not |
|---|---|
| oxlint's [`no-restricted-properties`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-properties) | `lint.ts` decides advice by rule code, and this rule's code only advises, for `JSON.parse`. It also misses `import { squash } from "effect/Cause"` |
| oxlint's [`no-restricted-imports`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports) | It bans a named import, not a member read on a namespace, and every site reads `Cause.squash` |

First-day count, 2026-11-13, on main at `c0aaf4a24`, one oxlint run over `next`, `.agents`,
`oxlint-plugins`, `packages`, `programs` and `apps` with the repo's config, each fire read by hand:
**10 fires in 8 files, 10 real, 0 false alarms**, all under `next/packages/libfabrika/src/`:
`cloudflare/connection.ts:150`, `cloudflare/runtime.ts:346`, `cloudflare/tail.ts:57` and `:82`,
`ledger/internal/ledgerStore.ts:273`, `runtime/Runner.ts:844` and `:1823`, `telemetry/Sink.ts:157`,
`transport/Answer.ts:62` and `transport/Connection.ts:178`. A text search for `Cause.squash` in the
same product files finds the same 10 lines, so none was missed. `.agents/` has 0. The 28 uses in 19
test files of `next/` stay. The rule joins as an error with no ledger entry: the same pull request
fixes all 10.

`no-cause-squash.test.ts` holds the laws. Law 2 is a property through oxlint's `RuleTester`: an
import spelling, uses and neighbors that must pass, 100 runs, seed 119120. Law 3 is one real oxlint
run over one planted file per path kind, with the repo's config.
