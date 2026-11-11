// P41 slice 2, next/. Exercise the public delivery layer at its RPC handles.
import { it, expect } from "@effect/vitest";
import { Arbitrary, Cause, Effect, Exit, Logger, Result, Schema, Tracer } from "effect";
import * as fc from "fast-check";
import { State } from "../processes/Process.ts";
import { type Delivery, ProgramMailError, type Receipt } from "../processes/ProgramMail.ts";
import { MailDelivery } from "../runtime/MailDelivery.ts";
import * as RepliesTest from "../runtime/RepliesTest.ts";
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

// Receipt has no Schema; fast-check generates its fields at the RPC boundary.
const ReceiptFields = fc.record({
  id: fc.uuid(),
  command: fc.uuid(),
  target: fc.uuid(),
  ref: fc.uuid(),
  value: fc.integer(),
  arrivedAt: fc.nat(),
  rev: fc.nat(),
  pos: fc.nat(),
});

for (const trace of [false, true]) {
  it.effect(trace ? "T1b: the wake carries the delivery trace" : "T1b [secrets]: RPC records hold no mail", () =>
    Effect.gen(function* () {
      const check = Effect.fnUntraced(function* (
        fields: typeof ReceiptFields extends fc.Arbitrary<infer A> ? A : never,
        choice: string,
        seed: number,
      ) {
        const secrets = yield* Arbitrary.sampleEffect(RepliesTest.sentinel, { seed, count: 1 });
        const secret = secrets[0]!;
        const receipt: Receipt = {
          id: fields.id,
          command: fields.command,
          source: delivery.source,
          to: {
            name: fields.target,
            state: State.cases.live.make({
              process: "process_01jc9q4w7zfm8s5r2t6v0xkb4d",
              code: { program: "responder", hash: "mail-test" },
            }),
          },
          m: { type: "request", ref: secret, value: fields.value },
          ref: fields.ref,
          grant: { source: delivery.source.name, to: fields.target },
          from: delivery.from,
          arrivedAt: fields.arrivedAt,
          rev: fields.rev,
          pos: fields.pos,
        };
        const spans: Array<Tracer.Span> = [];
        const captured = RepliesTest.capture();
        const outputs: Array<string> = [];
        const logger = Logger.layer([
          Logger.make((options) => {
            outputs.push(
              JSON.stringify(options.message),
              JSON.stringify([...options.annotations]),
              Cause.pretty(options.cause),
            );
          }),
        ]);
        const tracer = Tracer.make({
          span(options) {
            const span = captured.tracer.span(options);
            spans.push(span);
            return span;
          },
        });
        const wakes: Array<{ readonly traceId: string; readonly spanId: string } | undefined> = [];
        // oxlint-disable-next-line fabrika/no-type-assertions -- edge: fake RPC handles supply only the methods this layer calls
        const env = {
          PROJECT: {
            getByName: () => ({
              mail: async (_mail: unknown, ...args: ReadonlyArray<unknown>) => {
                outputs.push(JSON.stringify(args));

                if (choice === "transport" || choice === "storage") {
                  return Promise.reject(new Error("connection lost"));
                }

                if (choice === "undecodable") {
                  return { unexpected: receipt };
                }

                return choice === "ok" ? MailOk.make({ receipt }) : Refused.make({ reason: choice });
              },
            }),
          },
          PROCESS: {
            getByName: () => ({
              mailed: async (
                trace?: { readonly traceId: string; readonly spanId: string },
                ...args: ReadonlyArray<unknown>
              ) => {
                outputs.push(JSON.stringify([trace, ...args]));
                wakes.push(trace);
              },
            }),
          },
        } as unknown as Env;
        const exit = yield* MailDelivery.use((mail) =>
          mail.send({ ...delivery, command: receipt.command, to: receipt.to.name, m: receipt.m }),
        ).pipe(
          Effect.provide(mailLayer(env, "mail-test")),
          Effect.withTracer(tracer),
          Effect.provide(logger),
          Effect.exit,
        );

        if (Exit.isFailure(exit)) {
          outputs.push(
            String(Cause.squash(exit.cause)),
            JSON.stringify(Cause.squash(exit.cause)),
            Cause.pretty(exit.cause),
          );
        }

        RepliesTest.unleaked([...outputs, ...captured.text()], secrets);
        const sends = spans.filter((span) => span.name === "mail_delivery.send");
        expect(sends).toHaveLength(1);
        const sent = sends[0]!;
        expect(sent.status._tag).toBe("Ended");

        if (choice === "ok") {
          expect(Exit.isSuccess(exit)).toBe(true);

          if (Exit.isSuccess(exit)) {
            expect(exit.value.id).toBe(receipt.id);
          }

          if (trace) {
            expect(wakes).toEqual([{ traceId: sent.traceId, spanId: sent.spanId }]);
          }
        } else {
          expect(Exit.isFailure(exit)).toBe(true);
          expect(wakes).toEqual([]);
        }
      });
      const property = fc.asyncProperty(
        ReceiptFields,
        fc.oneof(Cases, fc.constant("ok")),
        fc.nat(),
        (fields, choice, seed) => Effect.runPromise(check(fields, choice, seed)),
      );
      yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 100 }));
    }),
  );
}

const MailOk = Schema.TaggedStruct("ok", { receipt: Schema.Any });
