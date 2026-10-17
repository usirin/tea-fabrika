import {Context, Effect, Exit, Layer, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {defineProgram, listing, readInputs, start} from "./program.ts";
import {input, output} from "./shape.ts";

// The program shape on a toy: inputs checked before `main` runs, outputs
// heard in the order they were sent, services from the caller's Layers, and
// the listing a host shows. The ship program (src/stages/ship/program.test.ts)
// is the real one.

/** A service the toy asks for through Effect's context. A test provides it. */
class Clock extends Context.Service<Clock, {readonly now: () => number}>()("ToyClock") {}

const greeter = defineProgram({
	name: "greeter",
	description: "Greets each name it is given, and says the time it did.",
	inputs: {
		names: input(
			Schema.Array(Schema.String.check(Schema.isPattern(/^[a-z]+$/))),
			"The names to greet, in order, in small letters.",
		),
		loud: input(Schema.Boolean, "Shout the greeting."),
	},
	outputs: {
		// Finite and Int, not Number: Effect 4.0.0 writes Number's JSON Schema as a number or the strings "NaN", "Infinity", "-Infinity".
		greeting: output(Schema.Struct({text: Schema.String, at: Schema.Finite}), "One greeting."),
		count: output(Schema.Int, "How many greetings, once, at the end."),
	},
	main: ({names, loud}, send) =>
		Effect.gen(function* () {
			const clock = yield* Clock;
			for (const name of names) {
				const text = `hello, ${name}`;
				yield* send("greeting", {text: loud ? text.toUpperCase() : text, at: clock.now()});
			}
			yield* send("count", names.length);
		}),
});
const at42 = Layer.succeed(Clock, {now: () => 42});

describe("start", () => {
	it("runs main with the typed inputs, its services from the caller, and hears each output in order", async () => {
		const heard: unknown[] = [];
		const started = await Effect.runPromise(
			start(
				greeter,
				{names: ["ada", "alan", "grace"], loud: false},
				{
					greeting: (g) => heard.push(g.text),
					count: (n) => heard.push(n),
				},
			).pipe(Effect.provide(at42)),
		);

		expect(started).toEqual({kind: "ran"});
		expect(heard).toEqual(["hello, ada", "hello, alan", "hello, grace", 3]);
	});

	it("an output nobody listens to is sent all the same", async () => {
		const heard: number[] = [];
		await Effect.runPromise(
			start(greeter, {names: ["ada"], loud: true}, {count: (n) => heard.push(n)}).pipe(
				Effect.provide(at42),
			),
		);
		expect(heard).toEqual([1]);
	});

	it("bad_shape: a typed input that fails a check its type cannot hold names itself and says why, and main never runs", async () => {
		const ran: string[] = [];
		const watched = defineProgram({
			...greeter,
			main: () => Effect.sync(() => ran.push("main")),
		});

		const started = await Effect.runPromise(start(watched, {names: ["ada", "Alan"], loud: false}));

		expect(started).toMatchObject({kind: "bad_shape", input: "names"});
		expect(started.kind === "bad_shape" && started.why).toMatch(/\[1\]/);
		expect(ran).toEqual([]);
	});
});

describe("reading inputs from outside", () => {
	it("a host's JSON: the typed inputs, or the first that does not fit", () => {
		expect(readInputs(greeter, {names: ["ada"], loud: true})).toEqual({
			kind: "given",
			given: {names: ["ada"], loud: true},
		});
		expect(readInputs(greeter, {names: ["ada", 7], loud: true})).toMatchObject({
			kind: "bad_shape",
			input: "names",
		});
		expect(readInputs(greeter, {names: []})).toMatchObject({kind: "bad_shape", input: "loud"});
		expect(readInputs(greeter, {names: [], loud: true, colour: "red"})).toEqual({
			kind: "bad_shape",
			input: "colour",
			why: "greeter has no input named colour",
		});
		expect(readInputs(greeter, ["ada"])).toMatchObject({kind: "bad_shape", input: ""});
	});
});

describe("outputs", () => {
	it("a value the program's own output refuses is a bug in the program: it dies, and says which output", async () => {
		const liar = defineProgram({
			...greeter,
			main: (_given, send) => send("count", 1.5),
		});
		const exit = await Effect.runPromiseExit(start(liar, {names: [], loud: false}));

		expect(Exit.isFailure(exit)).toBe(true);
		expect(String(exit)).toMatch(/greeter sent its output count a value it does not take/);
	});

	it("a blank name or description is refused when the program is defined", () => {
		expect(() => defineProgram({...greeter, name: " "})).toThrow(/name/);
		expect(() => defineProgram({...greeter, description: ""})).toThrow(/description/);
	});
});

describe("listing", () => {
	it("gives the name, the description, and each input and output with its JSON Schema", () => {
		expect(listing(greeter)).toEqual({
			name: "greeter",
			description: "Greets each name it is given, and says the time it did.",
			inputs: [
				{
					name: "names",
					description: "The names to greet, in order, in small letters.",
					// The pattern is not here: Effect 4.0.0 leaves patterns out of JSON Schema.
					schema: {type: "array", items: {type: "string"}},
				},
				{name: "loud", description: "Shout the greeting.", schema: {type: "boolean"}},
			],
			outputs: [
				{
					name: "greeting",
					description: "One greeting.",
					schema: {
						type: "object",
						properties: {text: {type: "string"}, at: {type: "number"}},
						required: ["text", "at"],
						additionalProperties: false,
					},
				},
				{
					name: "count",
					description: "How many greetings, once, at the end.",
					schema: {type: "integer"},
				},
			],
		});
	});
});
