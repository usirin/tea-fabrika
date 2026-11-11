// P8, next/. Real P11/P12 regressions. The tiny program below is exam code, not real notes.
// Source: next/packages/libfabrika/src/app/runner.test.ts at 9b48d622b5d4.
// P13 owns the real notes bindings named at the end of this file.
import { DatabaseSync } from "node:sqlite";
import { Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { expect, it } from "@effect/vitest";
import {
  Alarm,
  CheckedWriter,
  Gateway,
  Id,
  Input,
  Program,
  ProgramDown,
  ProgramLoader,
  ProgramRunner,
  Recording,
  stepper,
  WatcherManager,
  type Incoming,
  type Refusal,
  type Update,
} from "@kampus/libfabrika";
import * as ClientManagerLedger from "@kampus/libfabrika/access/ClientManagerLedger";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { Doorbell, Ledger } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { Owner, Recipient, Start } from "@kampus/libfabrika/processes/Process";
import { ProcessIdGenerator } from "@kampus/libfabrika/processes/ProcessIdGenerator";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import { ProcessStore } from "@kampus/libfabrika/runtime/ProcessStore";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Archive } from "@kampus/libfabrika/telemetry/Archive";
import { RecordManager } from "@kampus/libfabrika/telemetry/Records";
import { SpanSink } from "@kampus/libfabrika/telemetry/Sink";
import { KeyLine, writeSshsig } from "@kampus/libfabrika/transport/Sshsig";
import { Arbitrary, Cause, Effect, Exit, FileSystem, Layer, Result, Schema, Stream } from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { TestClock } from "effect/testing";

const opts = { arbitrary: { seed: 119120, runs: 300, size: 4096, concurrency: 1 }, timeout: 60_000 };
const number = (min: number, max: number) => Schema.Int.check(Schema.isBetween({ minimum: min, maximum: max }));
const text = (max: number) => Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(max));

const Body = Schema.Union([
  text(4096),
  Schema.Literals(["مرحبا 🌱", "\n  trailing  \n", "# heading\n```ts\nconst n = 1;\n```", ""]),
]);

const RefusalCases = Arbitrary.schema(
  Schema.Struct({
    reason: text(96),
    now: Schema.optionalKey(number(-4096, 4096)),
    most: Schema.optionalKey(number(-4096, 4096)),
    body: Body,
  }),
);

const ReplayCases = Arbitrary.array(Arbitrary.schema(Body), { minLength: 0, maxLength: 32 });
const Model = Schema.Struct({ body: Schema.String, version: Schema.Int });
type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("save"),
    body: Schema.String,
    base: Schema.Number,
    work: Schema.Boolean,
  }),
  // A person-only write port, so the runner's person-only refusal has a real port to guard.
  Schema.Struct({ type: Schema.Literal("guard"), body: Schema.String }),
]);
type Msg = typeof Msg.Type;
const probe = Cmd.make("probe", { input: Schema.Struct({}), ok: Schema.Null, err: [] });
const empty = { body: "", version: 0 };

