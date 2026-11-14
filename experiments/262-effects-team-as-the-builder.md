---
date: "2026-11-11"
scripts: "none; the checker ran in a scratch worktree that is not kept"
summary: "`next/`, at `5eb5fd0ee`. Reading, plus one run of `@effect/tsgo` 0.63.0 with all 135 checks on. Four reads of every library and app file beside `effect` 4.1.2's source found nine principles; `runtime/Runner.ts` breaks six. Effect's checker covers one of the audit's ten main gaps fully (raw `fetch`) and one in part (`instanceof`); 17 off checks find 0 hits and can block now, about 20 more after sweeps of about 125 hits. Hand guards, dropped causes (about 113), hand crypto, copy-paste wrappers, fixed retries, docs, long closures and static layers need our own rules or pattern docs. Feeds [Effect code guidelines](../docs/direction/effect-code-guidelines.md). No paid API call; the agents' tokens were not recorded."
---

# How would Effect's own team build `next/`'s code, and which of their habits can a check hold?

Read 2026-11-11, on `origin/main` at `5eb5fd0ee`. **This is reading, plus one run of Effect's own
checker.** Four reading agents read every non-test file of `next/packages/libfabrika/src` and
`next/apps/fabrika/src` beside Effect's source, module by module. A fifth ran `@effect/tsgo` 0.63.0
with all 135 of its checks on, once per `next/` project, in a scratch worktree that was then left
alone. Nothing in the real checkout changed. It feeds the note
[Effect code guidelines](../docs/direction/effect-code-guidelines.md). No Design canvas: this study
is about code, so the guidelines skill's design steps (step 5's looks and shots, step 9's canvas and
page) do not apply ([0114](../.decisions/0114-effects-team-as-the-builder.md)). Steps 1 to 4, 6, 7
and 8 ran. Dollars: no paid API call. The five agents' tokens were not recorded, so their list
price is a hole.

Versions read: `effect` 4.1.2 (its `src/` ships in the package, with `AGENTS.md`, 433 lines, read in
full), `@effect/platform-node-shared` 4.1.2, `@effect/sql-d1` 4.0.6, `@effect/tsgo` 0.63.0, oxlint
1.90.0, and Effect-TS/effect-smol's own `AGENTS.md` and `.patterns/effect.md`, fetched with `gh api`
on 2026-11-11.

**The answer.** Effect's team writes small named pieces. A long file is a shelf: many short exports,
each with a doc block, or one `make` cut into named helpers and marked sections, ending in a service
whose type is written out. They reach for a module they ship before writing one. They match errors
by tag and keep the cause. They wrap a platform once, with one helper. They put a dependency in a
layer's requirements, never build it inside.

`next/` mostly picks Effect's primitives already. Where it breaks their habits, it breaks them in a
few files, and the same ways recur. The running example, `runtime/Runner.ts`, shows six of the nine
principles broken in one file: one 1,520-line closure (`Runner.ts:213-1733`) with one section marker
(`:1086`), nine `let`s that carry state between calls (`:215-239`), errors matched by `instanceof`
(`:1182-1191`), hand type guards (`:1747`, `:1763-1766`), a layer built inside a layer (`:218-221`),
and a fixed retry wait (`:1344-1348`).

Effect's own checker holds little of this. Of the audit's ten main gaps, a shipped check covers one
fully (raw `fetch`) and one in part (`instanceof` on our errors). Hand guards, dropped causes,
hand-built primitives, copy-paste wrappers, fixed retries, doc comments, long closures and static
layers have no shipped check. So most principles need a rule of ours or a pattern doc.

```text
Effect cluster   one 2,000-line make in Sharding.ts, 10 "// --- X ---" sections, hard parts in internal/
Effect platform  NodeFileSystem: one const per method, each wrapped once with effectify, then FileSystem.make
Effect errors    catchTag / catchTags; every reason error keeps cause: Schema.Defect(); 0 instanceof in cluster/
Effect retries   Schedule.min([Schedule.exponential(500, 1.5), Schedule.spaced("10 seconds")])
Effect docs      100% of public exports, @stability @category @since; checked by a private oxlint rule
Effect spans     fnUntraced in library code (70 in cluster/, 0 named Effect.fn)
Elm              a module around one central type; update is the only place state moves
OTP              gen_server callbacks are a shelf of named functions; gen_statem for control state
```

## Which version

- **`next/`:** everything here. Every claim names a `next/` file.
- **Today's version:** not touched. Its code and its `packages/fabrika` style are out of scope.

## Step 1: what is settled

Decided, each with its source, and never asked again here:

