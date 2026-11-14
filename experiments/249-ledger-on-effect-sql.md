---
date: "2026-11-10"
scripts: "none"
summary: "`next/`, spike S10 of ticket 502's plan, ticket 551, on Node and local workerd, no deploy, no model, $0. Yes: the slice (append, read, one transaction) ran on `effect/sql`'s `SqlClient` with `@effect/sql-sqlite-node` and `@effect/sql-sqlite-do` 4.1.2, 38 of 38 ported Node laws and 8 of 8 laws in a real object on each of six routes. No route let a call land inside a turn. But a turn whose body is an Effect inside the platform's Promise transaction hangs under load when the body waits on a timer (1 of 6 turns answered, 5 turns and 5 reads timed out at 8 s), on Effect's driver, with Alchemy's scheduler fix, and on Alchemy's wrapper; a quiet object passes. A `SqlClient` turn on `transactionSync` (a 45-line adapter) runs one append under `Effect.runSync` on both platforms and makes a wait die at once. One turn, median: 76 µs today, 97 on the adapter, 171 on the plan's route, 186 on the shipped driver. For PR 8 keep the step a plain function inside `state.storage.transaction(Effect.sync(step))` (about 80% sure); move `data/` to `effect/sql` later on the synchronous turn (about 65%). The `node:sqlite` edge comment in `data/sqlite.ts` is false on Node. Branch `fabrikalfa/t502-s10-spike`."
---

# 249. Can the ledger's storage run on Effect's SQL modules and keep its one-turn guarantee?

Run 2026-11-10 on the spike branch of [experiment 248](./248-effect-object-spike.md) (main at
`d7484976`). **All claims are about `next/`.** This is spike S10 of ticket 502's plan, made wider by
one question: does the ledger use Effect's SQL modules properly, given that Effect has a SQLite
driver for Durable Objects and that an Effect can run synchronously? Ticket 551. Everything ran on
the laptop: Node 26.13.0 and a local workerd through `@alchemy.run/cloudflare` 2.0.0-beta.84.
Nothing was deployed. No script called a model, so the cost is $0 at any list price. The code is on
the branch `fabrikalfa/t502-s10-spike` (`c984e1ca`), which is never merged. Raw outputs are in the
owner's private archive, not in git ([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)).

**The answer.** Yes, it can, and the comment in `data/sqlite.ts` that says it cannot is wrong for
Node. The slice (append, read, one transaction) ran on `effect/sql`'s `SqlClient` with
`@effect/sql-sqlite-node` 4.1.2 and `@effect/sql-sqlite-do` 4.1.2: 38 of the 38 ported Node laws
pass and 8 of 8 laws pass inside a real object. Both drivers take `effect` 4.1.2 as it is, no bump.
An Effect can also stay synchronous: one whole append ran under `Effect.runSync` on both platforms
once the turn sat on the platform's `transactionSync`.

But the turn is where the routes differ, and one difference is a hang. When the turn's body is an
Effect that runs inside the platform's Promise transaction (`storage.transaction`), a body that
waits on a timer hangs the object under load: 1 of 6 turns finished, 5 turns and 5 reads timed out
at 8 seconds. That is true of Effect's own driver, of the same driver with Alchemy's scheduler fix,
and of Alchemy's wrapper. No route ever let a second call land inside a turn. A quiet object passes
the same case, so a law with one caller cannot see the hang.