const makeProgram = (refuse: (s: Model, m: Msg) => Refusal | null, throws = false) => {
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [probe],
    init: (loaded) => [loaded ?? empty, []],
    update: {
      save: (s, m) => {
        if (throws) {
          throw new Error("exam saved fold failed");
        }

        return [{ body: m.body, version: s.version + 1 }, m.work ? [probe({})] : []];
      },
      guard: (s, m) => [{ body: m.body, version: s.version + 1 }, [probe({})]],
      probe_ok: (s) => [s, []],
      probe_err: (s) => [s, []],
    },
  });
  return Program.make({
    name: "notes-exam",
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse,
    inputs: {
      save: "Exam save",
      guard: { description: "Exam person-only save", personOnly: true },
      // A read port: never a write, so a fresh input naming it is bad_msg.
      peek: Input.cases.read.make({
        schema: Schema.Struct({ type: Schema.Literal("peek") }),
        description: "Exam read",
        answer: (v: Model) => v.version,
      }),
    },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};

const person = "person_0000000000e008000000000001";
const process = Schema.decodeUnknownSync(Id.Process)("process_0000000000e008000000000001");
const writer = Writer.cases.agent.make({ key: "SHA256:exam-agent", for: person });

const name = "notes-exam:1",
  build = "p8-exam";

const id = (prefix: "input" | "letter", n: number) => `${prefix}_0000000000e008${n.toString(16).padStart(12, "0")}`;

const incoming = (n: number, body: string, base = 0, work = false): Incoming => ({
  id: id("letter", n),
  envelope: {
    id: Schema.decodeUnknownSync(Id.InputId)(id("input", n)),
    by: writer,
    arrivedAt: n,
    input: { type: "save", body, base, work },
  },
  sentAt: "2030-01-01T00:00:00Z",
  seen: 0,
  span: { traceId: "00000000000000000000000000000001", spanId: "0000000000000001" },
});

const world = Effect.fnUntraced(function* (program: ReturnType<typeof makeProgram>) {
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  );
  const sql = nodeSql(db);
  const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
  const ledger = Layer.mergeAll(LedgerSql.layer(sql, { reader: "p8" }), LedgerTransactionSql.layer(sql)).pipe(
    Layer.provide(quiet),
  );
  let nextProcess = 0;
  const manager = ProcessManager.layer(
    {
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "exam", session: process }),
      by: "SHA256:exam-brain",
    },
    Effect.sync(() => `process_0000000000e008${(++nextProcess).toString(16).padStart(12, "0")}`),
  ).pipe(Layer.provide(ledger));
  const shared = Layer.mergeAll(Mailbox.layer, ProcessStore.layer(sql, { process })).pipe(Layer.provideMerge(ledger));
  const mail = yield* Mailbox.pipe(Effect.provide(shared));
  const store = yield* ProcessStore.pipe(Effect.provide(shared));
  const log = yield* Ledger.pipe(Effect.provide(ledger));
  const updates: Update[] = [],
    calls: string[] = [];
  let blockAppend = false;
  let alarmAt: number | null = null;
  const append = (i: Incoming) =>
    mail.send(name, i.id, i.envelope.input, {
      by: i.envelope.by.key,
      for: i.envelope.by.for,
      parent: i.envelope.id,
      sentAt: i.sentAt,
      seen: i.seen,
      traceId: i.span.traceId,
      build,
    });
  const wiring = Layer.mergeAll(
    shared,
    ProgramLoader.layer(
      { "notes-exam": program },
      {
        probe: () =>
          Effect.sync(() => {
            calls.push("cmd");
            return Outcome.ok(null);
          }),
      },
    ),
    Layer.succeed(CheckedWriter, {
      append: (i) => {
        calls.push("append");
        return blockAppend ? Effect.succeed({ _tag: "refused", reason: "seen_ahead" } as const) : append(i);
      },
      commit: () => Effect.die("exam has no writes"),
      own: () => Effect.die("exam has no own writes"),
    }),
    Layer.succeed(WatcherManager, {
      publish: (_client, update) =>
        Effect.sync(() => {
          updates.push(update);
        }),
    }),
    Layer.succeed(Alarm, {
      set: (at) =>
        Effect.sync(() => {
          alarmAt = at;
        }),
    }),
    Layer.succeed(Recording, { flush: Effect.void }),
  );
  // P34 (PR 760): every runner is supervised, so recovery and the ProcessManager are always wired,
  // and its process is started first, as libfabrika's runner.test.ts boots it.
  const boot = ProcessManager.use((p) =>
    p.status(name).pipe(
      Effect.catch(() =>
        p.start(Start.cases.first.make({ id: "p8-start", name, code: { program: program.name, hash: build } }), {
          by: writer.key,
          for: person,
          sentAt: "2026-11-09T00:00:00Z",
          seen: 0,
          parent: null,
          traceId: "00000000000000000000000000000001",
          build,
        }),
      ),
    ),
  ).pipe(Effect.provide(manager));
  const runner = () =>
    boot.pipe(
      Effect.andThen(
        ProgramRunner.pipe(
          Effect.provide(
            ProgramRunner.layer(
              { id: process, name, program: program.name, build, owner: writer },
              { recovery: { sql, name, capacity: 1024 ** 3 } },
            ).pipe(Layer.provide(Layer.mergeAll(wiring, manager))),
          ),
        ),
      ),
    );
  return {
    runner,
    door: Effect.fnUntraced(function* (runner: typeof ProgramRunner.Service) {
      // Ephemeral signing material only. This helper reads no key file.
      const web = <A>(f: () => Promise<A>) =>
        Effect.tryPromise({ try: f, catch: () => new Error("test crypto failed") });
      const pair = yield* web(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
      const raw = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
      const fingerprint = `SHA256:${Base64.encode(new Uint8Array(yield* web(() => crypto.subtle.digest("SHA-256", raw)))).replace(/=+$/, "")}`;
      const blob = new Uint8Array(51);
      new DataView(blob.buffer).setUint32(0, 11);
      blob.set(new TextEncoder().encode("ssh-ed25519"), 4);
      new DataView(blob.buffer).setUint32(15, 32);
      blob.set(raw, 19);
      const line = Schema.decodeUnknownSync(KeyLine)(`ssh-ed25519 ${Base64.encode(blob)}`);
      const founder = {
        name: "P8",
        person,
        keys: [line],
        window: Base64Url.encode(raw),
        by: "SHA256:exam-founder",
        build,
      };
      const env = Layer.mergeAll(
        ledger,
        ClientManagerLedger.layer(founder).pipe(Layer.provide(ledger)),
        SpanSink.layer(sql, { object: process }),
        RecordManager.memory(4 * 1024 * 1024),
        Archive.memory,
        Id.Generator.layer,
        ProcessIdGenerator.layer,
      );
      let deliveries = 0;
      const layer = Gateway.layer({
        sql,
        founder,
        name: "p8",
        url: "https://fabrika.test/p8",
        origins: ["https://fabrika.test"],
        versions: [1],
        location: "exam",
        build,
        waiting: { most: 20, ttl: 600000 },
        ping: { min: 10000, max: 60000 },
        inputCap: 4096,
        spentCap: 4096,
        nextProcess: () => Id.Generator.use((g) => g.next(Id.Process)).pipe(Effect.orDie),
        deliver: (_p, _envelope, _span, input) =>
          Effect.suspend(() => {
            deliveries++;
            return runner.msg(input);
          }),
        notify: () => Effect.void,
        inputs: {
          schema: Msg,
          personOnly: [],
          raw: [],
          log: Schema.toCodecJson(Msg),
          name: (m) => m.type,
        },
        events: { personOnly: [] },
      }).pipe(Layer.provide(env));
      const connect = Effect.gen(function* () {
        const door = yield* Gateway.pipe(Effect.provide(layer)),
          client = yield* door.connect(),
          nonce = yield* door.challenge(client);
        const signed = yield* writeSshsig({
          text: `fabrika-hello\nhttps://fabrika.test/p8\nexam\n${nonce}`,
          line,
          space: "fabrika-client",
          sign: (bytes) =>
            web(() => crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(bytes))).pipe(
              Effect.map((a) => new Uint8Array(a)),
            ),
        });
        expect(
          (yield* door.initialize(
            client,
            {
              versions: [1],
              has: [],
              ping: "30s",
              key: Base64Url.encode(raw),
              tab: "exam",
              nonce,
              platform: "browser",
              os: "ios",
              sentAt: "2030-01-01T00:00:00Z",
              as: "window",
              signed,
            },
            { url: "https://fabrika.test/p8", tab: "exam", name: fingerprint },
          ))._tag,
        ).toBe("online");
        return { door, client };
      });
      return {
        connect,
        deliveries: () => deliveries,
        bindings: () => sql.exec("SELECT value FROM gateway_bindings").map((r) => JSON.parse(String(r.value))),
      };
    }),
    store,
    append,
    updates,
    calls,
    block: () => {
      blockAppend = true;
    },
    rows: () => Stream.runCollect(log.read(`${name}/inbox`, 0)),
    boot,
    recover: (runner: typeof ProgramRunner.Service) =>
      Effect.gen(function* () {
        if (alarmAt === null) {
          return yield* Effect.die("crash has no restart alarm");
        }

        const at = alarmAt;
        yield* TestClock.setTime(at);
        yield* runner.due(at);
      }),
    receipts: () =>
      sql.exec("SELECT value FROM process_receipts WHERE name=?", name).map((row) => JSON.parse(String(row.value))),
    dead: () => sql.exec("SELECT * FROM entries WHERE stream LIKE '%/dead'"),
    down: () => sql.exec("SELECT * FROM entries WHERE \"_tag\"='down'"),
  };
});

