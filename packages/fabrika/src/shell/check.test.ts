import {Effect, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {listed} from "../program/listed.ts";
import {defineProgram} from "../program/program.ts";
import {anyInput, input} from "../program/shape.ts";
import {check} from "./check.ts";
import {parse} from "./grammar.ts";
import {programList} from "./programs.ts";
import {SMALL} from "./small.ts";

// A name on the line is only ever a name the program declared. A flag, an
// input or an output is looked up as the program's own key, so a name every
// object has (`constructor`, `toString`, `__proto__`) is refused like any
// other name the program does not have, and never read as something else.

const list = programList(SMALL);

const checked = (line: string) => {
	const parsed = parse(line);
	if (parsed.kind !== "parsed") throw new Error(`parse refused: ${parsed.why}`);
	const [first] = parsed.statements;
	if (first?.kind !== "run") throw new Error("not a run");
	return check(first.pipeline, list, line);
};

const NAMES = ["constructor", "toString", "__proto__", "hasOwnProperty"];

describe("check: a name every object has is no name of the program's", () => {
	it.each(NAMES)("tally %s=1 is refused: tally has no such input", (name) => {
		expect(checked(`tally ${name}=1`)).toMatchObject({
			kind: "refused",
			at: 6,
			why: `tally has no input named ${name}`,
			status: 2,
		});
	});

	it.each(NAMES)("seq --%s 1 is refused: seq has no such flag", (name) => {
		expect(checked(`seq --${name} 1`)).toMatchObject({
			kind: "refused",
			at: 4,
			why: `seq has no flag --${name}`,
			status: 2,
		});
	});

	it.each(NAMES)("an output or an input named %s on a pipe is refused", (name) => {
		expect(checked(`seq --to 2 >${name} | double`)).toMatchObject({
			kind: "refused",
			why: `seq has no output named ${name}`,
		});
		expect(checked(`seq --to 2 | double <${name}`)).toMatchObject({
			kind: "refused",
			why: `double has no input named ${name}`,
		});
	});

	it("a name the program has still passes", () => {
		expect(checked("tally add=1").kind).toBe("line");
		expect(checked("seq --to 2 | double").kind).toBe("line");
	});
});

// An input that takes anything (`anyInput`), as `pv` sits in a pipe: fed only when no typed
// input fits, and then with the first output, as a Unix pipe carries stdout.

const sink = defineProgram({
	name: "sink",
	description: "Takes anything, and lets it go.",
	inputs: {any: anyInput("Anything.")},
	outputs: {},
	main: ({inputs}) => Stream.runDrain(inputs.any),
});
const both = defineProgram({
	name: "both",
	description: "Takes a number, or anything else.",
	inputs: {n: input(Schema.Int, "A number."), any: anyInput("Anything else.")},
	outputs: {},
	main: () => Effect.void,
});
const twice = defineProgram({
	name: "twice",
	description: "Two inputs that take anything.",
	inputs: {a: anyInput("Anything."), b: anyInput("Anything, again.")},
	outputs: {},
	main: () => Effect.void,
});
const withAny = programList([
	...SMALL,
	listed(sink, Layer.empty),
	listed(both, Layer.empty),
	listed(twice, Layer.empty),
]);

/** The wire of a line's first stage, or why it was refused. */
const wired = (line: string) => {
	const parsed = parse(line);
	if (parsed.kind !== "parsed") throw new Error(`parse refused: ${parsed.why}`);
	const [first] = parsed.statements;
	if (first?.kind !== "run") throw new Error("not a run");
	const c = check(first.pipeline, withAny, line);
	return c.kind === "line" ? c.line.stages[0].wire : c.kind === "refused" ? c.why : c.kind;
};

describe("check: an input that takes anything", () => {
	it("takes an output no typed input fits: seq's n, and tally's first output, total", () => {
		expect(wired("seq --to 3 | sink")).toEqual({output: "n", input: "any"});
		expect(wired("tally | sink")).toEqual({output: "total", input: "any"});
	});

	it("waits behind a typed fit: seq's n goes to both's n, not its any", () => {
		expect(wired("seq --to 3 | both")).toEqual({output: "n", input: "n"});
		expect(wired("say --text hi | both")).toEqual({output: "said", input: "any"});
	});

	it("takes a named output, and is the input named", () => {
		expect(wired("tally >refused | sink")).toEqual({output: "refused", input: "any"});
		expect(wired("seq --to 3 | both <any")).toEqual({output: "n", input: "any"});
	});

	it("is two ways when two such inputs could be fed: name one", () => {
		expect(wired("seq --to 3 | twice")).toMatch(/^more than one way to wire seq into twice/);
		expect(wired("seq --to 3 | twice <b")).toEqual({output: "n", input: "b"});
	});

	it("changes nothing for a program with none: seq still fits nothing of upper", () => {
		expect(wired("seq --to 3 | upper")).toMatch(/^does not fit/);
	});
});
