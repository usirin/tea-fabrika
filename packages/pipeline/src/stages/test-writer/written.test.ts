import {describe, expect, it} from "vitest";
import {writer} from "./brief.ts";
import {testsOf} from "./checked.ts";
import {ASK, GOOD, pid, TAKEN} from "./scripted.ts";
import {DEFAULT_INCLUDES, includedBy, problemsOf, type Written} from "./written.ts";

const {tries: _, ...asked} = ASK;
const brief = writer.fill({...asked, taken: TAKEN});
const check = (written: Written) => problemsOf(written, brief);

describe("the Check on the writer's draft", () => {
	it("passes new test files inside `includes`, one answer per Property", () => {
		expect(check(GOOD)).toEqual([]);
		expect(
			check({
				...GOOD,
				files: [...GOOD.files, {path: "fixtures/lane/one-child.json", text: "{}"}],
			}),
		).toEqual([]);
	});

	it("refuses a change to a file that exists, product code or a test", () => {
		const edit: Written = {
			...GOOD,
			files: [
				...GOOD.files,
				{path: "packages/pipeline/src/hosted/lane.test.ts", text: "changed"},
				{path: "packages/pipeline/src/hosted/lane.ts", text: "changed"},
			],
		};
		expect(check(edit)).toEqual([
			"`packages/pipeline/src/hosted/lane.test.ts` exists already. Never change a file that exists: add a new one.",
			"`packages/pipeline/src/hosted/lane.ts` is outside what you may write. A new file must match one of: **/*.test.ts, fixtures/**.",
		]);
	});

	it("refuses a path that leaves the repository, or a file written twice", () => {
		const bad: Written = {
			...GOOD,
			files: [
				...GOOD.files,
				...GOOD.files,
				{path: "../x.test.ts", text: ""},
				{path: "/etc/x.test.ts", text: ""},
			],
		};
		expect(check(bad)).toEqual([
			"`packages/pipeline/src/hosted/lane-ends.test.ts` is written twice. Hand each file back once.",
			"`../x.test.ts` is not a plain path inside the repository.",
			"`/etc/x.test.ts` is not a plain path inside the repository.",
		]);
	});

	it("asks for one answer per Property of this plan, and a test in a file it wrote", () => {
		const [one, two] = testsOf(GOOD.answers);
		if (one === undefined || two === undefined) throw new Error("GOOD has two answers");
		expect(check({...GOOD, answers: [one]})).toEqual([
			"p2 has no answer. Write its test, or say why none can check it.",
		]);
		expect(check({...GOOD, answers: [one, one, two]})).toEqual(["p1 has 2 answers. Give it one."]);
		expect(
			check({...GOOD, answers: [one, two, {property: pid("p9"), kind: "cannot", why: "?"}]}),
		).toEqual(["p9 is not a Property of this plan."]);
		expect(check({...GOOD, answers: [{...one, file: "elsewhere.test.ts"}, two]})).toEqual([
			"p1's test is in `elsewhere.test.ts`, which is not among the files you wrote.",
		]);
	});

	it("reads the default `includes` the way CODEOWNERS reads a row", () => {
		const included = includedBy(DEFAULT_INCLUDES);
		expect(included("a.test.ts")).toBe(true);
		expect(included("packages/x/src/a.test.ts")).toBe(true);
		expect(included("fixtures/a/b.json")).toBe(true);
		expect(included("packages/x/fixtures/a.json")).toBe(false);
		expect(included("packages/x/src/a.ts")).toBe(false);
		expect(included("a.test.tsx")).toBe(false);
	});
});
