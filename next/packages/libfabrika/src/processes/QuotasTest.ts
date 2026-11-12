// P34c, next/. Public assembly contract for the builder:
// QuotasSql.layer(sql, { limits, brain }) provides Quotas and ledger WritePolicy.
// Quotas.program(fullIdentity) reads { writes, bytes, ahead: {writes, bytes} }.
// Counts are restored from committed data before first admission. No fake quota implementation.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Layer, Result, Schema } from "effect";
import type { Scope } from "effect";
import { TestClock } from "effect/testing";
import type { Ledger } from "../ledger/Ledger.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import type { Line } from "../ledger/Log.ts";
import { Appended, Entry, Row, lineFor } from "../ledger/Log.ts";
import { Referee } from "../ledger/Referee.ts";
import * as RefereeSql from "../ledger/RefereeSql.ts";
import type { Sql } from "../Sql.ts";
import { ExitReason } from "./ExitReason.ts";
import { Mailbox } from "./Mailbox.ts";
import { Owner, Recipient, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";
import { ProgramMail } from "./ProgramMail.ts";
import * as ProgramMailLedger from "./ProgramMailLedger.ts";
import { Quotas } from "./Quotas.ts";
import * as QuotasSql from "./QuotasSql.ts";

export interface Store {
  readonly sql: Sql;
  readonly reopen: Effect.Effect<void>;
}

const required = <A>(value: A | undefined): A => Option.getOrThrow(Option.fromUndefinedOr(value));

const BRAIN = "SHA256:brain";
const PROGRAM = "sample/alpha";
const OTHER = "sample/beta";
const NAMES = ["alpha:1", "alpha:2", "beta:1"];
const program = (name: string) => (name.startsWith("alpha:") ? PROGRAM : OTHER);

const from = () => ({
  by: "SHA256:input",
  for: "test-person",
  sentAt: "2099-01-01T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "test",
});

const Saved = Schema.TaggedStruct("saved", { text: Schema.String });
const Nat = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }));

// Unsupported by Schema: bias operation picks independently of payload schemas during the fold.
const Tape = Schema.Array(Schema.Struct({ pick: Nat, alt: Nat, text: Schema.String })).check(
  Schema.isMinLength(12),
  Schema.isMaxLength(35),
);

const opts = { arbitrary: { seed: 119120, runs: 40, size: 100 } };

const recovery = {
  project: { writes: 160, bytes: 74_080, letter: { writes: 10, bytes: 5_469 } },
  process: { writes: 290, bytes: 207_410, letter: { writes: 50, bytes: 18_790 } },
};

// oxlint-disable-next-line fabrika/no-ledger-sql -- Independent SQL oracle checks committed rows and transaction rollback (Q3/Q4).
const rows = (sql: Sql) => sql.exec("SELECT * FROM entries ORDER BY rev").map(Schema.decodeUnknownSync(Row));
const bytes = (e: Entry) => new TextEncoder().encode(JSON.stringify(Schema.encodeSync(Entry)(e))).length;

