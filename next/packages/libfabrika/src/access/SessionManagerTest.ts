// Question 16: the saved input owns signing rules. Internal record/delivered/end are used by the
// door and P33; only signer crosses the trusted runner RPC. SignRequest supplies its stable id.
// Plants: last sender wins; any process borrows a parent; person comment can approve; a Map
// forgets spends; receipt saved after spending; a cached receipt survives revocation.
//
// Ticket 921 slice 1, next/. A suite on any `Sql`, read through its module as
// `SessionManagerTest.suite(open)`: the module that owns the driver runs it, so this file names no
// driver and no ledger file (0043 rule 11, 0062).
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Brand, Effect, Option, Result, Schema, type Scope } from "effect";
import * as Id from "../Id.ts";
import { Recipient, inSignalSpace } from "../processes/Process.ts";
import { signalId } from "../processes/Process.ts";
import type { Sql } from "../Sql.ts";
import { Writer, Session, SessionManager, NotGranted, SignRequest } from "./SessionManager.ts";

// Match fc.jsonValue({maxDepth: depth}): finite numbers, strings/keys of
// length 0..10, and arrays/objects of width 0..10. No required object keys.
// Finite schema levels give every child its own full range. Call with size >= 10.
const scalar = Schema.Union([Schema.Null, Schema.Boolean, Schema.Finite, Schema.String.check(Schema.isMaxLength(10))]);

const json = (depth: number): Schema.Codec<Schema.Json> =>
  depth === 0
    ? scalar
    : Schema.Union([
        scalar,
        Schema.Array(json(depth - 1)).check(Schema.isMaxLength(10)),
        Schema.Record(Schema.String.check(Schema.isMaxLength(10)), json(depth - 1)).check(Schema.isMaxProperties(10)),
      ]);

// Three valid process ids for the fixed example. The generated cases cover the id space.
const OTHER_PROCESS = "process_0000000000e008000000000001";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const PROCESS = "process_0000000000e008000000000000";
const SPAN = "00f067aa0ba902b7";
const START = "process_0000000000e008000000000002";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const sample = {
  PROCESS,
  OTHER_PROCESS,
  PERSON,
  START,
  TRACE,
  SPAN,
  key: "SHA256:person-window",
  agentKey: "SHA256:agent",
  id: "write-a",
  kinds: ["saved", "commented"],
};

// T540 regression: write-b collided with the refusal law's fixed second id.
// The retry/wake law also checks that two write-b calls return the same receipt.
const sessionExamples = [sample, { ...sample, id: "write-b" }];
// Size covers the whole pattern: 14 characters of SHA256:person- plus
// the old 1..40 suffix, not just one suffix character at the default size.
// It also covers write- plus every 1..20-character suffix in the id tuple.
const sessionOptions = { arbitrary: { seed: 119120, runs: 20, size: 54 } };

// Id.Process generates its whole UUIDv7 space, including both version chars and all eight variants.
const sessionSchema = Schema.Struct({
  PROCESS: Id.Process,
  OTHER_PROCESS: Id.Process,
  START: Id.Process,
  PERSON: Writer.cases.person.fields.for.check(Schema.isPattern(/^person_[0-7][0-9a-hjkmnp-tv-z]{25}$/)),
  TRACE: Session.fields.traceId.check(Schema.isPattern(/^[1-9a-f][0-9a-f]{31}$/)),
  SPAN: Session.fields.span.fields.spanId.check(Schema.isPattern(/^[1-9a-f][0-9a-f]{15}$/)),
  key: Writer.cases.person.fields.key.check(Schema.isPattern(/^SHA256:person-[\x20-\x7e]{1,40}$/)),
  agentKey: Writer.cases.agent.fields.key.check(Schema.isPattern(/^SHA256:agent-[\x20-\x7e]{1,40}$/)),
  id: Schema.String.check(Schema.isPattern(/^write-[a-z0-9]{1,20}$/)),
  kinds: Schema.Array(
    Schema.String.check(
      Schema.isPattern(/^[\x20-\x7e]{1,30}$/),
      Schema.makeFilter((kind) => kind !== "answered"),
    ),
  ).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(2),
    Schema.makeFilter((kinds) => new Set(kinds).size === kinds.length),
  ),
});

