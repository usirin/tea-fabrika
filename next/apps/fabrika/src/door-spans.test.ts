// T285, PR 1, next/. These laws keep the five partial door spans at their current scope.
// Plants: widen initialize, rename a span, lose its parent/link/tags, or recover inside it.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ClientRecord, Id } from "@kampus/libfabrika";
import { ClientManager, grantText, Saw } from "@kampus/libfabrika/coordination";
import {
  Archive,
  Chain,
  Doorbell,
  Ledger,
  LedgerError,
  LedgerTransaction,
  type LedgerTurn,
  RecordManager,
  SpanSink,
} from "@kampus/libfabrika/data";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Arbitrary, Cause, Effect, Exit, Layer, Option, Schema, Stream, Tracer } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Door } from "./door.ts";

const CHECK = { seed: 119120, numRuns: 40, endOnFailure: true };
const URL = "https://fabrika.test/entry/project-socket";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjs";
const SENT = "2026-11-08T04:00:00.000Z";
const Input = Schema.TaggedUnion({ comment: { text: Schema.String } });
const text = fc.string({ minLength: 1, maxLength: 100 });

const hex = (bytes: number) =>
  fc.uint8Array({ minLength: bytes, maxLength: bytes }).map((a) => `1${Buffer.from(a).toString("hex").slice(1)}`);

const sample = fc.record({
  seed: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  traceId: hex(16),
  spanId: hex(8),
  text,
  id: fc.uuid(),
});

type Sample = typeof sample extends fc.Arbitrary<infer A> ? A : never;

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

const field = (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return Buffer.concat([u32(bytes.length), bytes]);
};

const fingerprint = (bytes: Uint8Array) =>
  `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;

// Generated Ed25519 seeds stay in memory. No key file is read or written.
const key = (seed: Uint8Array, salt: number) => {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(seed.map((b) => b ^ salt)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const raw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
  const blob = Buffer.concat([field("ssh-ed25519"), field(raw)]);
  return {
    raw: raw.toString("base64url"),
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: fingerprint(raw),
    sshFingerprint: fingerprint(blob),
    sign: (text: string) => {
      const space = "fabrika-client";
      const signed = Buffer.concat([
        Buffer.from("SSHSIG"),
        field(space),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(text).digest()),
      ]);
      const signature = Buffer.concat([field("ssh-ed25519"), field(sign(null, signed, privateKey))]);
      const bytes = Buffer.concat([
        Buffer.from("SSHSIG"),
        u32(1),
        field(blob),
        field(space),
        field(""),
        field("sha512"),
        field(signature),
      ]);
      return `-----BEGIN SSH SIGNATURE-----\n${bytes
        .toString("base64")
        .match(/.{1,70}/g)
        ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

type Sql = ReturnType<typeof nodeSql>;

/** `sink` wraps the Sql the span sink writes to (P14's failed-write laws); the door's own store is untouched. */
const fixture = Effect.fnUntraced(function* (a: Sample, sink: (sql: Sql) => Sql = (sql) => sql) {
  const databases: Array<DatabaseSync> = [];
  const open = () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    return nodeSql(db);
  };
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const db of databases) {
        db.close();
      }
    }),
  );
  const sql = open();
  const root = key(a.seed, 0),
    window = key(a.seed, 1),
    stranger = key(a.seed, 2);
  const controls = { fail: "", deliveryFails: false };
  const actual = yield* Effect.service(Ledger).pipe(
    Effect.provide(
      Ledger.sql(sql, { reader: "project" }).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void }))),
    ),
  );
  const ledger = Layer.succeed(Ledger, {
    ...actual,
    append: (stream, id, line) =>
      controls.fail === stream ? Effect.fail(new LedgerError({ reason: "storage" })) : actual.append(stream, id, line),
  });
  const transaction = Layer.effect(
    LedgerTransaction,
    LedgerTransaction.pipe(
      Effect.map((actual) => ({
        transact: <A>(step: (turn: LedgerTurn) => A) =>
          actual.transact((turn) =>
            step({
              ...turn,
              append: (stream, id, line) => {
                if (controls.fail === stream) {
                  throw new LedgerError({ reason: "storage" });
                }

                return turn.append(stream, id, line);
              },
            }),
          ),
      })),
    ),
  ).pipe(
    Layer.provide(LedgerTransaction.layer(sql)),
    Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
  );
  const founder = {
    name: "project",
    person: PERSON,
    keys: [root.line],
    window: window.raw,
    by: root.sshFingerprint,
    build: "test-build",
  };
  const clients = ClientManager.layer(founder).pipe(Layer.provideMerge(ledger));
  const parts = new Map<string, ReturnType<typeof nodeSql>>();
  const records = RecordManager.sql((name) => {
    let part = parts.get(name);

    if (part === undefined) {
      part = open();
      parts.set(name, part);
    }

    return part;
  }, 64 * 1024);
  const layer = Door.layer({
    sql,
    founder,
    name: "project",
    url: URL,
    origins: ["https://fabrika.test"],
    versions: [1, 2],
    location: "test",
    build: "test-build",
    waiting: { most: 3, ttl: 600_000 },
    ping: { min: 10_000, max: 60_000 },
    inputCap: 100,
    spentCap: 100,
    nextProcess: () => Effect.succeed(PROCESS),
    notify: () => Effect.void,
    deliver: () => (controls.deliveryFails ? Effect.fail(new LedgerError({ reason: "unreachable" })) : Effect.void),
    inputs: { schema: Input, personOnly: [], raw: [], log: Schema.toCodecJson(Input) },
    events: { personOnly: [] },
  }).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        clients,
        transaction,
        Id.Generator.layer,
        records,
        Archive.memory,
        SpanSink.layer(sink(sql), { object: PROCESS }),
      ),
    ),
  );
  return { layer, window, stranger, root, controls, databases };
});

