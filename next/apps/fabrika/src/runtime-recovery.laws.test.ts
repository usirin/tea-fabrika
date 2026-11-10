// P12, next/. The real Project and Process services, Door and runner on SQLite.
// Only Cloudflare's handles and Worker Loader transport are supplied by this Node fixture.
// No class from brain.ts and no cloudflare:workers: the services are what the classes hand off to.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Cmd, Machine } from "@demlik/tea/effect";
import { it as effect } from "@effect/vitest";
import { counter } from "@kampus/counter";
import { nodeExecution, type Descriptor, type Incoming } from "@kampus/libfabrika";
import { programBox } from "@kampus/libfabrika/box";
import { revokeText, Start } from "@kampus/libfabrika/coordination";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import {
  commitReply,
  configureProcess,
  processDescriptor,
  processRuntime,
  ProcessService,
  ProjectService,
  signingReply,
} from "@kampus/libfabrika/workers/runtime";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectRuntime, type Env } from "./runtime.ts";
import { programs } from "./table.ts";

const table = vi.hoisted(() => ({ programs: {} as Record<string, { hash: string; source: string }> }));
vi.mock("./table.ts", () => table);

type ProjectCalls = (typeof ProjectService)["Service"];
type ProcessCalls = (typeof ProcessService)["Service"];

// What the Project class hands off: each call runs one service method on the object's runtime.
const projectObject = (ctx: DurableObjectState, env: Env) => {
  const runtime = projectRuntime(ctx, env);
  const run = <A, E>(use: (p: ProjectCalls) => Effect.Effect<A, E>) => runtime.runPromise(ProjectService.use(use));
  return {
    runtime,
    info: () => run((p) => p.info),
    clientConnect: () => run((p) => p.connect()),
    challenge: (client: Parameters<ProjectCalls["challenge"]>[0]) => run((p) => p.challenge(client)),
    initialize: (...args: Parameters<ProjectCalls["initialize"]>) => run((p) => p.initialize(...args)),
    route: (...args: Parameters<ProjectCalls["route"]>) => run((p) => p.route(...args)),
    grant: (input: unknown) => run((p) => p.grant(input)),
    start: (...args: Parameters<ProjectCalls["start"]>) => run((p) => p.start(...args)),
    read: (...args: Parameters<ProjectCalls["read"]>) => run((p) => p.read(...args)),
    wait: (...args: Parameters<ProjectCalls["wait"]>) => run((p) => p.wait(...args)),
    append: (...args: Parameters<ProjectCalls["append"]>) => run((p) => p.append(...args)),
    inbox: (...args: Parameters<ProjectCalls["inbox"]>) => run((p) => p.inbox(...args)),
    own: (...args: Parameters<ProjectCalls["own"]>) => run((p) => p.own(...args)),
    publish: (...args: Parameters<ProjectCalls["publish"]>) => run((p) => p.publish(...args)),
    sign: (...args: Parameters<ProjectCalls["sign"]>) => run((p) => signingReply(p.sign(...args))),
    commit: (...args: Parameters<ProjectCalls["commit"]>) => run((p) => commitReply(p.commit(...args))),
  };
};

type ProjectObject = ReturnType<typeof projectObject>;

// What the Process class hands off, with the same descriptor reads and writes on its handles.
const processObject = (ctx: DurableObjectState, env: Env) => {
  const runtime = processRuntime(ctx, env, programs);
  const run = <A, E>(use: (p: ProcessCalls) => Effect.Effect<A, E>) => runtime.runPromise(ProcessService.use(use));
  return {
    runtime,
    configure: (descriptor: Descriptor) => Effect.runPromise(configureProcess(ctx, descriptor)),
    descriptor: () => Effect.runPromise(processDescriptor(ctx)),
    open: (client: string) => run((p) => p.open(client)),
    msg: (input: unknown) => run((p) => p.msg(input)),
  };
};

type ProcessObject = ReturnType<typeof processObject>;

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
  name: "approvals",
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
    setAlarm: async (at: number) => alarms?.set(at),
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
  name: "poison",
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
  object: Process;
  readonly db: DatabaseSync;
  readonly ctx: DurableObjectState;
  readonly values: Map<string, unknown>;
  timer: ReturnType<typeof setTimeout> | undefined;
  alarm: number | null;
};

type Lost = { readonly at: number; readonly side: "before" | "after" } | null;

