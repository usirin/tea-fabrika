// Ticket 402, next/: type law. Both runner constructors require recovery options, and the
// runner's Layer needs ProcessManager. tsc checks the uncalled cases; the plant makes options
// optional again or reads ProcessManager with serviceOption, and `pnpm typecheck` fails.
import { Effect, type Layer } from "effect";
import { expectTypeOf, it } from "vitest";
import type { ProcessManager } from "../coordination/index.ts";
import { Writer } from "../coordination/index.ts";
import { storage } from "../processes/Process.test-support.ts";
import { ProgramRunner, type Descriptor } from "./Runner.ts";

type Needs<L> = L extends Layer.Layer<infer _Out, infer _E, infer In> ? In : never;

const descriptor: Descriptor = {
  id: "process_01m6v5270hf3c8x2q7w9z4k5mn",
  name: "counter:1",
  program: "counter",
  build: "build-a",
  owner: Writer.cases.person.make({
    key: "SHA256:fixture",
    for: "person_01m6v5270hf3c8x2q7w9z4k5mn",
  }),
};

const loader = { load: () => Effect.die("never loaded: the Layer is only typed") };

it("type: a runner without recovery options does not type-check, in either constructor", () => {
  const options = { recovery: { sql: storage().sql, name: "counter:1", capacity: 1024 ** 3 } };
  // Built, never run: the Layer's own type carries what it needs.
  const withLoader = ProgramRunner.withLoader(descriptor, loader, options);
  const layer = ProgramRunner.layer(descriptor, options);
  expectTypeOf(withLoader).toExtend<Layer.Layer<ProgramRunner, never, any>>();
  expectTypeOf(layer).toExtend<Layer.Layer<ProgramRunner, never, any>>();
  const uncalled = () => {
    // @ts-expect-error ticket 402: recovery options are required
    ProgramRunner.withLoader(descriptor, loader);
    // @ts-expect-error ticket 402: recovery options are required
    ProgramRunner.layer(descriptor);
    // @ts-expect-error ticket 402: undefined is not a set of recovery options
    ProgramRunner.withLoader(descriptor, loader, undefined);
    // @ts-expect-error ticket 402: recovery storage is required inside the options
    ProgramRunner.layer(descriptor, {});
  };
  expectTypeOf(uncalled).toBeFunction();
});

it("type: ProcessManager is a Layer requirement of both constructors", () => {
  const options = { recovery: { sql: storage().sql, name: "counter:1", capacity: 1024 ** 3 } };
  const withLoader = ProgramRunner.withLoader(descriptor, loader, options);
  const layer = ProgramRunner.layer(descriptor, options);
  expectTypeOf<Extract<Needs<typeof withLoader>, ProcessManager>>().not.toBeNever();
  expectTypeOf<Extract<Needs<typeof layer>, ProcessManager>>().not.toBeNever();
});
