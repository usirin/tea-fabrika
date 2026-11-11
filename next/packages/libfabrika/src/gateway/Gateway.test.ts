// T749 slice 1, next/. The gateway owns its errors: laws G1 to G6, G9, G10 and the type law G11.
// G1: a lower service's failure reaches the caller as one GatewayError whose cause is that exact failure.
// G2: a corrupted saved row fails as the gateway's own error, keeps its classification and a cause.
// G3: deliberate refusals keep their class, tag, reason and effect. G4: a failed delivery stays
// retryable and its retry keeps the input's identity. G5: a failed notification is still ignored.
// G6 [secrets]: nested failure text enters no stored, printed, RPC or logged output.
// G9: the object guard still rejects arrays and null and accepts other objects. G10: both timestamp
// sites format the captured clock as ISO text. G11: no declared member's error channel holds a lower
// service's error.
// Plants, each run once and undone, are listed in the step report, not kept here.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Cause, DateTime, Effect, Exit, Layer, Logger, Schema, type Scope, Stream, Tracer } from "effect";
import { SecureRandom } from "effect/crypto";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { ClientManager } from "../access/ClientManager.ts";
import { NotGranted, SigningRefused, SignRequest } from "../access/SessionManager.ts";
import { grantText, revokeText } from "../access/Text.ts";
import * as Id from "../Id.ts";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { ProcessError } from "../processes/Process.ts";
import type { Incoming } from "../runtime/Entry.ts";
import { ProgramDown } from "../runtime/Program.ts";
import { RunnerError } from "../runtime/Runner.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { type SinkError, SpanSink } from "../telemetry/Sink.ts";
import { Gateway, type GatewayError } from "./Gateway.ts";

const checks = { seed: 119120, numRuns: 20, endOnFailure: true };
const URL = "https://fabrika.test/entry/t749";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjs";
const OTHER = "process_01m6v5270hetdrt4r8h9vvjwjt";
const SENT = "2026-11-11T04:00:00.000Z";
const Input = Schema.TaggedUnion({ comment: { text: Schema.String } });

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

type Key = ReturnType<typeof key>;
type Lower = LedgerError | ProgramDown | ProcessError | RunnerError;

// Every database of a run is opened in the run's scope and closed by it.
const database = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

const world = Effect.fnUntraced(function* (seed: Uint8Array) {
  const db = yield* database;
  const sql = nodeSql(db);
  const parts = new Map<string, ReturnType<typeof nodeSql>>();
  const partDbs: Array<DatabaseSync> = [];
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const part of partDbs) {
        part.close();
      }
    }),
  );
  const root = key(seed, 0),
    window = key(seed, 1);
  const controls: {
    deliver: Lower | null;
    policy: LedgerError | null;
    open: LedgerError | null;
    wait: LedgerError | null;
    isLive: LedgerError | null;
    live: boolean;
    notify: LedgerError | null;
    read: LedgerError | null;
    record: LedgerError | null;
  } = {
    deliver: null,
    policy: null,
    open: null,
    wait: null,
    isLive: null,
    live: true,
    notify: null,
    read: null,
    record: null,
  };
  const deliveries: Array<Omit<Incoming, "id" | "sentAt" | "seen"> & { readonly process: string }> = [];
  const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
  const actual = yield* Effect.service(Ledger).pipe(
    Effect.provide(LedgerSql.layer(sql, { reader: "t749" }).pipe(Layer.provide(quiet))),
  );
  const ledger = Layer.succeed(Ledger, {
    ...actual,
    read: (stream, after) =>
      controls.read !== null && stream === "notes" ? Stream.fail(controls.read) : actual.read(stream, after),
  });
  const transaction = Layer.effect(
    LedgerTransaction,
    LedgerTransaction.pipe(
      Effect.map((real) => ({
        transact: <A>(step: (turn: LedgerTurn) => A) =>
          real.transact((turn) =>
            step({
              ...turn,
              append: (stream, id, line) => {
                const failure = controls.record;

                if (failure !== null && stream === "gateway/inputs") {
                  throw failure;
                }

                return turn.append(stream, id, line);
              },
            }),
          ),
      })),
    ),
  ).pipe(Layer.provide(LedgerTransaction.layer(sql)), Layer.provide(quiet));
  const founder = {
    name: "t749",
    person: PERSON,
    keys: [root.line],
    window: window.raw,
    by: root.sshFingerprint,
    build: "test-build",
  };
  const records = RecordManager.sql((name) => {
    let part = parts.get(name);

    if (part === undefined) {
      const opened = new DatabaseSync(":memory:");
      partDbs.push(opened);
      part = nodeSql(opened);
      parts.set(name, part);
    }

    return part;
  }, 64 * 1024);
  const random = Layer.succeed(
    SecureRandom.SecureRandom,
    SecureRandom.make((size) => crypto.getRandomValues(new Uint8Array(size))),
  );
  const env = Layer.mergeAll(
    ClientManager.layer(founder).pipe(Layer.provideMerge(ledger)),
    transaction,
    Id.Generator.layer,
    records,
    Archive.memory,
    SpanSink.layer(sql, { object: PROCESS }),
    random,
  );
  const layer = Gateway.layer({
    sql,
    founder,
    name: "t749",
    url: URL,
    origins: ["https://fabrika.test"],
    versions: [1],
    location: "test",
    build: "test-build",
    waiting: { most: 20, ttl: 600_000 },
    ping: { min: 10_000, max: 60_000 },
    inputCap: 100,
    spentCap: 100,
    nextProcess: () => Effect.succeed(PROCESS),
    policy: () =>
      controls.policy === null ? Effect.succeed({ inputs: [], events: [] }) : Effect.fail(controls.policy),
    isLive: () => (controls.isLive === null ? Effect.succeed(controls.live) : Effect.fail(controls.isLive)),
    open: () => (controls.open === null ? Effect.succeed(null) : Effect.fail(controls.open)),
    wait: () => (controls.wait === null ? Effect.succeed({ _tag: "ready", rev: 0 }) : Effect.fail(controls.wait)),
    deliver: (process, envelope, span) => {
      deliveries.push({ process, envelope, span });
      return controls.deliver === null ? Effect.void : Effect.fail(controls.deliver);
    },
    notify: () => (controls.notify === null ? Effect.void : Effect.fail(controls.notify)),
    inputs: { schema: Input, personOnly: [], raw: [], log: Schema.toCodecJson(Input) },
    events: { personOnly: [] },
  }).pipe(Layer.provideMerge(env));
  // Every cell of every table this run stored, as the text it holds: ledger, gateway state, spans.
  const stored = () => {
    const dump = (s: ReturnType<typeof nodeSql>) =>
      s.exec("SELECT name FROM sqlite_master WHERE type='table'").map((t) => ({
        table: String(t.name),
        text: s
          .exec(`SELECT * FROM "${String(t.name)}"`)
          .flatMap((row) => Object.values(row).map(String))
          .join("\n"),
      }));
    return { main: dump(sql), spans: [...parts.values()].flatMap(dump) };
  };
  return { sql, layer, root, window, controls, deliveries, stored, seed };
});

