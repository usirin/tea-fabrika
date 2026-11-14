// P13 slice 1, next/. Replies' database laws, a suite that the module owning a real SQLite driver
// runs (0062): `RepliesTest.suite(database)`. Each law walks the stored replies: every move is
// chosen from what the walk has stored so far, and every answer is compared with an independent
// record of the first reply under each registered name and letter.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Context, Effect, Exit, Layer, Predicate, Result, Schema, Scope, Tracer } from "effect";
import { expectTypeOf } from "vitest";
import type { Sql } from "../Sql.ts";
import type * as Module from "./Replies.ts";
import { Replies } from "./Replies.ts";
import * as RepliesSql from "./RepliesSql.ts";

const SEED = 119120;
const RUNS = 100;

/** A real SQLite database: each run of the inner Effect is a new connection to the same file,
 *  closed with its scope. Each run of the outer Effect is a new, empty database. */
export type Database = Effect.Effect<Effect.Effect<Sql, never, Scope.Scope>, never, Scope.Scope>;

// R13: the service speaks runtime types, shared names and its own error, never a lower module's.
type Service = Module.Replies["Service"];
type Reply = Module.Reply;
expectTypeOf<Effect.Error<ReturnType<Service["reply"]>>>().toEqualTypeOf<Module.RepliesError>();
expectTypeOf<Effect.Error<ReturnType<Service["rememberReply"]>>>().toEqualTypeOf<Module.RepliesError>();
expectTypeOf<Effect.Success<ReturnType<Service["reply"]>>>().toEqualTypeOf<Reply | null>();
expectTypeOf<Effect.Success<ReturnType<Service["rememberReply"]>>>().toEqualTypeOf<Reply>();
expectTypeOf<Module.RepliesError["reason"]>().toEqualTypeOf<"storage" | "bad_row">();
expectTypeOf<Reply["answer"]["_tag"]>().toEqualTypeOf<"refused">();
expectTypeOf<Effect.Services<ReturnType<Service["reply"]>>>().toEqualTypeOf<never>();
expectTypeOf<Effect.Services<ReturnType<Service["rememberReply"]>>>().toEqualTypeOf<never>();

/** The `i`th item, wrapping around; a walk only asks when the list is not empty. */
export const nth = <A>(items: ReadonlyArray<A>, i: number): A => {
  const item = items[i % items.length];

  if (item === undefined) {
    throw new Error("a walk chose from an empty list");
  }

  return item;
};

/** The answer the record expects, made by its own schema rather than the module's. */
const Refused = Schema.TaggedStruct("refused", {
  reason: Schema.String,
  now: Schema.optionalKey(Schema.Number),
  most: Schema.optionalKey(Schema.Number),
});

/** What a corrupt row holds instead: an accepted placing, or a refusal with a malformed reason. */
const Wrong = Schema.TaggedUnion({
  accepted: { rev: Schema.Int, pos: Schema.Int },
  refused: { reason: Schema.Struct({ text: Schema.String }) },
});

/** The three forms a leaked body takes in text: as it is, JSON-escaped and URL-encoded. */
const forms = (secret: string): ReadonlyArray<string> => [
  secret,
  JSON.stringify(secret).slice(1, -1),
  encodeURIComponent(secret),
  secret.slice(0, 14),
];

/** Fails when any output holds any form of any secret, and names each output that does. It scans
 *  first and asserts once: one `expect` for each output and form took more than half of a walk
 *  that looks after every move. */
export const unleaked = (outputs: ReadonlyArray<string>, secrets: ReadonlyArray<string>) => {
  const leaks = secrets.flatMap(forms);
  const leaked = outputs.filter((output) => leaks.some((form) => output.includes(form)));
  // The outputs go in the message: a property law prints the message and not the diff.
  expect(leaked, `input text leaked: ${leaked.join("\n")}`).toEqual([]);
};

/** Made-up input text with a quote, a space, a slash and a non-ASCII letter, so its three forms
 *  differ. Its core is upper case, which no other generated text here uses. */
export const sentinel = Arbitrary.array(Arbitrary.schema(Schema.Literals([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"])), {
  minLength: 10,
  maxLength: 10,
}).pipe(Arbitrary.map((core) => `BODY${core.join("")} "x"/ü`));

/** Entropy a walk reads against its state. */
export const nat = Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })));

/** Text of these characters, as long as asked. */
export const text = (chars: string, maxLength: number) =>
  Arbitrary.array(Arbitrary.schema(Schema.Literals([...chars])), { minLength: 1, maxLength }).pipe(
    Arbitrary.map((cs) => cs.join("")),
  );