| Point | Source |
|---|---|
| `next/` follows Effect's code style and doc comments; a kept difference names its reason | [0023](../.decisions/0023-next-follows-effects-code-style.md) |
| Format, `Module.of`, plural service names, test tooling read through its module | [0029](../.decisions/0029-format-and-names-follow-effect.md), [0039](../.decisions/0039-keep-semicolons-and-es5-commas.md), [0094](../.decisions/0094-lines-are-100-columns.md) |
| Lead tooling follows `next/`'s rules | [0033](../.decisions/0033-agents-code-follows-next-rules.md) |
| Every implicit state machine is made explicit, as a tea machine, one per file | [0037](../.decisions/0037-implicit-state-machines-made-explicit.md), [0046](../.decisions/0046-one-tea-machine-per-file.md) |
| Try an existing tool before writing a check | [0040](../.decisions/0040-existing-tools-before-hand-written.md) |
| A ledger step is a plain synchronous function inside the transaction | [0050](../.decisions/0050-a-ledger-step-is-a-plain-function.md) |
| Each service fails with its own error | [0055](../.decisions/0055-errors-named-by-their-service.md) |
| A resource is acquired in a scope | [0061](../.decisions/0061-resources-are-acquired-in-a-scope.md) |
| Tests keep the layers; a database suite is run by the module that owns the driver | [0062](../.decisions/0062-test-files-keep-the-floors.md) |
| A folder is a module; its rank is a layer | [0091](../.decisions/0091-modules-and-layers.md) |
| A service file holds only its contract; layers are sibling files; no static layer; platform code in its folder | [0095](../.decisions/0095-a-service-file-holds-only-its-contract.md) |
| A Durable Object works inside a wake and sleeps | [0105](../.decisions/0105-a-durable-object-never-stays-awake-on-its-own.md) |
| Effect's team is the builder we measure `next/` against | [0114](../.decisions/0114-effects-team-as-the-builder.md), accepted 2026-11-11, not on main yet |
| Every exported function that returns an Effect is a named `Effect.fn` | [the `Effect.fn` note](../docs/direction/effect-fn-for-traced-functions.md) |
| No Promises outside a marked edge | [no Promises](../docs/direction/no-promises.md) |
| Effect's checker runs inside `tsc`; 65 of its checks block today | `tsconfig.base.json`'s `@effect/language-service` block |

Leaned, not decided: nothing on this area.

Not touched by anyone before this study: how a long layer body is cut, how a platform is wrapped,
which hand-built primitives go, which shipped checks turn on next, and plan codes in comments.

Pattern docs that already hold part of this: `effect-errors-keep-their-cause.md`,
`effect-services-and-layers.md`, `effect-state-and-time.md`,
`effect-swallowed-failures-leave-a-trace.md`, `effect-tests-run-in-it-effect.md`,
`doc-comments.md` and `durable-objects-sleep.md`.

**The scope, in one line:** the shape of Effect code in `next/`'s libraries and app, not the tea
machines' own design and not today's version.

## Step 2: the running example

`next/packages/libfabrika/src/runtime/Runner.ts` on `origin/main`, 1,766 lines. It is the program
runner: one process's turns, its Cmds and its recovery.

| What | Today | Where |
|---|---|---|
| The layer body | one closure of 1,520 lines | `Runner.ts:213-1733` |
| Section markers inside it | one, `// --- Cmds ---` | `Runner.ts:1086` |
| State carried between calls | nine `let`s: `store`, `process`, `supervision`, `woke`, `drained`, `mailRetry`, `live`, `alarmAt`, `retry` | `Runner.ts:215-239` |
| A `let` with three meanings | `alarmAt: number \| null \| undefined` (unknown, none, set), no comment | `Runner.ts:237` |
| Hand-built moves of the saved supervision record | 15 `saveRecovery({ ...s, ... })` spreads | first at `Runner.ts:371` |
| Error matching | `catchIf` with an `instanceof` guard; `Cause.squash` then `instanceof` | `Runner.ts:1182-1191`, `:751-769`, `:1536` |
| Hand type guards | `typeof m === "object" && m !== null` | `Runner.ts:1747`, `:1749`, `:1763-1766` |
| Equality and digest by `JSON.stringify` | key order changes the answer | `Runner.ts:145-149`, `:1461-1463` |
| A layer built inside a layer | `RecoveryStore` and `Replies` provided in the body | `Runner.ts:218-221` |
| Config found late | `Effect.die(new Error(...))`, `Option.getOrThrow` | `Runner.ts:1169`, `:1174` |
| Fixed retry wait | `now + minMs` every time, no growth, no cap | `Runner.ts:1344-1348` |
| Static layers on the class | `layer`, `withLoader` | `Runner.ts:190`, `:200` |
| Service id | no module folder | `Runner.ts:188` |
| Imports | the `effect` barrel, named | `Runner.ts:7-20` |
| Doc on its error | stale: says "delivery" for a reason that is about a client | `Runner.ts:1737-1740` |
| Plan code in the header | "(Tier 1, P11)" | `Runner.ts:1` |
| What it does well | the service's type is written out; requirements are listed in the layer's type; `Clock`, `DateTime`, `Semaphore`; a fine "why" comment | `Runner.ts:177-188`, `:196`, `:235`, `:242`, `:1181` |

The brief for this study said 11 `let`s. My count is nine that carry state between calls at the
closure's top, and nine more that are locals of one function further in. The nine are the ones that
matter.

Runner has no platform edge, so it cannot show principle E6. The second example is
`next/packages/libfabrika/src/cloudflare/platform.ts`, 249 lines: 57 `Effect.tryPromise` wrappers,
each with its own edge comment (`platform.ts:20-25` and on), and every one fails with
`catch: unreachable`, which drops the cause (`platform.ts:12`).

