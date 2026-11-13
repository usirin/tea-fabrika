// p21's mail half (the coordination suite; P9's plan restates it for P6's `append`), for
// `coordination/mailbox.ts`: a letter goes into a name's inbox once per id, delivered at least once
// and made safe by the id (C2, D4), and comes back out as a `Letter` in order. Written before the
// module (Tier 1, P9, ticket 236).
//
// The shape these tests hold the module to, from the plan's "The shape" and flag 3:
// - `Mailbox.send(to, id, m, from)` appends one line to the stream `<to>/inbox` under `id`, as
//   `{_tag: "send", body: {m}}` with `from`'s `by`, `for`, `sentAt`, `seen`, `parent`, `traceId` and `build`,
//   and answers P6's `Appended` as it is, `pos` included. A resend gets the same placing.
// - `Mailbox.receive(name, after)` is a Stream of `Letter`s from `<name>/inbox` past the log rev
//   `after`, in rev order, each `{id, m, by, for, sentAt, parent, traceId, rev, pos}` from its entry. A line
//   with any other `_tag` is skipped and stays in the log; a `send` whose body has no `m` fails the
//   Stream with `LedgerError` `bad_row`.
// - No Layer fails when it is built.
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import * as fc from "fast-check";
import { processId, processIds } from "../Id.test-support.ts";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import type { Line } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import type { Sql } from "../Sql.ts";
import { type From, type Letter, Mailbox, RunnerMail } from "./Mailbox.ts";
import { brainOnly, inRunnerSpace } from "./Process.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const READER = "connection:t1";
const PARENT = `in-${Effect.runSync(processId)}-41`;
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const OTHER_TRACE = "5bf92f3577b34da6a3ce929d0e0e4737";
const P = "person_01m6v5270hf3c8x2q7w9z4k5mn";
// The writer's clock is a date text, never a number, so a Letter that took it as its rev shows.
const SENT = "2026-11-07T21:10:01.204Z";
const LETTER = "letter_01m6v5270hetdrt4r8h9vvjwjr";

// Every ledger is a fresh node:sqlite database in memory, closed after. Never a file: each send is one
// transaction, and on a file each one waits for the disk to sync. The page law sends about 17,000 letters,
// so on CI's disk it took 36 to 60 s of waiting that no law here reads (ticket 544). No law in this file
// closes a ledger and opens it again.
const opened: Array<DatabaseSync> = [];

const fresh = (): Sql => {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  return nodeSql(db);
};

afterAll(() => {
  for (const db of opened.splice(0)) {
    if (db.isOpen) {
      db.close();
    }
  }
});

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
const onSql = (sql: Sql) => LedgerSql.layer(sql, { reader: READER }).pipe(Layer.provide(quiet));
/** A Mailbox and the Ledger beneath it, so a test can read and write the log beside it. */
const mail = () => Mailbox.layer.pipe(Layer.provideMerge(onSql(fresh())));

const from = (over: Partial<From> = {}): From => ({
  by: "SHA256:t2",
  for: P,
  sentAt: SENT,
  seen: 0,
  parent: PARENT,
  traceId: TRACE,
  build: "b-7c1d073",
  ...over,
});

const send = (to: string, id: string, m: unknown, over: Partial<From> = {}) =>
  Mailbox.use((mailbox) => mailbox.send(to, id, m, from(over)));

const receive = (name: string, after = 0) => Mailbox.use((mailbox) => Stream.runCollect(mailbox.receive(name, after)));

const inbox = (name: string) => Ledger.use((ledger) => Stream.runCollect(ledger.read(`${name}/inbox`, 0)));

/** A line straight into the log, as another writer would put it. */
const raw = (stream: string, id: string, over: Partial<Line>) =>
  Ledger.use((ledger) =>
    ledger.append(stream, id, {
      by: "SHA256:other",
      for: P,
      sentAt: SENT,
      seen: 0,
      parent: null,
      traceId: TRACE,
      build: "b-7c1d073",
      _tag: "send",
      body: { m: null },
      ...over,
    }),
  );

const check = <A, E, R>(arb: fc.Arbitrary<A>, examples: NoInfer<A>[], law: (a: A) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(arb, (a) => Effect.runPromise(law(a).pipe(Effect.provideContext(context)))),
        {
          seed: SEED,
          numRuns: 40,
          includeErrorInReport: true,
          examples: examples.map((a): [A] => [a]),
        },
      ),
    );
  });

const json = fc.jsonValue();

