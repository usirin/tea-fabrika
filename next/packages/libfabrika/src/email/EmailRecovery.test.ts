// P36, next/: the right code appends one added during redemption, before replying.
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  EPOCH,
  EFFECT,
  PURE,
  RecoveryFlow,
  LEDGER,
  RetryFlow,
  address,
  added,
  binding,
  changedAdditions,
  effectLaw,
  expectRefused,
  harness,
  setup,
  signed,
  tags,
  testKey,
  verified,
  wrong,
  type Edge,
} from "./Email.test-support.ts";

effectLaw("P36.05 setup requires a right code and live person signature", (h) =>
  Effect.gen(function* () {
    for (const role of ["window", "agent", "recovery", "email", "unknown"] as const) {
      for (let n = 0; n < Math.max(1, h.flow.roles[role === "unknown" ? "person" : role]); n++) {
        const challenge = yield* h.recovery.issueSetup(binding(), Redacted.make(address(h.flow)));
        const value = Redacted.value(h.mails.at(-1)!.code);
        const signer = `${role}-${n}`;
        yield* expectRefused(h.recovery.verifySetup(challenge.id, Redacted.make(value), verified(h, signer)));
      }
    }

    const challenge = yield* h.recovery.issueSetup(binding(), Redacted.make(address(h.flow)));
    const value = Redacted.value(h.mails.at(-1)!.code);
    yield* expectRefused(h.recovery.verifySetup(challenge.id, Redacted.make(wrong(value)), verified(h)));
    expect(tags(h, "verified")).toEqual([]);
    yield* setup(h);
    expect(tags(h, "verified")).toHaveLength(1);
  }),
);

// Plants after build: defer the added; write a waiting fact first; reply before append.
it.effect.prop(
  "0138 the right code lets the device in at once with exactly one email-signed added",
  { flow: RecoveryFlow },
  ({ flow }) =>
    Effect.gen(function* () {
      const h = yield* harness(flow);
      yield* setup(h);
      const { Add, MemberEvent, admitted } = yield* Effect.promise(() => import("../access/Access.ts"));
      const { addText } = yield* Effect.promise(() => import("../access/Text.ts"));
      const { foldAccessEntries } = yield* Effect.promise(() => import("../access/AccessFold.ts"));
      const { verifySshsig } = yield* Effect.promise(() => import("../transport/Sshsig.ts"));
      const person = yield* testKey(flow.seed.map((byte) => (byte + 1) % 256));
      const window = yield* testKey(flow.seed.map((byte) => (byte + 2) % 256));
      const device = { ...binding(), person: person.line, window: window.line };
      const add = {
        ...added(flow),
        adds: { _tag: "person" as const, key: person.line, window: window.line },
      };
      const text = addText(add);
      const proof = { signer: person.line, text, armored: yield* person.sign(text) };
      const challenge = yield* h.recovery.issueRecovery(device);
      const value = Redacted.value(h.mails.at(-1)!.code);

      for (let n = 0; n < flow.attempts % 5; n++) {
        yield* expectRefused(h.recovery.redeem(challenge.id, Redacted.make(wrong(value)), add, proof));
      }

      const at = EPOCH + (flow.time % 600000);
      yield* TestClock.setTime(at);
      const before = h.rows.length;
      const reply = yield* h.recovery.redeem(challenge.id, Redacted.make(value), add, proof);
      const receipt = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, add: Add }))(reply);
      const written = h.rows.slice(before);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        arrivedAt: at,
        fact: { _tag: "added", add, signed: { signer: h.key.line } },
      });
      expect(receipt.add).toEqual(add);
      const event = Schema.decodeUnknownSync(MemberEvent.cases.added)(written[0]!.fact);
      expect(
        yield* verifySshsig({
          text: addText(event.add),
          armored: event.signed.armored,
          space: "fabrika-client",
          signers: [h.key.line],
        }),
      ).toEqual({ _tag: "key", signer: h.key.line });
      expect(admitted(foldAccessEntries(h.rows, LEDGER), window.line)).toEqual({
        key: window.line,
        person: binding().for,
        as: "window",
      });
      expect(tags(h, "requested")).toEqual([]);
      expect(tags(h, "canceled")).toEqual([]);
    }),
  EFFECT,
);

// Plant after build: hand the client success before the append finishes.
it.effect.prop(
  "0138 redemption cannot reply while the added append is still blocked",
  { flow: RecoveryFlow },
  ({ flow }) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const finished = yield* Deferred.make<void>();
      let pause = false;
      const h = yield* harness(
        flow,
        Effect.gen(function* () {
          if (pause) {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }
        }),
      );
      yield* setup(h);
      const challenge = yield* h.recovery.issueRecovery(binding());
      const value = Redacted.value(h.mails.at(-1)!.code);
      pause = true;
      const fiber = yield* Effect.forkChild(
        h.recovery
          .redeem(challenge.id, Redacted.make(value), added(flow), signed(binding().person))
          .pipe(Effect.tap(() => Deferred.succeed(finished, undefined))),
      );
      yield* Deferred.await(entered);
      expect(yield* Deferred.isDone(finished)).toBe(false);
      expect(tags(h, "added")).toEqual([]);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(fiber);
      expect(tags(h, "added")).toHaveLength(1);
    }),
  EFFECT,
);