type World = Effect.Success<ReturnType<typeof world>>;
type Door = typeof Gateway.Service;
type Client = Parameters<Door["route"]>[0];

const hello = Effect.fnUntraced(function* (d: Door, k: Key, tab: string) {
  const client = yield* d.connect(),
    nonce = yield* d.challenge(client);
  const input = {
    versions: [1],
    has: [],
    ping: "30s",
    key: k.raw,
    tab,
    nonce,
    platform: "browser",
    os: "unknown",
    sentAt: SENT,
    signed: k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
  };
  return { client, result: yield* d.initialize(client, input, { url: URL, tab, name: k.fingerprint }) };
});

const online = Effect.fnUntraced(function* (d: Door, k: Key, tab = "tab") {
  const h = yield* hello(d, k, tab);
  expect(h.result).toMatchObject({ _tag: "online" });
  return h.client;
});

const request = (letter: string, text: string) => ({
  pid: PROCESS,
  letter,
  m: Input.cases.comment.make({ text }),
  sentAt: SENT,
  seen: 0,
});

const incoming = (w: World, letter: string): Incoming => {
  const last = w.deliveries.at(-1);
  expect(last).toBeDefined();
  return { id: letter, envelope: last!.envelope, span: last!.span, sentAt: SENT, seen: 0 };
};

/** The single typed failure of an exit: no defect, no second failure. */
const failure = (exit: Exit.Exit<unknown, unknown>) => {
  expect(exit._tag).toBe("Failure");
  const reasons = Exit.isFailure(exit) ? exit.cause.reasons : [];
  expect(reasons.filter(Cause.isDieReason)).toEqual([]);
  const errors = reasons.filter(Cause.isFailReason).map((r) => r.error);
  expect(errors).toHaveLength(1);
  return errors[0] as { readonly _tag?: unknown; readonly reason?: unknown; readonly cause?: unknown };
};

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(TestClock.layer())));

// fast-check picks each command from the state it is folding. A command's run leaves the Effect
// that performs it in the walk's holder, and the walk runs it, then the walk's own check.
type Holder<R> = { readonly real: R; next: Effect.Effect<void, unknown> };

const walkable = <M extends object, R>(
  name: string,
  check: (m: M) => boolean,
  apply: (m: M, r: R) => Effect.Effect<void, unknown>,
): fc.Command<M, Holder<R>> => ({
  check,
  run: (m, h) => {
    h.next = apply(m, h.real);
  },
  toString: () => name,
});

const walk = Effect.fnUntraced(function* <M extends object, R>(
  moves: Iterable<fc.Command<M, Holder<R>>>,
  m: M,
  real: R,
  after: (m: M, r: R) => Effect.Effect<void, unknown> = () => Effect.void,
) {
  const holder: Holder<R> = { real, next: Effect.void };

  for (const step of moves) {
    if (step.check(m)) {
      step.run(m, holder);
      yield* holder.next;
      yield* after(m, real);
    }
  }
});