## Step 3: what was read

### Effect's code, at the installed version

| Tag | Source | What it teaches |
|---|---|---|
| [e1] | `effect/src/cluster/Sharding.ts` | One `make` from `:242` to `:2232`, cut by ten `// --- X ---` markers (`:386` "Shard acquisition", `:787` "Storage inbox", `:1227` "Sending messages", `:2151` "Finalization") |
| [e2] | `effect/src/cluster/internal/entityManager.ts` | The hard part lives in `internal/`, takes its services as arguments; a state object `EntityState` (`:102-128`); `Effect.catchTag("EntityNotAssignedToRunner", ...)` (`:449-450`); a capped exponential `Schedule` (`:999-1002`) |
| [e3] | `effect/src/cluster/RunnerStorage.ts` | A contract with every member documented (`:32-82`) |
| [e4] | `@effect/platform-node-shared/src/NodeFileSystem.ts` | Each Node call wrapped once: `effectify(NFS.access, handleErrnoException("FileSystem", "access"), ...)` (`:65-70`), then one `FileSystem.make({...})` |
| [e5] | `effect/src/sql/SqlError.ts` | Every reason carries `cause: Schema.Defect()` (`:20-24`) |
| [e6] | `effect/src/JsonPatch.ts` | `export function get(oldValue, newValue)` (`:184`), the same diff as our `runtime/Patch.ts` |
| [e7] | `effect/src/crypto/` | `Digest`, `Mac` (`sign`, `verify` as Effects, `Mac.ts:150-168`), `SecureRandom`, each with `layerWebCrypto` (`Digest.ts:159`, `SecureRandom.ts:282`) |
| [e8] | `effect/src/Predicate.ts` | `hasProperty` (`:1352`), `isTagged` (`:1452`) |
| [e9] | `effect/src/Schema.ts`, `SemVer.ts`, `Glob.ts` | `toEquivalence` (`Schema.ts:18064`), `SemVer.isGreaterThan` (`SemVer.ts:623`), `Glob.make` (`Glob.ts:98`) |
| [e10] | `effect/src/eventlog/SqlEventJournal.ts` | Tracing off inside the journal (`withTracerDisabled`, `:307`, `:484`) |
| [e11] | `effect/src/cluster/Snowflake.ts` | Service id with its folder: `"effect/cluster/Snowflake/Generator"` (`:291`) |
| [e12] | counts over `effect/src/cluster/` | 70 `fnUntraced`, 0 named `Effect.fn`, 0 `instanceof` |

### Effect's guidance to agents and its checker

| Tag | Source | What it says |
|---|---|---|
| [a1] | `node_modules/effect/AGENTS.md`, 4.1.2 | "Avoid functions that only wrap and return `Effect.gen`" (`:16-17`); errors are `Schema.TaggedError`, with `cause: Schema.Defect()` (`:166-168`); "**AVOID using predicates or manual parsing**" (`:114`); "**NEVER** write your own helper functions like `isRecord`" (`:321-322`); use `DateTime`, not `Date` (`:290`); a service id holds "the package name and the subdirectory path" (`:142-144`); a static layer on the service (`:146-148`) |
| [a2] | effect-smol `AGENTS.md` (fetched) | "Prefer existing abstractions and conventions over introducing new ones"; "Do not use `async` / `await` or `try` / `catch`"; "Do not use `Date.now` or `new Date`" |
| [a3] | effect-smol `.patterns/effect.md` (fetched) | "Always use `return yield*` when yielding terminal effects"; "Prefer `Effect.fnUntraced` over functions that only return `Effect.gen`"; class syntax for `Context.Service` |
| [a4] | `@effect/tsgo` 0.63.0 `README.md` and `schema.json` | 135 checks in five groups (correctness, anti-pattern, Effect-native, style, maintainers) and seven oxlint presets |
| [a5] | the checker run (step 6 below) | Effect's own repo blocks on none of these checks and keeps its docs rule, `effect/jsdocs`, private |

### Outside Effect

| Tag | Source | What it teaches | What does not carry over |
|---|---|---|---|
| [m1] | Elm's guide, "Structuring Web Apps" (cited by 0046) | A module is built around one central type; `update` is the one place state moves | Elm has no services or layers |
| [m2] | Erlang/OTP `gen_server` and `gen_statem` (secondary, not fetched for this study) | A server is a shelf of named callbacks; control state is a `gen_statem` | OTP's processes hold memory; a Durable Object must not |
| [m3] | A newsroom's house style book (an analogy, not a source) | Copy editors check the mechanical rules; editors judge the rest | Nothing to quote |
| [m4] | An electrical code's "listed parts" (an analogy, not a source) | A listed, tested part beats one built on site, unless the site needs what no part does | Nothing to quote |

The two analogies give the shape of the answer, not evidence. [m3] says: a rule a machine can check
is a check, and prose keeps only judgment, which AGENTS.md already says. [m4] says: use what Effect
ships, and keep our own part only where the platform needs what theirs cannot do.

### The plain way they agree on

