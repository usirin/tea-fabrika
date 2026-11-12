// P36, next/: Challenge persistence is tested through the real store and service, including reopen.
import { acceptedTypes, applyCell } from "@demlik/tea";
import { expect, it } from "@effect/vitest";
import { Effect, Redacted, Result, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";
import {
  EPOCH,
  EFFECT,
  RetryFlow,
  TEN_MINUTES,
  address,
  binding,
  code,
  wrong,
  added,
  signed,
  setup,
  recover,
  effectLaw,
  expectRefused,
  tags,
  pureModule,
  harness,
  type Harness,
} from "./Email.test-support.ts";

const module = pureModule(() => import("./Challenge.ts"));

// Plants after build: reset a saved try count; reopen used/ended as open; discard a pending add.
it.effect.prop(
  "P36.02 P36.03 P36.13 every saved Challenge state survives JSON and init without resetting",
  { flow: RetryFlow },
  ({ flow }) =>
    Effect.gen(function* () {
      const h = yield* harness(flow);
      const machine = module().challenge;
      const reached: Array<typeof machine.model.Type> = [];
      const capture = Effect.gen(function* () {
        const states: Array<typeof machine.model.Type> = [];
        const visit = (value: unknown): void => {
          const decoded = Schema.decodeUnknownResult(machine.model)(value);

          if (Result.isSuccess(decoded)) {
            states.push(decoded.success);
          } else if (Array.isArray(value)) {
            value.forEach(visit);
          } else if (value !== null && typeof value === "object") {
            Object.values(value).forEach(visit);
          }
        };
        visit(yield* h.dependencies.store.snapshot);
        expect(states.length, "the real store exposes its saved Challenge rows").toBeGreaterThan(0);
        reached.push(...states);
      });
      yield* setup(h);
      yield* capture;

      for (let n = 0; n < flow.requests; n++) {
        let challenge = yield* h.recovery.issueRecovery(binding());
        let value = Redacted.value(h.mails.at(-1)!.code);
        yield* capture;

        for (let attempt = 0; attempt < flow.attempts; attempt++) {
          yield* Effect.exit(
            h.recovery.redeem(challenge.id, Redacted.make(wrong(value)), added(flow), signed(binding().person)),
          );
          yield* capture;
        }

        for (const operation of flow.ops) {
          if (operation === "issue" || operation === "replace") {
            challenge = yield* h.recovery.issueRecovery(binding());
            value = Redacted.value(h.mails.at(-1)!.code);
          } else if (operation === "reopen") {
            yield* h.reopen;
            yield* TestClock.setTime(EPOCH + flow.time);
          } else {
            if (operation === "refuse") {
              h.fixture.fail("append", flow.failureText);
            }

            yield* Effect.exit(
              h.recovery.redeem(
                challenge.id,
                Redacted.make(
                  operation === "right" || operation === "refuse"
                    ? value
                    : operation === "malformed"
                      ? flow.malformed
                      : wrong(value),
                ),
                added(flow),
                signed(binding().person),
              ),
            );
          }

          yield* capture;
        }
      }

      // Only states written by the real service enter this check. No saved state is invented.
      const result = yield* Arbitrary.checkEffect(
        Arbitrary.schema(machine.msg),
        (message) =>
          Effect.sync(() => {
            for (const saved of reached) {
              const codec = Schema.fromJsonString(machine.model);
              const back = Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(saved));
              const [restored] = machine.init(back, {});
              expect(restored).toEqual(saved);

              if (acceptedTypes(machine, saved).includes(message.type)) {
                expect(applyCell(machine, restored, message)).toEqual(applyCell(machine, saved, message));
              }
            }

            return true;
          }),
        { seed: 119120 },
      );
      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    }),
  EFFECT,
);

effectLaw("P36.01 six digits, including leading zeroes; only a hash persists", (h) =>
  Effect.gen(function* () {
    const challenge = yield* h.recovery.issueSetup(binding(), Redacted.make(address(h.flow)));
    const mail = h.mails.at(-1)!;
    const value = Redacted.value(mail.code);
    // A direct low-code control in every case makes dropping padding visible even after shrinking.
    expect(value).toMatch(/^[0-9]{6}$/);
    expect(value).toBe(code(h.flow));
    expect(h.draws).toBeGreaterThanOrEqual(2); // 0xffffffff must be rejected, never modulo reduced.
    expect(challenge.until).toBe(EPOCH + TEN_MINUTES);
    expect(Object.keys(challenge).sort()).toEqual(["id", "until"]);
    const stored = yield* h.dependencies.store.snapshot;
    const raw = JSON.stringify(stored);
    expect(raw).not.toContain(`"${value}"`);
    expect(raw).toMatch(/hash/i);
    expect(JSON.stringify(h.rows)).not.toContain(value);
  }),
);

