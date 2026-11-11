// P12, next/. [secrets] Generated flows through the real stage, control route, Connection and sinks.
// Only platform deployment, HTTP/RPC transport, child RSS and Cloudflare handles are supplied.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inspect } from "node:util";
import { RuntimeLifecycle, type RuntimeEvent } from "@alchemy.run/cloudflare-runtime/core/Runtime";
import { NodeServices } from "@effect/platform-node";
import { Context, Effect, Exit, Layer, Logger, ManagedRuntime, Redacted, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import * as fc from "fast-check";
import { expect, expectTypeOf, it, vi } from "vitest";
import { ConnectionService, connectionRuntime } from "../../cloudflare/connection.ts";
import { control } from "../../cloudflare/control.ts";
import type { Env } from "../../cloudflare/runtime.ts";
import { Doorbell, Ledger } from "../../ledger/Ledger.ts";
import * as LedgerSql from "../../ledger/LedgerSql.ts";
import { lineFor } from "../../ledger/Log.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import { ProcessIdGenerator } from "../../processes/ProcessIdGenerator.ts";
import { BrainEvent } from "../../runtime/BrainEvent.ts";
import { recordPart } from "../../telemetry/Records.ts";
import { Chain, SpanRow } from "../../telemetry/Trace.ts";
import { Attached } from "../../transport/Wire.ts";
import { rssLayer } from "./dev.fixture.ts";
import { startDev } from "./dev.ts";
import { brainOutbox } from "./local-dev.ts";

class CallError extends Schema.TaggedError<CallError>()("CallError", {
  cause: Schema.Unknown,
}) {}

const config = {
  name: "secret-test",
  person: "person-test",
  founder: "public-test",
  window: null,
  port: 18787,
  build: "test",
};

const destinations = ["spans", "logs", "journal", "measurements", "outbox"] as const;
type Destination = (typeof destinations)[number];
type Outputs = Record<Destination, Array<unknown>>;

const forms = (text: string) => [
  text,
  Buffer.from(text).toString("base64"),
  Buffer.from(text).toString("base64url"),
  encodeURIComponent(text),
  JSON.stringify(text).slice(1, -1),
];

const strings = (value: unknown): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(strings);
  }

  return value !== null && typeof value === "object"
    ? Object.entries(value).flatMap(([key, child]) => [key, ...strings(child)])
    : [];
};

const clean = (outputs: Outputs, words: ReadonlyArray<string>) => {
  const forbidden = words.flatMap(forms);
  const leaks: Array<Destination> = [];

  for (const destination of destinations) {
    // JSON covers saved strings; inspect also sees Error messages and non-enumerable values.
    const json = JSON.stringify(outputs[destination]);
    const text = json + inspect(outputs[destination], { depth: null }) + strings(JSON.parse(json)).join("\n");

    if (forbidden.some((word) => text.includes(word))) {
      leaks.push(destination);
    }
  }

  expect(leaks, "no named output may hold a secret or raw frame").toEqual([]);
};

const measurements = (db: DatabaseSync) =>
  ["measurements", "summary", "aggregated", "sizes", "archived"].map((table) => ({
    table,
    rows: db.prepare(`SELECT * FROM ${table}`).all(),
  }));

const generated = fc.record({
  word: fc.stringMatching(/^[a-zA-Z0-9]{12,24}$/),
  pass: fc.stringMatching(/^[a-zA-Z0-9]{12,24}$/),
  moves: fc.array(fc.constantFrom("ok", "refused", "rpc", "malformed", "restart"), {
    minLength: 1,
    maxLength: 6,
  }),
});

type Flow = ReturnType<typeof generated.generate>["value"];

