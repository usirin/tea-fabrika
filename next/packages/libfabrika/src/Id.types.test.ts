// T518, PR 1, next/. Compile the exact bad expressions; never execute them.
import { expect, expectTypeOf, it } from "@effect/vitest";
import { Id } from "@kampus/libfabrika";
import type { IdError, IdSchema, IdValue } from "@kampus/libfabrika";
import type * as Public from "@kampus/libfabrika";
import type * as Data from "@kampus/libfabrika/data";
import { type Context, Effect, Schema, type SchemaIssue } from "effect";
import * as fc from "fast-check";
import type { ProcessIdGenerator } from "./processes/ProcessIdGenerator.ts";
import type { ProcessId as TraceProcessId } from "./ProcessId.ts";

const checkTypes = (raw: string) => {
  const ProcessId = Id.make("process");
  const LetterId = Id.make("letter");
  const InputId = Id.make("input");
  const ChaosId = Id.make("chaos");
  expectTypeOf<typeof InputId.Type>().toEqualTypeOf<IdValue<"input">>();
  expectTypeOf<typeof ChaosId.Type>().toEqualTypeOf<IdValue<"chaos">>();
  expectTypeOf<typeof InputId.Type>().not.toEqualTypeOf<string>();
  expectTypeOf<typeof InputId.Type>().not.toEqualTypeOf<typeof ChaosId.Type>();
  const checkInput = (input: typeof InputId.Type, raw: string) => {
    // @ts-expect-error An input id cannot stand for a chaos experiment.
    const wrong: typeof ChaosId.Type = input;
    // @ts-expect-error An outside string is not a checked input id.
    const unchecked: typeof input = raw;
    return [wrong, unchecked];
  };
  expectTypeOf<IdSchema<"input">["Type"]>().toEqualTypeOf<typeof InputId.Type>();
  expectTypeOf<Id.IdSchema<"input">>().toEqualTypeOf<IdSchema<"input">>();
  expectTypeOf<Id.IdValue<"input">>().toEqualTypeOf<IdValue<"input">>();
  expectTypeOf<Data.IdSchema<"input">>().toEqualTypeOf<IdSchema<"input">>();
  expectTypeOf<Data.IdValue<"input">>().toEqualTypeOf<IdValue<"input">>();
  expectTypeOf<Data.IdError>().toEqualTypeOf<IdError>();
  expectTypeOf<Id.IdError>().toEqualTypeOf<IdError>();
  expectTypeOf<"IdGenerator" extends keyof typeof Public ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"IdGenerator" extends keyof typeof Data ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"IdGenerator" extends keyof typeof Id ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<typeof Id.InputId.Type>().toEqualTypeOf<IdValue<"input">>();
  const takeProcess = (_id: typeof ProcessId.Type): void => {};
  const takeLetter = (_id: typeof LetterId.Type): void => {};
  const checkBrands = (process: typeof ProcessId.Type, letter: typeof LetterId.Type) => {
    expectTypeOf<typeof ProcessId.Type>().not.toBeAny();
    expectTypeOf<typeof LetterId.Type>().not.toBeAny();
    expectTypeOf<typeof ProcessId.Type>().not.toEqualTypeOf<typeof LetterId.Type>();
    takeProcess(process);
    // @ts-expect-error A letter cannot name a process.
    takeProcess(letter);
    takeLetter(letter);
    // @ts-expect-error A process cannot name a letter.
    takeLetter(process);
    takeProcess(ProcessId.make(raw));
    // @ts-expect-error An unchecked string has no process brand.
    takeProcess(raw);
    // A6 keeps the existing process API unbranded until PR 2.
    expectTypeOf<typeof TraceProcessId.Type>().toEqualTypeOf<string>();
    expectTypeOf<Context.Service.Shape<typeof ProcessIdGenerator>["next"]>().toEqualTypeOf<
      Effect.Effect<typeof TraceProcessId.Type>
    >();
  };
  const checkGenerator = Effect.gen(function* () {
    const generator = yield* Id.Generator;
    const process = generator.next(ProcessId);
    const letter = generator.next(LetterId);
    expectTypeOf(process).toEqualTypeOf<Effect.Effect<typeof ProcessId.Type, IdError>>();
    expectTypeOf(letter).toEqualTypeOf<Effect.Effect<typeof LetterId.Type, IdError>>();
    expectTypeOf(generator.next(InputId)).toEqualTypeOf<Effect.Effect<typeof InputId.Type, IdError>>();
    expectTypeOf(generator.next(ChaosId)).toEqualTypeOf<Effect.Effect<typeof ChaosId.Type, IdError>>();
    const value = yield* process;
    takeProcess(value);
    // @ts-expect-error next(ProcessId) preserves the process brand.
    takeLetter(value);
    return yield* letter;
  });
  const made = ProcessId.makeEffect(raw);
  const decoded = Schema.decodeUnknownEffect(ProcessId)(raw);
  expectTypeOf(made).toEqualTypeOf<Effect.Effect<typeof ProcessId.Type, SchemaIssue.Issue>>();
  expectTypeOf(decoded).toEqualTypeOf<Effect.Effect<typeof ProcessId.Type, Schema.SchemaError>>();
  expectTypeOf(Id.makeEffect("process")).toEqualTypeOf<Effect.Effect<typeof ProcessId, IdError>>();
  void checkBrands;
  void checkInput;
  return { checkGenerator, made, decoded };
};

it("exports the Id factory from the public package for generated client prefixes", () => {
  fc.assert(
    fc.property(
      fc
        .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 1, maxLength: 63 })
        .map((chars) => chars.join("")),
      (type) => {
        expectTypeOf(checkTypes).toBeFunction(); // The function above stays uncalled.
        expect(Schema.isSchema(Id.make(type))).toBe(true);
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});
