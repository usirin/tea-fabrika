// P12, next/. Real Project and Process classes, RPC adapters, Door and runner on SQLite.
// Only Cloudflare's handles and Worker Loader transport are supplied by this Node fixture.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Cmd, Machine } from "@demlik/tea/effect";
import { counter } from "@kampus/counter";
import { nodeExecution, type Descriptor, type Incoming } from "@kampus/libfabrika";
import { revokeText, Start } from "@kampus/libfabrika/coordination";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Process, Project } from "./brain.ts";
import type { Env } from "./runtime.ts";

const table = vi.hoisted(() => ({ programs: {} as Record<string, { hash: string; source: string }> }));
vi.mock("./table.ts", () => table);

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      readonly ctx: DurableObjectState,
      readonly env: Env,
    ) {}
  },
  WorkerEntrypoint: class {},
}));

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

const storage = (db: DatabaseSync) => {
  const sql = nodeSql(db),
    values = new Map<string, unknown>();
  return {
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
    setAlarm: async () => {},
    deleteAlarm: async () => {},
  };
};

const gate = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const world = (fault: "failed" | "interrupted" | "healthy" = "healthy") => {
  table.programs.counter = { hash: "counter-a", source: "counter" };
  table.programs.approvals = { hash: "approvals-a", source: "approvals" };
  const key = identity(),
    db = new DatabaseSync(":memory:");
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies only the platform handles used by the real Project class
  const ctx = { id: { name: "project-test" }, storage: storage(db) } as unknown as DurableObjectState;
  const processes = new Map<string, { object: Process; db: DatabaseSync }>(),
    attempts: Descriptor[] = [],
    received: Incoming[] = [],
    entered = gate(),
    interrupted = gate();
  let project: Project;
  let beforeCommit = async () => {};
  let signs = 0,
    commits = 0;
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
    PROJECT: {
      getByName: () => ({
        read: project.read.bind(project),
        wait: project.wait.bind(project),
        append: project.append.bind(project),
        inbox: project.inbox.bind(project),
        own: project.own.bind(project),
        publish: project.publish.bind(project),
        sign: (...args: Parameters<Project["sign"]>) => {
          signs++;
          return project.sign(...args);
        },
        commit: async (...args: Parameters<Project["commit"]>) => {
          commits++;
          await beforeCommit();
          return project.commit(...args);
        },
      }),
    },
    PROCESS: {
      getByName: (name: string) => {
        const [, pid] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.String]))(JSON.parse(name));
        let saved = processes.get(pid);

        if (saved === undefined) {
          const processDb = new DatabaseSync(":memory:");
          // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies the SQL, descriptor, alarm and sync handles the real Process reads
          const processCtx = {
            id: { name },
            storage: storage(processDb),
          } as unknown as DurableObjectState;
          saved = { object: new Process(processCtx, env), db: processDb };
          processes.set(pid, saved);
        }

        const object = saved.object;
        return {
          configure: async (descriptor: Descriptor) => {
            attempts.push(structuredClone(descriptor));
            entered.resolve();

            if (attempts.length === 1 && fault === "failed") {
              throw new Error("configure failed before save");
            }

            if (attempts.length === 1 && fault === "interrupted") {
              await interrupted.promise;
              return;
            }

            return object.configure(descriptor);
          },
          descriptor: object.descriptor.bind(object),
          open: object.open.bind(object),
          msg: (incoming: Incoming) => {
            received.push(incoming);
            return object.msg(incoming);
          },
        };
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
  project = new Project(ctx, env);
  closers.push(async () => {
    interrupted.resolve();

    for (const { object, db: processDb } of processes.values()) {
      await object.runtime.dispose();
      processDb.close();
    }

    await project.runtime.dispose();
    db.close();
  });
  return {
    get project() {
      return project;
    },
    db,
    attempts,
    received,
    entered: entered.promise,
    process: (pid: string) => processes.get(pid)!,
    interrupt: async () => {
      await project.runtime.dispose();
      interrupted.resolve();
    },
    reopen: async () => {
      await project.runtime.dispose();
      table.programs.counter = { hash: "counter-b", source: "changed counter" };
      project = new Project(ctx, env);
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