const seed = fc.uint8Array({ minLength: 32, maxLength: 32 });
const word = fc.stringMatching(/^[a-z0-9]{1,12}$/);

// Typed lower failures, nested causes included: a primitive, null, or another tagged error.
const ledgerError = fc
  .record({
    reason: fc.constantFrom("unreachable", "bad_row", "storage", "refused", "crypto"),
    message: fc.option(word, { nil: undefined }),
  })
  .map((a) => new LedgerError(a));

const nested = fc.oneof(fc.constant(null), fc.integer(), word, ledgerError);

const lower: fc.Arbitrary<Lower> = fc.oneof(
  ledgerError,
  fc
    .record({ reason: fc.constantFrom("load", "no_program", "step", "saved_state", "saved_letter"), cause: nested })
    .map((a) => new ProgramDown(a)),
  fc
    .constantFrom("not_parent", "name_taken", "alive", "stale", "id_reused")
    .map((reason) => new ProcessError({ reason })),
  fc.constantFrom("bad_input", "bad_client").map((reason) => new RunnerError({ reason })),
);

// Each reachable public operation with the lower service that fails under it.
type Operation = "deliver" | "policy" | "open" | "wait" | "read" | "sign" | "append";
const operations: ReadonlyArray<Operation> = ["deliver", "policy", "open", "wait", "read", "sign", "append"];

const reach = Effect.fnUntraced(function* (w: World, d: Door, client: Client, op: Operation, fail: Lower, tag: string) {
  const ledgerFail = fail instanceof LedgerError ? fail : new LedgerError({ reason: "storage", message: tag });
  let parent = "";

  if (op === "sign" || op === "append") {
    yield* d.route(client, "process.send", request(`before-${tag}`, tag));
    parent = w.deliveries.at(-1)!.envelope.id;
  }

  const thrown = op === "deliver" ? fail : ledgerFail;

  switch (op) {
    case "deliver":
      w.controls.deliver = fail;
      return { thrown, exit: yield* Effect.exit(d.route(client, "process.send", request(`letter-${tag}`, tag))) };
    case "policy":
      w.controls.policy = ledgerFail;
      return { thrown, exit: yield* Effect.exit(d.route(client, "process.send", request(`letter-${tag}`, tag))) };
    case "open":
      w.controls.open = ledgerFail;
      return { thrown, exit: yield* Effect.exit(d.route(client, "view.open", { pid: PROCESS })) };
    case "wait":
      w.controls.wait = ledgerFail;
      return { thrown, exit: yield* Effect.exit(d.route(client, "ledger.wait", { stream: "notes", after: 0 })) };
    case "read":
      w.controls.read = ledgerFail;
      return { thrown, exit: yield* Effect.exit(d.route(client, "ledger.read", { stream: "notes", after: 0 })) };
    case "sign":
      w.controls.isLive = ledgerFail;
      return {
        thrown,
        exit: yield* Effect.exit(d.sign(PROCESS, `sign-${tag}`, parent, "saved")),
      };
    case "append":
      yield* d.signer(parent, PROCESS, "saved").pipe(Effect.provideService(SignRequest, { id: `fact-${tag}` }));
      w.controls.isLive = ledgerFail;
      return {
        thrown,
        exit: yield* Effect.exit(
          d.append({
            id: `fact-${tag}`,
            parent,
            process: PROCESS,
            kind: "saved",
            stream: "notes",
            event: { _tag: "saved", text: tag },
          }),
        ),
      };
  }
});

describe("T749 G1: a lower service's failure reaches the caller as the gateway's own error", () => {
  it("generated lower failures under every reachable operation keep their exact cause", async () => {
    await fc.assert(
      fc.asyncProperty(seed, fc.constantFrom(...operations), lower, word, (s, op, fail, tag) =>
        run(
          Effect.gen(function* () {
            const w = yield* world(s);
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const client = yield* online(d, w.window);
              const { thrown, exit } = yield* reach(w, d, client, op, fail, tag);
              const error = failure(exit);
              expect(error).toMatchObject({ _tag: "GatewayError" });
              // The complete lower failure, by identity: its own nested cause comes along unchanged.
              expect(error.cause).toBe(thrown);
            }).pipe(Effect.provide(w.layer));
          }),
        ),
      ),
      checks,
    );
  });
});

