// Ticket 921, next/. Law 3 (decision 0043, rule 12): no service of `runtime/` fails with the ledger's
// error. One block a service, added in the slice that fixes it: `RecoveryStore` in slice 1. An
// error is matched by its `_tag`, so this file imports no ledger file. The type checker reads the
// law; Vitest does not typecheck, so the lead and CI run it with `pnpm typecheck`.
// Plant: add a member tagged `LedgerError` to one method's error.
import { expectTypeOf, it } from "@effect/vitest";
import type { Effect } from "effect";
import type { RecoveryStore } from "./RecoveryStore.ts";

/** What one member of a service fails with: an Effect's error, or that of the Effect a function answers. */
type Failure<Member> = Member extends (...args: ReadonlyArray<never>) => infer Answer
  ? Failure<Answer>
  : Member extends Effect.Effect<infer _A, infer E, infer _R>
    ? E
    : never;

/** Every error any member of a service fails with. */
type Failures<Service> = { readonly [Name in keyof Service]: Failure<Service[Name]> }[keyof Service];

/** The members of that union that are the ledger's own error. */
type FromLedger<Service> = Extract<Failures<Service>, { readonly _tag: "LedgerError" }>;

/** A service that breaks the law in one method, so the helper is seen to find it. */
type Leaky = {
  readonly load: Effect.Effect<void, { readonly _tag: "Own" }>;
  readonly save: (value: unknown) => Effect.Effect<void, { readonly _tag: "Own" } | { readonly _tag: "LedgerError" }>;
};

it("type: no service of runtime/ fails with an error tagged LedgerError", () => {
  // The helper finds a ledger error where one is, in a plain member and in a function's answer.
  expectTypeOf<FromLedger<Leaky>>().toEqualTypeOf<{ readonly _tag: "LedgerError" }>();
  expectTypeOf<Failures<Leaky>["_tag"]>().toEqualTypeOf<"Own" | "LedgerError">();

  // RecoveryStore: `load`, `save`, `input` and `receipt` fail with its own error and nothing else.
  type Recovery = (typeof RecoveryStore)["Service"];
  expectTypeOf<Failures<Recovery>["_tag"]>().toEqualTypeOf<"RecoveryStoreError">();
  expectTypeOf<FromLedger<Recovery>>().toBeNever();
});
