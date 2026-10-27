import {describe, expect, it} from "vitest";
import {complete} from "./complete.ts";
import {EMPTY, type Jobs} from "./jobs.ts";
import {programList} from "./programs.ts";
import {SMALL} from "./small.ts";

// Tab completion on a name the program does not declare offers nothing. A
// name every object has (`constructor`, `toString`, `__proto__`) is such a
// name too: it is looked up as the program's own key, never read as
// something else.

const list = programList(SMALL);
const TALLY: Jobs = {
	jobs: [
		{
			n: 1,
			text: "tally",
			stages: [{program: "tally", flags: {}, run: "tally:0a1b2c3d", wire: null, ended: false}],
			state: "running",
			background: true,
		},
	],
};
const candidates = (line: string, jobs: Jobs = EMPTY) => complete(line, list, jobs).candidates;

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