const unchanged = (before: unknown, after: unknown) => expect(after).toEqual(before);
const refusal = (actual: unknown, want: Refusal) => expect(actual).toEqual({ _tag: "refused", ...want });

const failedAs = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "ProgramDown", reason });
  }
};

const replayRefuse = (spy: { calls: number }): never => {
  spy.calls++;
  throw new Error("refuse must not run on accepted history");
};

it.effect.prop(
  "p22: program refusal keeps reason/now/most without append, view, patch or Cmd",
  { c: RefusalCases },
  ({ c }) =>
    Effect.gen(function* () {
      const { body, ...want } = c;
      const w = yield* world(makeProgram(() => want));
      const runner = yield* w.runner();
      const before = yield* runner.open("watcher-1");
      yield* runner.open("watcher-2");
      w.updates.length = 0;
      refusal(yield* runner.msg(incoming(1, body, 0, true)), want);
      unchanged(before, yield* runner.open("watcher-1"));
      expect(yield* w.rows()).toEqual([]);
      expect(w.updates.filter((u) => u.type === "patch")).toEqual([]);
      expect(w.calls).toEqual([]);
    }),
  opts,
);

it.prop(
  "p22: malformed fresh shapes are bad_msg; plants cannot replace program refusal",
  { c: RefusalCases },
  ({ c }) => {
    const { body, ...want } = c;
    const pure = Result.getOrThrow(stepper(makeProgram(() => want)));
    refusal(pure.step(empty, { type: "save", body: 17 }), { reason: "bad_msg" });
    refusal(pure.step(empty, { type: "save", body, base: 0, work: false }), want);
    expect(() => refusal({ _tag: "refused", reason: `${want.reason}!` }, want)).toThrow();
  },
  opts,
);

// Every runner bad_msg path (app/runner.ts accept and receive): no type or an undeclared one, a read port, a
// person-only port from an agent, an input that carries its own parent, and a declared port whose schema fails.
const BAD = ["untyped", "unknown", "read", "person_only", "parent", "admit_wrong", "admit_missing"] as const;
type Bad = (typeof BAD)[number];

const Wrong = Schema.Union([
  number(-4096, 4096),
  Schema.Boolean,
  Schema.Null,
  text(128),
  Schema.Array(text(128)).check(Schema.isMaxLength(8)),
]);

const BadMsgCases = Arbitrary.schema(
  Schema.Struct({
    type: Schema.Union([
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(96)),
      Schema.Literals(["__proto__", "constructor", "toString", "hasOwnProperty", "probe_ok"]),
    ]),
    body: Body,
    base: number(0, 64),
    parent: Wrong,
    wrong: Wrong,
    field: Schema.Literals(["body", "base", "work"]),
    plant: Schema.Literals(["append", "publish", "cmd"]),
    on: Schema.Literals(BAD),
  }),
);

type BadMsgCase = typeof BadMsgCases extends Arbitrary.Arbitrary<infer C> ? C : never;

// A value of the wrong type for the field, whatever Wrong drew.
const wrongFor = (field: BadMsgCase["field"], wrong: BadMsgCase["wrong"]) =>
  field === "body"
    ? typeof wrong === "string"
      ? wrong.length
      : wrong
    : field === "base"
      ? typeof wrong === "number"
        ? String(wrong)
        : wrong
      : typeof wrong === "boolean"
        ? Number(wrong)
        : wrong;

const badInput = (c: BadMsgCase, kind: Bad): unknown => {
  // work is true, so a bad input that got through would also run a Cmd.
  const save = { type: "save", body: c.body, base: c.base, work: true };

  if (kind === "untyped") {
    return c.wrong;
  }

  if (kind === "unknown") {
    return { ...save, type: ["save", "guard", "peek"].includes(c.type) ? `${c.type}.undeclared` : c.type };
  }

  if (kind === "read") {
    return { type: "peek" };
  }

  if (kind === "person_only") {
    return { type: "guard", body: c.body };
  }

  if (kind === "parent") {
    return { ...save, parent: c.parent };
  }

  if (kind === "admit_wrong") {
    return { ...save, [c.field]: wrongFor(c.field, c.wrong) };
  }

  const { [c.field]: _gone, ...missing } = save;
  return missing;
};

const fresh = (n: number, input: unknown, by: Incoming["envelope"]["by"] = writer): Incoming => ({
  ...incoming(n, ""),
  envelope: { ...incoming(n, "").envelope, by, input },
});

type World = Effect.Success<ReturnType<typeof world>>;
type Runner = typeof ProgramRunner.Service;
const patches = (w: World) => w.updates.filter((u) => u.type === "patch");

// p22: a bad fresh shape returns bad_msg, writes no accepted input, changes no view, publishes no patch, runs no Cmd.
const freshBadMsg = Effect.fnUntraced(function* (
  w: World,
  runner: Runner,
  send: (i: Incoming) => Effect.Effect<unknown, unknown>,
  i: Incoming,
) {
  const before = (yield* runner.open("watcher-1")).view;
  refusal(yield* send(i), { reason: "bad_msg" });
  expect(yield* w.rows()).toEqual([]);
  expect(patches(w)).toEqual([]);
  expect(w.calls).toEqual([]);
  expect(w.receipts()).toEqual([]);
  unchanged(before, (yield* runner.open("watcher-1")).view);
});

it.effect.prop(
  "p22: every malformed or disallowed fresh input through runner.msg is bad_msg and changes nothing",
  { c: BadMsgCases },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null));
      const runner = yield* w.runner();
      yield* runner.open("watcher-1");
      w.updates.length = 0;

      for (const [n, kind] of BAD.entries()) {
        yield* freshBadMsg(w, runner, (i) => runner.msg(i), fresh(n + 1, badInput(c, kind)));
      }

      // Clean control: the person-only port is real; a person's own guard input is accepted, appended and run.
      const person = Writer.cases.person.make({ key: "SHA256:exam-person", for: writer.for });
      expect(yield* runner.msg(fresh(BAD.length + 1, badInput(c, "person_only"), person))).toMatchObject({
        _tag: "accepted",
      });
      expect((yield* w.rows())[0]).toMatchObject({ id: id("letter", BAD.length + 1) });
      expect(w.calls).toEqual(["append", "cmd"]);
    }),
  opts,
);

