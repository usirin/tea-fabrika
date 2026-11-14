// T695, next/. The door's storage and its SYN-cookie keys keep the failure they translate (decision
// 0043 rule 12). A suite on any `Sql`, read through its module as `GatewayCauseTest.suite(law, harness)`;
// the module that owns the driver runs it (0062).
//
// Ticket 921 slice 1: both files fail with `GatewayError`, the error of the service they serve
// (0055), and its tagged reason keeps the fault from below (0119). This is the plan's law 8 for the
// two files: every plant below builds the error without its `cause`. The laws read the error by
// its `_tag`, so the harness hands in no error class.
//
// Audit sites: `GatewayStore.ts:27` (a throw in the atomic step), `GatewayStore.ts:40` (a saved
// state row that does not decode), `GatewayNonce.ts:26` (a saved key that does not decode, and one
// of the wrong length, which has no cause), `GatewayNonce.ts:29` (the one WebCrypto callback that
// importKey, sign and verify share).
import { describe, expect } from "@effect/vitest";
import { Effect, Predicate, Result, Schema } from "effect";
import { Base64Url } from "effect/encoding";
import * as fc from "fast-check";
import type { Sql } from "../Sql.ts";
import { gatewayNonce } from "./GatewayNonce.ts";
import { gatewayStore } from "./GatewayStore.ts";

/** A failure as a platform gives one: an Error, a subclass with its own cause, or a plain object. */
const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new TypeError(message, { cause: { detail: message } })),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

/** What the module that owns the driver gives: fresh storage. */
export type Harness = {
  /** A fresh, empty database. */
  readonly fresh: () => Sql;
};

/** Runs one property: generated input, each case an Effect on the real code. The runner gives it. */
export type Law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown>) => void;

/** The same `Sql`, but each transaction throws `failure`, as SQLite does on a full disk. */
const throwing = (sql: Sql, failure: unknown): Sql => ({
  ...sql,
  transaction: () => {
    throw failure;
  },
});

/** What an error keeps beneath it: the cause under its tagged reason (0119), or its own. */
const beneath = (error: unknown): unknown => {
  if (Predicate.hasProperty(error, "reason") && Predicate.hasProperty(error.reason, "cause")) {
    return error.reason.cause;
  }

  return Predicate.hasProperty(error, "cause") ? error.cause : undefined;
};

/** An error and every cause under it, outermost first. */
const chain = (error: unknown): ReadonlyArray<unknown> => {
  const found: Array<unknown> = [];
  let at: unknown = error;

  while (typeof at === "object" && at !== null && !found.includes(at)) {
    found.push(at);
    at = beneath(at);
  }

  return found;
};

/** Whether `link` is the door's own error for a saved row that does not decode. */
const isBadRow = (link: unknown): boolean =>
  Predicate.hasProperty(link, "_tag") &&
  link._tag === "GatewayError" &&
  Predicate.hasProperty(link, "reason") &&
  Predicate.hasProperty(link.reason, "_tag") &&
  link.reason._tag === "BadRow";

/** One WebCrypto call rejects with `failure` while `work` runs: an own property shadows the method. */
const rejecting = <A, E>(method: "importKey" | "sign" | "verify", failure: unknown, work: Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      Object.defineProperty(crypto.subtle, method, {
        configurable: true,
        // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto answers with a Promise
        value: () => Promise.reject(failure),
      });
    }),
    () => work,
    () =>
      Effect.sync(() => {
        Reflect.deleteProperty(crypto.subtle, method);
      }),
  );

const TTL = 60_000;
const CAP = 100;