/** A tracer that keeps every span it makes. */
export const capture = () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  // An ended NativeSpan takes no more attributes, events or end, so its text is made once. A walk
  // that looks after every move asks for every span again each time; remaking each one cost about
  // a tenth of queue S2's time.
  const ended = new WeakMap<Tracer.NativeSpan, string>();
  const write = (span: Tracer.NativeSpan) =>
    [
      span.name,
      JSON.stringify([...span.attributes], (_, value) => (typeof value === "bigint" ? value.toString() : value)),
      JSON.stringify(span.events, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
      span.status._tag === "Ended" && Exit.isFailure(span.status.exit) ? Cause.pretty(span.status.exit.cause) : "",
    ].join("\n");
  /** Each span as text: its name, tags, events and, once it ended, its exit. */
  const text = () =>
    spans.map((span) => {
      const known = ended.get(span);

      if (known !== undefined) {
        return known;
      }

      const made = write(span);

      if (span.status._tag === "Ended") {
        ended.set(span, made);
      }

      return made;
    });
  return { tracer, text };
};

/** The writes a walk may fail on purpose, and the size a full disk reports. */
type Control = { failWrite: boolean; hits: number };

const WRITE = /^\s*(INSERT|UPDATE|REPLACE|DELETE)\b/i;

/** The connection with one armed fault: the next write throws, as a full or failing disk does. */
const faulty = (sql: Sql, control: Control): Sql => ({
  exec: (query, ...params) => {
    if (control.failWrite && WRITE.test(query)) {
      control.failWrite = false;
      control.hits++;
      throw new Error("disk I/O error");
    }

    return sql.exec(query, ...params);
  },
  transaction: (step) => sql.transaction(step),
  size: () => sql.size(),
});

/** Every table and row of the database, as text, for retained-row and body checks. */
const dump = (sql: Sql): ReadonlyArray<{ readonly table: string; readonly row: Record<string, unknown> }> =>
  sql
    .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .flatMap(({ name }) => sql.exec(`SELECT * FROM "${String(name)}"`).map((row) => ({ table: String(name), row })));

const NAMES = ["notes:1", "notes:2", "counter:1"] as const;
const REASONS = ["changed_elsewhere", "too_long", "bad_msg"] as const;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const lower = text("abcdefghijklmnopqrstuvwxyz0123456789:_-", 12);

/** One move's entropy. Which move it is, and its parameters, are read against the walk's state. */
const char = Arbitrary.schema(Schema.Literals([...ALPHABET]));
const small = Arbitrary.schema(Schema.UndefinedOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))));

const Step = Arbitrary.all({
  pick: nat,
  kind: nat,
  id: lower,
  by: lower,
  for: lower,
  digest: lower,
  parent: Arbitrary.all([char, char]),
  reason: Arbitrary.schema(Schema.Literals(REASONS)),
  now: small,
  most: small,
  body: sentinel,
});
type Step = typeof Step extends Arbitrary.Arbitrary<infer A> ? A : never;
const Walk = Arbitrary.array(Step, { minLength: 4, maxLength: 30 });

type Move = "fresh" | "repeat" | "read" | "reopen" | "fault" | "full" | "corrupt" | "accepted";

/** The corruptions of R5: broken JSON, a missing required field, a key that disagrees with its
 *  row, a field of the wrong type holding input text. R6's are an answer of the wrong case and a
 *  malformed refusal. */
const CORRUPT = ["json", "missing", "key", "typed"] as const;
const ANSWER = ["accepted", "malformed"] as const;

const key = (name: string, id: string) => JSON.stringify([name, id]);

/** A stored cell read as a JSON object, or undefined when it is not one. */
export const parsed = (cell: string): Record<string, unknown> | undefined => {
  const value = Result.try(() => JSON.parse(cell) as unknown);
  return Result.isSuccess(value) && Predicate.isObject(value.success)
    ? (value.success as Record<string, unknown>)
    : undefined;
};

type Proposed = Reply & { readonly body: string };

/** A reply the walk has not stored, with an input body the store must not keep. */
const propose = (n: number, step: Step, name: string, id: string): Proposed => ({
  name,
  id,
  parent: `input_0000000000e0080000000000${step.parent[0]}${step.parent[1]}` as Reply["parent"],
  by: `SHA256:${step.by}`,
  for: step.for,
  digest: `${step.digest}-${n}`,
  answer: Refused.make({
    reason: step.reason,
    ...(step.now === undefined ? {} : { now: step.now }),
    ...(step.most === undefined ? {} : { most: step.most }),
  }),
  body: step.body,
});

/** The stored reply as the record expects it back: the body dropped. */
const plain = ({ body: _body, ...reply }: Proposed): Reply => reply;