const attempt = (h: Harness, id: string, value: string) =>
  h.recovery.redeem(id, Redacted.make(value), added(h.flow), signed(binding().person));

effectLaw("P36.02 ten-minute expiry and five total tries hold across concurrent calls and reopen", (h) =>
  Effect.gen(function* () {
    yield* setup(h);

    // All three boundaries are controls in every generated flow.
    for (const offset of [-1, 0, 1] as const) {
      yield* TestClock.setTime(EPOCH);
      const challenge = yield* h.recovery.issueRecovery(binding());
      const value = Redacted.value(h.mails.at(-1)!.code);
      yield* TestClock.setTime(challenge.until + offset);
      const outcome = yield* Effect.exit(attempt(h, challenge.id, value));
      expect(outcome._tag === "Success").toBe(offset < 0);
    }

    yield* TestClock.setTime(EPOCH);
    let challenge = yield* h.recovery.issueRecovery(binding());
    let value = Redacted.value(h.mails.at(-1)!.code);

    for (let n = 0; n < 4; n++) {
      yield* expectRefused(attempt(h, challenge.id, wrong(value)));
    }

    for (let n = 0; n <= h.flow.reopens; n++) {
      yield* h.reopen;
    }

    // Try five may succeed. A test that simply refuses every attempt must fail here.
    expect((yield* attempt(h, challenge.id, value)).id).toBeTypeOf("string");
    challenge = yield* h.recovery.issueRecovery(binding());
    value = Redacted.value(h.mails.at(-1)!.code);
    const original = challenge;
    yield* Effect.forEach(
      Array.from({ length: 5 }, () => 0),
      () => expectRefused(attempt(h, original.id, wrong(value))),
      { concurrency: 5 },
    );
    yield* h.reopen;

    yield* expectRefused(attempt(h, challenge.id, value));
  }),
);

effectLaw("P36.03 replacement and successful use end the old challenge", (h) =>
  Effect.gen(function* () {
    yield* setup(h);
    const first = yield* h.recovery.issueRecovery(binding());
    const value = Redacted.value(h.mails.at(-1)!.code);

    for (let n = 0; n <= h.flow.replacements; n++) {
      yield* h.recovery.issueRecovery(binding());
    }

    yield* h.reopen;
    const current = h.mails.at(-1)!;
    // A dependency mutation targets the redemption method, not an alternative policy model.
    const redeem = attempt(h, first.id, value);
    yield* expectRefused(redeem);
    const last = yield* h.recovery.issueRecovery(binding());
    const latestCode = Redacted.value(h.mails.at(-1)!.code);
    const one = yield* attempt(h, last.id, latestCode);
    yield* h.reopen;
    // A retry with the exact same proof may return its first receipt, never a new request.
    const two = yield* Effect.exit(attempt(h, last.id, latestCode));
    const ids = tags(h, "added");
    expect(ids).toHaveLength(1);

    if (two._tag === "Success") {
      expect(two.value.id).toBe(one.id);
    }

    expect(current.purpose).toBe("recovery");
  }),
);

effectLaw("P36.13 lost replies and reopen produce one final added", (h) =>
  Effect.gen(function* () {
    yield* setup(h);
    const { challenge, value, receipt } = yield* recover(h);
    // Lose the first reply and retry the same redemption after reopening the private store.
    const second = yield* Effect.exit(
      h.recovery.redeem(challenge.id, Redacted.make(value), added(h.flow), signed(binding().person)),
    );
    yield* h.reopen;
    const retried = yield* Effect.exit(
      h.recovery.redeem(challenge.id, Redacted.make(value), added(h.flow), signed(binding().person)),
    );

    if (retried._tag === "Success") {
      expect(retried.value.id).toBe(receipt.id);
    }

    void second;

    for (let n = 0; n <= h.flow.reopens; n++) {
      yield* attempt(h, challenge.id, value);
      yield* h.reopen;
    }

    const completed = tags(h, "added");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ fact: { add: { id: receipt.add.id } } });
  }),
);
