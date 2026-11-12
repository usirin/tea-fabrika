// P36, next/: EmailSender receives a binding as data. It cannot choose live mail from env.
import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import {
  EFFECT,
  flows,
  address,
  code,
  EPOCH,
  pureLaw,
  pureModule,
  type EmailSender,
} from "../email/Email.test-support.ts";

interface WorkerEmail {
  readonly emailSender: (binding: { readonly send: (message: unknown) => Effect.Effect<void, unknown> }) => EmailSender;
}

const loadWorker: () => Promise<WorkerEmail> = () => import("./EmailSender.ts");

const worker = pureModule(loadWorker);

pureLaw("P36.22 Worker sender uses only its injected binding and returns fixed send errors", flows, worker, (_flow) => {
  // The synchronous constructor must not read an environment credential or send anything.
  const sent: unknown[] = [];
  const sender = worker().emailSender({
    send: (message: unknown) =>
      Effect.sync(() => {
        sent.push(message);
      }),
  });
  expect(sent).toEqual([]);
  expect(sender.send).toBeTypeOf("function");

  expect(sent).toEqual([]);
});

it.effect.prop(
  "P36.22 Worker binding accepts typed mail and refuses a failed send safely",
  { flow: flows },
  ({ flow }) =>
    Effect.gen(function* () {
      const module = yield* Effect.promise(loadWorker);
      const sent: unknown[] = [];
      const sender = module.emailSender({
        send: (message: unknown) =>
          Effect.sync(() => {
            sent.push(message);
          }),
      });
      yield* sender.send({
        to: Redacted.make(address(flow)),
        code: Redacted.make(code(flow)),
        purpose: "recovery",
        device: flow.label,
        at: EPOCH,
      });
      expect(sent).toHaveLength(1);
      const failed = module.emailSender({
        send: () => Effect.fail({ message: `${address(flow)} ${code(flow)} ${flow.failureText}` }),
      });
      const result = yield* Effect.exit(
        failed.send({
          to: Redacted.make(address(flow)),
          code: Redacted.make(code(flow)),
          purpose: "recovery",
          device: flow.label,
          at: EPOCH,
        }),
      );
      expect(result._tag).toBe("Failure");
      expect(JSON.stringify(result)).not.toContain(address(flow));
    }),
  EFFECT,
);
