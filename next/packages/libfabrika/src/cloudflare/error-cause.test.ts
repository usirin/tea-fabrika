import { createHash } from "node:crypto";
import { RpcCallError } from "alchemy/Rpc";
import { Effect, Layer, Schema } from "effect";
import * as fc from "fast-check";
// T695, next/. The Cloudflare adapters keep the failure they translate (decision 0043 rule 12).
// Only the platform is fake: each stub, storage, bucket, loader and object state is a plain value
// whose calls reject or answer as the generator says, and the real adapter code runs on it.
// Audit sites: `platform.ts:12` (the one `unreachable` callback every client call shares),
// `index.ts:30` and `:35` (the worker loader), `box.ts:27` (a program box's declaration),
// `record.ts:22` (a record part's own name), `fetch.ts:67` (a client name in a grant URL),
// `runtime.ts:208` (a saved descriptor), `runtime.ts:223` (the checked bucket put),
// `runtime.ts:729` (a process object's own name), `connection.ts:16` (a connection's own name).
import { describe, expect, it, vi } from "vitest";
import { LedgerError } from "../ledger/Ledger.ts";
import { ProgramDown } from "../runtime/Program.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import { Chain, SinkError } from "../telemetry/Trace.ts";
import { programBox } from "./box.ts";
import { connectionLayer } from "./connection.ts";
import { fetch, workerLoader } from "./index.ts";
import { BucketClient, GatewayClient, ProcessClient, ProjectClient, StorageClient } from "./platform.ts";
import { recordWrite } from "./record.ts";
import { type BrainOptions, checkedPut, type Env, processDescriptor, processRuntime } from "./runtime.ts";

// Only the platform base class is fake, as in runner-reply.laws.test.ts.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 100;

/** A property over generated input, each run an Effect on the real code. */
const law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown, never>) =>
  it(name, () =>
    fc.assert(
      fc.asyncProperty(input, (value) => Effect.runPromise(check(value))),
      { seed: SEED, numRuns: RUNS },
    ),
  );

const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new TypeError(message, { cause: { detail: message } })),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

/** A platform object whose every method rejects with `failure`, whatever its name. */
const rejecting = <A>(failure: unknown): A =>
  new Proxy(
    {},
    {
      get: (_, key) => (key === "then" ? undefined : () => Promise.reject(failure)),
    },
  ) as A;

/** A platform value built from plain parts: the adapter reads only the parts each law gives. */
const fake = <A>(value: object): A => value as A;

/** Every client the shared callback serves, built on a rejecting platform object. */
const clients = (failure: unknown): Record<string, Record<string, (...args: Array<never>) => unknown>> => ({
  project: ProjectClient.make(rejecting(failure)),
  process: ProcessClient.make(rejecting(failure)),
  gateway: GatewayClient.make(rejecting(failure)),
  storage: StorageClient.make(rejecting(failure)),
  bucket: BucketClient.make(rejecting(failure)),
});

const calls = Object.entries(clients(null)).flatMap(([client, made]) =>
  Object.keys(made).map((method) => ({ client, method })),
);

// Ticket 502 slice S2: a ProcessClient call goes through Alchemy's typed stub inside `reach`, so its
// cause is the RpcCallError, and that error holds the rejection. Plant: `unreachable(error.cause)`.
const throughStub = new Set(["process"]);

/** The rejection a client's `unreachable` kept: its cause, or what the stub's RpcCallError holds. */
const kept = (client: string, cause: unknown) => {
  if (!throughStub.has(client)) {
    return cause;
  }

  expect(cause, `${client} keeps Alchemy's RpcCallError`).toBeInstanceOf(RpcCallError);
  return cause instanceof RpcCallError ? cause.cause : undefined;
};

describe("T695, the platform clients keep what the platform rejected with", () => {
  // C5, platform.ts:12, every `catch: unreachable` in that file. Plant: the zero-argument callback.
  it("vector: the shared callback serves at least every client method the adapters call", () => {
    // A floor, so a client that loses its methods cannot shrink the law below to nothing.
    expect(calls.length).toBeGreaterThanOrEqual(50);
  });

  law(
    "C5: a generated rejection on any client call is `unreachable` with that very value as its cause",
    fc.record({
      steps: fc.array(fc.record({ call: fc.constantFrom(...calls), failure: failures }), {
        minLength: 1,
        maxLength: 8,
      }),
    }),
    ({ steps }) =>
      Effect.gen(function* () {
        for (const { call, failure } of steps) {
          const method = clients(failure)[call.client]?.[call.method];
          expect(method, `${call.client}.${call.method}`).toBeTypeOf("function");
          const error = yield* Effect.flip((method as () => Effect.Effect<unknown, LedgerError>)());
          expect(error).toBeInstanceOf(LedgerError);
          expect(error.reason).toBe("unreachable");
          expect(kept(call.client, error.cause), `${call.client}.${call.method} keeps the rejection`).toBe(failure);
        }
      }),
  );
});

