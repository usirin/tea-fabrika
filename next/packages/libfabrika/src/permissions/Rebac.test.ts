// T953 slice 1, next/: the permission core's laws L1 to L4, through its public names only: a model
// built with `Rebac.make`, rights built with `Rebac.Permission`, live tuples read through the
// `Relations` store's ledger layer, `within`, `recheck` and `Denied`.
//
// The ledger layer reads `permissions/relations` inside the caller's turn. Here that turn is a
// stand-in that serves a generated history, so each run folds its rows with no database; the real
// store is L8's (`RelationsTest.ts`, on node:sqlite). Every oracle is written here from Zanzibar's
// set meaning (Pang et al., USENIX ATC 2019): a relation's holders are its live tuples, written by
// the brain, in the referee's order; a permission's holders are the union of its names' holders.
// Never the product's fold or walk.
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Result, Schema } from "effect";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import type { Entry } from "../ledger/Log.ts";
import { Model, StartProgram } from "./Model.ts";
import * as Rebac from "./Rebac.ts";
import { STREAM, type Tuples } from "./Relation.ts";
import { Relations } from "./Relations.ts";
import * as RelationsLedger from "./RelationsLedger.ts";
import { Sender } from "./Senders.ts";

const SEED = 119120;
const BRAIN = "SHA256:brain";
const ROGUE = "SHA256:window-a";
const PERSONS = ["person_a", "person_b", "person_c"] as const;
const FABRIKAS = ["demo", "other"] as const;
const RELATIONS = ["owner", "admin", "member"] as const;
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

/** A second model of the same shape, with permissions that name relations and other permissions. */
const Test = Rebac.make("test")
  .type("person", {})
  .type("fabrika", {
    relations: { owner: ["person"], admin: ["person"], member: ["person"] },
    permissions: {
      start: (p) => p.union("owner", "admin", "member"),
      manage: (p) => p.union("owner", "admin"),
      own: (p) => p.union("owner"),
      review: (p) => p.union("manage", "member"),
    },
  });

class TestStart extends Rebac.Permission<TestStart>()("permissions/test/TestStart", {
  model: Test,
  on: "fabrika",
  permission: "start",
}) {}

class Manage extends Rebac.Permission<Manage>()("permissions/test/Manage", {
  model: Test,
  on: "fabrika",
  permission: "manage",
}) {}

class Own extends Rebac.Permission<Own>()("permissions/test/Own", {
  model: Test,
  on: "fabrika",
  permission: "own",
}) {}

class Review extends Rebac.Permission<Review>()("permissions/test/Review", {
  model: Test,
  on: "fabrika",
  permission: "review",
}) {}

/** The oracle's copy of each permission: the names it is the union of. A name with no row is a relation. */
const UNIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  start: ["owner", "admin", "member"],
  manage: ["owner", "admin"],
  own: ["owner"],
  review: ["manage", "member"],
};

/** Each right with the permission name the oracle reads, the real `StartProgram` first. */
const RIGHTS = [
  { right: StartProgram, permission: "start" },
  { right: TestStart, permission: "start" },
  { right: Manage, permission: "manage" },
  { right: Own, permission: "own" },
  { right: Review, permission: "review" },
] as const;

/** One generated history row: a row case or another tag, by the brain or by another key. */
const HistoryRow = Schema.Struct({
  _tag: Schema.Literals(["related", "unrelated", "noted"]),
  by: Schema.Literals([BRAIN, ROGUE]),
  person: Schema.Literals(PERSONS),
  relation: Schema.Literals(RELATIONS),
  fabrika: Schema.Literals(FABRIKAS),
});
type HistoryRow = typeof HistoryRow.Type;
const History = Schema.Array(HistoryRow).check(Schema.isMaxLength(30));

const personRef = (person: string) => `person:${person}`;
const fabrikaRef = (fabrika: string) => `fabrika:${fabrika}`;
const tupleKey = (subject: string, relation: string, object: string) => `${subject}#${relation}@${object}`;

/** One row as the ledger holds it: its case, its writer, and its tuple's three names. */
type Raw = {
  readonly _tag: string;
  readonly by: string;
  readonly subject: string;
  readonly relation: string;
  readonly object: string;
};

const raw = (row: HistoryRow): Raw => ({
  _tag: row._tag,
  by: row.by,
  subject: personRef(row.person),
  relation: row.relation,
  object: fabrikaRef(row.fabrika),
});

/** The rows as ledger entries of the relations stream, in order. */
const entries = (rows: ReadonlyArray<Raw>): ReadonlyArray<Entry> =>
  rows.map((row, n) => ({
    id: `row-${n}`,
    stream: STREAM,
    pos: n + 1,
    rev: n + 1,
    arrivedAt: 1_763_100_000_000 + n,
    by: row.by,
    for: PERSONS[0],
    sentAt: "2026-11-14T09:00:00.000Z",
    seen: n,
    parent: null,
    traceId: TRACE,
    build: "test-build",
    _tag: row._tag,
    body: { subject: row.subject, relation: row.relation, object: row.object },
  }));