describe("T749 G2: a corrupted saved row fails as the gateway's own error with its cause", () => {
  // Corruptions derived from the saved row's own text: cut it, or give one of its fields a wrong
  // type. A binding row stays JSON: its table's JSON index refuses malformed text at write time.
  const corrupt = fc
    .record({ cut: fc.boolean(), at: fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), pick: fc.nat() })
    .map((c) => (text: string, json: boolean) => {
      if (c.cut && !json) {
        return text.slice(0, Math.max(1, Math.floor(text.length * c.at)));
      }

      const value = JSON.parse(text) as Record<string, unknown>;
      const keys = Object.keys(value);
      return JSON.stringify({ ...value, [keys[c.pick % keys.length]!]: {} });
    });
  type Site = "waiting-target" | "waiting-watch" | "binding-check" | "binding-accept" | "binding-repeat";

  it("generated corruptions of saved waiting and binding rows keep the classification and a cause", async () => {
    await fc.assert(
      fc.asyncProperty(
        seed,
        fc.constantFrom<Site>("waiting-target", "waiting-watch", "binding-check", "binding-accept", "binding-repeat"),
        corrupt,
        word,
        (s, site, change, tag) =>
          run(
            Effect.gen(function* () {
              const w = yield* world(s);
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const client = yield* online(d, w.window);
                let exit: Exit.Exit<unknown, unknown>;

                if (site === "waiting-target" || site === "waiting-watch") {
                  yield* d.watch(client);
                  const [row] = w.sql.exec("SELECT value FROM gateway_state WHERE name='waiting'");
                  w.sql.exec(
                    "UPDATE gateway_state SET value=? WHERE name='waiting'",
                    change(String(row!.value), false),
                  );
                  exit = yield* Effect.exit(site === "waiting-target" ? d.target(tag, "123456") : d.watch(client));
                } else {
                  yield* d.route(client, "process.send", request(tag, tag));
                  const delivered = incoming(w, tag);
                  const [row] = w.sql.exec("SELECT id,value FROM gateway_bindings");
                  w.sql.exec(
                    "UPDATE gateway_bindings SET value=? WHERE id=?",
                    change(String(row!.value), true),
                    row!.id,
                  );
                  exit = yield* Effect.exit(
                    site === "binding-check"
                      ? d.checkDelivery(PROCESS, delivered)
                      : site === "binding-accept"
                        ? d.accept(delivered)
                        : d.route(client, "process.send", request(tag, tag)),
                  );
                }

                const error = failure(exit);
                // The same classification as before: a read inside the store's transaction is a
                // storage fault; a binding decoded outside it is a bad row.
                expect(error).toMatchObject({
                  _tag: "GatewayError",
                  reason: site === "binding-repeat" ? "bad_row" : "storage",
                });
                expect(error.cause).toBeDefined();
                expect(error.cause).not.toMatchObject({ _tag: "GatewayError" });
              }).pipe(Effect.provide(w.layer));
            }),
          ),
      ),
      checks,
    );
  });
});

describe("T749 G3: deliberate refusals keep their class, tag, reason and effect", () => {
  type Sent = { readonly letter: string; readonly text: string; readonly delivered: Incoming };
  type Model = { sent: Array<Sent>; deliveries: number };
  type Real = { readonly w: World; readonly d: Door; readonly client: Client };
  const move = (
    name: string,
    check: (m: Model) => boolean,
    apply: (m: Model, r: Real) => Effect.Effect<void, unknown>,
  ) => walkable<Model, Real>(name, check, apply);
  const pick = <A>(items: ReadonlyArray<A>, n: number) => items[n % items.length]!;
  const refused = (exit: Exit.Exit<unknown, unknown>, as: typeof SigningRefused | typeof NotGranted, tag: object) => {
    const error = failure(exit);
    // The runtime turns refusals into reply data by class, so the class itself must survive.
    expect(error).toBeInstanceOf(as);
    expect(error).toMatchObject(tag);
  };

  const send = (letter: string, text: string) =>
    move(
      `send(${letter})`,
      (m) => !m.sent.some((s) => s.letter === letter),
      Effect.fnUntraced(function* (m, r) {
        expect(yield* r.d.route(r.client, "process.send", request(letter, text))).toMatchObject({ _tag: "ok" });
        m.deliveries++;
        m.sent.push({ letter, text, delivered: incoming(r.w, letter) });
      }),
    );
  const repeat = (n: number) =>
    move(
      `repeat(${n})`,
      (m) => m.sent.length > 0,
      Effect.fnUntraced(function* (m, r) {
        const s = pick(m.sent, n);
        expect(yield* r.d.route(r.client, "process.send", request(s.letter, s.text))).toMatchObject({ _tag: "ok" });
      }),
    );
  const reuse = (n: number, text: string) =>
    move(
      `reuse(${n}, ${text})`,
      (m) => m.sent.some((s) => s.text !== text),
      Effect.fnUntraced(function* (m, r) {
        const s = pick(
          m.sent.filter((x) => x.text !== text),
          n,
        );
        expect(yield* r.d.route(r.client, "process.send", request(s.letter, text))).toMatchObject({
          _tag: "refused",
          reason: "id_reused",
        });
      }),
    );
  const stranger = (letter: string) =>
    move(
      `stranger(${letter})`,
      () => true,
      Effect.fnUntraced(function* (_m, r) {
        const unproved = yield* r.d.connect();
        expect(yield* r.d.route(unproved, "process.send", request(letter, letter))).toMatchObject({
          _tag: "refused",
          reason: "not_granted",
        });
      }),
    );
  const unknown = (method: string) =>
    move(
      `unknown(${method})`,
      () => true,
      Effect.fnUntraced(function* (_m, r) {
        expect(yield* r.d.route(r.client, `t749.${method}`, {})).toMatchObject({
          _tag: "refused",
          reason: "unknown_method",
        });
      }),
    );
  const notLive = (n: number, id: string) =>
    move(
      `notLive(${n}, ${id})`,
      (m) => m.sent.length > 0,
      Effect.fnUntraced(function* (m, r) {
        const s = pick(m.sent, n);
        r.w.controls.live = false;
        const exit = yield* Effect.exit(r.d.sign(PROCESS, id, s.delivered.envelope.id, "saved"));
        r.w.controls.live = true;
        refused(exit, SigningRefused, { _tag: "SigningRefused", reason: "not_delivered" });
      }),
    );
  const forged = (n: number) =>
    move(
      `forged(${n})`,
      (m) => m.sent.length > 0,
      Effect.fnUntraced(function* (m, r) {
        const s = pick(m.sent, n);
        const exit = yield* Effect.exit(r.d.accept({ ...s.delivered, sentAt: "2000-01-01T00:00:00.000Z" }));
        refused(exit, NotGranted, { _tag: "NotGranted" });
      }),
    );
  const elsewhere = (n: number) =>
    move(
      `elsewhere(${n})`,
      (m) => m.sent.length > 0,
      Effect.fnUntraced(function* (m, r) {
        const s = pick(m.sent, n);
        const exit = yield* Effect.exit(r.d.checkDelivery(OTHER, s.delivered));
        refused(exit, SigningRefused, { _tag: "SigningRefused", reason: "not_delivered" });
      }),
    );

  it("generated valid, refused and repeated operations keep every refusal as it was", async () => {
    await fc.assert(
      fc.asyncProperty(
        seed,
        fc.commands(
          [
            fc.tuple(word, word).map(([l, t]) => send(l, t)),
            fc.nat().map(repeat),
            fc.tuple(fc.nat(), word).map(([n, t]) => reuse(n, t)),
            word.map(stranger),
            word.map(unknown),
            fc.tuple(fc.nat(), word).map(([n, id]) => notLive(n, id)),
            fc.nat().map(forged),
            fc.nat().map(elsewhere),
          ],
          { maxCommands: 12 },
        ),
        (s, moves) =>
          run(
            Effect.gen(function* () {
              const w = yield* world(s);
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const client = yield* online(d, w.window);
                const model: Model = { sent: [], deliveries: 0 };
                // A refusal delivers nothing.
                yield* walk(moves, model, { w, d, client }, (m, r) =>
                  Effect.sync(() => expect(r.w.deliveries).toHaveLength(m.deliveries)),
                );
              }).pipe(Effect.provide(w.layer));
            }),
          ),
      ),
      checks,
    );
  });
});