// Plants after build: sign a changed add or another device after consuming its code.
it.effect.prop(
  "P36.14 redemption signs only the exact addition bound to its challenge",
  { flow: RecoveryFlow },
  ({ flow }) =>
    Effect.gen(function* () {
      const h = yield* harness(flow);
      yield* setup(h);
      const challenge = yield* h.recovery.issueRecovery(binding());
      const value = Redacted.value(h.mails.at(-1)!.code);
      const add = added(flow);

      for (const changed of [
        { ...add, adds: { _tag: "person" as const, key: "another", window: "another-window" } },
        { ...add, verified: "another-verification" },
        { ...add, for: "another-person" },
        { ...add, to: "another-ledger" },
      ]) {
        yield* expectRefused(h.recovery.redeem(challenge.id, Redacted.make(value), changed, signed(binding().person)));
      }

      expect(tags(h, "added")).toEqual([]);
      const one = yield* h.recovery.redeem(challenge.id, Redacted.make(value), add, signed(binding().person));
      expect(one.add).toEqual(add);
      expect(tags(h, "added")).toHaveLength(1);
    }),
  PURE,
);

// Plants after build: strand a redeeming row; accept a changed retry; allocate another add id;
// lose a durable append when the write succeeded but its acknowledgement failed.
it.effect.prop(
  "P36.13 failed append, lost replies, retries and reopen keep one added and one add id",
  { flow: RetryFlow },
  ({ flow }) =>
    Effect.gen(function* () {
      // Both failure points run in every generated flow, preserving the old pre-append reach.
      for (const persisted of [false, true]) {
        let loseReply = false;
        const h = yield* harness(
          flow,
          Effect.void,
          Effect.suspend(() => {
            if (!loseReply) {
              return Effect.void;
            }

            loseReply = false;
            return Effect.fail({ reason: "storage" });
          }),
        );
        yield* setup(h);
        const challenge = yield* h.recovery.issueRecovery(binding());
        const value = Redacted.value(h.mails.at(-1)!.code);
        const add = added(flow);
        const redeem = () => h.recovery.redeem(challenge.id, Redacted.make(value), add, signed(binding().person));
        const refuseChanges = Effect.gen(function* () {
          const stored = yield* h.dependencies.store.snapshot;
          const rows = structuredClone(h.rows);
          const signatures = [...h.out.signed];

          for (const changed of changedAdditions(add)) {
            yield* expectRefused(
              h.recovery.redeem(challenge.id, Redacted.make(value), changed, signed(binding().person)),
            );
            expect(yield* h.dependencies.store.snapshot).toEqual(stored);
            expect(h.rows).toEqual(rows);
            expect(h.out.signed).toEqual(signatures);
          }
        });

        if (persisted) {
          loseReply = true;
        } else {
          h.fixture.fail("append", "append failed once");
        }

        const first = yield* Effect.exit(redeem());

        if (!persisted) {
          expect(Exit.isFailure(first)).toBe(true);
        }

        const written = structuredClone(tags(h, "added"));
        expect(written).toHaveLength(persisted ? 1 : 0);
        expect(JSON.stringify(yield* h.dependencies.store.snapshot)).toContain(
          Exit.isSuccess(first) ? "used" : "redeeming",
        );
        yield* refuseChanges;
        yield* h.reopen;
        yield* refuseChanges;
        yield* TestClock.setTime(EPOCH + 600001); // A durable redemption resumes even after code expiry.
        const receipt = yield* redeem();
        expect(receipt.add).toEqual(add);

        if (Exit.isSuccess(first)) {
          expect(receipt).toEqual(first.value);
        }

        yield* refuseChanges;

        for (let n = 0; n <= flow.reopens; n++) {
          yield* h.reopen;
          yield* refuseChanges;
          expect(yield* redeem()).toEqual(receipt);
        }

        expect(tags(h, "added")).toHaveLength(1);
        expect(tags(h, "added")[0]).toMatchObject({ fact: { add: { id: add.id } } });

        if (persisted) {
          expect(tags(h, "added")).toEqual(written);
        }

        expect(JSON.stringify(yield* h.dependencies.store.snapshot)).toContain("used");
      }
    }),
  EFFECT,
);

effectLaw("P36.22 failed send, storage or crypto never becomes a successful fact", (h) =>
  Effect.gen(function* () {
    const cases: ReadonlyArray<Edge> = ["send", "store.read", "store.write", "store.commit", "hash"];

    for (const edge of cases) {
      h.fixture.fail(edge, `${h.flow.failureText}${address(h.flow)}`.slice(0, 160));
      const result = yield* Effect.exit(h.recovery.issueSetup(binding(), Redacted.make(address(h.flow))));
      expect(result._tag).toBe("Failure");
      expect(tags(h, "verified")).toEqual([]);
      expect(tags(h, "added")).toEqual([]);
    }

    yield* setup(h);
    const challenge = yield* h.recovery.issueRecovery(binding());
    const value = Redacted.value(h.mails.at(-1)!.code);
    h.fixture.fail("sign", h.flow.failureText);
    yield* expectRefused(
      h.recovery.redeem(challenge.id, Redacted.make(value), added(h.flow), signed(binding().person)),
    );
    expect(tags(h, "added")).toEqual([]);
    yield* h.reopen;
    yield* h.recovery.redeem(challenge.id, Redacted.make(value), added(h.flow), signed(binding().person));
    expect(tags(h, "added")).toHaveLength(1);
  }),
);