const capture = (delegate: Tracer.Tracer) => {
  const spans: Array<Tracer.Span> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = delegate.span(options);
      spans.push(span);
      return span;
    },
  });
  return { spans, tracer };
};

const parent = (a: Sample) => Tracer.externalSpan({ traceId: a.traceId, spanId: a.spanId });

const checkSpan = (span: Tracer.Span, a: Sample, ok: boolean, attributes: Record<string, unknown> = {}) => {
  expect(span.traceId).toBe(a.traceId);
  expect(Option.getOrThrow(span.parent).spanId).toBe(a.spanId);
  expect(Object.fromEntries(span.attributes)).toEqual(attributes);
  expect(span.status._tag).toBe("Ended");

  if (span.status._tag === "Ended") {
    expect(Exit.isSuccess(span.status.exit)).toBe(ok);
  }
};

const hello = Effect.fnUntraced(function* (d: typeof Door.Service, k: ReturnType<typeof key>, tab: string) {
  const client = yield* d.connect(),
    nonce = yield* d.challenge(client);
  return {
    client,
    input: {
      versions: [1, 2],
      has: ["verify"],
      ping: "30s",
      key: k.raw,
      tab,
      nonce,
      platform: "browser",
      os: "unknown",
      sentAt: SENT,
      signed: k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
    },
    trusted: { url: URL, tab, name: k.fingerprint },
  };
});

const online = Effect.fnUntraced(function* (
  d: typeof Door.Service,
  w: Effect.Success<ReturnType<typeof fixture>>,
  a: Sample,
) {
  const h = yield* hello(d, w.window, a.text);
  expect(yield* d.initialize(h.client, h.input, h.trusted)).toMatchObject({ _tag: "online" });
  return h.client;
});

const saw = (a: Sample) =>
  Saw.make({
    code: a.id,
    label: a.text,
    where: "test",
    how: "compare",
    check: "touch",
    has: ["verify"],
  });

