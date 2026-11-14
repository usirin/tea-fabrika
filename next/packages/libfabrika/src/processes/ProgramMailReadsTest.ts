// T936 slice 1, next/: L1 and L2 on a real store (0062), and no driver. A runner in the module that
// owns a driver calls `ProgramMailReadsTest.suite(open)`; `open` acquires one store in a scope and
// gives it back when that scope closes.
//
// Both laws count the rows `Sql.exec` returns while one delivery runs, through a wrapper this file
// owns, never wall time. A walk sends letters from the requester to the responder, one at a time, and
// counts at each history size it reaches: the generated ones, and the domain's two ends (0 and TOP),
// so a failure always prints the count at the largest history the law uses.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result, Schema, type Scope } from "effect";
import * as fc from "fast-check";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import type { Sql } from "../Sql.ts";
import { property } from "../Testing.test-support.ts";
import { type From, Mailbox } from "./Mailbox.ts";
import { Owner, Recipient, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";
import { type Grants, ProgramMail, type Receipt } from "./ProgramMail.ts";
import * as ProgramMailLedger from "./ProgramMailLedger.ts";
import type { Store } from "./ProgramMailTest.ts";

const RUNS = 25;
/** The largest history either law reaches: letters already in the outbox and the inbox. */
const TOP = 120;
const BRAIN = "SHA256:brain";
const REQUESTER = "requester:1";
const RESPONDER = "responder:1";
const GRANTS: Grants = { [REQUESTER]: [RESPONDER] };
const CODE = { program: "mail", hash: "build-a" };

const PIDS: ReadonlyArray<string> = Array.from(
  { length: 4 },
  (_, n) => `process_0000000000e00800${String(n).padStart(10, "0")}`,
);

const from = (over: Partial<From> = {}): From => ({
  by: "SHA256:program-writer",
  for: "person_01m6v5270hf3c8x2q7w9z4k5mn",
  sentAt: "2026-11-07T21:10:01.204Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "writer-build",
  ...over,
});

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));
/** A value as JSON text carries it, so -0 and other values JSON cannot keep are normalized. */
const copied = (value: unknown): Schema.Json => decodeJson(JSON.stringify(value));

/** Letter bodies the walk cycles through, as a program would send them. */
const Bodies = fc.array(
  fc.jsonValue({ maxDepth: 2 }).map((m) => copied({ type: "request", body: m })),
  { minLength: 1, maxLength: 8 },
);

const History = fc.integer({ min: 0, max: TOP });

/** The store's Sql, counting every row `exec` returns. */
const counted = (sql: Sql) => {
  const count = { rows: 0 };
  const wrapped: Sql = {
    exec: (query, ...params) => {
      const rows = sql.exec(query, ...params);
      count.rows += rows.length;
      return rows;
    },
    transaction: (step) => sql.transaction(step),
    size: () => sql.size(),
  };
  return { sql: wrapped, count };
};

const layer = (sql: Sql, next: Effect.Effect<string>) =>
  ProgramMailLedger.layer({ grants: GRANTS }).pipe(
    Layer.provideMerge(
      ProcessManager.layer(
        {
          owner: Owner.cases.brain.make({}),
          recipient: Recipient.cases.client.make({ client: "window-a", session: PIDS[3] as string }),
          by: BRAIN,
        },
        next,
      ).pipe(
        Layer.provideMerge(
          Mailbox.layer.pipe(
            Layer.provideMerge(
              Layer.mergeAll(LedgerSql.layer(sql, { reader: "connection:test" }), LedgerTransactionSql.layer(sql)).pipe(
                Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
              ),
            ),
          ),
        ),
      ),
    ),
  );

type Delivery = Parameters<ProgramMail["Service"]["deliver"]>[0];

/**
 * One store with the requester and the responder each on one life, and a delivery that reports the
 * rows SQL returned while it ran. Layers are built before any count, so only the delivery is counted.
 */