const sessionArb = Arbitrary.schema(sessionSchema).pipe(
  Arbitrary.filter((value) => value.PROCESS !== value.OTHER_PROCESS),
);

/** What the module that owns the driver gives: one database file, and a way to open it again. */
export type Store = {
  /** One `Sql` across reopens: each call goes to the database open now. */
  readonly sql: Sql;
  /** Closes the database and opens its file again, as a restart does. */
  readonly reopen: Effect.Effect<void>;
};

/** A fresh database file each time it runs. Its scope closes the connection and removes the file (0061). */
export type Open = Effect.Effect<Store, never, Scope.Scope>;

const inputId = Brand.nominal<Id.InputId>(); // Test plays the trusted door, never a public decoder.

const setup = ({
  PROCESS,
  OTHER_PROCESS,
  PERSON,
  START,
  TRACE,
  SPAN,
  key,
  agentKey,
  id,
  kinds,
}: typeof sessionSchema.Encoded) => {
  const parent = inputId(`in-${START}-1`);
  const policy = {
    input: (name: string) => name === "approve",
    event: (name: string) => name === "answered",
  };
  const writer = (as: "person" | "agent") =>
    Writer.cases[as].make({
      key: as === "person" ? key : agentKey,
      for: PERSON,
    });
  const saved = (as: "person" | "agent" = "person", personOnly: boolean = true) => ({
    id: parent,
    by: writer(as),
    client: as,
    process: PROCESS,
    name: personOnly ? "approve" : "comment",
    personOnly,
    digest: "SHA256:payload",
    traceId: TRACE,
    span: { traceId: TRACE, spanId: SPAN },
    arrivedAt: 100,
  });
  const authority = (sql: Sql, live: () => boolean = () => true) =>
    SessionManager.layer(
      sql,
      (key: string) =>
        live() ? Effect.succeed(writer(key === "agent" ? "agent" : "person")) : Effect.fail(new NotGranted({})),
      policy,
    );
  const signer = (writeId: string = id, kind: string = "answered", process = PROCESS, p: string = parent) =>
    SessionManager.use((s) => s.signer(p, process, kind)).pipe(Effect.provideService(SignRequest, { id: writeId }));
  return {
    PROCESS,
    OTHER_PROCESS,
    START,
    TRACE,
    SPAN,
    parent,
    writer,
    saved,
    signer,
    authority,
    kinds,
  };
};

const { parent, saved, signer, authority } = setup(sample);

const authorityProperty = (
  name: string,
  law: (context: ReturnType<typeof setup>) => Effect.Effect<void, unknown, Scope.Scope>,
) =>
  it.effect.prop(
    name,
    [sessionArb],
    ([value]) =>
      Effect.forEach([...sessionExamples, value], (example) => law(setup(example)), {
        concurrency: 1,
        discard: true,
      }),
    sessionOptions,
  );

const snapshot = (sql: Sql) =>
  JSON.stringify(
    sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(({ name }) => [
      name,
      sql
        .exec(`SELECT * FROM "${String(name)}"`)
        .map((row) => JSON.stringify(row))
        .sort(),
    ]),
  );

// A synchronous Sql fault after the writes, before commit. The driver must roll it all back.
const commitFault = (inner: Sql) => {
  let armed = false;
  const fault = new Error("SQLITE_FULL");
  const sql: Sql = {
    ...inner,
    transaction: (step) =>
      inner.transaction(() => {
        const answer = step();

        if (armed) {
          armed = false;
          throw fault;
        }

        return answer;
      }),
  };
  return {
    sql,
    fault,
    arm: () => {
      armed = true;
    },
  };
};

