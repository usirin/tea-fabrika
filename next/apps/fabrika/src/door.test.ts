// P10's real wiring, including the door-spans laws, shares this one SQLite world. Gateway.layer
// needs Ledger, ClientManager, SpanSink, RecordManager and Archive, and owns SessionManager.
// Its options inject only production dependencies: typed program declarations, delivery,
// notifications, settings and the shared ProcessIdGenerator.next. No workerd class or runner.
// Each test names the plant it guards. The builder implements door.ts and does not edit this file.
// Every hello echoes the issued nonce. Its existing signature binds that nonce, the URL and tab.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { afterAll, beforeEach, describe, expect, it } from "@effect/vitest";
import { Id, Sent } from "@kampus/libfabrika";
import { Adds, Add, Grant, MemberEvent, Saw, Revoke } from "@kampus/libfabrika/access/Access";
import { ClientManager } from "@kampus/libfabrika/access/ClientManager";
import * as ClientManagerLedger from "@kampus/libfabrika/access/ClientManagerLedger";
import { SessionManagerError, SignRequest } from "@kampus/libfabrika/access/SessionManager";
import { grantText, addText, enrollmentText, revokeText } from "@kampus/libfabrika/access/Text";
import { GatewayError } from "@kampus/libfabrika/gateway/GatewayError";
import * as RateLimiterSql from "@kampus/libfabrika/gateway/RateLimiterSql";
import { Jobs } from "@kampus/libfabrika/jobs/Jobs";
import { Doorbell, Ledger, LedgerError } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import { LedgerTransaction, type LedgerTurn } from "@kampus/libfabrika/ledger/LedgerTransaction";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { lineFor } from "@kampus/libfabrika/ledger/Log";
import { Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { ProcessEvent, Recipient, Owner, Down, Start } from "@kampus/libfabrika/processes/Process";
import { ProcessIdGenerator } from "@kampus/libfabrika/processes/ProcessIdGenerator";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import { nodeExecution } from "@kampus/libfabrika/runtime/Execution";
import * as StartsTest from "@kampus/libfabrika/settings/StartsTest";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Archive } from "@kampus/libfabrika/telemetry/Archive";
import { RecordManager } from "@kampus/libfabrika/telemetry/Records";
import { SinkError, SpanSink } from "@kampus/libfabrika/telemetry/Sink";
import { Chain, SpanRow } from "@kampus/libfabrika/telemetry/Trace";
import { checkSshsig } from "@kampus/libfabrika/transport/Sshsig";
import { Attached, Hello } from "@kampus/libfabrika/transport/Wire";
import { Arbitrary, Deferred, Effect, Fiber, Layer, Logger, Option, Result, Schema, Stream } from "effect";
import * as RateLimiter from "effect/persistence/RateLimiter";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { vi } from "vitest";
const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const runs = (numRuns: number) => ({ seed: SEED, endOnFailure: true, numRuns });
const SpanPage = Schema.Struct({ spans: Schema.Array(SpanRow), next: Schema.Int });

const ADD_SAW = {
  method: "device",
  check: "touch",
  location: "test",
  has: ["verify"],
  typed: false,
  kept: null,
  old: null,
} as const;

const ids = Effect.runSync(Id.Generator.pipe(Effect.provide(Id.Generator.layer)));
const processId = (): string => Effect.runSync(ids.next(Id.Process));
const OTHER_PROCESS = processId();
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const PROCESS = processId();

const SAW = {
  code: "1234",
  label: "Browser",
  location: "test",
  method: "compare",
  check: "touch",
  has: ["verify", "seal"],
} as const;

const SENT = "2026-11-08T04:00:00.000Z";
/** A fresh step's crash, as the runner reports one: P34c slice 1's structured exit reason. */
const CRASHED = { _tag: "crashed", phase: "step", error: "Error" } as const;
const START = processId();
const TOOK = { label: "Browser", location: "test", method: "panel", check: "touch" } as const;
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPACE = "fabrika-client";
const utf8 = (text: string) => new TextEncoder().encode(text);

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

const field = (value: string | Uint8Array) => {
  const b = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return Buffer.concat([u32(b.length), b]);
};

const armor = (bytes: Uint8Array) =>
  `-----BEGIN SSH SIGNATURE-----\n${Buffer.from(bytes)
    .toString("base64")
    .match(/.{1,70}/g)
    ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;

const fingerprint = (bytes: Uint8Array) =>
  `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;

const signedBytes = (text: string, space: string = SPACE) =>
  Buffer.concat([
    Buffer.from("SSHSIG"),
    field(space),
    field(""),
    field("sha512"),
    field(createHash("sha512").update(text).digest()),
  ]);

const pack = (blob: Uint8Array, signature: Uint8Array, space: string = SPACE) =>
  armor(
    Buffer.concat([
      Buffer.from("SSHSIG"),
      u32(1),
      field(blob),
      field(space),
      field(""),
      field("sha512"),
      field(signature),
    ]),
  );

const web = <A>(call: () => Promise<A>): Effect.Effect<A, Error> =>
  Effect.tryPromise({ try: call, catch: (): Error => new Error("test WebCrypto failed") });

const key = Effect.fn("test.key")(function* () {
  const pair = yield* web(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
  const bytes = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
  const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw: Buffer.from(bytes).toString("base64url"),
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: fingerprint(bytes),
    sshFingerprint: fingerprint(blob),
    sign: (text: string, space: string = SPACE) =>
      web(() => crypto.subtle.sign("Ed25519", pair.privateKey, signedBytes(text, space))).pipe(
        Effect.map((raw) => pack(blob, Buffer.concat([field("ssh-ed25519"), field(new Uint8Array(raw))]), space)),
      ),
  };
});

const integer = (raw: Uint8Array) => {
  let at = 0;

  while (raw[at] === 0) {
    at++;
  }

  const bytes = Buffer.from(raw.slice(at));
  return bytes[0] !== undefined && bytes[0] >= 128 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
};

const passkey = Effect.fn("test.passkey")(function* () {
  const pair = yield* web(() =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]),
  );
  const point = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
  const rp = "fabrika.test",
    origin = `https://${rp}`;
  const blob = Buffer.concat([field("sk-ecdsa-sha2-nistp256@openssh.com"), field("nistp256"), field(point), field(rp)]);
  return {
    line: `sk-ecdsa-sha2-nistp256@openssh.com ${blob.toString("base64")}`,
    fingerprint: fingerprint(blob),
    sign: Effect.fnUntraced(function* (
      text: string,
      over: {
        flags?: number;
        counter?: number;
        origin?: string;
        type?: string;
        crossOrigin?: boolean;
        challenge?: Uint8Array;
        extensions?: Uint8Array;
        space?: string;
      } = {},
    ) {
      const flags = over.flags ?? 29,
        counter = over.counter ?? 0,
        space = over.space ?? SPACE;
      const clientDataJSON = utf8(
        JSON.stringify({
          type: over.type ?? "webauthn.get",
          challenge: Buffer.from(over.challenge ?? signedBytes(text, space)).toString("base64url"),
          origin: over.origin ?? origin,
          crossOrigin: over.crossOrigin ?? false,
        }),
      );
      const extensions = over.extensions ?? new Uint8Array();
      const authenticatorData = Buffer.concat([
        createHash("sha256").update(rp).digest(),
        Buffer.from([flags]),
        u32(counter),
        extensions,
      ]);
      const bytes = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
      const raw = new Uint8Array(
        yield* web(() => crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, bytes)),
      );
      const r = integer(raw.slice(0, 32)),
        s = integer(raw.slice(32));
      const der = Buffer.concat([
        Buffer.from([0x30, 4 + r.length + s.length, 2, r.length]),
        r,
        Buffer.from([2, s.length]),
        s,
      ]);
      const signature = Buffer.concat([
        field("webauthn-sk-ecdsa-sha2-nistp256@openssh.com"),
        field(Buffer.concat([field(r), field(s)])),
        Buffer.from([flags]),
        u32(counter),
        field(over.origin ?? origin),
        field(clientDataJSON),
        field(extensions),
      ]);
      return {
        armored: pack(blob, signature, space),
        assertion: {
          authenticatorData: new Uint8Array(authenticatorData),
          clientDataJSON,
          signature: new Uint8Array(der),
        },
        passkey: {
          origin: over.origin ?? origin,
          rp,
          be: (flags & 8) !== 0,
          bs: (flags & 16) !== 0,
          counter,
        },
      };
    }),
  };
});

// Loading inside the test hook lets each new law report the missing door on the pre-build base,
// instead of losing every law to a collection error. This always imports the real module.
let Gateway: typeof import("@kampus/libfabrika/gateway/Gateway").Gateway;
let connectionLayer: typeof import("@kampus/libfabrika/workers/gateway").connectionLayer;
let ConnectionService: typeof import("@kampus/libfabrika/workers/gateway").ConnectionService;
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

beforeEach(async () => {
  ({ Gateway } = await vi.importActual<typeof import("@kampus/libfabrika/gateway/Gateway")>(
    "@kampus/libfabrika/gateway/Gateway",
  ));
  ({ connectionLayer, ConnectionService } = await vi.importActual<typeof import("@kampus/libfabrika/workers/gateway")>(
    "@kampus/libfabrika/workers/gateway",
  ));
});

const top = mkdtempSync(join(tmpdir(), "p10-door-"));
const opened: Array<DatabaseSync> = [];

afterAll(() => {
  for (const db of opened) {
    if (db.isOpen) {
      db.close();
    }
  }

  rmSync(top, { recursive: true, force: true });
});

// Each world is a fresh SQLite file, and every door call commits. No law here kills the process
// mid-write, so the rollback journal stays in memory and no commit waits on the disk. A reopen
// still reads the same file. This halves the ticket 707 walks, 200 worlds each.
const open = (path: string) => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF");
  opened.push(db);
  return db;
};

const URL = "https://fabrika.test/entry/project-socket";

const Input = Schema.TaggedUnion({
  comment: { ticket: Schema.Struct({ id: Schema.String }), text: Schema.String },
  approve: { answer: Schema.String },
  keys: { bytes: Schema.String },
  secret: {
    value: Schema.Struct({
      secret: Schema.RedactedFromValue(Schema.String, { disallowEncode: true }),
    }),
  },
});

const comment = (text = "hello") => Input.cases.comment.make({ ticket: { id: "ticket-7" }, text });

type Envelope = {
  id: string;
  by: { _tag: "person" | "agent"; key: string; for: string };
  arrivedAt: number;
  input: unknown;
};

type Delivery = { process: string; envelope: Envelope; trace: { traceId: string; spanId: string } };

type DeliveryCheck = Effect.Effect<
  void,
  LedgerError | SinkError | Effect.Error<ReturnType<typeof writeId>>,
  Ledger | RecordManager | Effect.Services<ReturnType<typeof writeId>>
>;

const world = Effect.fnUntraced(function* (
  options: {
    recordCap?: number;
    inputCap?: number;
    spentCap?: number;
    rateLimit?: { limit: number; window: number };
  } = {},
) {
  const dir = mkdtempSync(join(top, "w-"));
  const db = open(join(dir, "project.db"));
  const sql = nodeSql(db);
  const root = yield* key(),
    window = yield* key(),
    agent = yield* key(),
    otherRoot = yield* key(),
    otherWindow = yield* key(),
    sheet = yield* key();
  const founder = {
    name: "Displayed project",
    person: PERSON,
    keys: [root.line],
    window: window.raw,
    by: root.sshFingerprint,
    build: "test-build",
  };
  const partFiles = new Map<string, DatabaseSync>();
  const part = (name: string) => {
    let p = partFiles.get(name);

    if (!p) {
      p = open(join(dir, `${name.replaceAll("/", "_")}.db`));
      partFiles.set(name, p);
    }

    return nodeSql(p);
  };
  const deliveries: Array<Delivery> = [],
    notices: Array<{ client: string; news: unknown }> = [];
  const controls = {
    deliver: (_: Delivery): DeliveryCheck => Effect.void,
    notify: (_client: string, _news: unknown): Effect.Effect<void, LedgerError> => Effect.void,
    next: () => ProcessIdGenerator.use((g) => g.next),
    // What the injected program answers a delivered letter with, as the runner's Sent does.
    answer: undefined as typeof Sent.cases.refused.Type | undefined,
  };
  const deliver = (process: string, envelope: Envelope, trace: { traceId: string; spanId: string }) =>
    Effect.gen(function* () {
      const delivery = { process, envelope, trace };
      deliveries.push(delivery);
      yield* controls.deliver(delivery);

      if (Schema.is(Input.cases.keys)(envelope.input) || Schema.is(Schema.toType(Input.cases.secret))(envelope.input)) {
        return;
      }

      // This is the injected P11 handoff, not a P10 runner. Exercise real P9 dedupe for JSON input.
      const value = Schema.decodeUnknownOption(Schema.Json)(envelope.input);

      if (Option.isSome(value)) {
        const mailbox = yield* Mailbox;
        const placing = yield* mailbox.send(process, envelope.id, value.value, {
          by: envelope.by.key,
          for: envelope.by.for,
          sentAt: SENT,
          seen: 0,
          parent: envelope.id,
          traceId: trace.traceId,
          build: "test-build",
        });

        if (placing._tag === "refused") {
          return yield* new LedgerError({ reason: "refused" });
        }
      }

      return controls.answer;
    });
  const settings = {
    founder,
    sql,
    name: "project-a",
    url: URL,
    origins: ["https://fabrika.test"],
    versions: [1, 2],
    location: "test-instance",
    build: "test-build",
    waiting: { most: 3, ttl: 600_000 },
    rateLimit: options.rateLimit ?? { limit: 100_000, window: 60_000 },
    ping: { min: 10_000, max: 60_000 },
    inputCap: options.inputCap ?? 1000,
    spentCap: options.spentCap ?? 1000,
    nextProcess: () => controls.next(),
    deliver,
    notify: (client: string, news: unknown) =>
      Effect.gen(function* () {
        notices.push({ client, news });
        yield* controls.notify(client, news);
      }),
    audit: (_process: string, message: unknown) =>
      Effect.sync(() => {
        const checked = Schema.decodeUnknownSync(Schema.toType(Input))(message);
        // The approval's answer is deliberately public metadata; the text of a comment is content.
        return checked._tag === "approve"
          ? Schema.encodeSync(Schema.toCodecJson(Input))(checked)
          : { type: checked._tag };
      }),
    inputs: {
      schema: Input,
      personOnly: ["approve"],
      raw: ["keys"],
      name: (m: typeof Input.Type) => m._tag,
    },
    events: { personOnly: ["answered"] },
  };
  const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
  const ledger = LedgerSql.layer(sql, { reader: "project-a" }).pipe(Layer.provide(quiet));
  const clients = ClientManagerLedger.layer(founder).pipe(Layer.provideMerge(ledger));
  // P37's records.test.ts uses 64 KiB, above SQLite's empty table/index overhead.
  const records = RecordManager.sql(part, options.recordCap ?? 64 * 1024);
  const usedInputs: Array<string> = [];
  const observedIds = Layer.effect(
    Id.Generator,
    Id.Generator.pipe(
      Effect.map((real) => ({
        next: <P extends string>(schema: Id.IdSchema<P>) =>
          real.next(schema).pipe(
            Effect.tap((id) =>
              Effect.sync(() => {
                if (schema === Id.Input) {
                  usedInputs.push(id);
                }
              }),
            ),
          ),
      })),
    ),
  ).pipe(Layer.provide(Id.Generator.layer));
  const env = Layer.mergeAll(
    clients,
    LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet)),
    Mailbox.layer.pipe(Layer.provide(clients)),
    SpanSink.layer(sql, { object: START }),
    records,
    Archive.memory,
    Layer.succeed(Jobs, {
      request: () => Effect.die("unexpected job request in legacy gateway law"),
      take: () => Effect.die("unexpected job take in legacy gateway law"),
      started: () => Effect.die("unexpected job start in legacy gateway law"),
      finish: () => Effect.die("unexpected job finish in legacy gateway law"),
      read: () => Effect.die("unexpected job read in legacy gateway law"),
      forProcess: () => Stream.die("unexpected job lookup in legacy gateway law"),
    }),
    ProcessIdGenerator.layer,
    observedIds,
    RateLimiter.layer.pipe(
      Layer.provide(RateLimiterSql.layer(sql, { build: "test-build", policy: settings.rateLimit })),
    ),
  );
  const layer = Gateway.layer(settings).pipe(Layer.provideMerge(env));
  const reopen = (storage: ReturnType<typeof nodeSql>) => {
    const freshLedger = LedgerSql.layer(storage, { reader: "project-a" }).pipe(Layer.provide(quiet));
    const freshClients = ClientManagerLedger.layer(founder).pipe(Layer.provideMerge(freshLedger));
    return Gateway.layer({ ...settings, sql: storage }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          freshClients,
          LedgerTransactionSql.layer(storage).pipe(Layer.provide(quiet)),
          Mailbox.layer.pipe(Layer.provide(freshClients)),
          SpanSink.layer(storage, { object: START }),
          records,
          Archive.memory,
          Layer.succeed(Jobs, {
            request: () => Effect.die("unexpected job request in legacy gateway law"),
            take: () => Effect.die("unexpected job take in legacy gateway law"),
            started: () => Effect.die("unexpected job start in legacy gateway law"),
            finish: () => Effect.die("unexpected job finish in legacy gateway law"),
            read: () => Effect.die("unexpected job read in legacy gateway law"),
            forProcess: () => Stream.die("unexpected job lookup in legacy gateway law"),
          }),
          ProcessIdGenerator.layer,
          Id.Generator.layer,
          RateLimiter.layer.pipe(
            Layer.provide(RateLimiterSql.layer(storage, { build: "test-build", policy: settings.rateLimit })),
          ),
        ),
      ),
    );
  };
  return {
    dir,
    db,
    sql,
    root,
    window,
    agent,
    otherRoot,
    otherWindow,
    sheet,
    deliveries,
    notices,
    controls,
    settings,
    founder,
    env,
    layer,
    provide: Effect.provide(layer),
    reopen,
    usedInputs,
    databases: () => new Map([["object", db], ...partFiles]),
    partCount: () => partFiles.size,
    bytes: () => readdirSync(dir).map((file) => readFileSync(join(dir, file))),
  };
});

type World = Effect.Success<ReturnType<typeof world>>;

const AuditMessage = Schema.Struct({ type: Schema.Literal("comment"), ticket: Schema.String, body: Schema.String });
const AuditMetadata = Schema.Struct({ type: Schema.Literal("comment"), ticket: Schema.String });

const failedSelection = (body: string): never => {
  throw new Error(body);
};

const auditProgram = (select: (m: typeof AuditMessage.Type) => unknown) => ({
  name: "audit-fixture",
  machine: Machine.make({
    model: Schema.Null,
    msg: AuditMessage,
    cmds: [],
    init: () => [null, []],
    update: { comment: (s) => [s, []] },
  }),
  state: { v: 1, schema: Schema.Null, upgrades: [] },
  msg: AuditMessage,
  view: { data: Schema.Null, select: () => null },
  refuse: () => null,
  inputs: {},
  outputs: {},
  writes: {},
  wake: () => null,
  audit: { data: AuditMetadata, select },
});

describe("P13 selected input recording", () => {
  it("A5, A6, A10, A12 [secrets]: failed selection leaves no received record or delivery; committed retries reuse their metadata", async () => {
    const reached = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.array(fc.noBias(fc.nat()), { minLength: 8, maxLength: 24 }), (tape) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* world();
              let mode = "ok";
              let selections = 0;
              const program = auditProgram((m) => {
                selections++;

                if (mode === "selector") {
                  return failedSelection(m.body);
                }

                if (mode === "output") {
                  return { type: "comment", ticket: 1n };
                }

                return { type: "comment", ticket: m.ticket };
              });
              const execution = nodeExecution(program);
              const audit = (_target: string, input: unknown) => {
                const checked = Schema.decodeUnknownSync(Input.cases.comment)(input);
                return execution.audit({
                  type: "comment",
                  ticket: mode === "decode" ? 1 : checked.ticket.id,
                  body: checked.text,
                });
              };
              const settings = { ...w.settings, audit };
              const layer = () => Gateway.layer(settings).pipe(Layer.provideMerge(w.env));
              let d = yield* Gateway.pipe(Effect.provide(layer()));
              let { client } = yield* online(d, w).pipe(Effect.provide(w.env));
              const history: Array<{ id: string; body: string; before: number }> = [];
              const bodies: Array<string> = [];
              const printable: Array<string> = [];

              for (const [n, entropy] of tape.entries()) {
                const moves =
                  history.length === 0
                    ? ["ok", "decode", "selector", "output"]
                    : ["ok", "decode", "selector", "output", "retry", "reopen"];
                const move = moves[entropy % moves.length]!;
                reached.add(move);

                if (move === "reopen") {
                  d = yield* Gateway.pipe(Effect.provide(layer()));
                  ({ client } = yield* online(d, w).pipe(Effect.provide(w.env)));
                  continue;
                }

                if (move === "retry") {
                  const prior = history[Math.floor(entropy / moves.length) % history.length]!;
                  mode = "selector";
                  const before = selections;
                  const answer = yield* d.route(client, "process.send", request(prior.id, comment(prior.body)));
                  expect(answer._tag).toBe("ok");
                  expect(selections, "a recorded binding never reruns today's selector").toBe(before);
                  expect(rawRows(w.db, "gateway/inputs").filter((row) => row._tag === "received")).toHaveLength(
                    history.length,
                  );
                  continue;
                }

                mode = move;
                const body = `BODY-${entropy}-${n} "/雪\n`;
                bodies.push(body);
                const id = `audit-${n}`;
                const before = rawRows(w.db, "gateway/inputs");
                const delivered = w.deliveries.length;
                const result = yield* Effect.result(d.route(client, "process.send", request(id, comment(body))));

                if (move === "ok") {
                  expect(result).toMatchObject({ _tag: "Success", success: { _tag: "ok" } });
                  history.push({ id, body, before: delivered });
                } else {
                  expect(result).toMatchObject({
                    _tag: "Failure",
                    failure: { _tag: "AuditError", reason: { _tag: expect.any(String) } },
                  });

                  if (result._tag === "Failure") {
                    printable.push(String(result.failure), JSON.stringify(result.failure));
                  }

                  expect(rawRows(w.db, "gateway/inputs")).toEqual(before);
                  expect(w.deliveries).toHaveLength(delivered);
                  // Retry from the allocated binding, after repairing the selector.
                  mode = "ok";
                  expect(yield* d.route(client, "process.send", request(id, comment(body)))).toMatchObject({
                    _tag: "ok",
                  });
                  history.push({ id, body, before: delivered });
                }

                const rows = rawRows(w.db, "gateway/inputs").filter((r) => r._tag === "received");
                expect(rows).toHaveLength(history.length);

                for (const row of rows) {
                  expect(JSON.parse(String(row.body))).toMatchObject({
                    input: { type: "comment", ticket: "ticket-7" },
                  });
                }

                const outputs = [
                  JSON.stringify(rows),
                  JSON.stringify(w.sql.exec("SELECT * FROM gateway_bindings")),
                  ...printable,
                ];

                for (const value of bodies) {
                  for (const form of [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]) {
                    for (const output of outputs) {
                      expect(output).not.toContain(form);
                    }
                  }
                }
              }
            }),
          ),
        ),
      ),
      { seed: SEED, numRuns: 100 },
    );
    expect([...reached]).toEqual(expect.arrayContaining(["ok", "decode", "selector", "output", "retry", "reopen"]));
  });
});