So, for the port's PR 8: keep the step a plain synchronous function and run it inside
`state.storage.transaction(Effect.sync(step))`, the route the plan already leans to. Moving `data/`
to `effect/sql` is a good next step on its own ticket, with a synchronous turn. Both are under
[What to do](#what-to-do).

```ts
// The whole idea, real code from the spike (sync-turn.ts), it ran on Node and in workerd.
// A SqlClient whose turn is the platform's synchronous transaction. The body is an Effect.
// It runs to its end inside one transactionSync call, or it dies and the turn rolls back.
export const withSyncTurn = <Client extends SqlClient.SqlClient>(client: Client, transactionSync: TransactionSync): Client =>
  Object.assign(client, {
    withTransaction: <A, E, R>(body: Effect.Effect<A, E, R>): Effect.Effect<A, E | SqlError.SqlError, R> =>
      Effect.flatMap(Effect.context<R>(), (context) =>
        Effect.suspend((): Effect.Effect<A, E | SqlError.SqlError> => {
          let exit: Exit.Exit<A, E> | undefined;
          try {
            transactionSync(() => {
              exit = Effect.runSyncExitWith(Context.add(context, Scheduler.PreventSchedulerYield, true))(body);
              if (Exit.isFailure(exit)) {
                const died = Cause.squash(exit.cause);
                if (Cause.isAsyncFiberError(died)) died.fiber.interruptUnsafe(); // it waited: stop it
                throw ROLLBACK;
              }
            });
          } catch (error) {
            if (error !== ROLLBACK) return Effect.fail(new SqlError.SqlError({ reason: SqlError.classifySqliteError(error, { message: "Failed transaction", operation: "transaction" }) }));
          }
          return exit ?? Effect.die("the synchronous transaction did not run its step");
        }),
      ),
  });
```

## The routes

Six routes ran. The task named three; the runs split two of them, because the turn can be built
more than one way on the same statements.

| Route | Statements | The turn | The step is |
|---|---|---|---|
| S | today's `Sql` (`exec` gives rows) | `storage.transactionSync(step)` | a plain function |
| Sb | today's `Sql` | `state.storage.transaction(Effect.sync(step))`, Alchemy's wrapper | a plain function |
| E | `SqlClient`, Effect's drivers | the driver's own `withTransaction` | an Effect |
| E2 | `SqlClient` | E, with the sync scheduler Alchemy's Drizzle adapter sets | an Effect |
| Es | `SqlClient` | `withSyncTurn` above, on `transactionSync` | an Effect |
| W | Alchemy's `state.storage.sql.exec` | `state.storage.transaction(body)` | an Effect |

S is main today. Sb is the plan's route (b), and what decision
[0042](../.decisions/0042-platform-pieces-go-through-alchemy.md)'s amendment names for PR 8. E is
"use Effect's SQL modules as shipped". W is "use Alchemy's wrapper for everything".

## 1. Does the store run on `SqlClient`, on both drivers?

Yes. Ran.

- **Versions.** `@effect/sql-sqlite-node@4.1.2` and `@effect/sql-sqlite-do@4.1.2` both ask for
  `effect ^4.1.2`, the installed version. Both are marked `@stability unstable` in their source.
- **Node.** main's `ledger.test.ts` and `ledger-transaction.test.ts` were copied and only their
  harness changed. 27 + 11 = 38 laws, 38 pass, on the driver's own turn and again on the synchronous
  turn. Left out, four laws: the `Ledger.remote` laws and the `Sql.size` law, which test no SQL
  statement of the store. main's own 42 laws still pass after the small refactor the spike needed (42 of 42).
- **Workerd.** Eight laws were rewritten to run inside a real Effect object: first, resend and
  reused id; `seen` bounded; a turn reads its own writes; a refusal aborts the turn; a storage
  failure late in a turn rolls back its earlier insert; a failed call is a typed `storage` and the
  next call works with no gap; one turn of 260 appends; a row that does not decode is `bad_row`.
  8 of 8 on each of the six routes, 48 of 48.
- **Do the laws still reach the logic?** One mutant by hand: drop `withTransaction` from route E's
  store. Six laws fail (many writers at once, three refusal laws, the ring before commit, the late
  storage failure). So the Node laws do reach the turn on this route.

Two laws had to change shape, and both changes say something:

- A step that throws is a defect on route E, not a typed `storage`. The law now plants the failure
  at a statement. In the object it is planted with a real `CREATE TRIGGER ... RAISE(ABORT)`.
- "The ring comes after the commit" is now seen from a second connection to a file database, since
  the Node driver holds one connection behind a semaphore.

## 2. Is the turn still atomic? Which calls are synchronous?

**No route let anything in.** The law: six turns sent at once to one object from six requests, six
reads sent between them, a table with no unique index so that a doubled number would show. Each
turn reads the head, pauses, then writes. Counted from the object's own trace: turns that overlap,
reads that land inside a turn, numbers written twice. Every case that finished had 0, 0 and 0.

What differs is what a pause inside the turn does:

| Pause in the turn | S, Sb | E | E2, W | Es |
|---|---|---|---|---|
| none | fine | fine | fine | fine |
| `Effect.yieldNow` | cannot be written | **hangs** | fine | fine |
| a resolved Promise, a KV read, a fetch | cannot be written | fine | fine | dies at once, 0 rows |
| a timer (`Effect.sleep("5 millis")`) | cannot be written | **hangs** | **hangs** | dies at once, 0 rows |

- **Hangs** means: 1 of 6 turns answered, 5 turns and 5 reads timed out at 8 seconds, 1 row
  written. Asked again 20 seconds later the object answered. With three turns one after another on
  a quiet object, the same case passes on every route.
- **Dies at once** means an `AsyncFiberError` defect, the turn rolled back, and the six reads still
  answered. The object stays up.
- **Cannot be written** means the step is `() => A`. There is no place to put a wait, so the type
  stops the mistake before any run.
- Six fibers in one call instead of six requests: E with a timer hung, E2 and W with a timer
  finished.

A guess at the cause, not shown: Alchemy's source says "Native input gates can block timers; fiber
yields must use microtasks". The runs fit that, and they show the scheduler fix covers yields but
not a timer the body asks for.

**Which calls ran synchronously.** Checked with `Effect.runSync` inside the object:

- One statement is synchronous on E, E2, Es and W. The DO driver runs `sqlStorage.exec` in an
  `Effect.try`; Alchemy's `sql.exec` is an `Effect.sync`.
- One whole append is synchronous only on S and Es. On Sb, E, E2 and W it fails with
  `AsyncFiberError`, because `storage.transaction` is a Promise call.
- On Node, one whole append ran under `Effect.runSync` on S, E and Es. main's law "a wait leaves
  nothing running: Effect.runSync of a parking wait" passes on route E unchanged. So on Node the
  turn is synchronous on `effect/sql` as shipped, layer build included.
- Node cannot see the hang. On the Node driver's own turn a body may sleep and still commits. On
  the synchronous turn a sleeping body dies and writes nothing, the same as in the object.

## 3. How does the driver get its storage, and is there an Alchemy gap?

Ran for the first part, read for the second.

- The DO driver needs the platform's `DurableObjectStorage` to make a transaction. With only
  `SqlStorage` (what Alchemy's `state.storage.sql.raw` gives) a transaction fails with
  "Transactions require Durable Object storage". So the handle is `state.raw.storage`:
  `SqliteDo.layer({ storage: state.raw.storage })`. That ran.
- Alchemy does the same itself. `@alchemy.run/drizzle` 2.0.0-beta.84's `Drizzle.DurableObject`
  builds the client from `state.raw.storage` and replaces `withTransaction` with one on the sync
  scheduler.
- **The gap:** `@alchemy.run/cloudflare` ships a `SqlClient` Layer for D1 (`src/D1/SQL.ts`, 88
  lines) and none for a Durable Object. The only one is inside the Drizzle package. A patch that
  mirrors the D1 file is about 30 to 40 lines. A synchronous turn as an option is about 45 more,
  the block above. No issue was filed; that is the owner's call.
- The wrapper has no `transactionSync` in beta.84 or beta.85. Alchemy's own code reaches for it
  through `raw` where it wants one (`SqlMigrationsApply.ts`, and the `Sql.ts` store of its git
  package, whose comment says the body "MUST be fully synchronous").

The plan's first question, what a Node law must put in `RuntimeContext`: nothing.
`RuntimeContext.phantom` is `Layer.empty`, and route W's store ran on Node over a stand-in with
nothing provided (3 laws). The cost is elsewhere: route W on Node needs a hand-written stand-in of
the platform's storage, and that stand-in has no input gate, so it cannot show the hang either.

## 4. The routes by what holds

The same lines of one append, in each shape. Real code from the branch.

```ts
// S and Sb: a plain function. The turn is sql.transaction(step), or on Sb
// state.storage.transaction(Effect.sync(step)).
const first = Option.map(one(`SELECT * FROM entries WHERE stream = ? AND id = ?`, stream, id), (row) => decodeRow(row));
sql.exec(`INSERT INTO entries (rev, stream, pos, id, ...) VALUES (?, ?, ?, ?, ...)`, rev, stream, pos, id /* ... */);

// E, E2, Es: SqlClient. Rows come back decoded, and the insert names its columns once.
const first = yield* firstOf({ stream, id }); // SqlSchema.findOneOption({ Request, Result: Row, execute: ... })
yield* sql`INSERT INTO entries ${sql.insert({ rev, stream, pos, id, arrivedAt, by: line.by /* ... */ })}`;

// W: Alchemy's wrapper. A cursor comes back; a dropped cursor fails Effect's type check.
const first = yield* Effect.flatMap(one(`SELECT * FROM entries WHERE stream = ? AND id = ?`, stream, id), (row) =>
  Effect.transposeOption(Option.map(row, (found) => rowOf(found))));
yield* Effect.asVoid(storage.sql.exec(`INSERT INTO entries (rev, stream, pos, id, ...) VALUES (?, ?, ?, ?, ...)`, rev, stream, pos, id /* ... */));
```

| | S (today) | Sb | E, E2 | Es | W |
|---|---|---|---|---|---|
| Nothing lands inside a turn | yes | yes | yes | yes | yes |
| Rolls back on a typed failure | yes | yes | yes | yes | yes |
| A wait in the turn | no place for one | no place for one | hangs under load | dies, rolls back | hangs under load |
| Node laws reach the logic | yes | yes | yes, 6 fail on the mutant | yes | only over a stand-in |
| One append under `runSync` in the object | yes | no | no | yes | no |
| Platform handle it needs | raw `transactionSync` | none | `state.raw.storage` | raw `transactionSync` | none |

What each route loses, and how it fails:

- **S.** Needs the raw handle, which 0042 lists as a gap whose answer is Sb. Fails as today.
- **Sb.** Loses "one append is one synchronous call": the turn is a Promise, so an append can no
  longer run under `Effect.runSync` in the object. Keeps everything else, with no raw handle.
- **E and E2.** Gain typed SQL errors (`UniqueViolation`, `ConstraintError`, `LockTimeoutError`),
  decoded rows and a span per statement. Lose the type-level stop on waiting. A throw in a step
  becomes a defect. The client's Layer can fail while it is built on Node, so a caller must handle
  or `orDie` it. The test hook changes from a three-function `Sql` to a proxy over `SqlClient`.
- **Es.** E's gains, and a wait dies at once in place of hanging. It needs the raw handle, like S.
  It is our own adapter until Alchemy or Effect ships one.
- **W.** A SQL error is a defect (`exec`'s error type is `never`), so the store catches defects to
  keep the ledger's typed `storage`. Laws run only over a stand-in.

**Rooms ([0043](../.decisions/0043-rooms-on-floors.md)).** On E, E2 and Es, `data/sqlite.ts` (56
lines) and `data/worker-sql.ts` (7 lines) go away: each driver is a Layer picked at the edge, and
the store asks for `SqlClient`. The `node:sqlite` edge comment goes with them. But `LedgerTurn`
becomes an Effect API, and about 17 product files call it today. On Sb nothing above `data/`
changes. On W the store imports an Alchemy type, so a platform name enters the ledger's room.

**Spans.** One append makes 1 span on main and 9 on route E (`ledger.append`, `sql.transaction`,
`BEGIN`, five statements, `COMMIT`). The span sink writes a row per ended span through SQL, so on
route E it would write about its own writes unless it is told not to. Not ported, not measured.

**Time for one turn.** One append is one turn. Five runs of 1,000 after 200 to warm up, median of
the five runs in microseconds, with the lowest and highest run. The laptop was busy (load average
12 to 17), so read the order, not the digits.

| Route | workerd | Node, in memory |
|---|---|---|
| S | 76.0 (73.4 to 79.6) | 35.7 |
| Es | 97.3 (95.0 to 99.2) | 62.6 |
| W | 170.2 (161.6 to 191.5) | not run |
| Sb | 171.0 (165.4 to 183.8) | not run |
| E | 185.7 (168.7 to 480.3) | 73.4 |
| E2 | 191.3 (177.5 to 305.0) | not run |

An earlier full run gave the same order: S 78.9, Es 100.3, W 169.5, Sb 185.0, E2 206.5, E 237.4.
The Promise transaction costs about 95 microseconds a turn; `SqlClient` itself costs about 20 to
30. W's store sets fewer span tags than the others, so its number is a little kind to it.

## 5. What the makers do

Read, not run.

- **Effect.** The DO driver's statements are synchronous; its turn is the Promise
  `storage.transaction` behind a semaphore, with `Scheduler.PreventSchedulerYield` set. It does not
  use `transactionSync`.
- **Alchemy.** Its docs show `state.storage.sql.exec(...)` piped to `cursor.toArray()`,
  `Cloudflare.SqlMigrations`, and `state.storage.transaction(Effect.gen(...))` with the words "Keep
  transactional operations on that fiber", or `Drizzle.DurableObject` for a typed client. Its own
  internals use `transactionSync` through `raw` in two places.
- **kamp-us/phoenix, origin/main.** One object, on key-value storage. Its pattern doc says there
  is "no SQL table and no `@effect/sql-sqlite-do`". It uses `effect/sql` for D1 through Drizzle.
  So phoenix gives no worked example of this driver in an object.

So nobody upstream ships "a `SqlClient` whose turn is `transactionSync`". Effect and Alchemy both
accept the Promise turn and guard it with scheduler settings. This run shows what that guard does
not cover.

## What to do

1. **PR 8 of the port: route Sb.** The step stays `() => A` and runs in
   `state.storage.transaction(Effect.sync(step))`. Why: all laws hold, nothing lands inside a turn,
   a wait cannot be written, and it needs no raw handle, which is what 0042's amendment asks. Cost:
   a turn takes about 2.2 times as long (76 to 171 microseconds), and one append in the object is
   no longer a single synchronous call. About 80% sure. The doubt: only the 8 object laws and the
   interleave law ran on Sb in workerd, not the full 42.
2. **Never put an Effect body in `storage.transaction` without a guard.** That is E, E2 and W. The
   timer hang is real and a quiet law misses it. If one is ever needed, the six-requests law from
   this spike is the test for it.
3. **Move `data/` to `effect/sql` as its own ticket, after the port, on the synchronous turn
   (Es).** Why: the owner's point holds on the slice. The statements are synchronous already, the
   Node laws pass unchanged in meaning, two hand-written drivers and one false edge comment go, and
   SQL errors arrive typed. Cost: `LedgerTurn` becomes an Effect API for about 17 files; the guard
   against waiting moves from the type to a run-time defect; the adapter is ours until upstream has
   one; and it needs raw `transactionSync`, which 0042 would have to keep as a marked edge. About
   65% sure. The doubts are the span sink writing about itself, the 14 files of `data/` not ported
   here, and two modules marked unstable. Porting one caller room and the sink would settle it.
4. **Fix the comment in `data/sqlite.ts` when it is next touched.** "Effect SQL has no synchronous
   SQLite handle for the referee's transactions" is false on Node: the whole turn ran under
   `Effect.runSync` on `@effect/sql-sqlite-node`. It is true only of the DO driver's turn.

**One call for the owner.** Should a ledger step stay a plain synchronous function (a wait cannot
be written), or become an Effect on `effect/sql` with the run-time guard (a wait dies at once)?
Item 1 does not wait on this; item 3 does.

## A wrong first try, kept

The first `withSyncTurn` ran the body with a plain `Effect.runSyncExit`. main's law "many writers
at once" (which sets `MaxOpsBeforeYield` to 3) failed with `AsyncFiberError`: a child fiber, the
Node driver's statement cache lookup, yielded on its own and left the turn waiting. Setting
`Scheduler.PreventSchedulerYield` for the nested run fixed it, the same setting Effect's DO driver
uses for its turns. A second mistake was mine in a test: a sleep outside the turn but under
`runSync`.

## What this cannot tell us

- **Local workerd only.** The hang was seen in local workerd through Alchemy's local provider. It
  was not run on Cloudflare. The cause given is a guess from one source comment.
- **A slice.** Append, read and the transaction were ported. The mailbox, the leases, the records,
  the span sink and the other files of `data/` were not, so "the laws pass" is about 38 Node laws
  and 8 object laws, not the suite.
- **One hand mutant, no mutation run.** "Mutation reaches the logic" rests on one mutant with six
  failing laws, not on a StrykerJS sample.
- **Timing on a busy laptop,** in memory on Node, with a local workerd. The order held across two
  runs; the digits will not carry to production. Storage was tiny: no numbers for a large table.
- **Route W on Node** ran over a stand-in written for this spike, three laws.
- **The Alchemy patch sizes are estimates** from reading `D1/SQL.ts` and the adapter above. No
  patch was written against Alchemy.
- **beta.85 was read, not run.**
