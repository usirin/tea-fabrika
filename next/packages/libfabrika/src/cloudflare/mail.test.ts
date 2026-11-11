// P41 slice 2, next/. Exercise the public delivery layer at its RPC handles.
import { it, expect } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import * as fc from "fast-check";
import { type Delivery, ProgramMailError } from "../processes/ProgramMail.ts";
import { MailDelivery } from "../runtime/MailDelivery.ts";
import { mailLayer } from "./mail.ts";
import type { Env } from "./runtime.ts";

const Cases = fc.constantFrom(
  "no_name",
  "forbidden",
  "stale_sender",
  "bad_message",
  "id_reused",
  "storage",
  "transport",
  "undecodable",
);

const Refused = Schema.TaggedStruct("refused", { reason: Schema.String });

const delivery: Delivery = {
  command: "requester/1/0",
  source: { name: "requester:1", process: "requester" },
  to: "responder:1",
  m: { type: "request", ref: "r1", value: 7 },
  from: {
    by: "SHA256:fixture",
    for: "fixture",
    sentAt: "2026-11-11T00:00:00Z",
    seen: 0,
    parent: null,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    build: "mail-test",
  },
};

it.effect("R1: RPC refusals keep their reason; failed transport and undecodable replies remain retryable", () =>
  Effect.gen(function* () {
    const check = Effect.fnUntraced(function* (choice: typeof Cases extends fc.Arbitrary<infer A> ? A : never) {
      let wakes = 0;
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: fake RPC handles supply only the methods this layer calls
      const env = {
        PROJECT: {
          getByName: () => ({
            mail: async () => {
              if (choice === "storage") {
                return Promise.reject(new ProgramMailError({ reason: "storage" }));
              }

              if (choice === "transport") {
                return Promise.reject(new Error("connection lost"));
              }

              return choice === "undecodable" ? { unexpected: true } : Refused.make({ reason: choice });
            },
          }),
        },
        PROCESS: {
          getByName: () => ({
            mailed: async () => {
              wakes++;
            },
          }),
        },
      } as unknown as Env;
      const result = yield* MailDelivery.use((mail) => mail.send(delivery)).pipe(
        Effect.provide(mailLayer(env, "mail-test")),
        Effect.result,
      );
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe(
          ["storage", "transport", "undecodable"].includes(choice) ? "storage" : choice,
        );
      }

      expect(wakes, "no refused or unconfirmed delivery schedules a target").toBe(0);
    });
    const property = fc.asyncProperty(Cases, (choice) => Effect.runPromise(check(choice)));
    yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 100 }));
  }),
);
