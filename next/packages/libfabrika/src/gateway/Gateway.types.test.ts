// Ticket 921, next/. Law 3 (decision 0043, rule 12): nothing in `gateway/` fails with the ledger's
// error. One block a file, added in the slice that fixes it. Slice 1 fixes the two helper files of
// the `Gateway` service, `GatewayStore.ts` and `GatewayNonce.ts`; the service itself keeps the
// ledger's error until its own slice and has no block yet. An error is matched by its `_tag`, so
// this file imports no ledger file. The type checker reads the law; Vitest does not typecheck, so
// the lead and CI run it with `pnpm typecheck`.
// Plant: add a member tagged `LedgerError` to one function's error.
import { expectTypeOf, it } from "@effect/vitest";
import type { Effect, Result } from "effect";
import type { gatewayNonce } from "./GatewayNonce.ts";
import type { gatewayStore } from "./GatewayStore.ts";

/** What one function fails with: an Effect's error, a Result's failure, or that of what a function answers. */
type Failure<Member> = Member extends (...args: ReadonlyArray<never>) => infer Answer
  ? Failure<Answer>
  : Member extends Effect.Effect<infer _A, infer E, infer _R>
    ? E
    : Member extends Result.Result<infer _A, infer E>
      ? E
      : never;

/** The members of a union of errors that are the ledger's own error. */
type FromLedger<Errors> = Extract<Errors, { readonly _tag: "LedgerError" }>;

type Own = { readonly _tag: "Own" };
type Ledgers = { readonly _tag: "LedgerError" };

it("type: the gateway's store and nonce fail with GatewayError, never an error tagged LedgerError", () => {
  // The helper finds a ledger error where one is: in an Effect, in a Result, and in a function's answer.
  expectTypeOf<FromLedger<Failure<Effect.Effect<void, Own | Ledgers>>>>().toEqualTypeOf<Ledgers>();
  expectTypeOf<FromLedger<Failure<() => Result.Result<boolean, Own | Ledgers>>>>().toEqualTypeOf<Ledgers>();
  expectTypeOf<Failure<(name: string) => Effect.Effect<void, Own>>>().toEqualTypeOf<Own>();

  // GatewayStore: the one call that fails is `atomic`.
  type Atomic = Failure<ReturnType<ReturnType<typeof gatewayStore>["atomic"]>>;
  expectTypeOf<Atomic["_tag"]>().toEqualTypeOf<"GatewayError">();
  expectTypeOf<FromLedger<Atomic>>().toBeNever();

  // GatewayNonce: making the tools, and then `issue`, `check` and `spend`.
  type Made = Failure<typeof gatewayNonce>;
  type Tools = Effect.Success<ReturnType<typeof gatewayNonce>>;
  type Used = Failure<Tools["issue"]> | Failure<Tools["check"]> | Failure<Tools["spend"]>;
  expectTypeOf<(Made | Used)["_tag"]>().toEqualTypeOf<"GatewayError">();
  expectTypeOf<FromLedger<Made | Used>>().toBeNever();
});