/** A Worker Loader whose program's `describe` answers `describe()`. */
const loader = (describe: () => Promise<unknown>): WorkerLoader =>
  fake({ get: () => ({ getEntrypoint: () => ({ describe }) }) });

const programs = { counter: { hash: "h-1", source: "export default {}" } };

describe("T695, the worker loader keeps why a program did not load", () => {
  // C1, index.ts:30. Plant: `const fail = () => new ProgramDown({ reason: "load" })`.
  law(
    "C1: a describe call that rejects fails `load` with the rejected value as its cause",
    fc.record({ failure: failures, process: fc.string() }),
    ({ failure, process }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          workerLoader(
            loader(() => Promise.reject(failure)),
            programs,
          ).load("counter", process),
        );
        expect(error).toBeInstanceOf(ProgramDown);
        expect(error.reason).toBe("load");
        expect(error.cause).toBe(failure);
      }),
  );

  // C3, index.ts:35. Plant: `Effect.mapError(() => new ProgramDown({ reason: "load" }))`.
  law(
    "C3: a declaration with a damaged field fails `load` with the decoder's SchemaError",
    fc.record({ name: fc.oneof(fc.integer(), fc.boolean()), v: fc.integer() }),
    ({ name, v }) =>
      Effect.gen(function* () {
        const declared = { name, v, writes: {}, inputs: {}, cmds: [] };
        const error = yield* Effect.flip(
          workerLoader(
            loader(() => Promise.resolve(declared)),
            programs,
          ).load("counter", "p"),
        );
        expect(error.reason).toBe("load");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );

  // C1, box.ts:27. Plant: `Effect.mapError(() => new ProgramDown({ reason: "load" }))`.
  law(
    "C1: a program box with a damaged declaration fails `describe` with the stepper's SchemaError",
    fc.record({ name: fc.oneof(fc.integer(), fc.constant(null)), build: fc.string() }),
    ({ name, build }) =>
      Effect.gen(function* () {
        const Box = programBox({ name }, build);
        const box = new Box(undefined as never, undefined as never);
        const error = yield* Effect.flip(
          Effect.tryPromise({ try: () => box.describe(), catch: (cause) => cause as ProgramDown }),
        );
        expect(error).toBeInstanceOf(ProgramDown);
        expect((error as ProgramDown).reason).toBe("load");
        expect(Schema.isSchemaError((error as ProgramDown).cause), "the cause is the stepper's failure").toBe(true);
      }),
  );
});

/** A Durable Object state with this name, and storage whose `get` answers `saved`. */
const objectState = (name: unknown, saved: unknown = undefined): DurableObjectState =>
  fake({
    id: { name },
    storage: {
      get: () => Promise.resolve(saved),
      sql: { exec: () => ({ toArray: () => [], raw: () => [] }) },
      transactionSync: (step: () => unknown) => step(),
    },
  });

const env: Env = fake({
  INSTANCE: JSON.stringify(instanceFixture({ name: "p", port: 8787 })),
  PROJECT: {
    getByName: () =>
      new Proxy(rejecting<object>(new Error("no project in this law")), {
        get: (target, key) =>
          key === "settingsStart"
            ? async () => StartsTest.reply(instanceFixture({ name: "p", port: 8787 }))
            : Reflect.get(target, key),
      }),
  },
  RECORD: { getByName: () => rejecting(new Error("no record in this law")) },
  CONNECTION: { getByName: () => rejecting(new Error("no connection in this law")) },
  PROCESS: { getByName: () => rejecting(new Error("no process in this law")) },
  MEASUREMENTS: rejecting(new Error("no bucket in this law")),
  LOADER: loader(() => Promise.resolve(null)),
});

const config: BrainOptions = fake(instanceFixture({ name: "p", port: 8787 }));