it.effect.prop(
  "checker plants: a runner that appends, publishes or runs a Cmd on a bad fresh input fails the p22 law",
  { c: BadMsgCases },
  ({ c }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null));
      const runner = yield* w.runner();
      yield* runner.open("watcher-1");
      w.updates.length = 0;
      const planted = (i: Incoming) =>
        c.plant === "append"
          ? w.append(i).pipe(Effect.andThen(runner.msg(i)))
          : Effect.sync(() => {
              if (c.plant === "publish") {
                w.updates.push({ type: "patch", base: 0, rev: 1, patch: [] });
              } else {
                w.calls.push("cmd");
              }
            }).pipe(Effect.andThen(runner.msg(i)));
      const exit = yield* Effect.exit(freshBadMsg(w, runner, planted, fresh(1, badInput(c, c.on))));
      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        // The refusal still reads bad_msg; the law fails on the planted row, patch or Cmd.
        expect(Cause.pretty(exit.cause)).toContain("to deeply equal []");
      }
    }),
  opts,
);

it.effect.prop(
  "p22/p25: saved mail with a bad shape is refused on replay, kept in the inbox, and replay goes on past it",
  { c: BadMsgCases },
  ({ c }) =>
    Effect.gen(function* () {
      const spy = { calls: 0 };
      const w = yield* world(
        makeProgram(() => {
          spy.calls++;
          return null;
        }),
      );
      const runner = yield* w.runner();
      const before = (yield* runner.open("watcher-1")).view;
      w.updates.length = 0;

      // Mail, not accepted: each letter reaches the runner's replay receive path.
      for (const [n, kind] of BAD.entries()) {
        const i = fresh(n + 1, badInput(c, kind));
        expect((yield* w.append(i))._tag).toBe("placed");
      }

      const kept = yield* w.rows();
      expect(kept).toHaveLength(BAD.length);
      unchanged(before, (yield* runner.open("watcher-2")).view);
      unchanged(kept, yield* w.rows());
      // Watchers only see the read position move past the mail: a patch with no change to the view.
      expect(patches(w).flatMap((u) => (u.type === "patch" ? u.patch : []))).toEqual([]);
      expect(w.calls).toEqual([]);
      expect(w.dead()).toEqual([]);
      expect(spy.calls).toBe(0);
      // A good letter after them still folds: the bad ones neither stop nor move the inbox.
      yield* w.append(incoming(BAD.length + 1, c.body));
      expect((yield* runner.open("watcher-3")).view).toEqual({ body: c.body, version: 1 });
      expect(yield* w.rows()).toHaveLength(BAD.length + 1);
      expect(w.dead()).toEqual([]);
    }),
  opts,
);

it.effect.prop(
  "p25: an accepted saved letter whose shape no longer decodes crashes, is kept, and is never re-refused",
  { c: BadMsgCases },
  ({ c }) =>
    Effect.gen(function* () {
      for (const kind of ["admit_wrong", "admit_missing"] as const) {
        const spy = { calls: 0 };
        const w = yield* world(makeProgram(() => replayRefuse(spy)));
        const m = fresh(1, badInput(c, kind)),
          placed = yield* w.append(m);

        if (placed._tag !== "placed") {
          return yield* Effect.die("seed append refused");
        }

        yield* w.store.save({ saved: { v: 1, build, model: empty, after: 0 }, turn: null, cmds: [] }, [
          { id: m.id, rev: placed.rev, pos: placed.pos },
        ]);
        const before = yield* w.rows(),
          runner = yield* w.runner();
        failedAs(yield* Effect.exit(runner.open("watcher")), "saved_letter");
        unchanged(before, yield* w.rows());
        expect(w.updates).toEqual([]);
        expect(w.calls).toEqual([]);
        expect(w.dead()).toEqual([]);
        expect(spy.calls).toBe(0);
      }
    }),
  opts,
);

it.effect.prop(
  "p22: a successful fresh step cannot install or run before append succeeds",
  { body: Arbitrary.schema(text(4096)) },
  ({ body }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null));
      const runner = yield* w.runner(),
        before = yield* runner.open("watcher");
      w.updates.length = 0;
      w.block();
      refusal(yield* runner.msg(incoming(1, body, 0, true)), { reason: "seen_ahead" });
      unchanged(before, yield* runner.open("watcher"));
      expect(yield* w.rows()).toEqual([]);
      expect(w.updates.filter((u) => u.type === "patch")).toEqual([]);
      expect(w.calls).toEqual(["append"]);
    }),
  opts,
);

it.effect.prop(
  "p25: a fresh throw is ProgramDown, never a refusal or accepted letter",
  { body: Arbitrary.schema(text(4096)) },
  ({ body }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null, true));
      const runner = yield* w.runner();
      yield* runner.open("watcher");
      w.updates.length = 0;
      failedAs(yield* Effect.exit(runner.msg(incoming(1, body))), "step");
      expect(yield* w.rows()).toEqual([]);
      expect(w.calls).toEqual([]);
      expect(w.updates).toEqual([]);
    }),
  opts,
);

it.prop(
  "p25: a ProgramDown names its saved error class, else the thrown class",
  { name: Arbitrary.schema(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(96))) },
  ({ name }) => {
    expect(new ProgramDown({ reason: "step", error: name, cause: new RangeError("x") }).errorClass).toBe(name);
    expect(new ProgramDown({ reason: "step", cause: new RangeError("x") }).errorClass).toBe("RangeError");
    expect(new ProgramDown({ reason: "step", cause: null }).errorClass).toBe("null");
    expect(new ProgramDown({ reason: "step" }).errorClass).toBe("ProgramDown");
  },
  opts,
);