describe("door partial spans, next/ tracing keep-laws", () => {
  it("generated unknown and invalid hellos never open door.initialize, before or after founding", async () => {
    await fc.assert(
      fc.asyncProperty(sample, async (a) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* fixture(a);
              yield* Effect.gen(function* () {
                const d = yield* Door,
                  tracer = yield* Tracer.Tracer,
                  c = capture(tracer);

                for (const founded of [false, true]) {
                  if (founded) {
                    yield* online(d, w, a);
                  }

                  const h = yield* hello(d, w.stranger, a.text);

                  for (const input of [h.input, { ...h.input, nonce: a.id }, { ...h.input, signed: a.text }, {}]) {
                    expect(
                      (yield* d.initialize(h.client, input, h.trusted).pipe(Effect.withTracer(c.tracer)))._tag,
                    ).toBe("refused");
                  }
                }

                expect(c.spans).toEqual([]);
              }).pipe(Effect.provide(w.layer));
            }),
          ),
        ),
      ),
      CHECK,
    );
  });

  it("generated admitted hellos keep one initialize span and its failed storage exit", async () => {
    await fc.assert(
      fc.asyncProperty(sample, fc.boolean(), async (a, fail) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* fixture(a);
              yield* Effect.gen(function* () {
                const d = yield* Door,
                  tracer = yield* Tracer.Tracer,
                  c = capture(tracer);
                const h = yield* hello(d, w.window, a.text);
                w.controls.fail = fail ? "door/hellos" : "";
                const result = yield* Effect.exit(
                  d
                    .initialize(h.client, h.input, h.trusted)
                    .pipe(Effect.withParentSpan(parent(a)), Effect.withTracer(c.tracer)),
                );
                expect(
                  Exit.isSuccess(result),
                  Exit.isFailure(result) ? String(Cause.squash(result.cause)) : "success",
                ).toBe(!fail);
                const spans = c.spans.filter((s) => s.name.startsWith("door."));
                expect(spans.map((s) => s.name)).toEqual(["door.initialize"]);
                checkSpan(spans[0]!, a, !fail);
                const appends = c.spans.filter((s) => s.name === "authorization.appendAdmitted");
                const transactions = c.spans.filter((s) => s.name === "ledger.transaction");
                expect(appends).toHaveLength(1);
                expect(transactions).toHaveLength(1);

                for (const [span, parent] of [
                  [appends[0]!, spans[0]!],
                  [transactions[0]!, appends[0]!],
                ] as const) {
                  expect(span.traceId).toBe(a.traceId);
                  expect(Option.getOrThrow(span.parent).spanId).toBe(parent.spanId);
                  expect(span.status._tag).toBe("Ended");

                  if (span.status._tag === "Ended") {
                    expect(Exit.isSuccess(span.status.exit)).toBe(!fail);
                  }
                }

                if (!fail) {
                  const rows = yield* Stream.runCollect((yield* Ledger).read("door/hellos", 0));
                  expect(rows).toHaveLength(1);
                  expect(rows[0]!.traceId).toBe(a.traceId);
                }
              }).pipe(Effect.provide(w.layer));
            }),
          ),
        ),
      ),
      CHECK,
    );
  });

  it("generated signed grants keep the grant span, children and failed write exit", async () => {
    await fc.assert(
      fc.asyncProperty(sample, fc.boolean(), async (a, fail) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* fixture(a);
              yield* Effect.gen(function* () {
                const d = yield* Door;
                yield* online(d, w, a);
                const tracer = yield* Tracer.Tracer,
                  c = capture(tracer);
                const text = grantText({
                  id: a.id,
                  key: w.stranger.raw,
                  for: PERSON,
                  to: "project",
                  as: "window",
                  saw: saw(a),
                  sentAt: SENT,
                });
                expect((yield* d.grant({ text, armored: a.text }).pipe(Effect.withTracer(c.tracer)))._tag).toBe(
                  "refused",
                );
                expect(c.spans).toEqual([]);
                w.controls.fail = fail ? "door/members" : "";
                const result = yield* Effect.exit(
                  d
                    .grant({ text, armored: w.root.sign(text) })
                    .pipe(Effect.withParentSpan(parent(a)), Effect.withTracer(c.tracer)),
                );
                expect(Exit.isSuccess(result)).toBe(!fail);
                const spans = c.spans.filter((s) => s.name.startsWith("door."));
                expect(spans.map((s) => s.name)).toEqual(["door.grant"]);
                checkSpan(spans[0]!, a, !fail);
                const write = c.spans.find((s) => s.name === "members.write")!;
                expect(Option.getOrThrow(write.parent).spanId).toBe(spans[0]!.spanId);
              }).pipe(Effect.provide(w.layer));
            }),
          ),
        ),
      ),
      CHECK,
    );
  });

  it("generated denials trace only context capture, leaving the membership write outside", async () => {
    await fc.assert(
      fc.asyncProperty(sample, fc.boolean(), async (a, fail) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* fixture(a);
              yield* Effect.gen(function* () {
                const d = yield* Door,
                  client = yield* online(d, w, a),
                  tracer = yield* Tracer.Tracer,
                  c = capture(tracer);
                w.controls.fail = fail ? "door/members" : "";
                const result = yield* Effect.exit(
                  d
                    .deny(client, { key: w.stranger.raw, saw: saw(a) })
                    .pipe(Effect.withParentSpan(parent(a)), Effect.withTracer(c.tracer)),
                );
                expect(Exit.isSuccess(result)).toBe(!fail);
                const spans = c.spans.filter((s) => s.name.startsWith("door."));
                expect(spans.map((s) => s.name)).toEqual(["door.deny"]);
                checkSpan(spans[0]!, a, true);
                const write = c.spans.find((s) => s.name === "members.write")!;
                expect(write.traceId).toBe(a.traceId);
                expect(Option.getOrThrow(write.parent).spanId).toBe(a.spanId);
                expect(write.status._tag).toBe("Ended");

                if (write.status._tag === "Ended") {
                  expect(Exit.isSuccess(write.status.exit)).toBe(!fail);
                }
              }).pipe(Effect.provide(w.layer));
            }),
          ),
        ),
      ),
      CHECK,
    );
  });

  it("generated routes keep input and route parents, outcome tags, links and failed delivery exits", async () => {
    await fc.assert(
      fc.asyncProperty(
        sample,
        fc.array(fc.constantFrom("send", "refused", "input_failed", "delivery_failed"), {
          minLength: 1,
          maxLength: 5,
        }),
        async (a, calls) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const w = yield* fixture(a);
                yield* Effect.gen(function* () {
                  const d = yield* Door,
                    client = yield* online(d, w, a),
                    tracer = yield* Tracer.Tracer;

                  for (const [index, call] of calls.entries()) {
                    const c = capture(tracer);
                    w.controls.fail = call === "input_failed" ? "door/inputs" : "";
                    w.controls.deliveryFails = call === "delivery_failed";
                    const input = {
                      pid: PROCESS,
                      letter: `${a.id}-${index}`,
                      m: Input.cases.comment.make({ text: a.text }),
                      sentAt: SENT,
                      seen: 0,
                    };
                    const result = yield* Effect.exit(
                      d
                        .route(client, call === "refused" ? a.id : "process.send", input)
                        .pipe(Effect.withParentSpan(parent(a)), Effect.withTracer(c.tracer)),
                    );
                    const ok = call === "send" || call === "refused";
                    expect(Exit.isSuccess(result)).toBe(ok);

                    if (Exit.isFailure(result)) {
                      expect(Cause.squash(result.cause)).toBeInstanceOf(LedgerError);
                    }

                    const spans = c.spans.filter((s) => s.name.startsWith("door."));
                    expect(spans.map((s) => s.name)).toEqual(
                      call === "input_failed" ? ["door.input"] : ["door.input", "door.route"],
                    );
                    checkSpan(spans[0]!, a, call !== "input_failed");

                    if (call === "input_failed") {
                      continue;
                    }

                    checkSpan(
                      spans[1]!,
                      a,
                      ok,
                      ok ? { "fab.door.outcome": call === "refused" ? "refused" : "ok" } : {},
                    );
                    expect(
                      spans[1]!.links.map((l) => ({
                        traceId: l.span.traceId,
                        spanId: l.span.spanId,
                        attributes: l.attributes,
                      })),
                    ).toEqual([{ traceId: a.traceId, spanId: spans[0]!.spanId, attributes: {} }]);
                    const recorded = yield* Stream.runCollect((yield* RecordManager).read(Chain.cases.spans.make({})));

                    for (const span of spans) {
                      expect(recorded.find((r) => r.spanId === span.spanId)).toMatchObject({
                        name: span.name,
                        ok: span === spans[0] || ok,
                        traceId: a.traceId,
                      });
                    }
                  }
                }).pipe(Effect.provide(w.layer));
              }),
            ),
          ),
      ),
      CHECK,
    );
  });
});

