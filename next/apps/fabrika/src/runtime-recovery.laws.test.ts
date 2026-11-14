// P12, next/. The real Project and Process services, Gateway and runner on SQLite.
// Only Cloudflare's handles and Worker Loader transport are supplied by this Node fixture.
// No class from brain.ts, and the only fake is the box's platform base class: the services are what the classes hand off to.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { inspect } from "node:util";
import { Cmd, Machine } from "@demlik/tea/effect";
import { it as effect } from "@effect/vitest";
import { checklist } from "@kampus/checklist";
import { counter } from "@kampus/counter";
import { nodeExecution, type Descriptor, type Incoming } from "@kampus/libfabrika";
import { revokeText } from "@kampus/libfabrika/access/Text";
import { programBox } from "@kampus/libfabrika/box";
import { Start } from "@kampus/libfabrika/processes/Process";
import { copied, type ExitReason, fcBadReason, fcExitReason } from "@kampus/libfabrika/processes/Process.test-support";
import * as Audit from "@kampus/libfabrika/runtime/Audit";
import { Program } from "@kampus/libfabrika/runtime/Program";
import { send } from "@kampus/libfabrika/runtime/Send";
import * as SettingsStart from "@kampus/libfabrika/settings/Start";
import * as StartsTest from "@kampus/libfabrika/settings/StartsTest";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import {
  commitReply,
  configureProcess,
  processDescriptor,
  processRuntime,
  ProcessService,
  ProjectService,
  savedAlarm,
  signingReply,
} from "@kampus/libfabrika/workers/runtime";
import { Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import { programs } from "virtual:fabrika-built";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { projectRuntime, type Env } from "./runtime.ts";

const table = vi.hoisted(() => ({ programs: {} as Record<string, { hash: string; source: string }> }));
vi.mock("./table.ts", () => table);
// Only the platform base class is fake. The box methods run the real programBox.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
// P16: the runtime reads its built program table from the build's generated module
// (libfabrika's build-modules.d.ts). Mocking both keeps these laws on either wiring.
vi.mock("virtual:fabrika-built", () => ({ ...table, assets: {} }));

type ProjectCalls = (typeof ProjectService)["Service"];
type ProcessCalls = (typeof ProcessService)["Service"];

// What the Project class hands off: each call runs one service method on the object's runtime.
const projectObject = (ctx: DurableObjectState, env: Env) => {
  const runtime = projectRuntime(ctx, env);
  const run = <A, E>(use: (p: ProjectCalls) => Effect.Effect<A, E>) => runtime.runPromise(ProjectService.use(use));
  return {
    runtime,
    settingsStart: (...args: Parameters<typeof runtime.settingsStart>) =>
      Effect.runPromise(runtime.settingsStart(...args)),
    settingsRead: (...args: Parameters<typeof runtime.settingsRead>) =>
      Effect.runPromise(runtime.settingsRead(...args)),
    info: () => run((p) => p.info),
    clientConnect: () => run((p) => p.connect()),
    challenge: (client: Parameters<ProjectCalls["challenge"]>[0]) => run((p) => p.challenge(client)),
    initialize: (...args: Parameters<ProjectCalls["initialize"]>) => run((p) => p.initialize(...args)),
    route: (...args: Parameters<ProjectCalls["route"]>) => run((p) => p.route(...args)),
    grant: (input: unknown) => run((p) => p.grant(input)),
    start: (...args: Parameters<ProjectCalls["start"]>) => run((p) => p.start(...args)),
    read: (...args: Parameters<ProjectCalls["read"]>) => run((p) => p.read(...args)),
    code: (...args: Parameters<ProjectCalls["code"]>) => run((p) => p.code(...args)),
    wait: (...args: Parameters<ProjectCalls["wait"]>) => run((p) => p.wait(...args)),
    append: (...args: Parameters<ProjectCalls["append"]>) => run((p) => p.append(...args)),
    mail: (...args: Parameters<ProjectCalls["mail"]>) => run((p) => p.mail(...args)),
    inbox: (...args: Parameters<ProjectCalls["inbox"]>) => run((p) => p.inbox(...args)),
    own: (...args: Parameters<ProjectCalls["own"]>) => run((p) => p.own(...args)),
    publish: (...args: Parameters<ProjectCalls["publish"]>) => run((p) => p.publish(...args)),
    sign: (...args: Parameters<ProjectCalls["sign"]>) => run((p) => signingReply(p.sign(...args))),
    commit: (...args: Parameters<ProjectCalls["commit"]>) => run((p) => commitReply(p.commit(...args))),
    target: (...args: Parameters<ProjectCalls["target"]>) => run((p) => p.target(...args)),
    knock: (...args: Parameters<ProjectCalls["knock"]>) => run((p) => p.knock(...args)),
    disconnect: (...args: Parameters<ProjectCalls["disconnect"]>) => run((p) => p.disconnect(...args)),
    register: (...args: Parameters<ProjectCalls["register"]>) => run((p) => p.register(...args)),
    join: (...args: Parameters<ProjectCalls["join"]>) => run((p) => p.join(...args)),
    leave: (...args: Parameters<ProjectCalls["leave"]>) => run((p) => p.leave(...args)),
    online: (...args: Parameters<ProjectCalls["online"]>) => run((p) => p.online(...args)),
    exit: (...args: Parameters<ProjectCalls["exit"]>) => run((p) => p.exit(...args)),
    brain: (...args: Parameters<ProjectCalls["brain"]>) => run((p) => p.brain(...args)),
    // The lane's Project process calls, each the one service call the class makes.
    processObject: (...args: Parameters<ProjectCalls["processObject"]>) => run((p) => p.processObject(...args)),
    processStart: (...args: Parameters<ProjectCalls["processStart"]>) => run((p) => p.processStart(...args)),
    processExit: (...args: Parameters<ProjectCalls["processExit"]>) => run((p) => p.processExit(...args)),
    processStatus: (...args: Parameters<ProjectCalls["processStatus"]>) => run((p) => p.processStatus(...args)),
    processResolve: (...args: Parameters<ProjectCalls["processResolve"]>) => run((p) => p.processResolve(...args)),
    processDead: (...args: Parameters<ProjectCalls["processDead"]>) => run((p) => p.processDead(...args)),
    processIsLive: (...args: Parameters<ProjectCalls["processIsLive"]>) => run((p) => p.processIsLive(...args)),
    processMonitor: (...args: Parameters<ProjectCalls["processMonitor"]>) => run((p) => p.processMonitor(...args)),
    processDemonitor: (...args: Parameters<ProjectCalls["processDemonitor"]>) =>
      run((p) => p.processDemonitor(...args)),
    processDown: (...args: Parameters<ProjectCalls["processDown"]>) => run((p) => p.processDown(...args)),
    processReceive: (...args: Parameters<ProjectCalls["processReceive"]>) => run((p) => p.processReceive(...args)),
  };
};

type ProjectObject = ReturnType<typeof projectObject>;

// What the Process class hands off, with the same descriptor reads and writes on its handles.
const processObject = (ctx: DurableObjectState, env: Env) => {
  const runtime = processRuntime(ctx, env, programs);
  const run = <A, E>(use: (p: ProcessCalls) => Effect.Effect<A, E>) => runtime.runPromise(ProcessService.use(use));
  return {
    runtime,
    configure: (descriptor: Descriptor) => Effect.runPromise(configureProcess(ctx, descriptor, runtime)),
    descriptor: () => Effect.runPromise(processDescriptor(ctx)),
    open: (client: string) => run((p) => p.open(client)),
    msg: (input: unknown) => run((p) => p.msg(input)),
    mailed: (trace?: { readonly traceId: string; readonly spanId: string }) => run((p) => p.mailed(trace)),
    due: (at: number) => run((p) => p.due(at)),
    restart: (request: { id: string; build: string }) => run((p) => p.restart(request)),
    alarm: () => run((p) => p.alarm()),
    activity: (...args: Parameters<ProcessCalls["activity"]>) => run((p) => p.activity(...args)),
    recover: () => run((p) => p.recover()),
    savedAlarm: () => Effect.runPromise(savedAlarm(ctx)),
    abort: () => ctx.abort("storage wake"),
  };
};

type ProcessObject = ReturnType<typeof processObject>;

const built = (source: string) => ({ hash: createHash("sha256").update(source).digest("hex"), source });
const counterCode = built("counter");
const checklistCode = built("checklist");
const approvalCode = built("approvals");
const poisonCode = built("poison");
const requesterCode = built("requester");
const responderCode = built("responder");

/** A call on a Durable Object stub rejected. */
class StubFailure extends Schema.TaggedError<StubFailure>()("StubFailure", { cause: Schema.Defect() }) {}

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-08T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const field = (value: Buffer | string) => {
  const body = Buffer.from(value),
    size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519"),
    bytes = Buffer.from(pair.publicKey.export({ format: "jwk" }).x!, "base64url"),
    blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw: bytes.toString("base64url"),
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
    proof: (text: string) => {
      const payload = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(text).digest()),
      ]);
      const version = Buffer.alloc(4);
      version.writeUInt32BE(1);
      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, pair.privateKey))])),
      ]);
      return `-----BEGIN SSH SIGNATURE-----\n${packet
        .toString("base64")
        .match(/.{1,70}/g)!
        .join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

const Model = Schema.Struct({
  count: Schema.Int,
  replies: Schema.Int,
  failures: Schema.Array(Schema.String),
});

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("prepare"), parent: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("approve"), parent: Schema.optionalKey(Schema.String) }),
]);

const write = Cmd.make("write", {
  input: Schema.Struct({ stream: Schema.String, write: Schema.Json }),
  ok: Schema.Json,
  err: ["person_only", "not_granted"],
});

const caused = (parent: string) =>
  write({ stream: "events", write: { _tag: "caused", parent, event: { _tag: "answered" } } });

const approvals = {
  name: "p12/approvals",
  machine: Machine.make({
    model: Model,
    msg: Msg,
    cmds: [write],
    init: (saved) => [saved ?? { count: 0, replies: 0, failures: [] }, []],
    update: {
      prepare: (s, m) => [{ ...s, count: s.count + 1 }, [caused(m.parent!)]],
      approve: (s, m) => [{ ...s, count: s.count + 1 }, [caused(m.parent!)]],
      write_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
      write_err: (s, m) => [{ ...s, replies: s.replies + 1, failures: [...s.failures, m.error._tag] }, []],
    },
  }),
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Msg,
  view: { data: Model, select: (s: typeof Model.Type) => s },
  refuse: () => null,
  inputs: {
    prepare: { _tag: "write", schema: Msg, description: "Prepare", personOnly: false },
    approve: { _tag: "write", schema: Msg, description: "Approve", personOnly: true },
  },
  outputs: {},
  writes: { answered: { schema: Schema.TaggedStruct("answered", {}), personOnly: true } },
  wake: () => null,
} as const;

/** @internal */
const RequestModel = Schema.TaggedUnion({
  idle: {},
  waiting: { ref: Schema.String },
  answered: { ref: Schema.String, value: Schema.Int },
  failed: { ref: Schema.String, reason: Schema.String },
});
/** @internal */
type RequestModel = typeof RequestModel.Type;

/** `to` and `claim` let a law aim one request elsewhere, or have it claim another sender. */
const RequestStart = Schema.Struct({
  type: Schema.Literal("start"),
  ref: Schema.NonEmptyString,
  value: Schema.Int,
  to: Schema.optionalKey(Schema.NonEmptyString),
  claim: Schema.optionalKey(Schema.NonEmptyString),
  parent: Schema.optionalKey(Schema.String),
});

const Answer = Schema.Struct({
  type: Schema.Literal("answer"),
  ref: Schema.String,
  value: Schema.Int,
  parent: Schema.optionalKey(Schema.String),
});

/** @internal */
const RequestMsg = Schema.Union([RequestStart, Answer]);

const idle = RequestModel.cases.idle.make({});

/** @internal The requester named `self`, whose requests go to `peer`. */
const mailRequester = (config: { readonly self: string; readonly peer: string }) => {
  const machine = Machine.make({
    model: RequestModel,
    msg: RequestMsg,
    cmds: [send],
    init: (loaded) => [loaded ?? idle, []],
    update: {
      start: (s, m) => {
        if (s._tag === "waiting") {
          return [s, []];
        }

        const body = { type: "request", ref: m.ref, value: m.value, reply: config.self };
        // A claimed sender rides beside the operands, as a program could try; the host binds the real one.
        const input =
          m.claim === undefined
            ? { to: m.to ?? config.peer, m: body }
            : { to: m.to ?? config.peer, m: body, source: m.claim };
        return [RequestModel.cases.waiting.make({ ref: m.ref }), [send(input)]];
      },
      answer: (s, m) =>
        s._tag === "waiting" && s.ref === m.ref
          ? [RequestModel.cases.answered.make({ ref: m.ref, value: m.value }), []]
          : [s, []],
      send_ok: (s) => [s, []],
      send_err: (s, m) =>
        s._tag === "waiting" &&
        m.cmd.m !== null &&
        typeof m.cmd.m === "object" &&
        "ref" in m.cmd.m &&
        m.cmd.m.ref === s.ref
          ? [RequestModel.cases.failed.make({ ref: s.ref, reason: m.error._tag }), []]
          : [s, []],
    },
  });
  return Program.make({
    name: `p41/requester-${config.self.replaceAll(":", "-")}`,
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: (s, m) => (m.type === "start" && s._tag === "waiting" ? { reason: "busy" } : null),
    inputs: { start: "Start a request", answer: "An answer from a responder" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};

/** @internal */
const ResponseModel = Schema.TaggedStruct("ready", {
  /** Requests answered. */
  answered: Schema.Int,
  /** Send outcomes seen, so an outcome is a message that changes the model. */
  queued: Schema.Int,
  refused: Schema.Int,
});
/** @internal */
type ResponseModel = typeof ResponseModel.Type;

const Request = Schema.Struct({
  type: Schema.Literal("request"),
  ref: Schema.NonEmptyString,
  value: Schema.Int,
  reply: Schema.NonEmptyString,
  parent: Schema.optionalKey(Schema.String),
});

const Approve = Schema.Struct({ type: Schema.Literal("approve"), parent: Schema.optionalKey(Schema.String) });
/** @internal */
const ResponseMsg = Schema.Union([Request, Approve]);

const machine = Machine.make({
  model: ResponseModel,
  msg: ResponseMsg,
  cmds: [send],
  init: (loaded) => [loaded ?? ResponseModel.make({ answered: 0, queued: 0, refused: 0 }), []],
  update: {
    request: (s, m) => [
      { ...s, answered: s.answered + 1 },
      [send({ to: m.reply, m: { type: "answer", ref: m.ref, value: m.value + 1 } })],
    ],
    approve: (s) => [s, []],
    send_ok: (s) => [{ ...s, queued: s.queued + 1 }, []],
    send_err: (s) => [{ ...s, refused: s.refused + 1 }, []],
  },
});

/** @internal */
const mailResponder = Program.make({
  name: "p41/responder",
  machine,
  state: { v: 1, upgrades: [] },
  view: (s) => s,
  refuse: (_s, m) => (m.type === "request" && m.value < 0 ? { reason: "negative" } : null),
  inputs: {
    request: "Answer a request",
    approve: { description: "Approve", personOnly: true },
  },
  outputs: {},
  writes: {},
  wake: () => null,
});

const requestProgram = mailRequester({ self: "requester:1", peer: "responder:1" });

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) {
    await close();
  }
});

// The platform alarm: a saved time that survives reopen and calls the object's alarm handler.
type AlarmHooks = { readonly set: (at: number) => void; readonly clear: () => void };

const storage = (db: DatabaseSync, alarms?: AlarmHooks) => {
  const sql = nodeSql(db),
    values = new Map<string, unknown>();
  return {
    values,
    sql: {
      exec: sql.exec,
      get databaseSize() {
        return sql.size();
      },
    },
    transactionSync: sql.transaction,
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    delete: async (key: string) => values.delete(key),
    sync: async () => {},
    setAlarm: async (at: number) => {
      if (at <= 0) {
        throw new TypeError("setAlarm() cannot be called with an alarm time <= 0");
      }

      alarms?.set(at);
    },
    deleteAlarm: async () => alarms?.clear(),
  };
};

// A program that throws a TypeError on "throw" and counts on "inc", run inside the real box.
const PoisonModel = Schema.Struct({ count: Schema.Int });

const PoisonMsg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("throw"), parent: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("inc"), parent: Schema.optionalKey(Schema.String) }),
]);

const poisonProgram = (limit: number | null) => ({
  name: "p34/poison-fixture",
  ...(limit === null ? {} : { maxDeliveries: limit }),
  machine: Machine.make({
    model: PoisonModel,
    msg: PoisonMsg,
    cmds: [],
    init: (saved) => [saved ?? { count: 0 }, []],
    update: {
      throw: () => {
        throw new TypeError("private failure P34");
      },
      inc: (s) => [{ count: s.count + 1 }, []],
    },
  }),
  state: { v: 1, schema: PoisonModel, upgrades: [] },
  msg: PoisonMsg,
  view: { data: PoisonModel, select: (s: typeof PoisonModel.Type) => s },
  refuse: () => null,
  inputs: {
    throw: { _tag: "write", schema: PoisonMsg, description: "Fail", personOnly: false },
    inc: { _tag: "write", schema: PoisonMsg, description: "Count", personOnly: false },
  },
  outputs: {},
  writes: {},
  wake: () => null,
});

/** Project calls a Process made before ticket 402. Every other call is a new Project RPC. */
const OLD_PROJECT_CALLS = new Set(["read", "wait", "append", "inbox", "own", "publish"]);

const gate = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

type Entry = {
  object: ProcessObject;
  readonly db: DatabaseSync;
  readonly ctx: DurableObjectState;
  readonly values: Map<string, unknown>;
  timer: ReturnType<typeof setTimeout> | undefined;
  alarm: number | null;
  held?: boolean;
};

type Lost = { readonly at: number; readonly side: "before" | "after" } | null;

const world = (
  fault: "failed" | "interrupted" | "healthy" = "healthy",
  flow: { readonly limit: number | null; readonly lost: Lost } = { limit: null, lost: null },
  settingsCounts = { calls: 0, reads: 0, appends: 0 },
) => {
  // P40: the core counter's code is `fabrika/counter`; its registered name stays `counter:1`.
  table.programs["fabrika/counter"] = counterCode;
  table.programs["fabrika/checklist"] = checklistCode;
  table.programs["p12/approvals"] = approvalCode;
  table.programs["p34/poison-fixture"] = poisonCode;
  table.programs[requestProgram.name] = requesterCode;
  table.programs[mailResponder.name] = responderCode;
  const key = identity(),
    db = new DatabaseSync(":memory:");
  const handles = storage(db);
  const loopbacks = { IsolateTail: () => ({ fetch: async () => new Response() }) };
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies only the platform handles used by the real Project service
  const ctx = {
    id: { name: "project-test" },
    storage: {
      ...handles,
      sql: {
        get databaseSize() {
          return handles.sql.databaseSize;
        },
        exec: (
          query: string,
          ...args: Parameters<typeof handles.sql.exec> extends [string, ...infer A] ? A : never
        ) => {
          if (args.some((arg) => typeof arg === "string" && arg.startsWith("settings/instance/"))) {
            if (/SELECT \* FROM entries WHERE stream = \? AND rev > \?/i.test(query)) {
              settingsCounts.reads++;
            }

            if (/INSERT INTO entries/i.test(query)) {
              settingsCounts.appends++;
            }
          }

          return handles.sql.exec(query, ...args);
        },
      },
    },
    exports: loopbacks,
  } as unknown as DurableObjectState;
  // Keyed by the storage name the runtime asks for, so the runtime alone decides which IDs share one.
  const processes = new Map<string, Entry>(),
    attempts: Descriptor[] = [],
    deliveries: Array<Promise<"configured" | "failed">> = [],
    received: Incoming[] = [],
    entered = gate(),
    interrupted = gate();
  let project: ProjectObject;
  let settingsRefused = false;
  let beforeCommit = async () => {};
  let afterMail = async () => {};
  let signs = 0,
    commits = 0,
    newCalls = 0,
    inits = 0,
    lostDone = false,
    stepFault: "none" | "rpc" | "decode" = "none",
    closed = false;
  const schedule = (entry: Entry) => {
    clearTimeout(entry.timer);

    if (entry.alarm === null || entry.held || closed) {
      return;
    }

    const fire = (tries: number) => {
      entry.timer = setTimeout(
        () => {
          entry.alarm = null;
          entry.object.alarm().catch(() => {
            // workerd retries a failed alarm handler; so does this platform stand-in.
            if (!closed && tries < 5 && entry.alarm === null) {
              fire(tries + 1);
            }
          });
        },
        tries === 0 ? Math.max(0, (entry.alarm ?? 0) - Date.now()) : 100,
      );
    };
    fire(0);
  };
  const call = (method: string) => async (args: ReadonlyArray<unknown>) => {
    const work = () => Reflect.apply(Reflect.get(project, method), project, args);

    if (method === "settingsStart" || method === "settingsRead") {
      settingsCounts.calls++;

      if (settingsRefused) {
        return SettingsStart.Reply.cases.Refused.make({});
      }
    }

    // Settings setup is outside the recovery RPC failure cuts.
    if (OLD_PROJECT_CALLS.has(method) || method === "settingsStart" || method === "settingsRead") {
      return work();
    }

    newCalls++;
    const lost = flow.lost;

    if (lost === null || lostDone || newCalls !== lost.at) {
      return work();
    }

    lostDone = true;

    if (lost.side === "before") {
      throw new Error("transport lost before the Project");
    }

    await work();
    throw new Error("transport lost the Project's answer");
  };
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node namespaces call the real services but do not have workerd's nominal brands
  const env = {
    INSTANCE: JSON.stringify(
      RecordWireTest.settingsFixture({
        name: "project-test",
        person: PERSON,
        founder: key.line,
        window: key.raw,
        port: 18787,
        build: "brain-test",
        mail: { grants: { "requester:1": ["responder:1"], "responder:1": ["requester:1"] } },
      }),
    ),
    // Every Project RPC the real class hands off, so new Project calls reach the real service too.
    PROJECT: {
      getByName: () =>
        new Proxy(
          {},
          {
            get: (_target, method) => {
              if (typeof method !== "string" || method === "then") {
                return undefined;
              }

              if (method === "sign") {
                return (...args: Parameters<ProjectObject["sign"]>) => {
                  signs++;
                  return project.sign(...args);
                };
              }

              if (method === "mail") {
                return async (...args: Parameters<ProjectObject["mail"]>) => {
                  const reply = await project.mail(...args);
                  await afterMail();
                  return reply;
                };
              }

              if (method === "commit") {
                return async (...args: Parameters<ProjectObject["commit"]>) => {
                  commits++;
                  await beforeCommit();
                  return project.commit(...args);
                };
              }

              return (...args: ReadonlyArray<unknown>) => call(method)(args);
            },
          },
        ),
    },
    PROCESS: {
      getByName: (name: string) => {
        const [, storageKey] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.String]))(JSON.parse(name));
        const made = (): Entry => {
          const processDb = new DatabaseSync(":memory:");
          let entry: Entry | undefined;
          const handles = storage(processDb, {
            set: (at) => {
              if (entry === undefined) {
                return;
              }

              entry.alarm = at;
              schedule(entry);
            },
            clear: () => {
              if (entry === undefined) {
                return;
              }

              entry.alarm = null;
              clearTimeout(entry.timer);
            },
          });
          // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies the SQL, descriptor, alarm and sync handles the real Process reads
          const processCtx = { id: { name }, storage: handles, exports: loopbacks } as unknown as DurableObjectState;
          const created: Entry = {
            db: processDb,
            ctx: processCtx,
            values: handles.values,
            timer: undefined,
            alarm: null,
            object: processObject(processCtx, env),
          };
          entry = created;
          processes.set(storageKey, created);
          return created;
        };
        const current: Entry = processes.get(storageKey) ?? made();
        // Every Process RPC the real class hands off; reopen swaps the object behind the same stub.
        return new Proxy(
          {},
          {
            get: (_target, method) => {
              if (typeof method !== "string" || method === "then") {
                return undefined;
              }

              if (method === "configure") {
                return async (descriptor: Descriptor) => {
                  attempts.push(structuredClone(descriptor));
                  entered.resolve();

                  if (attempts.length === 1 && fault === "failed") {
                    throw new Error("configure failed before save");
                  }

                  if (attempts.length === 1 && fault === "interrupted") {
                    await interrupted.promise;
                    return;
                  }

                  const delivery = current.object.configure(descriptor);
                  deliveries.push(
                    delivery.then(
                      () => "configured" as const,
                      () => "failed" as const,
                    ),
                  );
                  return delivery;
                };
              }

              if (method === "msg") {
                return (incoming: Incoming) => {
                  received.push(incoming);
                  return current.object.msg(incoming);
                };
              }

              return (...args: ReadonlyArray<unknown>) =>
                Reflect.apply(Reflect.get(current.object, method), current.object, args);
            },
          },
        );
      },
    },
    CONNECTION: {
      getByName: () => ({ ring: async () => {}, notify: async () => {}, probe: async () => 42 }),
    },
    RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
    MEASUREMENTS: {},
    LOADER: {
      get: (id: string) => ({
        getEntrypoint: () => {
          const requester = id.startsWith(`${requesterCode.hash}/`),
            responder = id.startsWith(`${responderCode.hash}/`);

          if (id.startsWith(`${poisonCode.hash}/`) || requester || responder) {
            // The real box: its declaration carries the program's own maxDeliveries.
            const program = requester ? requestProgram : responder ? mailResponder : poisonProgram(flow.limit);
            const Box = programBox(
              program,
              requester ? requesterCode.hash : responder ? responderCode.hash : poisonCode.hash,
            );
            const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
            return {
              describe: () => box.describe(),
              init: (saved: unknown) => {
                inits++;
                return box.init(saved);
              },
              step: (model: unknown, msg: unknown) => box.step(model, msg),
              fresh: async (model: unknown, msg: unknown) => {
                // Transport faults before the program: they decide nothing about the input.
                if (stepFault === "rpc") {
                  throw new Error("transport failed before the program");
                }

                if (stepFault === "decode") {
                  return { unrecognized: true };
                }

                return box.fresh(model, msg);
              },
              update: (model: unknown, msg: unknown) => box.update(model, msg),
              audit: (msg: unknown) => box.audit(msg),
              fold: (model: unknown, msg: unknown) => box.fold(model, msg),
              upgrade: (saved: unknown) => box.upgrade(saved),
              reply: (cmd: unknown, outcome: unknown) => box.reply(cmd, outcome),
              check: (kind: string, event: unknown) => box.check(kind, event),
              admit: (msg: unknown) => box.admit(msg),
            };
          }

          if (id.startsWith(`${checklistCode.hash}/`)) {
            const Box = programBox(checklist, checklistCode.hash);
            return Reflect.construct(Box, []);
          }

          const approval = id.startsWith(`${approvalCode.hash}/`),
            program = approval ? approvals : counter,
            execution = nodeExecution(program);
          return {
            describe: async () => ({
              name: program.name,
              v: 1,
              writes: approval ? { answered: { personOnly: true } } : {},
              inputs: approval
                ? {
                    prepare: { write: true, personOnly: false },
                    approve: { write: true, personOnly: true },
                  }
                : {
                    inc: { write: true, personOnly: false },
                    dec: { write: true, personOnly: false },
                    reset: { write: true, personOnly: false },
                  },
              cmds: approval ? ["write"] : [],
            }),
            init: (saved: unknown) => {
              inits++;
              return Effect.runPromise(execution.init(saved));
            },
            step: (model: unknown, msg: unknown) => Effect.runPromise(execution.step(model, msg)),
            fresh: (model: unknown, msg: unknown) => Effect.runPromise(execution.fresh(model, msg)),
            update: (model: unknown, msg: unknown) => Effect.runPromise(execution.update(model, msg)),
            audit: (msg: unknown) =>
              Effect.runPromise(
                execution.audit(msg).pipe(
                  Effect.match({
                    onSuccess: (value) => Audit.Answer.cases.ok.make({ value }),
                    onFailure: Audit.failure,
                  }),
                ),
              ),
            fold: (model: unknown, msg: unknown) => Effect.runPromise(execution.fold(model, msg)),
            upgrade: (saved: unknown) => Effect.runPromise(execution.upgrade(saved)),
            reply: (cmd: unknown, outcome: unknown) => Effect.runPromise(execution.reply(cmd, outcome)),
            check: (kind: string, event: unknown) => Effect.runPromise(execution.check(kind, event)),
            admit: (msg: unknown) => Effect.runPromise(execution.admit(msg)),
          };
        },
      }),
    },
  } as unknown as Env;
  project = projectObject(ctx, env);
  const close = async () => {
    closed = true;
    interrupted.resolve();

    for (const { object, db: processDb, timer } of processes.values()) {
      clearTimeout(timer);
      await object.runtime.dispose();
      processDb.close();
    }

    await project.runtime.dispose();
    db.close();
  };
  closers.push(close);
  /** The registered name the Project saved for a process ID, if any. */
  const nameFor = (pid: string): string | undefined => {
    const row = db.prepare("SELECT value FROM dev_descriptors WHERE process=?").get(pid);
    return row === undefined ? undefined : JSON.parse(String(row.value)).name;
  };
  /** The storage owner of a process ID, however the runtime keys it. */
  const processFor = (pid: string): Entry => {
    const direct = processes.get(pid);

    if (direct !== undefined) {
      return direct;
    }

    const name = nameFor(pid);
    const found = [...processes.entries()].find(
      ([storageKey, entry]) =>
        Reflect.get(Object(entry.values.get("descriptor")), "id") === pid ||
        (name !== undefined && storageKey === name),
    );

    if (found === undefined) {
      throw new Error(`no storage owner for ${pid}`);
    }

    return found[1];
  };
  return {
    close: async () => {
      const index = closers.indexOf(close);

      if (index !== -1) {
        closers.splice(index, 1);
        await close();
      }
    },
    refuseSettings: (refused: boolean) => {
      settingsRefused = refused;
    },
    get project() {
      return project;
    },
    db,
    attempts,
    received,
    entered: entered.promise,
    /** How each start the Project delivered ended at its object, once the first one has ended. */
    delivered: async () => {
      await entered.promise;
      return Promise.all(deliveries);
    },
    /** How many times a program's init ran: each is one process's first turn after a load. */
    inits: () => inits,
    process: processFor,
    /** Every process store's rows for one letter's delivery receipt. */
    receipts: (letter: string) =>
      [...processes.values()].flatMap((entry) => {
        try {
          return entry.db
            .prepare("SELECT value FROM process_receipts WHERE letter=?")
            .all(letter)
            .map((row) => JSON.parse(String(row.value)));
        } catch {
          return [];
        }
      }),
    fault: (value: "none" | "rpc" | "decode") => {
      stepFault = value;
    },
    newCalls: () => newCalls,
    lostDone: () => lostDone,
    /** Platform restart: every object's runtime ends; storage and saved alarms survive. */
    reopenAll: async () => {
      for (const entry of processes.values()) {
        clearTimeout(entry.timer);
        await entry.object.runtime.dispose();
      }

      await project.runtime.dispose();
      project = projectObject(ctx, env);

      for (const entry of processes.values()) {
        entry.object = processObject(entry.ctx, env);
        schedule(entry);
      }

      await project.info();
    },
    holdMail: (hold: () => Promise<void>) => {
      afterMail = hold;
    },
    holdAlarm: (pid: string, held: boolean) => {
      const entry = processFor(pid);
      entry.held = held;
      schedule(entry);
    },
    reopenProcess: async (pid: string) => {
      const entry = processFor(pid);
      clearTimeout(entry.timer);
      await entry.object.runtime.dispose();
      entry.object = processObject(entry.ctx, env);
      schedule(entry);
    },
    startMail: async (role: "requester" | "responder") =>
      (
        await project.start(
          Start.cases.first.make({
            id: `mail-${role}`,
            name: `${role}:1`,
            code: {
              program: role === "requester" ? requestProgram.name : mailResponder.name,
              hash: role === "requester" ? requesterCode.hash : responderCode.hash,
            },
          }),
          {
            by: key.fingerprint,
            for: PERSON,
            sentAt: SENT,
            seen: 0,
            parent: null,
            traceId: TRACE,
            build: "brain-test",
          },
        )
      ).process,
    startPoison: async (name: string) =>
      (
        await project.start(
          Start.cases.first.make({ id: name, name, code: { program: "p34/poison-fixture", hash: poisonCode.hash } }),
          {
            by: key.fingerprint,
            for: PERSON,
            sentAt: SENT,
            seen: 0,
            parent: null,
            traceId: TRACE,
            build: "brain-test",
          },
        )
      ).process,
    interrupt: async () => {
      await project.runtime.dispose();
      interrupted.resolve();
    },
    reopen: async () => {
      await project.runtime.dispose();
      table.programs["fabrika/counter"] = built("changed counter");
      project = projectObject(ctx, env);
      return project.info();
    },
    admit: async () => {
      const client = await project.clientConnect(),
        nonce = await project.challenge(client),
        tab = "recovery-test";
      expect(
        await project.initialize(
          client,
          {
            versions: [1],
            has: ["seal"],
            ping: "30s",
            key: key.raw,
            tab,
            nonce,
            platform: "headless",
            os: "linux",
            sentAt: SENT,
            signed: key.proof(`fabrika-hello\nhttp://127.0.0.1:18787\n${tab}\n${nonce}`),
          },
          { url: "http://127.0.0.1:18787", tab, name: key.fingerprint },
        ),
      ).toMatchObject({ _tag: "online" });
      return client;
    },
    start: () =>
      project.start(
        Start.cases.first.make({
          id: "approvals:1",
          name: "approvals:1",
          code: { program: "p12/approvals", hash: approvalCode.hash },
        }),
        {
          by: key.fingerprint,
          for: PERSON,
          sentAt: SENT,
          seen: 0,
          parent: null,
          traceId: TRACE,
          build: "brain-test",
        },
      ),
    revokeBeforeCommit: () => {
      beforeCommit = async () => {
        const text = revokeText({
          id: "revoke-1",
          key: key.raw,
          for: PERSON,
          to: "project-test",
          saw: { label: "fixture", location: "local", method: "command", check: "none" },
          sentAt: SENT,
        });
        expect(await project.grant({ text, armored: key.proof(text) })).toMatchObject({
          _tag: "applied",
        });
      };
    },
    calls: () => ({ signs, commits }),
  };
};

