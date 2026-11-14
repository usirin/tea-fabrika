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
      const service: Record<string, () => Effect.Effect<unknown, unknown>> = Reflect.get(
        clients(kind.make(text)),
        client,
      );
      const error = yield* Effect.flip(service[method]!());
      expect(error).toMatchObject({ _tag: "LedgerError", reason: "unreachable" });
      expect(Reflect.get(Object(error), "message")).toContain(kind.name);
      expect(Reflect.get(Object(error), "message")).toContain(text);
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
);

// Ticket 502 slice S2, next/. ProcessClient calls the object through Alchemy's typed stub inside
// `reach`: the object's own typed failure crosses as itself, and only a call that never got an
// answer is `unreachable`, with Alchemy's RpcCallError kept as its cause. The methods come from the
// client's own keys. Plants: map every failure to `unreachable`; build `unreachable` from the
// thrown value alone, so the RpcCallError is dropped.
const processMethods = Object.keys(ProcessClient.make(rejecting(new Error("probe"))));

/** A Process stub whose every method resolves with `answer`, as the object's bridge does. */
const answering = <A>(answer: unknown) => new Proxy({}, { get: () => async () => answer }) as A;

it.effect.prop(
  "a LedgerError the Process object fails with crosses ProcessClient as itself, never as unreachable by translation",
  {
    method: Schema.Literals(processMethods),
    reason: LedgerError.fields.reason,
    text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  },
  ({ method, reason, text }) =>
    Effect.gen(function* () {
      // The bridge answers a typed failure as data: Alchemy's error envelope around the encoded error.
      const envelope = { _tag: ErrorTag, error: encodeRpcError(new LedgerError({ reason, message: text })) };
      const call: () => Effect.Effect<unknown, unknown> = Reflect.get(ProcessClient.make(answering(envelope)), method);
      const error = yield* Effect.flip(call());
      expect(error).toBeInstanceOf(LedgerError);
      expect(error).toMatchObject({ reason, message: text });
      expect(Reflect.get(Object(error), "cause")).toBeUndefined();
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
);

it.effect.prop(
  "a Process call that never got an answer is unreachable, and its cause is the RpcCallError that holds the thrown error",
  {
    method: Schema.Literals(processMethods),
    name: Schema.Literals(faults.map((fault) => fault.name)),
    text: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(64)),
  },
  ({ method, name, text }) =>
    Effect.gen(function* () {
      const fault = faults.find((kind) => kind.name === name)!.make(text);
      const call: () => Effect.Effect<unknown, unknown> = Reflect.get(ProcessClient.make(rejecting(fault)), method);
      const error = yield* Effect.flip(call());
      expect(error).toMatchObject({ _tag: "LedgerError", reason: "unreachable" });
      const cause = Reflect.get(Object(error), "cause");
      expect(cause).toBeInstanceOf(RpcCallError);
      expect(cause).toMatchObject({ method });
      expect(Reflect.get(Object(cause), "cause")).toBe(fault);
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
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
