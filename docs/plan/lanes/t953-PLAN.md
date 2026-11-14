Approved by the lead agent, builds 0526, 0170 and 0172 with the owner's answer to its one question; body f84faeb1f70e
Plancheck-Version: 3

# Ticket 953: one ReBAC core in `next/`, and a start checked against the member who caused it

```ts
// next/packages/libfabrika/src/permissions/Model.ts: fabrika's one model, declared once (0526).
export const Model = Rebac.make("fabrika")
  .type("person", {})
  .type("fabrika", {
    relations: { owner: ["person"], admin: ["person"], member: ["person"] }, // 0290's three roles
    permissions: { start: (p) => p.union("owner", "admin", "member") }, // 0170's first rule: any member
  });

// A right is a class. Its check gives a sealed proof tied to the one object it checked.
export class StartProgram extends Rebac.Permission<StartProgram>()("permissions/StartProgram", {
  model: Model,
  on: "fabrika",
  permission: "start",
}) {}

// One relation row on the ledger, stream `permissions/relations`, trusted only when the brain wrote it.
{ _tag: "related", subject: "person:person_01jc…", relation: "owner", object: "fabrika:demo" }

// processes/ChildrenLedger.ts: who sent the start's cause, the check in the turn, and a write that
// does not compile without the proof.
const sender = yield* senders.sender(from.parent, child.requester.process); // Option<Sender>, from the gateway
// in the look turn, for a sender: Result<Proof<StartProgram>, Denied>; Denied answers `forbidden`
const allowed = StartProgram.within(tuples, sender.value, Model.ref("fabrika", "demo"));
// then, in the write: place needs StartProgram in its context, so no proof means no compile
yield* place(child, from).pipe(Rebac.provide(allowed.success));
```

All of this is about `next/` only. Today's version is not touched.

## The answer first

One pull request, two slices. It builds what
[0526](.decisions/0526-one-rebac-permission-system.md) names as its first slice: the core, with
[0170](.decisions/0170-a-start-is-checked-against-its-sender.md)'s start check as its first real use.

- **Slice 1, the core.** A new libfabrika module, `permissions/`, on a new layer 3 between the
  ledger and the processes. It holds: relation rows on the ledger, one model declared once in code,
  a right as a typed class whose check gives a sealed `Proof`, a `Denied` error that carries who,
  what and which object, the in-turn check, and two layers of one `Relations` store, one on the
  ledger and one in memory for tests.
- **Slice 2, the start check (0170).** A start whose cause is an input delivered to the requester is
  checked against that input's sender, through the model, and no longer through `StartGrant`. The
  brain asks the gateway's one signing service who sent the cause (0262), checks `StartProgram` on
  this fabrika, and the start's write needs the proof. The `started` line records the member it was
  checked against. A start with no member's input behind it keeps today's `StartGrant` rule, which
  is the one open question below.
- **The runner does not change.** A start already carries its cause: the runner fills
  `From.parent` from the Cmd's letter (`runtime/Runner.ts:1517`, `from(job.parent, job.traceId)`),
  and that is the gateway's input id. The check moves to the brain's side, where the sender is
  known.
- **What does not move here:** the key tree's `under`, the mail grants, `personOnly`, and
  `StartGrant` itself. 0526 moves each one in its own pull request.
