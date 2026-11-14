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
// build a new Request for the handler; copy the handler's Response.
import { makeRequestEffect } from "@alchemy.run/cloudflare/Workers/HttpServer";
import { describe, expect } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { HttpClientRequest, HttpClientResponse } from "effect/http";
import * as fc from "fast-check";
import { LedgerError } from "../ledger/Ledger.ts";
import { RecordedStart } from "../settings/RecordedStart.ts";
import { Failure } from "../settings/Start.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import * as ObjectService from "./ObjectService.ts";
import { recordedLayer, settings, type Env } from "./runtime.ts";

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