StartsTest.law(
  "T753 L16 real first/later process steps, recovery and successors keep the shared instance gate",
  fc.tuple(fc.boolean(), fc.array(fc.nat(), { minLength: 12, maxLength: 20 })),
  ([refusedStart, choices]) =>
    Effect.gen(function* () {
      const costs = { calls: 0, reads: 0, appends: 0 };
      const w = yield* Effect.acquireRelease(
        Effect.sync(() => world("healthy", { limit: null, lost: null }, costs)),
        (owned) => Effect.promise(() => owned.close()),
      );
      // A first start pays the gate at configure: the Project's build sends it, and configureProcess
      // builds the process's services, gate first, before it runs the first turn. So the refusal is
      // planted before the Project's first build, and the walk below starts from how that configure ended.
      w.refuseSettings(refusedStart);
      const [first] = yield* Effect.promise(() => w.project.info());
      const delivered = yield* Effect.promise(() => w.delivered());
      w.refuseSettings(false);
      expect(delivered).toEqual([refusedStart ? "failed" : "configured"]);
      expect(costs).toEqual({
        // The Project's own gate is local SQL and makes no call. The 1 is configure's settingsStart (SettingsStartsRemote.record).
        calls: 1,
        // 2 are the Project's own record: one finds no start, one reads back its receipt (SettingsStartsLedger.record).
        // A passed configure adds 1, the lookup that finds that start. A refused call never reaches the Project.
        reads: 2 + (refusedStart ? 0 : 1),
        // The Project's own record is the only append: a process's call finds the start and writes nothing.
        appends: 1,
      });
      // No first turn before the gate: a refused configure never runs the program's init, a passed one runs it once.
      expect(w.inits()).toBe(refusedStart ? 0 : 1);
      let pid = first!.process;
      const client = yield* Effect.promise(() => w.admit());
      // A passed configure left the object's services built. A refused one left nothing built.
      let built = !refusedStart;
      let restarts = 0;
      let count = 0;

      for (const [index, choice] of choices.entries()) {
        const moves = built
          ? restarts < 2
            ? ["step", "step", "open", "alarm", "successor", "reopen"]
            : ["step", "step", "open", "alarm", "reopen"]
          : ["refuse", "step", "open"];
        const move = moves[choice % moves.length];
        const owner = w.process(pid);

        if (move === "reopen") {
          yield* Effect.promise(() => w.reopenProcess(pid));
          built = false;
          continue;
        }

        const before = { ...costs };

        if (move === "refuse") {
          const turns = w.inits();
          w.refuseSettings(true);
          expect(Exit.isFailure(yield* Effect.exit(Effect.promise(() => owner.object.open("settings-audit"))))).toBe(
            true,
          );
          // A refused entry is 1 call that never reaches the Project: no read, no append, and no turn.
          expect(costs).toEqual({ calls: before.calls + 1, reads: before.reads, appends: before.appends });
          expect(w.inits()).toBe(turns);
          w.refuseSettings(false);
        }

        // An open really loads the program and restores its checkpoint. An alarm with no wake does neither.
        const opened = yield* Effect.promise(() => owner.object.open("settings-audit"));
        expect(opened).toMatchObject({ view: { count } });
        expect(costs).toEqual({
          // 1 for the refused entry above, and 1 settingsStart for a cold object's entry. A built object
          // keeps its services (SettingsRuntime's cache holds a success for good), so it calls nothing.
          calls: before.calls + (move === "refuse" ? 1 : 0) + (built ? 0 : 1),
          // A cold entry's call is 1 read at the Project, the lookup that finds the saved start.
          reads: before.reads + (built ? 0 : 1),
          // The start was recorded by the Project's own build, so no entry appends.
          appends: before.appends,
        });
        built = true;
        const warm = { ...costs };

        if (move === "step") {
          const answer = yield* Effect.promise(() =>
            w.project.route(client, "process.send", {
              pid,
              letter: `settings-step-${index}`,
              m: { type: "inc" },
              sentAt: SENT,
              seen: 0,
            }),
          );
          expect(answer).toMatchObject({ _tag: "ok", result: { _tag: "accepted" } });
          count++;
          expect(yield* Effect.promise(() => owner.object.open("settings-audit"))).toMatchObject({ view: { count } });
        } else if (move === "successor") {
          yield* Effect.tryPromise({
            try: () => owner.object.restart({ id: `settings-restart-${index}`, build: counterCode.hash }),
            catch: (cause) => new StubFailure({ cause }),
          });
          const rows = yield* Effect.promise(() => w.project.info());
          const successor = rows.find((row) => row.name === first!.name)!;
          expect(successor.process).not.toBe(pid);
          expect(w.process(successor.process)).toBe(owner);
          pid = successor.process;
          restarts++;
          const view = yield* Effect.promise(() => owner.object.open("settings-audit"));
          count = Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Int }))(view.view).count;
        } else if (move === "alarm") {
          yield* Effect.promise(() => owner.object.due(0));
          yield* Effect.promise(() => owner.object.alarm());
        }

        // A step, an alarm, a successor and a second open all run on the built object: 0 calls, reads and appends.
        expect(costs).toEqual(warm);
      }
    }),
);