- **Start answers keep their shape.** A refused start is still `ChildrenError` with reason
  `forbidden`, and `start_child` still answers `err: "forbidden"`
  (0170's binding constraint).

## How others do it

- **Google's Zanzibar** (Pang et al., "Zanzibar: Google's Consistent, Global Authorization
  System", USENIX ATC 2019; not fetched this session). Relation tuples `object#relation@user`, a
  namespace config per object type with userset rewrites (`_this`, `computed_userset`,
  `tuple_to_userset`, union, intersection, exclusion), and one Check call. Its "new enemy" problem
  (a check that reads old tuples after a revoke) is answered with zookies, a snapshot at least as new
  as the change. This plan takes the tuple, the rewrite and one check. With one referee, the
  new-enemy answer is simpler: the check runs again in the turn that writes.
- **SpiceDB's schema** (authzed docs, "Schema Language"; not fetched this session):
  `definition document { relation viewer: user; permission view = viewer + editor }`, with `+`,
  `&`, `-` and `->`. The model builder here is that schema as one TypeScript value, so a name not in
  it does not compile. This slice builds `+` over relations and permissions of one object (Zanzibar's
  `_this` and `computed_userset` with union). `&`, `-` and `->` wait for their first real use; `->`
  comes with the key tree's move, whose `under` walk is a chain.
- **OpenFGA** (openfga.dev, "Contextual tuples"; not fetched): a check may carry tuples that are not
  stored. Not used here. It is the known way if a later case wants the session's own facts in a
  check.
- **Phoenix's [ADR 0107](https://github.com/kamp-us/phoenix/blob/main/.decisions/0107-capability-authz-framework.md)**
  and `packages/authz/src/` on its main, read this session. Each right is a class built by
  `Capability.Relation<Self>()(id, config)`, a `Context.Service<Tag, Grant<Self>>` underneath. The
  proof `Grant` is a branded plain object, never a Schema, made only by `mint`, which the package
  never exports. `Grant.provide(grant)` routes by a key stamped on the proof (amendment 1270), and
  the right's `Id` literal keeps two rights' proofs different types (issue 1483). An agent passes
  only when its human root passes and `AgentAuthority.admits` it. `Capability.typetest.ts` proves
  the R-channel law with `expectTypeOf`. Read and checked against the code: phoenix's
  `RelationStore.has` returns `Effect<boolean>` with no error, relation names are free strings
  (`MODERATES_RELATION = "moderates"`), the only rewrite is `ancestry` (a parent covers its
  children), the deny error carries only a message, and the `Grant`'s scope holds the resource but
  nothing rechecks it. This plan keeps phoenix's class, seal, `provide` and agent cap, and changes
  those five points. Its `.patterns/authz-capability-as-effect.md` was not read.
- **Effect's own pattern**, read in the installed `effect` 4.1.2:
  `node_modules/effect/ai-docs/src/51_http-server/fixtures/api/Authorization.ts` declares an
  `HttpApiMiddleware.Service` that `provides: CurrentUser` and fails with a `Schema.TaggedError`, and
  `fixtures/server/Authorization.ts` checks, then `Effect.provideService(httpEffect, CurrentUser,
  …)`. A whole API is one value (`HttpApi.make(...).add(...)`), which is why the model is one value.
  Services are `Context.Service`, errors are `Schema.TaggedError` with data. Effect has no
  permission package. The installed `AGENTS.md` shows a static `layer` on a service class; this
  repo's rule wins ([0095](.decisions/0095-a-service-file-holds-only-its-contract.md)): each layer
  is a sibling file.
- **Erlang/OTP and Unix.** Unix checks the user a process runs as, never the shell that called
  `exec`; trusting a program because requests pass through it is the confused deputy (Hardy, 1988),
  as 0170 says. Elm: the fold of rows is a tea machine stepped with `applyCell`, as `access/Access.ts`
  and `processes/internal/processTable.ts` are.

## What is decided, in one place

- [0526](.decisions/0526-one-rebac-permission-system.md), binding: one row shape on the ledger,
  one model declared once, a right as a typed class with a sealed proof tied to its object, the
  check in coordination, agents capped by their person, no outside server, no second system, no
  check on a free string. The first slice is this ticket. The API's exact shape and the package name
  are left to this plan.
- [0170](.decisions/0170-a-start-is-checked-against-its-sender.md): a start is checked against the
  member whose input caused it; `fabsh` and the desk hold no start permission of their own; the
  first rule lets any member start any program; the answer and refusals keep their shape.
- [0172](.decisions/0172-a-timers-start-is-its-owners.md): a restart or a boot start is the
  brain's own; a timer's start is the process owner's; a process keeps the member whose input
  started it. This slice records that member. The timer rule itself is not built here.
- [0261](.decisions/0261-inputs-carry-their-sender.md),
  [0262](.decisions/0262-a-write-carries-parent-and-traceid.md),
  [0263](.decisions/0263-a-writes-signer-is-its-causes-sender.md): the gateway stamps the sender,
  `parent` names the cause, and one signing service, owned by the gateway, answers who signs. The
  start asks that same service, so there is still one authority on who sent an input.
- [0290](.decisions/0290-one-owner-admins-and-members.md): one owner, admins and members. The model
  declares the three as relations on the fabrika object, as 0526 says.
- [0322](.decisions/0322-a-key-per-client-github-never-a-way-in.md),
  [0102](.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md),
  [0334](.decisions/0334-a-dropped-key-drops-all-below.md): the key tree decides who may dial, and a
  `hands` key never writes as a person. The gateway's `membership` already refuses a `hands` key as
  a writer (`gateway/Gateway.ts:365`), so no `hands` key can be a start's sender.
- [0225](.decisions/0225-entries-carry-what-writers-saw.md): `seen` never decides a grant. The
  check reads rows by the referee's order only.
- [0043](.decisions/0043-rooms-on-floors.md), [0091](.decisions/0091-modules-and-layers.md),
  [0062](.decisions/0062-test-files-keep-the-floors.md),
  [0046](.decisions/0046-one-tea-machine-per-file.md),
  [0209](.decisions/0209-schemas-are-effect-schema.md),
  [0214](.decisions/0214-unions-are-tagged-with-tag.md): placement, the fold as a tea machine,
  Effect Schema, `_tag`.

Choices this plan makes because a note already answers them (the
[open questions test](.agents/skills/plan/SKILL.md#the-open-questions-test)):

- **Where the module sits: a new layer 3.** The check runs inside the start's ledger turn, in
  `processes/`, so the module must sit below `processes/` and above `ledger/`. Layer numbers are
  whole numbers (code-graph 0.15.0 reads `layer` as an integer), so `permissions/` takes layer 3 and
  every row from `processes/` up moves up by one. No pair of existing rows changes order, so nothing
  that was refused becomes allowed. Law L19 proves that.
- **An agent in this slice.** 0526 caps an agent by its person. An agent's own standing is its key's
  admission in the key tree, which the gateway checks when it answers who sent the input
  (`SessionManager`'s `membership`). The relation half checks the agent's person. When the key tree
  moves onto rows, the agent's own row joins the check. Under 0170's first rule this gives the same
  answer as "any member".
- **Who writes the owner row.** The brain, at each project boot, under a fixed id. The referee
  answers a second write with the same `by`, `for`, `parent`, `_tag` and `body` as `resent`
  (`ledger/internal/ledgerStore.ts:115`), so one row is kept forever, and a ledger founded before
  this pull request gets its row at the next boot. `ClientManagerLedger` writes `founded` the same
  way, on first use, under a fixed id (`access/ClientManagerLedger.ts:97`).
- **The relations stream trusts only the brain.** As the process table trusts `by` alone
  (`ProcessManager.table`, "trusting only the brain's lines"), the fold skips every row whose `by`
  is not the brain's key. A program's write to the stream changes nothing.

## The shape

### The module and its layer

```text
next/packages/libfabrika/src/permissions/
  Rebac.ts              make (the model builder), Ref, Permission (the right builder), provide, recheck, Denied
  Model.ts              fabrika's one model and the StartProgram right
  Relation.ts           the row schemas, the stream name, Change, Tuples
  Relations.ts          the store's contract and RelationsError (0095: contract only)
  RelationsLedger.ts    the store on the ledger
  RelationsMemory.ts    the store in memory, for tests
  Senders.ts            Sender, the Senders port, SendersError
  internal/proof.ts     the sealed Proof and mint, @internal
  internal/evaluate.ts  the rewrite walk over Tuples, @internal
  internal/relationsTable.ts  the tea machine that folds rows into Tuples, @internal
```

`layer-rules.json` after the change. Only the numbers move; the order of every existing row is kept.

| Row | Before | After |
|---|---|---|
| `next-permissions` (new) | none | 3 |
| `next-processes` | 3 | 4 |
| `next-presence`, `next-jobs`, `next-packs` | 3 | 3 |
| `next-access` | 4 | 5 |
| `next-runtime` | 5 | 6 |
| `next-door`, `next-desktop-core`, `next-schedules` | 6 | 7 |
| `next-libfabrika-entry` | 7 | 8 |
| `next-workers` | 8 | 9 |
| `next-node` | 9 | 10 |

`permissions/` is a coordination part in the exam's parts table
(`next/apps/fabrika/src/exam/layers.test.ts`, `rowParts`): it imports only `ledger/`,
`telemetry/` and the shared files. `.oxlintrc.json` names it in `fabrika/modules`, in the
PascalCase and camelCase file rules, and in the `fabrika/no-static-layer` list from its first day.
`next/packages/libfabrika/package.json` exports `./permissions/*` and hides `./permissions/internal/*`.

### The model and the right

```ts
// permissions/Rebac.ts (sketch). A model is one value; its types carry every name.
type Ref<T extends string> = `${T}:${string}`;
interface Rewrites<Names extends string> {
  /** The subject holds any of these relations or permissions on the same object (Zanzibar's union). */
  readonly union: (...names: ReadonlyArray<Names>) => Rewrite;
}
interface Model<Types extends Record<string, { relations: Record<string, string>; permissions: string }>> {
  readonly name: string;
  readonly type: <T extends string, R extends Record<string, ReadonlyArray<keyof Types & string>>, P extends string>(
    name: T,
    shape: { readonly relations?: R; readonly permissions?: Record<P, (p: Rewrites<(keyof R | P) & string>) => Rewrite> },
  ) => Model<Types & Record<T, { relations: R; permissions: P }>>;
  readonly ref: <T extends keyof Types & string>(type: T, id: string) => Ref<T>;
}
export const make: (name: string) => Model<{}>;

/** A refusal: who was checked, for what, on which object. */
export class Denied extends Schema.TaggedError<Denied>()("Denied", {
  subject: Schema.String, // "person:person_01jc…"
  permission: Schema.String, // "start"
  object: Schema.String, // "fabrika:demo"
}) {}

/** The right builder: the class is the context tag, the proof type and the check. */
export const Permission: <Self>() => <const Id extends string, M extends Model<any>, On extends string, P extends string>(
  id: Id,
  config: { readonly model: M; readonly on: On; readonly permission: P },
) => PermissionClass<Self, Id, On>;
// PermissionClass carries Context.ServiceClass<Self, Id, Proof<Self>> (phoenix's Id brand, issue 1483) and:
//   within(tuples: Tuples, sender: Sender, object: Ref<On>): Result.Result<Proof<Self>, Denied>

/** Puts a proof into the context under its own right's key, as phoenix's Grant.provide does. */
export const provide: <P>(proof: Proof<P>) => <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, P>>;

/** Checks a proof again on newer rows: its own subject, permission and object, never another's. */
export const recheck: (proof: Proof<unknown>, tuples: Tuples) => boolean;
```

The five changes from phoenix, each in the code above: names come from the declared model;
rewrites are per permission; the store fails typed (`RelationsError`); `Denied` carries subject,
permission and object; a proof carries the object it checked and `recheck` reads that object.

### Rows and the fold

```ts
// permissions/Relation.ts
export const STREAM = "permissions/relations";
export const Row = Schema.TaggedUnion({
  related: { subject: Schema.NonEmptyString, relation: Schema.NonEmptyString, object: Schema.NonEmptyString },
  unrelated: { subject: Schema.NonEmptyString, relation: Schema.NonEmptyString, object: Schema.NonEmptyString },
});
/** One write: its entry id, chosen by the writer so a resend is one line, and its row. */
export type Change = { readonly id: string; readonly row: typeof Row.Type };
/** The live tuples, folded in the referee's order. Opaque outside the module. */
export type Tuples = { readonly [TuplesTypeId]: ReadonlySet<string> };

// permissions/Relations.ts (contract only, 0095)
export class RelationsError extends Schema.TaggedError<RelationsError>()("RelationsError", {
  reason: Schema.Literals(["bad_row", "storage"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
export class Relations extends Context.Service<
  Relations,
  {
    /** The live tuples inside the caller's own ledger turn. The memory layer ignores the turn. */
    readonly within: (turn: LedgerTurn) => Result.Result<Tuples, RelationsError>;
    /** Writes each change once, by its id, as the brain. */
    readonly write: (changes: ReadonlyArray<Change>, writer: Omit<Line, "_tag" | "body">) => Effect.Effect<void, RelationsError>;
  }
>()("@kampus/libfabrika/permissions/Relations") {}
```

- `RelationsLedger.layer({ by })` reads `STREAM` in the turn, steps the `relations` machine in
  `internal/relationsTable.ts` once per entry with `applyCell`, and skips an entry whose `by` is not
  `by` or whose tag is not a row case. A row that does not decode is `bad_row`. `write` runs one
  `LedgerTransaction` turn and appends each change with `by` replaced by the layer's own, as
  `ProcessManager`'s `line` does. A `LedgerError` becomes `RelationsError` with its cause kept
  (0043).
- `RelationsMemory.layer(changes)` folds the same machine over its changes, and `write` adds to
  them. It is the same fold, so law L8 compares the two layers.
- The machine's states: one Model, `{ tuples: ReadonlySet<string> }`, and one Msg,
  `{ type: "recorded", entry }`. `related` adds the tuple and `unrelated` removes it. No other state
  decides anything.

### The proof

```ts
// permissions/internal/proof.ts (@internal; only Rebac.ts imports it)
const ProofTypeId: unique symbol = Symbol.for("@kampus/libfabrika/permissions/Proof");
const KeyId: unique symbol = Symbol("@kampus/libfabrika/permissions/Proof/key"); // module-local, not Symbol.for
export interface Proof<out P> {
  readonly [ProofTypeId]: P;
  readonly sender: Sender; // who was checked, both ids kept (0261)
  readonly permission: string;
  readonly object: string; // the one object this proof is for
}
/** @internal The one way to make a proof: a check that passed. */
export const mint: <P>(sender: Sender, permission: string, object: string, key: Context.Key<P, Proof<P>>) => Proof<P>;
```

The proof is not a Schema, so nothing decodes one. `mint` stays in `internal/`, which no other
module may import (`fabrika/modules` and `no-restricted-imports`, today's rules).

### Who sent the start

```ts
// permissions/Senders.ts
export const Sender = Schema.TaggedUnion({
  person: { key: Schema.NonEmptyString, for: Schema.NonEmptyString }, // a person's window: checked as person:<for>
  agent: { key: Schema.NonEmptyString, for: Schema.NonEmptyString }, // an agent for a person: capped by person:<for>
});
export class SendersError extends Schema.TaggedError<SendersError>()("SendersError", {
  reason: Schema.Literals(["removed", "ended", "storage"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
/** The port the gateway fills (0262: one signing service answers who sent an input). */
export class Senders extends Context.Service<
  Senders,
  {
    /** Who sent `parent`, an input delivered to `process`; none when no member's input delivered there is behind it. */
    readonly sender: (parent: string | null, process: string) => Effect.Effect<Option.Option<Sender>, SendersError>;
  }
>()("@kampus/libfabrika/permissions/Senders") {}
```

- `access/SessionManager.ts` gains `sender(parent, process)`: the `Writer` of a saved input that is
  delivered to that process, after `membership` says its key still belongs. It refuses
  `not_delivered` and `ended` as `signer` does, and fails `NotGranted` when the key is gone. It takes
  no `SignRequest` and writes no receipt, so a later `signer` for the same input is untouched.
- `access/SessionSenders.ts` makes the `Senders` service from any such `sender` function: a `null`
  parent and `not_delivered` are none, `NotGranted` is `removed`, `ended` is `ended`, and a
  `LedgerError` is `storage` with its cause.
- `gateway/Gateway.ts` gains `sender(process, parent)` on its contract (the door's
  `GatewayCalls` in `cloudflare/bindings.ts` gets the same member), answered by the gateway's own
  `sessions`, beside `signer` and `sign`.

### The start check

`ChildrenLedger.layer({ grants, fabrika })` now needs `Relations` and `Senders` as well. The order a
start is judged in stays today's, with the permission step where the grant step was:

1. The name, then the rest of the request, as today.
2. Outside any turn: `senders.sender(from.parent, child.requester.process)`, kept as a `Result`, so
   it decides nothing before step 3. A `storage` failure fails the start as `storage`.
3. The look turn: a saved `id` answers its `started`, whatever happened since (unchanged). Then the
   requester must be live (unchanged). Then the permission step:
   - a sender: `StartProgram.within(relations.within(turn), sender, fabrika)`; `Denied` is
     `forbidden`. `StartGrant` is not read.
   - no sender: `granted(requester's program, child's program)`, today's rule, unchanged.
   - `removed`: `forbidden`. `ended`: `stale_sender`.
   Then whereis, unchanged.
4. The write turn. A sender's start runs `place` under `Rebac.provide(proof)`. `place` reads the
   proof from its context, writes `member: proof.sender` into the `first` start, and hands
   `ProcessManager.start` a guard, `(turn) => Rebac.recheck(proof, relations.within(turn))`. A
   guard that says no fails the turn with `ProcessError` reason `forbidden`, and nothing is written;
   `ChildrenLedger` answers that as `forbidden`. A no-sender start places as today, with no guard.

```ts
// processes/ChildrenLedger.ts (sketch). The write needs the proof; without provide, R keeps StartProgram.
const place = Effect.fnUntraced(function* (child: Child, from: From) {
  const proof = yield* StartProgram; // Effect.Effect<…, …, StartProgram>
  return yield* manager.start(
    Start.cases.first.make({ id: child.id, name: child.name, code: child.code, requester: child.requester, member: proof.sender }),
    from,
    child.input === undefined ? undefined : { m: child.input },
    (turn) => Result.match(relations.within(turn), { onSuccess: (t) => Rebac.recheck(proof, t), onFailure: () => false }),
  );
});
yield* place(child, from).pipe(Rebac.provide(proof)); // remove this provide and tsgo fails the file
```

- `processes/internal/processTable.ts`: `Start.first` and the `started` event gain
  `member: Schema.optionalKey(Sender)`. Old rows decode unchanged.
- `processes/ProcessManager.ts`: `start(request, from, first?, guard?)`; the guard runs in the turn
  that writes, after `table.start`'s own checks.
- `processes/Process.ts`: `ProcessError`'s reasons gain `forbidden`.
- `processes/Children.ts`: the `forbidden` doc says what refuses now, and the layer's config type
  gains `fabrika: Ref<"fabrika">`. `Child`, `Started` and `ChildrenError` keep their shape.
- Spans: the start's span gains `fab.permissions.subject`, `fab.permissions.permission`,
  `fab.permissions.object` and `fab.permissions.outcome` (`allowed`, `denied`, `granted` or
  `ungranted`). These are ids, never secrets; the safe tracer in `ChildrenLedger.ts` keeps them.

### Wiring, in `cloudflare/runtime.ts`

- `RelationsLedger.layer({ by })` joins the project's layers, beside `ClientManagerLedger`.
- At boot, after the managers are built, the brain writes the owner row:
  `{ id: "owner", row: related { subject: "person:<config.person>", relation: "owner", object: "fabrika:<name>" } }`.
- `ChildrenLedger` leaves `managers` and is built after `door`, the way `ProgramMail` is built
  apart today (`cloudflare/runtime.ts:667`), with
  `Senders` from `SessionSenders.make(door.sender)` and `fabrika: Model.ref("fabrika", name)`.
  Only `child()` uses `children` (`cloudflare/runtime.ts:923`), and it runs after `door` exists.

## One value traced through

The founding person, `person_01jc…`, types a line in `fabsh:1` that starts `notes`. No
`StartGrant` names `fabsh` (the `starts` setting is empty by default).

1. The gateway stamps the input `input_01jd…` with `Writer.person({ key: "SHA256:win-a", for:
   "person_01jc…" })` and delivers it to `fabsh:1`'s process `process_01je…`.
2. `fabsh`'s step returns `start_child({ program: "notes", name: "notes:1" })`. The runner saves the
   Cmd with `parent: "input_01jd…"` and calls `Children.start(child, from)`, where
   `from.parent = "input_01jd…"` and `child.requester = process_01je…`. Nothing here is new.
3. In the brain, `senders.sender("input_01jd…", "process_01je…")`: the gateway finds the input,
   delivered to that process, and its key `SHA256:win-a` still belongs. Answer:
   `Option.some(Sender.person({ key: "SHA256:win-a", for: "person_01jc…" }))`.
4. Look turn: no saved start under this id; the requester is live;
   `relations.within(turn)` holds `person:person_01jc…#owner@fabrika:demo` (written at boot);
   `StartProgram.within(…, sender, "fabrika:demo")` walks `start = owner + admin + member`, finds
   `owner`, and answers a proof `{ sender, permission: "start", object: "fabrika:demo" }`. Main
   answered `forbidden` here: no grant from `fabsh` to `notes`.
5. Write turn: `place` reads the proof, the guard rechecks it on the rows of this turn (still there),
   and the turn writes `registered`, then `started` with `member: { _tag: "person", key:
   "SHA256:win-a", for: "person_01jc…" }`.
6. The runner answers the Cmd `start_child_ok` with `started`. The span says
   `fab.permissions.outcome = allowed`, subject `person:person_01jc…`, object `fabrika:demo`.

The same line, typed by an agent let in for the same person: step 3 answers `Sender.agent`, step 4
checks `person:person_01jc…` (the cap), and the `started` line keeps the agent's key. If the agent's
key was removed between its input and the start, step 3 answers `removed`, and step 4 answers
`forbidden`, with nothing written.

## The four lists in this slice

| List | Today | In this pull request | Moves in |
|---|---|---|---|
| The key tree's `under` (`access/Access.ts`, `admitted` at line 716) | decides who may dial | unchanged; it is also the agent's own half of the cap, through the gateway's `membership` | its own pull request, with the `->` rewrite and agent rows |
| `StartGrant` (`processes/Children.ts:33`, checked at `ChildrenLedger.ts:85`) | every start | only a start with no member's input behind it | its own pull request, after the open question |
| Mail grants (`processes/ProgramMailLedger.ts`) | every letter between programs | unchanged | its own pull request |
| `personOnly` (`gateway/Gateway.ts:304`, `runtime/Runner.ts:1997`) | person-only inputs | unchanged | its own pull request |

No list grows a second home: each fact still has one source. `StartGrant` stops deciding the starts
0170 gave to the member, which is the change 0170 asks for.

## Laws

Every property law with a seed uses 119120. "Rows" in L1 are generated relation histories: entries
of `related` or `unrelated` over 3 persons and 2 fabrikas, written by the brain or by another key,
0 to 30 long. The oracle in L1 is written in the test from Zanzibar's set meaning, never from the
product's fold or walk.

| # | Law | Kind (lint, type or test) | Generator | Plant | Fails on main |
|---|---|---|---|---|---|
| L1 | For any rows and any subject, permission and object of the test model, `within` gives a proof exactly when the oracle's set of holders (live tuples by the brain, closed under union) holds the subject | test, 200 runs, seed 119120 | fc.array: row histories as above, with fc.constantFrom picks of subject, permission and object | the fold applies a row whatever its `by` | no: new module |
| L2 | A model whose permissions name each other in a loop ends every check, and a loop alone never holds | test, 100 runs | fc.array: rows over a test model where `a = b + x` and `b = a + y` | the walk drops its visited set | no: new module |
| L3 | Every `Denied` carries the subject, permission and object that were asked, exactly | test, 100 runs | fc.array: row histories as in L1, with denied picks only | `Denied` takes its object from the model's first declared type | no: new module |
| L4 | A proof is tied to its object: after a row for object A is removed, `recheck` of A's proof says no, and a proof for B is untouched; `proof.object` is the object checked | test, 100 runs, seed 119120 | fc.tuple: two objects, a row history, and a removal of one object's row | `recheck` checks the object of the last `within` call | no: new module |
| L5 | An Effect that yields `StartProgram` keeps it in its requirements; `Rebac.provide(proof)` removes it; a proof of another right does not have the same type | type | type | widen the right's `Id` to `string` in `Permission` (phoenix issue 1483) | no: new module |
| L6 | A type, relation or permission name that the model does not declare does not compile: `Model.ref("window", …)`, `p.union("drive")`, and a right `on: "fabrika"` with `permission: "view"` | type | type | type the builder's names as `string` | no: new module |
| L7 | No code outside the module can make a proof: an object literal of `Proof` and a call of `mint` from outside both fail | type | type | export `mint` from `Rebac.ts` | no: new module |
| L8 | The memory layer and the ledger layer agree: the same changes, with resent and reused ids, give the same `within` answer for every tuple, and the ledger skips rows by another writer | test, 100 runs, seed 119120 | fc.array: batches of changes, 0 to 20, with ids reused | the memory layer ignores `unrelated` | no: new module |
| L9 | `sender(parent, process)` answers the same writer `signer` would sign for that input, refuses in the same cases, and writes no receipt: a `signer` after any number of `sender` calls still answers | test, 100 runs, seed 119120 | fc.array: cells of record, delivered, end, key removed, sender and signer, 1 to 30 long | implement `sender` by calling `signer` with a fixed kind | yes: `sender` does not exist |
| L10 | A start whose cause is an input delivered to the requester is started exactly when the sender's person holds `start` on the fabrika, whatever the requester's program and whatever `StartGrant` says, empty list included | test, 100 runs, seed 119120 | fc.record: grants (0 to 4), sender (founding person, another person, an agent for either), owner row present or not, child program | also require `granted(program, program)` for a sender's start | yes: main answers `forbidden` for every ungranted program |
| L11 | A start with no member's input behind it (`parent` null, or an input delivered to another process) answers exactly what main answers, by `StartGrant` | test, 100 runs | fc.record: grants (0 to 4), parent null or another process's input, child program | treat no sender as allowed | no: it pins today's rule |
| L12 | A sender whose key was removed is refused `forbidden` even when a grant would let the program through, and a retry of a saved start id still answers its `started` after the removal | test, 50 runs | fc.record: grants, which key is removed, and whether the start was saved before | judge the sender before the saved-id check | no: new path |
| L13 | A refusal keeps its shape: every refused start in L10 to L12 is `ChildrenError` with reason `forbidden` and no cause, writes nothing, and its span says reason `forbidden`; through `start_child` the Cmd answers `err: "forbidden"`, the same as a `StartGrant` refusal | test, 100 runs, seed 119120 | fc.record: the L10 to L12 cases that refuse | map `Denied` to a new reason `denied` | no: pins 0170's constraint |
| L14 | The `started` line of a sender's start names that sender as `member`, both ids kept, and a start with no sender has no `member` | test, 100 runs | fc.record: sender kinds as in L10, and no-sender starts | write the requester's process as `member` | yes: main has no `member` |
| L15 | A relation removed between the look turn and the write turn refuses the start `forbidden`, and nothing is written | test | scenario: a gate holds the start after its look turn; the memory store writes `unrelated` for the owner; the gate opens | drop the guard from `place` | no: new path |
| L16 | The write step of a sender's start does not compile without its proof | type | type | delete `.pipe(Rebac.provide(...))` in `ChildrenLedger.ts`: tsgo reports `StartProgram` missing from the context | no: new path |
| L17 | On a real local instance with no start grants, a person's input makes `p42/starter` start `p42/child`; the child's `started` line names the person as `member`; after two boots `permissions/relations` holds one owner row by the brain | test | scenario: `start-child.test-support.ts`'s instance with `starts: []`, booted twice | the boot writes the owner row with `sentAt` in its body, so the second boot is refused `id_reused` | yes: main answers `forbidden` |
| L18 | On the same instance, an input whose sender's key is removed before its step runs makes the start answer `err: "forbidden"` through `start_child` | test | scenario: grant an agent, send its input, remove the agent, let the step run | treat `removed` as no sender | no: new path |
| L19 | The renumbered layers keep every existing pair's order: for each two rows that had layers on main, one is below the other after exactly when it was before | test | pinned: main's layer table at 85cb7c224 | put `next-access` on layer 4, beside `next-processes` | no: guards the move |

What stays green, unchanged in what it checks: `processes/ChildrenTest.ts`,
`processes/ProgramMailTest.ts`, `runtime/StartChildTest.ts` through `node/StartChild.test.ts`, and
`next/apps/fabrika/src/start-child.laws.test.ts`. Their starts carry no member's input to the
requester (the Children suites call `start` with a made-up `From`; `StartChildTest`'s person inputs
are given a `Senders` that answers none), so they keep exercising `StartGrant`. The tests step adds
the new layer requirements to each (`RelationsMemory.layer([])`, a `Senders` that answers none,
and a `fabrika` ref) and changes nothing they assert. The test fakes of the door add `sender`
(`node/IsolateUsage.test.ts`, `node/RunnerAdmission.test.ts`, `cloudflare/ProjectAuditTest.ts`,
and any other fake the typecheck names).

Lint, type or test: L5, L6, L7 and L16 are type laws, held by `pnpm typecheck` in `*.types.test.ts`
files with `expectTypeOf` and `@ts-expect-error`, as `access/ClientManager.types.test.ts` does.
Who may import `internal/proof.ts` is today's lint (`fabrika/modules`). Which way imports point is
today's `pnpm lint:layers`. No new lint rule.

No host-only law. L17 and L18 run a real local instance, as `start-child.laws.test.ts` does today
in CI; they touch no launchd, no Electron and no owner's Mac.

## Is it a setting?

- The model: no. 0526 says one model, declared once in code. A `fabrika.toml` copy would be a second
  declaration.
- The first rule, any member: no. 0170 says a smarter rule changes the rule in code.
- The stream name, the owner row's id and the fabrika object's id: no. Each is fixed by the code
  that reads it, and the object's id is the instance name the host already hands in.
- A walk depth: there is none. A visited set ends loops (L2), as `Access`'s `chainLive` does, so no
  number needs a source.
- `StartGrant`'s list: unchanged, still a right the host hands in, "never a declared setting"
  (`settings/Start.ts:59`).

## Files and ownership

| File | Owner | Slice | Product lines expected | What |
|---|---|---|---|---|
| `next/packages/libfabrika/src/permissions/Rebac.ts` | build | 1 | 150 | `make`, `Ref`, `Permission`, `provide`, `recheck`, `Denied` |
| `next/packages/libfabrika/src/permissions/Model.ts` | build | 1 | 25 | fabrika's model and `StartProgram` |
| `next/packages/libfabrika/src/permissions/Relation.ts` | build | 1 | 40 | `STREAM`, `Row`, `Change`, `Tuples` |
| `next/packages/libfabrika/src/permissions/Relations.ts` | build | 1 | 35 | the store's contract and `RelationsError` |
| `next/packages/libfabrika/src/permissions/RelationsLedger.ts` | build | 1 | 60 | the ledger layer |
| `next/packages/libfabrika/src/permissions/RelationsMemory.ts` | build | 1 | 35 | the memory layer |
| `next/packages/libfabrika/src/permissions/Senders.ts` | build | 1 | 40 | `Sender`, `Senders`, `SendersError` |
| `next/packages/libfabrika/src/permissions/internal/proof.ts` | build | 1 | 35 | the sealed `Proof` and `mint` |
| `next/packages/libfabrika/src/permissions/internal/evaluate.ts` | build | 1 | 50 | the union walk with a visited set |
| `next/packages/libfabrika/src/permissions/internal/relationsTable.ts` | build | 1 | 50 | the `relations` tea machine |
| `next/packages/libfabrika/package.json` | build | 1 | 2 | export `./permissions/*`, hide `./permissions/internal/*` |
| `.glossary/TERMS.md` | build | 1, 2 | docs | rows `proof` and `model (permissions)`; `relation` names its stream and its one writer; `process owner` says it is recorded as `member` on the `started` line |
| `next/packages/libfabrika/src/access/SessionManager.ts` | build | 2 | 35 | `sender` on the contract and in its layer |
| `next/packages/libfabrika/src/access/SessionSenders.ts` | build | 2 | 35 | `Senders` from a `sender` function |
| `next/packages/libfabrika/src/gateway/Gateway.ts` | build | 2 | 10 | `sender` on the contract and in `make` |
| `next/packages/libfabrika/src/cloudflare/bindings.ts` | build | 2 | 5 | `sender` on `GatewayCalls` |
| `next/packages/libfabrika/src/processes/Children.ts` | build | 2 | 8 | the `forbidden` doc; `fabrika` in the layer's config type |
| `next/packages/libfabrika/src/processes/ChildrenLedger.ts` | build | 2 | 70 | the sender, the permission step, `place` under the proof, the guard, spans |
| `next/packages/libfabrika/src/processes/ProcessManager.ts` | build | 2 | 15 | the `guard` argument and `member` on `started` |
| `next/packages/libfabrika/src/processes/Process.ts` | build | 2 | 2 | `ProcessError` reason `forbidden` |
| `next/packages/libfabrika/src/processes/internal/processTable.ts` | build | 2 | 6 | `member` on `Start.first` and `started` |
| `next/packages/libfabrika/src/cloudflare/runtime.ts` | build | 2 | 30 | the relations layer, the owner row at boot, `ChildrenLedger` after `door` |
| `docs/plan/tier-1.md` | build | 2 | docs | line 87's "not built" becomes built, with what `StartGrant` still judges |
| `layer-rules.json` | tests | 1 | tests | the new row and the renumbered layers |
| `.oxlintrc.json` | tests | 1 | tests | `permissions` in the module, file-name and no-static-layer rules |
| `next/apps/fabrika/src/exam/layers.test.ts` | tests | 1 | tests | the pinned table, `rowParts`, and L19 |
| `next/packages/libfabrika/src/permissions/Rebac.test.ts` | tests | 1 | tests | new: L1 to L4 |
| `next/packages/libfabrika/src/permissions/Rebac.types.test.ts` | tests | 1 | tests | new: L5 to L7 |
| `next/packages/libfabrika/src/permissions/RelationsTest.ts` | tests | 1 | tests | new: L8 as `suite(open)` |
| `next/packages/libfabrika/src/node/Relations.test.ts` | tests | 1 | tests | new: runs L8 on node:sqlite (0062) |
| `next/packages/libfabrika/src/access/SessionSender.test.ts` | tests | 2 | tests | new: L9 on node:sqlite, as `SessionManager.test.ts` opens it |
| `next/packages/libfabrika/src/processes/ChildrenMemberTest.ts` | tests | 2 | tests | new: L10 to L15 as `suite(open)` |
| `next/packages/libfabrika/src/node/ChildrenMember.test.ts` | tests | 2 | tests | new: runs that suite |
| `next/packages/libfabrika/src/processes/Children.types.test.ts` | tests | 2 | tests | new: L16 |
| `next/apps/fabrika/src/start-member.laws.test.ts` | tests | 2 | tests | new: L17, L18 |
| `next/apps/fabrika/src/start-child.test-support.ts` | tests | 2 | tests | a second boot and a key removal, if the support lacks them |
| `next/packages/libfabrika/src/processes/ChildrenTest.ts` `next/packages/libfabrika/src/processes/ProgramMailTest.ts` `next/packages/libfabrika/src/node/StartChild.test.ts` | tests | 2 | tests | the new layer requirements only; no assertion changes |
| `next/packages/libfabrika/src/node/IsolateUsage.test.ts` `next/packages/libfabrika/src/node/RunnerAdmission.test.ts` `next/packages/libfabrika/src/cloudflare/ProjectAuditTest.ts` | tests | 2 | tests | the fake doors add `sender` |
| `next/apps/fabrika/src/start-child.laws.test.ts` `next/packages/libfabrika/src/runtime/StartChildTest.ts` `next/packages/libfabrika/src/access/SessionManager.test.ts` `next/packages/libfabrika/src/node/Children.test.ts` `next/packages/libfabrika/src/node/ProgramMail.test.ts` | tests | 2 | tests | not edited: existing laws, run to show they stay green |

Placement by `next/AGENTS.md`'s libfabrika test: any client of libfabrika that runs a brain needs
the model, the check and the start rule, so nothing goes in `next/apps/fabrika`. The rights a
window's inputs need are declared later by the app, against the same model, as 0526 says.

## Validation

The tests and build steps run only the named files, under `nice -n 19` with `--maxWorkers=1`:

```sh
nice -n 19 pnpm exec vitest run --maxWorkers=1 \
  next/packages/libfabrika/src/permissions/Rebac.test.ts \
  next/packages/libfabrika/src/node/Relations.test.ts \
  next/packages/libfabrika/src/access/SessionSender.test.ts \
  next/packages/libfabrika/src/access/SessionManager.test.ts \
  next/packages/libfabrika/src/node/ChildrenMember.test.ts \
  next/packages/libfabrika/src/node/Children.test.ts \
  next/packages/libfabrika/src/node/StartChild.test.ts \
  next/packages/libfabrika/src/node/ProgramMail.test.ts \
  next/apps/fabrika/src/exam/layers.test.ts \
  next/apps/fabrika/src/start-member.laws.test.ts \
  next/apps/fabrika/src/start-child.laws.test.ts
```

The tests step shows L9, L10, L14 and L17 red on main with what they print; the rest are red only
because the module and the new path do not exist. The type laws are proved by the lead's one
typecheck, not inside a box. Every new product line keeps `fabrika/jsdocs`: each export carries its
doc block. The lead runs the `--changed` pass and the one typecheck, and reads the `loosening.sh`
hit that `layer-rules.json` and `layers.test.ts` will raise: the move changes numbers only, and L19
proves no pair changed order.

No window changes, so no screenshots.

## What this records

- From this pull request on, every child start that a member's input caused names that member on
  its `started` line, as `member`, with both the key and the person (0261). This is the fact lost
  forever if it waits: 0172's process owner, which a timer's start will be checked against. A start
  made without it never gets it.
- Every start's span records who was checked, for what permission, on which object, and the
  outcome. Spans and their measurement rows are kept forever
  ([0202](.decisions/0202-spans-and-measurements-kept-forever.md)), so a refusal's who and what can
  be read later. No body and no secret is in them.
- The owner relation row, by the brain, once per ledger.
- `.glossary/TERMS.md` and `docs/plan/tier-1.md`, as in the files table.

## Size

1. Slice 1, the core (`permissions/`, its layer and lint rows, the glossary rows): 522 lines.
2. Slice 2, the start check (the gateway's `sender`, the Children check, the `member` field, the
   wiring, the plan line): 216 lines.

About 738 product lines and about 2,200 test lines over 11 new test files and 8 edited ones, about
7 agent hours. 70% sure of the size: `Rebac.ts`'s types (names carried through the builder, the Id
brand) are the unknown part; phoenix's `Capability.ts` needed one audited cast for the same reason,
and ours may need more lines to keep names exact.

Priced from `field/runs.jsonl`, the last 800 rows, list price: a tests step's median is $1.14 and
its 90th percentile $3.10; a build's median $1.24, 90th percentile $2.23; a review's median $1.14,
90th percentile $2.16. This tests step writes eleven files and edits eight, so about $3.50; the build
about $2.50; the review about $2; one likely send-back, a fix round and the same reviewer's
recheck, about $3.

Estimate: 4 steps, $11

## What this cannot tell us

- Whether a mail chain should carry its member. A start in program B caused by mail from program A,
  itself caused by a person's input to A, has no member's input delivered to B, so it keeps today's
  `StartGrant` rule. That is the open question; the laws pin today's answer, not the right one.
- The gateway answers who sent an input before the look turn, in its own store. A key removed after
  that answer and before the write is not seen by that start, the same gotcha `SessionManager`'s
  `signer` documents today. The relation rows are rechecked in the write turn (L15); the key's
  admission is not, until the key tree moves onto rows.
- Cost at scale. Every check reads the whole `permissions/relations` stream in its turn, as
  `appendAdmitted` reads all of `gateway/access`. With one owner row that is one row. A per-member
  row count in Tier 3 is when to measure; 0526 names a deep, changing tree as the trigger to
  reconsider.
- A Durable Object's billed rows for the extra read were not measured; every law here runs on
  node:sqlite or the local instance.
- Whether the builder's types stay readable once a second type with five relations is declared.
  L6 proves names are checked; it does not prove the error messages are kind.

## Answered questions

1. A start with no member's input delivered to its requester (a step on a timer or a signal with
   `parent` null, a step on mail from another program, or a boot process's own start): the owner
   chose (c) on 2026-11-14. The requester's process owner, its recorded `member`, is checked when one
   is recorded, else today's `StartGrant` program rule. This slice builds (c) in its one function in
   `ChildrenLedger.ts`, with one more law, L20: for any generated no-member start, a recorded owner
   is checked as that member (a removed relation refuses, `forbidden`), and with no recorded owner the
   program rule decides as before. Its plant: the function ignores the recorded owner, and L20 goes
   red.

## Open questions

None.
