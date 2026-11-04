import {Effect, Layer, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {EMPTY, type Jobs} from "../host/jobs.ts";
import {listed} from "../program/listed.ts";
import {defineProgram} from "../program/program.ts";
import {anyInput, input, output} from "../program/shape.ts";
import {check} from "./check.ts";
import {complete} from "./complete.ts";
import {parse} from "./grammar.ts";
import {type ProgramList, programList} from "./programs.ts";
import {SMALL} from "./small.ts";

// Tab completion on a name the program does not declare offers nothing. A
// name every object has (`constructor`, `toString`, `__proto__`) is such a
// name too: it is looked up as the program's own key, never read as
// something else.

const list = programList(SMALL);
const TALLY: Jobs = {
	next: 2,
	jobs: [
		{
			n: 1,
			text: "tally",
			stages: [{program: "tally", flags: {}, run: "tally:0a1b2c3d", wire: null, ended: false}],
			state: "running",
			background: true,
			owner: null,
		},
	],
};
const candidates = (line: string, jobs: Jobs = EMPTY) => complete(line, list, jobs).candidates;

/** Where the checker refuses the line, or `null` when it does not. */
const checkedAt = (line: string, programs: ProgramList = list): number | null => {
	const parsed = parse(line);
	const [first] = parsed.kind === "parsed" ? parsed.statements : [];
	if (first?.kind !== "run") throw new Error(`not one pipeline: ${line}`);
	const checked = check(first.pipeline, programs, line);
	return checked.kind === "refused" ? checked.at : null;
};

describe("Tab completion on a name every object has", () => {
	it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
		"offers nothing for %s as a flag, an input, or an input of a job",
		(name) => {
			expect(candidates(`seq --${name} `)).toEqual([]);
			expect(candidates(`seq --${name}=`)).toEqual([]);
			expect(candidates(`tally ${name}=`)).toEqual([]);
			expect(candidates(`tell %1 ${name} `, TALLY)).toEqual([]);
		},
	);

	it("still offers the names the program has", () => {
		expect(candidates("seq --t")).toEqual(["--to"]);
		expect(candidates("tally a")).toEqual(["add="]);
		expect(candidates("tell %1 ", TALLY)).toEqual(["add"]);
	});
});

// After `|`, Tab offers only the programs the stage before can feed: the same
// fit the checker wires a pipe by, so what Tab offers is not refused at the `|`.
describe("Tab completion after a pipe", () => {
	it.each([
		["seq --to 3 | ", ["double", "tally"]],
		["say --text hi | ", ["upper"]],
		["seq --to 3 | double | ", ["double", "tally"]],
		["seq --to 3 >n | ", ["double", "tally"]],
		["seq --to 3 >nope | ", []],
		["sleep | ", []],
		["double n=1 | t", ["tally"]],
		["upper text=$(say --text hi) | ", ["upper"]],
		['say --text ">hi" | ', ["upper"]],
		['say --text "a | b" | ', ["upper"]],
		["nope | ", [...list.keys()]],
		["seq --to $(", [...list.keys()]],
	])("completes %j", (line, want) => {
		expect(candidates(line)).toEqual(want);
	});

	it.each(["seq --to 3", "seq --to 3 >n", "say --text hi", "double n=1", "sleep --ms 1"])(
		"after %j | offers exactly the programs the checker wires there, as typed or with <in",
		(before) => expectSameAsChecker(before, list),
	);

	// Inputs that take anything, and two ways to wire one pipe: the cases where a looser rule
	// than the checker's would offer a program the checker then refuses at the |.
	type Spec = Parameters<typeof defineProgram>[0];
	const program = (name: string, inputs: Spec["inputs"], outputs: Spec["outputs"] = {}) =>
		listed(
			defineProgram({name, description: name, inputs, outputs, main: () => Effect.void}),
			Layer.empty,
		);
	const wider = programList([
		...SMALL,
		program("sink", {any: anyInput("Anything.")}),
		program("both", {n: input(Schema.Int, "A number."), any: anyInput("Anything else.")}),
		program("twice", {a: anyInput("Anything."), b: anyInput("Anything, again.")}),
		program("pair", {a: input(Schema.Int, "A number."), b: input(Schema.Int, "Another.")}),
		program("two", {}, {a: output(Schema.Int, "A number."), b: output(Schema.Int, "Another.")}),
	]);

	it.each(["seq --to 3", "say --text hi", "sleep --ms 1", "two", "two >a"])(
		"after %j | with inputs that take anything, offers exactly what the checker wires",
		(before) => expectSameAsChecker(before, wider),
	);

	it("offers a program two ways fit when <in picks one, and not when only >out could", () => {
		expect(complete("seq --to 3 | p", wider, EMPTY).candidates).toEqual(["pair"]);
		expect(complete("two | d", wider, EMPTY).candidates).toEqual([]);
		expect(complete("two >a | d", wider, EMPTY).candidates).toEqual(["double"]);
	});
});

/** Tab after `before |` offers a program exactly when the checker wires it there, as typed or with one `<in`. */
function expectSameAsChecker(before: string, programs: ProgramList) {
	const offered = complete(`${before} | `, programs, EMPTY).candidates;
	for (const [next, entry] of programs) {
		const ways = [next, ...Object.keys(entry.program.inputs).map((i) => `${next} <${i}`)];
		const wires = ways.some(
			(way) => checkedAt(`${before} | ${way}`, programs) !== before.length + 1,
		);
		expect(offered.includes(next), `${before} | ${next}`).toBe(wires);
	}
}
