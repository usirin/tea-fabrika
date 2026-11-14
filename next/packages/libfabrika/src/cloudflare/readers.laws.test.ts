// P12, next/. Saved and wire values enter the real services over in-memory platform handles.
import { createHash, generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  DurableObjectState as ObjectState,
  fromDurableObjectState,
} from "@alchemy.run/cloudflare/Workers/DurableObjectState";
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { Cause, Context, Effect, Exit, Layer, Option, Redacted, Schema, Scope, Tracer } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { Writer } from "../coordination/index.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Start } from "../processes/Process.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import type { Sql } from "../Sql.ts";
import { Chain } from "../telemetry/Trace.ts";
import { Attached } from "../transport/Wire.ts";
import type { GatewayCalls } from "./bindings.ts";
import { ConnectionService, connectionRuntime } from "./connection.ts";
import { control } from "./control.ts";
import { fetch } from "./fetch.ts";
import type { RecordShape } from "./objects.ts";
import { recordRead, recordWrite } from "./record.ts";
import {
  ProcessService,
  ProjectService,
  processDescriptor,
  processRuntime,
  projectRuntime,
  settingsReply,
  type Env,
} from "./runtime.ts";
import * as SettingsTest from "./SettingsTest.ts";

class EntryFailure extends Schema.TaggedError<EntryFailure>()("EntryFailure", {
  cause: Schema.Defect(),
}) {}

const recordConstructor = vi.hoisted(() => {
  const slot: {
    value?: Effect.Effect<
      Effect.Effect<RecordShape, unknown, Scope.Scope>,
      unknown,
      ObjectState | WorkerEnvironment | Scope.Scope
    >;
  } = {};
  return slot;
});

// The Project keeps each built-in program by its hash, the SHA-256 of its source (`BuiltProgram`).
const FIXTURE = { hash: createHash("sha256").update("fixture").digest("hex"), source: "fixture" };

// SQL drivers throw at the synchronous platform boundary, before the service translates them.
const settingsExec =
  (base: Sql, failed: () => boolean, cause: Error, counted: (kind: "read" | "append") => void): Sql["exec"] =>
  (query, ...args) => {
    const settings = args.some((arg) => typeof arg === "string" && arg.startsWith("settings/instance/"));

    if (settings && /SELECT \* FROM entries WHERE stream = \? AND rev > \?/i.test(query)) {
      counted("read");

      if (failed()) {
        throw cause;
      }
    }

    if (settings && /INSERT INTO entries/i.test(query)) {
      counted("append");
    }

    return base.exec(query, ...args);
  };

// Capture only Alchemy's constructor registration. The actual RecordPart implementation runs below.
vi.mock("./objects.ts", async (original) => {
  const actual = await original<typeof import("./objects.ts")>();
  const { Layer } = await import("effect");
  return {
    ...actual,
    RecordPart: {
      make: (implementation: NonNullable<typeof recordConstructor.value>) => {
        recordConstructor.value = implementation;
        return Layer.empty;
      },
    },
  };
});

vi.mock("effect", async (original) => {
  const actual = await original<typeof import("effect")>();
  return { ...actual, Effect: { ...actual.Effect } };
});

const config = instanceFixture({
  name: "parse-test",
  person: "person-test",
  founder: "public-test",
  window: null,
  port: 18787,
  build: "test",
});

const malformed = (schema: Schema.Top) => fc.jsonValue().filter((value) => !Schema.is(schema)(value));

const entryPaths = ["Project", "Process", "Connection", "HTTP", "RecordPart"] as const;

