// P36, next/: generated flows inspect every output, including the email notice.
import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import {
  EFFECT,
  PURE,
  OUTPUTS,
  SecretFlow,
  address,
  assertSecret,
  assertPrivate,
  captures,
  code,
  encodings,
  fullFlow,
  harness,
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
    `P36.${name === "code" ? "19" : name === "address" ? "20" : "21"} [secrets] ${name} stays out of every named output`,
    { flow: SecretFlow },
    ({ flow }) =>
      Effect.gen(function* () {
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
        for (const secret of secrets) assertSecret(h.out, secret, outputs);
        assertPrivate(h.out, h.key.raw);
        // The key's public half is legitimate and must be available to clients.
        if (name === "brain private key") expect(JSON.stringify(h.out.ledger)).toContain(h.key.line);
      }),
    EFFECT,
  );

  // One plant for EVERY named output, with all five encodings exercised in each flow. Only the
  // captured sink is replaced. The service, storage and complete flow still run unmodified.
  for (const output of outputs)
    it.effect.prop(
      `plant: [secrets] ${name} in ${output}`,
      { flow: SecretFlow },
      ({ flow }) =>
        Effect.gen(function* () {
          const h = yield* harness(flow);
          yield* fullFlow(h).pipe(Effect.withTracer(h.tracer), Effect.withLogger(h.logger));
          const secret =
            name === "code"
              ? Redacted.value(h.mails[0]!.code)
              : name === "address"
                ? address(flow)
                : Buffer.from(h.key.raw).toString("base64");
          for (const encoded of encodings(secret)) {
            h.out[output].push({ testLeak: encoded });
            expect(() => assertSecret(h.out, secret, [output])).toThrow();
            h.out[output].pop();
          }
        }),
      EFFECT,
    );
}

// These output-dependency plants can run before P36 exists. They prove the search itself sees
// every sink and encoding. The full-flow plants above remain required and red until P36 lands.
for (const output of OUTPUTS)
  it.prop(
    `plant: [secrets] captured ${output} detects text and raw private bytes`,
    { flow: SecretFlow },
    ({ flow }) => {
      for (const secret of [code(flow), address(flow), Buffer.from(flow.seed).toString("base64")]) {
        for (const encoded of encodings(secret)) {
          const out = captures();
          out[output].push({ leaked: encoded });
          expect(() => assertSecret(out, secret, [output])).toThrow();
        }
      }
      for (const bytes of [flow.seed, Uint8Array.from(flow.seed)]) {
        const out = captures();
        out[output].push({ leaked: bytes });
        expect(() => assertPrivate(out, flow.seed)).toThrow();
      }
      const numeric = captures();
      numeric[output].push({ count: Number(code(flow)) });
      assertSecret(numeric, code(flow), [output]);
    },
    PURE,
  );