// The real connection and Project gateway, joined through the platform's RPC contract.
const wire = Effect.fnUntraced(function* (
  w: World,
  d: typeof Gateway.Service,
  client: Parameters<typeof Gateway.Service.route>[0],
  archiveFailure: "unreachable" | "mismatch",
  storageFailure: () => boolean = () => false,
) {
  const projectContext = yield* Effect.context<never>();
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (handle) => Effect.sync(() => handle.close()),
  );
  const real = nodeSql(db);
  const sql = {
    ...real,
    transaction: <A>(step: () => A): A => {
      if (storageFailure()) {
        throw new Error("SQLITE_FULL");
      }

      return real.transaction(step);
    },
  };
  let attached = Attached.cases.online.make({
    client,
    identity: { key: w.window.fingerprint, person: PERSON, as: "window" },
    version: 1,
    waits: [],
    watching: false,
    busy: false,
  });
  const frames: Array<unknown> = [];
  const saved: Array<unknown> = [];
  const archives: Array<unknown> = [];
  const closes: Array<number> = [];
  const socket = {
    deserializeAttachment: () => attached,
    serializeAttachment: (next: typeof attached) => {
      attached = next;
    },
    send: (text: string) => {
      frames.push(JSON.parse(text));
    },
    close: (code: number) => {
      closes.push(code);
    },
  };
  const state = {
    id: { name: "t843-connection" },
    storage: {
      sql: {
        exec: sql.exec,
        get databaseSize() {
          return sql.size();
        },
      },
      transactionSync: sql.transaction,
    },
    getWebSockets: () => [socket],
    getTags: () => ["test-session", "test-tab", w.window.fingerprint],
    getWebSocketAutoResponseTimestamp: () => null,
  };
  const input = StartsTest.fixture({ name: "t843-project", port: 8787 }, (algorithm, data) =>
    createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
  );
  const env = {
    INSTANCE: JSON.stringify(input),
    PROJECT: {
      getByName: () => ({
        settingsStart: async () => StartsTest.reply(input),
        route: (_client: string, method: string, params: unknown) =>
          Effect.runPromise(d.route(client, method, params).pipe(Effect.provideContext(projectContext))),
      }),
    },
    RECORD: {
      getByName: () => ({
        write: (_chain: unknown, _part: number, rows: ReadonlyArray<unknown>) => {
          saved.push(...rows);
          return Promise.resolve({ _tag: "written" });
        },
      }),
    },
    MEASUREMENTS: {
      put: (name: string, bytes: Uint8Array) => {
        archives.push({ name, body: new TextDecoder().decode(bytes) });
        return archiveFailure === "unreachable" ? Promise.reject(new Error("archive unavailable")) : Promise.resolve();
      },
      head: () => Promise.resolve(null),
    },
  };
  const layer: ReturnType<typeof connectionLayer> = Reflect.apply(connectionLayer, undefined, [state, env, input]);
  const context = yield* Layer.build(layer);
  const service = yield* ConnectionService.pipe(Effect.provideContext(context));
  let id = 0;
  const send = (method: string, params: unknown): Effect.Effect<void, unknown> => {
    const effect: ReturnType<typeof service.message> = Reflect.apply(service.message, service, [
      socket,
      JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    ]);
    return effect.pipe(Effect.provideContext(context));
  };
  return {
    db,
    frames,
    saved,
    archives,
    closes,
    send,
    ring: (stream: string, rev: number) => service.ring(stream, rev).pipe(Effect.provideContext(context)),
    read: () => attached,
    recover: Effect.suspend(() => send("process.send", request("recovery-probe"))),
  };
});

const failingTableWrites = (
  sql: ReturnType<typeof nodeSql>,
  table: string,
  active: () => boolean,
  cause: Error,
): ReturnType<typeof nodeSql> => ({
  ...sql,
  exec: (query, ...params) => {
    if (active() && query.includes(table) && /INSERT|UPDATE/u.test(query)) {
      throw cause;
    }

    return sql.exec(query, ...params);
  },
});

describe("T843 sender budget, next/", () => {
  const small = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 }));
  const schedule = Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))).check(
    Schema.isMinLength(12),
    Schema.isMaxLength(40),
  );

  it.effect.prop(
    "T843 attempts: reads, malformed calls, reserved stamps and letter retries spend the checked key's budget first (50 runs)",
    { limit: small, choices: schedule },
    ({ limit, choices }) =>
      Effect.gen(function* () {
        const w = yield* world({ rateLimit: { limit, window: 60_000 } });
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          yield* TestClock.setTime(REFUSED_HOUR + 18_000);
          let passed = 0;
          let delivered = false;

          for (const pick of choices) {
            // A retry exists only after its first delivery. Every other move is legal while online.
            const moves: ReadonlyArray<string> = [
              "read",
              "bad",
              "reserved",
              "unknown",
              "send",
              ...(delivered ? ["retry"] : []),
            ];
            const move: string = moves[pick % moves.length]!;
            const method = move === "read" ? "ledger.read" : move === "unknown" ? "missing.method" : "process.send";
            const params =
              move === "read"
                ? { stream: "empty", after: 0 }
                : move === "reserved"
                  ? { ...request("same-letter"), by: "claimed-key" }
                  : move === "bad"
                    ? { m: false }
                    : request("same-letter");
            const before = w.usedInputs.length;
            const sent = w.deliveries.length;
            const answer = yield* d.route(client, method, params);
            expect(answer._tag).toBe(
              passed === limit || ["reserved", "bad", "unknown"].includes(move) ? "refused" : "ok",
            );

            if (passed === limit) {
              expect(answer).toEqual({ _tag: "refused", reason: "rate_limited", retryAfter: 42_000 });
              expect(w.usedInputs).toHaveLength(before);
              expect(w.deliveries).toHaveLength(sent);
            } else {
              expect(answer).toMatchObject(
                move === "reserved"
                  ? { _tag: "refused", reason: "reserved" }
                  : move === "bad"
                    ? { _tag: "refused", reason: "bad_input" }
                    : move === "unknown"
                      ? { _tag: "refused", reason: "unknown_method" }
                      : { _tag: "ok" },
              );
              passed++;
              delivered ||= move === "send";
            }
          }
        }).pipe(w.provide);
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  it.effect.prop(
    "T843 identity: connections, targets and reopened layers share one key; a second key stays independent (50 runs)",
    { limit: small, picks: schedule },
    ({ limit, picks }) =>
      Effect.gen(function* () {
        const w = yield* world({ rateLimit: { limit, window: 60_000 } });
        let one: Parameters<typeof Gateway.Service.route>[0];
        let two: Parameters<typeof Gateway.Service.route>[0];
        let other: Parameters<typeof Gateway.Service.route>[0];
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          one = (yield* online(d, w)).client;
          two = (yield* online(d, w, "second-tab")).client;
          other = (yield* grantWindow(d, w, "other-tab", "window")).client;
          yield* TestClock.setTime(REFUSED_HOUR + 18_000);

          for (let n = 0; n < limit; n++) {
            const client = picks[n]! % 2 === 0 ? one : two;
            expect(
              (yield* d.route(client, "process.send", {
                ...request(`budget-${n}`),
                pid: n % 2 ? OTHER_PROCESS : PROCESS,
              }))._tag,
            ).toBe("ok");
          }

          expect(yield* d.route(two, "ledger.read", { stream: "empty", after: 0 })).toMatchObject({
            reason: "rate_limited",
          });
          expect((yield* d.route(other, "ledger.read", { stream: "empty", after: 0 }))._tag).toBe("ok");
          yield* d.disconnect(one);
          one = (yield* online(d, w, "reconnected")).client;
        }).pipe(w.provide);
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          expect(yield* d.route(one, "ledger.read", { stream: "empty", after: 0 })).toMatchObject({
            reason: "rate_limited",
            retryAfter: 42_000,
          });
          yield* TestClock.adjust(42_000);
          expect((yield* d.route(one, "process.send", request("after-reset")))._tag).toBe("ok");
        }).pipe(Effect.provide(w.reopen(w.sql)));
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  it.effect.prop(
    "T843 race: separate layers can consume the last place only once (50 runs)",
    { limit: small, reverse: Schema.Boolean },
    ({ limit, reverse }) =>
      Effect.gen(function* () {
        const w = yield* world({ rateLimit: { limit, window: 60_000 } });
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          yield* TestClock.setTime(REFUSED_HOUR + 18_000);

          for (let n = 1; n < limit; n++) {
            yield* d.route(client, "ledger.read", { stream: "empty", after: 0 });
          }

          const a = d.route(client, "ledger.read", { stream: "empty", after: 0 });
          const b = Gateway.use((fresh) => fresh.route(client, "ledger.read", { stream: "empty", after: 0 })).pipe(
            Effect.provide(w.reopen(w.sql)),
          );
          const replies = yield* Effect.all(reverse ? [b, a] : [a, b], { concurrency: "unbounded" });
          expect(replies.filter((answer) => answer._tag === "ok")).toHaveLength(1);
          expect(
            replies.filter((answer) => answer._tag === "refused" && answer.reason === "rate_limited"),
          ).toHaveLength(1);
        }).pipe(w.provide);
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  it.effect.prop(
    "T843 early gate: offline calls create no budget and rate refusals do no hashing, allocation, naming or delivery (50 runs)",
    { count: small },
    ({ count }) =>
      Effect.gen(function* () {
        const w = yield* world({ rateLimit: { limit: 1, window: 60_000 } });
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const fresh = yield* d.connect();
          expect(yield* d.route(fresh, "process.send", { ...request("not-online"), by: "claimed" })).toMatchObject({
            reason: "not_granted",
          });
          const tables = w.sql.exec("SELECT name FROM sqlite_schema WHERE type='table' AND name='gateway_limits'");

          if (tables.length) {
            expect(w.sql.exec("SELECT * FROM gateway_limits")).toEqual([]);
          }

          const { client } = yield* online(d, w);
          yield* d.route(client, "process.send", request("fill"));
          const ids = [...w.usedInputs];
          const sent = w.deliveries.length;
          const digest = yield* Effect.acquireRelease(
            Effect.sync(() => vi.spyOn(crypto.subtle, "digest")),
            (spy) => Effect.sync(() => spy.mockRestore()),
          );
          const named = vi.fn((m: typeof Input.Type) => m._tag);
          w.settings.inputs.name = named;
          const next = vi.fn(() => Effect.die("a denied call allocated a process"));
          w.controls.next = next;

          for (let n = 0; n < count; n++) {
            expect(yield* d.route(client, "process.send", request(`denied-${n}`))).toMatchObject({
              reason: "rate_limited",
            });
          }

          expect(digest).not.toHaveBeenCalled();
          expect(named).not.toHaveBeenCalled();
          expect(next).not.toHaveBeenCalled();
          expect(w.usedInputs).toEqual(ids);
          expect(w.deliveries).toHaveLength(sent);
        }).pipe(w.provide);
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  it.effect.prop(
    "T843 gateway store failure: a broken saved counter or failed write never reaches delivery (50 runs)",
    { corrupt: Schema.Boolean },
    ({ corrupt }) =>
      Effect.gen(function* () {
        const w = yield* world({ rateLimit: { limit: 3, window: 60_000 } });
        let client: Parameters<typeof Gateway.Service.route>[0];
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          client = (yield* online(d, w)).client;
          yield* d.route(client, "ledger.read", { stream: "empty", after: 0 });
        }).pipe(w.provide);

        if (corrupt) {
          w.sql.exec("UPDATE gateway_limits SET value=?", "{");
        }

        const cause = new Error("t843 write failed");
        const sql = failingTableWrites(w.sql, "gateway_limits", () => !corrupt, cause);
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const error = yield* Effect.flip(d.route(client, "process.send", request("blocked-by-store")));
          expect(error).toHaveProperty("cause");
          expect(w.deliveries).toEqual([]);
        }).pipe(Effect.provide(w.reopen(sql)));
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  it.effect.prop(
    "T843 count failure: an uncommitted gateway refusal count fails the call before it answers (50 runs)",
    { count: small },
    ({ count }) =>
      Effect.gen(function* () {
        const w = yield* world({ rateLimit: { limit: 1, window: 60_000 } });
        let broken = false;
        const sql = failingTableWrites(w.sql, "sums", () => broken, new Error("SQLITE_FULL"));
        const sink = SpanSink.layer(sql, { object: START });
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          yield* d.route(client, "ledger.read", { stream: "empty", after: 0 });
          broken = true;

          for (let n = 0; n < count; n++) {
            expect(yield* Effect.flip(d.route(client, "process.send", request(`not-counted-${n}`)))).toMatchObject({
              _tag: "SinkError",
              reason: "storage",
            });
          }

          expect(w.deliveries).toEqual([]);
        }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, sink)))));
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  const failedCountThrough = Effect.fnUntraced(function* (
    count: number,
    method: "process.send" | "ledger.wait",
    connectionFull: boolean,
  ) {
    const w = yield* world({ rateLimit: { limit: 1, window: 60_000 } });
    let broken = false;
    const sql = failingTableWrites(w.sql, "sums", () => broken, new Error("SQLITE_FULL"));
    const sink = SpanSink.layer(sql, { object: START });
    yield* Effect.gen(function* () {
      const d = yield* Gateway;
      const projectSink = yield* SpanSink;
      const { client } = yield* online(d, w);
      yield* TestClock.setTime(REFUSED_HOUR + 18_000);
      const c = yield* wire(w, d, client, "mismatch", () => broken && connectionFull);
      yield* c.send("process.send", request("accepted"));
      yield* c.send("process.send", request("warm-count"));
      yield* projectSink.flush;
      const rows = () =>
        Object.fromEntries(
          [...w.databases(), ["connection", c.db] as const].flatMap(([name, db]) =>
            Object.entries(allObjectRows(db)).map(([table, values]) => [`${name}/${table}`, values.length]),
          ),
        );
      const before = rows();
      const unchanged = () => {
        const current = rows();
        expect(Object.keys(current)).toEqual(Object.keys(before));

        for (const [table, total] of Object.entries(current)) {
          expect(total, table).toBe(before[table]);
        }
      };
      const recorded = c.saved.length;
      const inputs = [...w.usedInputs];
      const deliveries = w.deliveries.length;
      broken = true;

      for (let n = 0; n < count; n++) {
        const state = c.read();
        expect(state._tag).toBe("online");

        if (state._tag !== "online") {
          return;
        }

        // Only an idle connection may start this next generated attempt.
        expect(state.busy).toBe(false);
        expect(state.waits).toEqual([]);
        const frames = c.frames.length;
        const sent = yield* Effect.result(
          c.send(method, method === "ledger.wait" ? { stream: "empty", after: 0 } : request(`not-counted-${n}`)),
        );
        const status = yield* Effect.result(projectSink.check);
        expect(Result.isFailure(status)).toBe(true);

        if (Result.isFailure(status)) {
          expect(status.failure).toMatchObject({ _tag: "SinkError", reason: "storage" });
          expect(status.failure.held).toBeLessThanOrEqual(1);
        }

        if (Result.isFailure(sent)) {
          // The public completion reports how much the connection holds after a full disk.
          expect(sent.failure).toMatchObject({ _tag: "SinkError", reason: "storage" });
          const failed = Schema.decodeUnknownSync(Schema.Struct({ held: Schema.Int }))(sent.failure);
          expect(failed.held).toBeLessThanOrEqual(2);
        }

        for (const reply of c.frames.slice(frames)) {
          expect(reply).not.toMatchObject({ error: { data: { reason: "rate_limited" } } });
        }

        unchanged();
        expect(c.saved).toHaveLength(recorded);
        expect(w.usedInputs).toEqual(inputs);
        expect(w.deliveries).toHaveLength(deliveries);
        expect(c.closes).toEqual([]);
      }

      broken = false;
      // A refused recovery probe must land held counts without saving failed-attempt spans.
      yield* projectSink.check.pipe(Effect.ignore);
      expect(yield* projectSink.flush).toEqual({ sent: 0 });
      yield* c.recover.pipe(Effect.ignore);
      yield* c.recover;
      unchanged();
      expect(c.saved).toHaveLength(recorded);
      yield* TestClock.setTime(REFUSED_HOUR + HOUR);
      expect(yield* projectSink.sums("gateway.route", REFUSED_HOUR, REFUSED_HOUR + HOUR)).toEqual([
        { _tag: "sum", piece: "gateway.route", hour: REFUSED_HOUR, refused: "rate_limited", count: count + 3 },
      ]);
    }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, sink)))));
  });

  for (const connectionFull of [false, true]) {
    for (const method of ["process.send", "ledger.wait"] as const) {
      it.effect.prop(
        `T843 failed count through ${method} with ${connectionFull ? "both disks full" : "only the gateway count failing"}: no per-attempt rows or held spans survive failure and recovery (50 runs)`,
        {
          count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
        },
        ({ count }: { count: number }) => failedCountThrough(count, method, connectionFull),
        { arbitrary: { seed: SEED, runs: 50 } },
      );
    }
  }

  it.effect(
    "scenario: T843 failed count through process.send with both disks full at count 1000, the largest burst the plan names",
    () => failedCountThrough(1000, "process.send", true),
  );

  for (const failure of ["none", "gateway", "both"] as const) {
    it.effect.prop(
      `T843 ring bound with ${failure} failing: parked rechecks retain delays and add only counts despite aged failed archives, including recovery (50 runs)`,
      {
        count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 63 })),
        archiveFailure: Schema.Literals(["unreachable", "mismatch"]),
      },
      ({ count, archiveFailure }) =>
        Effect.gen(function* () {
          // The connection admits at most 64 waits, including the warm-up wait.
          const w = yield* world({ rateLimit: { limit: count + 2, window: 60_000 } });
          let broken = false;
          const sql = failingTableWrites(w.sql, "sums", () => broken, new Error("SQLITE_FULL"));
          const sink = SpanSink.layer(sql, { object: START });
          yield* Effect.gen(function* () {
            const d = yield* Gateway;
            const projectSink = yield* SpanSink;
            const { client } = yield* online(d, w);
            yield* TestClock.setTime(REFUSED_HOUR - 16 * 24 * HOUR);
            const c = yield* wire(w, d, client, archiveFailure, () => broken && failure === "both");
            yield* c.send("ledger.read", { stream: "old-archive", after: 0 });
            yield* TestClock.setTime(REFUSED_HOUR + 18_000);
            yield* c.send("ledger.wait", { stream: "warm-ring", after: 0 });

            for (let n = 0; n < count; n++) {
              const now = c.read();
              expect(now._tag).toBe("online");
              expect(now.waits).toHaveLength(n + 1);
              yield* c.send("ledger.wait", { stream: "empty", after: 0 });
            }

            yield* c.send("process.send", request("accepted-before-ring"));
            yield* c.ring("warm-ring", 0);
            expect(c.frames.at(-1)).toMatchObject({
              error: { data: { reason: "rate_limited", retryAfter: 42_000 } },
            });
            yield* c.send("process.send", request("warm-ring-frame-count"));
            yield* projectSink.flush;
            // An ordinary call already tried the due archive and kept it for a later retry.
            expect(c.archives.length).toBeGreaterThan(0);
            const archived = c.archives.length;
            const rows = () =>
              Object.fromEntries(
                [...w.databases(), ["connection", c.db] as const].flatMap(([name, db]) =>
                  Object.entries(allObjectRows(db)).map(([table, values]) => [`${name}/${table}`, values.length]),
                ),
              );
            const before = rows();
            const recorded = c.saved.length;
            const inputs = [...w.usedInputs];
            const deliveries = [...w.deliveries];
            const frames = c.frames.length;
            broken = failure !== "none";

            while (c.read().waits.length > 0) {
              const now = c.read();
              expect(now._tag).toBe("online");
              expect(now.busy).toBe(false);
              const pending = now.waits;
              const next = pending[0]!;
              const result = yield* Effect.result(c.ring(next.stream, next.after));
              expect(c.read().waits.length).toBeLessThan(pending.length);

              if (Result.isFailure(result)) {
                expect(result.failure).toMatchObject({ _tag: "SinkError", reason: "storage" });
                const failed = Schema.decodeUnknownSync(Schema.Struct({ held: Schema.Int }))(result.failure);
                expect(failed.held).toBeLessThanOrEqual(2);
              }

              if (failure === "none") {
                expect(Result.isSuccess(result)).toBe(true);

                for (const reply of c.frames.slice(frames)) {
                  expect(reply).toMatchObject({
                    error: { data: { reason: "rate_limited", retryAfter: 42_000 } },
                  });
                }
              } else {
                expect(c.frames).toHaveLength(frames);
                const status = yield* Effect.flip(projectSink.check);
                expect(status).toMatchObject({ _tag: "SinkError", reason: "storage" });
                expect(status.held).toBeLessThanOrEqual(1);
              }

              const current = rows();

              for (const [table, total] of Object.entries(current)) {
                expect(total, table).toBe(before[table]);
              }

              expect(Object.keys(current)).toEqual(Object.keys(before));
              expect(c.saved).toHaveLength(recorded);
              expect(c.archives).toHaveLength(archived);
              expect(w.usedInputs).toEqual(inputs);
              expect(w.deliveries).toEqual(deliveries);
              expect(c.closes).toEqual([]);
            }

            expect(c.frames).toHaveLength(frames + (failure === "none" ? count : 0));
            broken = false;
            yield* projectSink.check.pipe(Effect.ignore);
            expect(yield* projectSink.flush).toEqual({ sent: 0 });
            yield* c.recover.pipe(Effect.ignore);
            yield* c.recover;
            expect(rows()).toEqual(before);
            expect(c.saved).toHaveLength(recorded);
            expect(c.archives).toHaveLength(archived);
            yield* TestClock.setTime(REFUSED_HOUR + HOUR);
            expect(yield* projectSink.sums("gateway.route", REFUSED_HOUR, REFUSED_HOUR + HOUR)).toEqual([
              { _tag: "sum", piece: "gateway.route", hour: REFUSED_HOUR, refused: "rate_limited", count: count + 4 },
            ]);
          }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, sink)))));
        }),
      { arbitrary: { seed: SEED, runs: 50 } },
    );
  }

  it.effect.prop(
    "T843 [secrets] bound: denied bodies leave no rows, record batches, archive bodies, logs or encoded markers (50 runs)",
    {
      count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
      marker: Schema.NonEmptyString.check(Schema.isMaxLength(40)),
      archiveFailure: Schema.Literals(["unreachable", "mismatch"]),
      choices: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(20),
      ),
    },
    ({ count, marker, archiveFailure, choices }) =>
      Effect.gen(function* () {
        const w = yield* world({ rateLimit: { limit: 1, window: 60_000 } });
        const archives: Array<unknown> = [];
        const logs: Array<unknown> = [];
        const archive = Layer.effect(
          Archive,
          Archive.pipe(
            Effect.map((real) => ({
              put: (name: string, body: Uint8Array) => {
                archives.push({ name, body: new TextDecoder().decode(body) });
                return real.put(name, body);
              },
            })),
          ),
        ).pipe(Layer.provide(w.env));
        const markerValue = new TextDecoder().decode(utf8(`t843-private-${marker}-end`));
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          yield* TestClock.setTime(REFUSED_HOUR + 18_000);
          const c = yield* wire(w, d, client, archiveFailure);
          yield* TestClock.setTime(REFUSED_HOUR - 16 * 24 * HOUR);
          yield* c.send("process.send", request("accepted"));
          yield* TestClock.setTime(REFUSED_HOUR + 18_000);
          yield* c.send("process.send", request("accepted"));
          const before = w.usedInputs.length;
          const deliveries = w.deliveries.length;
          const recorded = c.saved.length;
          let first: unknown;

          for (let n = 0; n <= count; n++) {
            const now = c.read();
            expect(now._tag).toBe("online");
            const moves = now._tag === "online" && !now.busy ? ["send", "read", "stamped", "unknown"] : ["send"];
            const move = moves[choices[n % choices.length]! % moves.length]!;
            const method = move === "read" ? "ledger.wait" : move === "unknown" ? "missing.method" : "process.send";
            const params =
              move === "read"
                ? { stream: markerValue, after: 0 }
                : {
                    ...request(`denied-${n}`, comment(markerValue)),
                    pid: n % 2 ? OTHER_PROCESS : PROCESS,
                    ...(move === "stamped" ? { by: markerValue } : {}),
                  };
            yield* c.send(method, params);
            expect(c.frames.at(-1)).toMatchObject({ error: { data: { reason: "rate_limited", retryAfter: 42_000 } } });
            const counts = [...w.databases(), ["connection", c.db] as const].map(([name, db]) => [
              name,
              Object.entries(allObjectRows(db)).map(([table, rows]) => [table, rows.length]),
            ]);
            first ??= counts;
            expect(counts).toEqual(first);
            expect(w.usedInputs).toHaveLength(before);
            expect(w.deliveries).toHaveLength(deliveries);
            expect(c.saved).toHaveLength(recorded);
            expect(c.closes).toEqual([]);
          }

          yield* SpanSink.use((sink) => sink.flush);
          const batches = yield* RecordManager.use((records) => Stream.runCollect(records.read({ _tag: "spans" })));
          yield* TestClock.adjust("16 days");
          yield* SpanSink.use((sink) => sink.summaries(REFUSED_HOUR, REFUSED_HOUR + HOUR));
          const outputs = JSON.stringify({
            sql: [...w.databases(), ["connection", c.db] as const].map(([name, db]) => [name, allObjectRows(db)]),
            batches,
            archives: [...archives, ...c.archives],
            connectionBatches: c.saved,
            answers: c.frames,
            logs,
          });

          for (const form of [
            markerValue,
            JSON.stringify(markerValue).slice(1, -1),
            JSON.stringify(JSON.stringify(markerValue).slice(1, -1)).slice(1, -1),
            encodeURIComponent(markerValue),
            encodeURIComponent(JSON.stringify(markerValue)),
            Buffer.from(markerValue).toString("base64"),
            Buffer.from(markerValue).toString("base64url"),
          ]) {
            expect(outputs).not.toContain(form);
          }

          expect(yield* SpanSink.use((sink) => sink.sums("gateway.route", REFUSED_HOUR, REFUSED_HOUR + HOUR))).toEqual([
            { _tag: "sum", piece: "gateway.route", hour: REFUSED_HOUR, refused: "rate_limited", count: count + 1 },
          ]);
          expect(
            c.db
              .prepare("SELECT piece,hour,refused,count FROM sums WHERE refused='rate_limited' ORDER BY piece")
              .all()
              .map((row) => ({ ...row })),
          ).toEqual([
            { piece: "connection.frame", hour: REFUSED_HOUR, refused: "rate_limited", count: count + 1 },
            { piece: "runtime.rpc", hour: REFUSED_HOUR, refused: "rate_limited", count: count + 1 },
          ]);
        }).pipe(
          Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, archive)))),
          Effect.provide(
            Logger.layer([
              Logger.make((entry) => {
                logs.push(entry);
              }),
            ]),
          ),
        );
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
});