describe("P12 Project configure recovery", () => {
  for (const fault of ["failed", "interrupted", "healthy"] as const) {
    it(`pinned: ${fault} configure restores the descriptor after an interrupted start`, async () => {
      // A2/A4: the build never waits on its bootstrap's delivery, so it answers whatever the delivery does.
      const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
      const w = world(fault);
      const first = w.project.info().then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await w.entered;
      const result = await first;
      expect("value" in result).toBe(true);
      const descriptor = w.attempts[0]!;
      const row = () => w.db.prepare("SELECT value, pending FROM dev_descriptors WHERE process=?").get(descriptor.id)!;

      if (fault === "interrupted") {
        await w.interrupt();
      }

      if (fault !== "healthy") {
        // The failed or cut delivery is seen: a log line naming the pid (and a failure's tag), never a silent drop.
        await vi.waitFor(
          () =>
            expect(
              logged.some((spy) =>
                spy.mock.calls.some((call) => {
                  const text = inspect(call, { depth: 8 });
                  return text.includes(descriptor.id) && (fault === "interrupted" || text.includes("LedgerError"));
                }),
              ),
              `the ${fault} delivery of ${descriptor.id} is logged`,
            ).toBe(true),
          { timeout: 2_000 },
        );
      }

      if (fault === "healthy") {
        await vi.waitFor(() => expect(Number(row().pending)).toBe(0), { timeout: 2_000 });
      }

      expect(Number(row().pending)).toBe(fault === "healthy" ? 0 : 1);
      expect(JSON.parse(String(row().value))).toEqual(descriptor);

      for (const spy of logged) {
        spy.mockRestore();
      }

      expect(await w.reopen()).toMatchObject([
        { process: descriptor.id, name: "counter:1", program: "fabrika/counter" },
        { process: expect.any(String), name: "checklist:1", program: "fabrika/checklist" },
      ]);
      // The next reopen delivers the same descriptor once and clears pending.
      await vi.waitFor(() => expect(Number(row().pending)).toBe(0), { timeout: 2_000 });
      expect(w.attempts.filter((attempt) => attempt.name === "counter:1")).toHaveLength(fault === "healthy" ? 1 : 2);

      for (const attempt of w.attempts.filter((attempt) => attempt.name === "counter:1")) {
        expect(attempt).toEqual(descriptor);
      }

      const process = w.process(descriptor.id).object;
      expect(await process.descriptor()).toEqual(descriptor);
      expect(await process.open("audit")).toMatchObject({ rev: 0, view: { count: 0 } });
      const client = await w.admit();
      expect(
        await w.project.route(client, "process.send", {
          pid: descriptor.id,
          letter: "after-restore",
          m: { type: "inc" },
          sentAt: SENT,
          seen: 0,
        }),
      ).toMatchObject({ _tag: "ok", result: { _tag: "accepted" } });
      expect(await process.open("audit")).toMatchObject({ rev: 1, view: { count: 1 } });
      expect(await w.project.read("counter:1/inbox", 0, "audit")).toHaveLength(1);
      expect(await w.project.read("processes/counter:1", 0, "audit")).toHaveLength(1);
      const attempts = [...w.attempts];
      await w.reopen();
      expect(w.attempts).toEqual(attempts);
    });
  }
});