// P14 (ticket 286), the door's half of the plan's law "Browser records survive failed delivery until
// durable acknowledgement, retain safe measurements and are idempotent" ("What P14 records"). Written
// before the door's `client.record` route. The shape these laws hold it to:
// - `route(client, "client.record", {rows})`, `rows` an array of `ClientRow` (app/client.ts), answers
//   `ok {acknowledged}`: the ids of the rows that are durably in the span sink when it returns, each
//   valid id once, in any order. A row that does not decode as a `ClientRow` is neither acknowledged
//   nor kept. A sink write that fails acknowledges nothing; the same rows sent again land once.
// - The writer and person kept with each sample come from the connection's admission. A writer,
//   person or chain the caller names, on the call or on a row, is never kept.
// - A connection that is not admitted is refused and nothing is kept. One with no hello never
//   reaches the door: the transport answers `no_hello` (transport/answer.test.ts, d2).
// Nothing here is a state machine (0037's T2): the rows and acknowledged ids are plain data, and
// admission is the door's existing state.
const LIAR = "person_01m6v5270hf3c8x2q7w9z4k5mp";
const RECORDS = { seed: 119120, numRuns: 25, endOnFailure: true };
/** Sink statements that read or write the client samples' table, which a failed write refuses. */
const SAMPLES = /^\s*(?:INSERT|SELECT|UPDATE|DELETE|REPLACE)\b[^;]*\bsamples\b/i;