/** A ledger turn that serves these rows and appends nothing. */
const turnFrom = (rows: ReadonlyArray<Raw>): LedgerTurn => {
  const all = entries(rows);
  return {
    read: (stream, after) => all.filter((entry) => entry.stream === stream && entry.pos > after),
    append: () => {
      throw new Error("these laws only read");
    },
  };
};

/** The oracle's live tuples: the brain's `related` adds, its `unrelated` removes, in order; nothing else counts. */
const live = (rows: ReadonlyArray<HistoryRow>): ReadonlySet<string> => {
  const tuples = new Set<string>();

  for (const row of rows) {
    const tuple = tupleKey(personRef(row.person), row.relation, fabrikaRef(row.fabrika));

    if (row.by === BRAIN && row._tag === "related") {
      tuples.add(tuple);
    }

    if (row.by === BRAIN && row._tag === "unrelated") {
      tuples.delete(tuple);
    }
  }

  return tuples;
};

/** The oracle's answer: the subject holds the name on the object, by its union, never visiting a name twice. */
const holds = (
  tuples: ReadonlySet<string>,
  unions: Readonly<Record<string, ReadonlyArray<string>>>,
  subject: string,
  name: string,
  object: string,
  visited: ReadonlySet<string> = new Set(),
): boolean => {
  const names = unions[name];

  if (names === undefined) {
    return tuples.has(tupleKey(subject, name, object));
  }

  return (
    !visited.has(name) &&
    names.some((each) => holds(tuples, unions, subject, each, object, new Set([...visited, name])))
  );
};

/** The store's ledger layer, as the brain reads it. Its `write` is not used by these laws. */
const relations = Effect.gen(function* () {
  const context = yield* Layer.build(
    RelationsLedger.layer({ by: BRAIN }).pipe(
      Layer.provide(
        Layer.succeed(LedgerTransaction, {
          transact: () => Effect.die("these laws only read"),
        }),
      ),
    ),
  );
  return Context.get(context, Relations);
});

/** The live tuples the store folds from these rows. */
const tuplesFrom = (store: Relations["Service"], rows: ReadonlyArray<HistoryRow>): Tuples => {
  const answer = store.within(turnFrom(rows.map(raw)));
  expect(Result.isSuccess(answer), "a history of well-formed rows always folds").toBe(true);
  return Result.getOrThrow(answer);
};

/** Every sender the laws ask about: each person's window and an agent for each person. */
const SENDERS = PERSONS.flatMap((person) => [
  { person, sender: Sender.cases.person.make({ key: `SHA256:win-${person}`, for: person }) },
  { person, sender: Sender.cases.agent.make({ key: `SHA256:agent-${person}`, for: person }) },
]);