it.effect.prop(
  "p25: accepted replay never calls refuse and original retries survive later saves",
  { bodies: ReplayCases },
  ({ bodies }) =>
    Effect.gen(function* () {
      const spy = { calls: 0 };
      const w = yield* world(makeProgram(() => replayRefuse(spy)));
      const placed = [];

      for (const [i, body] of bodies.entries()) {
        const m = incoming(i + 1, body, i);
        const saved = yield* w.append(m);

        if (saved._tag !== "placed") {
          return yield* Effect.die("exam seed did not append");
        }

        placed.push({ id: m.id, rev: saved.rev, pos: saved.pos });
      }

      // Mail alone is not acceptance. Persist accepted placings and the checkpoint before them.
      yield* w.store.save({ saved: { v: 1, build, model: empty, after: 0 }, turn: null, cmds: [] }, placed);
      const runner = yield* w.runner();
      expect((yield* runner.open("watcher")).view).toEqual({
        body: bodies.at(-1) ?? "",
        version: bodies.length,
      });

      for (const [i, body] of bodies.entries()) {
        const result = yield* runner.msg(incoming(i + 1, body, i));
        expect(result).toEqual({ _tag: "accepted", rev: placed[i]?.rev, pos: placed[i]?.pos });
      }

      expect(spy.calls).toBe(0);
      expect(yield* w.rows()).toHaveLength(bodies.length);
      expect(w.calls).toEqual([]);
    }),
  { ...opts, timeout: 60_000 },
);

it.effect.prop(
  "p25: a saved fold failure crashes and retains every accepted input",
  { body: Arbitrary.schema(text(4096)) },
  ({ body }) =>
    Effect.gen(function* () {
      const spy = { calls: 0 };
      const w = yield* world(makeProgram(() => replayRefuse(spy), true));
      const m = incoming(1, body),
        placed = yield* w.append(m);

      if (placed._tag !== "placed") {
        return yield* Effect.die("seed append refused");
      }

      yield* w.store.save({ saved: { v: 1, build, model: empty, after: 0 }, turn: null, cmds: [] }, [
        { id: m.id, rev: placed.rev, pos: placed.pos },
      ]);
      const before = yield* w.rows(),
        runner = yield* w.runner();
      failedAs(yield* Effect.exit(runner.open("watcher")), "saved_letter");
      unchanged(before, yield* w.rows());
      expect(w.updates).toEqual([]);
      // Amendment 4: the crash re-refuses no saved letter.
      expect(spy.calls).toBe(0);
    }),
  opts,
);

// Source: next/packages/libfabrika/src/workers/supervision.laws.test.ts at 9b48d622b5d4.
it.effect.prop(
  "p25: default delivery limit counts three fresh failures, then returns dead",
  { body: Arbitrary.schema(Body) },
  ({ body }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null, true));
      yield* w.boot;
      const runner = yield* w.runner(),
        input = incoming(1, body);

      for (let tries = 1; tries <= 3; tries++) {
        const result = yield* Effect.exit(runner.msg(input));

        if (tries === 3) {
          expect(result).toEqual(Exit.succeed({ _tag: "refused", reason: "dead" }));
        } else {
          failedAs(result, "step");
        }

        expect(w.receipts()).toMatchObject([
          {
            tries,
            errors: Array.from({ length: tries }, () => "Error"),
            result: tries === 3 ? { _tag: "refused", reason: "dead" } : null,
          },
        ]);
        expect(yield* w.rows()).toEqual([]);
        expect(w.dead()).toHaveLength(tries === 3 ? 1 : 0);

        if (tries < 3) {
          yield* w.recover(runner);
        }
      }
    }),
  opts,
);

const terminalAnswer = (actual: unknown) => expect(actual).toEqual({ _tag: "refused", reason: "dead" });

it.effect.prop(
  "p25: the real Gateway answers dead on terminal delivery and its saved settled retry",
  { body: Arbitrary.schema(Body) },
  ({ body }) =>
    Effect.gen(function* () {
      const w = yield* world(makeProgram(() => null, true));
      yield* w.boot;
      const runner = yield* w.runner(),
        sender = yield* w.door(runner),
        first = yield* sender.connect;
      const request = {
        pid: process,
        letter: id("letter", 1),
        m: { type: "save", body, base: 0, work: false },
        sentAt: "2030-01-01T00:00:00Z",
        seen: 0,
      };

      for (let tries = 1; tries <= 3; tries++) {
        const answer = yield* Effect.exit(first.door.route(first.client, "process.send", request));

        if (tries < 3) {
          failedAs(answer, "step");
          yield* w.recover(runner);
        } else {
          expect(Exit.isSuccess(answer)).toBe(true);

          if (Exit.isSuccess(answer)) {
            terminalAnswer(answer.value);
          }
        }
      }

      expect(sender.deliveries()).toBe(3);
      expect(sender.bindings()).toMatchObject([
        { state: { _tag: "settled", result: { _tag: "refused", reason: "dead" } } },
      ]);
      // A new real Gateway layer reads the saved binding; the runner must not receive a fourth delivery.
      const restarted = yield* sender.connect;
      terminalAnswer(yield* restarted.door.route(restarted.client, "process.send", request));
      expect(sender.deliveries()).toBe(3);
      expect(w.dead()).toHaveLength(1);
      expect(yield* w.rows()).toEqual([]);

      for (const bad of [
        { _tag: "ok", result: { _tag: "refused", reason: "dead" } },
        { _tag: "ok", result: body },
      ]) {
        expect(() => terminalAnswer(bad)).toThrow();
      }
    }),
  { arbitrary: { seed: 119120, runs: 20, size: 4096, concurrency: 1 } },
);

it.effect.prop(
  "p25: saved failure restarts with backoff, no dead move and no down before the brake",
  { body: Arbitrary.schema(Body) },
  ({ body }) =>
    Effect.gen(function* () {
      const spy = { calls: 0 };
      const w = yield* world(makeProgram(() => replayRefuse(spy), true));
      yield* w.boot;
      const input = incoming(1, body),
        placed = yield* w.append(input);

      if (placed._tag !== "placed") {
        return yield* Effect.die("seed append refused");
      }

      yield* w.store.save({ saved: { v: 1, build, model: empty, after: 0 }, turn: null, cmds: [] }, [
        { id: input.id, rev: placed.rev, pos: placed.pos },
      ]);
      const before = yield* w.rows(),
        runner = yield* w.runner();
      failedAs(yield* Effect.exit(runner.open("watcher")), "saved_letter");
      expect(spy.calls).toBe(0);
      expect(w.down()).toEqual([]);
      expect(w.dead()).toEqual([]);
      unchanged(before, yield* w.rows());
      yield* w.recover(runner).pipe(Effect.exit);
      // Amendment 4: the restart re-refuses no saved letter either.
      expect(spy.calls).toBe(0);
      unchanged(before, yield* w.rows());
      expect(w.dead()).toEqual([]);
      expect(w.down()).toEqual([]);
      expect(w.receipts().every((r) => r.tries === 0)).toBe(true);
    }),
  opts,
);

