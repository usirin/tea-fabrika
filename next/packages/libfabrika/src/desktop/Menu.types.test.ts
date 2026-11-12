// next/, P21 L11. CI compiles the uncalled bad lines; Vitest never proves a type refusal.
import { expectTypeOf, it } from "@effect/vitest";
import { type Effect, type Layer, Schema } from "effect";
import type * as Access from "../access/Access.ts";
import * as Menu from "./Menu.ts";
import * as Contract from "./PersonCheck.ts";
import type * as PersonCheckTest from "./PersonCheckTest.ts";

type Kind = typeof Access.Grant.Type.as;

const types = () => {
  expectTypeOf<keyof typeof Menu.words>().toEqualTypeOf<Kind>();
  expectTypeOf<typeof Menu.Row.Type.as>().toEqualTypeOf<Kind>();
  expectTypeOf<typeof Menu.Client.Type.as>().toEqualTypeOf<Kind>();
  expectTypeOf<Contract.PersonCheck["Service"]>().toEqualTypeOf<{
    readonly ask: (reason: string) => Effect.Effect<typeof Contract.Answer.Type, Contract.PersonCheckError>;
  }>();
  expectTypeOf<typeof Contract.PersonCheckError.Type.reason>().toEqualTypeOf<"unavailable">();
  expectTypeOf<"layer" extends keyof typeof Contract.PersonCheck ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof Contract ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<ReturnType<typeof PersonCheckTest.layer>>().toEqualTypeOf<Layer.Layer<Contract.PersonCheck>>();
  const badLines = () => {
    // @ts-expect-error A new access kind must acquire words before any client can show it.
    const missingWords: Record<Kind | "future-client-kind", string> = Menu.words;
    // @ts-expect-error Platform adapters are siblings. The service has no static Layer.
    const staticLayer = Contract.PersonCheck.layer;
    // @ts-expect-error A platform handle cannot stand in for an ordinary reason string.
    const handle = Contract.PersonCheck.of({ ask: (_reason: { show: () => void }) => null });
    return [missingWords, staticLayer, handle];
  };
  void badLines;
};

// format: these are the platform-free public types, checked by CI rather than executed here.
it("format: L11 Menu kinds and PersonCheck's contract need no platform handle", () => {
  expectTypeOf(types).toBeFunction();
  expectTypeOf(Menu.machine).toBeFunction();
  expectTypeOf(Menu.view).toBeFunction();
  expectTypeOf(Schema.is(Contract.Answer)).toBeFunction();
});