Effect's team prefers a module they ship, a named piece over a long body, a tag over a class check,
a kept cause over a message, one wrapper per platform, and a requirement over a hidden build. Where
our goal clashes with theirs (a Durable Object that sleeps, synchronous SQL, spans on every call),
we keep our way and say why, as 0023 and 0114 already ask.

## Step 4: each principle, tested three ways

The three tests: how Effect's team would build it (the builder row), the Elm or OTP answer, and,
in place of the accessibility test, "can an agent that knows only older Effect read and copy
this?" Older Effect means v2 and v3: `Effect.Service`, `Context.Tag`, `Layer.scoped`,
`Effect.catchAll`, `Either`, `@effect/schema`.

| Principle | Effect's team as the builder | Elm or OTP | An agent that knows older Effect |
|---|---|---|---|
| E1 Use what Effect ships | Delete `Patch.ts` for `JsonPatch.get` [e6]; `effect/crypto` for the 7 WebCrypto edges [e7]; `Predicate` [e8]; `SemVer`, `Glob`, `Schema.toEquivalence` [e9] | OTP reaches for its standard library first | Knows `Predicate`, `Schedule`, `DateTime`; does not know `effect/crypto`, `JsonPatch`, `SemVer` or `Glob`, which are newer. A pattern doc must name them |
| E2 A failure is a typed value | `catchTag`, `cause: Schema.Defect()` [e2], [e5]; 0 `instanceof` [e12] | Elm: `Result` with a custom error, no exceptions; OTP: exit reasons are terms | `catchTag` and `catchTags` read the same in v3. `catchAll` became `catch`, which the on-by-default `outdatedApi` check catches. `catchReason` is new |
| E3 A long body is a shelf of named pieces | Sections and an `internal/` split [e1], [e2]; one const per method [e4] | OTP callbacks; Elm warns against splitting early (0046 quotes it) | Copies whatever it sees. A 1,520-line closure teaches it to write the next one |
| E4 Control state is a tea machine | Effect would use loose flags (`entityManager.ts:105-123`); ours is better here | Elm `update`; OTP `gen_statem` | Knows Elm; tea's API is ours, so the pattern doc carries it |
| E5 A service is its contract; layers are wired by requirements | Requirements in the layer's type; `entityManager.make` takes its storage as an argument (`entityManager.ts:143`) | OTP child specs list what starts | The riskiest: Effect's own `AGENTS.md` teaches a static layer (`:146-148`), and v3 taught `Effect.Service` with `dependencies`. Only a lint rule stops it |
| E6 A platform is wrapped once | `effectify` once per call, errors mapped with the cause [e4] | Elm: ports at one edge; OTP: one module per port | Knows `tryPromise` and will copy 57 of them. A pattern doc shows the one wrapper |
| E7 Docs the Effect way; comments say why | 100% of exports, `@since` [e3]; short inline whys | OTP 27's `-doc` attributes (secondary); Elm's packages document every exposed value (secondary) | `@since` and `@category` are old; `@stability` is new. `doc-comments.md` covers it |
| E8 Names, imports and ids read like Effect's | Namespace imports, ids with the folder [e11] | No Elm or OTP answer: names follow the host library | v3 used the same import style. Safe |
| E9 A difference stays only with its reason | 0023 and 0114 ask it; Effect's code explains its own choices inline ("D1 batches ... intentionally cannot participate in SqlClient transactions", `D1Client.ts:184`) | OTP: this repo's own "where we leave OTP" table | Judgment. A reason written at the line is what the agent reads |

## Step 6 input: what Effect's own checker holds

One run, all 135 checks set to `warning`, `namespaceImportPackages: ["effect"]`, on the three
`next/` projects. A hit is one file, position and check. "Product" is everything that is not a test,
a test-support file, a fixture or a shared `*Test.ts` suite.

- 65 checks are on today (63 everywhere, 2 for product code only). All 65 find 0 hits: the type
  check is green.
- Of the 70 that are off, 53 find something. With the 2 product-only checks' test hits, that is
  55 checks with hits: 1,988 in product code and 7,340 in tests.
- Six checks make about 7,000 of the 9,328 hits (`preferEffectArray`, `unstableApiUsage`,
  `preferNamespaceImport`, `strictEffectProvide`, `asyncFunction`, `preferEffectString`). Read at 5
  sampled hits each (seed 119120), most were false alarms for this repo.
- 17 checks that are off find 0 hits, so they can block today at no cost.
- About 20 sampled clean, with small counts (about 125 hits in all). They can block after a small
  sweep.
- Effect's own repo keeps every Effect diagnostic from failing `tsc`, and its docs rule is private.
  We already block on 65; they block on none.

Shipped checks against the audit's gaps:

| Gap | Shipped check | What it finds |
|---|---|---|
| Raw `fetch` | `globalFetchInEffect` | 3 of 3 product sites, 2 more than the reads found |
| `instanceof` on our errors | `instanceOfSchema`, in part | 20 of 28 product `instanceof`, every one on a Schema class; it misses `Cause.squash` and the `catchIf` guard at `Runner.ts:1185` |
| `Date.now`, `new Date` | `globalDateInEffect`, `globalDate` | 2 and 3 product sites, all the reads named |
| Decode inside `Effect.try` | `schemaSyncInEffect` | 6 product sites |
| A layer built inside a layer | `strictEffectProvide` | 20 product hits, 3 of 5 sampled right; it misses `Layer.build` at `cloudflare/runtime.ts:357` and `cloudflare/connection.ts:18` |
| `JSON.stringify` equality | `preferSchemaOverJson` | 2 of 3 named; 1 of 5 sampled right overall, so it cannot block |
| Service ids without the folder | `deterministicKeys` | 40 product sites, 5 of 5 sampled right |
| Named imports from the barrel | `preferNamespaceImport` | 441 product, 4 of 5 right for libfabrika |
| `unknown` errors from hand-typed stubs | `anyUnknownInErrorContext` | 50 product, 5 of 5 right |
| Hand guards, dropped causes, hand crypto, copy-paste wrappers, fixed retries, docs, long closures, static layers | none | 0 |

## Today's example, against each principle

| Principle | `Runner.ts` | Where |
|---|---|---|
| E1 Use what Effect ships | breaks | hand guards `:1747`, `:1763-1766`; `JSON.stringify` `:145-149`, `:1461-1463`; fixed retry `:1344-1348`. Follows: `Clock`, `DateTime`, `Semaphore` `:235`, `:242` |
| E2 A failure is a typed value | breaks | `instanceof` `:1182-1191`; `Cause.squash` `:751-769`, `:1536`; `Effect.die(new Error(...))` `:1169`. Follows: `RunnerError` is a `TaggedError` `:1738` |
| E3 A long body is a shelf | breaks | one closure `:213-1733`, one marker `:1086`. Follows: the service's type is written out `:177-188` |
| E4 Control state is a tea machine | half | the supervisor is a saved tea machine (`internal/supervisor.ts:73`), but nine `let`s `:215-239` and 15 hand spreads (first `:371`) move state outside it |
| E5 Contract and wired layers | breaks | static layers `:190`, `:200`; built inside `:218-221`; `Option.getOrThrow` `:1174`. Follows: requirements in the type `:196` |
| E6 A platform wrapped once | not shown | see `cloudflare/platform.ts:12-25`: 57 wrappers, cause dropped |
| E7 Docs and why comments | half | good why at `:1181`; plan code `:1`; stale doc `:1737`; no doc on `ensure` or `resume` |
| E8 Names, imports, ids | breaks | barrel import `:7-20`; id without `runtime/` `:188` |
| E9 Differences with reasons | half | its header says what a turn does (`:1-5`) but not why it is not Effect's `entityManager` |

## What this tells us for fabrika

- **Nine principles came out**, because the findings fell into nine groups that each have one
  reason and one way to hold them. Two that share a reason were merged: matching errors by tag and
  never throwing from pure code are both "a failure is a typed value". Nothing was aimed at a count.
  **After the walk, eight:** the owner folded E6 (a platform wrapped once) into E1 on 2026-11-11,
  since Alchemy's stub is that wrapper. The note numbers this write-up's E7, E8 and E9 as E6, E7
  and E8. The tables above keep the nine as they were read.
- **Five of the nine are mostly held by a check,** but only two of those checks are Effect's. The
  rest are rules we write (four) or pattern docs (four new or extended).
- **The fastest win holds new code today:** turn on the 17 zero-hit checks, write three pattern
  docs, and add four small rules of ours. Old code then moves in sweeps, smallest first.
- **Where ours is better stays,** with its reason beside it: contract-only service files, the
  supervisor as a saved tea machine, the span sink that keeps every span for a sleeping object, the
  stateless HMAC nonce, synchronous SQL and ledger steps, and `access/Access.ts` as a pure fold.

## Added 2026-11-11: per-file findings