const flow = async (sample: Flow) => {
  const home = mkdtempSync(join(tmpdir(), "p12-sec-"));
  vi.stubEnv("FABRIKA_HOME", home);
  const material = `${sample.word}/"\\\n`.padEnd(32, "!");
  const random = Layer.succeed(
    SecureRandom.SecureRandom,
    SecureRandom.make((size) => {
      expect(size).toBe(32);
      return Buffer.from(material);
    }),
  );
  const bearer = Buffer.from(material).toString("base64url");
  const key = `fake private key/${sample.pass}"\\\n`;
  const body = `fake body/${sample.word}/${sample.pass}"\\\n`;
  const rawFrame = JSON.stringify({
    jsonrpc: "2.0",
    id: "send",
    method: "process.send",
    params: { body, key, pass: sample.pass, authorization: bearer },
  });
  const words = [material, bearer, key, body, sample.pass, rawFrame];
  const outputs: Outputs = { spans: [], logs: [], journal: [], measurements: [], outbox: [] };
  const journalDb = new DatabaseSync(":memory:");
  const journal = ManagedRuntime.make(
    LedgerSql.layer(nodeSql(journalDb), { reader: "secret-test" }).pipe(
      Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
    ),
  );
  const parts = new Map<string, DatabaseSync>();
  const part = (name: string) => {
    let db = parts.get(name);

    if (!db) {
      db = new DatabaseSync(":memory:");
      parts.set(name, db);
    }

    return db;
  };
  let mode = "ok";
  const delivered = async (name: string, args: ReadonlyArray<unknown>) => {
    const [chain, at, rows] = Schema.decodeUnknownSync(
      Schema.Tuple([
        Chain,
        Schema.Int,
        Schema.Array(Schema.Struct({ span: SpanRow, content: Schema.NullOr(Schema.String) })),
      ]),
    )(args);
    const store = recordPart(nodeSql(part(name)), chain, at, 1_000_000_000);
    return Effect.runPromise(store.write(rows));
  };
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const call = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          target: Schema.String,
          name: Schema.String,
          method: Schema.String,
          args: Schema.Array(Schema.Unknown),
        }),
      ),
    )(String(options?.body));
    // The platform send is allowed to hold the bearer; persistent outputs are checked below.
    expect(new Headers(options?.headers).get("authorization")).toBe(`Bearer ${bearer}`);

    if (call.method === "write") {
      return Response.json({ value: await delivered(`node/${call.name}`, call.args) });
    }

    if (call.method === "brain") {
      if (mode === "rpc") {
        throw new Error(`${bearer} ${rawFrame}`);
      }

      const event = Schema.decodeUnknownSync(BrainEvent)(call.args[0]);
      await journal.runPromise(
        Ledger.use((ledger) =>
          ledger.append(
            "gateway/brain",
            event.id,
            lineFor(
              {
                by: "SHA256:brain-test",
                for: config.person,
                sentAt: "2026-11-08T00:00:00Z",
                seen: 0,
                parent: null,
                traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                build: config.build,
              },
              event,
            ),
          ),
        ),
      );
      return Response.json({ value: null });
    }

    if (mode === "rpc") {
      throw new Error(`${bearer} ${rawFrame}`);
    }

    if (mode === "malformed") {
      return new Response(`${bearer} ${rawFrame}`);
    }

    if (mode === "refused") {
      return Response.json({ error: { reason: "refused" } });
    }

    return Response.json({ value: [] });
  });
  const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
    vi.spyOn(console, name).mockImplementation((...args) => {
      outputs.logs.push({ name, args });
    }),
  );
  const logger = Logger.layer([
    Logger.make((options) => {
      outputs.logs.push({ level: options.logLevel, message: options.message, cause: options.cause });
    }),
  ]);
  const gatewayDb = new DatabaseSync(":memory:"),
    sql = nodeSql(gatewayDb);
  let attached: unknown = Attached.cases.online.make({
    client: "client",
    who: { key: "public", person: "person-test", as: "agent" },
    version: 1,
    waits: [],
    watching: false,
    busy: false,
  });
  const ws = {
    deserializeAttachment: () => attached,
    serializeAttachment: (value: unknown) => {
      attached = value;
    },
    send: () => {},
    close: () => {},
  };
  // oxlint-disable-next-line fabrika/no-type-assertions -- the fixture supplies attachment, send and close; workerd owns the complete socket
  const socket = ws as unknown as WebSocket;
  // oxlint-disable-next-line fabrika/no-type-assertions -- workerd owns the full handles; the fixture supplies every member these real services call
  const ctx = {
    id: { name: "gateway" },
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
    getTags: () => ["session", "tab", "public"],
    getWebSocketAutoResponseTimestamp: () => null,
  } as unknown as DurableObjectState;
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies RPC transport only; Connection and record processing remain product code
  const env = {
    PROJECT: {
      getByName: () => ({
        route: async () => {
          if (mode === "rpc") {
            throw new Error(`${bearer} ${rawFrame}`);
          }

          if (mode === "refused") {
            return { _tag: "refused", reason: "not_granted" };
          }

          return { _tag: "ok", result: { accepted: true } };
        },
        info: async () => [],
        leave: async () => {},
        disconnect: async () => {},
      }),
    },
    RECORD: {
      getByName: (name: string) => ({
        write: (...args: Array<unknown>) => delivered(`worker/${name}`, args),
      }),
    },
  } as unknown as Env;
  const runtime = connectionRuntime(ctx, env, config);

  try {
    const gateway = await runtime.runPromise(ConnectionService.pipe(Effect.provide(logger)));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let observe: (event: RuntimeEvent) => void = () => {};
          const stage = yield* startDev({ ...config, home }, (local) =>
            Effect.gen(function* () {
              observe = Context.get(local, RuntimeLifecycle);
              const plugin = [...local.mapUnsafe.values()].find(
                (value) => typeof value === "object" && value !== null && "sockets" in value,
              ) as {
                sockets: ReadonlyArray<{ service: { props: { json: string } } }>;
                start: (ports: Record<string, number>) => Effect.Effect<unknown>;
              };
              // Plugin props and HTTP headers are both platform sends. Each must receive
              // the bearer bytes; serializing a Redacted here would break the real stage.
              expect(
                Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ token: Schema.String })))(
                  plugin.sockets[0]!.service.props.json,
                ),
              ).toEqual({ token: bearer });
              observe({ type: "start", worker: config.name, pid: 27001 });
              yield* plugin.start({ "fabrika-control": 27002 });
            }),
          );
          const outbox = yield* brainOutbox(home);
          const awaitEvent = (ready: (row: Effect.Success<typeof outbox.pending>[number]) => boolean) =>
            Effect.gen(function* () {
              for (;;) {
                const rows = yield* outbox.pending;

                if (rows.some(ready)) {
                  return;
                }

                yield* Effect.sleep("5 millis");
              }
            }).pipe(Effect.timeout("5 seconds"));

          for (const move of sample.moves) {
            mode = move;

            if (move === "restart") {
              const previous = yield* outbox.last;
              observe({
                type: "exit",
                worker: config.name,
                exit: { exitCode: 1, signal: null, stderr: "" },
              });
              observe({
                type: "restart",
                worker: config.name,
                delay: 250,
                exit: { exitCode: 1, signal: null, stderr: "" },
              });
              observe({ type: "start", worker: config.name, pid: 27003 });
              yield* awaitEvent((row) => row._tag === "started" && row.after === previous);
            }

            // Arbitrary bodies and passes cross real Connection parsing, including refusals and throws.
            yield* Effect.tryPromise({
              try: () =>
                runtime.runPromise(
                  gateway
                    .message(socket, move === "malformed" ? `${rawFrame}!` : rawFrame)
                    .pipe(Effect.provide(logger)),
                ),
              catch: (cause) => new CallError({ cause }),
            });
            yield* Effect.tryPromise({
              try: () => Reflect.get(stage.project(config.name), "info")(),
              catch: (cause) => new CallError({ cause }),
            }).pipe(Effect.ignore);
            outputs.outbox.push(yield* outbox.pending);
          }

          mode = "rpc";
          // The real stage remains the single writer. Wait for its queue before closing scope.
          observe({
            type: "exit",
            worker: config.name,
            exit: { exitCode: 1, signal: null, stderr: "" },
          });
          observe({
            type: "stop",
            worker: config.name,
            reason: "intensity",
            exit: { exitCode: 1, signal: null, stderr: "" },
          });
          yield* awaitEvent((row) => row._tag === "braked");
          outputs.outbox.push(yield* outbox.pending);
        }),
      ).pipe(
        Effect.provide(ProcessIdGenerator.layer),
        Effect.provide(random),
        Effect.provide(rssLayer(() => 0)),
        Effect.provide(NodeServices.layer),
        Effect.provide(logger),
      ),
    );
    outputs.outbox.push(
      readFileSync(join(home, "brain.pending.jsonl"), "utf8"),
      readFileSync(join(home, "brain.last.json"), "utf8"),
    );
    // Control receives a Redacted at the service boundary. Reflect.apply keeps this runtime
    // law runnable on the old string signature; the type law below forbids that signature.
    const request = new Request("http://local/", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
      body: JSON.stringify({
        target: "project",
        project: config.name,
        name: "",
        method: "info",
        args: [],
      }),
    });
    const checked: Effect.Effect<Response, unknown> = Reflect.apply(control, undefined, [
      request,
      env,
      Redacted.make(bearer),
      {},
    ]);
    const forged = request.clone();
    forged.headers.set("authorization", `Bearer wrong-${sample.pass}`);
    const denied: Effect.Effect<Response, unknown> = Reflect.apply(control, undefined, [
      forged,
      env,
      Redacted.make(bearer),
      {},
    ]);
    expect((await Effect.runPromise(denied)).status).toBe(403);
    const answer = await Effect.runPromiseExit(checked.pipe(Effect.provide(logger)));

    // Keep content collection independent of the new contract assertion.
    for (const db of parts.values()) {
      outputs.spans.push(db.prepare("SELECT * FROM spans").all(), db.prepare("SELECT * FROM content").all());
    }

    outputs.measurements.push(...measurements(gatewayDb));
    const nodeDb = new DatabaseSync(join(home, "brain.records.sqlite"));

    try {
      outputs.measurements.push(...measurements(nodeDb));
      outputs.spans.push(nodeDb.prepare("SELECT * FROM unsent").all());
    } finally {
      nodeDb.close();
    }

    outputs.journal.push(journalDb.prepare("SELECT * FROM entries").all());
    expect(parts.size).toBeGreaterThan(0);
    expect(outputs.journal.length).toBeGreaterThan(0);
    expect(outputs.measurements.flat().length).toBeGreaterThan(0);
    return { outputs, words, answer };
  } finally {
    fetch.mockRestore();

    for (const spy of consoleSpies) {
      spy.mockRestore();
    }

    await runtime.dispose();
    await journal.dispose();
    journalDb.close();
    gatewayDb.close();

    for (const db of parts.values()) {
      db.close();
    }

    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
};

