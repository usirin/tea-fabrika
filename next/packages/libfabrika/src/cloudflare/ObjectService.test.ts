// T502 S1, next/. Law 3 of docs/plan/ticket-502-alchemy-port.md, on Node: the two plain helpers
// every object shell uses. Only the Project stub is fake; the settings decode, the start record,
// the retrying runtime and Alchemy's own request runner are the real ones.
//
// The names and signatures these laws fix, for the build and for the Process and Project shells:
//
//   ObjectService.make(service, ready)
//     service: the service's class, such as ConnectionService
//     ready:   Layer.Layer<Identifier, E>, the service's own layer, needing nothing
//     returns: Effect.Effect<Service, wire failure>, a plain value. Calling `make` builds nothing.
//
//   ObjectService.fromWebHandler(handler)
//     handler: (request: Request) => Effect.Effect<Response, E>
//     returns: the object's request slot, an Effect that reads Effect's HttpServerRequest and
//              answers an HttpServerResponse. The name is Effect's own, HttpEffect.fromWebHandler.
//
// Plants, each run once and never kept: build the service when `make` is called; keep a failed
// build (Effect.cached); answer a default port when the build fails; keep the failure's cause;
// build a new Request for the handler; copy the handler's Response. On the Process shell: build
// the service eagerly in the Layer's outer Effect.
import {
  DurableObjectState as ObjectState,
  fromDurableObjectState,
} from "@alchemy.run/cloudflare/Workers/DurableObjectState";
import { makeRequestEffect } from "@alchemy.run/cloudflare/Workers/HttpServer";
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { describe, expect } from "@effect/vitest";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Context, Effect, Layer, Option, type Scope, Struct } from "effect";
import { HttpClientRequest, HttpClientResponse } from "effect/http";
import * as fc from "fast-check";
import { vi } from "vitest";
import { Writer } from "../access/SessionManager.ts";
import { LedgerError } from "../ledger/Ledger.ts";
import { Activity } from "../processes/Process.ts";
import { ProgramRunner } from "../runtime/Runner.ts";
import { RecordedStart } from "../settings/RecordedStart.ts";
import { Failure } from "../settings/Start.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import type { ProcessShape } from "./objects.ts";
import * as ObjectService from "./ObjectService.ts";
import * as ProcessObject from "./ProcessObject.ts";
import { recordedLayer, settings, type Env } from "./runtime.ts";

// The Process shell is Alchemy's Effect object: keep only what its Layer hands to Alchemy's `make`,
// so law 3 can construct it and call it on Node, as law A2 in alarm.laws.test.ts does. Every other
// name in objects.ts stays as it is.
const made = vi.hoisted((): { value?: object } => ({}));

vi.mock("./objects.ts", async (original) => {
  const actual = await original<typeof import("./objects.ts")>();
  const { Layer } = await import("effect");
  return {
    ...actual,
    Process: {
      make: (implementation: object) => {
        made.value = implementation;
        return Layer.empty;
      },
    },
  };
});

class Probe extends Context.Service<Probe, { readonly port: number }>()(
  "@kampus/libfabrika/cloudflare/ObjectService.test.Probe",
) {}

/** A platform value built from plain parts: the layers read only the parts each law gives. */
const fake = <A>(value: object): A => value as A;

/** The instance setting as the stack hands it in, and a Project that records any start as `saved`. */
const bindings = (instance: string, saved: Parameters<typeof StartsTest.reply>[0]): Env =>
  fake({
    INSTANCE: instance,
    PROJECT: { getByName: () => ({ settingsStart: () => Promise.resolve(StartsTest.reply(saved)) }) },
  });

// Both ways an object reads its setting today. `starts` is the library's own read, which fails
// with StartsError. `ledger` is the app's checked read, which Connection and Project are given,
// and which fails with LedgerError `bad_row` holding the decoder's failure as its cause.
const routes = ["starts", "ledger"] as const;

const shell = (env: Env, route: (typeof routes)[number]) => {
  let builds = 0;
  const recorded =
    route === "starts"
      ? recordedLayer(env)
      : recordedLayer(
          env,
          settings(env).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause }))),
        );
  const ready = Layer.unwrap(
    Effect.sync(() => {
      builds++;
      return Layer.effect(
        Probe,
        RecordedStart.useSync((start) => ({ port: start.values.port })),
      ).pipe(Layer.provide(recorded));
    }),
  );
  return { service: ObjectService.make(Probe, ready), builds: () => builds };
};

