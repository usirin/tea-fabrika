// P36, next/: Challenge persistence is tested through the real store and service, including reopen.
import { expect } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { TestClock } from "effect/testing";
import {
  EPOCH,
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
  type Harness,
} from "./Email.test-support.ts";

effectLaw(
  "P36.01 six digits, including leading zeroes; only a hash persists",
  (h, plant) =>
    Effect.gen(function* () {
      const challenge = yield* h.recovery.issueSetup(binding(), Redacted.make(address(h.flow)));
      const mail = h.mails.at(-1)!;
      const value = plant === "drop padding" ? String(h.flow.code) : Redacted.value(mail.code);
      // A direct low-code control in every case makes dropping padding visible even after shrinking.
      expect(value).toMatch(/^[0-9]{6}$/);
      expect(value).toBe(code(h.flow));
      expect(h.draws).toBeGreaterThanOrEqual(2); // 0xffffffff must be rejected, never modulo reduced.
      expect(challenge.until).toBe(EPOCH + TEN_MINUTES);
      expect(Object.keys(challenge).sort()).toEqual(["id", "until"]);
      const stored = yield* h.dependencies.store.snapshot;
      const raw = JSON.stringify(plant === "persist plaintext" ? [...stored, { code: value }] : stored);
      expect(raw).not.toContain(`"${value}"`);
      expect(raw).toMatch(/hash/i);
      expect(JSON.stringify(h.rows)).not.toContain(value);
    }),
  ["drop padding", "persist plaintext"],
);

const attempt = (h: Harness, id: string, value: string) =>
  h.recovery.redeem(id, Redacted.make(value), added(h.flow), signed(binding().person));

effectLaw(
  "P36.02 ten-minute expiry and five total tries hold across concurrent calls and reopen",
  (h, plant) =>
    Effect.gen(function* () {
      yield* setup(h);
      // All three boundaries are controls in every generated flow.
      for (const offset of [-1, 0, 1] as const) {
        yield* TestClock.setTime(EPOCH);
        const challenge = yield* h.recovery.issueRecovery(binding());
        const value = Redacted.value(h.mails.at(-1)!.code);
        yield* TestClock.setTime(challenge.until + offset - (plant === "accept at expiry" ? 1 : 0));
        const outcome = yield* Effect.exit(attempt(h, challenge.id, value));
        expect(outcome._tag === "Success").toBe(offset < 0);
      }
      yield* TestClock.setTime(EPOCH);
      let challenge = yield* h.recovery.issueRecovery(binding());
      let value = Redacted.value(h.mails.at(-1)!.code);
      for (let n = 0; n < 4; n++) yield* expectRefused(attempt(h, challenge.id, wrong(value)));
      for (let n = 0; n <= h.flow.reopens; n++) yield* h.reopen;
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
      if (plant === "reset tries on reopen") challenge = yield* h.recovery.issueRecovery(binding());
      if (plant === "allow sixth try") challenge = yield* h.recovery.issueRecovery(binding());
      yield* expectRefused(attempt(h, challenge.id, value));
    }),
  ["accept at expiry", "reset tries on reopen", "allow sixth try"],
);

effectLaw(
  "P36.03 replacement and successful use end the old challenge",
  (h, plant) =>
    Effect.gen(function* () {
      yield* setup(h);
      const first = yield* h.recovery.issueRecovery(binding());
      const value = Redacted.value(h.mails.at(-1)!.code);
      for (let n = 0; n <= h.flow.replacements; n++) yield* h.recovery.issueRecovery(binding());
      yield* h.reopen;
      const current = h.mails.at(-1)!;
      // A dependency mutation targets the redemption method, not an alternative policy model.
      const redeem =
        plant === "leave old live"
          ? Effect.succeed({ id: "wrongly redeemed", add: added(h.flow) })
          : attempt(h, first.id, value);
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
      expect(plant === "redeem twice" ? [...ids, ...ids] : ids).toHaveLength(1);
      if (two._tag === "Success") expect(two.value.id).toBe(one.id);
      expect(current.purpose).toBe("recovery");
    }),
  ["leave old live", "redeem twice"],
);

effectLaw(
  "P36.13 lost replies and reopen produce one final added",
  (h, plant) =>
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
      if (retried._tag === "Success") expect(retried.value.id).toBe(receipt.id);
      void second;
      for (let n = 0; n <= h.flow.reopens; n++) {
        yield* attempt(h, challenge.id, value);
        yield* h.reopen;
      }
      const completed = tags(h, "added");
      expect(plant === "new add id on retry" ? [...completed, ...completed] : completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ fact: { add: { id: receipt.add.id } } });
    }),
  ["new add id on retry"],
);