// Compile-only law: a client cannot choose the connection whose state these calls change.
const plainConnectionTypeLaw = (door: typeof Gateway.Service, wire: string) => {
  // @ts-expect-error challenge requires a ConnectionId minted by the door or host
  const challenge = door.challenge(wire);
  // @ts-expect-error hello requires a ConnectionId minted by the door or host
  const hello = door.initialize(wire, {}, { url: URL, tab: wire, name: wire });
  // @ts-expect-error disconnect requires a ConnectionId minted by the door or host
  const disconnect = door.disconnect(wire);
  return [challenge, hello, disconnect];
};

void plainConnectionTypeLaw;

const entries = (stream: string) => Ledger.use((l: typeof Ledger.Service) => Stream.runCollect(l.read(stream, 0)));

const stamped = () => entries("gateway/inputs");

const rawRows = (db: DatabaseSync, stream: string) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entries'").get()
    ? db.prepare("SELECT * FROM entries WHERE stream=? ORDER BY rev").all(stream)
    : [];

const request = (letter: string, m: unknown = comment()) => ({
  pid: PROCESS,
  letter,
  m,
  sentAt: SENT,
  seen: 0,
});

const HOUR = 3_600_000;
const REFUSED_HOUR = 1_790_002_800_000;

const SpoofedWrite = Schema.Struct({
  method: Schema.Union([Schema.Literal("process.send"), Schema.String]),
  key: Schema.Literals(["id", "by", "for", "arrivedAt"]),
  inner: Schema.Boolean,
  value: Schema.Union([Schema.Json, Schema.Undefined]),
  marker: Schema.String,
});

const GoodWrite = Schema.Struct({ letter: Schema.NonEmptyString, id: Schema.String, text: Schema.String });

const WriteMix = Schema.Array(
  Schema.Struct({
    spoof: Schema.Boolean,
    hour: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
    write: SpoofedWrite,
    text: Schema.String,
  }),
).check(Schema.isMinLength(1), Schema.isMaxLength(30));

const spoofedParams = (write: typeof SpoofedWrite.Type, letter: string) => {
  const marker = `t844-forged:${write.marker}`;
  const m = {
    ...comment(marker),
    ...(write.inner && write.method === "process.send" ? { [write.key]: write.value } : {}),
  };
  return {
    ...request(letter, m),
    marker,
    ...(!write.inner || write.method !== "process.send" ? { [write.key]: write.value } : {}),
  };
};

const allObjectRows = (db: DatabaseSync): Record<string, Array<Record<string, unknown>>> =>
  Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map(({ name }) => [String(name), db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all()]),
  );

const online = Effect.fnUntraced(function* (
  d: typeof Gateway.Service,
  w: World,
  label: string = "w1",
  k: World["window"] = w.window,
) {
  const client = yield* d.connect();
  const nonce = yield* d.challenge(client);
  const tab = `tab-${label}`;
  const signed = yield* k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`);
  const hello = {
    versions: [1, 2],
    has: ["verify", "seal"],
    ping: "30s",
    key: k.raw,
    tab,
    nonce,
    platform: "browser",
    os: "ios",
    sentAt: SENT,
    signed,
  };
  const result = yield* d.initialize(client, hello, { url: URL, tab, name: k.fingerprint });
  expect(result._tag).toBe("online");
  return { nonce, hello, client };
});

const grantWindow = Effect.fnUntraced(function* (
  d: typeof Gateway.Service,
  w: World,
  client: string = "w2",
  as: "window" | "agent" = "window",
) {
  const k = as === "window" ? w.otherWindow : w.agent;
  const grant = {
    id: `grant-${client}`,
    key: k.raw,
    for: PERSON,
    to: "project-a",
    as,
    saw: SAW,
    sentAt: SENT,
  };
  const text = grantText(grant),
    armored = yield* w.root.sign(text);
  expect((yield* d.grant({ text, armored }))._tag).toBe("applied");
  return yield* online(d, w, client, k);
});

const writeId = (id: string, effect: ReturnType<typeof Gateway.Service.signer>) =>
  effect.pipe(Effect.provideService(SignRequest, { id }));

const failSessionRecord = (inner: ReturnType<typeof nodeSql>) => {
  let armed = true;
  const sql = {
    ...inner,
    exec: (...args: Parameters<typeof inner.exec>) => {
      if (armed && args[0] === "INSERT INTO gateway_sessions (parent,saved) VALUES (?,?)") {
        armed = false;
        throw new Error("SQLITE_FULL");
      }

      return inner.exec(...args);
    },
  };
  return { sql, failed: () => !armed };
};

const device = Effect.fnUntraced(function* (
  d: typeof Gateway.Service,
  w: World,
  k: World["otherRoot"] = w.otherRoot,
  window: World["otherWindow"] = w.otherWindow,
) {
  const text = addText({
    id: `device-${k.raw}`,
    for: PERSON,
    to: "project-a",
    adds: Adds.cases.person.make({ key: k.line, window: window.raw }),
    drops: [],
    saw: ADD_SAW,
    sentAt: SENT,
  });
  expect((yield* d.grant({ text, armored: yield* w.root.sign(text) }))._tag).toBe("applied");
});

const sheet = Effect.fnUntraced(function* (d: typeof Gateway.Service, w: World) {
  const text = addText({
    id: "sheet",
    for: PERSON,
    to: "project-a",
    adds: Adds.cases.recovery.make({ key: w.sheet.line, v: 1 }),
    drops: [],
    saw: { ...ADD_SAW, method: "sheet", typed: true, kept: "print" },
    sentAt: SENT,
  });
  expect((yield* d.grant({ text, armored: yield* w.root.sign(text) }))._tag).toBe("applied");
});

const enrolled = Effect.fnUntraced(function* (
  d: typeof Gateway.Service,
  w: World,
  id: string = "passkey-device",
  signer: World["root"] = w.root,
) {
  const sk = yield* passkey(),
    freshWindow = yield* key();
  const binding = { id, for: PERSON, to: "project-a", key: sk.line, window: freshWindow.raw };
  const nonce = yield* d.enrollment(binding);
  const proof = yield* sk.sign(enrollmentText({ ...binding, nonce }));
  const add = {
    id,
    for: PERSON,
    to: "project-a",
    adds: Adds.cases.person.make({
      key: sk.line,
      window: freshWindow.raw,
      passkey: {
        credential: "public-test-credential",
        nonce,
        proof: proof.armored,
        rp: proof.passkey.rp,
        origin: proof.passkey.origin,
        be: true,
        bs: true,
      },
    }),
    drops: [],
    saw: { ...ADD_SAW, method: signer === w.sheet ? "recovery" : "device" },
    sentAt: SENT,
  } satisfies typeof Add.Type;
  const text = addText(add),
    armored = yield* signer.sign(text);
  return { sk, freshWindow, binding, nonce, add, text, armored, proof };
});

describe("P10 review regressions", () => {
  const signedHello = Effect.fnUntraced(function* (d: typeof Gateway.Service, k: World["window"], tab: string) {
    const client = yield* d.connect();
    const nonce = yield* d.challenge(client);
    const hello = {
      versions: [1, 2],
      has: [],
      ping: "30s",
      key: k.raw,
      tab,
      nonce,
      platform: "browser",
      os: "ios",
      sentAt: SENT,
      signed: yield* k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
    };
    const trusted = { url: URL, tab, name: k.fingerprint };
    return { client, hello, trusted };
  });
  const pendingHello = Effect.fnUntraced(function* (d: typeof Gateway.Service, k: World["window"], tab: string) {
    const { client, hello, trusted } = yield* signedHello(d, k, tab);
    expect(yield* d.initialize(client, hello, trusted)).toMatchObject({
      _tag: "refused",
      reason: "not_granted",
    });
    return { client, hello, trusted };
  });

  // d1: for any waiting clients and any knock order, with repeat knocks and a second tab of the
  // same key, each knock answers exactly its own row's code and until, read back from the
  // owner's watch at that moment. Four keys and up to eight tabs against a cap of three, so
  // rows fall out and the oldest pending connections are pruned: a pruned one is refused
  // not_waiting, never handed a row. Plants: return all rows; return the first row; give a
  // second tab of a key its own row.
  it("d1: any knock order answers each knock with only its own row's code and until", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            keyIndex: fc.nat(3),
            tab: fc.nat(1),
            pass: fc.oneof(fc.constant(undefined), fc.constant(null), fc.string()),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (knocks) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const w = yield* world();
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const owner = yield* online(d, w);
                const keys = [w.otherWindow, w.agent, w.otherRoot, w.sheet] as const;
                const clients = new Map<string, Effect.Success<ReturnType<typeof d.connect>>>();

                for (const { keyIndex, tab, pass } of knocks) {
                  const k = keys[keyIndex]!;
                  const name = `${keyIndex}-${tab}`;
                  const client = clients.get(name) ?? (yield* pendingHello(d, k, `tab-${name}`)).client;
                  clients.set(name, client);
                  // The door keeps the newest `most` pending connections.
                  const kept = [...clients.keys()].slice(-w.settings.waiting.most);
                  const label = `browser ${keyIndex}`;
                  const reply = yield* d.knock(client, pass === undefined ? { label } : { label, pass });

                  if (!kept.includes(name)) {
                    expect(reply).toEqual({ _tag: "refused", reason: "not_waiting" });
                    continue;
                  }

                  const rows = (yield* d.watch(owner.client)).rows;
                  // One row per key: a second tab of a key joins that key's row, never a new one.
                  expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
                  const row = rows.find((r) => r.key === k.raw);
                  assert(row);
                  expect(reply).toEqual({ _tag: "ok", result: { code: row.code, until: row.until } });
                }
              }).pipe(w.provide);
            }),
          ),
      ),
      runs(25),
    );
  });

  // d2: for any unknown key and any tab, the checked hello's not_granted refusal carries that
  // caller's own fingerprint. Plant: refuse without the fingerprint.
  it("d2: any unknown key is refused with its own fingerprint", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), (tab) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const w = yield* world();
            const stranger = yield* key();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client, hello, trusted } = yield* signedHello(d, stranger, tab);
              expect(yield* d.initialize(client, hello, trusted)).toEqual({
                _tag: "refused",
                reason: "not_granted",
                fingerprint: stranger.fingerprint,
              });
            }).pipe(w.provide);
          }),
        ),
      ),
      runs(25),
    );
  });

  // d3: for every Uint32 n that getRandomValues gives, the waiting code is six digits, n's last
  // six, with leading zeros kept: String(n % 1_000_000).padStart(6, "0"). Plants: keep four
  // digits (the code on main before PR 516); drop the zero padding; keep seven digits. The
  // property covers leading zeros by itself, so no small value is pinned.
  it("d3: any random Uint32 gives a six-digit waiting code with its leading zeros", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 0xffffffff }), (random) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const owner = yield* online(d, w);
              const pending = yield* pendingHello(d, w.otherWindow, "code");
              const original = crypto.getRandomValues.bind(crypto);
              const rng = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
                if (array instanceof Uint32Array && array.length === 1) {
                  array[0] = random;
                  return array;
                }

                return original(array);
              });
              const reply = yield* d
                .knock(pending.client, { label: "Code browser" })
                .pipe(Effect.ensuring(Effect.sync(() => rng.mockRestore())));
              const code = String(random % 1_000_000).padStart(6, "0");
              expect(code).toMatch(/^[0-9]{6}$/);
              expect((yield* d.watch(owner.client)).rows.map((r) => r.code)).toEqual([code]);
              expect(reply).toMatchObject({ _tag: "ok", result: { code } });
            }).pipe(w.provide);
          }),
        ),
      ),
      // pinned: 4294967295, the largest Uint32, must give 967295. In PR 516's round 1 mutation
      // step, a .slice(-7) planted by hand survived, because no case had more than six digits.
      { ...runs(30), examples: [[4294967295]] },
    );
  });

  // crypto: for each of the five WebCrypto edges and any failure (a rejection or a throw, of any
  // value), the call fails with that edge's crypto error, never storage, keeps the thrown value in
  // its cause chain, and delivers nothing. The nonce edges fail with GatewayError reason Crypto;
  // the fingerprint digest runs in the membership check, so it fails with SessionManagerError
  // reason Membership around the gateway's LedgerError "crypto"; the input hash is still
  // LedgerError "crypto". Plant: map a WebCrypto failure to storage (or NotGranted) at any edge.
  type Armed = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  // The spied WebCrypto call fails once, by a throw or a rejection, with the generated value.
  type Spy = {
    mockImplementationOnce: (fn: () => never) => unknown;
    mockRejectedValueOnce: (value: unknown) => unknown;
    mockRestore: () => void;
  };
  const failOnce = (spy: Spy, thrown: unknown, sync: boolean) =>
    sync
      ? spy.mockImplementationOnce(() => {
          throw thrown;
        })
      : spy.mockRejectedValueOnce(thrown);
  type Edge = {
    readonly name: string;
    readonly spy: () => Spy;
    readonly fail: (w: World, armed: Armed) => Effect.Effect<unknown, unknown>;
    readonly refused: (failure: unknown, thrown: unknown) => void;
  };
  const gatewayCrypto = (failure: unknown, thrown: unknown) => {
    assert(failure instanceof GatewayError);
    expect(failure).toMatchObject({ _tag: "GatewayError", reason: { _tag: "Crypto" } });
    expect(failure.reason.cause).toBe(thrown);
  };
  const ledgerCrypto = (failure: unknown) => {
    expect(failure).toBeInstanceOf(LedgerError);
    expect(failure).toMatchObject({ _tag: "LedgerError", reason: "crypto" });
  };
  const membershipCrypto = (failure: unknown, thrown: unknown) => {
    assert(failure instanceof SessionManagerError);
    expect(failure).toMatchObject({
      _tag: "SessionManagerError",
      reason: { _tag: "Membership", cause: { _tag: "LedgerError", reason: "crypto" } },
    });
    assert(failure.reason.cause instanceof LedgerError);
    expect(failure.reason.cause.cause).toBe(thrown);
  };
  const edges: ReadonlyArray<Edge> = [
    {
      name: "importKey",
      spy: () => vi.spyOn(crypto.subtle, "importKey"),
      fail: (w: World, armed: Armed) => armed(Gateway.pipe(w.provide)),
      refused: gatewayCrypto,
    },
    {
      name: "nonce sign",
      spy: () => vi.spyOn(crypto.subtle, "sign"),
      fail: (w: World, armed: Armed) =>
        Effect.gen(function* () {
          const d = yield* Gateway;
          const client = yield* d.connect();
          return yield* armed(d.challenge(client));
        }).pipe(w.provide),
      refused: gatewayCrypto,
    },
    {
      name: "nonce verify",
      spy: () => vi.spyOn(crypto.subtle, "verify"),
      fail: (w: World, armed: Armed) =>
        Effect.gen(function* () {
          const d = yield* Gateway;
          const { client, hello, trusted } = yield* signedHello(d, w.window, "crypto-failed");
          return yield* armed(d.initialize(client, hello, trusted));
        }).pipe(w.provide),
      refused: gatewayCrypto,
    },
    {
      name: "fingerprint digest",
      spy: () => vi.spyOn(crypto.subtle, "digest"),
      fail: (w: World, armed: Armed) =>
        Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          yield* d.route(client, "process.send", request("before-crypto-failed"));
          const parent = w.deliveries[0]!.envelope.id;
          return yield* armed(writeId("crypto-failed", d.signer(parent, PROCESS, "saved")));
        }).pipe(w.provide),
      refused: membershipCrypto,
    },
    {
      // The first digest is the caller's fingerprint, which runs as it is; the second hashes
      // the input.
      name: "input hash digest",
      spy: () => {
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        return vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(digest);
      },
      fail: (w: World, armed: Armed) =>
        Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          return yield* armed(d.route(client, "process.send", request("digest-failed")));
        }).pipe(w.provide),
      refused: ledgerCrypto,
    },
  ];

  for (const edge of edges) {
    it(`a WebCrypto ${edge.name} failure, of any value, is refused with crypto and delivers nothing`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.anything(),
            fc.string().map((message) => new Error(message)),
            fc.constantFrom(undefined, null, "crypto unavailable"),
          ),
          fc.boolean(),
          (thrown, sync) =>
            Effect.runPromise(
              Effect.gen(function* () {
                const w = yield* world();
                // Armed only around the call under test, so setup's own WebCrypto runs as it is.
                let before = -1;
                let restore = () => {};
                const armed: Armed = (effect) =>
                  Effect.sync(() => {
                    before = w.deliveries.length;
                    const spy = edge.spy();
                    restore = () => spy.mockRestore();
                    failOnce(spy, thrown, sync);
                  }).pipe(Effect.andThen(effect));
                const failure = yield* Effect.flip(edge.fail(w, armed)).pipe(
                  Effect.ensuring(Effect.sync(() => restore())),
                );
                edge.refused(failure, thrown);
                expect(w.deliveries).toHaveLength(before);
              }),
            ),
        ),
        runs(15),
      );
    });
  }

  it.effect.prop(
    "review 3.1: a full spent-receipt store writes nothing and keeps live nonces spent",
    { generated: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 8 })) },
    ({ generated }) =>
      Effect.forEach(
        [2, generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world({ spentCap: value });
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const earlier = yield* online(d, w, "earlier");
              yield* d.disconnect(earlier.client);
              yield* pendingHello(d, w.otherWindow, "fill-cap");
              const receipts = () => w.sql.exec("SELECT nonce,until FROM gateway_spent ORDER BY nonce");

              for (let n = 2; n < value; n++) {
                yield* pendingHello(d, w.otherWindow, `fill-${n}`);
              }

              const full = receipts();
              expect(full).toHaveLength(w.settings.spentCap);
              expect(full).toContainEqual(expect.objectContaining({ nonce: earlier.nonce }));
              const overflow = yield* signedHello(d, w.agent, "overflow");
              const before = w.sql.exec("SELECT total_changes() total")[0]?.total;
              const result = yield* Effect.result(d.initialize(overflow.client, overflow.hello, overflow.trusted));
              expect.soft(result).toMatchObject({
                _tag: "Failure",
                // A full store is the gateway's own fault, with no lower one beneath it.
                failure: { _tag: "GatewayError", reason: { _tag: "Storage", cause: undefined } },
              });
              expect.soft(w.sql.exec("SELECT total_changes() total")[0]?.total).toBe(before);
              expect.soft(receipts()).toEqual(full);
              yield* TestClock.adjust(w.settings.waiting.ttl - 1);
              const beforeReplay = w.sql.exec("SELECT total_changes() total")[0]?.total;
              expect(
                yield* d.initialize(earlier.client, earlier.hello, {
                  url: URL,
                  tab: earlier.hello.tab,
                  name: w.window.fingerprint,
                }),
              ).toMatchObject({ _tag: "refused", reason: "bad_nonce" });
              expect(w.sql.exec("SELECT total_changes() total")[0]?.total).toBe(beforeReplay);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect("review 3.3: two connections receive different door-minted ids", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const door: typeof d & {
          readonly connect?: () => Effect.Effect<Parameters<typeof d.challenge>[0]>;
        } = d;
        assert(door.connect, "Gateway.connect must mint a connection id without client input");
        const first = yield* door.connect();
        const second = yield* door.connect();
        expect(first).toBeTypeOf("string");
        expect(first.length).toBeGreaterThan(0);
        expect(second).toBeTypeOf("string");
        expect(second.length).toBeGreaterThan(0);
        expect(second).not.toBe(first);
        yield* d.challenge(first);
        yield* d.challenge(second);
      }).pipe(w.provide);
    }),
  );

  it.effect("review 2.2: a live unknown hello stays spent after a direct key grant before expiry", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        const saved = yield* pendingHello(d, w.otherWindow, "pending");
        expect((yield* d.watch(client)).rows).toEqual([]);
        yield* TestClock.adjust(w.settings.waiting.ttl - 1);
        const text = grantText({
          id: "approve-key-without-knock",
          key: w.otherWindow.raw,
          for: PERSON,
          to: "project-a",
          as: "window",
          saw: SAW,
          sentAt: SENT,
        });
        expect((yield* d.grant({ text, armored: yield* w.root.sign(text) }))._tag).toBe("applied");
        expect(w.notices).toEqual([]);
        expect(w.sql.exec("SELECT name FROM gateway_state WHERE name=?", `client/${saved.client}`)).toHaveLength(1);
        const before = yield* entries("gateway/hellos");
        expect(yield* d.initialize(saved.client, saved.hello, saved.trusted)).toMatchObject({
          _tag: "refused",
        });
        expect(yield* entries("gateway/hellos")).toEqual(before);
        yield* online(d, w, "fresh-proof", w.otherWindow);
      }).pipe(w.provide);
    }),
  );

  it.effect("review 2.1: a verified waiting client can knock again after a stranger challenge flood", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        const pending = yield* pendingHello(d, w.otherWindow, "pending");
        expect((yield* d.knock(pending.client, { label: "Pending" }))._tag).toBe("ok");
        const before = (yield* d.watch(client)).rows;
        expect(before).toHaveLength(1);

        for (let i = 0; i <= w.settings.waiting.most; i++) {
          yield* d.challenge(yield* d.connect());
        }

        expect((yield* d.knock(pending.client, { label: "Pending" }))._tag).toBe("ok");
        expect((yield* d.watch(client)).rows).toEqual(before);
      }).pipe(w.provide);
    }),
  );

  for (const attack of ["challenge only", "bad signature"] as const) {
    it.effect.prop(
      `review 2.1: a stranger flood with ${attack} makes no storage writes`,
      { generated: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16 })) },
      ({ generated }) =>
        Effect.forEach(
          [0, generated],
          (value) =>
            Effect.gen(function* () {
              const w = yield* world();
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                yield* online(d, w);
                const before = w.sql.exec("SELECT total_changes() total")[0]?.total;

                for (let i = 0; i <= w.settings.waiting.most + value; i++) {
                  const client = yield* d.connect();
                  const nonce = yield* d.challenge(client);

                  if (attack === "bad signature") {
                    expect(
                      yield* d.initialize(
                        client,
                        {
                          versions: [1],
                          has: [],
                          ping: "30s",
                          key: w.otherWindow.raw,
                          tab: client,
                          nonce,
                          platform: "browser",
                          os: "ios",
                          sentAt: SENT,
                          signed: "not-an-sshsig",
                        },
                        { url: URL, tab: client, name: w.otherWindow.fingerprint },
                      ),
                    ).toMatchObject({ _tag: "refused", reason: "bad_signature" });
                  }
                }

                expect(w.sql.exec("SELECT total_changes() total")[0]?.total).toBe(before);
              }).pipe(w.provide);
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  for (const source of ["forged", "another door key"] as const) {
    it.effect.prop(
      `p26: a nonce from ${source} is refused before any write`,
      { generated: Hello.fields.tab },
      ({ generated }) =>
        Effect.forEach(
          ["unissued", generated],
          (value) =>
            Effect.gen(function* () {
              const w = yield* world();
              const other = yield* world();
              const client = yield* Gateway.use((d) => d.connect()).pipe(other.provide);
              const tab = value;
              const foreign = yield* Gateway.use((d) => d.challenge(client)).pipe(other.provide);
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                yield* online(d, w);
                const issued = yield* d.challenge(client);
                const nonce = source === "forged" ? `${issued[0] === "a" ? "b" : "a"}${issued.slice(1)}` : foreign;
                expect(nonce).not.toBe(issued);
                const signed = yield* w.window.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`);
                expect(
                  yield* checkSshsig({
                    text: `fabrika-hello\n${URL}\n${tab}\n${nonce}`,
                    armored: signed,
                    space: SPACE,
                    signers: [w.window.line],
                  }),
                ).toEqual({ signer: w.window.line });
                const before = w.sql.exec("SELECT total_changes() total")[0]?.total;
                expect(
                  yield* d.initialize(
                    client,
                    {
                      versions: [1, 2],
                      has: [],
                      ping: "30s",
                      key: w.window.raw,
                      tab,
                      nonce,
                      platform: "browser",
                      os: "ios",
                      sentAt: SENT,
                      signed,
                    },
                    { url: URL, tab, name: w.window.fingerprint },
                  ),
                ).toMatchObject({ _tag: "refused", reason: "bad_nonce" });
                expect(w.sql.exec("SELECT total_changes() total")[0]?.total).toBe(before);
              }).pipe(w.provide);
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect("review 2.4: a closed online connection retires its client and key rows", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        const closed = yield* online(d, w, "closed");
        const rows = () =>
          w.sql.exec(
            "SELECT name FROM gateway_state WHERE name IN (?,?)",
            `client/${closed.client}`,
            `key/${closed.client}`,
          );
        expect(rows()).toHaveLength(2);
        assert(
          "disconnect" in d && typeof d.disconnect === "function",
          "Gateway.disconnect must handle a closed connection",
        );
        yield* d.disconnect(closed.client);
        expect(rows()).toEqual([]);
        expect((yield* d.route(closed.client, "ledger.read", { stream: "empty", after: 0 }))._tag).toBe("refused");
        expect((yield* d.route(client, "ledger.read", { stream: "empty", after: 0 }))._tag).toBe("ok");
      }).pipe(w.provide);
    }),
  );

  for (const [method, params, answer] of [
    ["ledger.read", { stream: "empty", after: 0 }, "ok"],
    ["ledger.wait", { stream: "empty", after: 0 }, "parked"],
    ["spans.read", { chain: Chain.cases.job.make({ process: PROCESS }), after: 0 }, "ok"],
    ["unknown.method", {}, "refused"],
  ] as const) {
    it.effect(`review 2: an agent can repeat ${method} beyond inputCap without exhausting authority`, () =>
      Effect.gen(function* () {
        const w = yield* world({ inputCap: 2 });
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          const reader = yield* grantWindow(d, w, "reader", "agent");
          const attempts = yield* Effect.forEach(
            Array.from({ length: w.settings.inputCap + 2 }, (_, i) => i),
            () => Effect.exit(d.route(reader.client, method, params)),
            { concurrency: 1 },
          );

          for (const attempt of attempts) {
            expect(attempt).toMatchObject({ _tag: "Success", value: { _tag: answer } });
          }

          expect(w.sql.exec("SELECT count(*) total FROM gateway_bindings")[0]?.total).toBe(0);

          for (let i = 0; i < w.settings.inputCap; i++) {
            expect((yield* d.route(client, "process.send", request(`after-reads-${i}`)))._tag).toBe("ok");
          }

          expect((yield* d.route(reader.client, method, params))._tag).toBe(answer);
        }).pipe(w.provide);
      }),
    );
  }

  for (const limit of ["cap", "expiry"] as const) {
    it.effect(`review 2: restarted connections and their keys obey the waiting ${limit}`, () =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          const count = () =>
            Number(
              w.sql.exec("SELECT count(*) total FROM gateway_state WHERE name LIKE 'client/%' OR name LIKE 'key/%'")[0]
                ?.total ?? 0,
            );
          const before = count();
          const total = limit === "cap" ? w.settings.waiting.most * 2 + 1 : w.settings.waiting.most;

          for (let i = 0; i < total; i++) {
            const stranger = yield* online(d, w, `stranger-${i}`);
            yield* d.challenge(stranger.client);
          }

          if (limit === "expiry") {
            yield* TestClock.adjust(w.settings.waiting.ttl);
            yield* d.watch(client);
          }

          expect(count() - before).toBeLessThanOrEqual(limit === "cap" ? 2 * w.settings.waiting.most : 0);
          expect((yield* d.route(client, "ledger.read", { stream: "empty", after: 0 }))._tag).toBe("ok");
        }).pipe(w.provide);
      }),
    );
  }

  it.effect.prop(
    "review 5: an added Ed25519 person cannot carry an unverified passkey block",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["made-up-credential", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              const before = yield* entries("gateway/access");
              const text = addText({
                id: "ed25519-with-passkey-claims",
                for: PERSON,
                to: "project-a",
                adds: Adds.cases.person.make({
                  key: w.otherRoot.line,
                  window: w.otherWindow.raw,
                  passkey: {
                    credential: value,
                    nonce: "never-issued",
                    proof: "",
                    rp: "attacker.test",
                    origin: "https://attacker.test",
                    be: true,
                    bs: true,
                  },
                }),
                drops: [],
                saw: ADD_SAW,
                sentAt: SENT,
              });
              expect(yield* d.grant({ text, armored: yield* w.root.sign(text) })).toMatchObject({
                _tag: "refused",
                reason: "bad_enrollment",
              });
              expect(yield* entries("gateway/access")).toEqual(before);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  it.effect("review 2.3: a saved hello carries its signed URL and verifies on its own", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        yield* online(d, w);
        const rows = yield* entries("gateway/hellos");
        expect(rows).toHaveLength(1);
        const saved = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ ...Hello.fields, nonce: Schema.String, url: Schema.String }),
        )(rows[0]!.body);
        const blob = Buffer.concat([field("ssh-ed25519"), field(Buffer.from(saved.key, "base64url"))]);
        const line = `ssh-ed25519 ${blob.toString("base64")}`;
        expect(
          yield* checkSshsig({
            text: `fabrika-hello\n${saved.url}\n${saved.tab}\n${saved.nonce}`,
            armored: saved.signed,
            space: SPACE,
            signers: [line],
          }),
        ).toEqual({ signer: line });
      }).pipe(w.provide);
    }),
  );
});