// Pin the P12 bearer-type gap: the service contract must refuse a plain string.
it("pinned: [secrets] P12 bearer-type gap, control services require a Redacted bearer", () => {
  expectTypeOf<Parameters<typeof control>[2]>().toEqualTypeOf<Redacted.Redacted<string>>();
});

it("[secrets] generated flows keep bearer, private material, bodies and raw frames out of every named output", async () => {
  await fc.assert(
    fc.asyncProperty(generated, async (sample) => {
      const { outputs, words } = await flow(sample);
      clean(outputs, words);

      // Plant each secret/frame encoding in every collected destination. The same check
      // must fail even for destinations which a successful flow leaves empty, such as logs.
      for (const destination of destinations) {
        for (const word of words) {
          for (const encoded of forms(word)) {
            const planted = { ...outputs, [destination]: [...outputs[destination], { leak: encoded }] };
            expect(() => clean(planted, words)).toThrow();
          }
        }
      }
    }),
    {
      seed: 119120,
      numRuns: 15,
      examples: [
        [
          {
            word: "review6bearer",
            pass: "review6passphrase",
            moves: ["ok", "refused", "rpc", "malformed", "restart"],
          },
        ],
      ],
    },
  );
});

it("[secrets] the Worker control edge accepts the generated Redacted bearer without returning it", async () => {
  await fc.assert(
    fc.asyncProperty(generated, async (sample) => {
      const { answer, outputs, words } = await flow(sample);
      expect(Exit.isSuccess(answer)).toBe(true);
      const response = Exit.isSuccess(answer) ? answer.value : new Response(null);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ value: [] });
      clean(outputs, words);
    }),
    { seed: 119120, numRuns: 10 },
  );
});