/** Asserts the Effect failed in the error channel with this reason, and returns the error. */
const refusedWith = Effect.fnUntraced(function* <A>(
  effect: Effect.Effect<A, Module.RepliesError>,
  reason: Module.RepliesError["reason"],
) {
  const exit = yield* Effect.exit(effect);
  expect(Exit.isFailure(exit), `expected a ${reason} failure, got ${JSON.stringify(exit)}`).toBe(true);

  if (Exit.isSuccess(exit)) {
    return null;
  }

  // A throw or defect is not a typed failure: the plant of R5.
  expect(Cause.hasFails(exit.cause), Cause.pretty(exit.cause)).toBe(true);
  const error = Cause.squash(exit.cause) as Module.RepliesError;
  expect(error._tag).toBe("RepliesError");
  expect(error.reason).toBe(reason);
  return error;
});

const walk = (
  database: Database,
  enabled: ReadonlyArray<Move>,
  steps: ReadonlyArray<Step>,
  spans: ReturnType<typeof capture>,
) =>
  Effect.gen(function* () {
    const open = yield* database;
    const control: Control = { failWrite: false, hits: 0 };
    /** The independent record: the first reply stored under each key, and the rows made corrupt. */
    const first = new Map<string, Reply>();
    const corrupt = new Map<string, string>();
    const secrets: Array<string> = [];
    const errors: Array<string> = [];
    let scope = yield* Scope.make();
    let raw = yield* open.pipe(Scope.provide(scope));
    const connect = Effect.fnUntraced(function* (capacity: number) {
      const context = yield* Layer.build(RepliesSql.layer(faulty(raw, control), { capacity })).pipe(
        Scope.provide(scope),
      );
      return Context.get(context, Replies);
    });
    let service = yield* connect(1024 ** 3);
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const reopen = Effect.fnUntraced(function* () {
      yield* Scope.close(scope, Exit.void);
      scope = yield* Scope.make();
      raw = yield* open.pipe(Scope.provide(scope));
      service = yield* connect(1024 ** 3);
    });
    const unseen = (step: Step, n: number): { name: string; id: string } => {
      // Half the time, a letter already stored under another registered name.
      const known = [...first.values()].filter((r) => !first.has(key(nth(NAMES, step.kind), r.id)));
      const reuse = step.kind % 2 === 0 ? known[step.pick % Math.max(known.length, 1)] : undefined;
      const name = nth(NAMES, step.kind);
      return { name, id: reuse?.id ?? `${step.id}-${n}` };
    };
    const note = (error: unknown) => {
      errors.push(String(error), JSON.stringify(error), Cause.pretty(Cause.fail(error)));
    };

    for (const [n, step] of steps.entries()) {
      const good = [...first.entries()].filter(([k]) => !corrupt.has(k));
      const moves = enabled.filter((move) =>
        move === "repeat" || move === "read" || move === "corrupt" || move === "accepted" ? good.length > 0 : true,
      );
      const move = nth(moves, step.pick);
      const chosen = good[step.kind % Math.max(good.length, 1)];

      if (move === "fresh") {
        const { name, id } = unseen(step, n);
        const proposed = propose(n, step, name, id);
        secrets.push(proposed.body);
        expect(yield* service.reply(name, id), "an unstored key reads as absent").toBeNull();
        expect(yield* service.rememberReply(proposed)).toEqual(plain(proposed));
        first.set(key(name, id), plain(proposed));
      } else if (move === "repeat" && chosen !== undefined) {
        // Same key, another answer or binding: the first stored row wins (R1).
        const [, stored] = chosen;
        const proposed = propose(n, step, stored.name, stored.id);
        secrets.push(proposed.body);
        expect(yield* service.rememberReply(proposed)).toEqual(stored);
      } else if (move === "read" && chosen !== undefined) {
        const [, stored] = chosen;
        expect(yield* service.reply(stored.name, stored.id)).toEqual(stored);
        // The same letter under a registered name that holds no reply for it.
        const other = NAMES.find((name) => !first.has(key(name, stored.id)));

        if (other !== undefined) {
          expect(yield* service.reply(other, stored.id)).toBeNull();
        }
      } else if (move === "reopen") {
        yield* reopen();
      } else if (move === "fault" || move === "full") {
        // A write that cannot commit fails, keeps nothing, and leaves every earlier reply.
        const { name, id } = unseen(step, n);
        const proposed = propose(n, step, name, id);
        secrets.push(proposed.body);
        const before = dump(raw);

        if (move === "fault") {
          control.failWrite = true;
        } else {
          service = yield* connect(raw.size());
        }

        const error = yield* refusedWith(service.rememberReply(proposed), "storage");
        note(error);
        control.failWrite = false;
        service = yield* connect(1024 ** 3);
        expect(dump(raw), "a failed write keeps nothing").toEqual(before);
        expect(yield* service.reply(name, id), "a failed write is not a stored reply").toBeNull();
      } else if ((move === "corrupt" || move === "accepted") && chosen !== undefined) {
        const [k, stored] = chosen;
        const located = dump(raw).flatMap(({ table, row }) =>
          Object.entries(row).flatMap(([column, value]) => {
            if (typeof value !== "string" || parsed(value)?.["digest"] !== stored.digest) {
              return [];
            }

            return [{ table, column, value }];
          }),
        );
        expect(located, "one stored JSON value holds the reply").toHaveLength(1);
        const [{ table, column, value }] = located as [{ table: string; column: string; value: string }];
        const json = JSON.parse(value) as Record<string, unknown>;
        const secret = step.body;
        secrets.push(secret);
        const kind = move === "corrupt" ? nth(CORRUPT, step.kind) : nth(ANSWER, step.kind);
        const fields = ["parent", "by", "for", "digest", "answer"] as const;
        const damaged =
          kind === "json"
            ? `${value.slice(0, -1)}${secret}`
            : kind === "missing"
              ? JSON.stringify(
                  Object.fromEntries(Object.entries(json).filter(([f]) => f !== fields[n % fields.length])),
                )
              : kind === "key"
                ? JSON.stringify({ ...json, ...(n % 2 === 0 ? { id: `${stored.id}-other` } : { name: "other:1" }) })
                : kind === "typed"
                  ? JSON.stringify({ ...json, by: { text: secret } })
                  : kind === "accepted"
                    ? JSON.stringify({ ...json, answer: Wrong.cases.accepted.make({ rev: n + 1, pos: n + 1 }) })
                    : JSON.stringify({ ...json, answer: Wrong.cases.refused.make({ reason: { text: secret } }) });
        raw.exec(`UPDATE "${table}" SET "${column}"=? WHERE "${column}"=?`, damaged, value);
        corrupt.set(k, damaged);
      }

      // After every move: each corrupt row fails visibly, under read and write, and stays stored.
      for (const [k, damaged] of corrupt) {
        const stored = first.get(k);

        if (stored === undefined) {
          continue;
        }

        note(yield* refusedWith(service.reply(stored.name, stored.id), "bad_row"));
        note(yield* refusedWith(service.rememberReply(stored), "bad_row"));
        const cells = dump(raw).flatMap(({ row }) => Object.values(row));
        expect(cells, "a corrupt row is retained as it was").toContain(damaged);
      }

      // After every move: no stored row, printed error or span holds a body (R11).
      const damaged = new Set(corrupt.values());
      const cells = dump(raw)
        .flatMap(({ row }) => Object.values(row))
        .filter((cell): cell is string => typeof cell === "string" && !damaged.has(cell));
      unleaked([...cells, ...errors, ...spans.text()], secrets);
    }

    // The record and the store agree at the end, after one more reopen.
    yield* reopen();

    for (const [k, stored] of first) {
      if (!corrupt.has(k)) {
        expect(yield* service.reply(stored.name, stored.id)).toEqual(stored);
      }
    }
  }).pipe(Effect.withTracer(spans.tracer));

