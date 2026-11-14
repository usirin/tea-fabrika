---
state: "decided 2026-11-11"
summary: "`next/`. How Effect's own team would build each file, as eight principles, each with real before and after code: use what Effect and Alchemy ship; a failure keeps its cause, is caught by its tag and is never thrown from pure code; a long body is a `make` with a shelf of named pieces; control state is a saved tea machine; a layer asks for what it needs; public exports are documented and comments say why; imports and ids read like Effect's; a difference from Effect keeps its reason beside it. Each has a kind (lint, law, pattern, taste) and says what holds it. The Alchemy port goes first in the fix order. From experiment 262; the rules are in 0120."
---

# Effect code guidelines

**Decided 2026-11-11.** The owner approved the eight principles, the shape and the smaller calls
below with their leans, after a walk of each part. The leans' confidence numbers stay as written.
The rules are in [0120](../../.decisions/0120-effect-code-guidelines.md).

Decided in the walk itself: the ninth principle of the draft (wrap a platform once) is folded into
E1, and the Alchemy port goes first in the fix order; doc comments carry no `@since` yet
([0118](../../.decisions/0118-no-since-tag-before-a-release.md)); an error's reason is a tagged
error ([0119](../../.decisions/0119-an-errors-reason-is-a-tagged-error.md)).

Built from [experiment 262](../../experiments/262-effects-team-as-the-builder.md): four reads of
every `next/` file beside Effect 4.1.2's source, and one run of Effect's own checker,
`@effect/tsgo` 0.63.0. Neither is a measurement of how the code behaves. There is no Design canvas:
this study is about code, so the guidelines skill's design steps do not apply. The experiment
numbers nine principles; its E7, E8 and E9 are E6, E7 and E8 here.

The question every plan and review in `next/` asks
([0114](../../.decisions/0114-effects-team-as-the-builder.md)): **how would Effect's team write
this file if they were building fabrika?**

Every "before" block is real code, at commit `5eb5fd0ee`, with its path. Every "after" block is a
sketch. No fix has run.

```ts
// A sketch, not built: the runner after all eight.

// runtime/Runner.ts: the contract only (E5). Documented (E6). Id with its folder (E7).
/**
 * Runs one program's process: its turns, its Cmds and its recovery.
 *
 * @stability unstable
 * @category services
 */
export class ProgramRunner extends Context.Service<ProgramRunner, {
  readonly open: (client: string) => Effect.Effect<Opened, RunnerFailure>;
  readonly msg: (input: unknown) => Effect.Effect<Sent, RunnerFailure>;
  readonly due: (at: number) => Effect.Effect<void, RunnerFailure>;
  readonly restart: (request: Restart) => Effect.Effect<void, RunnerFailure>;
}>()("@kampus/libfabrika/runtime/ProgramRunner") {}

// runtime/RunnerLive.ts: a `make`, a shelf of named pieces (E3), and a one-line layer (E5).
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const make = Effect.fnUntraced(function* (initial: Descriptor, options: RunnerOptions) {
  const recovery = yield* RecoveryStore; // asked for, no longer built here (was :218-221)
  const replies = yield* Replies;
  const holder = yield* Holder.make(initial); // the nine lets, one saved machine (E4)

  // --- Turns ---
  const turns = Turns.make({ holder, recovery, options }); // runtime/internal/turn.ts

  // --- Cmds ---
  const dispatch = Dispatch.make({ holder, replies }); // runtime/internal/dispatch.ts

  return ProgramRunner.of({ open: turns.open, msg: turns.msg, due: turns.due, restart: turns.restart });
});

export const layer = (initial: Descriptor, options: RunnerOptions) =>
  Layer.effect(ProgramRunner, make(initial, options));
```

One `msg` call whose write is refused, step by step:

```text
1. The runner's msg takes the permit and asks Turns to accept the input.
2. Turns steps the program purely and saves "about to append" by sending the holder machine a Msg.
3. Dispatch runs the write Cmd. The signer fails with SigningRefused.
4. catchTags matches the tag. The Cmd's answer is a failed Result, saved as a letter.
5. A storage failure would not match: it keeps its cause and leaves the Cmd dispatched.
```

## Which version

- **`next/`:** all of it, in `next/packages/*` (libraries, the full rules) and `next/apps/*` (the
  app, where 0023 lets imports use the barrel and asks no doc comments).
- **Today's version:** not touched.

## The shape

