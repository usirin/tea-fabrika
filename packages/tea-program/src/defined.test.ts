import {Cause, Effect, Exit, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {call, defineProgram, listing, pipe, start} from "./program";
import {input, output} from "./shape";

// A program comes from `defineProgram` or it does not run. `defineProgram`
// refuses a blank name or description, a kind with no status line, and a
// parent that is no machine of the program; a program object built by hand
// skips every one of those. The types refuse one (it has no mark only
// `defineProgram` gives), and `start`, `pipe` and `call` refuse one at run
// time too, for a caller past the types: a copy made with `{...program}`
// keeps the type but is not the object `defineProgram` made.

const echo = defineProgram({
	name: "echo",
	description: "Sends back each word it is told.",
	inputs: {word: input(Schema.String, "A word.")},
	outputs: {said: output(Schema.String, "The word, sent back.")},
	main: () => Effect.void,
});

/** The same fields as `echo`, with a blank name and a kind with no status line: what `defineProgram` refuses. */
const handBuilt = {
	name: "",
	description: "",
	flags: {},
	inputs: echo.inputs,
	outputs: echo.outputs,
	machines: {tally: {parent: "main"}},
	main: () => Effect.void,
};

const why = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "it ran";

describe("a program not made by defineProgram", () => {
	it("is refused by the types", () => {
		const refused = () => [
			// @ts-expect-error A program built by hand has no mark from defineProgram.
			start(handBuilt, {}, {}, {id: "x", storage: undefined as never}),
			// @ts-expect-error The same for call.
			call(handBuilt, {}),
		];
		expect(typeof refused).toBe("function");
	});

	it("dies at start, before main runs, when it got past the types", async () => {
		let ran = false;
		const sneaked = {...handBuilt, machines: {}, main: () => Effect.sync(() => (ran = true))};
		const exit = await Effect.runPromiseExit(
			// @ts-expect-error As from plain JavaScript.
			start(sneaked, {}).pipe(Effect.scoped),
		);
		expect(ran).toBe(false);
		expect(why(exit)).toContain("was not made by defineProgram");
	});

	it("a copy of a defined program, changed with a spread, keeps the type and still dies at start", async () => {
		let ran = false;
		const copy = {...echo, name: "", main: () => Effect.sync(() => (ran = true))};
		const exit = await Effect.runPromiseExit(start(copy, {}).pipe(Effect.scoped));
		expect(ran).toBe(false);
		expect(why(exit)).toContain("was not made by defineProgram");
	});

	it("call and pipe refuse one the same way", async () => {
		const copy = {...echo};
		const called = await Effect.runPromiseExit(call(copy, {}));
		expect(why(called)).toContain("was not made by defineProgram");
		const piped = await Effect.runPromiseExit(
			Effect.gen(function* () {
				const to = yield* start(echo, {});
				if (to.kind !== "running") return;
				yield* pipe({program: copy, flags: {}}, "said", to, "word");
			}).pipe(Effect.scoped),
		);
		expect(why(piped)).toContain("was not made by defineProgram");
	});

	it("a program defined from another one's fields, through defineProgram, runs", async () => {
		const again = defineProgram({...echo, name: "echo-again"});
		const called = await Effect.runPromise(call(again, {}));
		expect(called.kind).toBe("called");
		expect(listing(again).name).toBe("echo-again");
	});
});
