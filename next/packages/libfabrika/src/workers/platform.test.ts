// Ticket 646, next/. Every client in platform.ts turns a rejected platform call into a LedgerError
// that keeps the thrown error's name and text in `message` (0043 rule 12: the cause is kept; P37 keeps
// failure text out of tags). The methods come from each client's own keys, so a new method joins the
// law without an edit here. Plant: `catch: unreachable` that ignores its argument, as before this ticket.
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { BucketClient, GatewayClient, ProcessClient, ProjectClient, StorageClient } from "./platform.ts";

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
  { fastCheck: { numRuns: 200, seed: 119120 } },
);