it.prop(
  "checker controls: append-first, patch, Cmd, changed refusal and swallowed throw plants fail",
  { c: RefusalCases },
  ({ c }) => {
    const { body, ...want } = c;
    refusal({ _tag: "refused", ...want }, want);
    unchanged({ log: [], model: empty, patches: [], cmds: [] }, { log: [], model: empty, patches: [], cmds: [] });

    for (const part of ["log", "patches", "cmds"] as const) {
      expect(() => unchanged({ [part]: [] }, { [part]: ["planted"] })).toThrow();
    }

    expect(() => refusal({ _tag: "refused", reason: "bad_msg", now: 4097 }, want)).toThrow();
    expect(() => failedAs(Exit.succeed({ _tag: "refused", reason: "step" }), "step")).toThrow();
    expect(() => unchanged({ body, version: 1 }, empty)).toThrow();
  },
  opts,
);

const notesFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(new URL("../../../../programs/notes", import.meta.url).pathname);
}).pipe(Effect.provide(NodeFileSystem.layer));

// Source presence, never a caught import error. P13 installs a test-local driver over its real
// program/runner here. These observations are exam types, not a proposed product API.
type NotesSnapshot = {
  readonly log: ReadonlyArray<unknown>;
  readonly model: unknown;
  readonly view: unknown;
  readonly patches: ReadonlyArray<unknown>;
  readonly cmds: ReadonlyArray<unknown>;
  readonly history: ReadonlyArray<NoteHistory>;
};

type SaveDetails = {
  readonly how?: "pause" | "leave" | "done" | "kept";
  readonly from?: { readonly note: string; readonly version: number };
};

type NoteHistory = SaveDetails & {
  readonly note: string;
  readonly version: number;
  readonly body: string;
  readonly by: string;
  readonly arrivedAt: number;
  readonly sentAt: string;
};

type SavedAnswer =
  | { readonly _tag: "accepted"; readonly rev: number; readonly pos: number }
  | { readonly _tag: "refused"; readonly reason: string; readonly now?: number; readonly most?: number };

type NotesDriver = {
  readonly most: number;
  readonly snapshot: Effect.Effect<NotesSnapshot>;
  readonly save: (
    s: SaveDetails & {
      readonly id: string;
      readonly note: string;
      readonly body: string;
      readonly base: number;
      readonly sentAt: string;
      readonly by: typeof writer;
    },
  ) => Effect.Effect<SavedAnswer>;
  readonly frozen: Effect.Effect<{
    readonly a3: SavedAnswer;
    readonly a4: SavedAnswer;
    readonly retryA3: SavedAnswer;
    readonly staleA3: SavedAnswer;
    readonly history: ReadonlyArray<NoteHistory>;
    readonly final: ReadonlyArray<{
      readonly note: string;
      readonly version: number;
      readonly body: string;
    }>;
    readonly refuseCalls: number;
  }>;
};

const requireNotes = (): NotesDriver => {
  throw new Error(
    "P13 started: bind the real notes program, store and MOST before its build; missing bindings are a failure",
  );
};

const notes = Effect.fnUntraced(function* (ctx: { skip: (reason?: string) => never }) {
  if (!(yield* notesFiles)) {
    ctx.skip("not built: P13 notes");
  }

  return requireNotes();
});

const note = "note_0000000000e008000000000001";

const saveInput = (n: number, body: string, base: number) => ({
  id: id("letter", n),
  note,
  body,
  base,
  sentAt: "2030-01-01T00:00:00Z",
  by: writer,
});

const accepted = (a: SavedAnswer) => {
  expect(a._tag).toBe("accepted");
  return a;
};

const unchangedNotes = (before: NotesSnapshot, after: NotesSnapshot) => expect(after).toEqual(before);

const SaveCases = Arbitrary.schema(
  Schema.Struct({
    body: Body,
    how: Schema.optionalKey(Schema.Literals(["pause", "leave", "done", "kept"])),
    from: Schema.optionalKey(
      Schema.Struct({
        note: Schema.Literals([note, "note_0000000000e008000000000002"]),
        version: number(0, 64),
      }),
    ),
    arrivedAt: number(0, 281474976710655),
    clock: number(0, 281474976710655),
  }),
);

const savedMetadata = (actual: unknown, expected: unknown) => expect(actual).toEqual(expected);

const staleAnswer = (actual: SavedAnswer, now: number) => {
  expect(actual._tag).toBe("refused");
  expect(actual).toEqual({ _tag: "refused", reason: "changed_elsewhere", now });
};

const tooLong = (actual: SavedAnswer, most: number) =>
  expect(actual).toEqual({ _tag: "refused", reason: "too_long", most });

