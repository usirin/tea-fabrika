// T518, PR 1, next/. Compile the exact bad expressions; never execute them.
import {expect, expectTypeOf, it} from "@effect/vitest";
import {Id} from "@kampus/libfabrika";
import {type Context, Effect, Schema, type SchemaIssue} from "effect";
import * as fc from "fast-check";
import type {ProcessIdGenerator} from "./coordination/process-id.ts";
import type {ProcessId as TraceProcessId} from "./data/trace.ts";

const checkTypes = (raw: string) => {
	const ProcessId = Id.make("process");
	const LetterId = Id.make("letter");
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
		expectTypeOf(process).toEqualTypeOf<Effect.Effect<typeof ProcessId.Type>>();
		expectTypeOf(letter).toEqualTypeOf<Effect.Effect<typeof LetterId.Type>>();
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
	void checkBrands;
	return {checkGenerator, made, decoded};
};

it("exports the Id factory from the public package for generated client prefixes", () => {
	fc.assert(
		fc.property(
			fc
				.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), {minLength: 1, maxLength: 63})
				.map((chars) => chars.join("")),
			(type) => {
				expectTypeOf(checkTypes).toBeFunction(); // The function above stays uncalled.
				expect(Schema.isSchema(Id.make(type))).toBe(true);
			},
		),
		{seed: 119120, numRuns: 100},
	);
});