/** The sink's Sql with its sample writes refused while `on`, as a full disk would refuse them. */
const refusing = () => {
  let on = false;
  const wrap = (inner: Sql): Sql => ({
    transaction: (work) => inner.transaction(work),
    size: () => inner.size(),
    exec: (query, ...params) => {
      if (on && SAMPLES.test(query)) {
        throw Object.assign(new Error("database or disk is full"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 13,
        });
      }

      return inner.exec(query, ...params);
    },
  });
  return { wrap, set: (value: boolean) => (on = value) };
};

const recordCase = fc.record({
  a: sample,
  ids: fc
    .uniqueArray(fc.stringMatching(/^[0-9a-f]{8}$/), { minLength: 1, maxLength: 8 })
    .map((xs) => xs.map((x) => `row_${x}`)),
  repeats: fc.array(fc.nat(), { maxLength: 4 }),
  junk: fc.uniqueArray(
    fc.constantFrom<unknown>(
      null,
      "text",
      7,
      { id: "junk_0001" },
      {
        id: "junk_0002",
        tab: "tab_p14",
        build: "test-build",
        sentAt: SENT,
        record: { _tag: "no_such_op" },
      },
    ),
    { maxLength: 3 },
  ),
  fail: fc.boolean(),
  lie: fc.boolean(),
  bodies: fc.integer(),
});

type Answer = { readonly _tag: string; readonly result?: unknown };

type Seen = {
  readonly first: Answer;
  readonly second: Answer;
  /** For each id, how many kept span records hold it after the first call and after the retry. */
  readonly afterFirst: Readonly<Record<string, number>>;
  readonly afterSecond: Readonly<Record<string, number>>;
  /** Every kept span record that holds one of the ids, as JSON. */
  readonly kept: ReadonlyArray<string>;
};

const acknowledged = (answer: Answer): ReadonlyArray<string> => {
  const result = answer.result as { acknowledged?: unknown } | null | undefined;
  return answer._tag === "ok" && Array.isArray(result?.acknowledged) ? result.acknowledged.map(String) : [];
};