describe("T953 slice 1: the permission core", () => {
  // L1. Plant: the fold applies a row whatever its `by`; a rogue key's `related` row then gives a proof.
  it.effect.prop(
    "L1: within gives a proof exactly when the subject is among the oracle's holders, by the brain's live tuples closed under union",
    [History],
    ([rows]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* relations;
          const tuples = tuplesFrom(store, rows);
          const truth = live(rows);

          for (const { right, permission } of RIGHTS) {
            for (const { person, sender } of SENDERS) {
              for (const fabrika of FABRIKAS) {
                const object = Model.ref("fabrika", fabrika);
                const answer = right.within(tuples, sender, object);
                const expected = holds(truth, UNIONS, personRef(person), permission, fabrikaRef(fabrika));
                expect(Result.isSuccess(answer), `${permission} for ${sender._tag} ${person} on ${object}`).toBe(
                  expected,
                );

                if (Result.isSuccess(answer)) {
                  expect(answer.success.sender).toEqual(sender);
                  expect(answer.success.permission).toBe(permission);
                  expect(answer.success.object).toBe(object);
                }
              }
            }
          }
        }),
      ),
    { arbitrary: { seed: SEED, runs: 200, size: 100 } },
  );

  // L2. A model whose permissions name each other in a loop: `a = b + x`, `b = a + y`, and `c = d`,
  // `d = c` alone. Plant: the walk drops its visited set; the check then never ends (a stack overflow).
  const Loop = Rebac.make("loop")
    .type("person", {})
    .type("thing", {
      relations: { x: ["person"], y: ["person"] },
      permissions: {
        a: (p) => p.union("b", "x"),
        b: (p) => p.union("a", "y"),
        c: (p) => p.union("d"),
        d: (p) => p.union("c"),
      },
    });
  class A extends Rebac.Permission<A>()("permissions/test/A", { model: Loop, on: "thing", permission: "a" }) {}
  class B extends Rebac.Permission<B>()("permissions/test/B", { model: Loop, on: "thing", permission: "b" }) {}
  class C extends Rebac.Permission<C>()("permissions/test/C", { model: Loop, on: "thing", permission: "c" }) {}
  class D extends Rebac.Permission<D>()("permissions/test/D", { model: Loop, on: "thing", permission: "d" }) {}
  const LoopRow = Schema.Struct({
    _tag: Schema.Literals(["related", "unrelated"]),
    person: Schema.Literals(PERSONS),
    relation: Schema.Literals(["x", "y"]),
    thing: Schema.Literals(["t1", "t2"]),
  });
  const LoopHistory = Schema.Array(LoopRow).check(Schema.isMaxLength(30));

  it.effect.prop(
    "L2: a loop of permissions ends every check, holds by the relations it reaches, and a loop alone never holds",
    [LoopHistory],
    ([rows]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* relations;
          const answer = store.within(
            turnFrom(
              rows.map((row) => ({
                _tag: row._tag,
                by: BRAIN,
                subject: personRef(row.person),
                relation: row.relation,
                object: `thing:${row.thing}`,
              })),
            ),
          );
          expect(Result.isSuccess(answer)).toBe(true);
          const tuples = Result.getOrThrow(answer);
          const truth = new Set<string>();

          for (const row of rows) {
            const tuple = tupleKey(personRef(row.person), row.relation, `thing:${row.thing}`);

            if (row._tag === "related") {
              truth.add(tuple);
            } else {
              truth.delete(tuple);
            }
          }

          const unions = { a: ["b", "x"], b: ["a", "y"], c: ["d"], d: ["c"] };

          for (const { right, permission } of [
            { right: A, permission: "a" },
            { right: B, permission: "b" },
            { right: C, permission: "c" },
            { right: D, permission: "d" },
          ] as const) {
            for (const { person, sender } of SENDERS) {
              for (const thing of ["t1", "t2"] as const) {
                const object = Loop.ref("thing", thing);
                const answer = right.within(tuples, sender, object);
                const expected = holds(truth, unions, personRef(person), permission, `thing:${thing}`);
                expect(Result.isSuccess(answer), `${permission} for ${person} on ${object}`).toBe(expected);

                if (permission === "c" || permission === "d") {
                  expect(Result.isFailure(answer), "a loop alone never holds").toBe(true);
                }
              }
            }
          }
        }),
      ),
    { arbitrary: { seed: SEED, runs: 100, size: 100 } },
  );

  // L3. Plant: `Denied` takes its object from the model's first declared type.
  it.effect.prop(
    "L3: every Denied carries exactly the subject, permission and object that were asked",
    [History],
    ([rows]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* relations;
          const tuples = tuplesFrom(store, rows);
          const truth = live(rows);

          for (const { right, permission } of RIGHTS) {
            for (const { person, sender } of SENDERS) {
              for (const fabrika of FABRIKAS) {
                if (holds(truth, UNIONS, personRef(person), permission, fabrikaRef(fabrika))) {
                  continue;
                }

                const object = Model.ref("fabrika", fabrika);
                const answer = right.within(tuples, sender, object);
                expect(Result.isFailure(answer)).toBe(true);

                if (Result.isFailure(answer)) {
                  const denied = answer.failure;
                  expect(Schema.is(Rebac.Denied)(denied)).toBe(true);
                  // An agent is capped by its person: the subject checked is the person it works for.
                  expect({ subject: denied.subject, permission: denied.permission, object: denied.object }).toEqual({
                    subject: personRef(person),
                    permission,
                    object,
                  });
                }
              }
            }
          }
        }),
      ),
    { arbitrary: { seed: SEED, runs: 100, size: 100 } },
  );

  // L4. Plant: `recheck` checks the object of the last `within` call. The removed object's proof is
  // made first and the kept one's last, so that plant rechecks the kept object and says yes.
  it.effect.prop(
    "L4: a proof is tied to its object: removing one object's rows makes recheck of its proof say no and leaves the other's",
    [History, Schema.Literals(PERSONS), Schema.Literals(FABRIKAS)],
    ([rows, person, removed]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* relations;
          const kept = removed === "demo" ? "other" : "demo";
          const grant = (fabrika: string): ReadonlyArray<HistoryRow> =>
            RELATIONS.map((relation) => ({ _tag: "related", by: BRAIN, person, relation, fabrika }) as const);
          const before = [...rows, ...grant(removed), ...grant(kept)];
          const sender = Sender.cases.person.make({ key: `SHA256:win-${person}`, for: person });
          const tuples = tuplesFrom(store, before);
          const first = StartProgram.within(tuples, sender, Model.ref("fabrika", removed));
          const last = StartProgram.within(tuples, sender, Model.ref("fabrika", kept));
          expect(Result.isSuccess(first) && Result.isSuccess(last)).toBe(true);
          const [gone, stays] = [Result.getOrThrow(first), Result.getOrThrow(last)];
          expect(gone.object).toBe(fabrikaRef(removed));
          expect(stays.object).toBe(fabrikaRef(kept));
          expect(Rebac.recheck(gone, tuples)).toBe(true);
          expect(Rebac.recheck(stays, tuples)).toBe(true);

          const removal: ReadonlyArray<HistoryRow> = RELATIONS.map(
            (relation) => ({ _tag: "unrelated", by: BRAIN, person, relation, fabrika: removed }) as const,
          );
          const after = tuplesFrom(store, [...before, ...removal]);
          expect(Rebac.recheck(gone, after), "the removed object's proof").toBe(false);
          expect(Rebac.recheck(stays, after), "the other object's proof").toBe(true);
        }),
      ),
    { arbitrary: { seed: SEED, runs: 100, size: 100 } },
  );
});