// The three kinds of bad setting the plan names. Each is a recipe applied to a good setting.
const damage = fc.oneof(
  fc.record({ _tag: fc.constant("broken" as const), at: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ _tag: fc.constant("missing" as const), pick: fc.nat() }),
  fc.record({ _tag: fc.constant("extra" as const), key: fc.string(), value: fc.jsonValue() }),
);

const damaged = (
  good: Readonly<Record<string, unknown>>,
  recipe: typeof damage extends fc.Arbitrary<infer A> ? A : never,
) => {
  if (recipe._tag === "broken") {
    // A proper prefix of a JSON object is never JSON: its closing brace is gone.
    const text = JSON.stringify(good);
    return text.slice(0, 1 + Math.floor(recipe.at * (text.length - 2)));
  }

  if (recipe._tag === "missing") {
    const keys = Object.keys(good);
    const { [keys[recipe.pick % keys.length]!]: _dropped, ...rest } = good;
    return JSON.stringify(rest);
  }

  return JSON.stringify({ ...good, [`x-${recipe.key}`]: recipe.value });
};

/** What Alchemy's `make` is handed for the Process object: the Layer's outer Effect, which answers
 *  the instance's slots and calls. */
type ProcessConstructor = Effect.Effect<
  Effect.Effect<ProcessShape, never, ObjectState | RuntimeContext | Scope.Scope>,
  never,
  ObjectState | WorkerEnvironment | Scope.Scope
>;

const unexpected = () => {
  throw new Error("unexpected platform call");
};

const descriptor = {
  id: "process_01m7ccwxr5fcyvwy2vy00pydgm",
  name: "law:3",
  program: "test/law-3",
  build: "law-3-build",
  owner: Writer.cases.person.make({ key: "test-key", for: "test-person" }),
};

/** Every call of the Process contract that reaches its service. `descriptor` and `savedAlarm` read
 *  storage alone, and `abort` resets the instance, so none of the three builds anything. */
const processCalls = {
  usage: (process: ProcessShape) => process.usage([]),
  configure: (process: ProcessShape) => process.configure(descriptor, false),
  msg: (process: ProcessShape) => process.msg({}),
  open: (process: ProcessShape) => process.open("law-3"),
  mailed: (process: ProcessShape) => process.mailed(),
  due: (process: ProcessShape) => process.due(1),
  restart: (process: ProcessShape) => process.restart({ id: descriptor.id, build: descriptor.build }),
  activity: (process: ProcessShape) => process.activity(Activity.cases.idle.make({ process: descriptor.id })),
  recover: (process: ProcessShape) => process.recover(),
};

const processCallNames = Struct.keys(processCalls);