const sameSet = (x: ReadonlyArray<string>, y: ReadonlyArray<string>) =>
  JSON.stringify([...new Set(x)].sort()) === JSON.stringify([...new Set(y)].sort()) && x.length === new Set(x).size;

/** The law over one call and its retry, as a check a plant can run on made-up observations. */
const judge = (
  seen: Seen,
  c: {
    readonly ids: ReadonlyArray<string>;
    readonly junk: ReadonlyArray<string>;
    readonly fail: boolean;
    readonly lie: boolean;
    readonly writer: ReadonlyArray<string>;
    readonly person: string;
    readonly liar: ReadonlyArray<string>;
  },
): string | null => {
  const first = acknowledged(seen.first),
    second = acknowledged(seen.second);

  if (c.fail) {
    if (first.length > 0) {
      return `a failed write acknowledged ${JSON.stringify(first)}`;
    }
  } else if (!c.lie && !sameSet(first, c.ids)) {
    return `acknowledged ${JSON.stringify(first)}, the valid rows were ${JSON.stringify(c.ids)}`;
  }

  for (const id of first) {
    if ((seen.afterFirst[id] ?? 0) !== 1) {
      return `${id} was acknowledged with ${seen.afterFirst[id] ?? 0} kept samples`;
    }
  }

  if (!c.lie && !sameSet(second, c.ids)) {
    return `the retry acknowledged ${JSON.stringify(second)}, the valid rows were ${JSON.stringify(c.ids)}`;
  }

  for (const id of second) {
    if ((seen.afterSecond[id] ?? 0) !== 1) {
      return `${id} after the retry has ${seen.afterSecond[id] ?? 0} kept samples`;
    }
  }

  for (const id of c.junk) {
    if ([...first, ...second].includes(id) || (seen.afterSecond[id] ?? 0) > 0) {
      return `the bad row ${id} was acknowledged or kept`;
    }
  }

  for (const text of seen.kept) {
    if (c.liar.some((l) => text.includes(l))) {
      return "a kept sample names the writer the caller gave";
    }

    if (!c.lie && !(text.includes(c.person) && c.writer.some((w) => text.includes(w)))) {
      return "a kept sample does not name the admitted writer and person";
    }
  }

  return null;
};

const keptFor = Effect.fnUntraced(function* (ids: ReadonlyArray<string>) {
  yield* (yield* SpanSink).flush;
  const rows = yield* Stream.runCollect((yield* RecordManager).read(Chain.cases.spans.make({})));
  const texts = [...rows].map((r) => JSON.stringify(r));
  return {
    counts: Object.fromEntries(ids.map((id) => [id, texts.filter((t) => t.includes(id)).length])),
    kept: texts.filter((t) => ids.some((id) => t.includes(id))),
  };
});

