import {describe, expect, it} from "vitest";
import {EMPTY, type Jobs} from "../host/jobs.ts";
import {check} from "./check.ts";
import {complete} from "./complete.ts";
import {parse} from "./grammar.ts";
import {programList} from "./programs.ts";
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
const checkedAt = (line: string): number | null => {
	const parsed = parse(line);
	const [first] = parsed.kind === "parsed" ? parsed.statements : [];
	if (first?.kind !== "run") throw new Error(`not one pipeline: ${line}`);
	const checked = check(first.pipeline, list, line);
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
		["nope | ", [...list.keys()]],
		["seq --to $(", [...list.keys()]],
	])("completes %j", (line, want) => {
		expect(candidates(line)).toEqual(want);
	});

	it.each(["seq --to 3", "say --text hi", "double n=1", "sleep --ms 1"])(
		"after %j | offers exactly the programs the checker wires there",
		(before) => {
			const offered = candidates(`${before} | `);
			for (const next of list.keys()) {
				const line = `${before} | ${next}`;
				const refusedAtBar = checkedAt(line) === before.length + 1;
				expect(offered.includes(next), line).toBe(!refusedAtBar);
			}
		},
	);
});