for (const corruption of ["snapshot", ...StartsTest.originKinds] as const) {
  for (const path of entryPaths) {
    StartsTest.law(
      `T753 L3 ${path} rejects corrupt ${corruption} before consumer construction`,
      fc.tuple(
        StartsTest.recipe,
        fc.array(fc.nat(), { minLength: 8, maxLength: 25 }),
        corruption === "snapshot" ? fc.constant(undefined) : StartsTest.originFault(corruption),
      ),
      ([recipe, choices, origin]) =>
        Effect.gen(function* () {
          let deployment = yield* StartsTest.input(recipe);

          for (const [index, choice] of choices.entries()) {
            // A reopen keeps immutable input; a deployment chooses a fresh start and snapshot.
            const moves = ["deliver", "reopen", "deploy"];
            const move = moves[choice % moves.length];

            if (move === "deploy") {
              deployment = yield* StartsTest.input({
                ...recipe,
                start: `${recipe.start}-${index}`,
                port: 1 + (choice % 65535),
              });
              continue;
            }

            const w = yield* Effect.acquireRelease(Effect.sync(world), (value) => Effect.sync(() => value.db.close()));
            let consumers = 0;
            let settingsCalls = 0;
            const bad =
              origin === undefined
                ? StartsTest.corrupt(deployment, Math.floor(choice / moves.length))
                : StartsTest.changeOrigin(deployment, origin);
            const sql = w.ctx.storage.sql;
            const ctx = {
              ...w.ctx,
              id: {
                ...w.ctx.id,
                name:
                  path === "Process"
                    ? JSON.stringify(["settings-law", "worker"])
                    : path === "RecordPart"
                      ? JSON.stringify(["settings-law", "spans/0"])
                      : "settings-law",
              },
              getWebSockets: () => {
                consumers++;
                return [];
              },
              storage: new Proxy(w.ctx.storage, {
                get: (target, key) => {
                  if (key === "get") {
                    return (...args: unknown[]) => {
                      consumers++;
                      return Reflect.apply(target.get, target, args);
                    };
                  }

                  if (key === "sql") {
                    return new Proxy(sql, {
                      get: (target, key) =>
                        key === "exec"
                          ? (...args: unknown[]) => {
                              consumers++;
                              return Reflect.apply(target.exec, target, args);
                            }
                          : Reflect.get(target, key),
                    });
                  }

                  return Reflect.get(target, key);
                },
              }),
            };
            const env = {
              ...w.env,
              INSTANCE: JSON.stringify(bad),
              PROJECT: new Proxy(w.env.PROJECT, {
                get: (target, key) =>
                  key === "getByName"
                    ? () =>
                        new Proxy(target.getByName("settings-law"), {
                          get: (stub, method) =>
                            method === "settingsStart"
                              ? async (wire: StartsTest.Input) => {
                                  settingsCalls++;
                                  return StartsTest.reply(wire);
                                }
                              : Reflect.get(stub, method),
                        })
                    : Reflect.get(target, key),
              }),
            };
            const publicKey = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x;
            const local = {
              ...config,
              name: "settings-law",
              port: recipe.port,
              person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
              founder: publicKey ?? "missing-public-key",
              window: config.founding.window,
            };
            let exit: Exit.Exit<unknown, unknown>;

            if (path === "HTTP") {
              exit = yield* Effect.exit(
                fetch(
                  new Request(`http://127.0.0.1:${recipe.port}/window.js`, {
                    headers: { host: `127.0.0.1:${recipe.port}` },
                  }),
                  env,
                  local,
                  { "/window.js": { hash: "asset", type: "text/javascript", body: "window.fixture = true" } },
                ),
              );
            } else if (path === "RecordPart") {
              const constructor = Option.getOrThrow(Option.fromUndefinedOr(recordConstructor.value));
              exit = yield* Effect.exit(
                Effect.gen(function* () {
                  const build = yield* constructor;
                  const part = yield* build;
                  return yield* part.read(Chain.cases.spans.make({}), 0, 0);
                }).pipe(
                  Effect.provideService(WorkerEnvironment, env),
                  Effect.provideService(
                    ObjectState,
                    // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Alchemy and the global Worker types disagree on raw Request brands; this double supplies the same storage handles
                    fromDurableObjectState(ctx as unknown as Parameters<typeof fromDurableObjectState>[0]),
                  ),
                ),
              );
            } else if (path === "Connection") {
              const runtime = connectionRuntime(ctx, env, local);
              yield* Effect.addFinalizer(() => runtime.disposeEffect);
              exit = yield* Effect.promise(() => runtime.runPromiseExit(ConnectionService));
            } else if (path === "Process") {
              const runtime = processRuntime(ctx, env, {});
              yield* Effect.addFinalizer(() => runtime.disposeEffect);
              exit = yield* Effect.promise(() => runtime.runPromiseExit(ProcessService));
            } else {
              const runtime = projectRuntime(ctx, env, {
                config: local,
                programs: {},
                bootstrap: [{ id: "boot", name: "boot", program: "missing" }],
                door: () => Effect.die("consumer before start"),
              });
              yield* Effect.addFinalizer(() => runtime.disposeEffect);
              exit = yield* Effect.promise(() => runtime.runPromiseExit(ProjectService));
            }

            expect(Exit.isFailure(exit)).toBe(true);

            if (Exit.isFailure(exit)) {
              expect(Cause.hasDies(exit.cause)).toBe(false);
              expect(Cause.hasFails(exit.cause)).toBe(true);
              expect(Cause.findErrorOption(exit.cause)).toMatchObject({
                _tag: "Some",
                value: { _tag: "StartsError", reason: { _tag: "Decode" } },
              });
            }

            expect(consumers).toBe(0);
            // A remote receipt check must not hide a skipped local snapshot check.
            expect(settingsCalls).toBe(0);
          }
        }).pipe(Effect.provide(Digest.layerWebCrypto)),
    );
  }
}

