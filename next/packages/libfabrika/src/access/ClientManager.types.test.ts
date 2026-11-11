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