describe("P14: client.record keeps a window's rows durably, once, under its admitted writer", () => {
  it("acknowledged only once durable, never on a failed write, once however often retried, and the writer is the admission's", async () => {
    await fc.assert(
      fc.asyncProperty(recordCase, async ({ a, ids, repeats, junk, fail, lie, bodies }) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const sink = refusing();
              const w = yield* fixture(a, sink.wrap);
              yield* Effect.gen(function* () {
                const d = yield* Door;
                const client = yield* online(d, w, a);
                // Schema-generated record bodies (Effect's Arbitrary over the real ClientRecord).
                const records = yield* Arbitrary.sampleEffect(Arbitrary.schema(ClientRecord), {
                  count: ids.length,
                  seed: bodies,
                });
                const rows = ids.map((id, i) => ({
                  id,
                  tab: "tab_p14",
                  build: "test-build",
                  sentAt: SENT,
                  record: records[i],
                }));
                const said = {
                  by: { key: w.stranger.fingerprint, for: LIAR },
                  person: LIAR,
                  writer: w.stranger.raw,
                };
                const batch = [...rows, ...repeats.map((n) => rows[n % rows.length]!), ...junk].map((r) =>
                  lie && typeof r === "object" && r !== null ? { ...r, ...said } : r,
                );
                const params = lie
                  ? { rows: batch, ...said, chain: { _tag: "job", process: PROCESS } }
                  : { rows: batch };
                const junkIds = ["junk_0001", "junk_0002"];
                const all = [...ids, ...junkIds];
                sink.set(fail);
                const first = yield* d.route(client, "client.record", params);
                sink.set(false);
                const one = yield* keptFor(all);
                const second = yield* d.route(client, "client.record", params);
                const two = yield* keptFor(all);
                const verdict = judge(
                  { first, second, afterFirst: one.counts, afterSecond: two.counts, kept: two.kept },
                  {
                    ids,
                    junk: junkIds,
                    fail,
                    lie,
                    writer: [w.window.fingerprint, w.window.raw],
                    person: PERSON,
                    liar: [LIAR, w.stranger.fingerprint, w.stranger.raw],
                  },
                );
                expect(verdict).toBeNull();
              }).pipe(Effect.provide(w.layer));
            }),
          ),
        ),
      ),
      RECORDS,
    );
  });

  it("a connection that is not admitted is refused and keeps nothing", async () => {
    await fc.assert(
      fc.asyncProperty(recordCase, async ({ a, ids }) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* fixture(a);
              yield* Effect.gen(function* () {
                const d = yield* Door;
                const bare = yield* d.connect();
                const stranger = yield* hello(d, w.stranger, a.text);
                yield* d.initialize(stranger.client, stranger.input, stranger.trusted);
                const rows = ids.map((id) => ({
                  id,
                  tab: "tab_p14",
                  build: "test-build",
                  sentAt: SENT,
                  record: { _tag: "persist", result: "granted" },
                }));

                for (const client of [bare, stranger.client]) {
                  const answer = yield* d.route(client, "client.record", { rows });
                  expect(answer._tag, "an unadmitted client.record is refused").toBe("refused");
                }

                expect((yield* keptFor(ids)).kept).toEqual([]);
              }).pipe(Effect.provide(w.layer));
            }),
          ),
        ),
      ),
      RECORDS,
    );
  });

  // Plants: acknowledge before storage, trust the caller's writer, lose a retry. Each is a made-up
  // observation of a door that does it; the same check must name it. A door that does it right passes.
  it("plants: acknowledging before storage, keeping the caller's writer and losing a retry are each caught", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^row_[0-9a-f]{8}$/), { minLength: 1, maxLength: 6 }), (ids) => {
        const c = {
          ids,
          junk: ["junk_0001"],
          fail: false,
          lie: false,
          writer: ["SHA256:window"],
          person: PERSON,
          liar: [LIAR],
        };
        const ok = { _tag: "ok", result: { acknowledged: ids } };
        const once = Object.fromEntries(ids.map((id) => [id, 1]));
        const none = Object.fromEntries(ids.map((id) => [id, 0]));
        const kept = ids.map((id) => JSON.stringify({ id, by: "SHA256:window", for: PERSON }));
        const right = { first: ok, second: ok, afterFirst: once, afterSecond: once, kept };
        expect(judge(right, c), "a door that does it right").toBeNull();
        expect(
          judge(
            { ...right, first: { _tag: "ok", result: { acknowledged: [] } }, afterFirst: none },
            { ...c, fail: true },
          ),
          "a failed write that acknowledges nothing, then a retry that lands",
        ).toBeNull();
        expect(judge({ ...right, afterFirst: none }, c), "acknowledged before storage").not.toBeNull();
        expect(
          judge(
            {
              ...right,
              kept: ids.map((id) => JSON.stringify({ id, by: "SHA256:window", for: LIAR })),
            },
            c,
          ),
          "the caller's writer kept",
        ).not.toBeNull();
        expect(
          judge(
            {
              ...right,
              first: { _tag: "ok", result: { acknowledged: [] } },
              afterFirst: none,
              afterSecond: none,
            },
            { ...c, fail: true },
          ),
          "a retry after a failed write that keeps nothing",
        ).not.toBeNull();
        expect(
          judge({ ...right, afterSecond: Object.fromEntries(ids.map((id) => [id, 2])) }, c),
          "a retry kept twice",
        ).not.toBeNull();
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
});

