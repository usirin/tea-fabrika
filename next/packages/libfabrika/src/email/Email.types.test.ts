// P36, next/: a library-only client uses the complete flow through /email. Secret type laws have
// runnable generated codec checks, so missing product exports stay red in vitest.
import { expect, expectTypeOf, it } from "@effect/vitest";
import type { EmailRecovery, CodeInput, AddressInput, EmailView } from "@kampus/libfabrika/email";
import { Effect, Redacted, Schema } from "effect";
import type { MemberEvent } from "../access/Access.ts";
import { EFFECT, flows, code, address } from "./Email.test-support.ts";
import type { EmailFact } from "./Email.ts";
import type { NoticeMsg } from "./RecoveryEmail.ts";

// Compile-time plants. Plain input and a saved string are invalid on purpose.
const codeType = (input: typeof CodeInput.Type) => {
  expectTypeOf(input).toExtend<Redacted.Redacted<string>>();
  expectTypeOf<string>().not.toExtend<typeof input>();
};
const addressType = (input: typeof AddressInput.Type) => {
  expectTypeOf(input).toExtend<Redacted.Redacted<string>>();
  expectTypeOf<string>().not.toExtend<typeof input>();
};

// Referencing every operation proves a new client needs no app-owned helper.
const client = (email: typeof EmailRecovery.Service) => [
  email.issueSetup,
  email.verifySetup,
  email.issueRecovery,
  email.redeem,
];
const saved = (view: typeof EmailView.Type) => {
  expectTypeOf(view).not.toHaveProperty("code");
  expectTypeOf(view).not.toHaveProperty("address");
};
void codeType;
void addressType;
void client;
void saved;

// Type laws only. CI's check job runs these; they add no runtime test.
// Plants after build: add a requested/canceled case; add a Cancel or not-me NoticeMsg.
const noWaitingFact = () => {
  expectTypeOf<(typeof EmailFact.Type)["_tag"]>().toEqualTypeOf<"verified" | "added">();
  expectTypeOf<Extract<MemberEvent, { _tag: "requested" | "canceled" }>>().toBeNever();
  expectTypeOf<Extract<MemberEvent, { _tag: "verified" }>>().not.toBeNever();
};
const noNoticeAction = () => {
  expectTypeOf<NoticeMsg>().toBeNever();
};
void noWaitingFact;
void noNoticeAction;

it.effect.prop(
  "P36.23 secret input refuses ordinary saved-state encoding",
  { flow: flows },
  ({ flow }) =>
    Effect.gen(function* () {
      const email = yield* Effect.promise(() => import("@kampus/libfabrika/email"));
      for (const [schema, input] of [
        [email.CodeInput, code(flow)],
        [email.AddressInput, address(flow)],
      ] as const) {
        const value = yield* Schema.decodeUnknownEffect(schema)(input);
        expect(Redacted.isRedacted(value)).toBe(true);
        const result = yield* Effect.exit(Schema.encodeEffect(schema)(value));
        expect(result._tag).toBe("Failure");
      }
    }),
  EFFECT,
);

it.effect.prop(
  "P36.24 /email exports a complete library-only flow",
  { flow: flows },
  ({ flow }) =>
    Effect.gen(function* () {
      const email = yield* Effect.promise(() => import("@kampus/libfabrika/email"));
      expect(email.EmailRecovery.layer).toBeTypeOf("function");
      const value = yield* Schema.decodeUnknownEffect(email.CodeInput)(code(flow));
      expect(Redacted.value(value)).toBe(code(flow));
    }),
  EFFECT,
);