/** Holds that `error` is the signer's own refusal, for that reason. */
const refusedFor = (error: unknown, reason: string) => {
  expect(error).toHaveProperty("_tag", "SigningRefused");
  expect(error).toHaveProperty("reason", reason);
};

/** The fault a service's own error keeps under its tagged reason (0119). */
const kept = Schema.decodeUnknownSync(Schema.Struct({ reason: Schema.Struct({ cause: Schema.Unknown }) }));

const signingLaws = (open: Open) => {
  it.prop(
    "question 16: a session without a complete parent span is not a valid receipt",
    [sessionArb],
    ([generated]) => {
      for (const value of [sample, generated]) {
        const { writer, parent, TRACE, SPAN } = setup(value);
        const session = {
          by: writer("person"),
          parent,
          traceId: TRACE,
          span: { traceId: TRACE, spanId: SPAN },
        };
        expect(Schema.decodeUnknownSync(Session)(session)).toEqual(session);

        for (const span of [{}, { traceId: TRACE }, { spanId: SPAN }]) {
          expect(Schema.is(Session)({ ...session, span })).toBe(false);
        }
      }
    },
    { arbitrary: { seed: 119120, runs: 100, size: 54 } },
  );
  authorityProperty(
    "unknown delivery and a signer on a fresh database refuse not_delivered",
    ({ parent, signer, authority, PROCESS }) =>
      Effect.flatMap(open, ({ sql }) =>
        Effect.gen(function* () {
          refusedFor(yield* Effect.flip(signer()), "not_delivered");
          const sessions = yield* SessionManager;
          refusedFor(yield* Effect.flip(sessions.delivered(parent, PROCESS)), "not_delivered");
        }).pipe(Effect.provide(authority(sql))),
      ),
  );
  authorityProperty(
    "replaying an input preserves its first body and refuses a different body",
    ({ saved, parent, authority, PROCESS }) =>
      Effect.flatMap(open, ({ sql }) =>
        Effect.gen(function* () {
          const sessions = yield* SessionManager;
          const input = saved();
          yield* sessions.record(input);
          yield* sessions.delivered(parent, PROCESS);
          const before = snapshot(sql);
          yield* sessions.record(input);
          expect(snapshot(sql)).toBe(before);
          refusedFor(
            yield* Effect.flip(sessions.record({ ...input, digest: `${input.digest}-changed` })),
            "not_delivered",
          );
          expect(snapshot(sql)).toBe(before);
        }).pipe(Effect.provide(authority(sql))),
      ),
  );
  authorityProperty(
    "policy permission does not turn an ordinary input into person-only approval",
    ({ saved, parent, signer, authority, PROCESS }) =>
      Effect.flatMap(open, ({ sql }) =>
        Effect.gen(function* () {
          const sessions = yield* SessionManager;
          yield* sessions.record({ ...saved("person", false), name: "approve" });
          yield* sessions.delivered(parent, PROCESS);
          const result = yield* Effect.result(signer());
          expect(Result.isFailure(result)).toBe(true);
          refusedFor(Result.getFailure(result).pipe(Option.getOrNull), "person_only");
        }).pipe(Effect.provide(authority(sql))),
      ),
  );
  authorityProperty(
    "question 16: interleaved writers keep the direct parent's identity and span",
    ({ saved, parent, signer, writer, authority, PROCESS, START, TRACE, SPAN }) =>
      Effect.gen(function* () {
        const { sql } = yield* open;
        yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          yield* s.record(saved());
          yield* s.delivered(parent, PROCESS);
          const agent = { ...saved("agent"), id: inputId(`in-${START}-2`) };
          yield* s.record(agent);
          yield* s.delivered(agent.id, PROCESS);
          const session = yield* signer();
          expect(session).toEqual({
            by: writer("person"),
            parent,
            traceId: TRACE,
            span: { traceId: TRACE, spanId: SPAN },
          });
          const agentSession = yield* signer("agent-write", "saved", PROCESS, agent.id);
          expect(agentSession.by).toEqual(writer("agent"));
          expect(agentSession.traceId).toBe(session.traceId);
        }).pipe(Effect.provide(authority(sql)));
      }),
  );

  for (const reason of ["not_delivered", "person_only", "ended"] as const) {
    authorityProperty(
      `question 16: ${reason} is distinct and changes no saved rows`,
      ({ saved, parent, signer, authority, PROCESS }) =>
        Effect.gen(function* () {
          const { sql } = yield* open;
          yield* Effect.gen(function* () {
            const s = yield* SessionManager;
            yield* s.record(saved("person", reason !== "person_only"));

            if (reason !== "not_delivered") {
              yield* s.delivered(parent, PROCESS);
            }

            if (reason === "ended") {
              yield* s.end(PROCESS);
            }

            const before = snapshot(sql);
            const error = yield* Effect.flip(signer("write-b"));
            refusedFor(error, reason);
            expect(snapshot(sql)).toBe(before);
          }).pipe(Effect.provide(authority(sql)));
        }),
    );
  }

  it.effect.prop(
    "question 16: spent is distinct and changes no saved rows",
    [
      sessionArb,
      Arbitrary.schema(Schema.Tuple([sessionSchema.fields.id, sessionSchema.fields.id])).pipe(
        Arbitrary.filter(([first, second]) => first !== second),
      ),
    ],
    ([value, ids]) =>
      Effect.forEach(
        [...sessionExamples, value],
        (example) => {
          const { saved, parent, signer, authority, PROCESS } = setup(example);
          return Effect.forEach(
            [
              ["write-a", "write-b"], // T540: comparing ids without their last character.
              ["write-b", "write-a"], // T540: write-b collided with the fixed second id.
              ids,
            ] as const,
            ([firstId, secondId]) =>
              Effect.flatMap(open, ({ sql }) =>
                Effect.gen(function* () {
                  const s = yield* SessionManager;
                  yield* s.record(saved());
                  yield* s.delivered(parent, PROCESS);
                  yield* signer(firstId);
                  const before = snapshot(sql);
                  refusedFor(yield* Effect.flip(signer(secondId)), "spent");
                  expect(snapshot(sql)).toBe(before);
                }).pipe(Effect.provide(authority(sql))),
              ),
            { concurrency: 1, discard: true },
          );
        },
        { concurrency: 1, discard: true },
      ),
    sessionOptions,
  );
  authorityProperty(
    "question 16: a parent delivered to one process is refused to another",
    ({ saved, parent, signer, authority, PROCESS, OTHER_PROCESS }) =>
      Effect.gen(function* () {
        const { sql } = yield* open;
        yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          yield* s.record(saved());
          yield* s.delivered(parent, PROCESS);
          expect(yield* Effect.flip(signer("write-a", "answered", OTHER_PROCESS))).toMatchObject({
            reason: "not_delivered",
          });
        }).pipe(Effect.provide(authority(sql)));
      }),
  );
  authorityProperty(
    "question 16: an agent on a person-only input still cannot approve",
    ({ saved, parent, signer, authority, PROCESS }) =>
      Effect.gen(function* () {
        const { sql } = yield* open;
        yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          yield* s.record(saved("agent", true));
          yield* s.delivered(parent, PROCESS);
          expect(yield* Effect.flip(signer())).toMatchObject({ reason: "person_only" });
        }).pipe(Effect.provide(authority(sql)));
      }),
  );
  authorityProperty(
    "question 16: different allowed kinds can spend the same parent independently",
    ({ saved, parent, signer, writer, authority, PROCESS, kinds }) =>
      Effect.gen(function* () {
        const { sql } = yield* open;
        yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          yield* s.record(saved());
          yield* s.delivered(parent, PROCESS);
          const kind = (n: number) => kinds[n] ?? expect.fail("the generator gives two kinds");
          expect((yield* signer("a", kind(0))).by).toEqual(writer("person"));
          expect((yield* signer("b", kind(1))).by).toEqual(writer("person"));
        }).pipe(Effect.provide(authority(sql)));
      }),
  );
  authorityProperty(
    "retry/wake: a lost answer returns the identical receipt after reopening SQLite",
    ({ saved, parent, signer, authority, PROCESS }) =>
      Effect.gen(function* () {
        const first = yield* open;
        const session = yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          yield* s.record(saved());
          yield* s.delivered(parent, PROCESS);
          return yield* signer();
        }).pipe(Effect.provide(authority(first.sql)));
        yield* first.reopen;
        yield* Effect.gen(function* () {
          expect(yield* signer()).toEqual(session);
          expect(yield* Effect.flip(signer("other-write"))).toMatchObject({ reason: "spent" });
        }).pipe(Effect.provide(authority(first.sql)));
      }),
  );
  authorityProperty(
    "atomic receipt: a storage failure rolls back both spend and receipt",
    ({ saved, parent, signer, authority, PROCESS }) =>
      Effect.gen(function* () {
        const { sql } = yield* open;
        const failure = commitFault(sql);
        yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          yield* s.record(saved());
          yield* s.delivered(parent, PROCESS);
          const before = snapshot(sql);
          failure.arm();
          // The manager answers in its own error, and SQLite's throw rides under its reason (0043 rule 12).
          const refused = yield* Effect.flip(signer());
          expect(refused).toHaveProperty("_tag", "SessionManagerError");
          expect(refused).toHaveProperty("reason._tag", "Storage");
          expect(kept(refused).reason.cause).toBe(failure.fault);
          expect(snapshot(sql)).toBe(before);
          const retry = yield* signer();
          expect(retry.parent).toBe(parent);
          expect(yield* Effect.flip(signer("other-write"))).toMatchObject({ reason: "spent" });
        }).pipe(Effect.provide(authority(failure.sql)));
      }),
  );
  authorityProperty(
    "exit/wake: an ended process cannot revive through layer rebuild or an old receipt",
    ({ saved, parent, signer, authority, PROCESS }) =>
      Effect.gen(function* () {
        const first = yield* open;
        yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          yield* s.record(saved());
          yield* s.delivered(parent, PROCESS);
          yield* signer();
          yield* s.end(PROCESS);
        }).pipe(Effect.provide(authority(first.sql)));
        yield* first.reopen;
        expect(yield* Effect.flip(signer()).pipe(Effect.provide(authority(first.sql)))).toMatchObject({
          reason: "ended",
        });
      }),
  );
  authorityProperty(
    "revocation: even the same write id must recheck live membership",
    ({ saved, parent, signer, authority, PROCESS }) =>
      Effect.gen(function* () {
        const { sql } = yield* open;
        let live = true;
        yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          yield* s.record(saved());
          yield* s.delivered(parent, PROCESS);
          yield* signer();
          live = false;
          expect(Result.isFailure(yield* Effect.result(signer()))).toBe(true);
          expect((yield* Effect.flip(signer()))._tag).toBe("NotGranted");
        }).pipe(Effect.provide(authority(sql, () => live)));
      }),
  );
  authorityProperty(
    "traceId cannot choose a writer or authorize a missing parent",
    ({ saved, parent, signer, authority, PROCESS, START }) =>
      Effect.gen(function* () {
        const { sql } = yield* open;
        yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          yield* s.record(saved());
          yield* s.delivered(parent, PROCESS);
          expect(yield* Effect.flip(signer("a", "saved", PROCESS, `in-${START}-999`))).toMatchObject({
            reason: "not_delivered",
          });
        }).pipe(Effect.provide(authority(sql)));
      }),
  );
};