describe("P12 Process RPC refusal answers", () => {
  for (const reason of ["person_only", "not_granted"] as const) {
    it(`pinned: ${reason} refusal survives the Process RPC adapter as a saved typed answer`, async () => {
      const w = world();
      await w.project.info();
      const { process: pid } = await w.start(),
        client = await w.admit();

      if (reason === "not_granted") {
        w.revokeBeforeCommit();
      }

      const result = await w.project
        .route(client, "process.send", {
          pid,
          letter: "request",
          m: { type: reason === "person_only" ? "prepare" : "approve" },
          sentAt: SENT,
          seen: 0,
        })
        .then(
          (answer) => ({ answer }),
          (error: unknown) => ({ error }),
        );
      // A policy refusal completes the input. An infrastructure error must not replace it.
      expect.soft(result).toMatchObject({ answer: { _tag: "ok", result: { _tag: "accepted" } } });
      expect(w.calls()).toEqual({ signs: 1, commits: reason === "not_granted" ? 1 : 0 });
      expect(await w.project.read("events", 0, "audit")).toEqual([]);
      const inbox = await w.project.read("approvals:1/inbox", 0, "audit");
      const isReply = Schema.is(Schema.Struct({ m: Schema.Struct({ type: Schema.Literal("write_err") }) }));
      expect(inbox.filter((row) => isReply(row.body))).toMatchObject([
        { body: { m: { type: "write_err", reason: reason, error: { _tag: reason } } } },
      ]);
      const checkpoint = w.process(pid).db.prepare("SELECT checkpoint FROM process_state WHERE process=?").get(pid);
      expect(JSON.parse(String(checkpoint!.checkpoint))).toMatchObject({
        saved: { model: { replies: 1, failures: [reason] } },
        cmds: [],
      });
      expect(await w.process(pid).object.open("audit")).toMatchObject({
        view: { replies: 1, failures: [reason] },
      });
      expect((await w.project.read("approvals:1/inbox", 0, "audit")).filter((row) => isReply(row.body))).toHaveLength(
        1,
      );
      expect(w.calls()).toEqual({ signs: 1, commits: reason === "not_granted" ? 1 : 0 });
    });
  }
});