describe("T749 G4: a failed delivery stays retryable and its retry keeps the input's identity", () => {
  type Letter = {
    readonly letter: string;
    readonly text: string;
    state: "retryable" | "settled";
    readonly first: Omit<Incoming, "id" | "sentAt" | "seen"> & { readonly process: string };
  };
  type Model = { letters: Array<Letter>; deliveries: number };
  type Real = { readonly w: World; readonly d: Door; readonly client: Client };
  const move = (
    name: string,
    check: (m: Model) => boolean,
    apply: (m: Model, r: Real) => Effect.Effect<void, unknown>,
  ) => walkable<Model, Real>(name, check, apply);
  const among = (m: Model, state: Letter["state"], n: number) => {
    const found = m.letters.filter((l) => l.state === state);
    return found[n % found.length]!;
  };

  const sendFailing = (letter: string, text: string, fail: Lower) =>
    move(
      `sendFailing(${letter}, ${fail._tag})`,
      (m) => !m.letters.some((l) => l.letter === letter),
      Effect.fnUntraced(function* (m, r) {
        r.w.controls.deliver = fail;
        const exit = yield* Effect.exit(r.d.route(r.client, "process.send", request(letter, text)));
        r.w.controls.deliver = null;
        m.deliveries++;
        expect(r.w.deliveries).toHaveLength(m.deliveries);
        m.letters.push({ letter, text, state: "retryable", first: r.w.deliveries.at(-1)! });
        const error = failure(exit);
        expect(error).toMatchObject({ _tag: "GatewayError" });
        expect(error.cause).toBe(fail);
      }),
    );
  const retry = (n: number, fail: Lower | null) =>
    move(
      `retry(${n}, ${fail?._tag ?? "ok"})`,
      (m) => m.letters.some((l) => l.state === "retryable"),
      Effect.fnUntraced(function* (m, r) {
        const l = among(m, "retryable", n);
        r.w.controls.deliver = fail;
        const exit = yield* Effect.exit(r.d.route(r.client, "process.send", request(l.letter, l.text)));
        r.w.controls.deliver = null;
        // The retry delivers again, as the same input: same id, writer, arrival and span.
        m.deliveries++;
        expect(r.w.deliveries).toHaveLength(m.deliveries);
        expect(r.w.deliveries.at(-1)).toEqual(l.first);

        if (fail === null) {
          expect(exit).toMatchObject({ _tag: "Success", value: { _tag: "ok" } });
          l.state = "settled";
        } else {
          const error = failure(exit);
          expect(error).toMatchObject({ _tag: "GatewayError" });
          expect(error.cause).toBe(fail);
        }
      }),
    );
  const again = (n: number) =>
    move(
      `again(${n})`,
      (m) => m.letters.some((l) => l.state === "settled"),
      Effect.fnUntraced(function* (m, r) {
        const l = among(m, "settled", n);
        // A settled input answers from its record and is not delivered twice.
        expect(yield* r.d.route(r.client, "process.send", request(l.letter, l.text))).toMatchObject({ _tag: "ok" });
        expect(r.w.deliveries).toHaveLength(m.deliveries);
      }),
    );

  it("generated failed deliveries, retries and settled resends follow the binding", async () => {
    await fc.assert(
      fc.asyncProperty(
        seed,
        fc.commands(
          [
            fc.tuple(word, word, lower).map(([l, t, f]) => sendFailing(l, t, f)),
            fc.tuple(fc.nat(), fc.option(lower, { nil: null })).map(([n, f]) => retry(n, f)),
            fc.nat().map(again),
          ],
          { maxCommands: 10 },
        ),
        (s, moves) =>
          run(
            Effect.gen(function* () {
              const w = yield* world(s);
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const client = yield* online(d, w.window);
                yield* walk(moves, { letters: [], deliveries: 0 }, { w, d, client });
              }).pipe(Effect.provide(w.layer));
            }),
          ),
      ),
      checks,
    );
  });
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

