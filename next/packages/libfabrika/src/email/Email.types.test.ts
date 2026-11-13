// P36, next/: a library-only client uses the complete flow through /email. Secret type laws have
// runnable generated codec checks, so missing product exports stay red in vitest.
import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import type { MemberEvent } from "../access/Access.ts";
import {
  EFFECT,
  flows,
  code,
  address,
  started,
  type Dependencies,
  type IO,
  type Recovery,
} from "./Email.test-support.ts";

// P36 is not built, so its types are not here to judge. Until its sources exist, the names below
// are the exam's contract for the front `@kampus/libfabrika/email`, the way P8's exam declared its
// bridge (docs/plan/tier-1.md, row P8). The type laws under them read that contract, so they judge
// nothing of the product yet. `bind` fails both runnable laws the moment a P36 source exists, until
// P36's tests step puts the real names in the contract's place:
//   - `EmailRecovery`, `CodeInput`, `AddressInput` and `EmailView` from `@kampus/libfabrika/email`,
//     with `typeof CodeInput.Type`, `typeof EmailRecovery.Service` and `typeof EmailView.Type`
//   - `EmailFact` from `./Email.ts` and `NoticeMsg` from `./RecoveryEmail.ts`
//   - the front loaded by its package name in the two runnable laws
//   - `Extract<MemberEvent, { _tag: "verified" }>` is not never, back in `noWaitingFact`
type Secret = Schema.Codec<Redacted.Redacted<string>, string>;

interface Front {
  readonly CodeInput: Secret;
  readonly AddressInput: Secret;
  readonly EmailView: Schema.Codec<object>;
  readonly makeEmailRecovery: (dependencies: Dependencies) => IO<Recovery>;
}

type EmailFact = { readonly _tag: "verified" } | { readonly _tag: "added" };
type NoticeMsg = never;

const bind = (): Front => {
  throw new Error(
    "P36 started: put the real types and the front under these laws, as this file's top says, before build",
  );
};

// Compile-time plants. Plain input and a saved string are invalid on purpose.
const codeType = (input: Front["CodeInput"]["Type"]) => {
  expectTypeOf(input).toExtend<Redacted.Redacted<string>>();
  expectTypeOf<string>().not.toExtend<typeof input>();
};

const addressType = (input: Front["AddressInput"]["Type"]) => {
  expectTypeOf(input).toExtend<Redacted.Redacted<string>>();
  expectTypeOf<string>().not.toExtend<typeof input>();
};

// Referencing every operation proves a new client needs no app-owned helper.
const client = (email: Recovery) => [email.issueSetup, email.verifySetup, email.issueRecovery, email.redeem];

const saved = (view: Front["EmailView"]["Type"]) => {
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
  expectTypeOf<EmailFact["_tag"]>().toEqualTypeOf<"verified" | "added">();
  expectTypeOf<Extract<MemberEvent, { _tag: "requested" | "canceled" }>>().toBeNever();
};

const noNoticeAction = () => {
  expectTypeOf<NoticeMsg>().toBeNever();
};

void noWaitingFact;
void noNoticeAction;

it.effect.prop(
  "not built: P36 / P36.23 secret input refuses ordinary saved-state encoding",
  { flow: flows },
  ({ flow }, ctx) =>
    Effect.gen(function* () {
      started(ctx);
      const email = bind();

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
  "not built: P36 / P36.24 /email exports a complete library-only flow",
  { flow: flows },
  ({ flow }, ctx) =>
    Effect.gen(function* () {
      started(ctx);
      const email = bind();
      expect(email.makeEmailRecovery).toBeTypeOf("function");
      const value = yield* Schema.decodeUnknownEffect(email.CodeInput)(code(flow));
      expect(Redacted.value(value)).toBe(code(flow));
    }),
  EFFECT,
);