// Ticket 402: P34's recovery on the Worker path, with the real Project and Process services.
const Word = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,11}$/));

/** One generated recovery flow. Limits run 1 to 32; null is the Worker's default policy. */
const RecoveryFlow = Schema.Struct({
  letter: Word,
  restart: Word,
  limit: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 }))),
  // Past the brake: the Worker's policy allows 5 restarts in 5 s, so a sixth quick crash goes down.
  throws: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 })),
  healthy: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
  resends: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  reopen: Schema.Literals(["none", "throws", "healthy"]),
  fault: Schema.Literals(["none", "rpc", "decode"]),
  lost: Schema.NullOr(
    Schema.Struct({
      at: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
      side: Schema.Literals(["before", "after"]),
    }),
  ),
});
type RecoveryFlow = typeof RecoveryFlow.Type;
const FLOW_WAIT = 15_000;
/** The crash that trips P34's decided Worker policy, 5 restarts in 5,000 ms: it goes down, not restarted. */
const BRAKE = 6;

const until = async <A>(message: string, look: () => Promise<A>, done: (value: A) => boolean) => {
  const end = Date.now() + FLOW_WAIT;
  let last: unknown = null;

  while (Date.now() < end) {
    try {
      const value = await look();
      last = value;

      if (done(value)) {
        return value;
      }
    } catch (error) {
      last = { error: String(error) };
    }

    await new Promise((done) => setTimeout(done, 20));
  }

  throw new Error(`${message}: no answer in ${FLOW_WAIT} ms; last observed ${JSON.stringify(last)}`);
};

