// P36, next/: generated flows inspect every output, including the email notice.
import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import {
  EFFECT,
  OUTPUTS,
  SecretFlow,
  address,
  assertSecret,
  assertPrivate,
  fullFlow,
  harness,
  started,
  type Output,
} from "./Email.test-support.ts";

const addressOutputs: ReadonlyArray<Output> = [
  "ledger",
  "signed",
  "urls",
  "notices",
  "logs",
  "spans",
  "errors",
  "replies",
  "frames",
  "models",
  "health",
];

const publicOutputs: ReadonlyArray<Output> = OUTPUTS;

for (const [name, outputs] of [
  ["code", OUTPUTS],
  ["address", addressOutputs],
  ["brain private key", publicOutputs],
] as const) {
  it.effect.prop(
    `not built: P36 / P36.${name === "code" ? "19" : name === "address" ? "20" : "21"} [secrets] ${name} stays out of every named output`,
    { flow: SecretFlow },
    ({ flow }, ctx) =>
      Effect.gen(function* () {
        started(ctx);
        const h = yield* harness(flow);
        expect.hasAssertions();
        yield* fullFlow(h).pipe(Effect.withTracer(h.tracer), Effect.withLogger(h.logger));
        expect(h.out.notices.length).toBeGreaterThan(0);
        const secrets =
          name === "code"
            ? h.mails.map((mail) => Redacted.value(mail.code))
            : name === "address"
              ? [address(flow)]
              : [
                  Buffer.from(h.key.raw).toString("hex"),
                  Buffer.from(h.key.raw).toString("base64"),
                  Buffer.from(h.key.raw).toString("base64url"),
                ];

        for (const secret of secrets) {
          assertSecret(h.out, secret, outputs);
        }

        assertPrivate(h.out, h.key.raw);

        // The key's public half is legitimate and must be available to clients.
        if (name === "brain private key") {
          expect(JSON.stringify(h.out.ledger)).toContain(h.key.line);
        }
      }),
    EFFECT,
  );
}