describe("T502 S1, the helpers every object shell uses, next/", () => {
  StartsTest.law(
    "law 3: any bad instance setting fails each call with its wire failure; building waits for a call, is tried again, and never falls back",
    fc.record({
      damage,
      route: fc.constantFrom(...routes),
      calls: fc.integer({ min: 1, max: 4 }),
      port: fc.integer({ min: 1, max: 65535 }),
    }),
    ({ damage: recipe, route, calls, port }) =>
      Effect.gen(function* () {
        const base = yield* StartsTest.input({
          port,
          start: "s1-start",
          build: "s1-build",
          revision: null,
          origin: "flag",
        });
        const good = {
          ...base,
          name: "p",
          founding: { person: "test-person", founder: "test-public-key", window: null },
        };
        const bad = damaged(good, recipe);

        // Calling `make` is the shell's construction: it may not throw, and it may not build.
        const broken = yield* Effect.sync(() => shell(bindings(bad, good), route));
        yield* Effect.yieldNow;
        expect(broken.builds(), "nothing is built before the first call").toBe(0);

        for (let call = 1; call <= calls; call++) {
          // `flip` lets a defect through and fails on an answer, so a die or a fallback fails here.
          const failure: unknown = yield* Effect.flip(broken.service);

          // The decoder's failure can quote the setting, so only a fixed summary leaves the object:
          // a StartsError as its wire form with no cause, a LedgerError as its reason alone.
          if (route === "starts") {
            expect(failure).toStrictEqual(Failure.make({ reason: Failure.fields.reason.cases.Decode.make({}) }));
          } else {
            expect(failure).toBeInstanceOf(LedgerError);
            expect(failure).toMatchObject({ reason: "bad_row" });
            expect(Reflect.get(Object(failure), "cause"), "the cause stays inside the object").toBeUndefined();
          }

          expect(broken.builds(), "a failed build is not kept: the next call builds again").toBe(call);
        }

        // The same shell on the good setting: one build, kept, and the setting's own value.
        const kept = yield* Effect.sync(() => shell(bindings(JSON.stringify(good), good), route));
        const first = yield* kept.service;
        expect(first.port).toBe(port);

        for (let call = 1; call <= calls; call++) {
          expect(yield* kept.service).toBe(first);
        }

        expect(kept.builds(), "a good build is kept").toBe(1);
      }),
  );

  // Law 3 on the Process shell, the Layer the app binds, so a shell that builds its service any
  // other way fails here. Only the platform is fake, as in law A2: the object's state and storage,
  // the Project stub, the span sink and the runner under the service. The setting reaches the shell
  // through `input`, the app's checked read, and the law changes what that read sees between calls:
  // each run of the read is one build, and a read that turns good must be tried again.
  StartsTest.law(
    "law 3, the Process shell: any bad instance setting fails each call with its typed error; the Layer builds nothing, a read that turns good is tried again, and its build is kept",
    fc.record({
      damage,
      calls: fc.array(fc.constantFrom(...processCallNames), { minLength: 1, maxLength: 4 }),
      port: fc.integer({ min: 1, max: 65535 }),
    }),
    ({ damage: recipe, calls, port }) =>
      Effect.gen(function* () {
        const base = yield* StartsTest.input({
          port,
          start: "s2-start",
          build: "s2-build",
          revision: null,
          origin: "flag",
        });
        const good = {
          ...base,
          name: "p",
          founding: { person: "test-person", founder: "test-public-key", window: null },
        };
        let text = damaged(good, recipe);
        let reads = 0;
        const values = new Map<string, unknown>([["descriptor", descriptor]]);
        const storage = {
          get: (key: string) => Promise.resolve(values.get(key)),
          put: (key: string, value: unknown) => {
            values.set(key, value);
            return Promise.resolve();
          },
          delete: unexpected,
          setAlarm: unexpected,
          deleteAlarm: unexpected,
          sql: { exec: unexpected },
          transactionSync: unexpected,
        };
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            vi.spyOn(SpanSink, "layer").mockReturnValue(
              Layer.succeed(SpanSink, {
                batch: (work) => work,
                flush: Effect.succeed({ sent: 0 }),
                check: Effect.void,
                summaries: unexpected,
                sums: unexpected,
              }),
            ),
          ),
          (spy) => Effect.sync(() => spy.mockRestore()),
        );
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            vi.spyOn(ProgramRunner, "withLoader").mockImplementation(() =>
              Layer.succeed(
                ProgramRunner,
                ProgramRunner.of({
                  init: () => Effect.void,
                  msg: unexpected,
                  open: () => Effect.succeed({ rev: 0, view: {} }),
                  due: unexpected,
                  mailed: Effect.void,
                  restart: unexpected,
                }),
              ),
            ),
          ),
          (spy) => Effect.sync(() => spy.mockRestore()),
        );
        const project = new Proxy(
          {},
          { get: (_target, key) => (key === "settingsStart" ? async () => StartsTest.reply(good) : unexpected()) },
        );
        ProcessObject.layer({
          programs: {},
          // The app's checked read, as next/apps/fabrika/src/runtime.ts hands it in, of the law's text.
          input: () =>
            Effect.suspend(() => {
              reads++;
              return settings({ INSTANCE: text });
            }).pipe(Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause }))),
        });
        const constructor = fake<ProcessConstructor>(Option.getOrThrow(Option.fromUndefinedOr(made.value)));
        const state = fromDurableObjectState(
          fake<Parameters<typeof fromDurableObjectState>[0]>({
            id: { name: JSON.stringify([good.name, descriptor.name]) },
            storage,
            abort: unexpected,
          }),
        );
        const environment = fake<WorkerEnvironment["Service"]>({
          INSTANCE: text,
          PROJECT: { getByName: () => project },
          MEASUREMENTS: new Proxy({}, { get: unexpected }),
        });
        const context = fake<RuntimeContext["Service"]>({});

        // The Layer's outer Effect is the instance's construction: it may not fail, die or build.
        const object = yield* constructor.pipe(
          Effect.flatten,
          Effect.provideService(WorkerEnvironment, environment),
          Effect.provideService(ObjectState, state),
          Effect.provideService(RuntimeContext, context),
        );
        yield* Effect.yieldNow;
        expect(reads, "nothing is built before the first call").toBe(0);

        for (const [index, name] of calls.entries()) {
          // `flip` lets a defect through and fails on an answer, so a die or a fallback fails here.
          const call: Effect.Effect<unknown, LedgerError> = processCalls[name](object);
          const failure: unknown = yield* Effect.flip(call);
          // The Process contract fails with LedgerError only, and the decoder's failure can quote
          // the setting, so the call fails with the reason alone.
          expect(failure).toBeInstanceOf(LedgerError);
          expect(failure).toMatchObject({ reason: "bad_row" });
          expect(Reflect.get(Object(failure), "cause"), "the cause stays inside the object").toBeUndefined();
          expect(reads, "a failed build is not kept: the next call reads again").toBe(index + 1);
        }

        // The read turns good. The next call reads it, builds and reaches the service; later calls
        // reuse that build and read nothing more.
        text = JSON.stringify(good);

        for (const _call of calls) {
          expect(yield* object.open("law-3")).toStrictEqual({ rev: 0, view: {} });
        }

        expect(reads, "a good build is kept").toBe(calls.length + 1);
      }),
  );

  // Alchemy's bridge runs an object's request slot with `makeRequestEffect`
  // (@alchemy.run/cloudflare, Workers/DurableObjectBridge.ts, `fetch`), so this law runs it the
  // same way. A WebSocket upgrade answers with a Response that carries the socket, so a copy of
  // the Response loses the socket: the slot must answer the handler's own object.
  StartsTest.law(
    "the request slot gives the handler the platform's own Request and answers the handler's own Response; a failed handler answers 5xx without its text",
    fc.record({
      path: fc.webPath(),
      method: fc.constantFrom("GET", "POST", "DELETE"),
      status: fc.constantFrom(200, 204, 403, 426, 503),
      upgrade: fc.boolean(),
      reason: fc.constantFrom(...LedgerError.fields.reason.literals),
      text: fc.uuid(),
    }),
    ({ path, method, status, upgrade, reason, text }) =>
      Effect.gen(function* () {
        const url = `http://127.0.0.1:8787${path}`;
        const request = new Request(url, { method, headers: upgrade ? { upgrade: "websocket" } : {} });
        const response = new Response(status === 204 ? null : text, { status });
        const given: Array<Request> = [];
        const slot = ObjectService.fromWebHandler((seen) =>
          Effect.sync(() => {
            given.push(seen);
            return response;
          }),
        );
        // `makeRequestEffect` is typed `any` in its source (Workers/HttpServer.ts). It provides the
        // request itself, and the error-free `toHandled` answers a web Response, so these slots
        // need nothing and cannot fail.
        const run: Effect.Effect<Response, never, never> = makeRequestEffect(fake(request), slot);
        const answered: unknown = yield* run;
        expect(given).toHaveLength(1);
        expect(given[0], "the handler reads the platform's Request, not a rebuilt one").toBe(request);
        expect(answered, "the answer is the handler's Response, not a copy").toBe(response);

        const failing = ObjectService.fromWebHandler(() => Effect.fail(new LedgerError({ reason, message: text })));
        const refusing: Effect.Effect<Response, never, never> = makeRequestEffect(
          fake(new Request(url, { method })),
          failing,
        );
        const refused: Response = yield* refusing;
        expect(refused.status).toBeGreaterThanOrEqual(500);
        expect(yield* HttpClientResponse.fromWeb(HttpClientRequest.get(url), refused).text).not.toContain(text);
      }),
  );
});
