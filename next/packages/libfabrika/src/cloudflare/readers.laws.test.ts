// P12, next/. Saved and wire values enter the real services over in-memory platform handles.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Cause, Effect, Exit, Redacted, Schema } from "effect";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { Writer } from "../coordination/index.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Attached } from "../transport/Wire.ts";
import { GatewayService, gatewayRuntime } from "./connection.ts";
import { control } from "./control.ts";
import { recordRead } from "./record.ts";
import { ProcessService, processDescriptor, processRuntime, type Env } from "./runtime.ts";

vi.mock("effect", async (original) => {
  const actual = await original<typeof import("effect")>();
  return { ...actual, Effect: { ...actual.Effect } };
});

const config = {
  name: "parse-test",
  person: "person-test",
  founder: "public-test",
  window: null,
  port: 18787,
  build: "test",
};

const malformed = (schema: Schema.Top) => fc.jsonValue().filter((value) => !Schema.is(schema)(value));

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
    who: { key: "public", person: "person", as: "agent" },
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
    PROJECT: {
      getByName: () => ({
        route,
        leave: async () => {},
        disconnect: async () => {},
        clientConnect: async () => "client",
        challenge: async () => "nonce",
      }),
    },
    RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
    HEALTH: {},
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
  it(`Gateway startup returns a typed error for malformed saved ${source}`, async () => {
    const schema = {
      attachment: Attached,
      tags: Schema.Tuple([Schema.String, Schema.String, Schema.String]),
      name: Schema.String,
    }[source];
    await fc.assert(
      fc.asyncProperty(malformed(schema), async (raw) => {
        const w = world();
        ({ attachment: w.attached, tags: w.tags, name: w.name })[source](raw);
        const runtime = gatewayRuntime(w.ctx, w.env, config);

        try {
          typed(await runtime.runPromiseExit(GatewayService));
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
  it(`Gateway ${method} returns a typed error for a damaged attachment after startup`, async () => {
    await fc.assert(
      fc.asyncProperty(malformed(Attached), async (raw) => {
        const w = world(),
          runtime = gatewayRuntime(w.ctx, w.env, config);

        try {
          const gateway = await runtime.runPromise(GatewayService);
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

it("Gateway ready RPC decoding fails in the typed channel before the wait refusal is sent", async () => {
  await fc.assert(
    fc.asyncProperty(malformed(Schema.Struct({ rev: Schema.Int })), async (raw) => {
      const w = world(),
        runtime = gatewayRuntime(w.ctx, w.env, config);
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
        const gateway = await runtime.runPromise(GatewayService);
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

it("Gateway close checks saved tags again after startup", async () => {
  await fc.assert(
    fc.asyncProperty(malformed(Schema.String), async (raw) => {
      const w = world(),
        runtime = gatewayRuntime(w.ctx, w.env, config);

      try {
        const gateway = await runtime.runPromise(GatewayService);
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

it("Gateway rejects missing or malformed URL segments with a typed error", async () => {
  const invalid = fc.oneof(
    fc.constantFrom("/ws", "/ws/key", "/ws/%/tab", "/ws/key/%"),
    fc.string().map((text) => `/ws/${encodeURIComponent(text)}%/tab`),
  );
  await fc.assert(
    fc.asyncProperty(invalid, async (path) => {
      const w = world(),
        runtime = gatewayRuntime(w.ctx, w.env, config);
      vi.stubGlobal(
        "WebSocketPair",
        class {
          0 = {};
          1 = {};
        },
      );

      try {
        const gateway = await runtime.runPromise(GatewayService);
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
