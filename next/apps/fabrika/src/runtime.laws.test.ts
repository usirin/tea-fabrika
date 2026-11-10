// P12, next/. Project and Gateway use their real composition and SQLite services.
// Only platform handles are supplied here. No sockets or substitute authority rules.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Descriptor, Incoming, Sent } from "@kampus/libfabrika";
import { BrainEvent } from "@kampus/libfabrika/brain-event";
import { revokeText, SigningRefused, Start, type From } from "@kampus/libfabrika/coordination";
import type { SpanRow } from "@kampus/libfabrika/data";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Attached } from "@kampus/libfabrika/transport";
import { GatewayService, gatewayRuntime } from "@kampus/libfabrika/workers/gateway";
import { ProjectService, bucketCalls } from "@kampus/libfabrika/workers/runtime";
import { Cause, Deferred, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Tracer } from "effect";
import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectRuntime, settings, type Env } from "./runtime.ts";
import { Settings } from "./settings.ts";

const table = vi.hoisted(() => ({ programs: {} as Record<string, { hash: string; source: string }> }));
vi.mock("./table.ts", () => table);
// P16: the brain reads its embedded tables from the build's generated module
// (libfabrika's build-modules.d.ts). Mocking both keeps these laws on either wiring.
vi.mock("virtual:fabrika-built", () => ({ ...table, assets: {} }));

vi.mock("effect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect")>();
  return { ...actual, ManagedRuntime: { ...actual.ManagedRuntime } };
});

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SENT = "2026-11-08T04:00:00.000Z";

const field = (value: Buffer | string) => {
  const body = Buffer.from(value),
    size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519"),
    raw = pair.publicKey.export({ format: "jwk" }).x!;
  const bytes = Buffer.from(raw, "base64url"),
    blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw,
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

const closers: Array<() => Promise<void>> = [];

const generated = fc.record({
  letter: fc.uuid(),
  write: fc.uuid(),
  trace: fc.uint8Array({ minLength: 16, maxLength: 16 }).map((bytes) => Buffer.from(bytes).toString("hex")),
  build: fc.uuid(),
  rev: fc.integer({ min: 1, max: 1_000_000 }),
});

const prepareInput = {
  letter: "prepare",
  write: "write-1",
  trace: TRACE,
  build: "counter-b",
  rev: 1,
};

const approveInput = { ...prepareInput, letter: "approve" };

const law = (name: string, check: (input: ReturnType<typeof generated.generate>["value"]) => Promise<void>) =>
  it(name, async () => {
    await fc.assert(
      fc.asyncProperty(generated, async (input) => {
        try {
          await check(input);
        } finally {
          for (const close of closers.splice(0).reverse()) {
            await close();
          }
        }
      }),
      { seed: 119120, numRuns: 20, examples: [[prepareInput], [approveInput]] },
    );
  });

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
  };
};