describe("T749 G5: a failed notification is still ignored and still recorded on its span", () => {
  type Member = { readonly k: Key; readonly client: Client; revoked: boolean };
  type Model = { members: Array<Member>; next: number };
  type Real = { readonly w: World; readonly d: Door; readonly admin: Client };
  const move = (
    name: string,
    check: (m: Model) => boolean,
    apply: (m: Model, r: Real) => Effect.Effect<void, unknown>,
  ) => walkable<Model, Real>(name, check, apply);
  const saw = {
    code: "123456",
    label: "Generated client",
    where: "test",
    how: "compare",
    check: "touch",
    has: [],
  } as const;

  // Runs one membership change with notifications failing or not, and checks every notify span.
  const changed = Effect.fnUntraced(function* (r: Real, fail: boolean, text: string) {
    const c = capture(yield* Tracer.Tracer);
    r.w.controls.notify = fail ? new LedgerError({ reason: "unreachable" }) : null;
    const reply = yield* r.d.grant({ text, armored: r.w.root.sign(text) }).pipe(Effect.withTracer(c.tracer));
    r.w.controls.notify = null;
    expect(reply).toMatchObject({ _tag: "applied" });
    const notified = c.spans.filter((s) => s.name === "gateway.notify");
    expect(notified.length).toBeGreaterThan(0);

    for (const span of notified) {
      expect(span.attributes.get("fab.gateway.notified")).toBe(!fail);
    }
  });
  const reachable = Effect.fnUntraced(function* (m: Model, r: Real) {
    for (const member of m.members) {
      expect(yield* r.d.route(member.client, "ledger.read", { stream: "notes", after: 0 })).toMatchObject(
        member.revoked ? { _tag: "refused", reason: "not_granted" } : { _tag: "ok" },
      );
    }
  });

  const grant = (fail: boolean) =>
    move(
      `grant(fail ${fail})`,
      () => true,
      Effect.fnUntraced(function* (m, r) {
        const k = key(r.w.seed, 16 + m.next++);
        const waiting = yield* hello(r.d, k, `waiting-${m.next}`);
        expect(waiting.result).toMatchObject({ _tag: "refused" });
        expect(yield* r.d.knock(waiting.client, { label: saw.label })).toMatchObject({ _tag: "ok" });
        yield* changed(
          r,
          fail,
          grantText({ id: `grant-${m.next}`, key: k.raw, for: PERSON, to: "t749", as: "window", sentAt: SENT, saw }),
        );
        m.members.push({ k, client: yield* online(r.d, k, `member-${m.next}`), revoked: false });
        yield* reachable(m, r);
      }),
    );
  const revoke = (n: number, fail: boolean) =>
    move(
      `revoke(${n}, fail ${fail})`,
      (m) => m.members.some((x) => !x.revoked),
      Effect.fnUntraced(function* (m, r) {
        const live = m.members.filter((x) => !x.revoked);
        const member = live[n % live.length]!;
        yield* changed(
          r,
          fail,
          revokeText({
            id: `revoke-${m.next++}`,
            key: member.k.raw,
            for: PERSON,
            to: "t749",
            sentAt: SENT,
            saw: { label: saw.label, where: "test", how: "panel", check: "touch" },
          }),
        );
        // The revocation takes effect even when its close notice could not be sent.
        member.revoked = true;
        yield* reachable(m, r);
      }),
    );

  it("generated grants and revocations with failing notifications still apply", async () => {
    await fc.assert(
      fc.asyncProperty(
        seed,
        fc.commands([fc.boolean().map(grant), fc.tuple(fc.nat(), fc.boolean()).map(([n, f]) => revoke(n, f))], {
          maxCommands: 6,
        }),
        (s, moves) =>
          run(
            Effect.gen(function* () {
              const w = yield* world(s);
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const admin = yield* online(d, w.window);
                yield* walk(moves, { members: [], next: 0 }, { w, d, admin });
              }).pipe(Effect.provide(w.layer));
            }),
          ),
      ),
      { ...checks, numRuns: 12 },
    );
  });
});