The four reads behind this write-up, file by file, as one bullet per finding. All `next/`. **Lines
are as of `5eb5fd0ee`; 6 of 10 sampled still match on main at `a0a94519e`.** Of the other four, three
moved (`Runner.ts:1344` is now `:1250`, `Runner.ts:1763` is now `:1648`, `settings/Files.ts:142` is
now `:158`) and one is fixed (`GatewayStore.ts:27` keeps its cause now). Two pull requests merged
since the read change whole groups below: [PR 924](https://github.com/usirin/tea-fabrika/pull/924)
(an error keeps its cause, slice 1 of 2) gave `LedgerError` a `cause` and made `platform.ts`'s
`unreachable` keep it, and [PR 926](https://github.com/usirin/tea-fabrika/pull/926) (P34c slice 2)
moved the runner's recovery journal into its own tea machine, so the 15 hand `saveRecovery` spreads
are gone (0 on main). The rest is not rechecked. Counts are `rg` patterns, as above.

### `runtime/` (21 product files read in full)

- `Patch.ts` (83 lines) is `JsonPatch.get` (`JsonPatch.ts:184-238`): same index-wise arrays, removes
  from the end. Ours adds a deep-equal pre-check and `structuredClone`; Effect sorts keys. About 85%
  sure it can go; a law that pins key order is the doubt.
- `Program.ts`: `make` throws a decode failure (`:315-317`) and patches a schema's `make` with
  `Object.defineProperty` (`:114-115`); the stepper throws `ProgramDown` from pure code (`:405-416`,
  `:474`, `:529`) while half the file uses `Result`. Effect names the throwing form `makeUnsafe`.
- `Execution.ts`: seven near-identical `tryPromise` blocks (`:182-230`) and a hand decoder (`:237-255`),
  where an `RpcGroup` declares each call once (70% sure: the Worker Loader stub may need a patch).
  `ExecutionClient` is a service never provided as one (`:174-233`), with id `"fabrika/ExecutionClient"`.
- `ProcessStore.ts`: `select` builds a new layer per call (`:127-131`); `LayerMap` or a plain
  `make(process)` fits. Static layer (`:88`).
- `RecoveryStore.ts`: no module comment and no doc on its four methods; a parameter named `who` (`:39`).
- `Entry.ts`: five services in a file named for none (`:74`, `:137`, `:157`, `:163`, `:168`).
- `State.ts`: `Saved.upgrade` throws (`:36`, `:52`, `:59`) where it could return `Result`.
- `BrainLife.ts`: `terminal(s) || s._tag === "stopping"` three times (`:42`, `:46`, `:52`), no comments.
  `BrainEvent.ts`, `BrainLife.ts` and `Built.ts` are about the brain and the build, not the runner.
- `internal/recovery.ts:9-10`: two doc blocks on one export; only `@internal` attaches.
- `internal/supervisor.ts:122`: backoff by hand, fair, since a `Schedule` cannot be saved.
- Doc coverage: 34 of 85 public exports (40%); 0 `@since`. Inline comments: `Runner.ts` 2% of
  lines, `entityManager.ts` 8%, `Sharding.ts` 11%.
- Good: `MailDeliveryLive.ts:16-22` is textbook `Effect.fn(name)(body, mapError)`; no `Date.now` in any
  product file; Promise edges each carry a reason (`Execution.ts:184-229`).

### `gateway/`, `access/`, `transport/`, `presence/` (20 files, 4,358 lines)

- `Gateway.ts`: one 1,355-line closure (`:265-1619`), 2 exports, 12 comment lines; each method named
  in three places (`:210-220`, `:1014-1054`, `:1250-1393`) and checked with `Schema.is` then decoded
  again (`:1020`, `:1326`); `InputId` decoded twice in one call (`:1278`, `:1289`).
- Hand WebCrypto in 3 files with 7 Promise edges where `effect/crypto` covers it: `Gateway.ts:1637-1661`,
  `GatewayNonce.ts:19,38,45,48,75`, `binary.ts:76-84`, `Hello.ts:98`, `Sshsig.ts:169-170`,
  `Webauthn.ts:123-129`. The app already uses `effect/crypto` (`next/apps/fabrika/dev.ts:7`). The
  fingerprint is computed twice (`Hello.ts:98-99`, `Gateway.ts:1639-1652`). The 6-digit code
  `String(u32).slice(-6)` (`Gateway.ts:606-608`) is very slightly biased; `SecureRandom.intBetween`
  is exact. 85% sure; whether `Signature.publicKey` takes our P-256 point is a one-hour spike.
- The "decode and fold `gateway/access`" step is written three times: `Gateway.ts:292-310`,
  `Authorization.ts:21-35`, `ClientManagerLedger.ts:17-44`.
- `online(client)` repeated at the top of `watch` (`:620`), `deny` (`:979`), `route` (`:1007`); one
  `Caller` service provided in `route` would hold it (75%).
- `Options` has 22 fields, 8 callbacks, 4 type parameters (`Gateway.ts:222-263`) (70% on a split).
- A hand cancel token per client (`:283`, `:386-388`, `:413-434`) where `FiberMap.run` fits (60%).
- `let start` (`:674-698`) is outside the `turn` permit, so two first calls may both allocate. Read
  only: 70% sure it can interleave, 40% sure it matters.
- `EnvelopeState` (`:69-75`) moved by hand spreads (`:1224`, `:1268`, `:1305`, `:1311`), and
  `Attached` set by hand (`:507`, `:557`, `:635`) beside its own machine: against 0046.
- Small: `rawObject` (`:54-55`); `JSON.stringify` equality (`:811-820`, `:1603-1604`,
  `SessionManager.ts:234`); a hand no-op tracer (`:46-50`); `Effect.fn` made and run once inside a call
  (`:526`, `:843`, `:1085`, `:1242`); `new Date(at).toISOString()` (`:1151`, `:1523`); "door", the
  old name, at `:1401`.
- `transport/Answer.ts`'s `answerFrame` has only its test as a reader, and `Connection.ts:52-61`
  builds the same frame again. `Connection.ts:80-83` fishes out `reason` by hand.
- Static layers: `Gateway.ts:1624`, `SessionManager.ts:102`, `Connections.ts:40`.
- Docs: 43 of 92 exports (47%), 24 of 73 outside `internal/`. Plan codes in comments: `Access.ts:1-3`,
  `:60`, `:365`, `ClientManagerLedger.ts:82`.
- Good: `Access.ts` (a pure fold, `Result` per rule); the SSHSIG and passkey parsers
  (`Sshsig.ts:79-100`, `Webauthn.ts:9-18`); the stateless HMAC nonce (`GatewayNonce.ts`), which a
  sleeping object needs; waits saved in the socket attachment (`Connection.ts:111-113`).

### `processes/`, `ledger/`, `telemetry/`, `settings/` (39 files)

- `LedgerError` had no `cause` (`Ledger.ts:15-17`, `ledgerStore.ts:282-285`); `ProcessError` had
  neither (`Process.ts:136-149`). PR 924 has since added `cause` to `LedgerError`.
- `ProgramMailLedger.ts:146`: `for (;;)` with no bound; Effect would retry a tagged "changed" error
  with a `Schedule` (80%).
- `ProcessTable.read` (`Process.ts:212-221`) replays every lifecycle stream on every call, inside every
  `ProcessManager` transaction (`:76`); `put` copies a `Map` per event (`processTable.ts:112-113`), so
  the fold is O(n squared). Not measured; a guess that it is fine for Tier 1.
- `processTable.ts:120` throws and `:153` uses `decodeUnknownSync` inside a tea `update`.
- `Records.ts` (462) and `Sink.ts` (385) mix contract, rules and SQL (0095's clearest cases).
- `Sink.ts`: no `span.sampled` check; an interrupt counts as a failure (`:157`); dropped tags go in
  `fab.sink.dropped` (`:41`) where OTLP has `droppedAttributesCount`.
- `settings/Files.ts`: a hand version compare (`:142-147` then, `:158-166` now) where `SemVer` and
  `Schema.SemVerFromString` exist (85%); `SettingsError` lives here. `Declarations.ts:11`'s regex is
  the same case. `Sources.ts:65` has a local named `where`.
- `Mailbox.send(to, id, m, from)` (`:117`) is four positional arguments; `Rev` (`Rev.ts:6`) and
  `ProcessId` (`ProcessId.ts:7`) are unbranded.
- `ProcessManager` takes `nextId` as an argument (`:68-71`) while `ProcessIdGenerator` exists.
- `Process.test-support.ts:160-171`: `mkdtempSync` and `afterAll`, against 0061; `node:sqlite` at `:7`.
- Doubled doc blocks: `processMail.ts:9-14`, `ledgerPages.ts:7-8`, `ledgerTrace.ts:3-4`,
  `measurements.ts:115-116`, `:149-150`, `:162-163`, `:290-293`. 28 plan codes in product comments.
- `measurements.ts:201` uses `new Date`; `RecordPart.ts` is a one-line re-export.
- Docs: 98 of 165 exports (59%, an upper bound: bare `@internal` counts).
- Good: the sink keeps every span where Effect's exporter drops them on a failed send
  (`OtlpExporter.ts:241-245`); idempotency checks the body, not only the id (`ledgerStore.ts:115-120`,
  `ProgramMailLedger.ts:61-70`); `settings/Toml.ts:27` is the one service id with its folder.

### `cloudflare/`, `node/` and `next/apps/fabrika/src` (47 files)

- About 113 error maps dropped their cause (92 in `cloudflare/`, 11 in `node/`, 10 in the app), first
  `runtime.ts:213-215`. `platform.ts`'s 57 wrappers now keep it (PR 924); the rest not rechecked.
- `platform.ts:20-124`: one wrapper and one edge comment per stub method, where Effect wraps once
  (`NodeFileSystem.ts:65-70`). The lint rule's one-comment-per-Promise-line pushes the copy-paste.
- `runtime.ts`: `projectLogic` (`:292-713`) mixes SQL setup, RPC, loading and bootstrap in one
  421-line closure, its type inferred (`:715`, also `:869`, `connection.ts:235-238`); a hand migration
  (`:364-370`); `let active` (`:757`) where a `Ref` says it in the type; `Layer.build` inside a layer
  (`:357`, `connection.ts:18`); an identity `rpc` wrapper (`:131-133`).
- `control.ts`: plain objects as errors (`:56`, `:74`, `:78`, `:88`), `Reflect.apply` dispatch
  (`:101`), and a ternary whose two branches are the same (`:132-136`, still on main).
- `connection.ts`: `Date.now()` (`:97`, still on main); three unmarked `as ConnectionId` casts (`:43`,
  `:60`, `:138`); `Effect.catchCause` turns every failure into `refused` or `unreachable` with no trace
  (`:123`).
- `record.ts:32`, `:42`, `:52`, `:62`: `Effect.fn` with no name. `bindings.ts:45-86`: 40+ methods typed
  by hand with `unknown` errors (the Alchemy port, ticket 502, replaces it).
- `node/dev/dev.ts`: raw `fetch` (`:132`); `let cause` from a callback (`:103`); a `Proxy` faking
  Promise stubs (`:383-401`); an unmarked `process.kill` (`:369`).
- `BrainError` is defined twice with different reasons (`local-dev.ts:4-6`, `local-instance.ts:3-5`).
- `exam/commits.ts`: argv by hand (`:562-573`, `:1013-1033`) where `effect/cli` exists; a hand glob
  (`:170-195`) where `Glob.make` exists, though the two differ on dot names and `{[?`; `JSON.parse` and
  a cast (`:760-769`); a field named `what` (`:382`). A split must keep every file on the exam list.
- `exam/promise-types.ts:298-327`: `try/finally` against 0061, `console.*` at `:317`, `:320`.
  `exam/twin.ts`: one 610-line closure (`:11-622`), `type Tree = any` (`:7`). `exam/plant.ts:33-49`
  hands vitest a Promise. `port.test-support.ts:56` returns a `release` to remember.
- Docs: 17 of 90 library exports; Effect's platform-node-shared plus D1, 86 of 86.
- Good: the build (`build.ts:205-243`, `bundle.ts:57-64`, `runPromiseWith` at the Rolldown edge);
  `local-dev.ts:43-64`'s durable write; `dev.ts:93`'s `Ref` holding a tea machine; `dev.fixture.ts`
  testing through `ChildProcessSpawner.make`.

### Effect's checker, by name

- **The 17 off checks with 0 hits,** which can block today: `abortControllerInEffect`,
  `allOfMapToForEach`, `cryptoRandomUUID`, `cryptoRandomUUIDInEffect`, `effectFnOpportunity`,
  `errorPayloadShadowsName`, `flatMapToTap`, `globalRandom`, `mapConstToAs`, `multipleCatchTag`,
  `optionMatchToFromOption`, `preferBarrelImport` (needs `barrelImportPackages`),
  `promiseInEffectSuccess`, `provideLayerSucceedToProvideService`, `raceFirstWithSleepToTimeout`,
  `serviceNotAsClass`, `unsafeEffectTypeAssertion`.
- **Block after a small sweep** (every sampled hit right, product / tests): `instanceOfSchema` (20/8),
  `globalFetchInEffect` (3/2), `globalDateInEffect` (2/4), `schemaSyncInEffect` (6/31),
  `unnecessaryFailYieldableError` (3/2), `catchToIgnore` (4/0), `catchToOrElseSucceed` (3/0),
  `catchConditionalRefailToCatchIf` (2/0), `effectSucceedWithVoid` (2/0), `flatMapIgnoredParamToAndThen`
  (1/0), `nestedEffectGenYield` (1/0), `preferSucceedSomeOrNone` (1/0), `mapMapErrorToMapBoth` (4/0),
  `runOfExitToRunExit` (0/3), `preferUnsafeConstructor` (0/7), `unnecessaryEffectGen` (0/2),
  `flatMapConditionalToFilterOrFail` (0/2), `deterministicKeys` (40/2, 5 of 42 read). 75% sure.
- **Leave off, 0 or 1 right of 5:** `preferEffectArray` (358/1,640), `unstableApiUsage` (112/1,314),
  `preferEffectString`, `preferEffectRecord`, `newSchemaClass`, `missingPipeableSignature`,
  `strictBooleanExpressions`, `schemaSync` (0050), `schemaClassMissingBrand`, `preferSchemaOverJson`,
  `nodeBuiltinImport`, and the test-only Promise checks.
- **Our rules against theirs:** replace `fabrika/no-data-taggederror` with `preferSchemaTaggedError`
  (90%) and `fabrika/no-raw-try-catch` with `tryCatchInEffectGen` (70%); `fabrika/no-context-tag`
  only gives a clearer message, since 4.1.2 has no `Context.Tag` (75%); keep the rest.
- **The oxlint presets** give the same counts within 1 to 3%; `strict` leaves out 44 checks, among
  them every `global*` check.

## What it cannot tell us

- **No fix was run.** Every "Effect would write" is a reading. `JsonPatch.get` sorts object keys,
  and whether a law pins ours is not checked. Whether `effect/crypto`'s `Signature` takes our
  passkey point form is a one-hour spike nobody ran.
- **Samples are small.** Five hits per check cannot show a 10% false-alarm rate, let alone 0%.
  Before a check blocks, all its hits get counted, as ticket 438 did.
- **The audit's counts are pattern counts.** "About 113 dropped causes" and "about 240 undocumented
  exports" come from regexes. Treat them as sizes, not lists.
- **How Effect's team would cut a file is our reading of their files,** not their words.
- **Not read in full:** `rpc/`, `http/`, `Config.ts`, `ConfigProvider.ts`, `Metric.ts` and most of
  `Sharding.ts`. Claims that rest on them say so in the reads.
- **The tracing cost of a named span on every call** is still not measured. Effect turns tracing off
  inside its journal [e10]; we keep it on by decision.

## Links

- [e1] to [e12]: files under `node_modules/effect/src/` and `@effect/platform-node-shared/src/` at
  the versions above.
- [a1] `node_modules/effect/AGENTS.md`, 4.1.2.
- [a2] [Effect-TS/effect-smol `AGENTS.md`](https://github.com/Effect-TS/effect-smol/blob/main/AGENTS.md).
- [a3] [Effect-TS/effect-smol `.patterns/effect.md`](https://github.com/Effect-TS/effect-smol/blob/main/.patterns/effect.md).
- [a4] `@effect/tsgo` 0.63.0, its `README.md` and `schema.json` in the installed package;
  [Effect-TS/tsgo](https://github.com/Effect-TS/tsgo).
- [m1] [Elm guide, Structuring Web Apps](https://guide.elm-lang.org/webapps/structure.html).
- [m2] [Erlang/OTP design principles](https://www.erlang.org/doc/system/design_principles.html),
  secondary.