describe("P10 door admission and waiting", () => {
  it.effect("p43: capped oldest-first waiting rows persist and unauthenticated knocks add no audit rows", () =>
    Effect.gen(function* () {
      const w = yield* world();
      const pending = yield* Effect.forEach([0, 1, 2, 3], () => key(), { concurrency: 1 });
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        yield* d.watch(client);
        const before = rawRows(w.db, "gateway/inputs");
        const healthBefore = w.db.prepare("SELECT count(*) n FROM measurements").get()?.n;

        for (const [index, k] of pending.entries()) {
          yield* TestClock.setTime(1000 + index);
          const pendingClient = yield* d.connect(),
            tab = `pending-${index}`,
            nonce = yield* d.challenge(pendingClient);
          const signed = yield* k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`);
          yield* d.initialize(
            pendingClient,
            {
              versions: [1],
              has: [],
              ping: "30s",
              key: k.raw,
              tab,
              nonce,
              platform: "browser",
              os: "ios",
              sentAt: SENT,
              signed,
            },
            { url: URL, tab, name: k.fingerprint },
          );
          yield* d.knock(pendingClient, { label: "Pending" });
        }

        expect(rawRows(w.db, "gateway/inputs")).toEqual(before);
        expect(w.db.prepare("SELECT count(*) n FROM measurements").get()?.n).toBe(healthBefore);
        const rows = (yield* d.watch(client)).rows;
        expect(rows.map((r) => r.key)).toEqual(pending.slice(1).map((k) => k.raw));
        const restarted = w.reopen(nodeSql(open(join(w.dir, "project.db"))));
        yield* Effect.gen(function* () {
          const next = yield* Gateway;
          expect((yield* next.watch(client)).rows).toEqual(rows);
        }).pipe(Effect.provide(restarted));
      }).pipe(w.provide);
    }),
  );
  it.effect("p26/p42/p66: verified initialize records complete hello once, never rank from has", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const h = yield* online(d, w);
        const rows = yield* entries("gateway/hellos");
        expect(rows).toHaveLength(1);
        expect(rows[0]?.body).toMatchObject({
          os: "ios",
          platform: "browser",
          has: ["verify", "seal"],
          versions: [1, 2],
          version: 2,
          tab: "tab-w1",
          nonce: h.nonce,
          signed: h.hello.signed,
          sentAt: SENT,
          location: "test-instance",
          build: "test-build",
        });
        expect(rows[0]?.by).toBe(w.window.fingerprint);
        expect(
          (yield* d.initialize(h.client, h.hello, {
            url: URL,
            tab: "tab-w1",
            name: w.window.fingerprint,
          }))._tag,
        ).toBe("refused");
        expect(yield* entries("gateway/hellos")).toHaveLength(1);
      }).pipe(w.provide);
    }),
  );

  for (const kind of ["unknown", "bad signature", "no version", "wrong name"] as const) {
    it.effect.prop(
      `p26: ${kind} on an empty project cannot found or grow the sink`,
      { generated: Hello.fields.tab },
      ({ generated }) =>
        Effect.forEach(
          ["tab", generated],
          (value) =>
            Effect.gen(function* () {
              const w = yield* world();
              const stranger = yield* key();
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const k = kind === "unknown" ? stranger : w.window;
                const client = yield* d.connect();
                const nonce = yield* d.challenge(client);
                const signed = yield* k.sign(`fabrika-hello\n${URL}\n${value}\n${nonce}`);
                const hello = {
                  versions: kind === "no version" ? [99] : [1, 2],
                  has: ["verify", "seal"],
                  ping: "30s",
                  key: k.raw,
                  tab: value,
                  nonce,
                  platform: "browser",
                  os: "ios",
                  sentAt: SENT,
                  signed: kind === "bad signature" ? "broken" : signed,
                };
                const answer = yield* d.initialize(client, hello, {
                  url: URL,
                  tab: value,
                  name: kind === "wrong name" ? stranger.fingerprint : k.fingerprint,
                });
                expect(answer).toMatchObject({
                  _tag: "refused",
                  reason: kind === "unknown" ? "not_granted" : kind === "no version" ? "no_version" : "bad_signature",
                });
                expect((yield* d.knock(client, { label: "Pending" }))._tag).toBe(kind === "unknown" ? "ok" : "refused");
                expect(rawRows(w.db, "gateway/access")).toEqual([]);
                expect(rawRows(w.db, "gateway/hellos")).toEqual([]);
                expect(rawRows(w.db, "gateway/inputs")).toEqual([]);
                expect(
                  w.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='measurements'").get()
                    ?.n ?? 0,
                ).toBe(0);
              }).pipe(w.provide);
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect("p43: waiting tabs, cap, expiry and watcher registration survive reopening SQLite", () =>
    Effect.gen(function* () {
      const w = yield* world();
      const pending = yield* key();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        const rowsBefore = (yield* entries("gateway/access")).length;
        yield* d.watch(client);
        const t1 = yield* d.connect(),
          t2 = yield* d.connect();

        for (const [pendingClient, tab] of [
          [t1, "t1"],
          [t2, "t2"],
          [t2, "t2"],
        ] as const) {
          const nonce = yield* d.challenge(pendingClient);
          const signed = yield* pending.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`);
          yield* d.initialize(
            pendingClient,
            {
              versions: [1],
              has: ["verify"],
              ping: "30s",
              key: pending.raw,
              tab,
              nonce,
              platform: "browser",
              os: "ios",
              sentAt: SENT,
              signed,
            },
            { url: URL, tab, name: pending.fingerprint },
          );
          yield* d.knock(pendingClient, { label: "Pending" });
        }

        const waiting = yield* d.watch(client);
        expect(waiting.rows).toHaveLength(1);
        expect(waiting.rows[0]).toMatchObject({ tabs: 2, has: ["verify"] });
        expect((yield* entries("gateway/access")).length).toBe(rowsBefore);
        const reopened = open(join(w.dir, "project.db"));
        const resumed = w.reopen(nodeSql(reopened));
        yield* Effect.gen(function* () {
          const next = yield* Gateway;
          expect((yield* next.watch(client)).rows).toEqual(waiting.rows);
          yield* TestClock.adjust("10 minutes");
          expect((yield* next.watch(client)).rows).toEqual([]);
        }).pipe(Effect.provide(resumed));
      }).pipe(w.provide);
    }),
  );
  it.effect("p43: grant accepts any comparison code, clears all tabs, fresh nonce required", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        const pending = yield* d.connect(),
          pending2 = yield* d.connect();
        const nonce = yield* d.challenge(pending);
        const signed = yield* w.otherWindow.sign(`fabrika-hello\n${URL}\ntab\n${nonce}`);
        const hello = {
          versions: [1],
          has: [],
          ping: "30s",
          key: w.otherWindow.raw,
          tab: "tab",
          nonce,
          platform: "browser",
          os: "ios",
          sentAt: SENT,
          signed,
        };
        yield* d.initialize(pending, hello, {
          url: URL,
          tab: "tab",
          name: w.otherWindow.fingerprint,
        });
        yield* d.knock(pending, { label: "Pending" });
        const nonce2 = yield* d.challenge(pending2),
          signed2 = yield* w.otherWindow.sign(`fabrika-hello\n${URL}\ntab2\n${nonce2}`);
        yield* d.initialize(
          pending2,
          { ...hello, tab: "tab2", nonce: nonce2, signed: signed2 },
          { url: URL, tab: "tab2", name: w.otherWindow.fingerprint },
        );
        yield* d.knock(pending2, { label: "Pending" });
        const grant = {
          id: "any-code",
          key: w.otherWindow.raw,
          for: PERSON,
          to: "project-a",
          as: "window",
          saw: { ...SAW, code: "not-the-shown-code" },
          sentAt: SENT,
        } satisfies typeof Grant.Type;
        const text = grantText(grant);
        expect((yield* d.grant({ text, armored: yield* w.root.sign(text) }))._tag).toBe("applied");
        expect((yield* d.watch(client)).rows).toEqual([]);
        expect(w.notices.some((n) => n.client === pending && JSON.stringify(n.news).includes("client.granted"))).toBe(
          true,
        );
        expect(w.notices.some((n) => n.client === pending2 && JSON.stringify(n.news).includes("client.granted"))).toBe(
          true,
        );
        expect(
          (yield* d.initialize(pending, hello, {
            url: URL,
            tab: "tab",
            name: w.otherWindow.fingerprint,
          }))._tag,
        ).toBe("refused");
        expect((yield* entries("gateway/access")).at(-1)?.body).toMatchObject({
          grant: { saw: { code: "not-the-shown-code" } },
        });
      }).pipe(w.provide);
    }),
  );
});

// Ticket 707: the gateway steps the waiting machine. One generated walk of gateway calls, each
// resolved against what the door holds now: a new tab of a key not yet granted, a repeat knock of
// a tracked connection (pruned ones included), a close, a clock move before, at or after a live
// row's deadline, a grant of a key with or without a row, and, for the second law, a reopen of
// SQLite. After each call the owner's watch is read back and checked against the rows before it.
type WatchRow = Effect.Success<ReturnType<typeof Gateway.Service.watch>>["rows"][number];
type Connection = Effect.Success<ReturnType<typeof Gateway.Service.connect>>;

const DoorMove = fc.record({
  kind: fc.constantFrom("tab", "tab", "knock", "leave", "time", "grant", "reopen"),
  pick: fc.nat(),
  other: fc.nat(),
  when: fc.integer({ min: -1, max: 2 }),
  pass: fc.option(fc.string({ maxLength: 3 }), { nil: undefined }),
});

type DoorMove = typeof DoorMove extends fc.Arbitrary<infer A> ? A : never;

// The saved value's row, field by field in its stored order: its `location` and `tabs`.
const savedRow = (r: WatchRow) => ({
  key: r.key,
  label: r.label,
  location: r.location,
  code: r.code,
  until: r.until,
  tabs: r.tabs,
  clients: r.clients,
  pass: r.pass,
  has: r.has,
  as: r.as,
});