describe("P33, only the owning runner writes its answers", () => {
  it.effect.prop(
    "B2: notice ids, including whitespace and reserved prefixes, require the brain and refuse public mail",
    [Schema.String, Schema.Literals(["", " ", "\n", "\t"]), Schema.Json],
    ([key, space, m]) =>
      Effect.gen(function* () {
        // JSON whitespace changes the spelling, never ownership of the id space.
        for (const id of [
          JSON.stringify(["notice", key]),
          `${space}[${space}"notice",${JSON.stringify(key)}]${space}`,
          '["notice"',
        ]) {
          expect(brainOnly({ stream: "notes:1/inbox", id, tag: "send" })).toBe(true);
          expect(yield* send("notes:1", id, m)).toEqual({ _tag: "refused", reason: "forbidden" });
        }

        expect(yield* inbox("notes:1")).toEqual([]);
        expect(yield* send("notes:1", `plain:${key}`, m)).toMatchObject({ _tag: "placed" });
      }).pipe(Effect.provide(mail())),
    { arbitrary: { seed: SEED } },
  );

  // Process ids come from processIds: exact UUIDv7 TypeIDs, not any 26 base32 characters.
  const Nat = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
  const props = { arbitrary: { seed: SEED, runs: 40 } };
  it.effect.prop(
    "runner permission requires its exact name and process id",
    { suffix: Schema.String, process: processIds, step: Nat, count: Nat, m: Schema.Json },
    ({ suffix, process, step, count, m }) => {
      const name = `runner:${suffix}`;
      return Effect.gen(function* () {
        for (const [to, pid, allowed] of [
          [name, process, true],
          [`${name}:other`, process, false],
          [name, `${process}x`, false],
          [`${name}:other`, `${process}x`, false],
        ] as const) {
          for (const id of [`${pid}/${step}/${count}/answer`, `${pid}/due/${count}`]) {
            const answer = yield* send(to, id, m);
            expect(answer._tag, "runner writes only its own inbox and process").toBe(allowed ? "placed" : "refused");

            if (!allowed) {
              expect(answer).toEqual({ _tag: "refused", reason: "forbidden" });
            }
          }
        }
      }).pipe(Effect.provideService(RunnerMail, { name, process }), Effect.provide(mail()));
    },
    props,
  );
  it.prop(
    "each protected stream, case and runner answer independently requires the brain",
    { process: processIds, step: Nat, count: Nat },
    ({ process, step, count }) => {
      const answer = `${process}/${step}/${count}/answer`;
      expect(inRunnerSpace(answer), "numeric runner answer").toBe(true);
      expect(inRunnerSpace(`${answer}/result`)).toBe(true);
      expect(inRunnerSpace(`${process}/${step}/word/answer`)).toBe(false);

      for (const write of [
        { stream: "processes", id: "ordinary", tag: "saved" },
        { stream: `processes/name:${count}`, id: "ordinary", tag: "saved" },
        { stream: "notes/inbox", id: "ordinary", tag: "registered" },
        { stream: "notes/inbox", id: answer, tag: "send" },
      ]) {
        expect(brainOnly(write), "each protected write requires the brain").toBe(true);
      }

      expect(brainOnly({ stream: "notes/inbox", id: `letter:${count}`, tag: "send" })).toBe(false);
    },
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

describe("p21, send", () => {
  it.effect("non-JSON mail is refused as bad_line and writes no entry", () =>
    check<unknown, LedgerError, never>(
      fc.oneof(
        fc.constant(undefined),
        fc.constant(() => null),
        fc.bigInt(),
        json.map((value) => ({ value, missing: undefined })),
      ),
      [undefined, () => null, 1n, { value: undefined }],
      (m) =>
        Effect.gen(function* () {
          expect(yield* send("notes:1", LETTER, m)).toEqual({
            _tag: "refused",
            reason: "bad_line",
          });
          expect(yield* inbox("notes:1")).toEqual([]);
        }).pipe(Effect.provide(mail())),
    ),
  );
  it.effect("writes one send line in the name's inbox, with every field the writer gave", () =>
    check(json, [{ type: "save", value: { text: "hello", n: 3 } }], (m) =>
      Effect.gen(function* () {
        const answer = yield* send("notes:1", LETTER, m);
        expect(answer).toEqual({ _tag: "placed", rev: 1, pos: 1 });
        const [entry, ...rest] = yield* inbox("notes:1");
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({
          id: LETTER,
          stream: "notes:1/inbox",
          rev: 1,
          pos: 1,
          _tag: "send",
          body: { m },
          by: "SHA256:t2",
          for: P,
          sentAt: SENT,
          seen: 0,
          parent: PARENT,
          traceId: TRACE,
          build: "b-7c1d073",
        });
      }).pipe(Effect.provide(mail())),
    ),
  );

  it.effect("plant, a placing from the wrong line: each answer is its own line's rev and pos", () =>
    check(fc.tuple(json, json, json, json), [[1, 2, 3, 4]], ([a, b, c, d]) =>
      Effect.gen(function* () {
        const answers = [];
        answers.push(yield* send("notes:1", "letter_a", a));
        yield* raw("other", "x-1", { _tag: "saved" });
        answers.push(yield* send("notes:2", "letter_b", b));
        answers.push(yield* send("notes:1", "letter_c", c, { seen: 3 }));
        answers.push(yield* send("notes:2", "letter_d", d));
        expect(answers).toEqual([
          { _tag: "placed", rev: 1, pos: 1 },
          { _tag: "placed", rev: 3, pos: 1 },
          { _tag: "placed", rev: 4, pos: 2 },
          { _tag: "placed", rev: 5, pos: 2 },
        ]);
        const one = yield* inbox("notes:1");
        expect(one.map((e) => [e.id, e.rev, e.pos])).toEqual([
          ["letter_a", 1, 1],
          ["letter_c", 4, 2],
        ]);
      }).pipe(Effect.provide(mail())),
    ),
  );

  it.effect("a resend gets the first placing and writes nothing; another m under that id is refused", () =>
    check(
      fc.tuple(json, json).filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b)),
      [[{ type: "save" }, { type: "delete" }]],
      ([saved, changed]) =>
        Effect.gen(function* () {
          const first = yield* send("notes:1", LETTER, saved);
          yield* send("notes:1", "letter_other", saved);
          expect(yield* send("notes:1", LETTER, saved, { sentAt: "later", seen: 2 })).toEqual(first);
          expect(yield* send("notes:1", LETTER, changed)).toEqual({
            _tag: "refused",
            reason: "id_reused",
          });
          expect((yield* inbox("notes:1")).length).toBe(2);
        }).pipe(Effect.provide(mail())),
    ),
  );

  it.effect("passes the ledger's refusals up as they are", () =>
    check(json, [1], (m) =>
      Effect.gen(function* () {
        expect(yield* send("notes:1", LETTER, m, { seen: 9 })).toEqual({
          _tag: "refused",
          reason: "seen_ahead",
        });
        expect(yield* send("notes:1", LETTER, m, { parent: "not-a-parent" })).toEqual({
          _tag: "refused",
          reason: "bad_parent",
        });
        expect(yield* send("notes:1", LETTER, m, { traceId: "0".repeat(32) })).toEqual({
          _tag: "refused",
          reason: "bad_trace",
        });
        expect(yield* inbox("notes:1")).toEqual([]);
      }).pipe(Effect.provide(mail())),
    ),
  );
});

describe("p21, receive", () => {
  it.effect("plant, parent or traceId dropped: each Letter is its entry, field for field", () =>
    check(fc.tuple(json, json), [[{ type: "save", value: 1 }, [1, "two", null]]], ([a, b]) =>
      Effect.gen(function* () {
        yield* send("notes:1", "letter_a", a);
        yield* raw("other", "x-1", { _tag: "saved" });
        yield* send("notes:1", "letter_b", b, {
          by: "SHA256:g1",
          for: P,
          parent: null,
          traceId: OTHER_TRACE,
          sentAt: "1",
        });
        const letters: ReadonlyArray<Letter> = yield* receive("notes:1");
        expect(letters).toEqual([
          {
            id: "letter_a",
            m: a,
            by: "SHA256:t2",
            for: P,
            sentAt: SENT,
            parent: PARENT,
            traceId: TRACE,
            rev: 1,
            pos: 1,
          },
          {
            id: "letter_b",
            m: b,
            by: "SHA256:g1",
            for: P,
            sentAt: "1",
            parent: null,
            traceId: OTHER_TRACE,
            rev: 3,
            pos: 2,
          },
        ]);
      }).pipe(Effect.provide(mail())),
    ),
  );

  it.effect("gives only the letters past after, a log rev", () =>
    check(fc.array(json, { minLength: 3, maxLength: 30 }), [[1, 2, 3]], (messages) =>
      Effect.gen(function* () {
        const names = messages.map((_, i) => (i < 3 ? ["letter_a", "letter_b", "letter_c"][i]! : `letter_${i}`));

        for (const [i, m] of messages.entries()) {
          yield* send("notes:1", names[i]!, m);
        }

        expect((yield* receive("notes:1", 1)).map((l) => l.id)).toEqual(names.slice(1));
        expect(yield* receive("notes:1", messages.length)).toEqual([]);
      }).pipe(Effect.provide(mail())),
    ),
  );

  it.effect("reads only its own name's inbox", () =>
    check(fc.tuple(json, json), [[1, 2]], ([a, b]) =>
      Effect.gen(function* () {
        yield* send("notes:1", "letter_a", a);
        yield* send("notes:2", "letter_b", b);
        yield* raw("notes:1", "x-1", { _tag: "send" }); // the name's own stream, not its inbox
        expect((yield* receive("notes:1")).map((l) => l.id)).toEqual(["letter_a"]);
        expect((yield* receive("notes:2")).map((l) => l.id)).toEqual(["letter_b"]);
        expect(yield* receive("notes:3")).toEqual([]);
      }).pipe(Effect.provide(mail())),
    ),
  );

  it.effect("plant, an unknown tag that ends the Stream: it is skipped, kept, and the letters after it come", () =>
    check(
      fc.string({ minLength: 1 }).filter((tag) => tag !== "send"),
      ["exit"],
      (tag) =>
        Effect.gen(function* () {
          yield* send("notes:1", "letter_a", 1);
          yield* raw("notes:1/inbox", "x-1", { _tag: tag, body: { reason: "normal" } });
          yield* send("notes:1", "letter_b", 2);
          expect((yield* receive("notes:1")).map((l) => l.id)).toEqual(["letter_a", "letter_b"]);
          expect((yield* inbox("notes:1")).map((e) => e._tag)).toEqual(["send", tag, "send"]);
        }).pipe(Effect.provide(mail())),
    ),
  );

  it.effect("a send line whose body has no m fails the Stream with bad_row", () =>
    check(
      fc.dictionary(
        fc.string().filter((key) => key !== "m"),
        json,
      ),
      [{ value: 1 }],
      (body) =>
        Effect.gen(function* () {
          yield* send("notes:1", "letter_a", 1);
          yield* raw("notes:1/inbox", "x-1", {
            _tag: "send",
            body: Schema.decodeUnknownSync(Schema.Json)(body),
          });
          const failed = yield* Effect.flip(receive("notes:1"));
          expect(failed).toBeInstanceOf(LedgerError);
          expect(failed.reason).toBe("bad_row");
        }).pipe(Effect.provide(mail())),
    ),
  );

  it.effect("reads past one page: 300 letters, all, in order", () =>
    check(fc.integer({ min: 257, max: 600 }), [300], (count) =>
      Effect.gen(function* () {
        for (let i = 0; i < count; i++) {
          yield* send("notes:1", `letter_${i}`, i, { seen: i });
        }

        const letters = yield* receive("notes:1");
        expect(letters.map((l) => l.m)).toEqual(Array.from({ length: count }, (_, i) => i));
        expect(letters.map((l) => l.pos)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
      }).pipe(Effect.provide(mail())),
    ),
  );

  it("over any sends with resends: each id comes out once, in first-send order, with its first m", async () => {
    const sendArb = fc.record({
      to: fc.constantFrom("notes:1", "notes:2"),
      id: fc.constantFrom("letter_a", "letter_b", "letter_c", "letter_d", "letter_e"),
      m: fc.oneof(fc.integer(), fc.string({ maxLength: 5 }), fc.constant(null), fc.record({ n: fc.nat() })),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(sendArb, { maxLength: 30 }), (sends) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const want = new Map<string, Array<{ readonly id: string; readonly m: unknown }>>();

            for (const { to, id, m } of sends) {
              const answer = yield* send(to, id, m);
              const box = want.get(to) ?? [];
              const known = box.find((l) => l.id === id);
              const same = known !== undefined && JSON.stringify(known.m) === JSON.stringify(m);
              expect(answer._tag, `${to} ${id}`).toBe(known === undefined || same ? "placed" : "refused");

              if (known === undefined) {
                want.set(to, [...box, { id, m }]);
              }
            }

            for (const to of ["notes:1", "notes:2"]) {
              const letters = yield* receive(to);
              expect(letters.map((l) => ({ id: l.id, m: l.m }))).toEqual(want.get(to) ?? []);
              const revs = letters.map((l) => l.rev);
              expect(revs).toEqual([...revs].sort((a, b) => a - b));
            }
          }).pipe(Effect.provide(mail())),
        ),
      ),
      { seed: SEED, numRuns: 60 },
    );
  });
});

describe("p21, no Layer fails at build", () => {
  it.effect("a Mailbox over a Ledger that always fails builds, and each call fails with its error", () =>
    check(json, [1], (m) => {
      const broken = Layer.succeed(Ledger, {
        append: () => Effect.fail(new LedgerError({ reason: "unreachable" })),
        read: () => Stream.fail(new LedgerError({ reason: "unreachable" })),
        wait: () => Effect.fail(new LedgerError({ reason: "unreachable" })),
      });
      return Effect.gen(function* () {
        expect((yield* Effect.flip(send("notes:1", LETTER, m))).reason).toBe("unreachable");
        expect((yield* Effect.flip(receive("notes:1"))).reason).toBe("unreachable");
      }).pipe(Effect.provide(Mailbox.layer.pipe(Layer.provide(broken))));
    }),
  );
});