// P33 review round 3, rule 2: an id in the signal id space is the brain's alone, so the signer
// refuses it, signs nothing, saves no receipt and leaves the parent free for a real write.
const signalLaws = (open: Open) => {
  it.effect.prop(
    "B2: the signer refuses notice ids as signal without spending the parent or saving a receipt",
    [Schema.Literals(["person", "agent", "recovered"]), Schema.String, Schema.Literals(["", " ", "\n", "\t"])],
    ([sender, key, space]) =>
      Effect.gen(function* () {
        const { sql } = yield* open;
        const { saved, signer, authority, parent } = setup(sample);
        yield* Effect.gen(function* () {
          const s = yield* SessionManager;
          const input = saved(sender === "agent" ? "agent" : "person", false);
          yield* s.record({
            ...input,
            by:
              sender === "recovered"
                ? Writer.cases.person.make({ for: input.by.for, key: "SHA256:recovered" })
                : input.by,
          });
          yield* s.delivered(parent, PROCESS);
          const before = snapshot(sql);

          for (const id of [
            JSON.stringify(["notice", key]),
            `${space}[${space}"notice",${JSON.stringify(key)}]${space}`,
            '["notice"',
          ]) {
            refusedFor(yield* Effect.flip(signer(id, "saved")), "signal");
            expect(snapshot(sql)).toBe(before);
          }

          expect((yield* signer("write-after", "saved")).parent).toBe(parent);
        }).pipe(Effect.provide(authority(sql)));
      }),
    { arbitrary: { seed: 119120 } },
  );

  const toW = Recipient.cases.process.make({ process: OTHER_PROCESS });
  const ids = [
    signalId(toW, "watch:1", 1),
    signalId(Recipient.cases.client.make({ client: "window-a", session: START }), "w", 3),
    JSON.stringify(["DOWN"]),
    ' [ "DOWN" , 1 ]',
    '["DOWN", not json',
  ];
  const refusedThenFree = (id: string) =>
    Effect.gen(function* () {
      const { sql } = yield* open;
      yield* Effect.gen(function* () {
        const s = yield* SessionManager;
        yield* s.record(saved());
        yield* s.delivered(parent, PROCESS);
        const before = snapshot(sql);
        expect(Result.isFailure(yield* Effect.result(signer(id)))).toBe(true);
        expect(yield* Effect.flip(signer(id))).toHaveProperty("_tag", "SigningRefused");
        expect(snapshot(sql)).toBe(before);
        expect((yield* signer("write-after")).parent).toBe(parent);
      }).pipe(Effect.provide(authority(sql)));
    });
  const id = Arbitrary.schema(
    Schema.Tuple([
      Schema.Literals([0, 1, 2]),
      Schema.Literals(["", " ", "\n", "\t"]),
      Schema.Array(json(2)).check(Schema.isMaxLength(4)),
      Schema.String.check(Schema.isMaxLength(20)),
    ]),
  ).pipe(
    Arbitrary.map(([kind, space, rest, tail]) =>
      kind === 0
        ? JSON.stringify(["DOWN", ...rest])
        : kind === 1
          ? `[${space}${JSON.stringify(["DOWN", ...rest]).slice(1)}`
          : `["DOWN"${tail}`,
    ),
    Arbitrary.filter(inSignalSpace),
  );
  it.effect.prop(
    "for any id the signal id space holds, the signer answers SigningRefused",
    [id],
    ([generated]) =>
      Effect.forEach(
        [...ids, generated],
        (value) =>
          Effect.gen(function* () {
            expect(inSignalSpace(value)).toBe(true);
            yield* refusedThenFree(value);
          }),
        { concurrency: 1 },
      ),
    { arbitrary: { seed: 119120, runs: 25, size: 440 } },
  );
};

export const suite = (open: Open) => {
  describe("P10 saved signing authority", () => {
    signingLaws(open);
  });
  describe("P33, the signer refuses every id in the signal id space", () => {
    signalLaws(open);
  });
};