No new stored types or fields. One shape changes in code: an error's `reason`
([0119](../../.decisions/0119-an-errors-reason-is-a-tagged-error.md)).

## The eight principles

The count comes from the findings. Each principle has a **kind**, picked in this order: a check
Effect ships, then a lint rule of ours, then a pattern doc agents copy, and prose only for
judgment. Hit counts are from experiment 262's checker run.

### E1: use what Effect and Alchemy ship before writing your own

**Lean, 85%.** Kind: **lint**, then **taste**.

Before, `runtime/Runner.ts:1747` and `runtime/Patch.ts:16-30`:

```ts
const hasParent = (m: unknown): boolean => typeof m === "object" && m !== null && "parent" in m;

// Patch.ts: 83 lines of hand-written JSON diff
const isPlain = (u: unknown): u is Plain => typeof u === "object" && u !== null && !Array.isArray(u);
const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((one, i) => same(one, b[i]));
  }
  // ...then a `walk` that builds the patch
};
```

After:

```ts
import * as JsonPatch from "effect/JsonPatch";
import * as Predicate from "effect/Predicate";

const hasParent = Predicate.hasProperty("parent"); // not checked against 4.1.2

const patch = JsonPatch.get(before, after); // Patch.ts and its test are deleted
```

The same rule for the platform. Before, `cloudflare/platform.ts:18-25`, 57 of these:

```ts
clientConnect: () =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: Project clientConnect RPC enters Effect
  Effect.tryPromise({ try: () => stub.clientConnect(), catch: unreachable }),
```

After, as one of our four objects already does, `cloudflare/runtime.ts:127`:

```ts
export const recordStub = (env: Env, project: string, name: string) =>
  makeRpcStub<RecordShape>(env.RECORD.getByName(JSON.stringify([project, name])), { errors: [SinkError] });
```