it.effect.prop(
  "not built: P13 / p52 saves exact bytes and writer; skewed writer clocks never decide",
  { c: SaveCases },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const a = yield* notes(ctx),
        b = requireNotes();
      const details: SaveDetails = {
        ...(c.how === undefined ? {} : { how: c.how }),
        ...(c.from === undefined ? {} : { from: c.from }),
      };
      const sentAt = new Date(c.clock).toISOString();
      yield* TestClock.setTime(c.arrivedAt);
      accepted(yield* a.save({ ...saveInput(1, c.body, 0), ...details, sentAt }));
      accepted(
        yield* b.save({
          ...saveInput(1, c.body, 0),
          ...details,
          sentAt: new Date(281474976710655 - c.clock).toISOString(),
        }),
      );
      const left = yield* a.snapshot,
        right = yield* b.snapshot;
      expect(left.model).toEqual(right.model);
      expect(left.view).toEqual(right.view);
      expect(left.log).toHaveLength(1);
      expect(left.log[0]).toMatchObject({
        by: writer.key,
        for: writer.for,
        arrivedAt: c.arrivedAt,
        sentAt,
        body: { m: { type: "save", value: { note, base: 0, body: c.body, ...details } } },
      });
      const Value = Schema.Struct({
        body: Schema.Struct({ m: Schema.Struct({ value: Schema.Unknown }) }),
      });
      savedMetadata(Schema.decodeUnknownSync(Value)(left.log[0]).body.m.value, {
        note,
        base: 0,
        body: c.body,
        ...details,
      });
      savedMetadata(left.history, [
        {
          note,
          version: 1,
          body: c.body,
          ...details,
          by: writer.key,
          arrivedAt: c.arrivedAt,
          sentAt,
        },
      ]);
      savedMetadata(right.history, [
        {
          note,
          version: 1,
          body: c.body,
          ...details,
          by: writer.key,
          arrivedAt: c.arrivedAt,
          sentAt: new Date(281474976710655 - c.clock).toISOString(),
        },
      ]);
    }),
  opts,
);

it.effect.prop(
  "not built: P13 / p53 retries after later saves, distinct IDs with equal bodies and repeated refusals",
  { bodies: ReplayCases },
  ({ bodies }, ctx) =>
    Effect.gen(function* () {
      const d = yield* notes(ctx),
        body = bodies.join("\n").slice(0, 4096);
      const original = accepted(yield* d.save(saveInput(1, body, 0)));
      accepted(yield* d.save(saveInput(2, body, 1)));
      const before = yield* d.snapshot;
      expect(before.log).toHaveLength(2);
      expect(yield* d.save(saveInput(1, body, 0))).toEqual(original);
      unchangedNotes(before, yield* d.snapshot);

      for (let i = 0; i < 2; i++) {
        expect(yield* d.save(saveInput(3, body, 0))).toEqual({
          _tag: "refused",
          reason: "changed_elsewhere",
          now: 2,
        });
        unchangedNotes(before, yield* d.snapshot);
      }
    }),
  opts,
);

const BaseCases = Arbitrary.schema(
  Schema.Struct({
    version: number(0, 64),
    base: number(-64, 64),
    numerator: number(-64, 64),
    denominator: number(2, 8),
    future: number(1, 64),
    body: text(4096),
  }),
);

type BaseCase = typeof BaseCases extends Arbitrary.Arbitrary<infer C> ? C : never;

const unequalBases = (c: BaseCase) =>
  [
    0,
    ...Array.from({ length: 64 }, (_, i) => -1 - i),
    c.version + c.future,
    c.numerator + 1 / c.denominator,
    c.base,
  ].filter((base) => base !== c.version);

const checkFreshBase = Effect.fnUntraced(function* (
  d: Pick<NotesDriver, "snapshot" | "save">,
  c: BaseCase,
  base: number,
  letter: number,
) {
  const before = yield* d.snapshot;
  staleAnswer(yield* d.save(saveInput(letter, c.body, base)), c.version);
  unchangedNotes(before, yield* d.snapshot);
});

it.effect.prop(
  "not built: P13 / p54 every unequal base, including zero, negative, fractional and future",
  { c: BaseCases },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const d = yield* notes(ctx);

      for (let v = 0; v < c.version; v++) {
        accepted(yield* d.save(saveInput(v + 1, c.body, v)));
      }

      const bases = unequalBases(c);

      for (const [i, base] of bases.entries()) {
        yield* checkFreshBase(d, c, base, c.version + i + 1);
      }

      accepted(yield* d.save(saveInput(c.version + bases.length + 1, c.body, c.version)));
    }),
  opts,
);

it.effect.prop(
  "P13 checker plants: every negative integer, fractional and future base fails at each current version",
  { c: BaseCases },
  ({ c }) =>
    Effect.gen(function* () {
      const bases = unequalBases(c);

      for (let negative = -64; negative < 0; negative++) {
        expect(bases).toContain(negative);
      }

      expect(bases).toContain(c.version + c.future);
      expect(bases).toContain(c.numerator + 1 / c.denominator);
      const snapshot: NotesSnapshot = {
        log: [],
        model: { version: c.version },
        view: { version: c.version },
        patches: [],
        cmds: [],
        history: [],
      };
      const clean = {
        snapshot: Effect.succeed(snapshot),
        save: () => Effect.succeed<SavedAnswer>({ _tag: "refused", reason: "changed_elsewhere", now: c.version }),
      };

      for (const [i, base] of bases.entries()) {
        yield* checkFreshBase(clean, c, base, c.version + i + 1);
        const acceptsOne = {
          ...clean,
          save: (s: Parameters<NotesDriver["save"]>[0]) =>
            s.base === base ? Effect.succeed<SavedAnswer>({ _tag: "accepted", rev: 1, pos: 1 }) : clean.save(),
        };
        const result = yield* Effect.exit(checkFreshBase(acceptsOne, c, base, c.version + i + 1));
        expect(Exit.isFailure(result)).toBe(true);

        if (Exit.isFailure(result)) {
          expect(Cause.pretty(result.cause)).toContain("refused");
        }
      }
    }),
  opts,
);

it.effect.prop(
  "not built: P13 / p54 concurrent same-base saves accept exactly one",
  { body: Arbitrary.schema(Body) },
  ({ body }, ctx) =>
    Effect.gen(function* () {
      const d = yield* notes(ctx);
      const answers = yield* Effect.all([d.save(saveInput(1, body, 0)), d.save(saveInput(2, `${body}!`, 0))], {
        concurrency: 2,
      });
      expect(answers.filter((a) => a._tag === "accepted")).toHaveLength(1);
      expect(answers.filter((a) => a._tag === "refused")).toEqual([
        { _tag: "refused", reason: "changed_elsewhere", now: 1 },
      ]);
      expect((yield* d.snapshot).log).toHaveLength(1);
    }),
  opts,
);