const NAME = "poison:1";

/** Runs one flow and checks what must hold after it. */
const runFlow = async (flow: RecoveryFlow) => {
  const w = world("healthy", { limit: flow.limit, lost: flow.lost });
  await w.project.info();
  const original = await w.startPoison(NAME);
  const client = await w.admit();
  const route = (method: string, params: unknown) =>
    w.project.route(client, method, params).then(
      (answer) => ({ answer }),
      (error: unknown) => ({ error: String(error) }),
    );
  const send = (pid: string, letter: string, type: "throw" | "inc") =>
    route("process.send", { pid, letter, m: { type }, sentAt: SENT, seen: 0 });
  const restarts = async () =>
    (await w.project.read(`processes/${NAME}`, 0, "audit"))
      .map((row) => ({ ...Object(row.body), _tag: row._tag }))
      .filter((body) => Schema.is(Schema.Struct({ _tag: Schema.Literal("restarted") }))(body));
  const live = async () => (await w.project.info()).find((row) => row.name === NAME)?.process;
  const downs = async () =>
    (await w.project.read(`processes/${NAME}`, 0, "audit"))
      .map((row) => ({ ...Object(row.body), _tag: row._tag }))
      .filter((body) => Schema.is(Schema.Struct({ _tag: Schema.Literal("down") }))(body));
  const deadRows = async (pids: ReadonlyArray<string>) =>
    (await Promise.all(pids.map((pid) => w.project.read(`${pid}/dead`, 0, "audit")))).flat();
  const limit = flow.limit ?? 3;
  const k = Math.min(flow.throws, limit);
  const letter = `p${flow.letter}`;
  const chain = [original];

  // RPC and decode faults happen before the program and spend no delivery.
  if (flow.fault !== "none") {
    w.fault(flow.fault);
    expect(await send(original, letter, "throw")).not.toMatchObject({
      answer: { _tag: "ok", result: { _tag: "accepted" } },
    });
    w.fault("none");
    expect(await restarts()).toEqual([]);
  }

  for (let n = 1; n <= k; n++) {
    const answer = await send(original, letter, "throw");

    if (n === limit) {
      expect(answer).toMatchObject({ answer: { _tag: "refused", reason: "dead" } });
    } else {
      expect(answer).not.toMatchObject({ answer: { _tag: "ok" } });
    }

    if (flow.reopen === "throws" && n === 1) {
      await w.reopenAll();
    }

    // The brake: one down row for the crashed process, and nothing restarts it before its time.
    let held: number | null = null;

    if (n === BRAKE) {
      const [down] = await until("down", downs, (found) => found.length > 0);
      expect(down).toMatchObject({ process: chain.at(-1), crashes: BRAKE, until: expect.any(Number) });
      held = Number(Reflect.get(Object(down), "until"));

      // Resends while down wake nothing: no step, no try counted, no restart.
      for (let r = 0; r < Math.max(1, flow.resends); r++) {
        expect(await send(original, letter, "throw")).not.toMatchObject({ answer: { _tag: "ok" } });
      }

      expect(await restarts()).toHaveLength(n - 1);
      expect(w.receipts(letter)).toMatchObject([{ tries: n }]);
    }

    const rows = await until(`restart ${n}`, restarts, (found) => found.length >= n);

    if (held !== null) {
      expect(Date.now()).toBeGreaterThanOrEqual(held);
    }

    expect(rows).toHaveLength(n);
    expect(rows[n - 1]).toMatchObject({ after: chain.at(-1), name: NAME });
    const next = String(Reflect.get(Object(rows[n - 1]), "process"));
    expect(chain).not.toContain(next);
    chain.push(next);
    await until(`process ${n} live`, live, (pid) => pid === next);
  }

  const current = chain.at(-1)!;

  // Exactly one receipt for the letter, in the one store its name owns, with every try counted.
  if (k > 0 || flow.fault !== "none") {
    expect(w.receipts(letter)).toMatchObject([
      { letter, tries: k, errors: Array.from({ length: k }, () => "TypeError") },
    ]);
  }

  const dead = k === limit ? [chain.at(-2)!] : [];
  const deadEvents = () => deadRows(chain).then((rows) => rows.map((row) => ({ ...Object(row.body), _tag: row._tag })));
  expect(await deadEvents()).toEqual(
    dead.map((process) => ({
      _tag: "dead",
      process,
      program: "p34/poison-fixture",
      name: NAME,
      tries: limit,
      limit,
      m: letter,
      build: poisonCode.hash,
      errors: Array.from({ length: limit }, () => "TypeError"),
      // The brain writes the row; `asked` keeps the key that asked for it (process-manager.ts).
      asked: expect.stringMatching(/^SHA256:/),
    })),
  );

  if (k === limit) {
    for (let n = 0; n < flow.resends; n++) {
      expect(await send(original, letter, "throw")).toMatchObject({
        answer: { _tag: "refused", reason: "dead" },
      });
    }
  }

  // Healthy mail on the live successor, then the same letters again after a reopen.
  const accepted = [];

  for (let n = 0; n < flow.healthy; n++) {
    const answer = await send(current, `h${n}${flow.letter}`, "inc");
    expect(answer).toMatchObject({ answer: { _tag: "ok", result: { _tag: "accepted" } } });
    accepted.push(answer);
  }

  expect(await route("view.open", { pid: current })).toMatchObject({
    answer: { _tag: "ok", result: { view: { count: flow.healthy } } },
  });
  const inbox = (await w.project.read(`${NAME}/inbox`, 0, "audit")).length;

  if (flow.reopen !== "none") {
    await w.reopenAll();
  }

  for (let n = 0; n < flow.healthy; n++) {
    expect(await send(current, `h${n}${flow.letter}`, "inc")).toEqual(accepted[n]);
  }

  if (k === limit) {
    expect(await send(original, letter, "throw")).toMatchObject({
      answer: { _tag: "refused", reason: "dead" },
    });
  }

  expect(await route("view.open", { pid: current })).toMatchObject({
    answer: { _tag: "ok", result: { view: { count: flow.healthy } } },
  });
  expect(await w.project.read(`${NAME}/inbox`, 0, "audit")).toHaveLength(inbox);
  expect(await restarts()).toHaveLength(k);
  expect(await downs()).toHaveLength(k >= BRAKE ? 1 : 0);
  expect(await deadEvents()).toHaveLength(dead.length);

  if (k > 0 || flow.fault !== "none") {
    expect(w.receipts(letter)).toMatchObject([{ tries: k }]);
  }

  expect(await live()).toBe(current);
  return { w, current, restarts, live, route };
};