const doorWalk = Effect.fnUntraced(function* (moves: ReadonlyArray<DoorMove>, cuts: boolean) {
  const w = yield* world();
  const { most, ttl } = w.settings.waiting;
  const pool = [
    { k: w.otherWindow, as: "window" },
    { k: w.agent, as: "agent" },
    { k: w.otherRoot, as: "window" },
    { k: w.sheet, as: "window" },
  ] as const;
  const granted = new Set<string>();
  let connections: Array<{ client: Connection; key: string }> = [];
  let owner: Connection | undefined;
  let rows: ReadonlyArray<WatchRow> = [];
  let now = 0,
    made = 0,
    index = 0,
    layer = w.layer;

  for (;;) {
    const done = yield* Effect.gen(function* () {
      const d = yield* Gateway;
      const watch = Effect.fnUntraced(function* () {
        assert(owner);
        const reply = yield* d.watch(owner);
        expect(reply._tag).toBe("watching");
        const flat = reply.rows.map(savedRow);
        // format: watch replies and the saved value keep the stored row bytes, and the saved
        // value keeps its flat rows-and-settings shape under the same gateway_state key.
        expect(JSON.stringify(reply.rows)).toBe(JSON.stringify(flat));
        expect(w.db.prepare("SELECT value FROM gateway_state WHERE name='waiting'").get()?.value).toBe(
          JSON.stringify({ rows: flat, most, ttl }),
        );
        return reply.rows;
      });

      if (owner === undefined) {
        owner = (yield* online(d, w)).client;
        rows = yield* watch();
      } else {
        // A reopened door reads the same rows, written in the old shape, without renewing them.
        expect(yield* watch()).toEqual(rows);
      }

      while (index < moves.length) {
        const move = moves[index++]!;
        const kept = rows.filter((r) => r.until > now);
        const free = pool.filter((p) => !granted.has(p.k.raw));

        if (move.kind === "reopen") {
          if (cuts) {
            return false;
          }

          continue;
        }

        if (move.kind === "time") {
          const row = kept[move.pick % Math.max(1, kept.length)];
          const by = row === undefined || move.when === 2 ? 1 + (move.other % 1000) : row.until - now + move.when;
          yield* TestClock.adjust(by);
          now += by;
          rows = yield* watch();
          expect(rows).toEqual(kept.filter((r) => r.until > now));
          continue;
        }

        if (move.kind === "leave") {
          const connection = connections[move.pick % Math.max(1, connections.length)];

          if (connection === undefined) {
            continue;
          }

          const saved = w.db.prepare("SELECT value FROM gateway_state WHERE name=?").get(`client/${connection.client}`);
          const attached = saved !== undefined && JSON.parse(String(saved.value))._tag === "waiting";
          yield* d.disconnect(connection.client);
          connections = connections.filter((c) => c !== connection);
          rows = yield* watch();
          const row = kept.find((r) => r.key === connection.key && r.clients.includes(connection.client));
          const clients = row?.clients.filter((c) => c !== connection.client) ?? [];
          expect(rows).toEqual(
            !attached || row === undefined
              ? kept
              : clients.length === 0
                ? kept.filter((r) => r !== row)
                : kept.map((r) => (r === row ? { ...row, clients, tabs: clients.length } : r)),
          );
          continue;
        }

        if (move.kind === "grant") {
          const withRow = free.filter((p) => kept.some((r) => r.key === p.k.raw));
          const pick =
            (move.other % 3 === 0 ? undefined : withRow[move.pick % Math.max(1, withRow.length)]) ??
            free[move.pick % Math.max(1, free.length)];

          if (pick === undefined) {
            continue;
          }

          const before = w.notices.length;
          const text = grantText({
            id: `walk-grant-${made++}`,
            key: pick.k.raw,
            for: PERSON,
            to: "project-a",
            as: pick.as,
            saw: SAW,
            sentAt: SENT,
          });
          expect((yield* d.grant({ text, armored: yield* w.root.sign(text) }))._tag).toBe("applied");
          granted.add(pick.k.raw);
          connections = connections.filter((c) => c.key !== pick.k.raw);
          const row = kept.find((r) => r.key === pick.k.raw);
          const told = w.notices
            .slice(before)
            .filter((n) => JSON.stringify(n.news).includes("client.granted"))
            .map((n) => n.client);
          // Every tab of the admitted key, and only those, is told once to answer a fresh nonce.
          expect(told.toSorted()).toEqual([...(row?.clients ?? [])].toSorted());
          rows = yield* watch();
          expect(rows).toEqual(kept.filter((r) => r !== row));
          continue;
        }

        const repeat = move.kind === "knock" ? connections[move.pick % Math.max(1, connections.length)] : undefined;
        const p = free[move.pick % Math.max(1, free.length)];
        let connection = repeat;

        if (connection === undefined) {
          if (p === undefined) {
            continue;
          }

          const tab = `walk-${made++}`;
          const client = yield* d.connect();
          const nonce = yield* d.challenge(client);
          const hello = {
            versions: [1, 2],
            has: [],
            ping: "30s",
            key: p.k.raw,
            tab,
            nonce,
            platform: "browser",
            os: "ios",
            sentAt: SENT,
            signed: yield* p.k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
          };
          expect(yield* d.initialize(client, hello, { url: URL, tab, name: p.k.fingerprint })).toMatchObject({
            _tag: "refused",
            reason: "not_granted",
          });
          connection = { client, key: p.k.raw };
          connections.push(connection);
        }

        const label = `label-${move.other % 3}`;
        const reply = yield* d.knock(
          connection.client,
          move.pass === undefined ? { label } : { label, pass: move.pass },
        );
        rows = yield* watch();

        if (reply._tag === "refused") {
          // Only a pruned connection is refused: a fresh tab is the newest pending connection.
          expect(repeat).toBeDefined();
          expect(reply).toEqual({ _tag: "refused", reason: "not_waiting" });
          expect(rows).toEqual(kept);
          continue;
        }

        const old = kept.find((r) => r.key === connection.key);
        const row = rows.find((r) => r.key === connection.key);
        assert(row);
        expect(reply).toEqual({ _tag: "ok", result: { code: row.code, until: row.until } });

        if (old !== undefined) {
          const clients = old.clients.includes(connection.client) ? old.clients : [...old.clients, connection.client];
          expect(rows).toEqual(kept.map((r) => (r === old ? { ...old, clients, tabs: clients.length } : r)));
          continue;
        }

        expect(row.code).toMatch(/^\d{6}$/);
        expect(rows).toEqual(
          [
            ...kept,
            {
              key: connection.key,
              label,
              location: "test-instance",
              code: row.code,
              until: now + ttl,
              tabs: 1,
              clients: [connection.client],
              pass: move.pass ?? null,
              has: [],
              as: "window",
            },
          ].slice(-most),
        );
      }

      return true;
    }).pipe(Effect.provide(layer));

    if (done) {
      return;
    }

    // An old row: the value as a door before ticket 707 wrote it, by hand, then a fresh door.
    w.db
      .prepare("UPDATE gateway_state SET value=? WHERE name='waiting'")
      .run(JSON.stringify({ rows: rows.map(savedRow), most, ttl }));
    layer = w.reopen(nodeSql(open(join(w.dir, "project.db"))));
  }
});

describe("ticket 707: the gateway steps the waiting machine", () => {
  it("gateway knocks, closes, grants and expiry agree with the saved waiting value", async () => {
    // Plant: omit the `accepted` step after an applied grant. The after-grant rows must fail.
    await fc.assert(
      fc.asyncProperty(fc.array(DoorMove, { minLength: 4, maxLength: 14, size: "max" }), (moves) =>
        Effect.runPromise(doorWalk(moves, false).pipe(Effect.provide(TestClock.layer()))),
      ),
      runs(100),
    );
  });
  it("old saved rows and every reopen cut keep their deadlines, codes, tabs and reply bytes", async () => {
    // Plant: reset `until` while decoding. The reopened watch equality must fail.
    await fc.assert(
      fc.asyncProperty(fc.array(DoorMove, { minLength: 4, maxLength: 14, size: "max" }), (moves) =>
        Effect.runPromise(doorWalk(moves, true).pipe(Effect.provide(TestClock.layer()))),
      ),
      runs(100),
    );
  });
});

describe("P10 signed membership changes", () => {
  it.effect.prop(
    "p42 recovery: the real P9 second fold's ignored result is not turned into applied",
    {
      generated: Add.fields.id.check(Schema.isMinLength(1)).check(Schema.makeFilter((id) => id !== "recovery-loser")),
    },
    ({ generated }) =>
      Effect.forEach(
        ["recovery-winner", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world(),
              winnerKey = yield* key(),
              winnerWindow = yield* key();
            const winner = {
              id: value,
              for: PERSON,
              to: "project-a",
              adds: Adds.cases.person.make({ key: winnerKey.line, window: winnerWindow.raw }),
              drops: [],
              saw: { ...ADD_SAW, method: "recovery" },
              sentAt: SENT,
            } satisfies typeof Add.Type;
            const text = addText(winner),
              armored = yield* w.sheet.sign(text);
            const event = MemberEvent.cases.added.make({
              add: winner,
              signed: { text, armored, signer: w.sheet.line },
            });
            let intervene: Effect.Effect<void, LedgerError> = Effect.void;
            let armed = false;
            const racedLedger = Layer.effect(
              Ledger,
              Ledger.pipe(
                Effect.map((real: typeof Ledger.Service) => ({
                  ...real,
                  append: (...args: Parameters<typeof real.append>) =>
                    Effect.gen(function* () {
                      if (armed && args[1] === "recovery-loser") {
                        armed = false;
                        yield* intervene;
                      }

                      return yield* real.append(...args);
                    }),
                })),
              ),
            ).pipe(Layer.provide(w.env));
            const clients = ClientManagerLedger.layer(w.founder).pipe(Layer.provideMerge(racedLedger));
            const env = Layer.mergeAll(w.env, clients, Mailbox.layer.pipe(Layer.provide(clients)));
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              yield* sheet(d, w);
              const manager = yield* ClientManager;
              intervene = manager
                .write(event, {
                  by: w.sheet.sshFingerprint,
                  for: PERSON,
                  sentAt: SENT,
                  seen: 0,
                  parent: null,
                  traceId: TRACE,
                  build: "test-build",
                })
                .pipe(
                  Effect.tap((result) => Effect.sync(() => expect(result._tag).toBe("applied"))),
                  Effect.asVoid,
                );
              const loser = addText({
                ...winner,
                id: "recovery-loser",
                adds: Adds.cases.person.make({
                  key: w.otherRoot.line,
                  window: w.otherWindow.raw,
                }),
              });
              const signature = yield* w.sheet.sign(loser);
              armed = true;
              const result = yield* d.grant({ text: loser, armored: signature });
              expect(armed).toBe(false);
              expect(result).toMatchObject({ _tag: "ignored", reason: "used" });
              expect(yield* d.grant({ text: loser, armored: signature })).toEqual(result);
              const members = yield* manager.members;
              expect(members.keys.get(winnerKey.line)?.live).toBe(true);
              expect(members.keys.has(w.otherRoot.line)).toBe(false);
            }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(env))));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "p42: a removed signer can resend its exact old event, but cannot change it",
    { generated: Grant.fields.id.check(Schema.isMinLength(1)) },
    ({ generated }) =>
      Effect.forEach(
        ["before-removal", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              yield* device(d, w);
              const grant = {
                id: value,
                key: w.agent.raw,
                for: PERSON,
                to: "project-a",
                as: "agent",
                saw: SAW,
                sentAt: SENT,
              } satisfies typeof Grant.Type;
              const text = grantText(grant),
                armored = yield* w.root.sign(text),
                first = yield* d.grant({ text, armored });
              const revoke = revokeText({
                id: "remove-author",
                key: w.root.line,
                for: PERSON,
                to: "project-a",
                saw: TOOK,
                sentAt: SENT,
              });
              yield* d.grant({ text: revoke, armored: yield* w.otherRoot.sign(revoke) });
              const before = yield* entries("gateway/access");
              expect(yield* d.grant({ text, armored })).toEqual(first);
              expect(yield* entries("gateway/access")).toEqual(before);
              const changed = grantText({ ...grant, key: w.otherWindow.raw });
              expect((yield* d.grant({ text: changed, armored: yield* w.root.sign(changed) }))._tag).toBe("refused");
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "p43/p66: agent watch/deny refuse; window deny records its real writer and saw",
    { generated: Saw },
    ({ generated }) =>
      Effect.forEach(
        [SAW, generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              const agent = yield* grantWindow(d, w, "agent", "agent");
              expect((yield* d.watch(agent.client))._tag).toBe("refused");
              expect(yield* d.deny(agent.client, { key: w.otherWindow.raw })).toMatchObject({
                _tag: "refused",
                reason: "person_only",
              });

              for (const params of [{ key: w.otherWindow.raw }, { key: w.otherWindow.raw, saw: value, by: "forged" }]) {
                expect(yield* d.deny(client, params)).toMatchObject({
                  _tag: "refused",
                  reason: "bad_input",
                });
              }

              const answer = yield* d.route(client, "gateway.deny", {
                key: w.otherWindow.raw,
                saw: value,
              });
              expect(answer).toMatchObject({ _tag: "ok", result: { _tag: "applied" } });
              const last = (yield* entries("gateway/access")).at(-1)!;
              expect(last._tag).toBe("denied");
              expect(last.body).toMatchObject({
                key: w.otherWindow.raw,
                by: w.window.fingerprint,
                saw: value,
              });
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const kind of ["granted", "revoked", "added"] as const) {
    it.effect.prop(
      `p27: ${kind} wrong-to never calls ClientManager.write or founds`,
      { generated: Grant.fields.to.check(Schema.makeFilter((to) => to !== "project-a")) },
      ({ generated }) =>
        Effect.forEach(
          ["project-b", generated],
          (value) =>
            Effect.gen(function* () {
              const w = yield* world();
              const called = vi.fn();
              const clients = Layer.effect(
                ClientManager,
                ClientManager.pipe(
                  Effect.map((real: typeof ClientManager.Service) => ({
                    ...real,
                    write: (...args: Parameters<typeof real.write>) => {
                      called();
                      return real.write(...args);
                    },
                  })),
                ),
              ).pipe(Layer.provide(w.env));
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const text =
                  kind === "granted"
                    ? grantText({
                        id: "wrong-to",
                        key: w.otherWindow.raw,
                        for: PERSON,
                        to: value,
                        as: "window",
                        saw: SAW,
                        sentAt: SENT,
                      })
                    : kind === "revoked"
                      ? revokeText({
                          id: "wrong-to",
                          key: w.window.raw,
                          for: PERSON,
                          to: value,
                          saw: TOOK,
                          sentAt: SENT,
                        })
                      : addText({
                          id: "wrong-to",
                          for: PERSON,
                          to: value,
                          adds: Adds.cases.person.make({
                            key: w.otherRoot.line,
                            window: w.otherWindow.raw,
                          }),
                          drops: [],
                          saw: ADD_SAW,
                          sentAt: SENT,
                        });
                expect(yield* d.grant({ text, armored: yield* w.root.sign(text) })).toMatchObject({
                  _tag: "refused",
                  reason: "wrong_ledger",
                });
                expect(called).not.toHaveBeenCalled();
                expect(yield* entries("gateway/access")).toEqual([]);
              }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, clients)))));
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  for (const signer of ["window", "agent", "otherRoot"] as const) {
    it.effect(`question 19: ${signer} cannot promote itself from platform or capabilities`, () =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          yield* online(d, w);
          yield* grantWindow(d, w, "agent", "agent");
          const grant = {
            id: "self-promote",
            key: w.otherWindow.raw,
            for: PERSON,
            to: "project-a",
            as: "window",
            saw: SAW,
            sentAt: SENT,
          } satisfies typeof Grant.Type;
          const text = grantText(grant),
            before = yield* entries("gateway/access");
          expect(
            (yield* d.grant({
              text,
              armored: yield* w[signer].sign(text),
              platform: "browser",
              has: ["verify"],
            }))._tag,
          ).toBe("refused");
          expect(yield* entries("gateway/access")).toEqual(before);
        }).pipe(w.provide);
      }),
    );
  }

  it.effect("p42: original additive signed text re-verifies; exact resend reuses first placing", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        yield* online(d, w);
        const value = {
          id: "extra-fields",
          key: w.otherWindow.raw,
          for: PERSON,
          to: "project-a",
          as: "window",
          saw: SAW,
          sentAt: SENT,
        } satisfies typeof Grant.Type;
        const text = `${JSON.stringify({ _tag: "granted", grant: value, future: { kept: true } }, null, 2)}\n`;
        const armored = yield* w.root.sign(text);
        const first = yield* d.grant({ text, armored });
        expect(yield* d.grant({ text, armored })).toEqual(first);
        const rows = yield* entries("gateway/access");
        expect(rows.at(-1)?.body).toMatchObject({
          signed: { text, armored, signer: w.root.line },
          grant: { saw: SAW },
        });
        const changed = grantText({ ...value, key: w.agent.raw });
        expect((yield* d.grant({ text: changed, armored: yield* w.root.sign(changed) }))._tag).toBe("refused");
        expect((yield* entries("gateway/access")).length).toBe(rows.length);
      }).pipe(w.provide);
    }),
  );

  for (const mutation of ["text", "namespace", "person"] as const) {
    it.effect.prop(
      `p27: a ${mutation} mismatch writes no membership event`,
      { generated: Grant.fields.id },
      ({ generated }) =>
        Effect.forEach(
          ["bad-sign", generated],
          (value) =>
            Effect.gen(function* () {
              const w = yield* world();
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                yield* online(d, w);
                const text = grantText({
                  id: value,
                  key: w.otherWindow.raw,
                  for: mutation === "person" ? "person_other" : PERSON,
                  to: "project-a",
                  as: "window",
                  saw: SAW,
                  sentAt: SENT,
                });
                const armored = yield* w.root.sign(text, mutation === "namespace" ? "other" : SPACE),
                  before = yield* entries("gateway/access");
                expect((yield* d.grant({ text: mutation === "text" ? `${text} ` : text, armored }))._tag).toBe(
                  "refused",
                );
                expect(yield* entries("gateway/access")).toEqual(before);
              }).pipe(w.provide);
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }
});