const world = (
  fault: "failed" | "interrupted" | "healthy" = "healthy",
  flow: { readonly limit: number | null; readonly lost: Lost } = { limit: null, lost: null },
) => {
  table.programs.counter = { hash: "counter-a", source: "counter" };
  table.programs.approvals = { hash: "approvals-a", source: "approvals" };
  table.programs.poison = { hash: "poison-a", source: "poison" };
  const key = identity(),
    db = new DatabaseSync(":memory:");
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies only the platform handles used by the real Project service
  const ctx = { id: { name: "project-test" }, storage: storage(db) } as unknown as DurableObjectState;
  // Keyed by the storage name the runtime asks for, so the runtime alone decides which IDs share one.
  const processes = new Map<string, Entry>(),
    attempts: Descriptor[] = [],
    received: Incoming[] = [],
    entered = gate(),
    interrupted = gate();
  let project: ProjectObject;
  let beforeCommit = async () => {};
  let signs = 0,
    commits = 0,
    newCalls = 0,
    lostDone = false,
    stepFault: "none" | "rpc" | "decode" = "none",
    closed = false;
  const schedule = (entry: Entry) => {
    clearTimeout(entry.timer);

    if (entry.alarm === null || closed) {
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

    if (OLD_PROJECT_CALLS.has(method)) {
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
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node namespaces call the real classes but do not have workerd's nominal brands
  const env = {
    STAGE: JSON.stringify({
      name: "project-test",
      person: PERSON,
      founder: key.line,
      window: key.raw,
      port: 18787,
      build: "brain-test",
    }),
    // Every Project RPC the real class has, so new Project calls reach the real object too.
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
                return (...args: Parameters<Project["sign"]>) => {
                  signs++;
                  return project.sign(...args);
                };
              }

              if (method === "commit") {
                return async (...args: Parameters<Project["commit"]>) => {
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
          const processCtx = { id: { name }, storage: handles } as unknown as DurableObjectState;
          const created: Entry = {
            db: processDb,
            ctx: processCtx,
            values: handles.values,
            timer: undefined,
            alarm: null,
            object: new Process(processCtx, env),
          };
          entry = created;
          processes.set(storageKey, created);
          return created;
        };
        const current: Entry = processes.get(storageKey) ?? made();
        // Every Process RPC the real class has; reopen swaps the object behind the same stub.
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

                  return current.object.configure(descriptor);
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
    GATEWAY: {
      getByName: () => ({ ring: async () => {}, notify: async () => {}, probe: async () => 42 }),
    },
    RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
    HEALTH: {},
    LOADER: {
      get: (id: string) => ({
        getEntrypoint: () => {
          if (id.startsWith("poison-")) {
            // The real box: its declaration carries the program's own maxDeliveries.
            const Box = programBox(poisonProgram(flow.limit), "poison-a");
            const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
            return {
              describe: () => box.describe(),
              init: (saved: unknown) => box.init(saved),
              step: async (model: unknown, msg: unknown) => {
                // Transport faults before the program: they decide nothing about the input.
                if (stepFault === "rpc") {
                  throw new Error("transport failed before the program");
                }

                if (stepFault === "decode") {
                  return { unrecognized: true };
                }

                return box.step(model, msg);
              },
              fold: (model: unknown, msg: unknown) => box.fold(model, msg),
              upgrade: (saved: unknown) => box.upgrade(saved),
              reply: (cmd: unknown, outcome: unknown) => box.reply(cmd, outcome),
              check: (kind: string, event: unknown) => box.check(kind, event),
              admit: (msg: unknown) => box.admit(msg),
            };
          }

          const approval = id.startsWith("approvals-"),
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
            init: (saved: unknown) => Effect.runPromise(execution.init(saved)),
            step: (model: unknown, msg: unknown) => Effect.runPromise(execution.step(model, msg)),
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
  closers.push(async () => {
    closed = true;
    interrupted.resolve();

    for (const { object, db: processDb, timer } of processes.values()) {
      clearTimeout(timer);
      await object.runtime.dispose();
      processDb.close();
    }

    await project.runtime.dispose();
    db.close();
  });
  /** The registered name the Project saved for a process ID, if any. */
  const nameFor = (pid: string): string | undefined => {
    const row = db.prepare("SELECT value FROM stage_descriptors WHERE process=?").get(pid);
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
    get project() {
      return project;
    },
    db,
    attempts,
    received,
    entered: entered.promise,
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
      project = new Project(ctx, env);

      for (const entry of processes.values()) {
        entry.object = new Process(entry.ctx, env);
        schedule(entry);
      }

      await project.info();
    },
    startPoison: async (name: string) =>
      (
        await project.start(Start.cases.first.make({ id: name, name, code: { program: "poison", hash: "poison-a" } }), {
          by: key.fingerprint,
          for: PERSON,
          sentAt: SENT,
          seen: 0,
          parent: null,
          traceId: TRACE,
          build: "brain-test",
        })
      ).process,
    interrupt: async () => {
      await project.runtime.dispose();
      interrupted.resolve();
    },
    reopen: async () => {
      await project.runtime.dispose();
      table.programs.counter = { hash: "counter-b", source: "changed counter" };
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
          code: { program: "approvals", hash: "approvals-a" },
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
          saw: { label: "fixture", where: "local", how: "command", check: "none" },
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

describe("P12 Project configure recovery", () => {
  for (const fault of ["failed", "interrupted", "healthy"] as const) {
    it(`pinned: ${fault} configure restores the descriptor after an interrupted start`, async () => {
      const w = world(fault);
      const first = w.project.info().then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await w.entered;

      if (fault === "interrupted") {
        await w.interrupt();
      }

      const result = await first;
      expect("value" in result).toBe(fault === "healthy");
      const descriptor = w.attempts[0]!;
      const saved = w.db.prepare("SELECT value FROM stage_descriptors WHERE process=?").get(descriptor.id);
      expect(JSON.parse(String(saved!.value))).toEqual(descriptor);
      expect(await w.reopen()).toMatchObject([{ process: descriptor.id, name: "counter:1", program: "counter" }]);
      expect(w.attempts).toHaveLength(fault === "healthy" ? 1 : 2);

      for (const attempt of w.attempts) {
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

// Ticket 402: P34's recovery on the Worker path, with the real Project and Process classes.
const Word = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,11}$/));

/** One generated recovery flow. Limits run 1 to 32; null is the Worker's default policy. */
const RecoveryFlow = Schema.Struct({
  letter: Word,
  restart: Word,
  limit: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 }))),
  throws: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
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

const until = async <A>(what: string, look: () => Promise<A>, done: (value: A) => boolean) => {
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

  throw new Error(`${what}: no answer in ${FLOW_WAIT} ms; last observed ${JSON.stringify(last)}`);
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
      expect(answer).toMatchObject({ answer: { _tag: "refused", why: "dead" } });
    } else {
      expect(answer).not.toMatchObject({ answer: { _tag: "ok" } });
    }

    if (flow.reopen === "throws" && n === 1) {
      await w.reopenAll();
    }

    const rows = await until(`restart ${n}`, restarts, (found) => found.length >= n);
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
  const deadFacts = () => deadRows(chain).then((rows) => rows.map((row) => ({ ...Object(row.body), _tag: row._tag })));
  expect(await deadFacts()).toEqual(
    dead.map((process) => ({
      _tag: "dead",
      process,
      program: "poison",
      name: NAME,
      tries: limit,
      limit,
      m: letter,
      build: "poison-a",
      errors: Array.from({ length: limit }, () => "TypeError"),
      // The brain writes the row; `asked` keeps the key that asked for it (process-manager.ts).
      asked: expect.stringMatching(/^SHA256:/),
    })),
  );

  if (k === limit) {
    for (let n = 0; n < flow.resends; n++) {
      expect(await send(original, letter, "throw")).toMatchObject({
        answer: { _tag: "refused", why: "dead" },
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
      answer: { _tag: "refused", why: "dead" },
    });
  }

  expect(await route("view.open", { pid: current })).toMatchObject({
    answer: { _tag: "ok", result: { view: { count: flow.healthy } } },
  });
  expect(await w.project.read(`${NAME}/inbox`, 0, "audit")).toHaveLength(inbox);
  expect(await restarts()).toHaveLength(k);
  expect(await deadFacts()).toHaveLength(dead.length);

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
  // work before an answer. One new Project RPC is lost, before or after the Project acts.
  effect.effect.prop(
    "recovery writes and process calls keep typed failures and retry saved actions",
    { flow: RecoveryFlow },
    ({ flow }) =>
      Effect.promise(async () => {
        const lost = flow.lost ?? { at: 1, side: "after" as const };
        const { w, current, restarts, live, route } = await runFlow({
          ...flow,
          throws: Math.max(1, flow.throws),
          fault: "none",
          lost,
        });
        // A trusted restart with a generated request ID, asked twice: one replacement.
        const before = (await restarts()).length;
        const request = { id: `r${flow.restart}`, build: "poison-a" };
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
      }),
    flowOptions,
  );
});
