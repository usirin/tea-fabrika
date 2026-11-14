
Plancheck-Version: 3

# Plan: `runtime/`, `access/` and `gateway/` stop importing `ledger/`, and the list of old breaks reaches zero

Everything here is about `next/` (`next/packages/libfabrika/src`) and the repo's lint config.
Today's version is not changed. Nothing is built yet. Read on `origin/main` at `48460bdaa`.

```ts
// before: access/ClientManager.ts, two layers above the ledger, names the ledger's own error.
// Lint lets it pass because the line is written down in next-ledger.json.
import type { LedgerError } from "../ledger/Ledger.ts";
readonly members: Effect.Effect<Access, LedgerError>;

// after: the service fails with its own error, and the ledger's fault rides inside it as `cause`.
import { ClientManagerError } from "./ClientManager.ts"; // its own file, shown from a caller
readonly members: Effect.Effect<Access, ClientManagerError>;
```

That is the whole idea, 71 times: a module speaks in its own words, the module below it does the
same, and the row in `next-ledger.json` is deleted in the same pull request.

## The answer first

- **Can the debt be paid from what is already decided? Yes for 35 of the 71 lines, and yes in kind
  for the other 36, with one open question about a name and a shape.**
- **Decided, no question** (slices 1 to 3, and the test rule for all of it): a store that has a
  fault of its own gets an error named after its service
  ([0055](../../.decisions/0055-errors-named-by-their-service.md)), with tagged reasons
  ([0119](../../.decisions/0119-an-errors-reason-is-a-tagged-error.md)); `processes/` answers in
  its own words; a test that needs a real database is a suite that `node/` runs
  ([0062](../../.decisions/0062-test-files-keep-the-floors.md)).
- **Decided in kind, open in shape** (slices 4 to 7): 11 product lines read or write a ledger
  stream directly. [0043](../../.decisions/0043-rooms-on-floors.md) says who fixes that: the
  module between adds a service, and that service names none of the ledger's types. It names
  `processes/` for the runtime's case. It does not say what the service is called or how wide it
  is. That is open question 1.
- **Seven slices.** Slices 1, 2 and 3 can start today. Slices 4 to 7 wait on question 1.
- **The list is not the whole debt.** The same names also reach the three modules by two routes
  lint does not count: the `coordination/index.ts` file, which passes `LedgerError` and `Appended`
  on, and `processes/`' own services, which still fail with `LedgerError`. A slice that only
  rewrote an import to one of those routes would empty the list and fix nothing. Slices 2 and 3
  close both routes first.
- **The other 13 entries,** all `vitest(no-hooks)`, are out of scope: they are 0061's work.

## How the counts were made

Every number here is from a command run on 2026-11-13 in one checkout at `48460bdaa`, with
`nice -n 19 rg` or a short Python read of `next-ledger.json`. No test, lint or type check ran.

- **The list.** `next-ledger.json` holds 84 entries: 71 `eslint(no-restricted-imports)` and 13
  `vitest(no-hooks)` (a count by `rule`). All 71 import a file of `ledger/`. The brief said 69;
  the file says 71.
- **The tree agrees.** `rg -n 'from "\.\./(\.\./)?ledger/' runtime access gateway` finds 71
  lines in 24 files, the same files and counts as the list.
- **By module:** access 9 product and 16 test, gateway 5 and 6, runtime 3 and 32. That is 17
  product lines in 9 files and 54 test lines in 15 files.
- **By the ledger file imported:** product: `Ledger.ts` 9, `Log.ts` 6, `LedgerTransaction.ts` 2.
  Tests: `Ledger.ts` 15, `NodeSqlite.ts` 10, `Log.ts` 10, `LedgerSql.ts` 9,
  `LedgerTransactionSql.ts` 6, `LedgerTransaction.ts` 2, `Referee.ts` 1, `RefereeSql.ts` 1.
- **The routes lint does not count.** `rg -c LedgerError` per folder, product files outside
  `ledger/`: processes 25 in 7 files, presence 7 in 1, jobs 2 in 1, access 17 in 4, runtime 56
  in 4, gateway 36 in 3, cloudflare 85 in 5, apps 2 in 1. That is 230 mentions in 26 files. In
  tests and suites: 211 mentions in 38 files. `runtime/Runner.ts` builds 17 `LedgerError`s and
  `gateway/Gateway.ts` builds 21 (`rg -c "new LedgerError"`).
- **The pass-through file.** 21 files import `coordination/index.ts`; 3 of them take
  `LedgerError` or `Appended` through it: `runtime/Runner.ts`, `runtime/Entry.ts` and
  `runtime/RecoveryJournalTest.ts`.
- **The 15 test files** hold 13,642 lines (`wc -l`).

## How others do it

