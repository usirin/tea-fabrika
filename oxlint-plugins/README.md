These lint rules are the `fabrika` plugin for oxlint, written in TypeScript. `index.ts` lists them, `match.ts` holds what they share, and `.oxlintrc.json` at the top of the repo turns each one on, with the reason for every path it leaves out. Why oxlint: [`docs/direction/oxlint-and-oxfmt.md`](../docs/direction/oxlint-and-oxfmt.md).

```sh
pnpm lint                                   # runs lint.ts, then format.ts --check, then the code-graph checks
node oxlint-plugins/lint.ts packages/x      # the same oxlint step on one folder
```

`exact-versions.ts` is not an oxlint rule: `pnpm lint` runs it to refuse any ranged npm version in a tracked `package.json` or `pnpm-workspace.yaml` ([`docs/direction/pin-exact-versions.md`](../docs/direction/pin-exact-versions.md)).

Run oxlint and oxfmt through `lint.ts` and `format.ts`, not on their own. These two pin the one config at the top of the repo and turn off nested configs and outside ignore files, so a plain file cannot take a folder out of the checks. `lint.ts` also fails when a `.gitignore` hides a tracked file.

They began as GritQL rules in the `biome-plugins/` folder of [kamp-us/phoenix](https://github.com/kamp-us/phoenix), the pipeline this repo rebuilds, copied here unchanged. On 2026-10-31 they became TypeScript rules here, so this folder is where they change now. Each one fired on the same lines as its GritQL rule, on the whole tree and on a set of odd spellings; the note above has the numbers. The counts below are from when the GritQL rules were added and are kept as history. A name like `no-secret-env.grit` in them means the rule that is now `no-secret-env.ts`, and a mention of `biome-ignore` means what is now `oxlint-disable-next-line`.

Two rules only advise: `no-effect-promise` and `no-raw-try-catch`. Their messages start with "Advice, does not block". Oxlint has no level below `warn`, so `lint.ts` runs oxlint once and decides: it prints every fire, and fails on any fire but these two. Experiment 125 found both wrong far too often to block: 8 of 8 and 21 of 21 fires kept their code. Under Biome the same two gave their diagnostics at `"info"`, which `pnpm lint` (`biome check --error-on-warnings`) printed and did not fail on.

Phoenix's `no-node-sqlite-test-backing.grit` is not here. It bans a fake of Cloudflare D1; this repo has no D1, and `node:sqlite` is the ledger's real driver. Experiment 125 found it wrong 8 of 8 times.

`use-import-extensions` was not a plugin before. It stands in for Biome's built-in `useImportExtensions`, because oxlint's `import/extensions` misses `import()`, `import x = require()` and a name like `./b.laws`. It also refuses `./thing.js` when only `thing.ts` is there, which tsc accepts and Node does not. It has no autofix, so a miss is fixed by hand. It fired 0 times on the tree when it was added.

`no-bare-disable` was not a plugin before either. Biome failed on an ignore comment with no reason, and oxlint does not: its bare `// oxlint-disable-next-line` silences every rule, the secret rules too. This rule refuses an ignore comment that names no rule, gives no `-- <why>`, or says `eslint-disable`. It reports at offset 0 of the file, so the comment it refuses cannot silence it. It fired 0 times on the tree when it was added.

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

`plants.test.ts` plants one line per rule that no other test plants, and the built-in rules that must not be lost (unused imports and variables, non-null, ts-ignore), and sees each fire. It also runs `lint.ts`: advice alone exits 0 and still prints; a blocking fire exits 1.

## The new version's exam rules

Seven rules apply to `next/` only, as Tier 1's exam (`docs/plan/tier-1-detail.md`, "The exam PR", items 1, 2, 4, 5 and 13, and P35). `.oxlintrc.json` turns them on in `next/**` and nowhere else, so today's code is untouched. Their planted tests live with the rest of the exam, in `next/apps/fabrika/src/exam/`, and lint each planted file at the `next/` path it names, in a temp folder with this repo's config, so the edge paths and globs meet it as they meet a real file.

| Rule | Refuses | Edges | Tests |
|---|---|---|---|
| `no-promises` | `async`, `await`, `for await`, `new Promise`, `Promise.x(...)`, `.then`, `import()`, `.catch` on anything not imported from Effect, and Effect 4.1.1's calls that take or make a Promise: `Effect.promise`, `Effect.tryPromise`, Schema's four `...Promise` calls, Stream's `fromAsyncIterable` and `toAsyncIterable` and its two variants, typed calls included | a line under an edge comment | left out |
| `no-effect-run-outside-edge` | any of Effect's twelve run functions, on `Effect` or a runtime, and `runtimePromise` and `makeRuntimePromise`; `NodeRuntime.runMain` passes | a line under an edge comment | left out |
| `edge-comment` | an ignore comment naming either rule above that is not `// oxlint-disable-next-line <rule> -- edge: <why>`: another form, another rule named beside them, or no `edge: ` reason | none | on |
| `no-of` | a declared name `of` or ending in `Of`; a use passes | none | on |
| `no-hand-tag` | an object key, class field or type member named `_tag`; a read passes | the log, `next/packages/libfabrika/src/data/log.ts` | left out |
| `one-store-hook` | `useSyncExternalStore` imported or read as a plain member anywhere in `next/`; a store hook's value dropped | none | left out |
| `no-clock-in-view` | `Date.now()`, `new Date()`, `Date()`, `performance.now()`, `Math.random()`, `crypto.randomUUID()` in a `.tsx` file, handlers included | none | left out |

React's own `react/refs`, `react/immutability`, `react/display-name` and `react/purity` block in `next/**/*.tsx`, tests left out (`docs/direction/react-compiler.md`). `react/purity` refuses a clock or random read in render and lets a handler pass, as React means it; `no-clock-in-view` refuses the same reads anywhere in a `next/` `.tsx` file, handlers included, since the time comes through a Cmd (C1; owner, 2026-11-05). oxc-transform-react 0.157.0 stopped refusing a clock read in a handler a view passes down, which 0.156.0 did, so this rule holds that case now. `pnpm lint:compiler` runs the Compiler's compile step, `next/apps/fabrika/src/exam/compiler.ts`, over every `.tsx` file in `next/`, against `compiler-ledger.json`, which starts empty.

**Edges are comments, not files** (owner, 2026-11-05; Tier 1, P35). The one line a platform demands, such as a Durable Object method that must answer a Promise, passes either rule only under `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, or the same for `fabrika/no-effect-run-outside-edge`, or one comment naming both. Until P35 the run rule held a list of 18 whole paths, which let a whole file wrap Promises; the list is gone. `edge-comment` keeps every such comment to one shape, reported at the top of the file as `no-bare-disable` is, so a comment cannot silence it. An edge comment over a line where nothing fires fails through `reportUnusedDisableDirectives`. CI's `edges` step (`next/apps/fabrika/src/exam/edges.ts`) lists each edge comment a pull request adds, with its reason, in the step summary and as a note on the diff, for the owner to read; it never blocks. Its industry match is clippy's `undocumented_unsafe_blocks`, with `edge:` for `SAFETY:`, and eslint-comments' `require-description` and `no-restricted-disable`.

None of these rules sees types. A `.catch` is told apart by the name it is called on, `Effect.promise` and the run functions by their written names, so an Effect module under another name, or a Promise reached through a helper, passes. `no-hand-tag` misses `x._tag = "a"`, which the plan does not name. Report any miss.

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