export const suite = (law: Law, { fresh }: Harness) => {
  describe("T695, the door's store keeps what failed", () => {
    // C1, GatewayStore.ts:27. Plant: build the `Storage` reason without the caught value.
    law(
      "C1: a generated throw in the atomic step is the door's own `Storage` with that value as its cause",
      fc.record({ failure: failures, name: fc.string() }),
      ({ failure, name }) =>
        Effect.gen(function* () {
          const store = gatewayStore(throwing(fresh(), failure));
          const error = yield* Effect.flip(store.atomic(() => store.get(name, Schema.String)));
          expect(error._tag).toBe("GatewayError");
          expect(error.reason._tag).toBe("Storage");
          expect(error.reason.cause).toBe(failure);
        }),
    );

    // C2 and C3, GatewayStore.ts:40 inside :27. Plant: replace the inner cause with its message.
    law(
      "C2: a damaged saved row keeps the chain down to the decoder's SchemaError",
      fc.record({ name: fc.string(), value: fc.string(), bad: fc.oneof(fc.integer(), fc.boolean()) }),
      ({ name, value, bad }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());
          yield* store.atomic(() => store.set(name, Schema.String, value));
          store.sql.exec("UPDATE gateway_state SET value=? WHERE name=?", JSON.stringify(bad), name);
          const error = yield* Effect.flip(store.atomic(() => store.get(name, Schema.String)));
          expect(error._tag).toBe("GatewayError");
          const row = chain(error).find(isBadRow);
          expect(row, "a `BadRow` GatewayError is in the chain").toBeDefined();
          expect(Schema.isSchemaError(beneath(row)), "it holds the decoder's own failure").toBe(true);
        }),
    );
  });

  describe("T695, the door's SYN-cookie key keeps what failed", () => {
    // C3, GatewayNonce.ts:26. Plant: drop the decode failure from the `storage` error.
    law(
      "C3: a saved key that is not base64url is the door's own `Storage` carrying the decoder's failure",
      fc.record({ secret: fc.string().map((s) => `${s}!`) }),
      ({ secret }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());
          yield* store.atomic(() => store.set("challengeKey", Schema.String, secret));
          const error = yield* Effect.flip(gatewayNonce(store, TTL, CAP));
          expect(error._tag).toBe("GatewayError");
          expect(error.reason._tag).toBe("Storage");
          const decoded = Base64Url.decode(secret);
          expect(Result.isFailure(decoded)).toBe(true);
          expect(error.reason.cause).toEqual(Result.isFailure(decoded) ? decoded.failure : null);
        }),
    );

    // C6, GatewayNonce.ts:26. Plant: put a made-up cause on the reason.
    law(
      "C6: a saved key that decodes to the wrong length is the door's own `Storage` with no cause",
      fc.record({ size: fc.integer({ min: 0, max: 64 }).filter((n) => n !== 32), seed: fc.integer() }),
      ({ size, seed }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());
          const key = Base64Url.encode(Uint8Array.from({ length: size }, (_, i) => (seed + i) & 255));
          yield* store.atomic(() => store.set("challengeKey", Schema.String, key));
          const error = yield* Effect.flip(gatewayNonce(store, TTL, CAP));
          expect(error._tag).toBe("GatewayError");
          expect(error.reason._tag).toBe("Storage");
          expect(error.reason.cause).toBeUndefined();
        }),
    );

    // C5, GatewayNonce.ts:29: one shared callback for importKey, sign and verify. Plant: make it
    // zero-argument, so the `Crypto` reason is built without the rejection.
    law(
      "C5: a generated WebCrypto rejection on any call the nonce makes is the door's own `Crypto` with that cause",
      fc.record({
        steps: fc.array(fc.record({ call: fc.constantFrom("importKey", "sign", "verify"), failure: failures }), {
          minLength: 1,
          maxLength: 4,
        }),
        client: fc.string(),
      }),
      ({ steps, client }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());

          for (const { call, failure } of steps) {
            if (call === "importKey") {
              const error = yield* Effect.flip(rejecting(call, failure, gatewayNonce(store, TTL, CAP)));
              expect(error._tag).toBe("GatewayError");
              expect(error.reason._tag).toBe("Crypto");
              expect(error.reason.cause).toBe(failure);
              continue;
            }

            const nonce = yield* gatewayNonce(store, TTL, CAP);

            if (call === "sign") {
              const error = yield* Effect.flip(rejecting(call, failure, nonce.issue(client)));
              expect(error._tag).toBe("GatewayError");
              expect(error.reason._tag).toBe("Crypto");
              expect(error.reason.cause).toBe(failure);
              continue;
            }

            // verify needs a nonce in the right shape and still in its window: issue one first.
            const issued = yield* nonce.issue(client);
            const error = yield* Effect.flip(rejecting(call, failure, nonce.check(client, issued)));
            expect(error._tag).toBe("GatewayError");
            expect(error.reason._tag).toBe("Crypto");
            expect(error.reason.cause).toBe(failure);
          }
        }),
    );
  });
};