const world = async (trace = TRACE, build = "counter-b") => {
  table.programs.counter = { hash: "counter-a", source: "counter" };
  table.programs.approvals = { hash: "approvals-a", source: "approvals" };
  const home = mkdtempSync(join(tmpdir(), "p12-r-")),
    key = identity();
  const db = new DatabaseSync(join(home, "project.db"));
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture implements the platform members Project reads; only workerd can construct a full DurableObjectState
  const ctx = { id: { name: "project-test" }, storage: storage(db) } as unknown as DurableObjectState;
  const descriptors = new Map<string, Descriptor>(),
    configured: Descriptor[] = [],
    received: Incoming[] = [],
    recorded: SpanRow[] = [];
  let onMessage: (pid: string, input: Incoming) => Promise<Sent> = async (_pid, input) => {
    received.push(input);
    return { _tag: "accepted", rev: 1, pos: 1 };
  };
  let onRing: () => Promise<void> = async () => {};
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node binding doubles implement only the RPC methods this composition calls, without workerd's nominal brands
  const env = {
    STAGE: JSON.stringify({
      name: "project-test",
      person: PERSON,
      founder: key.line,
      window: key.raw,
      port: 18787,
      build: "brain-test",
    }),
    PROCESS: {
      getByName: (name: string) => {
        const [, pid] = JSON.parse(name) as [string, string];
        return {
          configure: async (descriptor: Descriptor) => {
            descriptors.set(pid, descriptor);
            configured.push(descriptor);
          },
          msg: (input: Incoming) => onMessage(pid, input),
        };
      },
    },
    GATEWAY: {
      getByName: () => ({ ring: () => onRing(), notify: async () => {}, probe: async () => 42 }),
    },
    RECORD: {
      getByName: () => ({
        write: async (_chain: unknown, _part: number, rows: ReadonlyArray<{ span: SpanRow }>) => {
          recorded.push(...rows.map((row) => row.span));
          return { _tag: "written" };
        },
      }),
    },
    HEALTH: {},
    LOADER: {
      get: (id: string) => ({
        getEntrypoint: () => ({
          describe: async () =>
            id.startsWith("approvals-")
              ? {
                  name: "approvals",
                  v: 1,
                  writes: { answered: { personOnly: true } },
                  inputs: {
                    prepare: { write: true, personOnly: false },
                    approve: { write: true, personOnly: true },
                  },
                  cmds: [],
                }
              : {
                  name: "counter",
                  v: 1,
                  writes: {},
                  inputs: { inc: { write: true, personOnly: false } },
                  cmds: [],
                },
        }),
      }),
    },
  } as unknown as Env;
  const span = Tracer.externalSpan({ traceId: trace, spanId: "00f067aa0ba902b7" });
  const make = ManagedRuntime.make;
  // ManagedRuntime builds its layer before the requested Effect runs, in a separate fiber.
  // Put the caller's span on that real layer so it is current during bootstrap.
  const startup = vi
    .spyOn(ManagedRuntime, "make")
    .mockImplementationOnce((layer, options) => make(layer.pipe(Layer.withParentSpan(span)), options));
  let runtime: ReturnType<typeof projectRuntime>;

  try {
    runtime = projectRuntime(ctx, env);
  } finally {
    startup.mockRestore();
  }

  const run = <A, E>(work: Effect.Effect<A, E, ProjectService>) => runtime.runPromise(work);
  closers.push(async () => {
    await runtime.dispose();
    db.close();
    rmSync(home, { recursive: true, force: true });
  });
  const p = await run(ProjectService);
  const from: From = {
    by: key.fingerprint,
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: null,
    traceId: trace,
    build: "brain-test",
  };
  const client = await run(p.connect()),
    nonce = await run(p.challenge(client));
  expect(
    await run(
      p.initialize(
        client,
        {
          versions: [1],
          has: ["seal"],
          ping: "30s",
          key: key.raw,
          tab: "tab-a",
          nonce,
          platform: "headless",
          os: "linux",
          sentAt: SENT,
          signed: key.proof(`fabrika-hello\nhttp://127.0.0.1:18787\ntab-a\n${nonce}`),
        },
        { url: "http://127.0.0.1:18787", tab: "tab-a", name: key.fingerprint },
      ),
    ),
  ).toMatchObject({ _tag: "online" });
  return {
    p,
    run,
    client,
    span,
    key,
    env,
    ctx,
    db,
    from,
    descriptors,
    configured,
    received,
    recorded,
    start: async () =>
      (
        await run(
          p.start(
            Start.cases.first.make({
              id: "approvals:1",
              name: "approvals:1",
              code: { program: "approvals", hash: "approvals-a" },
            }),
            from,
          ),
        )
      ).process,
    send: (pid: string, type: string, letter = type) =>
      run(p.route(client, "process.send", { pid, letter, m: { type }, sentAt: SENT, seen: 0 })),
    revoke: () => {
      const text = revokeText({
        id: "revoke-1",
        key: key.raw,
        for: PERSON,
        to: "project-test",
        saw: { label: "fixture", where: "local", how: "command", check: "none" },
        sentAt: SENT,
      });
      return run(p.grant({ text, armored: key.proof(text) }));
    },
    message: (f: typeof onMessage) => {
      onMessage = f;
    },
    ring: (f: typeof onRing) => {
      onRing = f;
    },
    reopen: async () => {
      await runtime.dispose();
      table.programs.counter = { hash: build, source: "changed counter" };
      runtime = projectRuntime(ctx, env);
      return run(ProjectService);
    },
    reopenExit: async () => {
      await runtime.dispose();
      runtime = projectRuntime(ctx, env);
      return runtime.runPromiseExit(ProjectService);
    },
  };
};

