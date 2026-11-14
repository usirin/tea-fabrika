// Ticket 646, next/. Every client in platform.ts turns a rejected platform call into a LedgerError
// that keeps the thrown error's name and text in `message` (0043 rule 12: the cause is kept; P37 keeps
// failure text out of tags). The methods come from each client's own keys, so a new method joins the
// law without an edit here. Plant: `catch: unreachable` that ignores its argument, as before this ticket.
import { it } from "@effect/vitest";
import { encodeRpcError, ErrorTag, RpcCallError } from "alchemy/Rpc";
import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { LedgerError } from "../ledger/Ledger.ts";
import { BucketClient, GatewayClient, ProcessClient, ProjectClient, StorageClient, rejected } from "./platform.ts";

class WireFault extends Error {
  override name = "WireFault";
}

const faults = [
  { name: "Error", make: (message: string): Error => new Error(message) },
  { name: "TypeError", make: (message: string): Error => new TypeError(message) },
  { name: "WireFault", make: (message: string): Error => new WireFault(message) },
] as const;

/** A platform stub whose every method rejects with `fault`, standing in for a binding, storage or bucket. */
const rejecting = <A>(fault: Error) =>
  new Proxy(
    {},
    {
      get: () => async () => {
        throw fault;
      },
    },
  ) as A;

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
