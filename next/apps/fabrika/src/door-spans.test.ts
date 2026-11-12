// T285, PR 1, next/. These laws keep the five partial door spans at their current scope.
// Plants: widen initialize, rename a span, lose its parent/link/tags, or recover inside it.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Id } from "@kampus/libfabrika";
import { Saw } from "@kampus/libfabrika/access/Access";
import * as ClientManagerLedger from "@kampus/libfabrika/access/ClientManagerLedger";
import { grantText } from "@kampus/libfabrika/access/Text";
import * as RateLimiterSql from "@kampus/libfabrika/gateway/RateLimiterSql";
import { Doorbell, Ledger, LedgerError } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import { LedgerTransaction, type LedgerTurn } from "@kampus/libfabrika/ledger/LedgerTransaction";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Archive } from "@kampus/libfabrika/telemetry/Archive";
import { RecordManager } from "@kampus/libfabrika/telemetry/Records";
import { SpanSink } from "@kampus/libfabrika/telemetry/Sink";
import { Chain } from "@kampus/libfabrika/telemetry/Trace";
import { Cause, Effect, Exit, Layer, Option, Schema, Stream, Tracer } from "effect";
import * as RateLimiter from "effect/persistence/RateLimiter";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Gateway } from "./door.ts";

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

const fixture = Effect.fnUntraced(function* (a: Sample) {
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
      LedgerSql.layer(sql, { reader: "project" }).pipe(
        Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
      ),
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
    Layer.provide(LedgerTransactionSql.layer(sql)),
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
  const clients = ClientManagerLedger.layer(founder).pipe(Layer.provideMerge(ledger));
  const parts = new Map<string, ReturnType<typeof nodeSql>>();
  const records = RecordManager.sql((name) => {
    let part = parts.get(name);

    if (part === undefined) {
      part = open();
      parts.set(name, part);
    }

    return part;
  }, 64 * 1024);
  const layer = Gateway.layer({
    sql,
    founder,
    name: "project",
    url: URL,
    origins: ["https://fabrika.test"],
    versions: [1, 2],
    location: "test",
    build: "test-build",
    waiting: { most: 3, ttl: 600_000 },
    rateLimit: { limit: 100_000, window: 60_000 },
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
        SpanSink.layer(sql, { object: PROCESS }),
        RateLimiter.layer.pipe(
          Layer.provide(RateLimiterSql.layer(sql, { build: "test-build", policy: { limit: 100_000, window: 60_000 } })),
        ),
      ),
    ),
  );
  return { layer, window, stranger, root, controls };
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

const hello = Effect.fnUntraced(function* (d: typeof Gateway.Service, k: ReturnType<typeof key>, tab: string) {
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
  d: typeof Gateway.Service,
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
    location: "test",
    method: "compare",
    check: "touch",
    has: ["verify"],
  });

describe("door partial spans, next/ tracing keep-laws", () => {
  it("generated unknown and invalid hellos never open gateway.initialize, before or after founding", async () => {
    await fc.assert(
      fc.asyncProperty(sample, async (a) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* fixture(a);
              yield* Effect.gen(function* () {
                const d = yield* Gateway,
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
                const d = yield* Gateway,
                  tracer = yield* Tracer.Tracer,
                  c = capture(tracer);
                const h = yield* hello(d, w.window, a.text);
                w.controls.fail = fail ? "gateway/hellos" : "";
                const result = yield* Effect.exit(
                  d
                    .initialize(h.client, h.input, h.trusted)
                    .pipe(Effect.withParentSpan(parent(a)), Effect.withTracer(c.tracer)),
                );
                expect(
                  Exit.isSuccess(result),
                  Exit.isFailure(result) ? String(Cause.squash(result.cause)) : "success",
                ).toBe(!fail);
                const spans = c.spans.filter((s) => s.name.startsWith("gateway."));
                expect(spans.map((s) => s.name)).toEqual(["gateway.initialize"]);
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
                  const rows = yield* Stream.runCollect((yield* Ledger).read("gateway/hellos", 0));
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
                const d = yield* Gateway;
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
                w.controls.fail = fail ? "gateway/access" : "";
                const result = yield* Effect.exit(
                  d
                    .grant({ text, armored: w.root.sign(text) })
                    .pipe(Effect.withParentSpan(parent(a)), Effect.withTracer(c.tracer)),
                );
                expect(Exit.isSuccess(result)).toBe(!fail);
                const spans = c.spans.filter((s) => s.name.startsWith("gateway."));
                expect(spans.map((s) => s.name)).toEqual(["gateway.grant"]);
                checkSpan(spans[0]!, a, !fail);
                const write = c.spans.find((s) => s.name === "access.write")!;
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
                const d = yield* Gateway,
                  client = yield* online(d, w, a),
                  tracer = yield* Tracer.Tracer,
                  c = capture(tracer);
                w.controls.fail = fail ? "gateway/access" : "";
                const result = yield* Effect.exit(
                  d
                    .deny(client, { key: w.stranger.raw, saw: saw(a) })
                    .pipe(Effect.withParentSpan(parent(a)), Effect.withTracer(c.tracer)),
                );
                expect(Exit.isSuccess(result)).toBe(!fail);
                const spans = c.spans.filter((s) => s.name.startsWith("gateway."));
                expect(spans.map((s) => s.name)).toEqual(["gateway.deny"]);
                checkSpan(spans[0]!, a, true);
                const write = c.spans.find((s) => s.name === "access.write")!;
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
                  const d = yield* Gateway,
                    client = yield* online(d, w, a),
                    tracer = yield* Tracer.Tracer;

                  for (const [index, call] of calls.entries()) {
                    const c = capture(tracer);
                    w.controls.fail = call === "input_failed" ? "gateway/inputs" : "";
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

                    const spans = c.spans.filter((s) => s.name.startsWith("gateway."));
                    expect(spans.map((s) => s.name)).toEqual(
                      call === "input_failed" ? ["gateway.input"] : ["gateway.input", "gateway.route"],
                    );
                    checkSpan(spans[0]!, a, call !== "input_failed");

                    if (call === "input_failed") {
                      continue;
                    }

                    checkSpan(
                      spans[1]!,
                      a,
                      ok,
                      ok ? { "fab.gateway.outcome": call === "refused" ? "refused" : "ok" } : {},
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