- **Why.** Effect's guide: "**NEVER** write your own helper functions like `isRecord` or
  `isString`" (`node_modules/effect/AGENTS.md:321`). kamp-us/phoenix writes every Durable Object
  with Effect-returning methods and calls it through Alchemy's stub
  ([its pattern doc](https://github.com/kamp-us/phoenix/blob/main/.patterns/alchemy-durable-objects.md)).
- **Effect's team as the builder.** They would delete `Patch.ts` for `JsonPatch.get`
  (`effect/src/JsonPatch.ts:184`) and move the 7 hand WebCrypto edges to `effect/crypto`.
- **Elm or OTP.** OTP reaches for its standard library (`crypto`, `gen_*`) before a hand module.
- **New in Effect 4, so agents do not know them:** `effect/crypto` (`Digest`, `Mac`, `Signature`,
  `SecureRandom`), `JsonPatch`, `SemVer`, `Glob`. The pattern doc names them.
- **The Alchemy port.** `cloudflare/objects.ts` defines the four classes Alchemy's way already.
  `Project`, `Process` and `Connection` are still called through the hand-typed Promise shapes of
  `cloudflare/bindings.ts`: the unfinished half of
  [0041](../../.decisions/0041-object-classes-are-effect-objects.md) (ticket 502). The stub's type
  says a call cannot fail, and at run time it can, so each call is still wrapped once at the
  caller, with the cause kept.
- **What is left for a hand wrapper.** An edge neither Alchemy nor Effect covers, such as the Node
  SQLite driver: wrapped once, cause kept.
- **What holds it.** Shipped checks at `error`: `globalFetchInEffect`, `globalDateInEffect`,
  `globalRandom`, `cryptoRandomUUID` and three more. Ours, new: `fabrika/no-hand-guard` (11 sites)
  and `fabrika/no-raw-crypto` (7 files). The plan names the nearest Effect module (0114).
- **The doubt.** `JsonPatch.get` sorts keys, and a law may pin our order. `Signature` may not take
  our passkey point. Not checked that all 57 calls fit the stub's `errors` option.
- **Cost.** About 20 files and 300 lines, plus the port: `platform.ts` and `bindings.ts` go, about
  400 lines.
- **Today's example.** `Runner.ts` breaks it at `:1747`, `:1763-1766`, `:145-149`, `:1344-1348`. It
  follows it for time and locks (`:235`, `:242`).

### E2: a failure is a typed value

**Lean, 90% for the cause; 85% for the tag; 75% for "pure code never throws".** Kind: **lint** and
a **pattern** that exists (`effect-errors-keep-their-cause.md`).

Before, `cloudflare/platform.ts:12` and `runtime/Runner.ts:1182-1191`:

```ts
// the cause is thrown away: about 113 places
const unreachable = () => new LedgerError({ reason: "unreachable" });
Effect.tryPromise({ try: () => stub.clientConnect(), catch: unreachable });

// caught by instanceof: 20 places
const answer = yield* attempt.pipe(
  Effect.map((placed): Result.Result<Appended, string> => Result.succeed(placed)),
  Effect.catchIf(
    (e): e is SigningRefused | NotGranted => e instanceof SigningRefused || e instanceof NotGranted,
    (e) =>
      Effect.succeed<Result.Result<Appended, string>>(
        Result.fail(e instanceof SigningRefused ? e.reason : "not_granted"),
      ),
  ),
);
```

After:

```ts
// the cause rides along, inside a tagged reason (0119)
catch: (cause) => new LedgerError({ reason: new Unreachable({ cause }) }),

// caught by tag
const answer = yield* attempt.pipe(
  Effect.map(Result.succeed),
  Effect.catchTags({
    SigningRefused: (e) => Effect.succeed(Result.fail(e.reason)),
    NotGranted: () => Effect.succeed(Result.fail("not_granted")),
  }),
);
```

Turning a failure into a `Result` is right only where the answer is saved or sent. This is one such
place: the Cmd's answer is stored as a letter. Everywhere else a failure stays in the error
channel. Effect does the same at its own edges: `Effect.result` (`effect/src/Effect.ts:3826`),
`Reply.WithExit` (`effect/src/cluster/Reply.ts:320`), and `Schema.Exit` in `workflow/Activity.ts`.

- **Why.** Effect's errors keep the cause: `cause: Schema.Defect()`
  (`effect/src/sql/SqlError.ts:20`). Their cluster code has 0 `instanceof`.
- **Effect's team as the builder.** `LedgerError` stops being borrowed for crypto and control
  failures; each service gets its own, as
  [0055](../../.decisions/0055-errors-named-by-their-service.md) says.
- **Elm or OTP.** Elm: `Result` with a custom error, no exceptions. OTP: an exit reason is a term
  the supervisor reads.
- **What holds it.** Shipped `instanceOfSchema` at `error` after a sweep of 20 sites. Ours, new:
  `fabrika/keep-cause`, on a `catch:` or `mapError` callback that ignores its argument, and a
  `Cause.squash` ban outside an edge. A domain function's refusals are properties over its `Result`.
- **The doubt.** Whether every `throw` in `Program.ts` can become a `Result` without a wider
  change.
- **Cost.** About 30 files and 250 lines, mostly one-line edits. The port (E1) removes 92 of the
  113 cause drops.
- **Today's example.** `Runner.ts` breaks it at `:1182-1191`, `:751-769`, `:1536`, `:1169`. It
  follows it with `RunnerError` as a `TaggedError` (`:1738`).

### E3: a long body is a `make` with a shelf of named pieces

**Lean, 80%.** The split is decided (0043 rule 9), and the written service type is decided (0095).
Kind: **pattern** (new), **lint** for the type, **taste** for the cut.

Before, `runtime/Runner.ts:213-240`, the top of one closure that ends at `:1733`:

```ts
Effect.gen(function* () {
  const rootStore = yield* ProcessStore;
  let store = rootStore;
  let process = initial;
  let supervision: Supervision | null = null;
  let woke = false;
  let drained: ReadonlyArray<Dispatched> = [];
  let mailRetry: number | null = null;
  let live: Live | null = null;
  let alarmAt: number | null | undefined;
  let retry: ReadonlyArray<Dispatched> = [];
  // ...1,500 more lines, one section marker
```

After: the sketch that opens this note. A `make`, `// --- X ---` sections, each hard part in
`internal/` taking its services as arguments, and a one-line `layer`.

- **Why.** Length is not the problem. Effect's `cluster/Sharding.ts` is `const make =
  Effect.gen(...)` from `:242`, cut by ten sections, and ends with `Layer.effect(Sharding)(make)`
  at `:2236`.
- **Effect's team as the builder.** `Runner.ts` (1,766 lines), `gateway/Gateway.ts` (1,661) and
  `cloudflare/runtime.ts` (874) are split move-only first.
- **Elm or OTP.** OTP's `gen_server` is a shelf of named callbacks. Elm warns against splitting
  early, so the cut follows the machines and jobs, never a line count.
- **What holds it.** The pattern doc and review. Ours, new: `fabrika/written-service-type`, on a
  service whose shape uses `ReturnType`, `Effect.Success` or `typeof` (4 sites). No line-count
  rule: no source gives a number.
- **The doubt.** The nine `let`s are shared by every piece, so a clean cut needs E4's holder
  machine in the same series.
- **Cost.** About 4,300 lines moved into about 30 files, none rewritten.
- **Today's example.** `Runner.ts` breaks it: one closure, one marker (`:1086`). It follows it with
  a written service type (`:177-188`).

### E4: control state is a saved tea machine

**Decided 2026-11-09** ([0037](../../.decisions/0037-implicit-state-machines-made-explicit.md),
[0046](../../.decisions/0046-one-tea-machine-per-file.md)). Applied here. Kind: **law** and
**review**, with the lint rule of ticket 509.

Before, `runtime/Runner.ts:237` and `:371`:

```ts
// three meanings in one variable: a time, "no alarm", and "not loaded yet"
let alarmAt: number | null | undefined;

// the recovery record edited by hand, 15 times
yield* saveRecovery({ ...s, pending: { ...action, type: "exit" } });
```

After. The good version is already ours, `runtime/internal/supervisor.ts:73`:

```ts
export const supervisor = Machine.make({
  model: Supervision,
  msg: Msg,
  cmds: [exit, down, start],
  // init and update: one handler per Msg, each returns the next state
});

// and a caller sends a Msg; it never spreads the record (sketch)
yield* holder.send({ type: "exited", action });
```

- **Why.** Effect's own `entityManager.ts:105-123` tracks a request with five loose flags. That is
  the hidden machine 0037 rules out, so here ours is stricter on purpose. A plain `let` under one
  permit stays fine for data.
- **Elm or OTP.** Elm's `update`; OTP's `gen_statem`.
- **What holds it.** tea's `propertyInvariant` and `propertyTerminates` per machine; ticket 509's
  rule.
- **Cost.** The runner's holder machine, the 15 hand spreads (P34c) and the gateway's
  `EnvelopeState` spreads. About 5 files and 500 lines, sized by experiment 246.
- **Today's example.** Half: the supervisor follows it; `alarmAt` and the spreads break it.

### E5: a service file is its contract, and a layer asks for what it needs

**Decided 2026-11-11** ([0095](../../.decisions/0095-a-service-file-holds-only-its-contract.md))
for the contract file and sibling layers. **Lean, 85%** for "never built inside". Kind: **lint** and
a **pattern** that exists (`effect-services-and-layers.md`).

Before, `runtime/Runner.ts:188-200` and `:218-221`:

```ts
>()("@kampus/libfabrika/ProgramRunner") {
  // the layer lives on the service class
  static readonly layer = (initial: Descriptor, options: RunnerOptions): Layer.Layer</* ... */> =>
    Layer.unwrap(Effect.map(ProgramLoader, (loader) => ProgramRunner.withLoader(initial, loader, options)));
}

// and inside the body, the layer builds two of its own dependencies
const recovery = yield* RecoveryStore.pipe(
  Effect.provide(RecoveryStore.layer(options.recovery.sql, options.recovery)),
);
```

After:

```ts
// runtime/RunnerLive.ts: the body asks
const recovery = yield* RecoveryStore;
const replies = yield* Replies;

// whoever starts the runner picks the storage
RunnerLive.layer(initial, options).pipe(
  Layer.provide(RecoveryStoreSql.layer(sql)),
  Layer.provide(RepliesSql.layer(sql)),
);
```

- **Why.** `entityManager.make` takes its storage in its options (`entityManager.ts:143`), and the
  caller picks it.
- **An agent that knows older Effect** is most at risk here: Effect's own guide teaches a static
  layer (`AGENTS.md:146`), and Effect 3 taught `Effect.Service` with `dependencies`. Only a rule
  stops it.
- **Elm or OTP.** OTP's child specs list what a supervisor starts, in order.
- **What holds it.** `fabrika/no-static-layer`, owed by 0095. Shipped `strictEffectProvide` only
  advises (3 of 5 sampled hits right).
- **Cost.** 24 static layers on 19 classes, each a new sibling file. About 40 files and 600 lines,
  mostly moved.
- **Today's example.** `Runner.ts` breaks it at `:190`, `:200`, `:218-221`, `:1174`. It follows it
  by listing its requirements in the layer's type (`:196`).

### E6: a public export has a doc, and a comment says why

**Decided 2026-11-09** ([0023](../../.decisions/0023-next-follows-effects-code-style.md)) for docs.
**Lean, 80%** for "no plan codes, no history, one doc block per export". Kind: **lint**, then
**taste**.

Before, `runtime/Patch.ts:1-2` and `runtime/Runner.ts:1737`:

```ts
// View patches, next/: the RFC 6902 operations that turn one JSON view into the next (Tier 1, P11,
// law p22). A watcher gets the whole view once, then a patch per step.

/** A delivery that does not have P10's shape. */
export class RunnerError extends Schema.TaggedError<RunnerError>()("RunnerError", {
```

After (the two meanings are a sketch, to be checked against the code):

```ts
/**
 * The runner refused an input before the program saw it.
 *
 * @stability unstable
 * @category errors
 */
export class RunnerError extends Schema.TaggedError<RunnerError>()("RunnerError", {
```

- **Why.** Effect documents 366 of 366 public exports in `cluster/`; ours are at 33% to 59% by
  module. A plan code means nothing in a year, and Effect cites no ticket in source.
- **A good one of ours,** `Runner.ts:1181`: "A refusal is the Cmd's answer; a storage failure is
  not, so the Cmd stays dispatched." A why, at the line it guards.
- **Elm or OTP.** OTP 27's `-doc` attributes and Elm's documented packages (both secondary).
- **What holds it.** A copy of Effect's docs lint rule, without `@since` (0118): 0023 ran it with 0
  false alarms on Effect's 144 modules. Ours, new: a plan-code rule on comments (`P\d+`,
  `law p\d+`, `flag \d+`), once its false alarms are counted.
- **Cost.** About 240 exports with no doc block (an upper bound) and about 28 plan codes. About 60
  files and 2,000 lines of comments.
- **Today's example.** Half: a fine why at `:1181`, a plan code at `:1`, a stale doc at `:1737`.

### E7: imports and service ids read like Effect's

**Decided 2026-11-09** (0023's import row). **Lean, 70%** for the id with its folder. Kind:
**lint**, shipped.

Before, `runtime/Runner.ts:7-20` and `:188`:

```ts
import {
  Cause,
  Clock,
  Context,
  // ...ten more
} from "effect";

>()("@kampus/libfabrika/ProgramRunner") {
```

After:

```ts
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";

>()("@kampus/libfabrika/runtime/ProgramRunner") {}
```

- **Why.** Effect's guide asks for "the package name and the subdirectory path" in the id
  (`AGENTS.md:142`), as `"effect/cluster/Snowflake/Generator"`.
- **Elm or OTP.** No answer: names follow the host library.
- **What holds it.** Shipped `preferNamespaceImport`, scoped to `next/packages/**` (441 hits), and
  `deterministicKeys` (40 hits). Each after its sweep, then `error`.
- **The doubt.** Whether `deterministicKeys` would rename an error identifier that is saved or
  sent. Check before the sweep.
- **Cost.** About 170 import lines and 40 ids, mechanical.
- **Today's example.** `Runner.ts` breaks it at `:7-20` and `:188`.

### E8: where we differ from Effect, the file says why

**Decided 2026-11-09** as a rule (0023, 0114). **Lean, 85%** for the keep list. Kind: **taste**.

A good one, `gateway/GatewayNonce.ts:6`:

```ts
// SYN cookies keep an unproved connection out of storage (RFC 4987, section 3.6).
export const gatewayNonce = Effect.fn("gateway.nonce")(function* (
```

A missing one, as it would read on `runtime/internal/supervisor.ts`:

```ts
// Not a Schedule: a Schedule cannot be saved, and this backoff must survive a sleeping object (0046).
export const supervisor = Machine.make({
```

| We do | Effect does | Why we keep ours |
|---|---|---|
| Contract-only service files (0095) | contract and layers in one file | one platform's bundle holds no other's code |
| The supervisor as a saved tea machine (0046) | a `Schedule` | a `Schedule` cannot be saved |
| Every span written to SQLite (`telemetry/Sink.ts:282`) | an in-memory buffer | a sleeping object loses the buffer |
| A stateless signed nonce | the challenge kept in memory | the same |
| Synchronous SQL and ledger steps (0050) | an async transaction | nothing runs between the number and the write |
| A named `Effect.fn` span on every export | `fnUntraced` in library code | we want the trace; its run-time cost is not measured |

- **Why.** Effect explains its own choices in place: "D1 batches execute on the binding directly
  and intentionally cannot participate in SqlClient transactions"
  (`@effect/sql-d1/src/D1Client.ts:184`).
- **Elm or OTP.** [Where we follow OTP](./follows/otp.md) does the same for OTP.
- **What holds it.** Review, with the plan's "nearest Effect module" line (0114).
- **Cost.** About 8 one-line reasons.
- **Today's example.** Half: `Runner.ts:1-5` says what a turn does, not why it is not Effect's
  `entityManager`.

## Smaller calls

- **Two of our rules give way to Effect's** ([0040](../../.decisions/0040-existing-tools-before-hand-written.md)).
  **Lean, 75%.** `fabrika/no-data-taggederror` to `preferSchemaTaggedError`, and
  `fabrika/no-raw-try-catch` to `tryCatchInEffectGen`. We lose the try/catch advice outside
  generators.
- **Nine shipped checks stay off.** **Lean, 80%.** `preferEffectArray`, `preferEffectString`,
  `preferEffectRecord`, `newSchemaClass`, `unstableApiUsage`, `missingPipeableSignature`,
  `strictBooleanExpressions`, `schemaSync`, `schemaClassMissingBrand`: 0 or 1 of 5 sampled hits was
  right, and `schemaSync` would flag 0050's synchronous steps.
- **An error's reason is a tagged error.** Decided 2026-11-11 (0119).
- **The gateway's dispatch** stays the open 72% call in experiment 174. E3's cut makes either
  answer easy.

## What the ledger records

Nothing new. A saved or sent error changes its encoded form with 0119, so any stored error is
checked before its sweep.

## A tryout in today's version

None. The note is about `next/` only.

## The fix order

1. Turn on the shipped checks that have 0 hits. Done for 16 of them in pull request 958.
2. Write the pattern docs: `effect-long-body-is-a-shelf.md`, `effect-crypto-through-services.md`,
   `effect-pure-domain-returns-result.md`, `effect-differences-say-why.md`, and extend the four
   that exist (errors, services and layers, sleeping objects, doc comments).
3. Add our small rules, each with its sweep in the same pull request: `written-service-type` (4
   sites), the `Cause.squash` ban (2), `no-raw-crypto` (11), `no-hand-guard` (11).
4. **The Alchemy port (0041, ticket 502), first of the old-code work** (owner, 2026-11-11).
5. The sweeps, smallest first, each turning its check to `error` when it lands: the small shipped
   checks (about 125 hits), `keep-cause` with the tagged reasons, `no-static-layer` (24),
   `deterministicKeys` (40), docs (about 240 exports), imports (441).
6. The move-only splits of `Runner.ts`, `Gateway.ts` and `cloudflare/runtime.ts`, then the holder
   and envelope machines.

**Lean, 80%** on the order. The import and docs sweeps touch every file, so they do not run beside
the splits.

## Where this differs from settled notes

- **[Build on Effect; let types be inferred](./build-on-effect.md)** says "Types are inferred, not
  written by hand." 0095 says a service's type is written out. The later record wins for service
  types; that note is not yet marked amended.
- **Effect's own `AGENTS.md`** teaches a static layer; 0095 records why we differ.

## What it costs

| Principle | Files | Lines |
|---|---|---|
| E1 use what ships, and the port | about 22 | about 300, and about 400 removed |
| E2 typed failures | about 30 | about 250 |
| E3 the shelf | 4, into about 30 | about 4,300 moved |
| E4 saved machines | about 5 | about 500 |
| E5 layers as siblings | about 40 | about 600, mostly moved |
| E6 docs | about 60 | about 2,000 of comments |
| E7 imports and ids | most library files | about 170 import lines, 40 ids |
| E8 reasons | about 8 | 8 |

Sized in files and lines, not time. The counts come from regexes: sizes, not lists.

## What it cannot tell us

- No fix ran. Each "after" is a reading of Effect's files, not their words.
- The checker's samples are five hits per check; a check that blocks needs all its hits counted
  first.
- Three small tries nobody ran: `JsonPatch.get`'s key order, `Signature`'s point form, and whether
  Alchemy's stub takes all 57 calls.
- What a named span on every call costs at run time.
- How many existing errors 0119 changes, and whether any is stored.