// Keep parser checks independent of the bearer migration. The separate [secrets] type and
// flow laws require Redacted; this fixture also reaches HEAD's parser using its old signature.
const parserControl = (request: Request, env: Env) =>
  Effect.gen(function* () {
    const secure: Effect.Effect<Response, unknown> = Reflect.apply(control, undefined, [
      request.clone(),
      env,
      Redacted.make("test"),
      {},
    ]);
    const response = yield* secure;

    if (response.status !== 403) {
      return response;
    }

    const legacy: Effect.Effect<Response, unknown> = Reflect.apply(control, undefined, [request, env, "test", {}]);
    return yield* legacy;
  });

const typed = (exit: Exit.Exit<unknown, unknown>, tag = "LedgerError") => {
  expect(Exit.isFailure(exit)).toBe(true);
  const cause = Exit.isFailure(exit) ? exit.cause : Cause.die("unexpected success");
  expect(Cause.hasDies(cause)).toBe(false);
  expect(Cause.hasFails(cause)).toBe(true);
  expect(Cause.findErrorOption(cause)).toMatchObject({
    _tag: "Some",
    value: { _tag: tag, reason: "bad_row" },
  });
};

const world = () => {
  const db = new DatabaseSync(":memory:"),
    sql = nodeSql(db);
  let attached: unknown = Attached.cases.online.make({
    client: "client",
    identity: { key: "public", person: "person", as: "agent" },
    version: 1,
    waits: [],
    watching: false,
    busy: false,
  });
  let tags: unknown = ["session", "tab", "key"],
    name: unknown = "gateway";
  const ws = {
    deserializeAttachment: () => attached,
    serializeAttachment: (value: unknown) => {
      attached = value;
    },
    send: vi.fn(),
    close: vi.fn(),
  };
  // oxlint-disable-next-line fabrika/no-type-assertions -- the socket double supplies attachment, send and close; workerd owns the complete WebSocket
  const socket = ws as unknown as WebSocket;
  // oxlint-disable-next-line fabrika/no-type-assertions -- only workerd constructs a complete DurableObjectState; these are the handles the real readers use
  const ctx = {
    id: {
      get name() {
        return name;
      },
    },
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
    getTags: () => tags,
    getWebSocketAutoResponseTimestamp: () => null,
    acceptWebSocket: vi.fn(),
    setWebSocketAutoResponse: vi.fn(),
  } as unknown as DurableObjectState;
  const route = vi.fn(async (): Promise<unknown> => ({ _tag: "parked", stream: "stream", after: 0 }));
  // oxlint-disable-next-line fabrika/no-type-assertions -- in-memory platform stubs supply just the RPCs these readers reach
  const env = {
    INSTANCE: JSON.stringify(config),
    PROJECT: {
      getByName: () => ({
        settingsStart: async () => StartsTest.reply(config),
        route,
        leave: async () => {},
        disconnect: async () => {},
        clientConnect: async () => "client",
        challenge: async () => "nonce",
      }),
    },
    RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
    MEASUREMENTS: {},
  } as unknown as Env;
  return {
    ctx,
    env,
    ws,
    socket,
    db,
    route,
    attached: (value: unknown) => {
      attached = value;
    },
    tags: (value: unknown) => {
      tags = value;
    },
    name: (value: unknown) => {
      name = value;
    },
  };
};

for (const source of ["attachment", "tags", "name"] as const) {
  it(`Connection startup returns a typed error for malformed saved ${source}`, async () => {
    const schema = {
      attachment: Attached,
      tags: Schema.Tuple([Schema.String, Schema.String, Schema.String]),
      name: Schema.String,
    }[source];
    await fc.assert(
      fc.asyncProperty(malformed(schema), async (raw) => {
        const w = world();
        ({ attachment: w.attached, tags: w.tags, name: w.name })[source](raw);
        const runtime = connectionRuntime(w.ctx, w.env, config);

        try {
          typed(await runtime.runPromiseExit(ConnectionService));
        } finally {
          await runtime.dispose();
          w.db.close();
        }
      }),
      { seed: 119120, numRuns: 20, examples: [[null], [{}], [17]] },
    );
  });
}

for (const method of ["message", "close", "ring", "probe", "notify"] as const) {
  it(`Connection ${method} returns a typed error for a damaged attachment after startup`, async () => {
    await fc.assert(
      fc.asyncProperty(malformed(Attached), async (raw) => {
        const w = world(),
          runtime = connectionRuntime(w.ctx, w.env, config);

        try {
          const gateway = await runtime.runPromise(ConnectionService);
          w.attached(raw);
          const work = () =>
            ({
              message: () => gateway.message(w.socket, '{"jsonrpc":"2.0","id":1,"method":"view.open","params":{}}'),
              close: () => gateway.close(w.socket),
              ring: () => gateway.ring("stream", 1),
              probe: () => gateway.probe("session"),
              notify: () => gateway.notify("client", {}),
            })[method]();
          typed(await runtime.runPromiseExit(Effect.suspend(work)));
        } finally {
          await runtime.dispose();
          w.db.close();
        }
      }),
      { seed: 119120, numRuns: 20, examples: [[null], [{}]] },
    );
  });
}