describe("T695, the object adapters keep what failed", () => {
  // C3, record.ts:22. Plant: `Effect.mapError(() => new SinkError({ reason: "bad_row", held: 0 }))`.
  law(
    "C3: a record part whose own name does not decode fails `bad_row` with the decoder's SchemaError",
    fc.record({
      name: fc.oneof(
        fc.string().map((s) => `{${s}`),
        fc.constant(JSON.stringify([1, 2])),
      ),
      at: fc.nat(),
    }),
    ({ name, at }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(recordWrite(objectState(name), undefined, Chain.cases.spans.make({}), at, []));
        expect(error).toBeInstanceOf(SinkError);
        expect(error.reason).toBe("bad_row");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );

  // C6, record.ts:25: a name for another part decodes and refuses, with no underlying failure.
  law(
    "C6: a record part named for another part fails `bad_row` with no cause",
    fc.record({ at: fc.nat(), other: fc.nat() }).filter(({ at, other }) => at !== other),
    ({ at, other }) =>
      Effect.gen(function* () {
        const name = JSON.stringify(["p", `spans/${other}`]);
        const error = yield* Effect.flip(recordWrite(objectState(name), undefined, Chain.cases.spans.make({}), at, []));
        expect(error.reason).toBe("bad_row");
        expect(error.cause).toBeUndefined();
      }),
  );

  // C3, runtime.ts:208. Plant: `Effect.mapError(() => new LedgerError({ reason: "bad_row" }))`.
  law(
    "C3: a saved descriptor with a damaged field fails `bad_row` with the decoder's SchemaError",
    fc.record({ id: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)) }),
    ({ id }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(processDescriptor(objectState("x", { id })));
        expect(error.reason).toBe("bad_row");
        expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );

  // C1, runtime.ts:223. Plant: `const fail = () => new LedgerError({ reason: "crypto" })`.
  law(
    "C1: a bucket put whose digest rejects fails `crypto` with the rejected value as its cause",
    fc.record({ failure: failures, body: fc.uint8Array({ maxLength: 32 }), key: fc.string() }),
    ({ failure, body, key }) =>
      Effect.acquireUseRelease(
        Effect.sync(() => vi.spyOn(crypto.subtle, "digest").mockRejectedValue(failure)),
        () =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(checkedPut(rejecting(new Error("unused")), key, body, "00"));
            expect(error.reason).toBe("crypto");
            expect(error.cause).toBe(failure);
          }),
        (spy) => Effect.sync(() => spy.mockRestore()),
      ),
  );

  // C6, runtime.ts:226: a hash that differs is refused with no underlying failure.
  law(
    "C6: a bucket put whose hash differs fails `bad_row` with no cause",
    fc.record({ body: fc.uint8Array({ maxLength: 32 }), key: fc.string() }),
    ({ body, key }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(checkedPut(rejecting(new Error("unused")), key, body, "not-a-digest"));
        expect(error.reason).toBe("bad_row");
        expect(error.cause).toBeUndefined();
      }),
  );

  // C3, runtime.ts:729 and connection.ts:16: an object's own name. Plant: drop the decode failure.
  law(
    "C3: a process or connection object whose own name does not decode fails `bad_row` with its SchemaError",
    fc.record({
      kind: fc.constantFrom("process", "connection"),
      name: fc.oneof(
        fc.constant(undefined),
        fc.integer(),
        fc.string().map((s) => `[${s}`),
      ),
    }),
    ({ kind, name }) =>
      Effect.gen(function* () {
        // A connection's name is any string, so only a non-string fails it; a process needs a pair.
        const state = objectState(kind === "connection" && typeof name === "string" ? 7 : name);
        const error = yield* Effect.flip(
          kind === "process"
            ? Effect.acquireUseRelease(
                Effect.sync(() => processRuntime(state, env, {})),
                (runtime) =>
                  Effect.tryPromise({
                    try: () => runtime.runPromise(Effect.void),
                    catch: (cause) => cause as LedgerError,
                  }),
                (runtime) => Effect.promise(() => runtime.dispose()),
              )
            : Effect.scoped(Layer.build(connectionLayer(state, env, config))),
        );
        expect(error).toBeInstanceOf(LedgerError);
        const ledger = error instanceof LedgerError ? error : undefined;
        expect(ledger?.reason).toBe("bad_row");
        expect(Schema.isSchemaError(ledger?.cause), "the cause is the decoder's own failure").toBe(true);
      }),
  );
});

describe("T695, the public route keeps what failed", () => {
  // C1, fetch.ts:67. Plant: `catch: () => new LedgerError({ reason: "bad_row" })`.
  law(
    "C1: a grant URL whose client name is broken percent-encoding fails `bad_row` with the URIError",
    fc.record({ head: fc.stringMatching(/^[a-z0-9]{0,8}$/), broken: fc.constantFrom("%E0%A4%A", "%", "%zz", "%C3") }),
    ({ head, broken }) =>
      Effect.gen(function* () {
        const request = new Request(`http://127.0.0.1:${8787}/grant/client/${head}${broken}`, {
          headers: { host: `127.0.0.1:${8787}` },
        });
        const error = yield* Effect.flip(fetch(request, env, config));
        expect(error).toBeInstanceOf(LedgerError);
        expect((error as LedgerError).reason).toBe("bad_row");
        expect((error as LedgerError).cause).toBeInstanceOf(URIError);
      }),
  );
});

function instanceFixture(config: StartsTest.Fixture) {
  return StartsTest.fixture(config, (algorithm, data) =>
    createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
  );
}