describe("P12 Project authority", () => {
  law("the bootstrap entry keeps the caller's span trace", async ({ trace }) => {
    const w = await world(trace);
    const [row] = await w.run(w.p.read("processes/counter:1", 0, "audit"));
    expect(row).toMatchObject({ traceId: w.span.traceId, rev: w.p.boot.rev });
  });
  law("a brain lifecycle entry keeps the caller's span trace", async ({ trace, write }) => {
    const w = await world();
    const event = BrainEvent.cases.stopped.make({ id: write, start: write, at: 1, reason: "stop" });
    await w.run(
      w.p.brain(event).pipe(Effect.withParentSpan(Tracer.externalSpan({ traceId: trace, spanId: "00f067aa0ba902b7" }))),
    );
    const [row] = await w.run(w.p.read("door/brain", 0, "audit"));
    const { _tag, ...body } = event;
    expect(row).toMatchObject({ traceId: trace, id: write, _tag, body });
  });
  law("reopening an exited bootstrap reads its first placing without starting it again", async ({ trace, build }) => {
    const w = await world(trace, build);
    const first = w.p.boot;
    const before = await w.run(w.p.read("processes/counter:1", 0, "audit"));
    await w.run(w.p.exit(first.process, "normal", w.from));
    const configured = w.configured.length;
    const reopened = await w.reopen();
    expect(reopened.boot).toEqual(first);
    expect(w.configured).toHaveLength(configured);
    const entries = await w.run(reopened.read("processes/counter:1", 0, "audit"));
    expect(entries[0]).toEqual(before[0]);
    expect(entries).toHaveLength(2);
  });
  law("a program's person-only events require its own person-only input", async ({ letter, write }) => {
    const w = await world(),
      pid = await w.start();
    await w.send(pid, "prepare", letter);
    const parent = w.received[0]!.envelope.id;
    const result = await w.run(Effect.exit(w.p.sign(pid, write, parent, "answered")));
    expect(result).toMatchObject({ _tag: "Failure" });
    const failure = Option.getOrThrow(Exit.findErrorOption(result));
    expect(failure).toBeInstanceOf(SigningRefused);
    expect(failure).toMatchObject({ reason: "person_only" });
  });
  law("a program's declared person-only input authorizes its person-only event", async ({ letter, write }) => {
    const w = await world(),
      pid = await w.start();
    await w.send(pid, "approve", letter);
    const result = await w.run(Effect.exit(w.p.sign(pid, write, w.received[0]!.envelope.id, "answered")));
    expect(result).toMatchObject({ _tag: "Success", value: { by: { _tag: "person" } } });
    // The saved delivery is independent evidence of the declaration used at admission.
    const saved = w.db.prepare("SELECT saved FROM door_sessions WHERE parent=?").get(w.received[0]!.envelope.id);
    expect(JSON.parse(String(saved!.saved))).toMatchObject({
      input: { personOnly: true, process: pid },
    });
  });
  law("input permission is checked again at the final append", async ({ letter }) => {
    const w = await world(),
      pid = w.p.boot.process;
    const entered = await Effect.runPromise(Deferred.make<void>()),
      release = await Effect.runPromise(Deferred.make<void>());
    w.message(async (_pid, input) => {
      w.received.push(input);
      await Effect.runPromise(Deferred.succeed(entered, undefined));
      await Effect.runPromise(Deferred.await(release));
      const result = await w.run(w.p.inbox(pid, input));
      return result._tag === "placed"
        ? { _tag: "accepted", rev: result.rev, pos: result.pos }
        : { _tag: "refused", reason: result.reason };
    });
    const pending = w.send(pid, "inc", letter).then(
      (answer) => ({ answer }),
      (error: unknown) => ({ error }),
    );
    await Effect.runPromise(Deferred.await(entered));

    try {
      expect(await w.revoke()).toMatchObject({ _tag: "applied" });
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
    }

    await pending;
    expect(await w.run(w.p.read("counter:1/inbox", 0, "audit"))).toEqual([]);
  });

  for (const operation of ["own", "inbox", "start", "exit"] as const) {
    law(`the Project releases its write permit before notifying ${operation}`, async ({ write, letter }) => {
      const w = await world(),
        pid = w.p.boot.process;
      const stream =
        operation === "own"
          ? "events"
          : operation === "inbox"
            ? "counter:1/inbox"
            : operation === "start"
              ? "processes/approvals:1"
              : "processes/counter:1";
      const after = (await w.run(w.p.read(stream, 0, "audit"))).at(-1)?.rev ?? 0;
      await w.run(w.p.wait(stream, after, "gateway-test"));
      let reentered = false;
      let inside = false;
      w.ring(async () => {
        if (inside) {
          return;
        }

        inside = true;
        const answer = await w.run(
          w.p
            .start(
              Start.cases.first.make({
                id: `nested:${write}`,
                name: `nested:${write}`,
                code: { program: "counter", hash: "counter-a" },
              }),
              w.from,
            )
            .pipe(Effect.timeoutOption("150 millis")),
        );
        reentered = Option.isSome(answer);
      });

      if (operation === "own") {
        await w.run(w.p.own(pid, write, "events", { _tag: "noted" }));
      } else if (operation === "start") {
        await w.start();
      } else if (operation === "exit") {
        await w.run(w.p.exit(pid, "normal", w.from));
      } else {
        await w.send(pid, "inc", letter);
        await w.run(w.p.inbox(pid, w.received[0]!));
      }

      expect(reentered, "a ring can reenter Project without waiting on its caller").toBe(true);
    });
  }

  law("reopening a project restores its process when the available bundle changes", async ({ build }) => {
    const w = await world(TRACE, build),
      before = await w.run(w.p.info),
      configured = w.configured.length;
    const result = await Effect.runPromise(
      Effect.tryPromise({
        try: w.reopen,
        catch: (cause) => new Error("project reopen failed", { cause }),
      }).pipe(Effect.exit),
    );
    expect(result).toMatchObject({ _tag: "Success" });

    if (Exit.isSuccess(result)) {
      expect(await w.run(result.value.info)).toEqual(before);
      expect(w.configured).toHaveLength(configured);
      expect(await w.run(result.value.read("processes/counter:1", 0, "audit"))).toHaveLength(1);
    }
  });

  for (const field of ["writer", "trace"] as const) {
    law(`an own write retains its process ${field}`, async ({ trace, write }) => {
      const w = await world(trace),
        pid = w.p.boot.process;
      await w.run(
        w.p
          .own(pid, write, "events", { _tag: "noted" })
          .pipe(Effect.withParentSpan(Tracer.externalSpan({ traceId: trace, spanId: "00f067aa0ba902b7" }))),
      );
      const [row] = await w.run(w.p.read("events", 0, "audit"));
      expect(row).toMatchObject(
        field === "writer" ? { by: w.descriptors.get(pid)!.owner.key, for: PERSON, parent: null } : { traceId: trace },
      );
    });
  }
});

