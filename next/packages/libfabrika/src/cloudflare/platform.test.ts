// Ticket 646, next/. Every client in platform.ts turns a rejected platform call into a LedgerError
// that keeps the thrown error's name and text in `message` (0043 rule 12: the cause is kept; P37 keeps
// failure text out of tags). The methods come from each client's own keys, so a new method joins the
// law without an edit here. Plant: `catch: unreachable` that ignores its argument, as before this ticket.
import { it } from "@effect/vitest";
import { encodeRpcError, ErrorTag, RpcCallError } from "alchemy/Rpc";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { expect } from "vitest";
import { LedgerError } from "../ledger/Ledger.ts";
import * as RepliesTest from "../runtime/RepliesTest.ts";
import { BucketClient, GatewayClient, ProcessClient, ProjectClient, StorageClient, rejected } from "./platform.ts";

class WireFault extends Error {
  override name = "WireFault";
}

const faults = [
  { name: "Error", make: (message: string): Error => new Error(message) },
  { name: "TypeError", make: (message: string): Error => new TypeError(message) },
  { name: "WireFault", make: (message: string): Error => new WireFault(message) },
] as const;

/** A platform stub whose every method rejects with `fault`, standing in for a binding, storage or
 *  bucket; a method `own` holds answers as `own` says. */
const rejecting = <A>(fault: unknown, own: object = {}) =>
  new Proxy(own, {
    get: (target, key) =>
      Reflect.has(target, key)
        ? Reflect.get(target, key)
        : async () => {
            throw fault;
          },
  }) as A;

const clients = (fault: Error) => ({
  Project: ProjectClient.make(rejecting(fault)),
  Process: ProcessClient.make(rejecting(fault)),
  Gateway: GatewayClient.make(rejecting(fault)),
  Storage: StorageClient.make(rejecting(fault)),
  Bucket: BucketClient.make(rejecting(fault)),
});

const methods = Object.entries(clients(new Error("probe"))).flatMap(([client, service]) =>
  Object.keys(service).map((method) => `${client}.${method}`),
);