describe("P10 inputs, retries and signer", () => {
  it.effect("p67: authenticated reads, parked waits and refusals each keep an input record", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        const before = (yield* stamped()).length;
        expect((yield* d.route(client, "ledger.read", { stream: "empty", after: 0 }))._tag).toBe("ok");
        expect((yield* d.route(client, "ledger.wait", { stream: "empty", after: 0 }))._tag).toBe("parked");
        expect((yield* d.route(client, "unknown.method", {}))._tag).toBe("refused");
        const rows = (yield* stamped()).slice(before);
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map((r) => r.id)).size).toBe(3);

        for (const [index, method] of ["ledger.read", "ledger.wait", "unknown.method"].entries()) {
          expect(rows[index]?._tag).toBe(index === 2 ? "refused" : "received");
          expect(rows[index]?.by).toBe(w.window.fingerprint);
          expect(JSON.stringify(rows[index]?.body)).toContain(method);
        }
      }).pipe(w.provide);
    }),
  );
  it.effect.prop(
    "question 16: caller personOnly claims cannot turn a person's comment into approval",
    { generated: Schema.Json },
    ({ generated }) =>
      Effect.forEach(
        [true, generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              const message = { ...comment(), personOnly: value };
              yield* d.route(client, "process.send", {
                ...request("comment-not-approval", message),
                personOnly: value,
              });
              const parent = w.deliveries[0]!.envelope.id;
              expect(
                yield* Effect.flip(writeId("claimed-approval", d.signer(parent, PROCESS, "answered"))),
              ).toMatchObject({ _tag: "SigningRefused", reason: "person_only" });
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "p67 record retry: a lost input-log append answer keeps the first id, trace and placing",
    { generated: Schema.NonEmptyString.check(Schema.isMaxLength(256)) },
    ({ generated }) =>
      Effect.forEach(
        ["lost-append", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            let lose = false;
            const transaction = Layer.effect(
              LedgerTransaction,
              LedgerTransaction.pipe(
                Effect.map((real) => ({
                  transact: <A>(step: (turn: LedgerTurn) => A) =>
                    Effect.gen(function* () {
                      let appended = false;
                      const placing = yield* real.transact((turn) =>
                        step({
                          ...turn,
                          append: (stream, id, line) => {
                            const placing = turn.append(stream, id, line);

                            if (stream === "gateway/inputs") {
                              appended = true;
                            }

                            return placing;
                          },
                        }),
                      );

                      // Lose the answer only after the real input transaction commits.
                      if (lose && appended) {
                        lose = false;
                        return yield* new LedgerError({ reason: "unreachable" });
                      }

                      return placing;
                    }),
                })),
              ),
            ).pipe(Layer.provide(w.env));
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              lose = true;
              expect(yield* Effect.flip(d.route(client, "process.send", request(value)))).toMatchObject({
                _tag: "LedgerError",
                reason: "unreachable",
              });
              expect(lose).toBe(false);
              expect(w.deliveries).toEqual([]);
              const before = rawRows(w.db, "gateway/inputs").filter((r) => r._tag === "received");
              expect(before).toHaveLength(1);
              yield* d.route(client, "process.send", request(value));
              const after = rawRows(w.db, "gateway/inputs").filter((r) => r._tag === "received");
              expect(after).toEqual(before);
              expect(w.deliveries[0]!.envelope.id).toBe(before[0]?.id);
              expect(w.deliveries[0]!.trace.traceId).toBe(before[0]?.traceId);
            }).pipe(
              Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, transaction)))),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect("trace reason: an agent cannot claim a request never delivered to its process", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        yield* online(d, w);
        const agent = yield* grantWindow(d, w, "agent", "agent");
        expect(
          (yield* d.route(agent.client, "process.send", {
            ...request("forged-trace"),
            traceId: "11111111111111111111111111111111",
          }))._tag,
        ).toBe("refused");
        expect(w.deliveries).toEqual([]);
      }).pipe(w.provide);
    }),
  );
  it.effect("p67: a stamped input has exactly four fields, checked writer and referee time", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        yield* TestClock.setTime(1_790_000_000_000);
        expect((yield* d.route(client, "process.send", request("l1")))._tag).toBe("ok");
        const e = w.deliveries[0]!.envelope;
        expect(Object.keys(e).sort()).toEqual(["arrivedAt", "by", "id", "input"]);
        expect(e.id).toMatch(/^input_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
        expect(Object.values((yield* stamped()).at(-1)!.body ?? {})).toContain(1);
        expect(e.by).toEqual({ _tag: "person", key: w.window.fingerprint, for: PERSON });
        expect(e.arrivedAt).toBe(1_790_000_000_000);
        expect(e.input).toEqual(comment());
      }).pipe(w.provide);
    }),
  );

  // 0140 replaces the old assertion of a stored `refused` input event.
  it.effect.prop(
    "p67 spoof: stamped writes are refused whole before any input id or stored body",
    { write: SpoofedWrite },
    ({ write }) =>
      Effect.gen(function* () {
        const w = yield* world();
        const archives: Array<{ name: string; body: string }> = [];
        const archive = Layer.effect(
          Archive,
          Archive.pipe(
            Effect.map((real) => ({
              put: (name: string, body: Uint8Array) => {
                archives.push({ name, body: new TextDecoder().decode(body) });
                return real.put(name, body);
              },
            })),
          ),
        ).pipe(Layer.provide(w.env));
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          const before = w.usedInputs.length;
          const forged = `t844-forged-value:${write.marker}`;

          // Keep arbitrary values, including undefined, and also mark the forged field itself.
          for (const value of [write.value, forged]) {
            const params = spoofedParams({ ...write, value }, "spoof");
            expect(yield* d.route(client, write.method, params)).toEqual({ _tag: "refused", reason: "reserved" });
            expect(w.deliveries).toEqual([]);
            expect(w.usedInputs.length).toBe(before);
            expect(yield* stamped()).toEqual([]);
            const saved = JSON.stringify([...w.databases()].map(([name, db]) => [name, allObjectRows(db)]));
            expect(saved).not.toContain(`t844-forged:${write.marker}`);
            expect(saved).not.toContain(JSON.stringify(`t844-forged:${write.marker}`).slice(1, -1));
            expect(saved).not.toContain(forged);
            expect(saved).not.toContain(JSON.stringify(forged).slice(1, -1));
          }

          yield* TestClock.adjust("16 days");
          yield* d.route(client, "ledger.read", { stream: "x", after: 0 });
          yield* SpanSink.use((sink) => sink.flush);
          const saved = JSON.stringify({
            databases: [...w.databases()].map(([name, db]) => [name, allObjectRows(db)]),
            archives,
          });

          for (const marker of [`t844-forged:${write.marker}`, forged]) {
            expect(saved).not.toContain(marker);
            expect(saved).not.toContain(JSON.stringify(marker).slice(1, -1));
          }
        }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, archive)))));
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );

  const MalformedStampedWrite = (() => {
    const schema = Input.cases.comment;
    const Broken = Schema.TaggedUnion({
      wrong: {},
      missing: {},
      junk: { reason: Schema.Literals(["wrong", "missing"]) },
    });
    type MessageState = { readonly schema: typeof schema; readonly m: Readonly<Record<string, unknown>> };
    const editMessage = (state: MessageState, edit: typeof Broken.Type): Arbitrary.Arbitrary<MessageState> => {
      const missing = edit._tag === "missing" || (edit._tag === "junk" && edit.reason === "missing");
      const fields = Object.entries(state.schema.fields).filter(
        ([key, field]) =>
          Object.hasOwn(state.m, key) &&
          (!missing || Schema.decodeUnknownResult(Schema.Struct({ [key]: field }))({})._tag === "Failure"),
      );
      assert(fields.length > 0, "the current message must have a field that can be broken");
      return Arbitrary.schema(Schema.Literals(fields.map(([key]) => key))).pipe(
        Arbitrary.flatMap((key) => {
          const field = fields.find(([name]) => name === key)![1];
          const replacement = missing
            ? Arbitrary.Constant(undefined)
            : Arbitrary.schema(SpoofedWrite.fields.value).pipe(
                Arbitrary.filter((value) => Schema.decodeUnknownResult(field)(value)._tag === "Failure"),
              );
          const junk =
            edit._tag === "junk"
              ? Arbitrary.all({
                  key: Arbitrary.schema(Schema.String).pipe(
                    Arbitrary.filter(
                      (key) =>
                        !Object.hasOwn(state.schema.fields, key) &&
                        !Object.hasOwn(state.m, key) &&
                        !Schema.is(SpoofedWrite.fields.key)(key),
                    ),
                  ),
                  value: Arbitrary.schema(Schema.Json),
                })
              : Arbitrary.Constant(null);
          return Arbitrary.all({ value: replacement, junk }).pipe(
            Arbitrary.map(({ value, junk }) => {
              const m = { ...state.m };

              if (missing) {
                delete m[key];
              } else {
                m[key] = value;
              }

              return { schema: state.schema, m: { ...m, ...(junk === null ? {} : { [junk.key]: junk.value }) } };
            }),
          );
        }),
      );
    };
    return Arbitrary.all({
      m: Arbitrary.schema(schema),
      edits: Arbitrary.array(Arbitrary.schema(Broken), { minLength: 1, maxLength: Object.keys(schema.fields).length }),
      key: Arbitrary.schema(SpoofedWrite.fields.key),
      inner: Arbitrary.schema(SpoofedWrite.fields.inner),
      value: Arbitrary.schema(SpoofedWrite.fields.value),
    }).pipe(
      Arbitrary.flatMap(({ m, edits, ...stamp }) =>
        edits
          .reduce(
            (current, edit) => current.pipe(Arbitrary.flatMap((state) => editMessage(state, edit))),
            Arbitrary.Constant<MessageState>({ schema, m }),
          )
          .pipe(Arbitrary.map((state) => ({ ...stamp, m: state.m }))),
      ),
    );
  })();

  it.effect.prop(
    "p67 spoof: malformed stamped process.send spends one budget place, is reserved without a request row and counts once (100 runs)",
    { write: MalformedStampedWrite },
    ({ write }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(REFUSED_HOUR + 1000);
        const w = yield* world();
        const archives: Array<{ name: string; body: string }> = [];
        const archive = Layer.effect(
          Archive,
          Archive.pipe(
            Effect.map((real) => ({
              put: (name: string, body: Uint8Array) => {
                archives.push({ name, body: new TextDecoder().decode(body) });
                return real.put(name, body);
              },
            })),
          ),
        ).pipe(Layer.provide(w.env));
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          const sink = yield* SpanSink;
          yield* sink.flush;
          const snapshot = () => [...w.databases()].map(([name, db]) => [name, allObjectRows(db)] as const);
          const unchangedRows = (databases: ReturnType<typeof snapshot>) =>
            databases.map(([name, tables]) => [
              name,
              Object.fromEntries(
                Object.entries(tables).filter(
                  ([table]) => name !== "object" || (table !== "sums" && table !== "gateway_limits"),
                ),
              ),
            ]);
          const before = snapshot();
          const usedInputs = [...w.usedInputs];
          const deliveries = [...w.deliveries];
          const uploaded = [...archives];
          const beforeSums = before.find(([name]) => name === "object")![1].sums!;
          const target = { piece: "gateway.route", hour: REFUSED_HOUR, refused: "reserved" };
          const had = beforeSums.find(
            (row) => row.piece === target.piece && row.hour === target.hour && row.refused === target.refused,
          );
          const expectedSums =
            had === undefined
              ? [...beforeSums, { ...target, count: 1 }]
              : beforeSums.map((row) => (row === had ? { ...row, count: Number(row.count) + 1 } : row));
          const inner = { ...write.m, [write.key]: write.value };
          expect(Schema.decodeUnknownResult(w.settings.inputs.schema)(write.m)._tag).toBe("Failure");
          expect(Schema.decodeUnknownResult(w.settings.inputs.schema)(inner)._tag).toBe("Failure");
          const params = write.inner
            ? request("t860", inner)
            : { ...request("t860", write.m), [write.key]: write.value };

          expect(yield* d.route(client, "process.send", params)).toEqual({ _tag: "refused", reason: "reserved" });
          yield* sink.flush;
          expect(w.usedInputs).toEqual(usedInputs);
          expect(w.deliveries).toEqual(deliveries);
          const after = snapshot();
          expect(unchangedRows(after)).toEqual(unchangedRows(before));
          const object = after.find(([name]) => name === "object")![1];
          const until = REFUSED_HOUR + w.settings.rateLimit.window;
          expect(object.gateway_limits).toEqual([{ sender: w.window.fingerprint, until, value: expect.any(String) }]);
          expect(
            Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(object.gateway_limits![0]!.value),
          ).toEqual({
            v: 1,
            build: w.settings.build,
            model: {
              _tag: "open",
              policy: w.settings.rateLimit,
              until,
              at: REFUSED_HOUR + 1000,
              used: 1,
            },
          });
          expect(object.sums).toEqual(expectedSums);
          expect(archives).toEqual(uploaded);
          yield* TestClock.setTime(REFUSED_HOUR + HOUR);
          expect(yield* sink.sums("gateway.route", REFUSED_HOUR, REFUSED_HOUR + HOUR)).toEqual([
            { _tag: "sum", ...target, count: 1 },
          ]);
        }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, archive)))));
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );

  it.effect.prop(
    "0140 bound: N stamped writes occupy exactly the rows of one and count N",
    {
      writes: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))).pipe(
        Arbitrary.flatMap((n) => Arbitrary.array(Arbitrary.schema(SpoofedWrite), { minLength: n, maxLength: n })),
      ),
    },
    ({ writes }) =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          yield* TestClock.setTime(REFUSED_HOUR + 1000);
          let first: Record<string, number> | undefined;

          for (const [i, write] of writes.entries()) {
            expect((yield* d.route(client, write.method, spoofedParams(write, `bound-${i}`)))._tag).toBe("refused");
            const counts = Object.fromEntries(
              [...w.databases()].flatMap(([name, db]) =>
                Object.entries(allObjectRows(db)).map(([table, rows]) => [`${name}/${table}`, rows.length]),
              ),
            );
            first ??= counts;
            expect(counts).toEqual(first);
          }

          expect(w.deliveries).toEqual([]);
          expect(w.usedInputs).toEqual([]);
          yield* TestClock.setTime(REFUSED_HOUR + HOUR);
          const sink = yield* SpanSink;
          expect(yield* sink.sums("gateway.route", REFUSED_HOUR, REFUSED_HOUR + HOUR)).toEqual([
            { _tag: "sum", piece: "gateway.route", hour: REFUSED_HOUR, refused: "reserved", count: writes.length },
          ]);
        }).pipe(w.provide);
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  it.effect.prop(
    "0140 hours: only spoofed writes count, in their closed referee hour",
    { mix: WriteMix },
    ({ mix }) =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          const counts = new Map<number, number>();

          for (const [i, write] of mix.entries()) {
            const hour = REFUSED_HOUR + write.hour * HOUR;
            yield* TestClock.setTime(hour + 1000);
            const answer = yield* d.route(
              client,
              write.spoof ? write.write.method : "process.send",
              write.spoof ? spoofedParams(write.write, `mix-${i}`) : request(`mix-${i}`, comment(write.text)),
            );
            expect(answer._tag).toBe(write.spoof ? "refused" : "ok");

            if (write.spoof) {
              counts.set(hour, (counts.get(hour) ?? 0) + 1);
            }
          }

          const sink = yield* SpanSink;
          expect(sink.sums).toBeTypeOf("function");
          const openHour = REFUSED_HOUR + 3 * HOUR;
          yield* TestClock.setTime(openHour + 2000);
          const expected = [...counts]
            .sort(([a], [b]) => a - b)
            .map(([hour, count]) => ({
              _tag: "sum",
              piece: "gateway.route",
              hour,
              refused: "reserved",
              count,
            }));
          expect(yield* sink.sums("gateway.route", REFUSED_HOUR, openHour + HOUR)).toEqual(
            expected.filter((point) => point.hour < openHour),
          );
          yield* TestClock.setTime(openHour + HOUR);
          expect(yield* sink.sums("gateway.route", REFUSED_HOUR, openHour + HOUR)).toEqual(expected);
          expect(yield* sink.sums("gateway.route", REFUSED_HOUR + HOUR, REFUSED_HOUR + 2 * HOUR)).toEqual(
            expected.filter((point) => point.hour === REFUSED_HOUR + HOUR),
          );
        }).pipe(w.provide);
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  it.effect.prop(
    "0140 good: nested ids are delivered once with stamps, received entry and saved spans",
    { write: GoodWrite },
    ({ write }) =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          yield* TestClock.setTime(REFUSED_HOUR + 1000);
          const m = Input.cases.comment.make({ ticket: { id: write.id }, text: write.text });
          expect((yield* d.route(client, "process.send", request(write.letter, m)))._tag).toBe("ok");
          expect(w.deliveries).toHaveLength(1);
          const envelope = w.deliveries[0]!.envelope;
          expect(Object.keys(envelope).sort()).toEqual(["arrivedAt", "by", "id", "input"]);
          expect(envelope.id).toMatch(/^input_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
          expect(envelope.by).toEqual({ _tag: "person", key: w.window.fingerprint, for: PERSON });
          expect(envelope.arrivedAt).toBe(REFUSED_HOUR + 1000);
          expect(envelope.input).toEqual(m);
          const received = yield* stamped();
          expect(received).toHaveLength(1);
          expect(received[0]).toMatchObject({ _tag: "received", id: envelope.id });
          expect(w.db.prepare("SELECT count(*) AS n FROM measurements WHERE piece='gateway.route'").get()?.n).toBe(1);
          const rows = yield* RecordManager.use((records) => Stream.runCollect(records.read({ _tag: "spans" })));
          expect(rows.filter((row) => row.name === "gateway.route")).toHaveLength(1);
          expect(rows.filter((row) => row.name === "gateway.input")).toHaveLength(1);
        }).pipe(w.provide);
      }),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  it.effect("p67: logical retries retain parent/trace and have one real mailbox placing", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        const other = yield* grantWindow(d, w);
        yield* d.route(client, "process.send", request("stable-letter"));
        yield* d.route(client, "process.send", request("stable-letter"));
        const deliveries = w.deliveries;
        expect(deliveries.length).toBeGreaterThan(0);
        expect(new Set(deliveries.map((x) => x.envelope.id)).size).toBe(1);
        expect(new Set(deliveries.map((x) => x.trace.traceId)).size).toBe(1);
        expect(yield* entries(`${PROCESS}/inbox`)).toHaveLength(1);
        expect((yield* d.route(client, "process.send", request("stable-letter", comment("changed"))))._tag).toBe(
          "refused",
        );
        expect((yield* d.route(other.client, "process.send", request("stable-letter")))._tag).toBe("refused");
        expect(yield* entries(`${PROCESS}/inbox`)).toHaveLength(1);
      }).pipe(w.provide);
    }),
  );
  it.effect("p67: a new door start retries an injected id collision and never reuses an input id", () =>
    Effect.gen(function* () {
      const w = yield* world();
      const starts = [START, START, OTHER_PROCESS];
      w.controls.next = () => Effect.succeed(starts.shift()!);
      const ids: Array<string> = [];

      for (let i = 0; i < 2; i++) {
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          yield* d.route(client, "process.send", request(`letter-${i}`));
          ids.push(w.deliveries.at(-1)!.envelope.id);
          const recorded = Object.values((yield* stamped()).at(-1)!.body ?? {});
          // P17a leaves the door's process and count as separate recorded fields.
          // The plan leaves their key names to the builder.
          expect(recorded).toContain(i === 0 ? START : OTHER_PROCESS);
          expect(recorded).toContain(1);
        }).pipe(w.provide);
      }

      expect(new Set(ids).size).toBe(2);

      for (const id of ids) {
        expect(id).toMatch(/^input_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
      }

      expect(w.sql.exec("SELECT id FROM gateway_starts ORDER BY rowid").map((row) => row.id)).toEqual([
        START,
        OTHER_PROCESS,
      ]);
      expect(starts).toEqual([]);
    }),
  );
  it.effect("p67: the authority storage cap fails before acknowledgment or delivery, without eviction", () =>
    Effect.gen(function* () {
      const w = yield* world({ inputCap: 1 });
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        yield* d.route(client, "process.send", request("first"));
        const parent = w.deliveries[0]!.envelope.id;
        expect(yield* Effect.flip(d.route(client, "process.send", request("second")))).toMatchObject({
          _tag: "LedgerError",
        });
        expect(w.deliveries).toHaveLength(1);
        expect((yield* writeId("saved-a", d.signer(parent, PROCESS, "saved"))).parent).toBe(parent);
      }).pipe(w.provide);
    }),
  );
  // Delivery returns Schema.Json, so non-finite numbers are not valid program replies.
  // Cross Sent's generated refusals with all four field-presence cases; dead and full from
  // review 1 stay in every run, alongside arbitrary reasons from the existing schema.
  it.effect.prop(
    "program refusals preserve their full reply on delivery and settled replay, except dead",
    {
      refusal: Sent.cases.refused.check(Schema.makeFilter(Schema.is(Schema.Json))),
      now: Schema.Finite,
      most: Schema.Finite,
    },
    ({ refusal, now, most }) =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          let n = 0;

          for (const reason of new Set([refusal.reason, "dead", "full"])) {
            for (const hasNow of [false, true]) {
              for (const hasMost of [false, true]) {
                const answered = Sent.cases.refused.make({
                  reason,
                  ...(hasNow ? { now: refusal.now ?? now } : {}),
                  ...(hasMost ? { most: refusal.most ?? most } : {}),
                });
                w.controls.answer = answered;
                const params = request(`answer-${n++}`);
                const expected =
                  reason === "dead" ? { _tag: "refused", reason: "dead" } : { _tag: "ok", result: answered };
                // These are JSON replies: -0 and 0 have the same wire representation.
                const wire = (value: unknown) => JSON.parse(JSON.stringify(value));
                expect(wire(yield* d.route(client, "process.send", params))).toEqual(wire(expected));
                const delivered = w.deliveries.length;
                // A settled retry must use the saved result rather than call the program again.
                w.controls.answer = Sent.cases.refused.make({ reason: "changed-after-settle" });
                expect(wire(yield* d.route(client, "process.send", params))).toEqual(wire(expected));
                expect(w.deliveries).toHaveLength(delivered);
              }
            }
          }
        }).pipe(w.provide);
      }),
    { arbitrary: { seed: SEED, runs: 20 } },
  );
  it.effect.prop(
    "question 16: authority is saved before delivery, and a failed delivery retries the same parent",
    { generated: Schema.NonEmptyString.check(Schema.isMaxLength(256)) },
    ({ generated }) =>
      Effect.forEach(
        ["retry-delivery", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              let first = true;
              w.controls.deliver = ({ envelope }) =>
                Effect.gen(function* () {
                  const session = yield* writeId("queued-write", d.signer(envelope.id, PROCESS, "saved"));
                  expect(session.by.key).toBe(w.window.fingerprint);

                  if (first) {
                    first = false;
                    return yield* new LedgerError({ reason: "unreachable" });
                  }
                });
              yield* Effect.flip(d.route(client, "process.send", request(value)));
              yield* d.route(client, "process.send", request(value));
              expect(w.deliveries).toHaveLength(2);
              expect(w.deliveries[0]!.envelope).toEqual(w.deliveries[1]!.envelope);
              expect(yield* entries(`${PROCESS}/inbox`)).toHaveLength(1);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const method of ["signer", "session.signer", "ledger.append", "process.exit", "gateway.founded"]) {
    it.effect(`explicit method table: public ${method} cannot bypass authority`, () =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);
          const before = yield* entries("gateway/access");
          expect(
            (yield* d.route(client, method, {
              by: "forged",
              parent: "borrowed",
              stream: "gateway/access",
            }))._tag,
          ).toBe("refused");
          expect(yield* entries("gateway/access")).toEqual(before);
        }).pipe(w.provide);
      }),
    );
  }
});