it("Connection ready RPC decoding fails in the typed channel before the wait refusal is sent", async () => {
  await fc.assert(
    fc.asyncProperty(malformed(Schema.Struct({ rev: Schema.Int })), async (raw) => {
      const w = world(),
        runtime = connectionRuntime(w.ctx, w.env, config);
      const original = Effect.result;
      const attempts: Array<Exit.Exit<unknown, unknown>> = [];
      const inspect = vi.spyOn(Effect, "result").mockImplementation((work) =>
        original(
          work.pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                attempts.push(exit);
              }),
            ),
          ),
        ),
      );

      try {
        const gateway = await runtime.runPromise(ConnectionService);
        w.route.mockResolvedValue({ _tag: "ok", result: raw });
        await runtime.runPromise(
          gateway
            .message(
              w.socket,
              JSON.stringify({
                jsonrpc: "2.0",
                id: "wait",
                method: "ledger.wait",
                params: { stream: "stream", after: 0 },
              }),
            )
            .pipe(Effect.exit),
        );
        expect(attempts).toHaveLength(1);
        typed(attempts[0]!);
        expect(w.ws.send.mock.calls.map(([text]) => JSON.parse(text))).toContainEqual(
          expect.objectContaining({
            id: "wait",
            error: expect.objectContaining({ data: { reason: "bad_row" } }),
          }),
        );
      } finally {
        inspect.mockRestore();
        await runtime.dispose();
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: 20, examples: [[null], [{}], [{ rev: "1" }], [{ rev: 1.5 }]] },
  );
});

it("control bucket bytes fail as a typed parse error before its HTTP error response", async () => {
  await fc.assert(
    fc.asyncProperty(malformed(Schema.Array(Schema.Number)), async (raw) => {
      const w = world(),
        attempts: Array<Exit.Exit<unknown, unknown>> = [];
      const original = Effect.result;
      const inspect = vi.spyOn(Effect, "result").mockImplementation((work) =>
        original(
          work.pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                attempts.push(exit);
              }),
            ),
          ),
        ),
      );

      try {
        const request = new Request("http://local/", {
          method: "POST",
          headers: { authorization: "Bearer test", "content-type": "application/json" },
          body: JSON.stringify({
            target: "bucket",
            project: "parse-test",
            name: "",
            method: "put",
            args: ["key", raw, "checksum"],
          }),
        });
        const exit = await Effect.runPromiseExit(parserControl(request, w.env));
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(attempts).toHaveLength(1);
        typed(attempts[0]!);
        const response = Exit.isSuccess(exit) ? exit.value : new Response(null);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: { reason: "bad_row" } });
      } finally {
        inspect.mockRestore();
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: 20, examples: [[null], [{}], [["byte"]]] },
  );
});

for (const field of ["put key", "put checksum", "head key"] as const) {
  it(`control checks outside ${field} as text instead of coercing it or throwing`, async () => {
    const input: fc.Arbitrary<unknown> = fc.oneof(malformed(Schema.String), fc.record({ toString: fc.jsonValue() }));
    await fc.assert(
      fc.asyncProperty(input, async (raw) => {
        const w = world(),
          attempts: Array<Exit.Exit<unknown, unknown>> = [];
        const original = Effect.result;
        const inspect = vi.spyOn(Effect, "result").mockImplementation((work) =>
          original(
            work.pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  attempts.push(exit);
                }),
              ),
            ),
          ),
        );

        try {
          const args: Array<unknown> =
            field === "head key" ? [raw] : ["key", [], createHash("sha256").update("").digest("hex")];

          if (field === "put key") {
            args[0] = raw;
          }

          if (field === "put checksum") {
            args[2] = raw;
          }

          const request = new Request("http://local/", {
            method: "POST",
            headers: { authorization: "Bearer test" },
            body: JSON.stringify({
              target: "bucket",
              project: "parse-test",
              name: "",
              method: field === "head key" ? "head" : "put",
              args,
            }),
          });
          const exit = await Effect.runPromiseExit(parserControl(request, w.env));
          expect(attempts).toHaveLength(1);
          typed(attempts[0]!);
          expect(exit).toMatchObject({ _tag: "Success" });
          const response = Exit.isSuccess(exit) ? exit.value : new Response(null);
          expect(response.status).toBe(500);
          expect(await response.json()).toEqual({ error: { reason: "bad_row" } });
        } finally {
          inspect.mockRestore();
          w.db.close();
        }
      }),
      { seed: 119120, numRuns: 20, examples: [[{ toString: 0 }], [null], [17]] },
    );
  });
}