const mail = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.gen(function* () {
    const store = yield* open;
    const { sql, count } = counted(store.sql);
    let pids = 0;
    const next = Effect.suspend(() => {
      const pid = PIDS[pids++];
      return pid === undefined ? Effect.die(new Error("test exhausted its process IDs")) : Effect.succeed(pid);
    });
    const context = yield* Layer.build(layer(sql, next));

    for (const name of [REQUESTER, RESPONDER]) {
      yield* ProcessManager.use((p) =>
        p.start(Start.cases.first.make({ id: `start:${name}`, name, code: CODE }), from({ by: BRAIN })),
      ).pipe(Effect.provide(context), Effect.orDie);
    }

    const source = { name: REQUESTER, process: PIDS[0] as string };
    let sent = 0;
    const deliver = Effect.fnUntraced(function* (delivery: Delivery) {
      const before = count.rows;
      const answer = yield* ProgramMail.use((m) => m.deliver(delivery)).pipe(Effect.provide(context), Effect.result);
      return { answer, rows: count.rows - before };
    });
    /** A new delivery of the next command, with one of the walk's bodies. */
    const fresh = (m: unknown) =>
      deliver({ command: `${source.process}/${++sent}/0`, source, to: RESPONDER, m, from: from() });
    return { deliver, fresh };
  });

/** Each history size the walk counts at, ascending: the generated ones and both ends of the domain. */
const points = (lowest: number, sizes: ReadonlyArray<number>) =>
  [...new Set([lowest, ...sizes, TOP])].sort((a, b) => a - b);

const accepted = (answer: Result.Result<Receipt, unknown>, message: string): Receipt => {
  expect(Result.isSuccess(answer), message).toBe(true);
  return Result.getOrThrow(answer);
};

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("T936 slice 1: a delivery reads the same rows whatever the history", () => {
    it.effect(
      "L1: a new delivery returns as many rows after h earlier letters to the same target as after none",
      () =>
        property(
          fc.record({ sizes: fc.tuple(History, History), bodies: Bodies }),
          ({ sizes, bodies }) =>
            Effect.gen(function* () {
              const { fresh } = yield* mail(open);
              const body = (n: number) => bodies[n % bodies.length];
              const counts: Array<{ readonly h: number; readonly rows: number }> = [];
              let h = 0;

              for (const point of points(0, sizes)) {
                for (; h < point; h++) {
                  accepted((yield* fresh(body(h))).answer, `history letter ${h} is accepted`);
                }

                const { answer, rows } = yield* fresh(body(h));
                accepted(answer, `the counted delivery after ${h} letters is accepted`);
                counts.push({ h, rows });
                h++;
              }

              const first = counts[0]?.rows;
              expect(
                counts.map(({ rows }) => rows),
                `L1: rows SQL returned during one new delivery, by earlier letters: ${counts.map(({ h, rows }) => `h=${h}: ${rows}`).join(", ")}`,
              ).toEqual(counts.map(() => first));
            }),
          { numRuns: RUNS },
        ),
      600_000,
    );

    it.effect(
      "L2: a repeat delivery of an accepted command returns the same rows whatever the history, and answers the first receipt",
      () =>
        property(
          fc.record({ size: fc.integer({ min: 1, max: TOP }), pick: fc.nat(), bodies: Bodies }),
          ({ size, pick, bodies }) =>
            Effect.gen(function* () {
              const { deliver, fresh } = yield* mail(open);
              const body = (n: number) => bodies[n % bodies.length];
              const first: Array<{ readonly delivery: Delivery; readonly receipt: Receipt }> = [];
              const counts: Array<{ readonly h: number; readonly rows: number }> = [];

              for (const point of points(1, [size])) {
                while (first.length < point) {
                  const m = body(first.length);
                  const { answer } = yield* fresh(m);
                  const receipt = accepted(answer, `history letter ${first.length} is accepted`);
                  first.push({
                    delivery: {
                      command: receipt.command,
                      source: receipt.source,
                      to: RESPONDER,
                      m,
                      from: from(),
                    },
                    receipt,
                  });
                }

                const earlier = first[pick % first.length];

                if (earlier === undefined) {
                  return yield* Effect.die(new Error("a repeat chose from an empty history"));
                }

                const { answer, rows } = yield* deliver(earlier.delivery);
                expect(
                  accepted(answer, `the repeat of ${earlier.delivery.command} is accepted`),
                  "L2: a repeat answers the first receipt, field for field",
                ).toEqual(earlier.receipt);
                counts.push({ h: point, rows });
              }

              const once = counts[0]?.rows;
              expect(
                counts.map(({ rows }) => rows),
                `L2: rows SQL returned during one repeat delivery, by earlier letters: ${counts.map(({ h, rows }) => `h=${h}: ${rows}`).join(", ")}`,
              ).toEqual(counts.map(() => once));
            }),
          { numRuns: RUNS },
        ),
      600_000,
    );
  });