describe("T749 G6 [secrets]: nested failure text enters no stored, printed, RPC or logged output", () => {
  // A made-up sentinel whose raw, JSON-escaped and URL-encoded forms all differ.
  const sentinel = word.map((w) => `zz-leak-${w} "/&?`);
  const forms = (s: string) => [s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s)];
  type Path = Operation | "record";

  it("generated nested failures on every reachable path, required recording included, stay out", async () => {
    await fc.assert(
      fc.asyncProperty(
        seed,
        fc.constantFrom<Path>(...operations, "record"),
        sentinel,
        fc.constantFrom("message", "nested", "primitive"),
        word,
        (s, path, secret, shape, tag) =>
          run(
            Effect.gen(function* () {
              const w = yield* world(s);
              const logs: Array<string> = [];
              const logger = Logger.make((options) => {
                logs.push(`${String(options.message)}\n${Cause.pretty(options.cause)}`);
              });
              const fail: Lower =
                shape === "message"
                  ? new LedgerError({ reason: "storage", message: secret })
                  : new ProgramDown({
                      reason: "step",
                      error: secret,
                      cause: shape === "nested" ? new LedgerError({ reason: "unreachable", message: secret }) : secret,
                    });
              const exit = yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const client = yield* online(d, w.window);

                if (path === "record") {
                  w.controls.record = new LedgerError({ reason: "storage", message: secret });
                  return yield* Effect.exit(d.route(client, "process.send", request(`letter-${tag}`, tag)));
                }

                const ledgerShaped =
                  fail instanceof LedgerError ? fail : new LedgerError({ reason: "storage", message: secret });
                return (yield* reach(w, d, client, path, path === "deliver" ? fail : ledgerShaped, tag)).exit;
              }).pipe(Effect.provide(Layer.mergeAll(w.layer, Logger.layer([logger], { mergeWithExisting: false }))));
              expect(exit._tag).toBe("Failure");
              const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
              const thrown = error as { readonly name?: unknown; readonly message?: unknown } | null;
              const { main, spans } = w.stored();
              const text = (tables: ReadonlyArray<{ readonly text: string }>) => tables.map((t) => t.text).join("\n");
              const outputs: ReadonlyArray<readonly [string, string]> = [
                ["ledger record", text(main.filter((t) => t.table === "entries"))],
                ["saved state", text(main.filter((t) => t.table.startsWith("gateway_")))],
                ["captured log", logs.join("\n")],
                // Span rows and their content, in the span sink's tables and the record parts.
                [
                  "stored span",
                  text([...main.filter((t) => t.table !== "entries" && !t.table.startsWith("gateway_")), ...spans]),
                ],
                // What a Worker RPC rejection carries across: the squashed error's name and message.
                ["RPC failure", JSON.stringify({ name: thrown?.name, message: thrown?.message })],
                // The error's own printable text. A caller's Cause.pretty renders the in-memory cause
                // chain by design, so the gateway's own outputs above must never use it raw.
                ["printed", `${String(error)}\n${String(thrown?.message)}`],
              ];

              for (const [name, text] of outputs) {
                for (const form of forms(secret)) {
                  expect(text.includes(form), `${name} holds the nested failure text`).toBe(false);
                }
              }
            }),
          ),
      ),
      checks,
    );
  });
});

describe("T749 G9: the object guard keeps its accepted value set", () => {
  const reservedKeys = ["id", "by", "for", "arrivedAt"] as const;
  class Box {
    constructor(fields: Record<string, unknown>) {
      Object.assign(this, fields);
    }
  }
  const extra = fc.dictionary(
    fc.oneof(
      fc.constantFrom(...reservedKeys),
      word.filter((k) => k !== "stream" && k !== "after"),
    ),
    fc.jsonValue(),
    { maxKeys: 3 },
  );
  // JSON values, readable params with or without a reserved key, arrays carrying a reserved own
  // property, null, and class instances.
  const params = fc.oneof(
    fc.jsonValue(),
    fc.record({ stream: word, after: fc.nat() }).chain((read) => extra.map((more) => ({ ...read, ...more }))),
    fc.tuple(fc.array(fc.jsonValue(), { maxLength: 3 }), extra).map(([items, more]) => Object.assign(items, more)),
    fc.constant(null),
    extra.map((more) => new Box(more)),
  );
  const isPlainObject = (a: unknown) => typeof a === "object" && a !== null && !Array.isArray(a);
  const expected = (a: unknown) => {
    if (isPlainObject(a) && reservedKeys.some((k) => Object.hasOwn(a as object, k))) {
      return { _tag: "refused", reason: "reserved" };
    }

    return Schema.is(
      Schema.Struct({ stream: Schema.String, after: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
    )(a) && !Array.isArray(a)
      ? { _tag: "ok" }
      : { _tag: "refused", reason: "bad_input" };
  };

  it("generated params reach the reserved-key check only when they are non-null, non-array objects", async () => {
    await fc.assert(
      fc.asyncProperty(seed, fc.array(params, { minLength: 1, maxLength: 6 }), (s, all) =>
        run(
          Effect.gen(function* () {
            const w = yield* world(s);
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const client = yield* online(d, w.window);

              for (const p of all) {
                expect(yield* d.route(client, "ledger.read", p)).toMatchObject(expected(p));
              }
            }).pipe(Effect.provide(w.layer));
          }),
        ),
      ),
      {
        ...checks,
        examples: [
          // The two sets that differ between a non-array object guard and a plain object test.
          [new Uint8Array(32), [Object.assign([], { id: "x" }), new Box({ for: "y" }), null]],
        ],
      },
    );
  });
});

