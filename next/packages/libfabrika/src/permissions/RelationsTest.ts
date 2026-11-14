// T953 slice 1, next/: law L8 on a real store (0062). The module that owns a driver runs
// `RelationsTest.suite(open)`; `open` acquires one store in a scope and gives it back when that
// scope closes (0061).
//
// L8: the memory layer and the ledger layer of `Relations` agree. The same batches of changes, with
// ids resent and reused, give the same answer to every write and the same live tuples after it, and
// the ledger layer skips what another key, or another case, put on the stream. Tuples are opaque,
// so each one is read through a right that holds exactly when that one tuple is live.
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Result, Schema, type Scope } from "effect";
import { Doorbell } from "../ledger/Ledger.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { type Line, lineFor } from "../ledger/Log.ts";
import type { Sql } from "../Sql.ts";
import * as Rebac from "./Rebac.ts";
import { type Change, Row, STREAM } from "./Relation.ts";
import { Relations, RelationsError } from "./Relations.ts";
import * as RelationsLedger from "./RelationsLedger.ts";
import * as RelationsMemory from "./RelationsMemory.ts";
import { Sender } from "./Senders.ts";

/** One real store, empty when opened. */
export type Store = { readonly sql: Sql };

const SEED = 119120;
const BRAIN = "SHA256:brain";
const ROGUE = "SHA256:window-a";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PERSONS = ["person_a", "person_b", "person_c"] as const;
const FABRIKAS = ["demo", "other"] as const;
const RELATIONS = ["owner", "admin", "member"] as const;

/** A probe model: one permission per relation, so a check reads one tuple. */
const Probe = Rebac.make("probe")
  .type("person", {})
  .type("fabrika", {
    relations: { owner: ["person"], admin: ["person"], member: ["person"] },
    permissions: {
      isOwner: (p) => p.union("owner"),
      isAdmin: (p) => p.union("admin"),
      isMember: (p) => p.union("member"),
    },
  });

class IsOwner extends Rebac.Permission<IsOwner>()("permissions/test/IsOwner", {
  model: Probe,
  on: "fabrika",
  permission: "isOwner",
}) {}

class IsAdmin extends Rebac.Permission<IsAdmin>()("permissions/test/IsAdmin", {
  model: Probe,
  on: "fabrika",
  permission: "isAdmin",
}) {}

class IsMember extends Rebac.Permission<IsMember>()("permissions/test/IsMember", {
  model: Probe,
  on: "fabrika",
  permission: "isMember",
}) {}

const PROBES = [
  { relation: "owner", right: IsOwner },
  { relation: "admin", right: IsAdmin },
  { relation: "member", right: IsMember },
] as const;

/** A change's row, from small pools, so an id is often reused with the same row and often with another. */
const ChangeIn = Schema.Struct({
  id: Schema.Literals(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11"]),
  related: Schema.Boolean,
  person: Schema.Literals(PERSONS),
  relation: Schema.Literals(RELATIONS),
  fabrika: Schema.Literals(FABRIKAS),
});

/** One step: the brain's write of a batch through the store, or a line another key or another case put on the stream. */
const Step = Schema.TaggedUnion({
  write: { changes: Schema.Array(ChangeIn).check(Schema.isMinLength(1), Schema.isMaxLength(4)) },
  rogue: { change: ChangeIn },
  noted: { change: ChangeIn },
});

/** A line of another case on the relations stream, with a row's fields. */
const Noted = Schema.TaggedStruct("noted", {
  subject: Schema.NonEmptyString,
  relation: Schema.NonEmptyString,
  object: Schema.NonEmptyString,
});

const Steps = Schema.Array(Step).check(Schema.isMaxLength(20));

const fields = (change: typeof ChangeIn.Type) => ({
  subject: `person:${change.person}`,
  relation: change.relation,
  object: `fabrika:${change.fabrika}`,
});

const changeFrom = (change: typeof ChangeIn.Type): Change => ({
  id: change.id,
  row: change.related ? Row.cases.related.make(fields(change)) : Row.cases.unrelated.make(fields(change)),
});

/** The caller's line fields; the ledger layer writes them with its own `by`. */
const WRITER: Omit<Line, "_tag" | "body"> = {
  by: ROGUE,
  for: PERSONS[0],
  sentAt: "2026-11-14T09:00:00.000Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: "test-build",
};

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("T953 slice 1: the relations store on a real ledger", () => {
    // L8. Plant: the memory layer ignores `unrelated`; a removed tuple then stays live there only.
    it.effect.prop(
      "L8: the memory layer and the ledger layer answer every write and every tuple alike, and the ledger skips other writers",
      [Steps],
      ([steps]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { sql } = yield* open;
            const tx = Context.get(
              yield* Layer.build(LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet))),
              LedgerTransaction,
            );
            const ledger = Context.get(
              yield* Layer.build(
                RelationsLedger.layer({ by: BRAIN }).pipe(Layer.provide(Layer.succeed(LedgerTransaction, tx))),
              ),
              Relations,
            );
            const memory = Context.get(yield* Layer.build(RelationsMemory.layer([])), Relations);

            const agree = Effect.gen(function* () {
              const [onLedger, inMemory] = yield* tx.transact(
                (turn) => [ledger.within(turn), memory.within(turn)] as const,
              );
              expect(Result.isSuccess(onLedger) && Result.isSuccess(inMemory)).toBe(true);
              const [a, b] = [Result.getOrThrow(onLedger), Result.getOrThrow(inMemory)];

              for (const person of PERSONS) {
                const sender = Sender.cases.person.make({ key: `SHA256:win-${person}`, for: person });

                for (const fabrika of FABRIKAS) {
                  for (const { relation, right } of PROBES) {
                    const object = Probe.ref("fabrika", fabrika);
                    expect(
                      Result.isSuccess(right.within(a, sender, object)),
                      `person:${person}#${relation}@${object}`,
                    ).toBe(Result.isSuccess(right.within(b, sender, object)));
                  }
                }
              }
            });

            for (const [n, step] of steps.entries()) {
              if (step._tag === "write") {
                const changes = step.changes.map(changeFrom);
                const [onLedger, inMemory] = [
                  yield* Effect.result(ledger.write(changes, WRITER)),
                  yield* Effect.result(memory.write(changes, WRITER)),
                ];
                expect(Result.isSuccess(onLedger), `write ${n}`).toBe(Result.isSuccess(inMemory));

                for (const answer of [onLedger, inMemory]) {
                  if (Result.isFailure(answer)) {
                    expect(Schema.is(RelationsError)(answer.failure)).toBe(true);
                  }
                }
              } else {
                // Another key's row, or the brain's line of another case: only the ledger sees it.
                const line =
                  step._tag === "rogue"
                    ? lineFor({ ...WRITER, by: ROGUE }, changeFrom(step.change).row)
                    : lineFor({ ...WRITER, by: BRAIN }, Noted.make(fields(step.change)));
                yield* tx.transact((turn) => turn.append(STREAM, `${step._tag}-${n}`, line));
              }

              yield* agree;
            }
          }),
        ),
      { arbitrary: { seed: SEED, runs: 100, size: 100 } },
    );
  });