describe("P10 passkey roots and recovery", () => {
  it.effect.prop(
    "question 19: a founding passkey approves without an added enrollment",
    { generated: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4294967295 })) },
    ({ generated }) =>
      Effect.forEach(
        [7, generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            const sk = yield* passkey();
            w.founder.keys = [sk.line];
            w.founder.by = sk.fingerprint;
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const text = grantText({
                id: "founding-passkey-approval",
                key: w.otherWindow.raw,
                for: PERSON,
                to: "project-a",
                as: "window",
                saw: SAW,
                sentAt: SENT,
              });
              const before = yield* entries("gateway/access");

              for (const over of [{ flags: 25 }, { origin: "https://other.test" }]) {
                const proof = yield* sk.sign(text, over);
                expect(yield* d.grant({ text, armored: proof.armored })).toMatchObject({
                  _tag: "refused",
                  reason: "bad_signature",
                });
                expect(yield* entries("gateway/access")).toEqual(before);
              }

              const proof = yield* sk.sign(text, { counter: value });
              expect((yield* d.grant({ text, armored: proof.armored }))._tag).toBe("applied");
              const rows = yield* entries("gateway/access");
              expect(rows.map((row) => row._tag)).toEqual(["founded", "granted"]);
              expect(rows.find((row) => row.id === "founding-passkey-approval")?.body).toMatchObject({
                signed: {
                  signer: sk.line,
                  passkey: {
                    origin: "https://fabrika.test",
                    rp: "fabrika.test",
                    be: true,
                    bs: true,
                    counter: value,
                  },
                },
              });
              yield* online(d, w, "founding-approved", w.otherWindow);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "question 19: an enrolled passkey root approves, removes and recovers a cleared window",
    {
      generated: Grant.fields.id.check(Schema.isMinLength(1)).check(Schema.makeFilter((id) => id !== "remove-fresh")),
    },
    ({ generated }) =>
      Effect.forEach(
        ["cleared-storage", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              const p = yield* enrolled(d, w);
              expect((yield* d.grant({ text: p.text, armored: p.armored }))._tag).toBe("applied");
              const fresh = yield* key();
              const grant = grantText({
                id: value,
                key: fresh.raw,
                for: PERSON,
                to: "project-a",
                as: "window",
                saw: SAW,
                sentAt: SENT,
              });
              const approve = yield* p.sk.sign(grant);
              expect(
                (yield* d.grant({
                  text: grant,
                  armored: approve.armored,
                  passkey: { be: false, bs: false, counter: 123 },
                }))._tag,
              ).toBe("applied");
              const cleared = yield* online(d, w, "cleared", fresh);
              const revoke = revokeText({
                id: "remove-fresh",
                key: fresh.raw,
                for: PERSON,
                to: "project-a",
                saw: TOOK,
                sentAt: SENT,
              });
              const removal = yield* p.sk.sign(revoke);
              expect((yield* d.grant({ text: revoke, armored: removal.armored }))._tag).toBe("applied");
              expect((yield* d.route(cleared.client, "ledger.read", { stream: "x", after: 0 }))._tag).toBe("refused");
              const events = yield* entries("gateway/access");

              for (const id of [value, "remove-fresh"]) {
                expect(events.find((row) => row.id === id)?.body).toMatchObject({
                  signed: {
                    passkey: {
                      be: true,
                      bs: true,
                      counter: 0,
                      rp: "fabrika.test",
                      origin: "https://fabrika.test",
                    },
                  },
                });
              }

              expect(events.find((row) => row.id === p.add.id)?.body).toMatchObject({
                add: {
                  adds: { passkey: { proof: p.proof.armored, nonce: p.nonce, be: true, bs: true } },
                },
              });
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const name of ["key", "window", "for", "to", "id", "nonce"] as const) {
    it.effect(`question 19 enrollment: changing ${name} cannot reuse a proof`, () =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          yield* online(d, w);
          const p = yield* enrolled(d, w);
          const otherKey = yield* passkey();
          const changes = {
            key: otherKey.line,
            window: w.otherWindow.raw,
            for: `${PERSON.slice(0, -1)}p`,
            to: "project-b",
            id: "another-add",
            nonce: (p.nonce.startsWith("a") ? "b" : "a") + p.nonce.slice(1),
          };
          const wrongBinding = { ...p.binding, nonce: p.nonce, [name]: changes[name] };
          const proof = yield* p.sk.sign(enrollmentText(wrongBinding));
          const add = {
            ...p.add,
            adds: Adds.cases.person.make({
              ...p.add.adds,
              passkey: { ...p.add.adds.passkey!, proof: proof.armored },
            }),
          };
          const text = addText(add),
            before = yield* entries("gateway/access");
          expect((yield* d.grant({ text, armored: yield* w.root.sign(text) }))._tag).toBe("refused");
          expect(yield* entries("gateway/access")).toEqual(before);
        }).pipe(w.provide);
      }),
    );
  }

  for (const missing of ["proof", "verification", "backup metadata", "backup state", "origin"] as const) {
    it.effect(`question 19: missing or inconsistent ${missing} cannot create an SK person root`, () =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          yield* online(d, w);
          const p = yield* enrolled(d, w);
          const noUv = yield* p.sk.sign(enrollmentText({ ...p.binding, nonce: p.nonce }), {
            flags: 25,
          });
          const extra =
            missing === "proof"
              ? {}
              : {
                  passkey: {
                    ...p.add.adds.passkey!,
                    ...(missing === "verification"
                      ? { proof: noUv.armored }
                      : missing === "backup state"
                        ? { bs: false }
                        : missing === "origin"
                          ? { origin: "https://other.test" }
                          : { be: false }),
                  },
                };
          const text = addText({
            ...p.add,
            adds: Adds.cases.person.make({ key: p.sk.line, window: p.freshWindow.raw, ...extra }),
          });
          expect((yield* d.grant({ text, armored: yield* w.root.sign(text) }))._tag).toBe("refused");
        }).pipe(w.provide);
      }),
    );
  }

  it.effect.prop(
    "question 19 recovery: a sheet adds one passkey device; a spent sheet's exact resend is idempotent",
    { generated: Schema.NonEmptyString.check(Schema.isMaxLength(128)) },
    ({ generated }) =>
      Effect.forEach(
        ["recovered-a", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              yield* sheet(d, w);
              const first = yield* enrolled(d, w, value, w.sheet);
              const second = yield* enrolled(d, w, "recovered-b", w.sheet);
              expect((yield* d.grant({ text: first.text, armored: first.armored }))._tag).toBe("applied");
              const result = yield* d.grant({ text: second.text, armored: second.armored });
              assert(result._tag !== "applied");
              expect(result.reason).toBe("used");
              expect(yield* d.grant({ text: first.text, armored: first.armored })).toMatchObject({
                _tag: "applied",
              });
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

describe("P10 revocation and append", () => {
  it.effect.prop(
    "revocation: a device removal kills descendants despite lost close messages; other roots and sheet live",
    { generated: Revoke.fields.id.check(Schema.isMinLength(1)) },
    ({ generated }) =>
      Effect.forEach(
        ["revoke-root", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              const agent = yield* grantWindow(d, w, "agent", "agent");
              yield* device(d, w);
              yield* sheet(d, w);
              const other = yield* online(d, w, "other", w.otherWindow);
              yield* d.route(agent.client, "process.send", request("old-agent"));
              const parent = w.deliveries.at(-1)!.envelope.id;
              w.controls.notify = () => Effect.fail(new LedgerError({ reason: "unreachable" }));
              const text = revokeText({
                id: value,
                key: w.root.line,
                for: PERSON,
                to: "project-a",
                saw: TOOK,
                sentAt: SENT,
              });
              expect((yield* d.grant({ text, armored: yield* w.otherRoot.sign(text) }))._tag).toBe("applied");

              for (const revoked of [client, agent.client]) {
                expect((yield* d.route(revoked, "ledger.read", { stream: "x", after: 0 }))._tag).toBe("refused");
              }

              expect((yield* Effect.flip(writeId("after-revoke", d.signer(parent, PROCESS, "saved"))))._tag).toBe(
                "NotGranted",
              );
              expect((yield* d.route(other.client, "ledger.read", { stream: "x", after: 0 }))._tag).toBe("ok");
              const members = yield* ClientManager.use((m) => m.members);
              expect(members.keys.get(w.otherRoot.line)?.live).toBe(true);
              expect(members.keys.get(w.sheet.line)?.live).toBe(true);
              expect(w.notices.some((n) => JSON.stringify(n.news).includes("4003"))).toBe(true);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "append race: revocation after signer answers prevents a new write",
    { generated: Schema.Json },
    ({ generated }) =>
      Effect.forEach(
        ["must-not-land", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              const { client } = yield* grantWindow(d, w);
              yield* d.route(client, "process.send", request("press"));
              const parent = w.deliveries.at(-1)!.envelope.id;
              yield* writeId("entry-a", d.signer(parent, PROCESS, "saved"));
              const text = revokeText({
                id: "revoke-window",
                key: w.otherWindow.raw,
                for: PERSON,
                to: "project-a",
                saw: TOOK,
                sentAt: SENT,
              });
              yield* d.grant({ text, armored: yield* w.root.sign(text) });
              expect(
                (yield* Effect.flip(
                  d.append({
                    id: "entry-a",
                    parent,
                    process: PROCESS,
                    kind: "saved",
                    stream: "target",
                    event: { _tag: "saved", value },
                  }),
                ))._tag,
              ).toBe("NotGranted");
              expect(yield* entries("target")).toEqual([]);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "receipt binding: append cannot change its write id, process, kind or parent",
    { generated: Schema.Json },
    ({ generated }) =>
      Effect.forEach(
        [1, generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              yield* d.route(client, "process.send", request("press"));
              const parent = w.deliveries[0]!.envelope.id;
              yield* writeId("entry-a", d.signer(parent, PROCESS, "saved"));
              const append = {
                id: "entry-a",
                parent,
                process: PROCESS,
                kind: "saved",
                stream: "target",
                event: { _tag: "saved", value },
              };

              for (const change of [
                { id: "other" },
                { process: OTHER_PROCESS },
                { kind: "answered" },
                { parent: `in-${START}-999` },
              ]) {
                const failure = yield* Effect.flip(d.append({ ...append, ...change }));
                expect(failure._tag).toBe("SigningRefused");
              }

              expect(yield* entries("target")).toEqual([]);
              const placing = yield* d.append(append);
              expect(placing._tag).toBe("placed");
              expect(yield* d.append(append)).toEqual(placing);
              expect(yield* entries("target")).toHaveLength(1);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

describe("P33 the door never writes process lifecycle events", () => {
  // Only the brain's ProcessManager writes the `processes` stream and ProcessEvent cases.
  const refusedAppend = (kind: string, stream: string) =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        yield* d.route(client, "process.send", request("press"));
        const parent = w.deliveries.at(-1)!.envelope.id;
        yield* writeId("fact-a", d.signer(parent, PROCESS, kind));
        expect(
          yield* Effect.flip(d.append({ id: "fact-a", parent, process: PROCESS, kind, stream, event: { _tag: kind } })),
        ).toMatchObject({ _tag: "SigningRefused" });
        expect(yield* entries(stream)).toEqual([]);
      }).pipe(w.provide);
    });
  it.effect("the door refuses any append to the processes stream", () => refusedAppend("saved", "processes"));

  for (const stream of ["processes/counter:1", "processes/counter:1/inbox", "processes/a/b"]) {
    it.effect(`the door refuses any append under processes/, here ${stream}`, () => refusedAppend("saved", stream));
  }

  for (const kind of Object.keys(ProcessEvent.cases)) {
    it.effect.prop(
      `the door refuses an event tagged ${kind} on any stream, from any receipt holder`,
      { generated: Schema.String },
      ({ generated }) =>
        Effect.forEach(["tickets", generated], (value) => refusedAppend(kind, value), {
          concurrency: 1,
          discard: true,
        }),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }
});

describe("P33 signal ids belong to the brain", () => {
  // A DOWN's entry id is ["DOWN", recipient, ref]. The door refuses any id in that space, so no
  // receipt holder can hold a signal's id before the brain writes it.
  const BRAIN = "SHA256:brain";
  const WATCHER = processId();
  const TARGET = processId();
  const brainFrom = {
    by: BRAIN,
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: `in-${WATCHER}-41`,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    build: "test-build",
  };
  const toWatcher = Recipient.cases.process.make({ process: WATCHER });
  const asBrain = Owner.cases.brain.make({});
  const brainSeat = Recipient.cases.client.make({ client: "window-a", session: TARGET });
  const processes = (w: World, owner: typeof Owner.Type, recipient: typeof Recipient.Type) => {
    const next = [TARGET, WATCHER];
    return ProcessManager.layer(
      { owner, recipient, by: BRAIN },
      Effect.sync(() => next.shift()!),
    ).pipe(
      Layer.provide(
        LedgerTransactionSql.layer(w.sql).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void }))),
      ),
    );
  };
  const signalSpace = [
    JSON.stringify(["DOWN", toWatcher, "watch:1"]),
    JSON.stringify(["DOWN", "any", "spelling"]),
    JSON.stringify(["DOWN"]),
  ];

  for (const id of signalSpace) {
    it.effect.prop(
      `a receipt holder's append under signal id ${id} is refused`,
      { generated: Schema.String },
      ({ generated }) =>
        Effect.forEach(
          ["normal", generated],
          (value) =>
            Effect.gen(function* () {
              const w = yield* world();
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const { client } = yield* online(d, w);
                yield* d.route(client, "process.send", request("press"));
                const parent = w.deliveries.at(-1)!.envelope.id;
                const event = { _tag: "send", m: { _tag: "DOWN", ref: "watch:1", reason: value } };
                // The signer refuses a signal id outright, and the append refuses it if reached.
                expect(yield* Effect.flip(writeId(id, d.signer(parent, PROCESS, "send")))).toMatchObject({
                  _tag: "SigningRefused",
                });
                expect(
                  yield* Effect.flip(
                    d.append({
                      id,
                      parent,
                      process: PROCESS,
                      kind: "send",
                      stream: "notes",
                      event,
                    }),
                  ),
                ).toMatchObject({ _tag: "SigningRefused" });
                expect(yield* entries("notes")).toEqual([]);
                // The same append under an ordinary id lands: the id alone was refused.
                yield* writeId("note-1", d.signer(parent, PROCESS, "send"));
                const placing = yield* d.append({
                  id: "note-1",
                  parent,
                  process: PROCESS,
                  kind: "send",
                  stream: "notes",
                  event,
                });
                expect(placing._tag).toBe("placed");
              }).pipe(w.provide);
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect.prop(
    "a client cannot take a DOWN's id first; the real exit then writes its DOWN",
    { generated: Down.fields.ref },
    ({ generated }) =>
      Effect.forEach(
        ["watch:1", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* ProcessManager.use((p) =>
                Effect.gen(function* () {
                  yield* p.start(
                    Start.cases.first.make({
                      id: "start:target",
                      name: "target:1",
                      code: { program: "counter", hash: "build-a" },
                    }),
                    brainFrom,
                  );
                  yield* p.start(
                    Start.cases.first.make({
                      id: "start:watcher",
                      name: "watcher:1",
                      code: { program: "watcher", hash: "build-a" },
                    }),
                    brainFrom,
                  );
                }),
              ).pipe(Effect.provide(processes(w, asBrain, brainSeat)));
              const watcher = processes(w, Owner.cases.process.make({ process: WATCHER }), toWatcher);
              yield* ProcessManager.use((p) => p.monitor(value, TARGET, brainFrom)).pipe(Effect.provide(watcher));
              const { client } = yield* online(d, w);
              yield* d.route(client, "process.send", request("press"));
              const parent = w.deliveries.at(-1)!.envelope.id;
              const taken = JSON.stringify(["DOWN", toWatcher, value]);
              expect(yield* Effect.flip(writeId(taken, d.signer(parent, PROCESS, "send")))).toMatchObject({
                _tag: "SigningRefused",
              });
              const forged = {
                _tag: "send",
                m: { _tag: "DOWN", ref: value, process: TARGET, reason: "normal", to: toWatcher },
              };
              expect(
                yield* Effect.flip(
                  d.append({
                    id: taken,
                    parent,
                    process: PROCESS,
                    kind: "send",
                    stream: "watcher:1/inbox",
                    event: forged,
                  }),
                ),
              ).toMatchObject({ _tag: "SigningRefused" });
              yield* ProcessManager.use((p) => p.exit(TARGET, CRASHED, brainFrom)).pipe(
                Effect.provide(processes(w, asBrain, brainSeat)),
              );
              const inbox = yield* entries("watcher:1/inbox");
              expect(inbox).toHaveLength(1);
              expect(inbox[0]).toMatchObject({
                _tag: "send",
                by: BRAIN,
                body: { m: { _tag: "DOWN", ref: value, process: TARGET, reason: CRASHED } },
              });
              const letters = yield* ProcessManager.use((p) => Stream.runCollect(p.receive(WATCHER, 0))).pipe(
                Effect.provide(watcher),
              );
              expect(letters.map((letter) => letter.m)).toEqual([
                { _tag: "DOWN", ref: value, process: TARGET, reason: CRASHED, to: toWatcher },
              ]);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "a door send with no m, a wrong m or junk never wedges a process inbox",
    { generated: Schema.Json },
    ({ generated }) =>
      Effect.forEach(
        ["hello", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* ProcessManager.use((p) =>
                p.start(
                  Start.cases.first.make({
                    id: "start:watcher",
                    name: "watcher:1",
                    code: { program: "watcher", hash: "build-a" },
                  }),
                  brainFrom,
                ),
              ).pipe(Effect.provide(processes(w, asBrain, brainSeat)));
              const { client } = yield* online(d, w);
              const sends = [
                { _tag: "send" },
                { _tag: "send", m: { _tag: "DOWN", ref: 5 } },
                { _tag: "send", junk: [1, { m: 2 }] },
                { _tag: "send", m: value },
              ];

              for (const [n, event] of sends.entries()) {
                // Each receipt signs its own writes, so each append rides a fresh input.
                yield* d.route(client, "process.send", request(`press-${n}`));
                const parent = w.deliveries.at(-1)!.envelope.id;
                const id = `junk-${n}`;
                yield* writeId(id, d.signer(parent, PROCESS, "send"));
                const placing = yield* d.append({
                  id,
                  parent,
                  process: PROCESS,
                  kind: "send",
                  stream: "watcher:1/inbox",
                  event,
                });
                expect(placing._tag).toBe("placed");
              }

              // Pinned: a send with no m is skipped; any m is plain mail.
              const watcher = processes(w, Owner.cases.process.make({ process: TARGET }), brainSeat);
              const letters = yield* ProcessManager.use((p) => Stream.runCollect(p.receive(TARGET, 0))).pipe(
                Effect.provide(watcher),
              );
              expect(letters.map((letter) => letter.m)).toEqual([{ _tag: "DOWN", ref: 5 }, value]);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

describe("P10 span reader and recording", () => {
  it.effect.prop(
    "P37 reader: first page stops pulling before a failure after row 256",
    { generated: SpanRow.fields.name },
    ({ generated }) =>
      Effect.forEach(
        ["bounded-read", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            let poisoned = 0;
            const records = Layer.effect(
              RecordManager,
              RecordManager.pipe(
                Effect.map((real: typeof RecordManager.Service) => ({
                  ...real,
                  read: (chain: typeof Chain.Type) =>
                    real.read(chain).pipe(
                      Stream.take(256),
                      Stream.concat(
                        Stream.unwrap(
                          Effect.sync(() => {
                            poisoned++;
                            return Stream.fail(new SinkError({ reason: "unreachable", held: 0 }));
                          }),
                        ),
                      ),
                    ),
                })),
              ),
            ).pipe(Layer.provide(w.env));
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              const r = yield* RecordManager;
              const chain = Chain.cases.job.make({ process: PROCESS });
              const rows = Array.from({ length: 257 }, (_, n) => ({
                span: SpanRow.make({
                  traceId: TRACE,
                  spanId: (n + 1).toString(16).padStart(16, "0"),
                  parentSpanId: null,
                  name: value,
                  kind: "internal",
                  startTimeUnixNano: "1",
                  endTimeUnixNano: "2",
                  attributes: {},
                  events: [],
                  links: [],
                  resource: { attributes: { "fab.object": START } },
                  ok: true,
                }),
                content: null,
              }));
              yield* r.write(chain, 0, rows);
              const answer = yield* d.route(client, "spans.read", { chain, after: 0 });
              assert(answer._tag === "ok");
              const page = yield* Schema.decodeUnknownEffect(SpanPage)(answer.result);
              expect(page.spans).toHaveLength(256);
              expect(poisoned).toBe(0);
            }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, records)))));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "recording failure: a failed pre-route sink flush prevents delivery and acknowledgment",
    { generated: SinkError.fields.reason },
    ({ generated }) =>
      Effect.forEach(
        ["storage", generated] as const,
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            let block = false;
            const sink = Layer.effect(
              SpanSink,
              SpanSink.pipe(
                Effect.map((real: typeof SpanSink.Service) => ({
                  ...real,
                  flush: Effect.suspend(() =>
                    block ? Effect.fail(new SinkError({ reason: value, held: 1 })) : real.flush,
                  ),
                })),
              ),
            ).pipe(Layer.provide(w.env));
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              block = true;
              expect(yield* Effect.flip(d.route(client, "process.send", request("flush-failure")))).toMatchObject({
                _tag: "SinkError",
              });
              expect(w.deliveries).toEqual([]);
              block = false;
              yield* d.route(client, "process.send", request("flush-failure"));
              expect(w.deliveries).toHaveLength(1);
            }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, sink)))));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect("P37 reader: a bounded page crosses rolled parts and outside-process spans in order", () =>
    Effect.gen(function* () {
      const w = yield* world({ recordCap: 64 * 1024 });
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        const records = yield* RecordManager;
        const chain = Chain.cases.spans.make({});

        for (let n = 0; n < 270; n++) {
          const span = SpanRow.make({
            traceId: TRACE,
            spanId: n.toString(16).padStart(16, "0"),
            parentSpanId: null,
            name: `seed-${n}`,
            kind: "internal",
            startTimeUnixNano: "1",
            endTimeUnixNano: "2",
            attributes: {},
            events: [],
            links: [],
            resource: { attributes: { "fab.object": START } },
            ok: true,
          });
          let part = 0;
          let result = yield* records.write(chain, part, [{ span, content: null }]);

          while (result._tag === "rolled") {
            result = yield* records.write(chain, ++part, [{ span, content: null }]);
          }
        }

        const baseline = yield* Stream.runCollect(records.read(chain));
        expect(w.partCount()).toBeGreaterThan(1);
        const first = yield* d.route(client, "spans.read", { chain, after: 0 });
        assert(first._tag === "ok");
        const firstPage = yield* Schema.decodeUnknownEffect(SpanPage)(first.result);
        expect(firstPage.spans).toHaveLength(256);
        expect(firstPage.next).toBe(256);
        expect(firstPage.spans.map((s) => s.spanId)).toEqual(baseline.slice(0, 256).map((s) => s.spanId));
        const second = yield* d.route(client, "spans.read", { chain, after: 256 });
        assert(second._tag === "ok");
        const secondPage = yield* Schema.decodeUnknownEffect(SpanPage)(second.result);
        expect(secondPage.spans.slice(0, baseline.length - 256).map((s) => s.spanId)).toEqual(
          baseline.slice(256).map((s) => s.spanId),
        );
        expect(secondPage.spans.length).toBeLessThanOrEqual(256);
        expect(secondPage.next).toBe(256 + secondPage.spans.length);
      }).pipe(w.provide);
    }),
  );
  it.effect.prop(
    "P37 reader: failure remains an Effect failure, never a domain err",
    { generated: SinkError.fields.reason },
    ({ generated }) =>
      Effect.forEach(
        ["unreachable", generated] as const,
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            const broken = Layer.effect(
              RecordManager,
              RecordManager.pipe(
                Effect.map((r: typeof RecordManager.Service) => ({
                  ...r,
                  read: () => Stream.fail(new SinkError({ reason: value, held: 0 })),
                })),
              ),
            ).pipe(Layer.provide(w.env));
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              expect(
                yield* Effect.flip(d.route(client, "spans.read", { chain: { _tag: "spans" }, after: 0 })),
              ).toMatchObject({ _tag: "SinkError" });
            }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, broken)))));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "P37 content deletion: only a person can erase, checked fingerprint retained, span stays",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["privacy", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              const agent = yield* grantWindow(d, w, "agent", "agent");
              const chain = Chain.cases.spans.make({}),
                r = yield* RecordManager;
              const span = SpanRow.make({
                traceId: TRACE,
                spanId: "1234567890abcdef",
                parentSpanId: null,
                name: "failure",
                kind: "internal",
                startTimeUnixNano: "1",
                endTimeUnixNano: "2",
                attributes: {},
                events: [],
                links: [],
                resource: { attributes: { "fab.object": START } },
                ok: false,
              });
              yield* r.write(chain, 0, [{ span, content: "deletable content" }]);
              expect(
                (yield* d.route(agent.client, "spans.deleteContent", {
                  chain,
                  spanId: span.spanId,
                  reason: value,
                }))._tag,
              ).toBe("refused");
              expect(Option.getOrThrow(yield* r.content(chain, span.spanId))._tag).toBe("kept");
              expect(
                (yield* d.route(client, "spans.deleteContent", {
                  chain,
                  spanId: span.spanId,
                  reason: value,
                  by: "forged-deleter",
                }))._tag,
              ).toBe("refused");
              expect(Option.getOrThrow(yield* r.content(chain, span.spanId))._tag).toBe("kept");
              expect(
                (yield* d.route(client, "spans.deleteContent", {
                  chain,
                  spanId: span.spanId,
                  reason: value,
                }))._tag,
              ).toBe("ok");
              expect(Option.getOrThrow(yield* r.content(chain, span.spanId))).toMatchObject({
                _tag: "deleted",
                by: w.window.fingerprint,
                reason: value,
              });
              expect((yield* Stream.runCollect(r.read(chain))).some((s) => s.spanId === span.spanId)).toBe(true);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect("record first: input log and ended input span are flushed before delivery; route has a real link", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        const { client } = yield* online(d, w);
        w.controls.deliver = ({ envelope, trace }) =>
          Effect.gen(function* () {
            const rows = yield* stamped();
            expect(rows.some((r) => r.id === envelope.id)).toBe(true);
            const spans = yield* RecordManager.use((r: typeof RecordManager.Service) =>
              Stream.runCollect(r.read(Chain.cases.spans.make({}))),
            );
            expect(
              spans.some((s) => s.name === "gateway.input" && s.spanId === trace.spanId && s.traceId === trace.traceId),
            ).toBe(true);
          });
        yield* d.route(client, "process.send", request("recorded"));
        const rows = yield* stamped();
        const received = rows.find((r) => r.id === w.deliveries[0]!.envelope.id)!;
        expect(received.parent).toBeNull();
        expect(received.by).toBe(w.window.fingerprint);
        const spans = yield* RecordManager.use((r: typeof RecordManager.Service) =>
          Stream.runCollect(r.read(Chain.cases.spans.make({}))),
        );
        const route = spans.find((s) => s.name === "gateway.route");
        expect(route?.links).toContainEqual(
          expect.objectContaining({
            traceId: w.deliveries[0]!.trace.traceId,
            spanId: w.deliveries[0]!.trace.spanId,
          }),
        );
        expect(route?.ok).toBe(true);
      }).pipe(w.provide);
    }),
  );
  it.effect.prop(
    "recording failure: failed input append or sink flush prevents delivery",
    { generated: Schema.NonEmptyString.check(Schema.isMaxLength(256)) },
    ({ generated }) =>
      Effect.forEach(
        ["unrecorded", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            let block = false;
            const transaction = Layer.effect(
              LedgerTransaction,
              LedgerTransaction.pipe(
                Effect.map((real) => ({
                  transact: <A>(step: (turn: LedgerTurn) => A) =>
                    real.transact((turn) =>
                      step({
                        ...turn,
                        append: (stream, id, line) => {
                          // Fail the input write inside the real transaction, before storage changes.
                          if (block && stream === "gateway/inputs") {
                            block = false;
                            // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- LedgerTransaction catches this synchronous callback's throw as a typed failure.
                            throw new LedgerError({ reason: "storage" });
                          }

                          return turn.append(stream, id, line);
                        },
                      }),
                    ),
                })),
              ),
            ).pipe(Layer.provide(w.env));
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              block = true;
              expect(yield* Effect.flip(d.route(client, "process.send", request(value)))).toMatchObject({
                _tag: "LedgerError",
                reason: "storage",
              });
              expect(block).toBe(false);
              expect(rawRows(w.db, "gateway/inputs")).toEqual([]);
              expect(w.deliveries).toEqual([]);
            }).pipe(
              Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, transaction)))),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "route failure: final flush includes the ended failed route span",
    { generated: Schema.NonEmptyString.check(Schema.isMaxLength(256)) },
    ({ generated }) =>
      Effect.forEach(
        ["failed-route", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              w.controls.deliver = () => Effect.fail(new LedgerError({ reason: "unreachable" }));
              yield* Effect.flip(d.route(client, "process.send", request(value)));
              const spans = yield* RecordManager.use((r: typeof RecordManager.Service) =>
                Stream.runCollect(r.read(Chain.cases.spans.make({}))),
              );
              expect(spans.some((s) => s.name === "gateway.route" && !s.ok)).toBe(true);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect(
    "no content leak: raw keys, terminal bytes, signature, forged sender and nested Redacted stay out of input telemetry",
    () =>
      Effect.gen(function* () {
        const w = yield* world();
        const log: Array<unknown> = [],
          archives: Array<Uint8Array> = [];
        const archive = Layer.effect(
          Archive,
          Archive.pipe(
            Effect.map((real: typeof Archive.Service) => ({
              put: (name: string, body: Uint8Array) => {
                archives.push(body.slice());
                return real.put(name, body);
              },
            })),
          ),
        ).pipe(Layer.provide(w.env));
        const logger = Logger.layer([
          Logger.make((entry) => {
            log.push(entry.message);
          }),
        ]);
        yield* Effect.gen(function* () {
          const d = yield* Gateway;
          const { client } = yield* online(d, w);

          for (const [index, marker] of ["raw-key-marker", "terminal-byte-marker", "signature-marker"].entries()) {
            const result = yield* d.route(
              client,
              "process.send",
              request(`raw-${index}`, { _tag: "keys", bytes: marker }),
            );
            expect(result._tag).toBe("ok");
          }

          yield* d.route(client, "process.send", { ...request("spoof"), by: "forged-sender-marker" });
          const secret = yield* d.route(
            client,
            "process.send",
            request("secret", { _tag: "secret", value: { secret: "nested-redacted-marker" } }),
          );
          expect(secret._tag).toBe("ok");
          expect(Schema.is(Schema.toType(Input.cases.secret))(w.deliveries.at(-1)!.envelope.input)).toBe(true);
          yield* TestClock.adjust("16 days");
          // P37 rolls up the old hour when a later span ends, before archiving it.
          const later = yield* d.route(client, "ledger.read", { stream: "x", after: 0 });
          expect(later._tag).toBe("ok");
          yield* SpanSink.use((s: typeof SpanSink.Service) => s.flush);
          const inputRows = yield* stamped(),
            spans = yield* RecordManager.use((r: typeof RecordManager.Service) =>
              Stream.runCollect(r.read(Chain.cases.spans.make({}))),
            );
          const visible = JSON.stringify({
            log,
            inputRows,
            spans,
            archives: archives.map((a) => Buffer.from(a).toString()),
          });
          expect(inputRows.length).toBeGreaterThan(0);
          expect(spans.length).toBeGreaterThan(0);
          expect(archives.length).toBeGreaterThan(0);

          for (const marker of [
            "raw-key-marker",
            "terminal-byte-marker",
            "signature-marker",
            "forged-sender-marker",
            "nested-redacted-marker",
          ]) {
            expect(visible).not.toContain(marker);
          }

          for (const bytes of w.bytes()) {
            expect(bytes.includes("nested-redacted-marker")).toBe(false);
          }

          // Raw input bodies have no allowed durable home here: the test handoff skips raw keys.
          for (const bytes of w.bytes()) {
            for (const marker of [
              "raw-key-marker",
              "terminal-byte-marker",
              "signature-marker",
              "forged-sender-marker",
            ]) {
              expect(bytes.includes(marker)).toBe(false);
            }
          }
        }).pipe(
          Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.mergeAll(w.env, archive, logger)))),
        );
      }),
  );
});