- **Strict layers have a known price.** In a strict layered design a layer uses only the one
  below, so the middle layer must offer what the top needs. Ousterhout calls a method that only
  passes a call on a red flag, and says each layer should offer a different abstraction (A
  Philosophy of Software Design, chapter 7; not fetched for this plan, cited from memory). The
  owner picked strict on 2026-11-10 (0043's amendments). So the service the middle module adds
  must say more than the ledger does, or it is the red flag. The lean below gives it one job the
  ledger does not have: the rule for who may write what.
- **Effect names an error by its service and keeps the cause.** `node_modules/effect/AGENTS.md`
  (`effect@4.1.2`, "Services" and "Creating and handling errors with reasons"): `DatabaseError`
  with `cause: Schema.Defect()`, and a tagged `reason`. 0055 and 0119 follow it.
- **Effect writes laws as a suite in the lower package and runs them from the platform
  package.** 0062 cites `SqlEventLogServerUnencryptedStorageTest.ts` in effect-smol. We do the
  same already, see [the test lines](#the-test-lines).
- **OTP has no such rule.** An OTP application may call any application it depends on. Rule 11
  is ours, by the owner's ruling, and this plan follows the ruling.
- **EventStoreDB** names the two calls on a named stream `appendToStream` and `readStream`, with
  an expected revision. The glossary's `entry` row already follows its fields. Not fetched today.

## What is decided, in one place

Read whole for this plan: 0043 with its amendments, 0055, 0062,
[0091](../../.decisions/0091-modules-and-layers.md), 0119 and
[0168](../../.decisions/0168-old-lint-breaks-are-fixed.md).

- **Rule 11 and its 2026-11-10 answer:** `runtime/`, `gateway/` and `access/` import no
  `ledger/` file, with no exemption. Where a module needs something from two layers down, the
  layer between adds a service for it, and that service names none of the lower module's types.
- **Rule 12:** a service's signatures use only its module's own types and errors, plus the
  shared names. A lower error is translated at the service, with the original kept as `cause`.
  No module builds another module's error.
- **Rule 13:** plain values several modules need are shared names beside `Id.ts`. `Line`,
  `Entry`, `Appended`, `LedgerError` and the ledger's services stay the ledger's own.
- **0055:** a service `X` fails with `XError`. `Mailbox` fails with `MailboxError` and
  `ProcessManager` with `ProcessManagerError`. A store that used `LedgerError` for its own
  SQLite faults gets the error of the service it serves.
- **0119:** an error's `reason` is a tagged error of its own with a `cause`.
- **0043, on the runtime's store:** `ProcessStore`'s ledger call is cut in the step that gives
  `processes/` a function for it.
- **0062:** test files keep the layers. Laws that need a real database are a suite beside the
  module, and the module that owns the driver runs it.
- **0168:** the list goes to zero, no row is added, and a slice deletes exactly the rows it fixed.

None of 0055's errors is built yet: `processes/Mailbox.ts` still fails with `LedgerError` and
answers the ledger's `Appended`. The glossary rows for `MailboxError` and `ProcessManagerError`
say so.

## The 17 product lines, one by one

Paths are under `next/packages/libfabrika/src/`. Line numbers are on main today.

| Where | Takes | Group | Reaches it instead through |
|---|---|---|---|
| `access/SessionManager.ts:2` | `LedgerError`, built once for its own SQLite faults and named in 5 signatures | A | its own `SessionManagerError` |
| `access/SessionManager.ts:3` | the type `InputId` | B | `../Id.ts`, where it lives: `ledger/Log.ts:14` only passes it on |
| `gateway/GatewayStore.ts:2` | `LedgerError`, built 2 times for its own faults | A | `GatewayError`, the error of the service it serves |
| `gateway/GatewayNonce.ts:3` | `LedgerError`, built 4 times for its own faults | A | `GatewayError` |
| `runtime/RecoveryStore.ts:8` | `LedgerError`, built 5 times and named in 4 signatures | A | its own `RecoveryStoreError` |
| `runtime/ProcessStore.ts:9` | the `Ledger` service, and `LedgerError`, built 4 times | A and C | `ProcessStoreError`, and the stream service of `processes/` |
| `runtime/ProcessStore.ts:10` | the function `lineFor`, to write one runtime record | C | the stream service takes the record and the stamp |
| `access/ClientManager.ts:2` | the type `LedgerError`, in 2 signatures | A | its own `ClientManagerError` |
| `access/ClientManager.ts:3` | the schema `Appended`, for its refusal reasons | C | the stream service's own answer |
| `access/ClientManagerLedger.ts:2` | the `Ledger` service, and `LedgerError`, built 2 times | A and C | `ClientManagerError`, and the stream service |
| `access/ClientManagerLedger.ts:3` | the type `Entry`, and `fromHere`, `lineFor`, `valueFor` | C | the stream service's own row and stamp |
| `access/Authorization.ts:2` | `LedgerError`, built once for a bad row | A | an error of its own, see slice 6 |
| `access/Authorization.ts:3` | the `LedgerTransaction` service: one read and one append in one turn | C | the stream service's guarded append |
| `access/Authorization.ts:4` | `Appended`, the type `Line`, `valueFor` | C | the stream service's own answer, stamp and row |
| `gateway/Gateway.ts:24` | the `Ledger` service, and `LedgerError`, built 21 times | A and C | `GatewayError`, and the stream service |
| `gateway/Gateway.ts:25` | the `LedgerTransaction` service, handed on to `appendAdmitted` | C | gone: access's function asks for the stream service itself |
| `gateway/Gateway.ts:26` | `fromHere`, the schema `Line`, `lineFor`, `PAGE`, `valueFor` | C | the stream service; `Line.fields` becomes `From.fields`; `PAGE` becomes a shared name |

### Group A: a fault of its own, named with the ledger's error (10 of the lines)

Decided by 0055 and 0119. Each service gets `<Service>Error` with tagged reasons, and every
place that builds it passes the cause on. `GatewayStore.ts` and `GatewayNonce.ts` are helper
files of the `Gateway` service, so both use `GatewayError`. Nothing here is a question.

### Group B: a shared name read from the wrong file (1 line)

`InputId` is `Id.ts`'s. One import path changes.

### Group C: a ledger stream read or written directly (11 of the lines, 5 shared with A)

Decided in kind by 0043: the module between adds a service. What these lines do today:

- **Append one tagged event to a named stream, with the writer's stamp.** `ProcessStore.record`
  (a runtime record, to the process's stream), `ClientManagerLedger` (a member event, to
  `gateway/access`), and the gateway (a recorded input, to `gateway/inputs`, and a client's own
  write).
- **Read a stream from a rev.** `ClientManagerLedger` and the gateway read `gateway/access`. The
  gateway also reads `gateway/inputs`, one inbox, and any stream for the wire's `ledger.read`
  and `ledger.wait`.
- **Read one stream and append in the same turn.** `Authorization.appendAdmitted`: fold
  `gateway/access`, and place the client's write only if its key is still admitted.

One fix covers all three modules, because the gateway may import `processes/` (it does today,
at `gateway/Gateway.ts:27-29`). The fix is one small service in `processes/`. Its shape is in
[The shape](#the-shape), and its name and width are open question 1.

**Two branches that were looked at and not taken:**

- **Move `access/` down to layer 3,** so the ledger is one layer below it. `access/` imports
  only two things from `processes/` today: the type `From`, and three id checks in
  `SessionManager.ts:4`. But this undoes the owner's 2026-11-10 answer, which names `access/`.
  Not taken.
- **Hand the ledger in from above:** leave the files as they are and pass `Ledger` in as an
  argument or through `coordination/index.ts`. Lint would pass. It is the same break in another
  spelling, and law 2 below is there to refuse it.

## The shape

### The errors (slices 1 to 3, decided)

```ts
// access/SessionManager.ts, the same shape for each service below. 0119's form, as
// processes/ProcessHistory.ts and runtime/Watchers.ts already have it on main.
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

export class SessionManagerError extends Schema.TaggedError<SessionManagerError>()("SessionManagerError", {
  reason: Schema.Union([Storage, BadRow]),
}) {}
```

| Service | Its error | Reasons, picked here as 0055 leaves them to the plan |
|---|---|---|
| `SessionManager` | `SessionManagerError` | `Storage`, `BadRow`, `Membership` (the membership check failed below) |
| `RecoveryStore` | `RecoveryStoreError` | `Storage`, `BadRow` |
| `Gateway` | `GatewayError` | `Storage`, `BadRow`, `Crypto`, `Refused`, `Unreachable` |
| `Mailbox` | `MailboxError` (0055) | `Unreachable`, `BadRow`, `Storage` |
| `ProcessManager` | `ProcessManagerError` (0055) | `Unreachable`, `BadRow`, `Storage` |
| `Connections` | `ConnectionsError` | `Unreachable`, `BadRow`, `Storage` |
| `Runner` | `RunnerError`, which exists | adds `BadRow`, `Storage`, `Refused`, `Unreachable` beside `bad_input` and `bad_client`, all as tagged reasons |
| `ProcessStore` | `ProcessStoreError` | `Storage`, `BadRow`, `Refused` |
| `ClientManager` | `ClientManagerError` | `Unreachable`, `BadRow`, `Storage`, `Refused` |

`Mailbox` and `ProcessManager` also stop answering the ledger's `Appended`. They answer a union
of `processes/`' own with the same two cases, `placed` and `refused`, decoded by `processes/`.
`From` is written out as its own schema with the seven fields it has today (`by`, `for`,
`sentAt`, `seen`, `parent`, `traceId`, `build`), not derived from the ledger's `Line`.

### The stream service (slices 4 to 7, a sketch, waits on question 1)

```ts
// sketch: processes/Streams.ts. The contract only (0095); StreamsLedger.layer delivers it.
// Every name in this block is a lean, not a decision.

/** One event as it comes back out: processes' own row, not the ledger's Entry. */
export type Item = {
  readonly id: string;
  readonly rev: Rev;
  readonly pos: Rev;
  readonly arrivedAt: number;
  readonly from: From;
  /** The event as it was written: its `_tag` and its fields. */
  readonly event: Schema.JsonObject & { readonly _tag: string };
};

export const Refusal = Schema.Literals(["forbidden", "bad_line", "id_reused", "stale", "too_big"]);

export const Placed = Schema.TaggedUnion({
  placed: { rev: Rev, pos: Rev },
  refused: { reason: Refusal },
});

export class StreamsError extends Schema.TaggedError<StreamsError>()("StreamsError", {
  reason: Schema.Union([Unreachable, BadRow, Storage]),
}) {}

export class Streams extends Context.Service<
  Streams,
  {
    /** One event onto a stream. A write only the brain may make is answered `forbidden`. */
    readonly append: (
      stream: string,
      id: string,
      event: Schema.JsonObject & { readonly _tag: string },
      from: From,
    ) => Effect.Effect<typeof Placed.Type, StreamsError>;
    /** The events past `after`, oldest first. */
    readonly read: (stream: string, after: Rev) => Stream.Stream<Item, StreamsError>;
    /** Answers the next rev past `after`, or parks the reader, as the ledger's `wait` does. */
    readonly wait: (stream: string, after: Rev) => Effect.Effect<typeof Waited.Type, StreamsError>;
    /** Reads `guard` and appends in one turn; `admit` is plain code and sees every row of it. */
    readonly appendWhen: (
      guard: string,
      admit: (rows: ReadonlyArray<Item>) => boolean,
      write: { readonly stream: string; readonly id: string; readonly event: Item["event"]; readonly from: From },
    ) => Effect.Effect<Option.Option<typeof Placed.Type>, StreamsError>;
  }
>()("@kampus/libfabrika/processes/Streams") {}
```

- **What it adds over the ledger,** so it is not a plain pass-through: the one rule for who may
  write what. `brainOnly` lives in `processes/Process.ts:67` today and the gateway has to
  remember to call it (`gateway/Gateway.ts:28`). In the service, no caller can forget it.
- **Whom it is for:** libfabrika's own modules. Programs do not get it. It is not `Topic`, which
  the plan keeps for Tier 2's walk ([tiers](./tiers.md), and
  [the cloud is one more host](../direction/the-cloud-is-one-more-host.md)). A later `Topic`
  reads the same streams, so nothing is lost.
- **Its `Refusal` words are a guess.** The build reads the ledger's real refusal reasons and
  gives each one a word here. The wire's bytes for `ledger.read` do not change: the gateway
  encodes an `Item` into the same keys it sends today.
- **The names** `Streams`, `Item`, `Placed` and `appendWhen` are leans. `Streams` sits one
  letter from Effect's `Stream` module, which is a cost. `Placed` is also a name in
  `runtime/ProcessStore.ts`. The owner confirms or renames in question 1.

## The test lines

The 54 lines are four kinds of use. Counts are by the ledger file imported.

| Kind | Lines | What it should use instead |
|---|---|---|
| A real SQLite driver: `nodeSql` | 10 | The laws become a suite, `<Module>Test.ts` beside the module, that takes a way to open a database. A runner in `node/` hands it the driver (0062) |
| A real ledger: `LedgerSql`, `LedgerTransactionSql`, `RefereeSql` | 16 | The same suite takes the built layers of the module below as an argument. The runner in `node/` builds them |
| A service to wire or to fake: `Ledger`, `Doorbell`, `LedgerTransaction`, `Referee`, and the `LedgerError` they fail with | 18 | The suite fakes the service one layer down in that service's own words: `Mailbox`, `ProcessManager` or the stream service. A law about the ledger's own fault moves to the runner's side as a harness the suite calls |
| Lines and entries for fixtures: `lineFor`, `valueFor`, `fromHere`, `Line`, `Entry`, `Appended`, `InputId` | 10 | `InputId` from `../Id.ts` (2 of the lines are only that). The rest are written through the module below: a letter through `Mailbox.send`, an event through the stream service |

**Two files on main that already do it this way:**

- `next/packages/libfabrika/src/runtime/RunnerWatchersTest.ts` holds the runner's watcher laws
  and imports no `ledger/` file. `next/packages/libfabrika/src/node/Watchers.test.ts` builds
  `LedgerSql.layer`, `Mailbox.layer` and `ProcessManager.layer` on real SQLite files and calls
  `RunnerWatchersTest.suite({ files, services })`.
- `next/packages/libfabrika/src/gateway/JobsTest.ts` exports `suite(open)`, and
  `next/packages/libfabrika/src/node/gateway/Jobs.test.ts` runs it.

**One spelling on main that this plan does not copy.** Two suites take the ledger's own class
and function in through their harness: `runtime/RuntimeCauseTest.ts:129` takes `lineFor` and
`LedgerError`, and `gateway/GatewayCauseTest.ts:80` takes `LedgerError`. That keeps lint quiet
and keeps the suite speaking the ledger's words. After slices 1 to 3 those suites import their
module's own error, and the harness hands in only a driver and built layers.

**A rule every slice keeps: a listed line is deleted whole or left as it is.** The list matches
a line by its exact text, so a listed import that is edited becomes a new finding and blocks. A
slice that has to change a listed line in a test file converts that whole file.

**No law changes.** A test file that becomes a suite keeps its assertions and its generators
(0168's fast track asks for that). Where an assertion names `LedgerError` for a fault the upper
module now translates, it names the upper error and checks the `LedgerError` in its cause chain,
which `runtime/NemesisTest.ts:332` already does.

## One value traced through

A person's window writes one line to a ticket's stream while their key is being revoked.

1. **Today.** `gateway/Gateway.ts:305` calls `appendAdmitted(key, write)` and hands it the
   `LedgerTransaction` it took at `:302`. `access/Authorization.ts:20` opens the ledger's turn,
   reads `gateway/access` row by row with the ledger's `valueFor`, and answers the ledger's
   `Appended`. A bad row fails with a `LedgerError` that access itself built (`:31`). Three
   modules now hold the ledger's types, and four listed imports make it compile.
2. **After slice 6.** `appendAdmitted` asks for `Streams`. It calls
   `appendWhen("gateway/access", admit, write)`, where `admit` folds the rows with
   `foldAccess` and answers whether the key is still admitted. That is access's own rule, in
   plain code.
3. **Inside `processes/`.** `StreamsLedger` opens the ledger's turn, decodes each row into an
   `Item`, runs `admit`, checks `brainOnly`, appends, and answers `Placed`. A bad row is a
   `StreamsError` with reason `BadRow` and the schema error as its cause.
4. **Back in access.** No admit: `NotGranted`, as today. A `StreamsError`: access wraps it in
   its own error with the cause kept. Placed: the answer goes up as it is.
5. **In the gateway after slice 7.** The service type on pull request 1174 reads
   `Effect.Effect<Appended, LedgerError | SigningRefused | NotGranted>`, with `Appended` dug out
   of the ledger's contract by a hand-written `infer`. It becomes
   `Effect.Effect<typeof Placed.Type, GatewayError | SigningRefused | NotGranted>`, with
   `Placed` imported in the plain form from `processes/`. The helper is deleted.
6. **In the span.** The failure still holds the whole chain: `GatewayError`, then access's
   error, then `StreamsError`, then `LedgerError`, then SQLite's throw. Nothing is lost; each
   layer only stopped naming the one two below it.

## Laws

The main law exists and does not change: the `eslint/no-restricted-imports` block for the three
modules in `.oxlintrc.json`, and `oxlint-plugins/ledger.test.ts`, which holds that
`next-ledger.json` only shrinks. Asked of each new one: lint, type or test?

| Law | Lint, type or test | Generator | Plant |
|---|---|---|---|
| 1. `runtime/`, `access/` and `gateway/` import no front file of `ledger/`, in product, test and suite files, and no row of `next-ledger.json` excuses one | lint | lint | add one `ledger/` import to a fixed file |
| 2. `coordination/index.ts` passes no `ledger/` name on | lint | lint | put back `export { LedgerError } from "../ledger/Ledger.ts"` |
| 3. No service of `runtime/`, `access/` or `gateway/`, and none of `processes/` or `presence/`, fails with an error whose `_tag` is `LedgerError` | type | type | add a member tagged `LedgerError` to one method's error |
| 4. The exam reads every `runtime/` file as the app part, which may not import the data part | test | scenario: the exam's own planted tree, with the three runtime prefixes gone from its list of files still read as coordination | put `runtime/ProcessStore` back in the list |
| 5. For any generated run of appends on one stream, `read` from 0 gives back the placed events in order, each with the stamp it was written with | test | Effect Arbitrary: Schema.Array | drop `seen` from the stamp; 100 runs |
| 6. A write only the brain may make is answered `forbidden` and the stream does not grow | test | Effect Arbitrary: Schema.Struct | skip the check for an id in the signal space; 100 runs |
| 7. For any generated order of a revoke and a client write, the write is placed only when the key was admitted in the write's own turn | test | Effect Arbitrary: Schema.Array | read the guard stream before the turn opens; 100 runs |
| 8. A fault from the ledger comes back as the service's own error with the fault as its cause, for each method of each service the table in The shape names | test | scenario: one injected throw per method, since a real SQLite fault cannot be drawn from a generator | build the error without `cause` |

- **Law 1** is today's rule. What changes is that its list reaches zero, slice by slice.
- **Law 2** is the same rule with one more path in its `files`, turned on in slice 3 when the
  two lines are gone, so it starts at zero (0168). oxlint's rule reads `export ... from` as it
  reads an import (`oxlint-plugins/README.md`, "libfabrika's modules").
- **Law 3** is 0043's named fallback for rule 12: a type-level test per module. It is one
  `*.types.test.ts` beside each module that pulls every method's error out of the service type
  and asks that `Extract<..., { _tag: "LedgerError" }>` is `never`. It matches by tag, so the
  test itself imports nothing from `ledger/`.
- **Law 7** is the law `access/Authorization.test.ts` holds today, moved, not rewritten.
- **A suite nobody runs.** 0062 asks for a check. I found none of its own on main. An exported
  `suite` that no file imports is an unused export, which `pnpm lint:dead` refuses. The tests
  step of slice 1 plants one unrun suite once to prove it. Sure: 75%.

### Can a slice move a break to another spelling, and can a rule see it?

| Spelling | Seen by |
|---|---|
| `Ledger["Service"]["append"] extends ... infer A`, the helper on pull request 1174 | Law 1. The helper needs `Ledger` in scope, and the only way to get it is the listed import. When the line goes, the helper cannot be written |
| The same name taken through `coordination/index.ts` | Law 2 |
| The ledger's error left in a lower service's type and passed up by inference | Law 3, and slice 2 removes it at the source |
| The ledger's class or function handed to a suite through its harness | No rule. The review reads each new harness type. Slices 1 to 3 remove the two on main |
| The ledger's `Appended` or `Entry` copied by hand under a new name, or left in a success type | No rule today. This is rule 12's open check in 0043 (demlik issue 912). Law 3 covers errors only, since two unions with the same case names cannot be told apart by tag |

## Is it a setting?

No new choice here fits `fabrika.toml` ([0069](../../.decisions/0069-choices-are-settings.md)).
An error's name, a module's layer and which file a test lives in are shapes of the code, not
values a person would set. `PAGE` (256 rows a read) is a constant today and stays one: it moves
to a shared file by rule 13 and its value does not change.

## Files and ownership

Test files, suites, the lint config, the exam and the list are exam paths, so the tests step
owns them. Product files are the build step's. Paths are under `next/packages/libfabrika/src/`
unless they start at the repo root.

| Path | Owner | Slice | Product lines expected | What changes |
|---|---|---|---|---|
| `next/packages/libfabrika/src/access/SessionManager.ts` `next/packages/libfabrika/src/runtime/RecoveryStore.ts` `next/packages/libfabrika/src/gateway/GatewayStore.ts` `next/packages/libfabrika/src/gateway/GatewayNonce.ts` | build | 1 | 180 | three own errors, 12 build sites, `InputId` from `Id.ts` |
| `next/packages/libfabrika/src/access/SessionManagerTest.ts` `next/packages/libfabrika/src/node/access/SessionManager.test.ts` `next/packages/libfabrika/src/access/SessionManager.test.ts` | tests | 1 | tests | the 622-line test becomes a suite with a runner in `node/` |
| `next/packages/libfabrika/src/runtime/RecoveryStore.test.ts` `next/packages/libfabrika/src/runtime/RuntimeCauseTest.ts` `next/packages/libfabrika/src/gateway/GatewayCauseTest.ts` `next/packages/libfabrika/src/node/ErrorCause.test.ts` | tests | 1, 3 | tests | the cause laws name each module's own error; the harness stops handing in `LedgerError` and `lineFor` |
| `next/packages/libfabrika/src/access/Access.types.test.ts` `next/packages/libfabrika/src/gateway/Gateway.types.test.ts` `next/packages/libfabrika/src/runtime/Runtime.types.test.ts` `next/packages/libfabrika/src/processes/Processes.types.test.ts` | tests | 1, 2, 3, 6, 7 | tests | new: law 3, one file a module, a service added in the slice that fixes it |
| `next/packages/libfabrika/src/processes/Mailbox.ts` `next/packages/libfabrika/src/processes/ProcessManager.ts` `next/packages/libfabrika/src/processes/Process.ts` `next/packages/libfabrika/src/presence/Connections.ts` | build | 2 | 300 | 0055's errors, own answer union, `From` written out |
| `next/packages/libfabrika/src/processes/` `next/packages/libfabrika/src/presence/Connections.test.ts` `next/packages/libfabrika/src/node/` `next/packages/libfabrika/src/cloudflare/` `next/apps/fabrika/src/` | tests | 2, 3 | tests | assertions that name `LedgerError` for a fault now translated name the new error and check the cause |
| `next/packages/libfabrika/src/cloudflare/runtime.ts` `next/packages/libfabrika/src/cloudflare/connection.ts` `next/packages/libfabrika/src/cloudflare/control.ts` `next/packages/libfabrika/src/cloudflare/fetch.ts` | build | 1, 2, 3, 6, 7 | 120 | only the lines the type checker forces: error unions and tag matches. Their own `new LedgerError` stay; `cloudflare/` is not under rule 11 |
| `next/packages/libfabrika/src/runtime/Runner.ts` `next/packages/libfabrika/src/runtime/Entry.ts` `next/packages/libfabrika/src/coordination/index.ts` | build | 3 | 150 | the runner's 17 build sites take `RunnerError`; the two pass-through lines go |
| `.oxlintrc.json` | tests | 3, 7 | 6 | slice 3: the pass-through file joins the block's `files`. Slice 7: the comment that points at the list goes |
| `next/apps/fabrika/src/exam/layers.test.ts` | tests | 4 | tests | law 4: `runtime/ProcessStore`, `runtime/RecoveryStore` and `runtime/internal/recovery` leave the list |
| `next/packages/libfabrika/src/processes/Streams.ts` `next/packages/libfabrika/src/processes/StreamsLedger.ts` | build | 4 | 230 | new: the contract and its layer |
| `next/packages/libfabrika/src/processes/StreamsTest.ts` `next/packages/libfabrika/src/node/Streams.test.ts` | tests | 4 | tests | new: laws 5, 6, 7 and 8 as a suite, and its runner |
| `next/packages/libfabrika/src/runtime/ProcessStore.ts` `next/packages/libfabrika/src/Rev.ts` | build | 4, 7 | 70 | `ProcessStoreError`, `record` through the stream service; `PAGE` joins `Rev.ts` in slice 7 |
| `next/packages/libfabrika/src/runtime/ProcessStoreTest.ts` `next/packages/libfabrika/src/node/runtime/ProcessStore.test.ts` `next/packages/libfabrika/src/runtime/ProcessStore.test.ts` | tests | 4 | tests | the test becomes a suite with a runner |
| `next/packages/libfabrika/src/runtime/EffectFunctions.test.ts` `next/packages/libfabrika/src/runtime/Gateway.laws.test.ts` `next/packages/libfabrika/src/runtime/RecoveryGaps.test.ts` `next/packages/libfabrika/src/runtime/Runner.test.ts` `next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts` `next/packages/libfabrika/src/runtime/RunnerSupervision.test.ts` `next/packages/libfabrika/src/runtime/internal/recovery.test.ts` `next/packages/libfabrika/src/node/runtime/` | tests | 5 | tests | seven files, 8,940 lines, become suites with runners; `git mv`, then the imports |
| `next/packages/libfabrika/src/access/ClientManager.ts` `next/packages/libfabrika/src/access/ClientManagerLedger.ts` `next/packages/libfabrika/src/access/Authorization.ts` | build | 6 | 190 | `ClientManagerError`; reads and writes through the stream service |
| `next/packages/libfabrika/src/access/AccessSpans.test.ts` `next/packages/libfabrika/src/access/Authorization.test.ts` `next/packages/libfabrika/src/access/ClientManager.test.ts` `next/packages/libfabrika/src/access/ClientManager.types.test.ts` `next/packages/libfabrika/src/node/access/` `next/apps/fabrika/src/exam/client-manager-contract.test.ts` | tests | 6 | tests | four files, 2,111 lines, become suites with runners; the contract exam follows the new error |
| `next/packages/libfabrika/src/gateway/Gateway.ts` | build | 1, 7 | 220 | slice 1: `GatewayError` joins its unions. Slice 7: 21 build sites, the reads, and pull request 1174's helper replaced by a plain import |
| `next/packages/libfabrika/src/gateway/GatewayRevocation.test.ts` `next/packages/libfabrika/src/node/gateway/` | tests | 7 | tests | 1,170 lines become a suite with a runner |
| `next-ledger.json` | tests | 1, 4, 5, 6, 7 | 0 | each slice deletes exactly its rows: 8, 6, 27, 21, 9. Only as `pnpm lint` prunes it |
| `oxlint-plugins/README.md` | tests | each slice | docs | the list's count in the table row for this rule |
| `next/AGENTS.md` `.glossary/TERMS.md` `docs/plan/README.md` | build | each slice | docs | the `MailboxError` and `ProcessManagerError` rows say built; a row for each new word; where we are now |
| `oxlint-plugins/ledger.test.ts` `layer-rules.json` `next/packages/libfabrika/src/runtime/RunnerWatchersTest.ts` `next/packages/libfabrika/src/node/Watchers.test.ts` `next/packages/libfabrika/src/gateway/JobsTest.ts` `next/packages/libfabrika/src/node/gateway/Jobs.test.ts` | tests | none | 0 | read for this plan and not changed: the list's own law, the rule file, and the two suite and runner pairs cited above |

No screenshots: no window changes. No host-only law: every law runs on Node's SQLite in CI.

## Slice order

1. **Slice 1, stores name their own faults.** Group A's four stores and group B. Deletes 8 rows:
   `SessionManager.ts` 2, `GatewayStore.ts` 1, `GatewayNonce.ts` 1, `RecoveryStore.ts` 1,
   `SessionManager.test.ts` 2, `RecoveryStore.test.ts` 1. No wait.
2. **Slice 2, `processes/` and `presence/` answer in their own words.** 0055, as written.
   Deletes 0 rows. It is the step that makes the rows above it true and not only quiet.
3. **Slice 3, the runtime stops naming the ledger.** `Runner.ts` and `Entry.ts` take
   `RunnerError`, and the two pass-through lines leave `coordination/index.ts`. Deletes 0 rows,
   and law 2 turns on. After slice 2.
4. **Slice 4, the stream service, first used by `ProcessStore`.** Deletes 6 rows:
   `ProcessStore.ts` 2 and `ProcessStore.test.ts` 4. After question 1 and slice 2.
5. **Slice 5, the runtime's tests become suites.** Deletes 27 rows in seven test files. No
   product line changes. After slices 3 and 4, since its fixtures write through `Mailbox` and
   the stream service.
6. **Slice 6, access.** Deletes 21 rows: 7 product, 14 test. After slice 4.
7. **Slice 7, the gateway, and the list's last import rows.** Deletes 9 rows: `Gateway.ts` 3
   and `GatewayRevocation.test.ts` 6. After slice 6, because `appendAdmitted` changes there, and
   after pull request 1174.

8 + 6 + 27 + 21 + 9 is 71. After slice 7 `next-ledger.json` holds only the 13 `no-hooks` rows.

Each slice keeps main green alone: a service's error changes together with every caller the
type checker names, in the same pull request. Slices 5 and 6 share no file and can run side by
side.

### What else is in flight in these files, and who rebases

- **Pull request 1174** (Effect rules A2, the written service type) changes `gateway/Gateway.ts`
  and `cloudflare/runtime.ts`. It lands first. Slice 1 rebases onto it and adds `GatewayError`
  to the type it wrote out. Slice 7 deletes its `infer` helper.
- **Pull request 1168** (A1, no `Cause.squash`) changes `runtime/Runner.ts`, one line of it a
  test for `LedgerError` (`:1861`). It lands first; slice 3 rebases.
- **A5, `instanceOfSchema`** ([the small rules](./effect-rules-small.md)), 37 sites, some of
  them `instanceof LedgerError` in files this plan changes (`runtime/RecoveryStore.ts:77`).
  Whichever lands second rebases; the lines are single.
- **B1, the static layer moves** ([the big rules](./effect-rules-big.md)): B1.2 access, B1.3
  gateway, B1.5 processes, B1.7 runtime move a layer's body to a sibling file, and this plan
  edits those bodies. One at a time a module: the one that is ready first lands, the other
  rebases. Slice 2 and B1.5 must not run in the same hour: both touch about 50 caller files of
  `Mailbox` and `ProcessManager`. Every new file here is already in 0095's shape, so B1 finds
  nothing to move in it.
- **B2, the docs rule,** and its fill pull requests 1162 (gateway) and 1166 (access): comments
  only. They land first. Every new export here carries its doc block, since the rule is turning
  on folder by folder (pull request 1178).
- **The Alchemy port** ([its plan](./ticket-502-alchemy-port.md)) rewrites the shells in
  `cloudflare/`. Its own rule holds: the other lane lands first and the port rebases, one line a
  method. This plan touches `cloudflare/` only where the type checker forces it. The exception
  is the port's S5, which changes 19 call sites in 12 files across `gateway/`, `runtime/` and
  `access/` in one sitting: the lead holds this plan's merges to those files for that check run.
- **Pull request 1104** gives every `next/` test file a measured shard row. A test that becomes
  a suite plus a runner changes its row. Whichever lands second fixes the rows.
- **Product lanes** (pull requests 1092, 1099 and 1012) land first; a slice here rebases.

## What this records

- **Nothing a person wrote is lost.** No ledger entry changes shape and no stream is renamed.
  The wire's bytes do not change.
- **What would be lost without care: the cause.** Each new error wraps the one below. If a
  build site drops `cause`, the SQLite message is gone from the span for good. Law 8 plants that
  on every method.
- **One fact is new and kept:** which layer saw the fault. Today a span says `LedgerError` for
  a session table that could not be read. After slice 1 it says `SessionManagerError`, with the
  SQLite error beneath it.
- **Span tags that read `error.reason`** today hold the ledger's words (`storage`, `bad_row`).
  With a tagged reason they hold the reason's tag (`Storage`, `BadRow`). A saved recording made
  before a slice keeps the old words. Nothing reads them back by value today, as far as a search
  for `"bad_row"` outside tests showed; the tests step confirms it per slice.
- **Docs that change with the code:** the glossary rows for `MailboxError` and
  `ProcessManagerError` drop "code on main still fails with `LedgerError`"; new rows for each
  new error and for the stream service's words; `oxlint-plugins/README.md`'s table row for this
  rule; `next/AGENTS.md`'s line on the layers; `docs/plan/README.md`, "where we are now".

## Size

Sized in files and lines. Product lines are from the mention counts above; test lines are
mostly moved, not written. How sure is given a slice.

1. **Slice 1.** 4 product files and about 4 callers, 180 lines. 1 test file of 622 lines moved,
   about 150 test lines changed. Sure: 70%.
2. **Slice 2.** 4 product files in `processes/` and `presence/` and about 12 callers, 300 lines.
   About 40 test files touched, 250 lines. Sure: 60%. The doubt: 230 product mentions of
   `LedgerError` were counted, not read one by one.
3. **Slice 3.** 3 product files and 2 callers, 150 lines. About 100 test lines. Sure: 65%.
4. **Slice 4.** 2 new product files and 1 changed, 300 lines. 1 new suite of about 250 lines, 1
   test of 425 lines moved. Sure: 60%, and only if question 1 is answered yes.
5. **Slice 5.** 0 product lines. 7 test files, 8,940 lines moved, about 350 lines changed, 7
   runners of about 40 lines. Sure: 55%. The doubt: how many fixtures write a raw line that no
   service of `processes/` can write.
6. **Slice 6.** 3 product files and 2 callers, 190 lines. 4 test files, 2,111 lines moved, about
   200 changed. Sure: 60%.
7. **Slice 7.** 280 lines changed in 3 product files: 220 in `gateway/Gateway.ts`, which is long
   (1,828), and 60 in 2 callers. 1 test file moved, 1,170 long. Sure: 55%. `Gateway.ts` is the file every other plan changes.

The budget is for all seven slices: tests, build and review for each, plus one send-back for
each of slices 2, 5 and 7. Priced from the list-price medians that
[the small rules plan](./effect-rules-small.md) took from `field/runs.jsonl` since 2026-11-09
(tests $1.14, build $1.24, review $1.15), with slices 2, 5 and 7 counted twice for their size. I
did not read `field/runs.jsonl` again. Sure: 50%.

Estimate: 24 steps, $39

## What this cannot tell us

- **Whether the stream service ends up a thin copy of the ledger.** The sketch gives it the
  who-may-write rule. If the build finds that three of its four methods only pass a call on, the
  red flag is real, and the answer is the owner's.
- **Whether every one of the 54 test lines fits one of the four kinds.** They were counted by
  import and by a few `rg` patterns (`LedgerSql.layer`, `nodeSql(`, `lineFor(`), not read law by
  law. `runtime/RunnerSupervision.test.ts` alone is 2,236 lines.
- **Whether a fixture needs a line no service can write.** Some tests seed a stream with a raw
  line to stand for a broken or old entry. If `Mailbox` and the stream service rightly refuse
  that line, the fixture has to be written from the runner's side, in `node/`.
- **Whether `pnpm lint:dead` really fails on a suite nobody runs.** Read, not run.
- **What oxlint's rule does with one more path in an override.** Law 2 was not run: this step
  reads.
- **The false-alarm rate of law 3.** It is a type test, so it has none by design, but it was not
  compiled.
- **How the old move plan cut this work.** Ticket 477's plan named pull requests 10 to 13, "the
  error PRs". That plan is not in the repo, so this plan does not follow its rows. The exam's
  comment "until old PR 13" (`next/apps/fabrika/src/exam/layers.test.ts:281`) points at it.
- **The state of demlik issues 912 and 913.** Not fetched. Rule 12 for success types has no
  check until one lands or a type test is written for each answer.
- **Two other lists of the same family** are outside this plan: the 40 dated `allowed` entries
  in `layer-rules.json`, five of them telemetry tests waiting on ticket 641, and the 13
  `no-hooks` rows.

## Findings

None. What was found outside the 71 lines (the pass-through file, the exam's list, 0055 not yet
built) is work this plan needs, so it is in the plan.

## Open questions

1. May `processes/` get one small service that appends to, reads and waits on a named stream for libfabrika's own modules, checks who may write, and is not offered to programs? Lean: yes, 75%. Why: 0043 already asks for this function for the runtime's store, and access and the gateway need the same three calls. Cost: about 230 product lines, one new word in the glossary, and a service that stands close to the future `Topic`. Doubt: it may turn out a thin copy of the ledger; the Tier 2 walk on `Topic` would settle it. If no: slices 4, 6 and 7 need a narrower service each, named by the owner.
2. Are `Streams`, `Item`, `Placed` and `appendWhen` the right words? Lean: `Streams` yes, 60%, as the glossary's own word for a named part of the log, plural as Effect names a service that holds many. The other three are placeholders, 50%.