it.effect.prop(
  "not built: P13 / p54 bodies on both sides of notes' actual MOST",
  {
    piece: Arbitrary.schema(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
    offset: Arbitrary.schema(number(1, 64)),
  },
  ({ piece, offset }, ctx) =>
    Effect.gen(function* () {
      const first = yield* notes(ctx);
      expect(first.most).toBeGreaterThan(0);

      for (const length of [0, first.most - 1, first.most, first.most + 1, first.most + offset]) {
        const d = requireNotes(),
          before = yield* d.snapshot;

        for (const chunk of [piece, "界", "🧪", "مرحبا", "א!\\\n"]) {
          const isolated = requireNotes(),
            prior = yield* isolated.snapshot;
          // MOST is the program's string-length limit. Unicode bytes are never flattened to ASCII.
          const body = chunk.repeat(Math.ceil(length / chunk.length)).slice(0, length);
          const a = yield* isolated.save(saveInput(1, body, 0));

          if (length <= isolated.most) {
            accepted(a);
          } else {
            tooLong(a, isolated.most);
            unchangedNotes(prior, yield* isolated.snapshot);
          }
        }

        unchangedNotes(before, yield* d.snapshot);
      }
    }),
  opts,
);

it.effect("format: not built: P13 / frozen A3 replay/retry/stale and independent per-note history", (ctx) =>
  Effect.gen(function* () {
    const d = yield* notes(ctx),
      actual = yield* d.frozen;
    expect(actual.a3).toMatchObject({ _tag: "accepted" });
    expect(actual.a4).toMatchObject({ _tag: "accepted" });
    expect(actual.retryA3).toEqual(actual.a3);
    expect(actual.staleA3).toEqual({ _tag: "refused", reason: "changed_elsewhere", now: 4 });
    expect(actual.refuseCalls).toBe(0);
    expect(actual.history.map((h) => h.version)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(actual.history.map((h) => h.body)).toEqual([
      "",
      "B trailing  ",
      "A\nsecond line\n",
      "B 🌱",
      "A مرحبا\n```ts\nconst n = 3;\n```  ",
      "B kept from A",
      "A final  \n",
      "B final 🧪\nשלום",
    ]);

    for (const [i, h] of actual.history.entries()) {
      savedMetadata(
        {
          by: h.by,
          arrivedAt: h.arrivedAt,
          sentAt: h.sentAt,
          ...(h.how === undefined ? {} : { how: h.how }),
          ...(h.from === undefined ? {} : { from: h.from }),
        },
        [
          {
            by: "SHA256:fixture-person",
            arrivedAt: 1000,
            sentAt: "2030-01-01T00:00:00Z",
            how: "pause",
          },
          {
            by: "SHA256:fixture-person",
            arrivedAt: 1001,
            sentAt: "2020-01-01T00:00:00Z",
            how: "leave",
          },
          {
            by: "SHA256:fixture-person",
            arrivedAt: 1002,
            sentAt: "2040-01-01T00:00:00Z",
            how: "done",
          },
          { by: "SHA256:fixture-agent", arrivedAt: 1003, sentAt: "2010-01-01T00:00:00Z" },
          {
            by: "SHA256:fixture-person",
            arrivedAt: 1004,
            sentAt: "2050-01-01T00:00:00Z",
            how: "pause",
          },
          {
            by: "SHA256:fixture-person",
            arrivedAt: 1005,
            sentAt: "2000-01-01T00:00:00Z",
            how: "kept",
            from: { note, version: 3 },
          },
          {
            by: "SHA256:fixture-person",
            arrivedAt: 1006,
            sentAt: "2060-01-01T00:00:00Z",
            how: "done",
          },
          {
            by: "SHA256:fixture-agent",
            arrivedAt: 1007,
            sentAt: "1990-01-01T00:00:00Z",
            how: "leave",
          },
        ][i],
      );
    }

    expect(actual.final).toEqual([
      { note: "note_0000000000e008000000000002", version: 4, body: "B final 🧪\nשלום" },
      { note, version: 4, body: "A final  \n" },
    ]);
  }),
);

it.prop(
  "P13 checker controls/plants: replace row, duplicate-by-body, base-before-ID and less-than guard fail",
  { body: Arbitrary.schema(Body) },
  ({ body }) => {
    const first = { id: id("letter", 1), body },
      second = { id: id("letter", 2), body };
    const before: NotesSnapshot = {
      log: [first, second],
      model: { version: 2 },
      view: { version: 2 },
      patches: [],
      cmds: [],
      history: [],
    };
    unchangedNotes(before, structuredClone(before));

    for (const bad of [
      { ...before, log: [second] },
      { ...before, log: [first] },
      { ...before, model: { version: 3 } },
      { ...before, patches: ["future base accepted"] },
    ]) {
      expect(() => unchangedNotes(before, bad)).toThrow();
    }

    const original: SavedAnswer = { _tag: "accepted", rev: 3, pos: 1 };
    expect(() => expect({ _tag: "refused", reason: "changed_elsewhere" }).toEqual(original)).toThrow();
  },
  opts,
);

it.prop(
  "P13 checker controls/plants: lost save metadata, wrong stale fields and too_long fail",
  { c: SaveCases, now: Arbitrary.schema(number(0, 64)) },
  ({ c, now }) => {
    const expected = {
      body: c.body,
      by: writer.key,
      arrivedAt: c.arrivedAt,
      sentAt: new Date(c.clock).toISOString(),
      how: c.how ?? "kept",
      from: c.from ?? { note, version: now },
    };
    savedMetadata(structuredClone(expected), expected);

    for (const field of ["how", "from", "by", "arrivedAt", "sentAt"] as const) {
      const missing: Record<string, unknown> = { ...expected };
      delete missing[field];
      expect(() => savedMetadata(missing, expected)).toThrow();
    }

    staleAnswer({ _tag: "refused", reason: "changed_elsewhere", now }, now);
    tooLong({ _tag: "refused", reason: "too_long", most: now }, now);

    for (const bad of [
      { _tag: "refused", reason: "bad_msg", now },
      { _tag: "refused", reason: "changed_elsewhere" },
      { _tag: "refused", reason: "changed_elsewhere", now: now + 1 },
    ] as const) {
      expect(() => staleAnswer(bad, now)).toThrow();
    }

    expect(() => tooLong({ _tag: "refused", reason: "bad_msg", most: now }, now)).toThrow();
  },
  opts,
);