describe("T749 G10: both timestamp sites format the captured clock as ISO text", () => {
  const LAST = 253_402_300_799_999 - 10_000_000;
  const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

  it("generated clock values give the input record and the appended fact their captured ISO time", async () => {
    await fc.assert(
      fc.asyncProperty(
        seed,
        fc.integer({ min: 0, max: LAST }),
        fc.integer({ min: 0, max: 10_000_000 }),
        word,
        (s, first, later, tag) =>
          run(
            Effect.gen(function* () {
              const w = yield* world(s);
              yield* Effect.gen(function* () {
                yield* TestClock.setTime(first);
                const d = yield* Gateway;
                const client = yield* online(d, w.window);
                // Site 1: an input that carries no sentAt of its own gets the captured arrival time.
                yield* d.route(client, "ledger.read", { stream: "notes", after: 0 });
                const ledger = yield* Ledger;
                const inputs = yield* Stream.runCollect(ledger.read("gateway/inputs", 0));
                expect(inputs.at(-1)?.sentAt).toBe(iso(first));
                // Site 2: a caused fact's first append fixes its sentAt from the captured clock.
                yield* d.route(client, "process.send", request(tag, tag));
                const parent = w.deliveries.at(-1)!.envelope.id;
                yield* d
                  .signer(parent, PROCESS, "saved")
                  .pipe(Effect.provideService(SignRequest, { id: `fact-${tag}` }));
                yield* TestClock.setTime(first + later);
                yield* d.append({
                  id: `fact-${tag}`,
                  parent,
                  process: PROCESS,
                  kind: "saved",
                  stream: "notes",
                  event: { _tag: "saved", text: tag },
                });
                const notes = yield* Stream.runCollect(ledger.read("notes", 0));
                expect(notes.at(-1)?.sentAt).toBe(iso(first + later));
              }).pipe(Effect.provide(w.layer));
            }),
          ),
      ),
      checks,
    );
  });
});

describe("T749 G11: the declared contract's error channels hold no lower service error", () => {
  type Service = typeof Gateway.Service;
  type Fails<K extends keyof Service> = Service[K] extends (...args: never) => Effect.Effect<unknown, infer E, unknown>
    ? E
    : never;
  type LowerError = LedgerError | SinkError | ProgramDown | RunnerError | ProcessError;
  const members = [
    "target",
    "connect",
    "challenge",
    "initialize",
    "knock",
    "watch",
    "disconnect",
    "enrollment",
    "grant",
    "deny",
    "route",
    "signer",
    "sign",
    "retire",
    "checkDelivery",
    "append",
    "accept",
  ] as const;

  // Compiled by the type check, never run.
  const declared = () => {
    expectTypeOf<Extract<Fails<"target">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"connect">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"challenge">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"initialize">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"knock">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"watch">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"disconnect">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"enrollment">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"grant">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"deny">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"route">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"signer">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"sign">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"retire">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"checkDelivery">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"append">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<Fails<"accept">, LowerError>>().toEqualTypeOf<never>();
    expectTypeOf<GatewayError>().toExtend<Fails<"route">>();
    // The refusal channels stay declared beside the gateway's own error.
    expectTypeOf<SigningRefused>().toExtend<Fails<"sign">>();
    expectTypeOf<NotGranted>().toExtend<Fails<"accept">>();
    const leaking: Service["route"] = () =>
      // @ts-expect-error A lower service's error cannot leave through the declared contract.
      Effect.fail(new LedgerError({ reason: "storage" }));
    return leaking;
  };

  // The type checks above are G11. This scenario only pins that the built service offers exactly the
  // 17 members the plan declares, so a member cannot drop out of the contract unseen.
  it("scenario: the built service offers exactly the declared members, each a function", async () => {
    expect(declared).toBeTypeOf("function");
    await run(
      Effect.gen(function* () {
        const w = yield* world(new Uint8Array(32));
        const d = yield* Gateway.pipe(Effect.provide(w.layer));
        expect(Object.keys(d).sort()).toEqual([...members].sort());

        for (const member of members) {
          expect(d[member]).toBeTypeOf("function");
        }
      }),
    );
  });
});
