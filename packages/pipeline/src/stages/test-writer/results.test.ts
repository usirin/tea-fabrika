import {describe, expect, it} from "vitest";
import {type Report, resultsOf} from "./results.ts";

const TEST = {property: "p1", file: "a.test.ts", name: "says hi"};

const report = (entry: Report["testResults"][number]): Report => ({testResults: [entry]});

describe("resultsOf", () => {
	it("reads a test that ran", () => {
		const ran = (status: string) =>
			report({
				name: "/x/a.test.ts",
				assertionResults: [{title: "says hi", fullName: "s says hi", status}],
			});
		expect(resultsOf(ran("failed"), [TEST])).toEqual([{property: "p1", result: "red"}]);
		expect(resultsOf(ran("passed"), [TEST])).toEqual([{property: "p1", result: "green"}]);
		expect(resultsOf(ran("skipped"), [TEST])).toEqual([]);
	});

	it("reads a file that waits on code the build adds as red", () => {
		const message = "Error: Failed to resolve import ./a.ts from a.test.ts";
		const entry = {name: "/x/a.test.ts", status: "failed", message, assertionResults: []};
		expect(resultsOf(report(entry), [TEST])).toEqual([{property: "p1", result: "red"}]);
	});

	it("says nothing for a file that broke some other way, or a test it does not hold", () => {
		const broken = {
			name: "/x/a.test.ts",
			status: "failed",
			message: "SyntaxError: Unexpected token",
			assertionResults: [],
		};
		expect(resultsOf(report(broken), [TEST])).toEqual([]);
		expect(resultsOf({testResults: []}, [TEST])).toEqual([]);
	});
});