describe("P12 Project saved and wire readers", () => {
  const malformed = fc.jsonValue().filter((value) => typeof value !== "string");
  const typed = (exit: Exit.Exit<unknown, unknown>) => {
    expect(Exit.isFailure(exit)).toBe(true);
    const cause = Exit.isFailure(exit) ? exit.cause : Cause.die("unexpected success");
    expect(Cause.hasDies(cause)).toBe(false);
    expect(Cause.hasFails(cause)).toBe(true);
    expect(Cause.findErrorOption(cause)).toMatchObject({
      _tag: "Some",
      value: { _tag: "LedgerError", reason: "bad_row" },
    });
  };
  it("saved stage settings fail through the Project runtime's typed error channel", async () => {
    const encoded = Schema.fromJsonString(Settings);
    const invalid = fc
      .oneof(
        fc.string(),
        fc.jsonValue().map((value) => JSON.stringify(value)),
      )
      .filter((value) => !Schema.is(encoded)(value));
    await fc.assert(
      fc.asyncProperty(invalid, async (raw) => {
        let runtime: ReturnType<typeof projectRuntime> | undefined;

        try {
          const w = await world();
          typed(
            await Effect.runPromiseExit(
              Effect.suspend(() => {
                runtime = projectRuntime(w.ctx, { ...w.env, STAGE: raw });
                return runtime.contextEffect;
              }),
            ),
          );
        } finally {
          await runtime?.dispose();

          for (const close of closers.splice(0).reverse()) {
            await close();
          }
        }
      }),
      { seed: 119120, numRuns: 20, examples: [["{"], ["{}"], ["null"]] },
    );
  });

  for (const reader of ["bootstrap", "own descriptor", "pending descriptor", "own event"] as const) {
    it(`${reader} rejects malformed saved or wire values with LedgerError, never a defect`, async () => {
      const event = Schema.Struct({ _tag: Schema.String });
      const values = reader === "own event" ? fc.jsonValue().filter((value) => !Schema.is(event)(value)) : malformed;
      await fc.assert(
        fc.asyncProperty(values, async (raw) => {
          try {
            const w = await world(),
              pid = w.p.boot.process;

            if (reader === "bootstrap") {
              // An unrelated event at the stable bootstrap ID passes the generic ledger schema.
              // ProcessTable ignores its unknown tag; the bootstrap reader must check its body.
              w.db
                .prepare('UPDATE entries SET "_tag"=?, body=? WHERE stream=? AND id=?')
                .run("noted", JSON.stringify({ process: raw }), "processes/counter:1", "counter:1");
              typed(await w.reopenExit());
            } else if (reader === "own event") {
              typed(await w.run(Effect.exit(w.p.own(pid, "invalid-event", "events", raw))));
            } else {
              w.db
                .prepare("UPDATE stage_descriptors SET value=?, pending=? WHERE process=?")
                .run(JSON.stringify(raw), reader === "pending descriptor" ? 1 : 0, pid);
              const exit =
                reader === "pending descriptor"
                  ? await w.reopenExit()
                  : await w.run(Effect.exit(w.p.own(pid, "invalid-descriptor", "events", { _tag: "noted" })));
              typed(exit);
            }
          } finally {
            for (const close of closers.splice(0).reverse()) {
              await close();
            }
          }
        }),
        { seed: 119120, numRuns: 20, examples: [[null], [{}], [17]] },
      );
    });
  }
});

