// P18 slice 1, next/ (ticket 290): law L7 of the approved plan. One start for every client: the
// browser's `start` and `Headless.start` take the same window machine and need no Tuval and no React
// type, and a client's platform is exactly the hello's three words. Compiled by the type check; the
// test body only names the types.
import { expectTypeOf, it } from "@effect/vitest";
import type { Hello } from "../transport/Wire.ts";
import type * as Headless from "./Headless.ts";
import type { windowMachineFor } from "./WindowMachine.ts";
import type { ClientInfo, start } from "./WindowStart.ts";

type Options = Parameters<typeof start>[0];
type HeadlessOptions = Parameters<typeof Headless.start>[0];

it("format: start and Headless.start take the same machine and no React or Tuval type, and ClientInfo.platform is the hello's platform", () => {
  expectTypeOf<Options["window"]>().toEqualTypeOf<ReturnType<typeof windowMachineFor>>();
  expectTypeOf<HeadlessOptions["window"]>().toEqualTypeOf<Options["window"]>();
  expectTypeOf<HeadlessOptions["tiles"]>().toEqualTypeOf<Options["tiles"]>();
  expectTypeOf<HeadlessOptions["origin"]>().toEqualTypeOf<string>();
  // Headless is the start with its client facts filled in: nothing the caller passes names a platform.
  expectTypeOf<"client" extends keyof HeadlessOptions ? true : false>().toEqualTypeOf<false>();
  // Every option is plain data or the machine: no element, node or component.
  expectTypeOf<Options["origin"] | Options["build"]>().toEqualTypeOf<string>();
  expectTypeOf<keyof Options>().toEqualTypeOf<"tiles" | "window" | "origin" | "build" | "client">();
  expectTypeOf<(typeof ClientInfo.Type)["platform"]>().toEqualTypeOf<(typeof Hello.Type)["platform"]>();
  expectTypeOf<(typeof ClientInfo.Type)["platform"]>().toEqualTypeOf<"browser" | "electron" | "headless">();
  expectTypeOf<string>().not.toExtend<(typeof ClientInfo.Type)["platform"]>();
});