const flowOptions = { timeout: 600_000, arbitrary: { seed: 119120, runs: 12 } };

describe("ticket 402: P34 recovery on the Worker runtime", () => {
  // Effect Arbitrary: RecoveryFlow. Plant: key storage by the current process ID; clear receipts on
  // configure; route the old and new IDs to different stores.
  effect.effect.prop(
    "delivery counts, accepted history and pending recovery survive successor selection and reopen",
    { flow: RecoveryFlow },
    ({ flow }) => Effect.promise(() => runFlow({ ...flow, fault: "none", lost: null }).then(() => undefined)),
    flowOptions,
  );
  // Effect Arbitrary: RecoveryFlow. Plant: drop maxDeliveries from the box declaration; count a
  // transport failure as a program throw.
  effect.effect.prop(
    "default limit is 3, a program's declared limit wins, and RPC or decode faults spend no delivery",
    { flow: RecoveryFlow },
    ({ flow }) =>
      Effect.promise(() => runFlow({ ...flow, throws: 3, reopen: "none", lost: null }).then(() => undefined)),
    flowOptions,
  );
  // Effect Arbitrary: RecoveryFlow. Plant: throw away a checked refusal across RPC; clear pending
  // work before an answer; drop the down call or its write. One new Project RPC is lost, before or
  // after the Project acts. Every flow crashes past the brake, so it writes down and waits it out.
  effect.effect.prop(
    "recovery writes and process calls keep typed failures and retry saved actions",
    { flow: RecoveryFlow },
    ({ flow }) =>
      Effect.promise(async () => {
        const lost = flow.lost ?? { at: 1, side: "after" as const };
        const throws = BRAKE + (flow.throws % 2);
        const { w, current, restarts, live, route } = await runFlow({
          ...flow,
          throws,
          limit: Math.max(flow.limit ?? 32, throws),
          fault: "none",
          lost,
        });
        // A trusted restart with a generated request ID, asked twice: one replacement.
        const before = (await restarts()).length;
        const request = { id: `r${flow.restart}`, build: poisonCode.hash };
        const object = w.process(current).object;
        await Reflect.apply(Reflect.get(object, "restart"), object, [request]);
        await Reflect.apply(Reflect.get(object, "restart"), object, [request]);
        const rows = await until("trusted restart", restarts, (found) => found.length > before);
        expect(rows).toHaveLength(before + 1);
        expect(rows.at(-1)).toMatchObject({ after: current, name: NAME });
        const next = await until("restarted process live", live, (pid) => pid !== current);
        expect(rows.at(-1)).toMatchObject({ process: next });
        // The restart starts the new init and re-folds the accepted letters (P34, as
        // runner-supervision.test.ts requires): the healthy letters, never the throws.
        expect(await route("view.open", { pid: next })).toMatchObject({
          answer: { _tag: "ok", result: { view: { count: flow.healthy } } },
        });
        expect(w.newCalls()).toBeGreaterThan(0);
        expect(w.lostDone()).toBe(lost.at <= w.newCalls());
        // A restart whose request ID is the first start's: the Project refuses the reused ID, and
        // that checked refusal crosses the Project RPC and stays a ProcessError.
        const reused = await w
          .process(String(next))
          .object.restart({ id: NAME, build: poisonCode.hash })
          .then(
            () => ({ answer: "ok" }),
            (error: unknown) => ({ error }),
          );
        expect(reused).toMatchObject({ error: { _tag: "ProcessError", reason: "id_reused" } });
      }),
    flowOptions,
  );
});

