// T731, next/. C1: the ClientManager contract and its ledger layer keep their exact types. Compile the
// exact bad lines; never execute them. The lead and CI run the compiler; Vitest does not typecheck.
import { expect, expectTypeOf, it } from "@effect/vitest";
import { type Effect, type Layer, Schema } from "effect";
import * as fc from "fast-check";
import type { Ledger, LedgerError } from "../ledger/Ledger.ts";
import type { From } from "../processes/Mailbox.ts";
import type { Access, MemberEvent } from "./Access.ts";
import type * as Contract from "./ClientManager.ts";
import { ClientManager, Founder, type Written } from "./ClientManager.ts";
import type * as ClientManagerLedger from "./ClientManagerLedger.ts";

type Input = Parameters<typeof ClientManagerLedger.layer>[0];

const checkTypes = (founder: Input, members: ClientManager["Service"]["members"]) => {
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
  const checkRefusals = () => {
    const { build: _build, ...noBuild } = founder;
    const { by: _by, ...noBy } = founder;
    const { person: _person, ...noPerson } = founder;
    // @ts-expect-error The contract holds no static layer; the ledger sibling exports it.
    const restored = ClientManager.layer;
    // @ts-expect-error `build` is required: the founding line names the code that wrote it.
    const lostBuild: Input = noBuild;
    // @ts-expect-error `by` is required: the founding line is signed by a checked key.
    const lostBy: Input = noBy;
    // @ts-expect-error `person` is required: the founding line names who founded it.
    const lostPerson: Input = noPerson;
    // @ts-expect-error `members` fails only with LedgerError, never another error channel.
    const otherError: Effect.Effect<Access, string> = members;
    return [restored, lostBuild, lostBy, lostPerson, otherError];
  };
  void checkRefusals;
};

it("C1: every generated founder is the layer's input, and the contract keeps its exact types", () => {
  fc.assert(
    fc.property(
      fc.record({
        name: fc.string(),
        keys: fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 5 }),
        window: fc.option(fc.string(), { nil: null }),
        person: fc.string(),
        by: fc.string(),
        build: fc.string(),
      }),
      (founder) => {
        const input: Input = founder;
        expectTypeOf(checkTypes).toBeFunction(); // The function above stays uncalled.
        expect(Schema.is(Founder)(input)).toBe(true);
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});
