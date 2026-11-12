// P36, next/: Challenge persistence is tested through the real store and service, including reopen.
import { applyCell } from "@demlik/tea";
import { expect, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
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
  type Harness,
} from "./Email.test-support.ts";

const module = pureModule(() => import("./Challenge.ts"));

// Plants after build: reset a saved try count; reopen used/ended as open; discard a pending add.
it.effect.prop(
  "P36.02 P36.03 P36.13 every saved Challenge state survives JSON and init without resetting",
  { flow: RetryFlow },
  ({ flow }) =>
    Effect.sync(() => {
      const machine = module().challenge;
      const add = added(flow);
      const states = [
        ...["setup", "recovery"].flatMap((purpose) =>
          Array.from({ length: 5 }, (_, n) => ({
            _tag: "open",
            id: add.id,
            purpose,
            hash: `hash-${flow.code}`,
            until: EPOCH + TEN_MINUTES,
            tries: n + 1,
          })),
        ),
        { _tag: "redeeming", id: add.id, add },
        { _tag: "used", id: add.id, added: add.id },
        ...["expired", "exhausted", "replaced"].map((reason) => ({ _tag: "ended", id: add.id, reason })),
      ];

      for (const state of states) {
        const saved = Schema.decodeUnknownSync(machine.model)(state);
        const bytes = Schema.encodeSync(machine.model)(saved);
        const back = Schema.decodeUnknownSync(machine.model)(JSON.parse(JSON.stringify(bytes)));
        const [restored] = machine.init(back, {});
        expect(restored).toEqual(saved);

        for (const now of [EPOCH, EPOCH + TEN_MINUTES, EPOCH + TEN_MINUTES + 1]) {
          const message = Schema.decodeUnknownSync(machine.msg)({ type: "tick", now });
          expect(applyCell(machine, restored, message)).toEqual(applyCell(machine, saved, message));
        }
      }
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
    const ids = tags(h, "added").filter(
      (row) =>
        typeof row.fact === "object" &&
        row.fact !== null &&
        "add" in row.fact &&
        JSON.stringify(row.fact.add).includes(one.add.id),
    );
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
