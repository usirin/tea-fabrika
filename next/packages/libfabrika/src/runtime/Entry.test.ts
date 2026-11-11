// P11, next/. A watcher cannot silently turn an unchecked view into a typed value.
import { expectTypeOf, it } from "@effect/vitest";
import { type View } from "./Entry.ts";
import { type Opened } from "./Runner.ts";

it("type law, plant View = any: views require decoding before use", () => {
  expectTypeOf<View>().not.toBeAny();
  expectTypeOf<Opened["view"]>().not.toBeAny();
  // @ts-expect-error plant: an erased JSON decoder result must fail the same law
  expectTypeOf<ReturnType<typeof JSON.parse>>().not.toBeAny();
});