/** One law: a property over generated walks with these moves, each walk in its own scope. */
const law = (name: string, database: Database, enabled: ReadonlyArray<Move>) =>
  it.live.prop(name, [Walk], ([steps]) => Effect.scoped(walk(database, enabled, steps, capture())), {
    timeout: 120_000,
    arbitrary: { seed: SEED, runs: RUNS },
  });

export const suite = (database: Database) =>
  describe("P13 Replies", () => {
    law("R1: the first reply wins under each registered name and letter, and names stay separate", database, [
      "fresh",
      "repeat",
      "read",
    ]);
    law("R2: replies survive every reopen", database, ["fresh", "repeat", "read", "reopen"]);
    law("R4: a write that cannot commit fails, keeps nothing and keeps every earlier reply", database, [
      "fresh",
      "read",
      "fault",
      "full",
      "reopen",
    ]);
    law("R5: corrupt stored JSON and fields fail visibly as bad_row and remain stored", database, [
      "fresh",
      "read",
      "corrupt",
      "reopen",
    ]);
    law("R6: a stored accepted or malformed answer is never a terminal reply", database, [
      "fresh",
      "read",
      "accepted",
      "reopen",
    ]);
    law("R11 [secrets]: reply rows, errors and spans hold no input body", database, [
      "fresh",
      "repeat",
      "fault",
      "full",
      "corrupt",
      "accepted",
      "reopen",
    ]);
  });