const objectName = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]));

for (const service of ["process", "record"] as const) {
  it(`${service} object names return typed parse failures for malformed saved names`, async () => {
    await fc.assert(
      fc.asyncProperty(malformed(objectName), async (raw) => {
        const w = world();
        w.name(raw);
        const runtime = processRuntime(w.ctx, w.env, {});

        try {
          const exit =
            service === "process"
              ? await runtime.runPromiseExit(ProcessService)
              : await Effect.runPromiseExit(recordRead(w.ctx, undefined, { _tag: "spans" }, 0, 0));
          typed(exit, service === "record" ? "SinkError" : "LedgerError");
        } finally {
          await runtime.dispose();
          w.db.close();
        }
      }),
      { seed: 119120, numRuns: 20, examples: [[null], ["{"], ['["project"]'], ['["project",17]']] },
    );
  });
}

it("processDescriptor checks the saved value before returning it to a caller", async () => {
  const descriptor = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    program: Schema.String,
    build: Schema.String,
    owner: Writer,
  });
  await fc.assert(
    fc.asyncProperty(malformed(descriptor), async (raw) => {
      const w = world();
      const get = vi.fn(async () => raw);
      Object.assign(w.ctx.storage, { get });

      try {
        typed(await Effect.runPromiseExit(processDescriptor(w.ctx)));
      } finally {
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: 20, examples: [[null], [{}], [17]] },
  );
});