describe("P12 WebCrypto failures", () => {
  const failure = fc.oneof(
    fc.anything(),
    fc.string().map((message) => new Error(message)),
    fc.constant(new DOMException("digest refused", "OperationError")),
  );

  for (const edge of ["fingerprint", "archive checksum"] as const) {
    it(`${edge} refuses every thrown or rejected failure with reason crypto`, async () => {
      await fc.assert(
        fc.asyncProperty(failure, fc.boolean(), fc.uint8Array(), async (value, throws, body) => {
          const w = edge === "fingerprint" ? await world() : null;
          const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
            if (throws) {
              throw value;
            }

            return Promise.reject(value);
          });
          const put = vi.fn(async () => null);

          try {
            if (w !== null) {
              const result = await w.run(Effect.exit(w.p.online(w.key.fingerprint)));
              expect(result).toMatchObject({ _tag: "Failure" });
              expect(Option.getOrThrow(Exit.findErrorOption(result))).toMatchObject({
                _tag: "LedgerError",
                reason: "crypto",
              });
            } else {
              // oxlint-disable-next-line fabrika/no-type-assertions -- the digest must fail before any R2 method runs
              const bucket = { put } as unknown as R2Bucket;
              await expect(bucketCalls(bucket).put("health", body, "0".repeat(64))).rejects.toMatchObject({
                _tag: "LedgerError",
                reason: "crypto",
              });
              expect(put).not.toHaveBeenCalled();
            }

            expect(digest).toHaveBeenCalled();
          } finally {
            digest.mockRestore();

            for (const close of closers.splice(0).reverse()) {
              await close();
            }
          }
        }),
        { seed: 119120, numRuns: 20 },
      );
    });
  }
});

