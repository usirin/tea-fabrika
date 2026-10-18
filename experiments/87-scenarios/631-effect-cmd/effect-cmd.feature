# Written from the text of kamp-us/demlik issue 631 and its recorded ruling
# (refuse a two-sided schema when compiled; `@demlik/tea/effect` exports its
# own `Cmd` whose `define` takes plain Effect schemas), before its fix was read.
Feature: define a Cmd from plain Effect schemas

  As a tea user who writes every schema in Effect Schema
  I want the Cmd.define of @demlik/tea/effect to take my schemas as they are
  So that I never write Schema.toStandardSchemaV1, and a mistake points at my schema

  @change
  Scenario: three Cmds from plain Effect schemas run like their hand-wrapped twins
    Given the Cmds profile, status and order defined with the Cmd.define of @demlik/tea/effect
    And the same three Cmds defined with the core Cmd.define and Schema.toStandardSchemaV1
    When both machines run on the Effect engine and every handler answers a good value
    Then both machines end in the same state
    And the state holds the profile name, the status and the order's nested customer and lines
    When both machines run again
    Then each machine saw the same Msgs both times, and the two machines saw the same Msgs

  @change
  Scenario: a handler value the ok schema rejects settles as malformed_result
    Given the Cmds profile, status and order defined with the Cmd.define of @demlik/tea/effect
    And the same three Cmds defined with the core Cmd.define and Schema.toStandardSchemaV1
    When both machines run on the Effect engine and the status handler answers "maybe"
    Then both machines end in the same state
    And the status Cmd settled on its _err Msg with malformed_result

  @change
  Scenario: the Cmd it returns is the hand-wrapped Cmd, and every runner takes it with no cast
    Given the TypeScript module "same.ts":
      """ts
      import { Effect, Schema } from "effect";
      import { Cmd as CoreCmd, defineMachine, type OkOf, type Settled } from "@demlik/tea";
      import { Cmd, run } from "@demlik/tea/effect";
      import { drive } from "@demlik/tea/testing/effect";

      type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

      const Input = Schema.Struct({ id: Schema.String });
      const Ticket = Schema.Struct({ title: Schema.String, tags: Schema.Array(Schema.String) });
      const viaHelper = Cmd.define("ticket_read", { input: Input, ok: Ticket, err: ["unknown"] });
      const viaHand = CoreCmd.define("ticket_read", {
        input: Schema.toStandardSchemaV1(Input),
        ok: Schema.toStandardSchemaV1(Ticket),
        err: ["unknown"],
      });
      type H = typeof viaHelper;
      type W = typeof viaHand;
      export const sameInput: Same<Parameters<H>[0], Parameters<W>[0]> = true;
      export const sameOk: Same<OkOf<H>, OkOf<W>> = true;
      export const sameMsgs: Same<Settled<H>, Settled<W>> = true;

      const machine = defineMachine({
        types: { model: {} as { readonly title: string | null }, msg: {} as { readonly type: "go" } },
        cmds: [viaHelper],
        init: () => [{ title: null }, []],
        update: {
          go: (m) => [m, [viaHelper({ id: "1" })]],
          ticket_read_ok: (_m, msg) => [{ title: msg.value.title }, []],
          ticket_read_err: (m) => [m, []],
        },
      });
      const answer = () => Effect.succeed({ title: "t", tags: [] });
      export const started = run(machine, { interpret: { ticket_read: answer } });
      export const driven = drive(machine, { title: null }, { type: "go" }, { ticket_read: answer });
      """
    Then the TypeScript modules typecheck

  @change
  Scenario: a schema whose two sides differ is refused when the code is compiled
    Given the TypeScript module "refused.ts":
      """ts
      import { Schema } from "effect";
      import { Cmd } from "@demlik/tea/effect";

      const Id = Schema.String.pipe(Schema.brand("Id"));
      const In = Schema.Struct({ id: Schema.String });
      export const a = Cmd.define("a", { input: Schema.Struct({ n: Schema.FiniteFromString }), ok: Schema.String, err: ["x"] }); // refused
      export const b = Cmd.define("b", { input: In, ok: Schema.FiniteFromString, err: ["x"] }); // refused
      export const c = Cmd.define("c", { input: Schema.Struct({ id: Id }), ok: Schema.String, err: ["x"] }); // refused
      export const d = Cmd.define("d", { input: In, ok: Id, err: ["x"] }); // refused
      export const e = Cmd.define("e", { input: In, ok: Schema.toType(Id), err: ["x"] });
      export const f = Cmd.define("f", { input: In, ok: Schema.Struct({ n: Schema.Finite }), err: ["x"] });
      """
    Then the typecheck refuses the lines marked "// refused" and no other

  @change
  Scenario: a schema that needs a Promise is refused when the Cmd settles, as the hand-wrapped one is
    Given a Cmd whose ok schema checks its value with an Effect that sleeps, defined both ways
    When each is driven with drive from @demlik/tea/testing/effect
    Then both are refused with AsyncSchemaError
    And the two refusals carry the same message
