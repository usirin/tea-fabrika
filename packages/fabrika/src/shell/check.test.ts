import {describe, expect, it} from "vitest";
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
