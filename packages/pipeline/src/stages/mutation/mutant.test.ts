import {describe, expect, it} from "vitest";
import {mutantsWriter} from "../test-writer/brief.ts";
import {answeredProblems} from "../test-writer/mutants.ts";
import {idOf, type Lived} from "./mutant.ts";

// A mutant's id: the writer answers each mutant by it, so two mutants must
// never share one.

const at = {file: "clamp.ts", line: 12, column: 6};

/** Two mutants Stryker makes at one place in the fixture, both of which live. */
const two: readonly Lived[] = [
	{
		mutant: idOf({...at, mutator: "ConditionalExpression", replacement: "false"}),
		mutator: "ConditionalExpression",
		original: "n > high",
		replacement: "false",
	},
	{
		mutant: idOf({...at, mutator: "EqualityOperator", replacement: "n >= high"}),
		mutator: "EqualityOperator",
		original: "n > high",
		replacement: "n >= high",
	},
];

describe("a mutant's id", () => {
	it("is the same for the same mutant, and tells two mutants at one place apart", () => {
		const one = {...at, mutator: "EqualityOperator", replacement: "n >= high"};
		expect(idOf(one)).toBe(idOf({...one}));
		expect(idOf(one)).toMatch(/^clamp\.ts:12:6:[0-9a-f]{6}$/);
		expect(two[0]?.mutant).not.toBe(two[1]?.mutant);
	});

	it("lets the writer answer two mutants at one place, one answer each", () => {
		const brief = mutantsWriter.fill({
			ticket: "t",
			head: "h",
			lived: two,
			includes: ["**/*.test.ts"],
			taken: [],
		});
		const answers = two.map((m) => ({
			mutant: m.mutant,
			answer: "cannot" as const,
			why: `no test tells ${m.replacement} apart`,
		}));
		expect(answeredProblems({files: [], answers}, brief)).toEqual([]);
	});
});
