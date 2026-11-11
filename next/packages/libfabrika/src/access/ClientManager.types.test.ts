import { expectTypeOf, it } from "@effect/vitest";
import type { Effect, Layer } from "effect";
import type { Ledger, LedgerError } from "../ledger/Ledger.ts";
import type { From } from "../processes/Mailbox.ts";
import type { Access, MemberEvent } from "./Access.ts";
import type * as Contract from "./ClientManager.ts";
import type { ClientManager, Founder, Written } from "./ClientManager.ts";
import type * as ClientManagerLedger from "./ClientManagerLedger.ts";

// scenario: compile-time contract equality; tsc checks these types, with no database acquired.
it("scenario: ClientManager keeps its exact contract and sibling layer requirements", () => {
  expectTypeOf<ClientManager["Service"]>().toEqualTypeOf<{
    readonly members: Effect.Effect<Access, LedgerError>;
    readonly write: (event: MemberEvent, from: From) => Effect.Effect<Written, LedgerError>;
  }>();
  expectTypeOf<Parameters<typeof ClientManagerLedger.layer>>().toEqualTypeOf<
    [Founder & { readonly person: string; readonly by: string; readonly build: string }]
  >();
  expectTypeOf<ReturnType<typeof ClientManagerLedger.layer>>().toEqualTypeOf<
    Layer.Layer<ClientManager, never, Ledger>
  >();
  expectTypeOf<"layer" extends keyof typeof Contract.ClientManager ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof Contract ? true : false>().toEqualTypeOf<false>();
});

// scenario: these rejected assignments pin the three C1 negative cases without running a layer.
// The lead and CI run the compiler; Vitest does not typecheck this callback.
it("scenario: rejects static layers, incomplete founders and a changed error channel", () => {
  type AssertFalse<T extends false> = T;
  // @ts-expect-error A restored static layer must violate the contract-only shape.
  expectTypeOf<
    AssertFalse<"layer" extends keyof (typeof Contract.ClientManager & { layer: unknown }) ? true : false>
  >();
  // @ts-expect-error Dropping build cannot satisfy the required founder input.
  expectTypeOf<Omit<Parameters<typeof ClientManagerLedger.layer>[0], "build">>().toEqualTypeOf<
    Parameters<typeof ClientManagerLedger.layer>[0]
  >();
  // @ts-expect-error Members must retain LedgerError rather than a string error channel.
  expectTypeOf<Effect.Effect<Access, string>>().toEqualTypeOf<ClientManager["Service"]["members"]>();
});
