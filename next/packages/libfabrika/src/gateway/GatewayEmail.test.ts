// P36, next/: Gateway request edge and real SSHSIG. Signatures are made in memory.
import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import {
  EFFECT,
  SignatureFlow,
  binding,
  added,
  address,
  effectLaw,
  expectRefused,
  loadDoor,
  recover,
  setup,
  signed,
  tags,
  testKey,
  verified,
} from "../email/Email.test-support.ts";

effectLaw(
  "P36.04 another device, purpose or ledger cannot redeem a code",
  (h, plant) =>
    Effect.gen(function* () {
      const door = yield* Effect.promise(loadDoor);
      yield* setup(h);
      const challenge = yield* h.recovery.issueRecovery(binding());
      const value = Redacted.value(h.mails.at(-1)!.code);
      const changes = [
        { purpose: "setup" as const, binding: binding() },
        { purpose: "recovery" as const, binding: { ...binding(), person: "other-person-key" } },
        { purpose: "recovery" as const, binding: { ...binding(), window: "other-window-key" } },
        { purpose: "recovery" as const, binding: { ...binding(), to: "other-ledger" } },
        { purpose: "recovery" as const, binding: { ...binding(), for: "other-person" } },
      ];
      for (const change of changes) {
        const request = plant === "hash only" ? { purpose: "recovery" as const, binding: binding() } : change;
        yield* expectRefused(
          door.handleEmail(
            {
              ...request,
              body: {
                challenge: challenge.id,
                code: value,
                add: added(h.flow),
                proof: signed(binding().person),
              },
            },
            h.recovery,
          ),
        );
      }
      expect(tags(h, "added")).toEqual([]);
      // The right control must still be able to ask after binding refusals.
      const next = yield* recover(h);
      expect(next.receipt.add).toEqual(added(h.flow));
    }),
  ["hash only"],
);

effectLaw(
  "P36.07 changed signed fields and wrong-ledger text are refused",
  (h, plant) =>
    Effect.gen(function* () {
      const door = yield* Effect.promise(loadDoor);
      const { MemberEvent } = yield* Effect.promise(() => import("../access/Access.ts"));
      const { checkSshsig } = yield* Effect.promise(() => import("../transport/Sshsig.ts"));
      const key = yield* testKey(h.flow.seed);
      h.rows[0] = {
        ...h.rows[0]!,
        fact: MemberEvent.cases.founded.make({
          id: binding().for,
          name: "test home",
          keys: [key.line, ...Array.from({ length: h.flow.live }, (_, n) => `person-${n}`)],
          window: "window-0",
        }),
      };
      const challenge = yield* h.recovery.issueSetup(binding(), Redacted.make(address(h.flow)));
      const value = Redacted.value(h.mails.at(-1)!.code);
      const unsigned = verified(h, key.line);
      const text = h.domain.verifiedText(unsigned);
      const armored = yield* key.sign(text);
      expect(armored.length).toBeLessThanOrEqual(2048);
      expect(yield* checkSshsig({ text, armored, space: "fabrika-client", signers: [key.line] })).toEqual({
        signer: key.line,
      });
      const variations = [
        { ...unsigned, verified: { ...unsigned.verified, id: `${unsigned.verified.id}-changed` } },
        { ...unsigned, verified: { ...unsigned.verified, for: "other-person" } },
        { ...unsigned, verified: { ...unsigned.verified, to: "other-ledger" } },
        { ...unsigned, verified: { ...unsigned.verified, email: "email_changed" } },
        { ...unsigned, verified: { ...unsigned.verified, key: "other-key" } },
      ];
      for (const changed of variations) {
        const changedText = plant === "verify different text" ? text : h.domain.verifiedText(changed);
        expect(
          yield* checkSshsig({
            text: changedText,
            armored,
            space: "fabrika-client",
            signers: [key.line],
          }),
        ).toEqual({ reason: "bad_signature" });
        yield* expectRefused(
          door.handleEmail(
            {
              purpose: "setup",
              binding: binding(),
              body: {
                challenge: challenge.id,
                code: value,
                verified: { ...changed, signed: { signer: key.line, text, armored } },
              },
            },
            h.recovery,
          ),
        );
      }
      const foreign =
        plant === "ignore to" ? unsigned : { ...unsigned, verified: { ...unsigned.verified, to: "other-ledger" } };
      const foreignText = h.domain.verifiedText(foreign);
      const foreignSignature = yield* key.sign(foreignText);
      yield* expectRefused(
        door.handleEmail(
          {
            purpose: "setup",
            binding: binding(),
            body: {
              challenge: challenge.id,
              code: value,
              verified: {
                ...foreign,
                signed: { signer: key.line, text: foreignText, armored: foreignSignature },
              },
            },
          },
          h.recovery,
        ),
      );
      // A valid live-person signature and right code must pass this same door.
      yield* door.handleEmail(
        {
          purpose: "setup",
          binding: binding(),
          body: {
            challenge: challenge.id,
            code: value,
            verified: { ...unsigned, signed: { signer: key.line, text, armored } },
          },
        },
        h.recovery,
      );
      expect(tags(h, "verified")).toHaveLength(1);
    }),
  ["verify different text", "ignore to"],
);

it.effect.prop(
  "P36.07 every generated signature-section change fails real SSHSIG",
  { flow: SignatureFlow },
  ({ flow }) =>
    Effect.gen(function* () {
      const { checkSshsig } = yield* Effect.promise(() => import("../transport/Sshsig.ts"));
      const key = yield* testKey(flow.seed);
      const text = JSON.stringify(added(flow));
      const armored = yield* key.sign(text);
      const lines = armored.split("\n");
      // Exactly one changed section: a body byte, BEGIN marker or END marker.
      const at = flow.mutation === "armor" ? 0 : 1;
      const line = lines[at]!;
      lines[at] = `${line[0] === "A" ? "B" : "A"}${line.slice(1)}`;
      const changed = lines.join("\n").slice(0, 2048);
      expect(yield* checkSshsig({ text, armored: changed, space: "fabrika-client", signers: [key.line] })).toEqual({
        reason: "bad_signature",
      });
      // Plant on a typed verifier dependency: verify the original armor instead of the received one.
      expect(yield* checkSshsig({ text, armored, space: "fabrika-client", signers: [key.line] })).not.toEqual({
        reason: "bad_signature",
      });
    }),
  EFFECT,
);

effectLaw(
  "P36.22 malformed outside input returns a fixed refusal with no raw body",
  (h, plant) =>
    Effect.gen(function* () {
      const door = yield* Effect.promise(loadDoor);
      const body = { outside: h.flow.outside, address: address(h.flow), code: h.flow.malformed };
      const result = yield* Effect.exit(door.handleEmail({ purpose: "setup", binding: binding(), body }, h.recovery));
      expect(result._tag).toBe("Failure");
      const error = plant === "raw decoder issue" ? body : result;
      expect(JSON.stringify(error)).not.toContain(address(h.flow));
      expect(tags(h, "verified")).toEqual([]);
    }),
  ["raw decoder issue"],
);