it.effect.prop(
  "a rejected platform call fails with LedgerError unreachable, carrying the thrown error's name and text",
  {
    call: Schema.Literals(methods),
    name: Schema.Literals(faults.map((fault) => fault.name)),
    text: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(64)),
  },
  ({ call, name, text }) =>
    Effect.gen(function* () {
      const [client = "", method = ""] = call.split(".");
      const kind = faults.find((fault) => fault.name === name)!;
      const service: Record<string, (request: Request) => Effect.Effect<unknown, unknown>> = Reflect.get(
        clients(kind.make(text)),
        client,
      );
      // A real Request, so a client that hands `fetch` to a typed stub has one to read; the
      // rejecting stub ignores what every other method is given.
      const error = yield* Effect.flip(service[method]!(new Request("http://127.0.0.1:8787/client/a/b")));
      expect(error).toMatchObject({ _tag: "LedgerError", reason: "unreachable" });
      expect(Reflect.get(Object(error), "message")).toContain(kind.name);
      expect(Reflect.get(Object(error), "message")).toContain(text);
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
);

// T502 S1, next/. The Connection object is called through Alchemy's typed stub and `reach`
// (docs/plan/ticket-502-alchemy-port.md, "One value traced through", after S1). The methods come
// from the client's own keys. `fetch` is left out: a typed stub serves it through its fetcher, not
// as a call (@alchemy.run/cloudflare, Workers/Rpc.ts `makeRpcStub` and Fetcher.ts), and the law
// above and error-cause.test.ts hold it.
// Plants: no `errors: [LedgerError]` on the stub; map every failure to `unreachable`; keep the
// thrown value and drop the RpcCallError.
const calls = Object.keys(GatewayClient.make(rejecting(new Error("probe")))).filter((method) => method !== "fetch");

/** A Connection stub whose every call resolves with `answer`, as the object's bridge answers. */
const answering = <A>(answer: unknown) =>
  new Proxy(
    {},
    {
      get: () => () => Promise.resolve(answer),
    },
  ) as A;

it.effect("vector: the Connection client has calls for this law to walk", () =>
  // A floor, so a client that loses its methods cannot shrink the law below to nothing.
  Effect.sync(() => expect(calls.length).toBeGreaterThanOrEqual(3)),
);

it.effect.prop(
  "a LedgerError the Connection object failed with crosses as itself; a lost object is unreachable with the RpcCallError as its cause",
  {
    call: Schema.Literals(calls),
    reason: LedgerError.fields.reason,
    name: Schema.Literals(faults.map((fault) => fault.name)),
    text: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(64)),
  },
  ({ call, reason, name, text }) =>
    Effect.gen(function* () {
      const method = (stub: Parameters<typeof GatewayClient.make>[0]): Effect.Effect<unknown, unknown> =>
        Reflect.apply(Reflect.get(GatewayClient.make(stub), call), undefined, []);

      // The bridge answers a typed failure as this envelope (alchemy, Rpc.ts `encodeRpcError`).
      const typed = yield* Effect.flip(
        method(answering({ _tag: ErrorTag, error: encodeRpcError(new LedgerError({ reason })) })),
      );
      expect(typed).toBeInstanceOf(LedgerError);
      expect(typed).toMatchObject({ reason });
      expect(Reflect.get(Object(typed), "cause"), "nothing was lost on the way, so no cause").toBeUndefined();

      const fault = faults.find((kind) => kind.name === name)!.make(text);
      const lost = yield* Effect.flip(method(rejecting(fault)));
      expect(lost).toBeInstanceOf(LedgerError);
      expect(lost).toMatchObject({ reason: "unreachable" });
      const cause: unknown = Reflect.get(Object(lost), "cause");
      expect(cause).toBeInstanceOf(RpcCallError);
      expect(cause).toMatchObject({ method: call });
      expect(Reflect.get(Object(cause), "cause"), "the RpcCallError keeps what the platform threw").toBe(fault);
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

// T502 S1, next/. A request into the Connection object goes through Alchemy's typed stub too, as
// docs/direction/no-promises.md says of every call to `Connection`: the stub's own `fetch` is Alchemy's
// fetcher (@alchemy.run/cloudflare, Workers/Rpc.ts `makeRpcStub`, Fetcher.ts `fromCloudflareFetcher`).
// It hands the object the caller's request with an abort signal that the caller's interruption fires,
// and gives the object's answer back as the platform's Response; a socket upgrade (status 101) comes
// back as the very Response the object answered. A rejected request is the first law in this file.
// Plants: call the platform `fetch` straight, as the reviewed head did; rebuild the answer without its
// body, which rebuilds a 101 too.
const requestHeaders = ["x-fabrika", "sec-websocket-key", "sec-websocket-protocol", "content-type"] as const;

/** A 101 answer as workerd gives one for a socket upgrade. Node refuses to build a Response with that
 *  status, so the status alone is set on a real Response. */
const upgraded = (): Response => Object.defineProperty(new Response(null), "status", { value: 101 });

/** Text a URL, a header and a UTF-8 body can carry unchanged: no lone surrogate. */
const Text = Schema.String.check(Schema.makeFilter((text) => !/\p{Surrogate}/u.test(text)));

it.effect.prop(
  "a request into the Connection object is the typed stub's fetch: the object gets it with an abort signal, and its answer comes back as a Response",
  {
    method: Schema.Literals(["GET", "POST", "PUT", "DELETE"]),
    path: Text,
    header: Schema.Literals(requestHeaders),
    value: Text,
    body: Text,
    status: Schema.Literals([200, 201, 202, 400, 403, 404, 426, 500, 503]),
    text: Text,
    upgrade: Schema.Boolean,
  },
  ({ method, path, header, value, body, status, text, upgrade }) =>
    Effect.gen(function* () {
      const ask = () =>
        new Request(`http://127.0.0.1:8787/client/${encodeURIComponent(path)}`, {
          method,
          headers: { [header]: encodeURIComponent(value) },
          ...(method === "GET" ? {} : { body }),
        });
      const request = ask();
      const answered = upgrade
        ? upgraded()
        : new Response(text, { status, headers: { "x-answer": encodeURIComponent(text) } });
      const received: Array<{ request: Request; signal: unknown }> = [];
      const answering = {
        fetch: async (input: Request, init?: RequestInit) => {
          received.push({ request: input, signal: init?.signal });
          return answered;
        },
      };

      const answer = yield* GatewayClient.make(rejecting(new Error("only fetch is called"), answering)).fetch(request);

      expect(received).toHaveLength(1);
      const into = received[0]!;
      expect(into.request.method).toBe(method);
      expect(into.request.url).toBe(request.url);
      expect([...into.request.headers]).toEqual([...request.headers]);
      expect(yield* Effect.promise(() => into.request.text())).toBe(method === "GET" ? "" : body);
      expect(into.signal, "Alchemy's fetcher hands the object an abort signal").toBeInstanceOf(AbortSignal);

      if (upgrade) {
        expect(answer, "a socket upgrade comes back as the object's own Response").toBe(answered);
      } else {
        expect(answer).toBeInstanceOf(Response);
        expect(answer.status).toBe(status);
        expect(answer.headers.get("x-answer")).toBe(encodeURIComponent(text));
        expect(yield* Effect.promise(() => answer.text())).toBe(text);
      }

      // The caller stops waiting: the request into the object is aborted, not left running.
      const reached = yield* Deferred.make<AbortSignal | undefined>();
      const waiting = {
        fetch: (_: Request, init?: RequestInit) => {
          Deferred.doneUnsafe(reached, Effect.succeed(init?.signal ?? undefined));
          return new Promise<Response>(() => {});
        },
      };
      const pending = yield* Effect.forkChild(
        GatewayClient.make(rejecting(new Error("only fetch is called"), waiting)).fetch(ask()),
      );
      const signal = yield* Deferred.await(reached);
      yield* Fiber.interrupt(pending);
      expect(signal?.aborted, "the caller's interruption aborts the request into the object").toBe(true);
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

// T502 S1 [secrets], next/. What the platform throws on a call through `reach` can hold a letter's
// text (for `notify`, the `news`), and `lost` puts it in the LedgerError's message. No span the call
// makes may keep it, in its name, attributes, events or failed exit (docs/plan/ticket-502-alchemy-port.md,
// the `reach.ts` and `platform.test.ts` rows). The thrown value is each fault class above, bare text,
// or an object holding the text. Plants: `Effect.fn` back on `reach`; a span named with the message.
const letter = (call: string, secret: string): ReadonlyArray<unknown> =>
  call === "notify" ? ["client-1", { news: secret }] : call === "ring" ? ["stream-1", 1] : ["session-1"];

it.effect.prop(
  "[secrets] a Connection call the platform rejects with a letter's text makes no span that keeps it",
  {
    call: Schema.Literals(calls),
    secret: RepliesTest.sentinel,
    name: Schema.Literals([...faults.map((fault) => fault.name), "text", "object"]),
  },
  ({ call, secret, name }) =>
    Effect.gen(function* () {
      const fault = faults.find((kind) => kind.name === name);
      const thrown: unknown =
        fault !== undefined ? fault.make(secret) : name === "text" ? secret : { message: secret, news: secret };
      const captured = RepliesTest.capture();
      const method = (stub: Parameters<typeof GatewayClient.make>[0]): Effect.Effect<unknown, unknown> =>
        Reflect.apply(Reflect.get(GatewayClient.make(stub), call), undefined, letter(call, secret));
      const failure = yield* Effect.flip(method(rejecting(thrown))).pipe(Effect.withTracer(captured.tracer));

      // The text did go through: the caller gets the lost call, with what the platform threw inside.
      expect(failure).toMatchObject({ _tag: "LedgerError", reason: "unreachable" });
      expect(Reflect.get(Object(Reflect.get(Object(failure), "cause")), "cause")).toBe(thrown);
      RepliesTest.unleaked(captured.text(), [secret]);
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

// `rejected` turns that message back into the thrown class for a failed span. Plants: rebuild every
// error, rebuild a message with no `<class>: `, or keep the `<class>: ` prefix in the rebuilt text.
it.effect.prop(
  "rejected rebuilds an unreachable LedgerError's `<class>: <text>` as an error of that class and text",
  {
    name: Schema.Literals(["", "Error", "TypeError", "WireFault", "string", "object"]),
    text: Schema.String,
  },
  ({ name, text }) =>
    Effect.sync(() => {
      const thrown = rejected(new LedgerError({ reason: "unreachable", message: `${name}: ${text}` }));
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(LedgerError);
      expect(Reflect.get(Object(thrown), "name")).toBe(name);
      expect(Reflect.get(Object(thrown), "message")).toBe(text);
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
);

it.effect.prop(
  "rejected keeps any other error as it is",
  {
    reason: Schema.Literals(["bad_row", "storage", "refused", "crypto"]),
    text: Schema.String.check(Schema.isMinLength(1)),
  },
  ({ reason, text }) =>
    Effect.sync(() => {
      const others = [
        new LedgerError({ reason, message: `Error: ${text}` }),
        new LedgerError({ reason }),
        new LedgerError({ reason: "unreachable" }),
        new LedgerError({ reason: "unreachable", message: text.replaceAll(": ", "") }),
        new Error(`Error: ${text}`),
      ];

      for (const error of others) {
        expect(rejected(error)).toBe(error);
      }
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
);