describe("P34c slice 1: structured exit reasons over Project RPC", () => {
  const FROM = {
    by: "SHA256:p34c-test",
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: null,
    traceId: TRACE,
    build: "brain-test",
  };
  const same = (a: ExitReason, b: ExitReason) => JSON.stringify(a) === JSON.stringify(b);
  const Cell = fcExitReason.chain((reason) =>
    fc.record({
      move: fc.nat(),
      pick: fc.nat(),
      reason: fc.constant(reason),
      other: fcExitReason,
      bad: fcBadReason(reason),
    }),
  );
  type Move = "start" | "throw" | "exit" | "bad" | "retry" | "reopen";

  it("L1 / L3 / L4: a Project call decodes each reason before it writes, a runner crash arrives whole, and a retry is answered from the ledger", async () => {
    const done = new Set<Move>();
    await fc.assert(
      fc.asyncProperty(fc.array(Cell, { minLength: 4, maxLength: 9 }), async (tape) => {
        const w = world("healthy");
        await w.project.info();
        const client = await w.admit();
        // The fold's own record: each name's process chain and each ended process's reason.
        const names: Array<{ name: string; process: string; live: boolean }> = [];
        const exits = new Map<string, ExitReason>();
        const exited = async (name: string) =>
          (await w.project.read(`processes/${name}`, 0, "audit"))
            .filter((row) => row._tag === "exited")
            .map((row) => Object(row.body) as { process: string; reason: unknown })
            .map(({ process, reason }) => [process, reason] as const);

        for (const cell of tape) {
          const live = names.filter((n) => n.live);
          const options: ReadonlyArray<Move> = [
            ...(names.length < 2 ? (["start"] as const) : []),
            ...(live.length > 0 ? (["throw", "exit", "bad"] as const) : []),
            ...(exits.size > 0 ? (["retry"] as const) : []),
            "reopen",
          ];
          const move = options[cell.move % options.length]!;

          switch (move) {
            case "start": {
              const name = `poison:${names.length + 1}`;
              names.push({ name, process: await w.startPoison(name), live: true });
              break;
            }
            case "throw": {
              // The real runner crashes on a fresh letter and reports it over Project RPC.
              const target = live[cell.pick % live.length]!;
              await w.project
                .route(client, "process.send", {
                  pid: target.process,
                  letter: `throw-${exits.size}`,
                  m: { type: "throw" },
                  sentAt: SENT,
                  seen: 0,
                })
                .catch(() => undefined);
              exits.set(target.process, { _tag: "crashed", phase: "step", error: "TypeError" });
              const next = await until("successor", w.project.info, (rows) =>
                rows.some((row) => row.name === target.name && row.process !== target.process),
              );
              target.process = next.find((row) => row.name === target.name)!.process;
              break;
            }
            case "exit": {
              const target = live[cell.pick % live.length]!;
              const reply = await w.project.processExit(target.process, copied(cell.reason), FROM);
              expect(reply, "a valid reason commits").toMatchObject({ _tag: "ok" });
              exits.set(target.process, cell.reason);
              target.live = false;
              break;
            }
            case "bad": {
              const target = live[cell.pick % live.length]!;
              const before = await exited(target.name);
              const reply = await w.project
                .processExit(target.process, cell.bad as ExitReason, FROM)
                .catch((error: unknown) => ({ _tag: Object(error)._tag }));
              expect(reply, `invalid input is a typed refusal: ${JSON.stringify(cell.bad)}`).toMatchObject({
                _tag: "ProcessError",
              });
              expect(await exited(target.name), "a refused exit writes nothing").toEqual(before);
              expect(await w.project.processIsLive(target.process)).toBe(true);
              break;
            }
            case "retry": {
              const [process, reason] = [...exits.entries()][cell.pick % exits.size]!;
              const sent = cell.move % 2 === 0 ? copied(reason) : cell.other;
              const reply = await w.project.processExit(process, sent, FROM);
              expect(reply).toMatchObject(
                same(sent, reason) ? { _tag: "ok" } : { _tag: "ProcessError", reason: "ended" },
              );
              break;
            }
            case "reopen":
              await w.reopenAll();
              break;
          }

          done.add(move);
          const rows = (await Promise.all(names.map(({ name }) => exited(name)))).flat();
          expect(Object.fromEntries(rows), "each exit reads back as the reason it was given").toEqual(
            Object.fromEntries(exits),
          );
        }
      }),
      { seed: 119120, numRuns: 40, endOnFailure: true },
    );
    expect([...done]).toEqual(expect.arrayContaining(["start", "throw", "exit", "bad", "retry", "reopen"]));
  }, 600_000);
});

const mailModel = (w: ReturnType<typeof world>, pid: string) => {
  const db = w.process(pid).db;
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='process_state'").get();

  if (table === undefined) {
    return null;
  }

  const row = db.prepare("SELECT checkpoint FROM process_state WHERE process=?").get(pid);
  return row === undefined ? null : JSON.parse(String(row.checkpoint)).saved.model;
};

const mailRequest = (pid: string, ref: string) => ({
  pid,
  letter: `start-${ref}`,
  m: { type: "start", ref, value: 7 },
  sentAt: SENT,
  seen: 0,
});

const oneExchange = async (w: ReturnType<typeof world>, requester: string, responder: string, ref: string) => {
  await until(
    "the saved requester answers without a view call",
    async () => mailModel(w, requester),
    (model) => model?._tag === "answered",
  );
  expect(mailModel(w, requester)).toMatchObject({ _tag: "answered", ref, value: 8 });
  expect(mailModel(w, responder)).toMatchObject({ answered: 1 });
  const requests = await w.project.read("responder:1/inbox", 0, "audit");
  expect(requests.filter((row) => Reflect.get(Object(row.body), "m")?.ref === ref)).toHaveLength(1);
  const receipts = await w.project.read("requester:1/outbox", 0, "audit");
  expect(receipts.filter((row) => Reflect.get(Object(row.body), "ref") === ref)).toHaveLength(1);
  await until(
    "the answered Send leaves no sender alarm",
    () => w.process(requester).object.savedAlarm(),
    (at) => at == null,
  );
};

// scenario: only a test-owned platform alarm holds eviction strictly before the target's drain.
it("scenario: W2h, a target reopened before its alarm fires drains the saved letter once", async () => {
  const w = world();
  const requester = await w.startMail("requester");
  const responder = await w.startMail("responder");
  const client = await w.admit();
  w.holdAlarm(responder, true);
  expect(await w.project.route(client, "process.send", mailRequest(requester, "held-target"))).toMatchObject({
    _tag: "ok",
    result: { _tag: "accepted" },
  });
  expect(await w.process(responder).object.savedAlarm()).toBeTypeOf("number");
  expect(mailModel(w, responder)?.answered ?? 0).toBe(0);
  await w.reopenProcess(responder);
  expect(await w.process(responder).object.savedAlarm()).toBeTypeOf("number");
  w.holdAlarm(responder, false);
  await oneExchange(w, requester, responder, "held-target");
}, 30_000);

// scenario: a held Project RPC puts eviction after the receipt save and before queued reaches the sender.
it("scenario: W3, an evicted sender retries its owed Send from its alarm and adds no receipt or letter", async () => {
  const w = world();
  const requester = await w.startMail("requester");
  const responder = await w.startMail("responder");
  const client = await w.admit();
  const release = gate();
  let first = true;
  w.holdAlarm(requester, true);
  w.holdMail(async () => {
    if (!first) {
      return;
    }

    first = false;
    await release.promise;
  });
  const sending = w.project.route(client, "process.send", mailRequest(requester, "held-sender")).catch(() => undefined);
  await until(
    "Project mail is saved and its reply is held",
    async () => !first,
    (held) => held,
  );
  expect(await w.process(requester).object.savedAlarm(), "the owed Send already owns an alarm").toBeTypeOf("number");
  expect(await w.project.read("requester:1/outbox", 0, "audit")).toHaveLength(1);
  await w.reopenProcess(requester);
  release.resolve();
  await sending;
  w.holdAlarm(requester, false);
  await oneExchange(w, requester, responder, "held-sender");
}, 30_000);