it("Connection close checks saved tags again after startup", async () => {
  await fc.assert(
    fc.asyncProperty(malformed(Schema.String), async (raw) => {
      const w = world(),
        runtime = connectionRuntime(w.ctx, w.env, config);

      try {
        const gateway = await runtime.runPromise(ConnectionService);
        w.tags([raw, "tab", "key"]);
        typed(await runtime.runPromiseExit(gateway.close(w.socket)));
      } finally {
        await runtime.dispose();
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: 20, examples: [[null], [{}], [17]] },
  );
});

it("Connection rejects missing or malformed URL segments with a typed error", async () => {
  const invalid = fc.oneof(
    fc.constantFrom("/ws", "/ws/key", "/ws/%/tab", "/ws/key/%"),
    fc.string().map((text) => `/ws/${encodeURIComponent(text)}%/tab`),
  );
  await fc.assert(
    fc.asyncProperty(invalid, async (path) => {
      const w = world(),
        runtime = connectionRuntime(w.ctx, w.env, config);
      vi.stubGlobal(
        "WebSocketPair",
        class {
          0 = {};
          1 = {};
        },
      );

      try {
        const gateway = await runtime.runPromise(ConnectionService);
        typed(
          await runtime.runPromiseExit(
            gateway.fetch(new Request(`http://local${path}`, { headers: { upgrade: "websocket" } })),
          ),
        );
      } finally {
        vi.unstubAllGlobals();
        await runtime.dispose();
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: 20, examples: [["/ws"], ["/ws/%/tab"], ["/ws/key/%"]] },
  );
});

function instanceFixture(config: StartsTest.Fixture) {
  return StartsTest.fixture(config, (algorithm, data) =>
    createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
  );
}

StartsTest.law(
  "T753 L19 the legacy cap, fallback, resend and rollover behavior remain intact",
  fc.record({
    cap: fc.option(fc.integer({ min: 1, max: 1_000_000_000 }), { nil: undefined }),
    id: fc.integer({ min: 1, max: 1_000_000 }),
  }),
  ({ cap, id }) =>
    Effect.gen(function* () {
      const w = yield* Effect.acquireRelease(Effect.sync(world), (value) => Effect.sync(() => value.db.close()));
      let size = 0;
      const raw = w.ctx.storage.sql;
      const ctx = {
        ...w.ctx,
        id: { ...w.ctx.id, name: JSON.stringify(["settings-law", "spans/0"]) },
        storage: {
          ...w.ctx.storage,
          sql: new Proxy(raw, { get: (target, key) => (key === "databaseSize" ? size : Reflect.get(target, key)) }),
        },
      };
      const chain = Chain.cases.spans.make({});
      const row = (n: number) => ({
        span: {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: n.toString(16).padStart(16, "0"),
          parentSpanId: null,
          name: "settings-cap-fixture",
          kind: "internal" as const,
          startTimeUnixNano: "1794096000000000000",
          endTimeUnixNano: "1794096000001000000",
          attributes: {},
          events: [],
          links: [],
          resource: { attributes: { "fab.object": "settings-cap-fixture" } },
          ok: true,
        },
        content: null,
      });
      const old = row(id);
      const next = row(id + 1);
      const fresh = row(id + 2);
      expect(yield* recordWrite(ctx, cap, chain, 0, [old])).toEqual({ _tag: "written" });
      size = (cap ?? 1_000_000_000) - 1;
      expect(yield* recordWrite(ctx, cap, chain, 0, [next])).toEqual({ _tag: "written" });
      size++;
      expect(yield* recordWrite(ctx, cap, chain, 0, [old])).toEqual({ _tag: "written" });
      expect(yield* recordWrite(ctx, cap, chain, 0, [old, fresh])).toEqual({
        _tag: "rolled",
        next: "spans/1",
        had: [old.span.spanId],
      });
    }),
);

// The suite owns the moves and assertions; this caller owns SQLite and the platform handles.
SettingsTest.suite((recipe, secret) =>
  Effect.gen(function* () {
    const Starts = yield* Effect.promise(() => import("../settings/Starts.ts"));
    const SettingsStartsLedger = yield* Effect.promise(() => import("./SettingsStartsLedger.ts"));
    // Each Process object's descriptor, kept across a reopen as the object's own storage keeps it.
    const configured = new Map<string, unknown>();
    const captured: Record<SettingsTest.Channel, unknown[]> = {
      transport: [],
      ledger: [],
      descriptors: [],
      "record RPC": [],
      spans: [],
      content: [],
      archives: [],
      "HTTP replies": [],
      "RPC failures": [],
      stdout: [],
      stderr: [],
      logs: [],
      "span attributes": [],
    };
    let fault: SettingsTest.Fault = "none";
    let calls = 0;
    let reads = 0;
    let appends = 0;
    let consumers = 0;
    const databases: DatabaseSync[] = [];
    const key = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!;
    let input = {
      ...(yield* StartsTest.input(recipe)),
      founding: { person: "person_01m6v5270hf3c8x2q7w9z4k5mn", founder: key, window: null },
    };
    captured.transport.push(JSON.stringify(input));
    const lower = new Error(secret, { cause: { password: secret } });
    const database = Effect.acquireRelease(
      Effect.sync(() => {
        const db = new DatabaseSync(":memory:");
        databases.push(db);
        return db;
      }),
      (db) => Effect.sync(() => db.close()),
    );
    const local = yield* database;
    const rawSql = nodeSql(local);
    const settingsSql = {
      ...rawSql,
      exec: settingsExec(
        rawSql,
        () => fault === "storage",
        lower,
        (kind) => {
          if (kind === "read") {
            reads++;
          } else {
            appends++;
          }
        },
      ),
    };
    const startsContext = yield* Layer.build(SettingsStartsLedger.layer(settingsSql));
    const starts = Context.get(startsContext, Starts.Starts);
    const gate = Effect.fnUntraced(function* (wire: unknown) {
      calls++;
      captured.transport.push(wire);

      if (fault === "unreachable") {
        return yield* Effect.fail(lower);
      }

      if (fault === "malformed") {
        return { placed: true };
      }

      const work =
        fault === "refused"
          ? Effect.fail(new Starts.StartsError({ reason: new Starts.Refused({ cause: lower }) }))
          : starts.record(wire as StartsTest.Input);
      const reply = yield* settingsReply(work);
      captured[reply._tag === "ok" ? "transport" : "RPC failures"].push(reply);

      if (fault === "lost") {
        return yield* Effect.fail(lower);
      }

      return reply;
    });
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const attribute = Tracer.NativeSpan.prototype.attribute;
        const spies = [
          vi.spyOn(Tracer.NativeSpan.prototype, "attribute").mockImplementation(function (
            this: Tracer.NativeSpan,
            key,
            value,
          ) {
            captured["span attributes"].push({ key, value });
            return Reflect.apply(attribute, this, [key, value]);
          }),
          vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
            captured.stdout.push(String(chunk));
            return true;
          }),
          vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
            captured.stderr.push(String(chunk));
            return true;
          }),
          ...(["log", "info", "warn", "error", "debug"] as const).map((method) =>
            vi.spyOn(console, method).mockImplementation((...args) => {
              captured.logs.push(args);
            }),
          ),
        ];
        return spies;
      }),
      (spies) =>
        Effect.sync(() => {
          for (const spy of spies) {
            spy.mockRestore();
          }
        }),
    );
    const open: SettingsTest.Driver["open"] = Effect.fnUntraced(function* (path, corrupt) {
      const config = { ...input, ...input.founding, port: Number(input.settings.values["instance.port"]) };
      const db = path === "Project" ? local : yield* database;
      const sql = path === "Project" ? settingsSql : nodeSql(db);
      const values = new Map<string, unknown>();
      values.set("descriptor", {
        id: "process-fixture",
        name: "worker",
        program: "fixture",
        build: input.build,
        owner: Writer.cases.person.make({ key: "fixture-writer", for: input.founding.person }),
      });
      const encoded = JSON.stringify(corrupt === undefined ? input : StartsTest.corrupt(input, corrupt, secret));
      let attached = Attached.cases.online.make({
        client: "fixture-client",
        identity: { key: "fixture-public", person: input.founding.person, as: "window" },
        version: 1,
        waits: [],
        watching: false,
        busy: false,
      });
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Node supplies hibernating socket methods without workerd's nominal brand
      const socket = {
        deserializeAttachment: () => attached,
        serializeAttachment: (next: typeof attached) => {
          attached = next;
        },
        send: (frame: string) => {
          captured.transport.push(frame);
        },
        close: () => {},
      } as unknown as WebSocket;
      // Only platform handles are doubled. The five consumer implementations run unchanged.
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Node supplies only the storage and socket members these entries call
      const ctx = {
        id: {
          name:
            path === "Process"
              ? JSON.stringify([input.name, "worker"])
              : path === "RecordPart"
                ? JSON.stringify([input.name, "spans/0"])
                : input.name,
        },
        storage: {
          sql: {
            exec: (query: string, ...args: Parameters<typeof sql.exec> extends [string, ...infer A] ? A : never) => {
              if (/CREATE TABLE IF NOT EXISTS (unsent|spans|content|process_state)/i.test(query)) {
                consumers++;
              }

              return sql.exec(query, ...args);
            },
            get databaseSize() {
              return sql.size();
            },
          },
          transactionSync: sql.transaction,
          get: async (name: string) => {
            consumers++;
            return values.get(name);
          },
          put: async (name: string, value: unknown) => {
            captured.descriptors.push({ name, value });
            values.set(name, value);
          },
          delete: async (name: string) => values.delete(name),
          getAlarm: async () => null,
          setAlarm: async () => {},
          deleteAlarm: async () => {},
        },
        getWebSockets: () => {
          consumers++;
          return path === "Connection" ? [socket] : [];
        },
        getTags: () => ["fixture-session", "fixture-tab", "fixture-public"],
        getWebSocketAutoResponseTimestamp: () => null,
        setWebSocketAutoResponse: () => {},
        // T852: a reopened Project binds each process load to its tail.
        exports: { IsolateTail: () => ({ fetch: async () => new Response() }) },
      } as unknown as DurableObjectState;
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Alchemy owns the complete binding brands; these doubles implement the observed calls
      const env = {
        INSTANCE: encoded,
        UNRELATED_PASSWORD: secret,
        PROJECT: {
          getByName: () => ({
            settingsStart: (wire: unknown) => Effect.runPromise(gate(wire)),
            route: async () => ({ _tag: "ok", result: {} }),
          }),
        },
        PROCESS: {
          getByName: (object: string) => ({
            configure: async (descriptor: unknown) => {
              captured.descriptors.push(descriptor);
              configured.set(object, descriptor);
            },
            // P15: a reopened Project asks each live process which build its object runs.
            descriptor: async () => configured.get(object),
            swap: async () => ({ _tag: "same" }),
          }),
        },
        CONNECTION: { getByName: () => ({ ring: async () => {}, notify: async () => {}, probe: async () => 0 }) },
        RECORD: {
          getByName: () => ({
            write: async (...args: unknown[]) => {
              captured["record RPC"].push(args);
              captured["span attributes"].push(args);
              return { _tag: "written" };
            },
          }),
        },
        MEASUREMENTS: {
          put: async (...args: unknown[]) => {
            captured.archives.push(args);
            return {};
          },
          head: async () => null,
        },
        LOADER: {
          get: () => {
            consumers++;
            return {
              getEntrypoint: () => ({
                describe: async () => ({ name: "test/fixture", v: 1, writes: {}, inputs: {}, cmds: [] }),
              }),
            };
          },
        },
      } as unknown as Env;
      let close = Effect.void;
      let enter: SettingsTest.Entry["enter"];

      if (path === "HTTP") {
        enter = Effect.fnUntraced(function* (choice) {
          const route = ["/window.js", "/", "/missing", "/window.js"][choice % 4] ?? "/";
          const response = yield* fetch(
            new Request(`http://127.0.0.1:${config.port}${route}`, {
              headers: { host: choice % 4 === 3 ? "wrong.invalid" : `127.0.0.1:${config.port}` },
            }),
            env,
            config,
            { "/window.js": { body: "fixture", hash: "fixture", type: "text/javascript" } },
          );
          captured["HTTP replies"].push({
            status: response.status,
            headers: [...response.headers],
            body: yield* Effect.promise(() => response.text()),
          });
          return response.status;
        });
      } else if (path === "RecordPart") {
        const scope = yield* Effect.acquireRelease(Scope.make(), (owned) => Scope.close(owned, Exit.void));
        close = Scope.close(scope, Exit.void);
        const constructor = Option.getOrThrow(Option.fromUndefinedOr(recordConstructor.value));
        // Construct only the stable holder here. The operation must perform the fallible gate.
        const build = yield* constructor.pipe(
          Effect.provideService(WorkerEnvironment, env),
          Effect.provideService(
            ObjectState,
            // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Alchemy and the global Worker types disagree on raw Request brands; this double supplies the same storage handles
            fromDurableObjectState(ctx as unknown as Parameters<typeof fromDurableObjectState>[0]),
          ),
          Effect.provideService(Scope.Scope, scope),
        );
        enter = Effect.fnUntraced(function* (choice) {
          const part = yield* build.pipe(Effect.provideService(Scope.Scope, scope));
          const chain = Chain.cases.spans.make({});
          const method = choice % 4;
          return yield* method === 0
            ? part.write(chain, 0, [])
            : method === 1
              ? part.read(chain, 0, 0)
              : method === 2
                ? part.content(chain, 0, "absent")
                : part.deleteContent(chain, 0, "absent", { by: "fixture-writer", at: 0, reason: "requested" });
        });
      } else {
        const runtime =
          path === "Connection"
            ? connectionRuntime(ctx, env, config)
            : path === "Process"
              ? processRuntime(ctx, env, {})
              : projectRuntime(ctx, env, {
                  config,
                  programs: { "test/fixture": FIXTURE },
                  bootstrap: [{ id: "bootstrap-fixture", name: "bootstrap", program: "test/fixture" }],
                  door: () => Effect.succeed({} as GatewayCalls),
                });
        close = Effect.promise(() => runtime.dispose());
        yield* Effect.addFinalizer(() => close);
        enter = (choice: number) =>
          Effect.tryPromise({
            try: () => {
              const work =
                path === "Connection"
                  ? ConnectionService.use((service) =>
                      choice % 2 === 0
                        ? service.message(socket, JSON.stringify({ jsonrpc: "2.0", method: "ping", id: choice }))
                        : service.probe("fixture-session"),
                    )
                  : path === "Process"
                    ? ProcessService.use((service) => service.alarm())
                    : ProjectService.use((service) =>
                        choice % 3 === 0
                          ? service.info.pipe(Effect.asVoid)
                          : service
                              .processStart(
                                Start.cases.first.make({
                                  id: choice % 2 === 0 ? `birth-${config.start}` : `birth-${config.start}-${choice}`,
                                  name: choice % 2 === 0 ? "child" : `child-${choice}`,
                                  code: { program: "test/fixture", hash: FIXTURE.hash },
                                }),
                                {
                                  by: "fixture-writer",
                                  for: config.person,
                                  sentAt: "2026-11-08T04:00:00.000Z",
                                  seen: 0,
                                  parent: null,
                                  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                                  build: config.build,
                                },
                              )
                              .pipe(Effect.asVoid),
                      );
              return Reflect.apply(runtime.runPromise, runtime, [work]);
            },
            catch: (cause: unknown) => new EntryFailure({ cause }),
          });
      }

      return { enter, close };
    });
    return {
      deploy: Effect.fnUntraced(function* (next: StartsTest.Recipe) {
        input = { ...(yield* StartsTest.input(next)), founding: input.founding };
        captured.transport.push(JSON.stringify(input));
      }, Effect.provide(Digest.layerWebCrypto)),
      open,
      fault: (next) => {
        fault = next;
      },
      counts: () => ({ calls, reads, appends, consumers }),
      outputs: Effect.sync(() => {
        const tables = ["entries", "dev_descriptors", "unsent", "spans", "content"] as const;
        const output = { ...captured };

        // Each captured output is checked once; saved rows below are read again for changes.
        for (const channel of SettingsTest.channels) {
          output[channel] = captured[channel].splice(0);
        }

        for (const table of tables) {
          const rows = databases.flatMap((db) =>
            db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) === undefined
              ? []
              : db.prepare(`SELECT * FROM ${table}`).all(),
          );
          const channel =
            table === "entries"
              ? "ledger"
              : table === "dev_descriptors"
                ? "descriptors"
                : table === "content"
                  ? "content"
                  : "spans";
          output[channel] = [...output[channel], ...rows];
        }

        return output;
      }),
    } satisfies SettingsTest.Driver;
  }).pipe(Effect.provide(Digest.layerWebCrypto)),
);