describe("P12 Gateway recording", () => {
  for (const operation of ["ring", "probe", "close", "notify"] as const) {
    law(`an authenticated ${operation} records through the project's sink`, async ({ letter, rev }) => {
      const w = await world(),
        db = new DatabaseSync(":memory:");
      let attached: typeof Attached.Type = Attached.cases.online.make({
        client: letter,
        who: { key: w.key.fingerprint, person: PERSON, as: "window" },
        version: 1,
        waits: [],
        watching: false,
        busy: false,
      });
      const ws = {
        deserializeAttachment: () => attached,
        serializeAttachment: (a: typeof Attached.Type) => {
          attached = a;
        },
        send: () => {
          if (operation === "notify") {
            throw new Error("delivery failed");
          }
        },
        close: () => {},
      };
      // oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture supplies the hibernating socket and SQL members consumed by Gateway
      const ctx = {
        id: { name: "gateway-test" },
        storage: storage(db),
        getWebSockets: () => [ws],
        getTags: () => ["session-test", "tab-a", w.key.fingerprint],
        getWebSocketAutoResponseTimestamp: () => new Date(42),
      } as unknown as DurableObjectState;
      // oxlint-disable-next-line fabrika/no-type-assertions -- this Node RPC double has no workerd namespace brand
      const project = {
        getByName: () => ({ leave: async () => {}, disconnect: async () => {} }),
      } as unknown as Env["PROJECT"];
      // oxlint-disable-next-line fabrika/no-type-assertions -- Node socket double implements attachment, send and close without workerd's socket brand
      const socket = ws as unknown as WebSocket;
      const config = await Effect.runPromise(settings(w.env));
      const runtime = gatewayRuntime(ctx, { ...w.env, PROJECT: project }, config);

      try {
        const gateway = await runtime.runPromise(GatewayService),
          before = w.recorded.length;
        const action: Effect.Effect<unknown, unknown> =
          operation === "ring"
            ? gateway.ring("events", rev)
            : operation === "probe"
              ? gateway.probe("session-test")
              : operation === "close"
                ? gateway.close(socket)
                : gateway.notify(letter, { method: "view.patch", params: {} });
        await runtime.runPromise(Effect.exit(action));
        const rows = w.recorded.slice(before);
        expect(rows.some((row) => row.name === `gateway.${operation}`)).toBe(true);

        if (operation === "notify") {
          expect(rows.some((row) => !row.ok)).toBe(true);
        }
      } finally {
        await runtime.dispose();
        db.close();
      }
    });
  }
});