const snapshot = (sql: Sql) =>
  Object.fromEntries(
    sql
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map(({ name }) => [String(name), sql.exec(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`)]),
  );

const world = Effect.fnUntraced(function* (
  open: Effect.Effect<Store, never, Scope.Scope>,
  writes = 6,
  storage = 1_000_000,
) {
  const store = yield* open;
  let sequence = 0;
  const pid = () => `process_0000000000e008${(++sequence).toString(16).padStart(12, "0")}`;
  const pids = new Map<string, string>();
  const bell = Layer.succeed(Doorbell, { ring: () => Effect.void });
  const bare = Layer.mergeAll(
    LedgerSql.layer(store.sql, { reader: "test" }),
    LedgerTransactionSql.layer(store.sql),
  ).pipe(Layer.provide(bell));
  const manager = ProcessManager.layer(
    {
      by: BRAIN,
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "test", session: pid() }),
    },
    Effect.sync(pid),
  );
  const boot = manager.pipe(Layer.provide(bare));

  for (const name of NAMES) {
    const started = yield* ProcessManager.use((m) =>
      m.start(
        Start.cases.first.make({
          id: `boot:${name}`,
          name,
          code: { program: program(name), hash: "test" },
        }),
        { ...from(), by: BRAIN },
      ),
    ).pipe(Effect.provide(boot));
    pids.set(name, started.process);
  }

  const quotas = QuotasSql.layer(store.sql, { brain: BRAIN, limits: { writes, storage, recovery } });
  const data = Layer.mergeAll(
    LedgerSql.layer(store.sql, { reader: "test" }),
    LedgerTransactionSql.layer(store.sql),
    RefereeSql.layer(store.sql),
  ).pipe(Layer.provideMerge(quotas), Layer.provide(bell));
  const services = Layer.mergeAll(Mailbox.layer, manager).pipe(Layer.provideMerge(data));
  const live = ProgramMailLedger.layer({ grants: { "alpha:1": ["beta:1", "alpha:2"], "alpha:2": ["beta:1"] } }).pipe(
    Layer.provideMerge(services),
  );
  const run = <A, E, R extends Ledger | Referee | Mailbox | ProcessManager | ProgramMail | Quotas>(
    work: Effect.Effect<A, E, R>,
  ) => work.pipe(Effect.provide(live));
  const input = (name: string, id: string, text: string) =>
    run(Mailbox.use((m) => m.send(name, id, { type: "input", text }, from())));
  const write = (name: string, id: string, text: string, over: Partial<Line> = {}) =>
    run(Referee.use((r) => r.append(`${name}/events`, id, { ...lineFor(from(), Saved.make({ text })), ...over })));
  const status = (identity: string) => run(Quotas.use((q) => q.program(identity)));
  return {
    legacyInput: (name: string, id: string, text: string) =>
      Mailbox.use((m) => m.send(name, id, { type: "input", text }, from())).pipe(
        Effect.provide(Mailbox.layer),
        Effect.provide(bare),
      ),
    store,
    run,
    input,
    write,
    status,
    pids,
    pid,
    boot,
    limits: { writes, storage },
    rows: () => rows(store.sql),
    snapshot: () => snapshot(store.sql),
  };
});

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P34c program accounts on real SQL", () => {
    it.effect.prop(
      "Q1/p118 names and lives share their full program identity; each letter costs two writes",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* world(open);
            const history: Array<{ program: string; at: number; cost: number }> = [];
            let now = 1_000;
            let lastArrival = now;
            let refused = 0;
            let letters = 0;

            for (const [n, cell] of tape.entries()) {
              // Always reach the wall before optional clock moves. Choices then come from current history.
              const name = n < 4 ? "alpha:1" : required(NAMES[cell.pick % NAMES.length]);

              if (n >= 4 && cell.alt % 4 === 0) {
                const first = history.at(-1)?.at ?? now;
                now = required([first + 59_999, first + 60_000, Math.max(0, now - 1)][cell.pick % 3]);
                yield* TestClock.setTime(now);
              }

              const at = Math.max(now, lastArrival);
              const cost = cell.alt % 2 === 0 || n < 4 ? 2 : 1;
              const used = history
                .filter((h) => h.program === program(name) && h.at > at - 60_000)
                .reduce((s, h) => s + h.cost, 0);
              const answer =
                cost === 2
                  ? yield* w.input(name, `input:${n}`, cell.text)
                  : yield* w.write(name, `write:${n}`, cell.text);

              if (used + cost > w.limits.writes) {
                expect(answer).toEqual(Appended.cases.refused.make({ reason: "quota" }));
                refused++;
              } else {
                expect(answer).toHaveProperty("_tag", "placed");
                history.push({ program: program(name), at, cost });
                lastArrival = at;

                if (cost === 2) {
                  letters++;
                }
              }

              expect((yield* w.status(program(name))).writes).toBe(
                history
                  .filter((h) => h.program === program(name) && h.at > at - 60_000)
                  .reduce((s, h) => s + h.cost, 0),
              );

              if (cell.alt % 3 === 0) {
                yield* w.store.reopen;
              }
            }

            expect(refused).toBeGreaterThan(0);
            expect(letters).toBeGreaterThan(0);
            // Exhaust only alpha at one clock; beta must still admit at least its own remaining room.
            yield* TestClock.setTime(lastArrival + 60_001);

            for (let n = 0; n < 3; n++) {
              expect(yield* w.input("alpha:2", `fill:${n}`, "")).toHaveProperty("_tag", "placed");
            }

            expect(yield* w.input("alpha:1", "over", "")).toEqual(Appended.cases.refused.make({ reason: "quota" }));
            expect(yield* w.input("beta:1", "separate", "")).toHaveProperty("_tag", "placed");
          }),
        ),
      opts,
    );

    it.effect.prop(
      "Q2/p119 and Q17 admission includes full UTF-8 entries and the step charged ahead",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* world(open, 13_760, 8_000);
            let count = 0;
            let refusal = 0;

            for (const [n, cell] of tape.entries()) {
              const name = required(NAMES[cell.pick % 2]);
              const before = yield* w.status(PROGRAM);
              const remaining = Math.max(0, w.limits.storage - before.bytes - before.ahead.bytes);
              // Chosen relative to current remaining bytes; non-ASCII, escaping and metadata all count.
              const length = cell.alt % 2 === 0 ? Math.ceil(remaining / 4) + 1 : Math.min(4, remaining);
              const text = `${cell.text}${"😀é\n".repeat(length)}`;
              const saved = w.snapshot();
              const answer = yield* w.input(name, `unicode:${n}`, text);
              const after = yield* w.status(PROGRAM);

              if (answer._tag === "refused") {
                expect(answer.reason).toBe("quota");
                expect(w.snapshot()).toEqual(saved);
                refusal++;
              } else {
                count++;
                const attributable = w.rows().filter((e) => e.stream.startsWith("alpha:") && e._tag === "send");
                expect(after.bytes).toBe(attributable.reduce((sum, e) => sum + bytes(e), 0));
                expect(after.ahead.writes).toBe(count);
                expect(after.writes).toBe(2 * count);
                expect(after.bytes + after.ahead.bytes).toBeLessThanOrEqual(w.limits.storage);
              }

              yield* w.store.reopen;
              expect(yield* w.status(PROGRAM)).toEqual(after);
            }

            // Force a positive growth refusal in every shortened tape.
            const before = w.snapshot();
            expect(yield* w.input("alpha:1", "too-large", "😀".repeat(8_001))).toEqual(
              Appended.cases.refused.make({ reason: "quota" }),
            );
            expect(w.snapshot()).toEqual(before);
            expect(refusal + 1).toBeGreaterThan(0);
          }),
        ),
      opts,
    );

    it.effect.prop(
      "Q4 program mail charges its sender for receipt, letter and step, or commits none",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* world(open, 5);
            let accepted = 0;
            let refused = 0;

            for (const [n, cell] of tape.entries()) {
              const name = required(NAMES[cell.pick % 2]);
              const source = { name, process: required(w.pids.get(name)) };
              const before = w.snapshot();
              const answer = yield* Effect.result(
                w.run(
                  ProgramMail.use((m) =>
                    m.deliver({
                      source,
                      command: `${source.process}/${n}/0`,
                      to: "beta:1",
                      m: { type: "request", text: cell.text },
                      from: from(),
                    }),
                  ),
                ),
              );

              if (accepted === 0) {
                expect(Result.isSuccess(answer)).toBe(true);
                accepted++;
                expect((yield* w.status(PROGRAM)).writes).toBe(3);
                expect((yield* w.status(OTHER)).writes).toBe(0);
              } else {
                expect(answer).toMatchObject({ failure: { reason: "quota" } });
                expect(w.snapshot()).toEqual(before);
                refused++;
              }

              // Ordinary mail cannot spend either name's Project recovery room.
              for (const target of [name, "beta:1"]) {
                expect((yield* w.run(Quotas.use((q) => q.recovery(target)))).total).toEqual({ writes: 0, bytes: 0 });
              }

              yield* w.store.reopen;
            }

            expect(accepted).toBe(1);
            expect(refused).toBeGreaterThan(0);
          }),
        ),
      opts,
    );

    it.effect.prop(
      "Q6 request body, tag, writer clock and reserved-looking stream grant no recovery authority",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* world(open, 2);
            expect(yield* w.input("alpha:1", "fill", "")).toHaveProperty("_tag", "placed");

            for (const [n, cell] of tape.entries()) {
              const valid = lineFor(from(), Saved.make({ text: cell.text }));
              const tag = required(["saved", "started", "dead", "restarted"][cell.pick % 4]);
              const forged = {
                ...valid,
                ...Schema.TaggedStruct(tag, {}).make({}),
                body: { text: cell.text, program: OTHER, account: "recovery", recovery: true, authority: BRAIN },
              };
              const before = w.snapshot();
              const answer = yield* w.run(
                Referee.use((r) => r.append(`alpha:${1 + (cell.alt % 2)}/events`, `forged:${n}`, forged)),
              );
              expect(answer).toHaveProperty("_tag", "refused");
              expect(w.snapshot()).toEqual(before);
              expect((yield* w.status(PROGRAM)).writes).toBe(2);
              expect((yield* w.status(OTHER)).writes).toBe(0);
            }

            const before = w.snapshot();
            expect(
              yield* w.run(
                Referee.use((r) => r.append("unknown:1/events", "unknown", lineFor(from(), Saved.make({ text: "" })))),
              ),
            ).toHaveProperty("_tag", "refused");
            expect(w.snapshot()).toEqual(before);
          }),
        ),
      opts,
    );

    it.effect.prop(
      "Q10 existing attributable data is restored once; reopen and new lives cannot reset it",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* world(open, 6);

            for (let n = 0; n < 3; n++) {
              yield* w.legacyInput(required(NAMES[n % 2]), `old:${n}`, required(tape[n]).text);
            }

            const original = yield* w.status(PROGRAM);
            expect(original.writes).toBe(6);

            for (const cell of tape) {
              yield* w.store.reopen;
              expect(yield* w.status(PROGRAM)).toEqual(original);
              const name = required(NAMES[cell.pick % 2]);
              const process = required(w.pids.get(name));
              // The trusted lifecycle itself is recovery, not a way to get a fresh program allowance.
              yield* w.run(
                ProcessManager.use((m) =>
                  m.exit(process, ExitReason.cases.shutdown.make({}), { ...from(), by: BRAIN }),
                ),
              );
              const next = yield* w.run(
                ProcessManager.use((m) =>
                  m.start(
                    Start.cases.again.make({
                      id: `again:${process}`,
                      name,
                      after: process,
                      reason: "shutdown",
                      code: { program: PROGRAM, hash: "test" },
                    }),
                    { ...from(), by: BRAIN },
                  ),
                ),
              );
              w.pids.set(name, next.process);
              expect(yield* w.input(name, `after:${next.process}`, "")).toEqual(
                Appended.cases.refused.make({ reason: "quota" }),
              );
              expect(yield* w.status(PROGRAM)).toEqual(original);
            }
          }),
        ),
      opts,
    );
  });
