// T953 slice 1, next/: the permission core's type laws L5 to L7. Compile the exact bad lines; never
// execute them. The lead and CI run the compiler (`pnpm typecheck`); Vitest does not typecheck. The
// requirements are read off the Effect type, never asserted by assigning to an `R = never`
// annotation: that trips the Effect plugin's missing-context diagnostic, which `@ts-expect-error`
// does not catch (phoenix `packages/authz/src/Capability.typetest.ts`).
import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, type Result, Schema } from "effect";
import { Model, StartProgram } from "./Model.ts";
import * as Rebac from "./Rebac.ts";
import type { Tuples } from "./Relation.ts";
import { Relations } from "./Relations.ts";
import type { Sender } from "./Senders.ts";

/** The proof a right's check gives, read off its `within`. */
type Granted<Right extends { readonly within: (...args: never) => unknown }> =
  ReturnType<Right["within"]> extends Result.Result<infer A, unknown> ? A : never;

type Needs<T> = [T] extends [Effect.Effect<unknown, unknown, infer R>] ? R : never;

/** A second right with the same model, type and permission: only its id differs (phoenix issue 1483). */
class OtherStart extends Rebac.Permission<OtherStart>()("permissions/test/OtherStart", {
  model: Model,
  on: "fabrika",
  permission: "start",
}) {}

const checkTypes = (
  proof: Granted<typeof StartProgram>,
  other: Granted<typeof OtherStart>,
  widened: Rebac.Proof<unknown>,
  tuples: Tuples,
  sender: typeof Sender.Type,
) => {
  // L5. Plant: widen the right's `Id` to `string` in `Permission`; the two proofs then unify.
  const needs = Effect.gen(function* () {
    const held = yield* StartProgram;
    return held.object;
  });
  expectTypeOf<Needs<typeof needs>>().toEqualTypeOf<StartProgram>();
  const discharged = needs.pipe(Rebac.provide(proof));
  expectTypeOf<Needs<typeof discharged>>().toEqualTypeOf<never>();
  expectTypeOf(proof).not.toEqualTypeOf(other);
  const wrong = needs.pipe(Rebac.provide(other));
  expectTypeOf<Needs<typeof wrong>>().toEqualTypeOf<StartProgram>();
  expectTypeOf(StartProgram.within(tuples, sender, Model.ref("fabrika", "demo"))).toEqualTypeOf<
    Result.Result<Granted<typeof StartProgram>, Rebac.Denied>
  >();
  expectTypeOf(Rebac.recheck(proof, tuples)).toEqualTypeOf<boolean>();

  // L5, review send-back: a proof widened to `Proof<unknown>`, or a proof of another right, never
  // removes `StartProgram`, and `provide` never removes a requirement that is not a right, such as
  // `Relations`. Red on 5aa8a5e: `Proof` is covariant and `Exclude<R, unknown>` is `never`, so the
  // widened line compiles, types as needing nothing, and dies at run time with "Service not found".
  const needsBoth = Effect.gen(function* () {
    const held = yield* StartProgram;
    const relations = yield* Relations;
    return [held.object, relations] as const;
  });
  expectTypeOf<Needs<typeof needsBoth>>().toEqualTypeOf<StartProgram | Relations>();
  const keptRelations = needsBoth.pipe(Rebac.provide(proof));
  expectTypeOf<Needs<typeof keptRelations>>().toEqualTypeOf<Relations>();
  const keptBoth = needsBoth.pipe(Rebac.provide(other));
  expectTypeOf<Needs<typeof keptBoth>>().toEqualTypeOf<StartProgram | Relations>();
  // @ts-expect-error A proof widened to `Proof<unknown>` names no right, so `provide` refuses it.
  const widenedAway = needsBoth.pipe(Rebac.provide(widened));

  // L6. Plant: type the builder's names as `string`; each line below then compiles.
  const checkNames = () => {
    // @ts-expect-error The model declares no `window` type.
    const window = Model.ref("window", "w1");
    const drive = Rebac.make("names")
      .type("person", {})
      .type("fabrika", {
        relations: { owner: ["person"] },
        // @ts-expect-error `drive` is neither a relation nor a permission of this type.
        permissions: { start: (p) => p.union("drive") },
      });
    const stranger = Rebac.make("names")
      .type("person", {})
      // @ts-expect-error A relation may hold only a declared type, and `window` is not one.
      .type("fabrika", { relations: { owner: ["window"] } });
    class View extends Rebac.Permission<View>()("permissions/test/View", {
      model: Model,
      on: "fabrika",
      // @ts-expect-error The `fabrika` type declares no `view` permission.
      permission: "view",
    }) {}
    class OnWindow extends Rebac.Permission<OnWindow>()("permissions/test/OnWindow", {
      model: Model,
      // @ts-expect-error The model declares no `window` type to hold a right on.
      on: "window",
      permission: "start",
    }) {}
    // @ts-expect-error A right on `fabrika` checks only a `fabrika:` ref.
    const elsewhere = StartProgram.within(tuples, sender, "window:w1");
    return [window, drive, stranger, View, OnWindow, elsewhere];
  };

  // L7. Plant: export `mint` from `Rebac.ts`; the first line then compiles. A proof is not a Schema
  // and has a key only `internal/proof.ts` holds, so a literal of its fields is not a proof.
  const checkSeal = () => {
    // @ts-expect-error No code outside the module mints a proof: `Rebac` does not export `mint`.
    const minted = Rebac.mint(sender, "start", "fabrika:demo", StartProgram);
    // @ts-expect-error A literal with a proof's visible fields is not a proof.
    const forged: Granted<typeof StartProgram> = { sender, permission: "start", object: "fabrika:demo" };
    // @ts-expect-error A forged proof cannot discharge the requirement either.
    const smuggled = needs.pipe(Rebac.provide({ sender, permission: "start", object: "fabrika:demo" }));
    // Review send-back: a spread of a real proof is built outside the module too, so it is no proof,
    // whatever it changes. Red on 5aa8a5e: the spread keeps the type's key, so each line compiles.
    // @ts-expect-error A spread copy of a real proof is not a proof.
    const copied: Granted<typeof StartProgram> = { ...proof };
    // @ts-expect-error A spread of a real proof moved to another object is not a proof of that object.
    const moved: Granted<typeof StartProgram> = { ...proof, object: "fabrika:other" };
    // @ts-expect-error A spread of a real proof with another sender is not a proof for that sender.
    const resent: Granted<typeof StartProgram> = { ...proof, sender };
    // @ts-expect-error A spread copy cannot discharge the requirement either.
    const respread = needs.pipe(Rebac.provide({ ...proof, object: "fabrika:other" }));
    return [minted, forged, smuggled, copied, moved, resent, respread];
  };
  return [discharged, wrong, keptRelations, keptBoth, widenedAway, checkNames, checkSeal];
};

it.prop(
  "T953 L5 to L7: every generated id makes a `type:id` ref of a declared type, and the right's types hold",
  [Schema.NonEmptyString],
  ([id]) => {
    expectTypeOf(checkTypes).toBeFunction(); // The function above stays uncalled.
    expect(Model.ref("fabrika", id)).toBe(`fabrika:${id}`);
    expect(Model.ref("person", id)).toBe(`person:${id}`);
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);