// P14 (ticket 286), review 1, B: the Project's trusted `settings` call (`keySettings`) as the stage
// hands it a key-file read. A valid change is appended to `person/<person>/settings` once: an id
// already in the stream is no change, and so is a change equal to the last entry (the same rows, or
// the same problem, from the same source and reader). Bad input is refused and keeps nothing. The
// stream is read back through the door's own `ledger.read`, as a window reads it.
describe("P14 key settings append", () => {
  const rows = fc.constantFrom({ "counter.inc": ["+"] }, { "counter.inc": ["a"] }, { "counter.inc": [] }, {});
  const reader = fc.constantFrom("stage:p14", "stage:other");
  const good = fc.oneof(
    fc.record({ kind: fc.constant("rows"), rows, reader }),
    fc.record({
      kind: fc.constant("error"),
      error: fc.record({ line: fc.nat(9), reason: fc.constantFrom("syntax", "clash") }),
      reader,
    }),
  );
  const bad = fc.constantFrom<unknown>(
    null,
    "rows",
    { id: "", source: "file", reader: "r", sentAt: SENT, rows: {} },
    { id: "x", source: "socket", reader: "r", sentAt: SENT, rows: {} },
    { id: "x", source: "file", reader: "", sentAt: SENT, rows: {} },
    { id: "x", source: "file", reader: "r", sentAt: SENT, rows: { "counter.inc": "+" } },
    { id: "x", source: "file", reader: "r", sentAt: SENT },
    { id: "x", source: "file", reader: "r", sentAt: SENT, error: { line: "one", reason: "syntax" } },
  );
  /** A change with an id drawn from a few, so a repeat id is common. */
  const change = fc.oneof(
    { weight: 6, arbitrary: fc.tuple(fc.nat(5), good).map(([n, g]) => ({ bad: false as const, id: `keys-${n}`, g })) },
    { weight: 1, arbitrary: bad.map((raw) => ({ bad: true as const, raw })) },
  );
  type Change = typeof change extends fc.Arbitrary<infer A> ? A : never;
  type Fact = { readonly _tag: string; readonly [key: string]: unknown };

  const fact = (g: Extract<Change, { bad: false }>["g"]): Fact =>
    g.kind === "rows"
      ? { _tag: "keys", rows: g.rows, source: "file", reader: g.reader }
      : { _tag: "keys_failed", ...g.error, source: "file", reader: g.reader };
  const input = (c: Extract<Change, { bad: false }>) =>
    c.g.kind === "rows"
      ? { id: c.id, source: "file", reader: c.g.reader, sentAt: SENT, rows: c.g.rows }
      : { id: c.id, source: "file", reader: c.g.reader, sentAt: SENT, error: c.g.error };

  /** The model: the ids and facts the stream should hold after `list`. */
  const model = (list: ReadonlyArray<Change>) => {
    const kept: Array<{ id: string; fact: Fact }> = [];

    for (const c of list) {
      if (c.bad || kept.some((k) => k.id === c.id)) {
        continue;
      }

      const f = fact(c.g);

      if (JSON.stringify(kept.at(-1)?.fact) !== JSON.stringify(f)) {
        kept.push({ id: c.id, fact: f });
      }
    }

    return kept;
  };

  /** What the stream holds, read as a window reads it: each entry's id and its body's fields. */
  const held = async (w: Awaited<ReturnType<typeof world>>) => {
    const answer = (await w.run(
      w.p.route(w.client, "ledger.read", { stream: `person/${PERSON}/settings`, after: 0 }),
    )) as { readonly result?: { readonly entries?: ReadonlyArray<Record<string, unknown>> } };
    return (answer.result?.entries ?? []).map((e) => {
      const body = (e["body"] ?? {}) as Record<string, unknown>;
      const { _tag } = e as { _tag: string };
      return {
        id: String(e["id"]),
        fact: Object.fromEntries(Object.entries({ _tag, ...body }).filter(([k]) => k !== "sentAt")) as Fact,
      };
    });
  };

  /** The law on one list, as a check a plant can run on made-up observations. */
  const judge = (
    list: ReadonlyArray<Change>,
    seen: ReadonlyArray<{ id: string; fact: Fact }>,
    refused: ReadonlyArray<boolean>,
  ): string | null => {
    const want = model(list);

    if (JSON.stringify(seen.map((e) => e.id)) !== JSON.stringify(want.map((e) => e.id))) {
      return `the stream holds ${JSON.stringify(seen.map((e) => e.id))}, the model ${JSON.stringify(want.map((e) => e.id))}`;
    }

    for (const [n, e] of seen.entries()) {
      const f = want[n]!.fact;

      for (const [k, v] of Object.entries(f)) {
        if (JSON.stringify(e.fact[k]) !== JSON.stringify(v)) {
          return `entry ${e.id} holds ${k} ${JSON.stringify(e.fact[k])}, the change said ${JSON.stringify(v)}`;
        }
      }
    }

    for (const [n, c] of list.entries()) {
      if (c.bad !== refused[n]) {
        return `change ${n} ${c.bad ? "was bad and accepted" : "was good and refused"}`;
      }
    }

    return null;
  };

  it("a valid change is appended once; a repeated id or the same change as the last is no change; bad input is refused and keeps nothing", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(change, { minLength: 1, maxLength: 12 }), async (list) => {
        const w = await world();
        const refused: Array<boolean> = [];

        try {
          for (const c of list) {
            const exit = await w.run(Effect.exit(w.p.settings(c.bad ? c.raw : input(c))));
            refused.push(Exit.isFailure(exit));
          }

          expect(judge(list, await held(w), refused)).toBeNull();
        } finally {
          for (const close of closers.splice(0).reverse()) {
            await close();
          }
        }
      }),
      { seed: 119120, numRuns: 30, endOnFailure: true },
    );
  });

  it("plants: appending a repeated id, appending the same change as the last, or keeping bad input are each caught", () => {
    fc.assert(
      fc.property(fc.array(change, { minLength: 1, maxLength: 12 }), (list) => {
        const right = model(list);
        const refused = list.map((c) => c.bad);
        expect(judge(list, right, refused)).toBeNull();
        const good = list.filter((c): c is Extract<Change, { bad: false }> => !c.bad);
        const everyGood = good.map((c) => ({ id: c.id, fact: fact(c.g) }));
        const byId = good
          .filter((c, n) => good.findIndex((x) => x.id === c.id) === n)
          .map((c) => ({ id: c.id, fact: fact(c.g) }));

        if (JSON.stringify(everyGood) !== JSON.stringify(right)) {
          expect(judge(list, everyGood, refused), "appending every valid change").not.toBeNull();
        }

        if (JSON.stringify(byId) !== JSON.stringify(right)) {
          expect(judge(list, byId, refused), "no same-as-last check").not.toBeNull();
        }

        if (list.some((c) => c.bad)) {
          expect(
            judge(
              list,
              right,
              list.map(() => false),
            ),
            "accepting bad input",
          ).not.toBeNull();
        }
      }),
      { seed: 119120, numRuns: 200 },
    );
  });
});
