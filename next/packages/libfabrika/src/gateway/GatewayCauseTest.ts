// T695, next/. The door's storage and its SYN-cookie keys keep the failure they translate (decision
// 0043 rule 12). A suite on any `Sql`, read through its module as `GatewayCauseTest.suite(law, harness)`;
// the module that owns the driver runs it, and gives the ledger's error class, which a gateway file
// may not import (0062).
//
// Audit sites: `GatewayStore.ts:27` (a throw in the atomic step), `GatewayStore.ts:40` (a saved
// state row that does not decode), `GatewayNonce.ts:26` (a saved key that does not decode, and one
// of the wrong length, which has no cause), `GatewayNonce.ts:29` (the one WebCrypto callback that
// importKey, sign and verify share).
import { describe, expect } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
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

/** The error the door's store fails with, named through its own calls. */
type StoreError = Effect.Error<ReturnType<ReturnType<typeof gatewayStore>["atomic"]>>;

/** What the module that owns the driver gives: fresh storage, and the stores' error class. */
export type Harness = {
  /** A fresh, empty database. */
  readonly fresh: () => Sql;
  /** The stores' own error class, which the laws find in a failure's chain. */
  readonly LedgerError: new (fields: { readonly reason: StoreError["reason"]; readonly cause?: unknown }) => StoreError;
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

/** An error and every cause under it, outermost first. */
const chain = (error: unknown): ReadonlyArray<unknown> => {
  const found: Array<unknown> = [];
  let at: unknown = error;

  while (typeof at === "object" && at !== null && !found.includes(at)) {
    found.push(at);
    at = "cause" in at ? at.cause : undefined;
  }

  return found;
};

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

export const suite = (law: Law, { fresh, LedgerError }: Harness) => {
  describe("T695, the door's store keeps what failed", () => {
    // C1, GatewayStore.ts:27. Plant: `catch: () => new LedgerError({ reason: "storage" })`.
    law(
      "C1: a generated throw in the atomic step is `storage` with that value as its cause",
      fc.record({ failure: failures, name: fc.string() }),
      ({ failure, name }) =>
        Effect.gen(function* () {
          const store = gatewayStore(throwing(fresh(), failure));
          const error = yield* Effect.flip(store.atomic(() => store.get(name, Schema.String)));
          expect(error.reason).toBe("storage");
          expect(error.cause).toBe(failure);
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
          expect(error).toBeInstanceOf(LedgerError);
          const links = chain(error);
          const row = links.find((link) => link instanceof LedgerError && link.reason === "bad_row");
          expect(row, "a bad_row LedgerError is in the chain").toBeInstanceOf(LedgerError);
          expect(Schema.isSchemaError((row as StoreError).cause), "it holds the decoder's own failure").toBe(true);
        }),
    );
  });

  describe("T695, the door's SYN-cookie key keeps what failed", () => {
    // C3, GatewayNonce.ts:26. Plant: drop the decode failure from the `storage` error.
    law(
      "C3: a saved key that is not base64url is `storage` carrying the decoder's failure",
      fc.record({ secret: fc.string().map((s) => `${s}!`) }),
      ({ secret }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());
          yield* store.atomic(() => store.set("challengeKey", Schema.String, secret));
          const error = yield* Effect.flip(gatewayNonce(store, TTL, CAP));
          expect(error.reason).toBe("storage");
          const decoded = Base64Url.decode(secret);
          expect(Result.isFailure(decoded)).toBe(true);
          expect(error.cause).toEqual(Result.isFailure(decoded) ? decoded.failure : null);
        }),
    );

    // C6, GatewayNonce.ts:26. Plant: make the cause field required.
    law(
      "C6: a saved key that decodes to the wrong length is `storage` with no cause",
      fc.record({ size: fc.integer({ min: 0, max: 64 }).filter((n) => n !== 32), seed: fc.integer() }),
      ({ size, seed }) =>
        Effect.gen(function* () {
          const store = gatewayStore(fresh());
          const key = Base64Url.encode(Uint8Array.from({ length: size }, (_, i) => (seed + i) & 255));
          yield* store.atomic(() => store.set("challengeKey", Schema.String, key));
          const error = yield* Effect.flip(gatewayNonce(store, TTL, CAP));
          expect(error.reason).toBe("storage");
          expect(error.cause).toBeUndefined();
        }),
    );

    // C5, GatewayNonce.ts:29: one shared callback for importKey, sign and verify. Plant: restore
    // the zero-argument `const fail = () => new LedgerError({ reason: "crypto" })`.
    law(
      "C5: a generated WebCrypto rejection on any call the nonce makes is `crypto` with that cause",
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
              expect(error.reason).toBe("crypto");
              expect(error.cause).toBe(failure);
              continue;
            }

            const nonce = yield* gatewayNonce(store, TTL, CAP);

            if (call === "sign") {
              const error = yield* Effect.flip(rejecting(call, failure, nonce.issue(client)));
              expect(error.reason).toBe("crypto");
              expect(error.cause).toBe(failure);
              continue;
            }

            // verify needs a nonce in the right shape and still in its window: issue one first.
            const issued = yield* nonce.issue(client);
            const error = yield* Effect.flip(rejecting(call, failure, nonce.check(client, issued)));
            expect(error.reason).toBe("crypto");
            expect(error.cause).toBe(failure);
          }
        }),
    );
  });
};