// P14 (ticket 286), review 1, C, [secrets]: what a window hands `client.record` beyond the checked
// row fields never reaches an output. Generated made-up secrets (a control bearer, a private key
// body, a pass) are planted where the door's allowlist does not look: extra fields on a row, on its
// record and on the call, and a row whose case is a secret. After the call
// and its retry (a row id is the window's own checked field, so no secret is planted there), no form of any secret (as is, base64, base64url, hex, URI-encoded) is in the
// answer, the ledger, the span and health rows, the client samples or any other table the door's
// stores hold. The plant puts one secret into each output and the same check must name it.
describe("P14 [secrets]: client.record keeps no secret it was handed", () => {
  const bytes = (n: number) => fc.uint8Array({ minLength: n, maxLength: n });
  const secrets = fc.record({
    bearer: bytes(32).map((b) => Buffer.from(b).toString("base64url")),
    key: bytes(64).map((b) => Buffer.from(b).toString("base64")),
    pass: fc.stringMatching(/^[A-Za-z0-9]{16,24}$/).map((w) => `pass-${w}`),
  });
  const forms = (secret: string): ReadonlyArray<string> => [
    secret,
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("base64url"),
    Buffer.from(secret).toString("hex"),
    encodeURIComponent(secret),
  ];
  /** The outputs that name any form of any secret. */
  const leaks = (said: ReadonlyArray<string>, outputs: Readonly<Record<string, string>>): ReadonlyArray<string> =>
    Object.entries(outputs)
      .filter(([, text]) => said.some((secret) => forms(secret).some((f) => text.includes(f))))
      .map(([name]) => name);

  /** Every row of every table in every store the fixture opened, by store and table. */
  const tables = (databases: ReadonlyArray<DatabaseSync>): Record<string, string> =>
    Object.fromEntries(
      databases.flatMap((db, n) =>
        (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
          ({ name }) => [`store ${n} ${name}`, JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())],
        ),
      ),
    );

  it("no planted secret reaches the answer, the ledger, the span, health or sample rows, or any stored table", async () => {
    await fc.assert(
      fc.asyncProperty(recordCase, secrets, async ({ a, ids, bodies }, said) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* fixture(a);
              yield* Effect.gen(function* () {
                const d = yield* Door;
                const client = yield* online(d, w, a);
                const records = yield* Arbitrary.sampleEffect(Arbitrary.schema(ClientRecord), {
                  count: ids.length,
                  seed: bodies,
                });
                const rows = ids.map((id, i) => ({
                  id,
                  tab: "tab_p14",
                  build: "test-build",
                  sentAt: SENT,
                  record: { ...(records[i] as object), token: said.bearer },
                  secret: said.key,
                }));
                const junk = [
                  { id: "junk_0003", tab: "tab_p14", build: "test-build", sentAt: SENT, record: { _tag: said.pass } },
                ];
                const params = { rows: [...rows, ...junk], authorization: `Bearer ${said.bearer}`, key: said.key };
                const first = yield* d.route(client, "client.record", params);
                const second = yield* d.route(client, "client.record", params);
                yield* (yield* SpanSink).flush;
                const spans = yield* Stream.runCollect((yield* RecordManager).read(Chain.cases.spans.make({})));
                const outputs = {
                  answers: JSON.stringify([first, second]),
                  spans: JSON.stringify([...spans]),
                  ...tables(w.databases),
                };
                // Good thing: the rows themselves were kept, so the outputs are not empty.
                expect(acknowledged(first).length, "the valid rows were acknowledged").toBe(ids.length);
                expect(leaks([said.bearer, said.key, said.pass], outputs)).toEqual([]);

                // The plant: one secret put into each output is named by the same check.
                for (const name of Object.keys(outputs)) {
                  const planted = { ...outputs, [name]: `${outputs[name as keyof typeof outputs]}${said.key}` };
                  expect(leaks([said.key], planted), `a leak planted in ${name}`).toEqual([name]);
                }
              }).pipe(Effect.provide(w.layer));
            }),
          ),
        ),
      ),
      RECORDS,
    );
  });
});