describe("P10 refusal records and checked writes", () => {
  for (const interruption of ["replaced", "stranger flood"] as const) {
    for (const known of [true, false]) {
      it.effect.prop(
        `p26: ${known ? "member" : "unknown key"} admission ${interruption === "replaced" ? "refuses a replaced challenge" : "survives a stranger flood"}`,
        { generated: Hello.fields.tab },
        ({ generated }) =>
          Effect.forEach(
            ["replaced", generated],
            (value) =>
              Effect.gen(function* () {
                const w = yield* world();
                let replace: Effect.Effect<void, GatewayError> | null = null;
                const ledger = Layer.effect(
                  Ledger,
                  Effect.map(Ledger, (real) => ({
                    ...real,
                    read: (stream: string, after: number) =>
                      Stream.unwrap(
                        Effect.sync(() => {
                          const before = stream === "gateway/access" ? replace : null;

                          if (before === null) {
                            return real.read(stream, after);
                          }

                          replace = null;
                          // The interruption's gateway fault is no ledger fault: it fails the test as a defect.
                          return Stream.concat(
                            Stream.fromEffect(Effect.orDie(before)).pipe(Stream.drain),
                            real.read(stream, after),
                          );
                        }),
                      ),
                  })),
                ).pipe(Layer.provide(w.env));
                yield* Effect.gen(function* () {
                  const d = yield* Gateway;
                  yield* online(d, w);
                  const k = known ? w.window : w.otherWindow;
                  const client = yield* d.connect();
                  const nonce = yield* d.challenge(client);
                  const hello = {
                    versions: [1],
                    has: [],
                    ping: "30s",
                    key: k.raw,
                    tab: value,
                    nonce,
                    platform: "browser",
                    os: "ios",
                    sentAt: SENT,
                    signed: yield* k.sign(`fabrika-hello\n${URL}\n${value}\n${nonce}`),
                  };
                  replace =
                    interruption === "replaced"
                      ? d.challenge(client).pipe(Effect.asVoid)
                      : Effect.forEach(
                          Array.from({ length: w.settings.waiting.most + 1 }, (_, i) => i),
                          () => d.connect().pipe(Effect.flatMap((id) => d.challenge(id))),
                          { concurrency: 1 },
                        ).pipe(Effect.asVoid);
                  const result = yield* d.initialize(client, hello, {
                    url: URL,
                    tab: value,
                    name: k.fingerprint,
                  });
                  expect(result).toMatchObject(
                    interruption === "stranger flood" && known
                      ? { _tag: "online" }
                      : { _tag: "refused", reason: known ? "bad_nonce" : "not_granted" },
                  );
                  expect(replace).toBeNull();
                  const knock = yield* d.knock(client, { label: "Checked proof" });
                  expect(knock).toMatchObject(
                    interruption === "stranger flood" && !known
                      ? { _tag: "ok" }
                      : { _tag: "refused", reason: "not_waiting" },
                  );
                }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, ledger)))));
              }),
            { discard: true },
          ),
        { arbitrary: { seed: 119120, runs: 12 } },
      );
    }
  }

  for (const interruption of ["replaced", "stranger flood"] as const) {
    for (const known of [true, false]) {
      it.effect.prop(
        `p26: ${known ? "member" : "unknown key"} proof ${interruption === "replaced" ? "refuses a replaced challenge" : "survives a stranger flood"}`,
        { generated: Hello.fields.tab },
        ({ generated }) =>
          Effect.forEach(
            ["verifying", generated],
            (value) =>
              Effect.gen(function* () {
                const w = yield* world();
                yield* Effect.gen(function* () {
                  const d = yield* Gateway;
                  yield* online(d, w);
                  const k = known ? w.window : w.otherWindow;
                  const client = yield* d.connect();
                  const nonce = yield* d.challenge(client);
                  const hello = {
                    versions: [1],
                    has: [],
                    ping: "30s",
                    key: k.raw,
                    tab: value,
                    nonce,
                    platform: "browser",
                    os: "ios",
                    sentAt: SENT,
                    signed: yield* k.sign(`fabrika-hello\n${URL}\n${value}\n${nonce}`),
                  };
                  const entered = Deferred.makeUnsafe<void>(),
                    release = Deferred.makeUnsafe<void>();
                  const verify = crypto.subtle.verify.bind(crypto.subtle);
                  const spy = vi.spyOn(crypto.subtle, "verify").mockImplementationOnce((...args) =>
                    Effect.runPromise(
                      Effect.gen(function* () {
                        yield* Deferred.succeed(entered, undefined);
                        yield* Deferred.await(release);
                        return yield* web(() => verify(...args));
                      }),
                    ),
                  );

                  try {
                    const first = yield* Effect.forkChild(
                      d.initialize(client, hello, {
                        url: URL,
                        tab: value,
                        name: k.fingerprint,
                      }),
                    );
                    yield* Deferred.await(entered);

                    if (interruption === "replaced") {
                      yield* d.challenge(client);
                    } else {
                      for (let i = 0; i <= w.settings.waiting.most; i++) {
                        yield* d.challenge(yield* d.connect());
                      }
                    }

                    yield* Deferred.succeed(release, undefined);
                    const result = yield* Fiber.join(first);
                    expect(result).toMatchObject(
                      interruption === "stranger flood" && known
                        ? { _tag: "online" }
                        : {
                            _tag: "refused",
                            reason: interruption === "replaced" ? "bad_nonce" : "not_granted",
                          },
                    );
                    const knock = yield* d.knock(client, { label: "Checked proof" });
                    expect(knock).toMatchObject(
                      interruption === "stranger flood" && !known
                        ? { _tag: "ok" }
                        : { _tag: "refused", reason: "not_waiting" },
                    );
                  } finally {
                    spy.mockRestore();
                  }
                }).pipe(w.provide);
              }),
            { concurrency: 1, discard: true },
          ),
        { arbitrary: { seed: 119120, runs: 12 } },
      );
    }
  }

  for (const retry of ["same receipt", "different armor", "replaced enrollment"] as const) {
    it.effect.prop(
      `p42: a queued change rechecks ${retry} after the preceding write`,
      {
        generated: Grant.fields.id.check(Schema.isMinLength(1)).check(Schema.makeFilter((id) => id !== "enrolled")),
      },
      ({ generated }) =>
        Effect.forEach(
          ["race-first", generated],
          (value) =>
            Effect.gen(function* () {
              const w = yield* world();
              const entered = Deferred.makeUnsafe<void>(),
                release = Deferred.makeUnsafe<void>(),
                checked = Deferred.makeUnsafe<void>();
              let block = false,
                watching: string | null = null;
              const sql = {
                ...w.sql,
                exec: (...args: Parameters<typeof w.sql.exec>) => {
                  const answer = w.sql.exec(...args);

                  if (args[0] === "SELECT value FROM gateway_state WHERE name=?" && args[1] === watching) {
                    queueMicrotask(() => Deferred.doneUnsafe(checked, Effect.void));
                  }

                  return answer;
                },
              };
              const clients = Layer.effect(
                ClientManager,
                ClientManager.pipe(
                  Effect.map((real) => ({
                    ...real,
                    write: (...args: Parameters<typeof real.write>) =>
                      Effect.gen(function* () {
                        if (block) {
                          block = false;
                          yield* Deferred.succeed(entered, undefined);
                          yield* Deferred.await(release);
                        }

                        return yield* real.write(...args);
                      }),
                  })),
                ),
              ).pipe(Layer.provide(w.env));
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                yield* online(d, w);
                const p = retry === "replaced enrollment" ? yield* enrolled(d, w) : null;
                const text = grantText({
                  id: value,
                  key: w.otherWindow.raw,
                  for: PERSON,
                  to: "project-a",
                  as: "window",
                  saw: SAW,
                  sentAt: SENT,
                });
                const armored = yield* w.root.sign(text);
                block = true;
                const first = yield* Effect.forkChild(d.grant({ text, armored }));
                yield* Deferred.await(entered);
                watching = p === null ? `change/${value}` : `enrollment/${p.add.id}`;
                const second = yield* Effect.forkChild(
                  d.grant(
                    p === null
                      ? { text, armored: retry === "different armor" ? `${armored}\n` : armored }
                      : { text: p.text, armored: p.armored },
                  ),
                );
                yield* Deferred.await(checked);

                if (p !== null) {
                  yield* d.enrollment(p.binding);
                }

                yield* Deferred.succeed(release, undefined);
                const answer = yield* Fiber.join(first);
                expect(answer._tag).toBe("applied");
                const result = yield* Fiber.join(second);

                if (retry === "same receipt") {
                  expect(result).toEqual(answer);
                } else {
                  expect(result).toMatchObject({
                    _tag: "refused",
                    reason: p === null ? "id_reused" : "bad_enrollment",
                  });
                }
              }).pipe(
                Effect.provide(
                  Gateway.layer({ ...w.settings, sql }).pipe(Layer.provideMerge(Layer.merge(w.env, clients))),
                ),
              );
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect.prop(
    "p42: an unfinished membership write cannot change its signed bytes on retry",
    { generated: Grant.fields.id.check(Schema.isMinLength(1)) },
    ({ generated }) =>
      Effect.forEach(
        ["pending-change", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            let fail = false;
            const clients = Layer.effect(
              ClientManager,
              ClientManager.pipe(
                Effect.map((real) => ({
                  ...real,
                  write: (...args: Parameters<typeof real.write>) => {
                    if (fail) {
                      fail = false;
                      return Effect.fail(new LedgerError({ reason: "unreachable" }));
                    }

                    return real.write(...args);
                  },
                })),
              ),
            ).pipe(Layer.provide(w.env));
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              const text = grantText({
                id: value,
                key: w.otherWindow.raw,
                for: PERSON,
                to: "project-a",
                as: "window",
                saw: SAW,
                sentAt: SENT,
              });
              const armored = yield* w.root.sign(text);
              fail = true;
              expect(yield* Effect.flip(d.grant({ text, armored }))).toMatchObject({
                _tag: "LedgerError",
                reason: "unreachable",
              });
              expect(yield* d.grant({ text, armored: `${armored}\n` })).toMatchObject({
                _tag: "refused",
                reason: "id_reused",
              });
              expect((yield* d.grant({ text, armored }))._tag).toBe("applied");
            }).pipe(Effect.provide(Gateway.layer(w.settings).pipe(Layer.provideMerge(Layer.merge(w.env, clients)))));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const [method, params] of [
    ["process.send", undefined],
    ["process.send", null],
    ["process.send", request("bad-message", 42)],
    ["ledger.read", { stream: "empty", after: -1 }],
    ["ledger.wait", { stream: "empty" }],
  ] as const) {
    it.effect.prop(
      `p67: malformed ${method} ${JSON.stringify(params)} is recorded as refused`,
      { generated: Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]) },
      ({ generated }) =>
        Effect.forEach(
          [params, generated],
          (malformed) =>
            Effect.gen(function* () {
              const w = yield* world();
              yield* Effect.gen(function* () {
                const d = yield* Gateway;
                const { client } = yield* online(d, w);
                expect(yield* d.route(client, method, malformed)).toMatchObject({
                  _tag: "refused",
                  reason: "bad_input",
                });
                expect((yield* stamped()).at(-1)).toMatchObject({
                  _tag: "refused",
                  body: { reason: "bad_input" },
                });
                expect(w.deliveries).toEqual([]);
              }).pipe(w.provide);
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect.prop(
    "p67: a person's approval keeps its safe body and can sign its answer",
    { generated: Schema.String },
    ({ generated }) =>
      Effect.forEach(
        ["yes", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              const input = Input.cases.approve.make({ answer: value });
              yield* d.route(client, "process.send", request("approval", input));
              expect((yield* stamped()).at(-1)?.body).toMatchObject({ input });
              const parent = w.deliveries[0]!.envelope.id;
              const session = yield* writeId("answer", d.signer(parent, PROCESS, "answered"));
              expect(session.by.key).toBe(w.window.fingerprint);

              for (const [stream, event] of [
                ["gateway/access", { _tag: "answered" }],
                ["tickets", null],
                ["tickets", { _tag: "answered", value: 1n }],
              ] as const) {
                expect(
                  yield* Effect.flip(
                    d.append({
                      id: "answer",
                      parent,
                      process: PROCESS,
                      kind: "answered",
                      stream,
                      event,
                    }),
                  ),
                ).toMatchObject({ _tag: "SigningRefused", reason: "not_delivered" });
              }

              expect(
                (yield* d.append({
                  id: "answer",
                  parent,
                  process: PROCESS,
                  kind: "answered",
                  stream: "tickets",
                  event: { _tag: "answered" },
                }))._tag,
              ).toBe("placed");
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "p27: an added person needs a supported public key before anything is written",
    {
      generated: Schema.String.check(
        Schema.makeFilter((key) => !key.startsWith("ssh-") && !key.startsWith("ecdsa-") && !key.startsWith("sk-")),
      ),
    },
    ({ generated }) =>
      Effect.forEach(
        ["unsupported-public-key", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              const before = yield* entries("gateway/access");
              const text = addText({
                id: "invalid-root",
                for: PERSON,
                to: "project-a",
                adds: Adds.cases.person.make({
                  key: value,
                  window: w.otherWindow.raw,
                }),
                drops: [],
                saw: ADD_SAW,
                sentAt: SENT,
              });
              expect(yield* d.grant({ text, armored: yield* w.root.sign(text) })).toMatchObject({
                _tag: "refused",
                reason: "bad_enrollment",
              });
              expect(yield* entries("gateway/access")).toEqual(before);
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "p42: the same signed text with different armor is not an exact resend",
    { generated: Grant.fields.id.check(Schema.isMinLength(1)) },
    ({ generated }) =>
      Effect.forEach(
        ["armor-retry", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              const text = grantText({
                id: value,
                key: w.otherWindow.raw,
                for: PERSON,
                to: "project-a",
                as: "window",
                saw: SAW,
                sentAt: SENT,
              });
              const armored = yield* w.root.sign(text);
              expect((yield* d.grant({ text, armored }))._tag).toBe("applied");
              expect(yield* d.grant({ text, armored: `${armored}\n` })).toMatchObject({
                _tag: "refused",
                reason: "id_reused",
              });
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect("p43: removing one connection closes only that connection", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* Effect.gen(function* () {
        const d = yield* Gateway;
        yield* online(d, w);
        const { client } = yield* grantWindow(d, w);
        w.notices.length = 0;
        const text = revokeText({
          id: "close-window",
          key: w.otherWindow.raw,
          for: PERSON,
          to: "project-a",
          saw: TOOK,
          sentAt: SENT,
        });
        expect((yield* d.grant({ text, armored: yield* w.root.sign(text) }))._tag).toBe("applied");
        expect(w.notices).toEqual([{ client, news: { close: 4003 } }]);
      }).pipe(w.provide);
    }),
  );
  it.effect.prop(
    "p26: concurrent hellos spend one nonce once and cannot leave an online tab waiting",
    { generated: Hello.fields.tab },
    ({ generated }) =>
      Effect.forEach(
        ["race", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              const client = yield* d.connect();
              const nonce = yield* d.challenge(client);
              const hello = {
                versions: [1],
                has: [],
                ping: "30s",
                key: w.window.raw,
                tab: value,
                nonce,
                platform: "browser",
                os: "ios",
                sentAt: SENT,
                signed: yield* w.window.sign(`fabrika-hello\n${URL}\n${value}\n${nonce}`),
              };
              const initialize = d.initialize(client, hello, {
                url: URL,
                tab: value,
                name: w.window.fingerprint,
              });
              const answers = yield* Effect.all([initialize, initialize], {
                concurrency: "unbounded",
              });
              expect(answers.map((a) => a._tag).sort()).toEqual(["online", "refused"]);
              expect(yield* d.knock(client, { label: "Already online" })).toMatchObject({
                _tag: "refused",
                reason: "not_waiting",
              });
            }).pipe(w.provide);
          }),
        { discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "p67: an agent needs a delivered parent for the same process and trace",
    { generated: Schema.NonEmptyString.check(Schema.isMaxLength(256)) },
    ({ generated }) =>
      Effect.forEach(
        ["not-delivered", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            const storage = failSessionRecord(w.sql);
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              const { client } = yield* online(d, w);
              const agent = yield* grantWindow(d, w, "agent", "agent");
              yield* Effect.flip(d.route(client, "process.send", request(value)));
              expect(storage.failed()).toBe(true);
              const row = (yield* stamped()).at(-1)!;
              expect(
                yield* d.route(agent.client, "process.send", {
                  ...request("stolen-trace"),
                  traceId: row.traceId,
                }),
              ).toMatchObject({ _tag: "refused", reason: "bad_trace" });
              yield* d.route(client, "process.send", request("delivered"));
              const traceId = w.deliveries.at(-1)!.trace.traceId;
              expect(
                yield* d.route(agent.client, "process.send", {
                  ...request("wrong-process"),
                  pid: OTHER_PROCESS,
                  traceId,
                }),
              ).toMatchObject({ _tag: "refused", reason: "bad_trace" });
              expect(
                (yield* d.route(agent.client, "process.send", {
                  ...request("same-trace"),
                  traceId,
                }))._tag,
              ).toBe("ok");
              expect(w.deliveries.at(-1)?.envelope.by.key).toBe(w.agent.fingerprint);
            }).pipe(Effect.provide(Gateway.layer({ ...w.settings, sql: storage.sql }).pipe(Layer.provideMerge(w.env))));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it.effect.prop(
    "p42: a malformed stored member event reports bad_row",
    { generated: Schema.NonEmptyString.check(Schema.isMaxLength(256)) },
    ({ generated }) =>
      Effect.forEach(
        ["bad-row", generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* Effect.gen(function* () {
              const d = yield* Gateway;
              yield* online(d, w);
              const ledger = yield* Ledger;
              yield* ledger.append(
                "gateway/access",
                value,
                lineFor(
                  {
                    by: w.root.sshFingerprint,
                    for: PERSON,
                    sentAt: SENT,
                    seen: 0,
                    parent: null,
                    traceId: TRACE,
                    build: "test-build",
                  },
                  { _tag: "invalid_member" },
                ),
              );
              const text = grantText({
                id: "after-bad-row",
                key: w.otherWindow.raw,
                for: PERSON,
                to: "project-a",
                as: "window",
                saw: SAW,
                sentAt: SENT,
              });
              expect(yield* Effect.flip(d.grant({ text, armored: yield* w.root.sign(text) }))).toMatchObject({
                _tag: "LedgerError",
                reason: "bad_row",
              });
            }).pipe(w.provide);
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});
