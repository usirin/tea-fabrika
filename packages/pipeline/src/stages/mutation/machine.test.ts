import {describe, expect, it} from "vitest";
import {nameOf} from "../outcome.ts";
import {readScope, runMutants, runTests} from "./machine.ts";
import {changesOf, hashOf, type Scope} from "./scope.ts";
import {ASK, drive, HEAD, KILLED_ALL, LIVED, ONE_LIVED, SCOPE} from "./scripted.ts";

// The mutation step on fakes of its services: every branch, the Cmds it
// sends, and the report the lane reads.

const DISABLE =
	"\t// Stryker disable next-line EqualityOperator: n equal to low returns low either way";

describe("the mutation step", () => {
	it("runs the repo's own tests first, then Stryker over the changed source lines and the kept Property's code", () => {
		const {over, cmds} = drive({});
		expect(cmds.map((c) => c.type)).toEqual(["mutation_scope", "mutation_tests", "mutation_run"]);
		expect(cmds[1]).toEqual(runTests({head: HEAD}));
		// The test file's added line is not mutated; the added lines sit inside the kept code's.
		expect(cmds[2]).toEqual(
			runMutants({
				head: HEAD,
				spans: [{file: "src/clamp.ts", from: 9, to: 14}],
				seed: 49,
				most: 150,
			}),
		);
		expect(over.phase === "over" && nameOf(over.outcome)).toBe("done");
		expect(over.phase === "over" && over.report.ran).toEqual(KILLED_ALL);
	});

	it("sends a mutant the weak test let live to the test writer, with the mutant in the report", () => {
		const {over} = drive({run: ONE_LIVED});
		if (over.phase !== "over") throw new Error("over");
		expect(nameOf(over.outcome)).toBe("send:test_writer:mutant_survived");
		expect(over.report.ran?.lived).toEqual([LIVED]);
	});

	it("asks the owner about a disable comment the diff adds, quoted, before anything runs", () => {
		const added = {file: "src/clamp.ts", line: 11, text: DISABLE};
		const scope = {...SCOPE, diff: {...SCOPE.diff, added: [...SCOPE.diff.added, added]}};
		const {over, cmds} = drive({scope});
		if (over.phase !== "over") throw new Error("over");
		expect(nameOf(over.outcome)).toBe("ask:owner:check_change");
		expect(over.report.changes).toEqual([{kind: "disable", ...added, text: DISABLE.trim()}]);
		expect(cmds.map((c) => c.type)).toEqual(["mutation_scope"]);
	});

	it("asks the owner when the diff edits the skip list", () => {
		const exam = "packages/pipeline/src/stages/mutation/skip-list.ts";
		const scope = {...SCOPE, diff: {...SCOPE.diff, files: [...SCOPE.diff.files, exam]}};
		const {over} = drive({scope});
		if (over.phase !== "over") throw new Error("over");
		expect(nameOf(over.outcome)).toBe("ask:owner:check_change");
		// The read gave no hash for it, so no yes could hold.
		expect(over.report.changes).toEqual([{kind: "exam", file: exam, hash: null}]);
	});

	it("reads each file of the exam at the head, with the diff", () => {
		const {cmds} = drive({});
		expect(cmds[0]).toEqual(
			readScope({base: ASK.base, head: HEAD, kept: ASK.kept, exam: ASK.exam}),
		);
	});

	describe("a yes to a skip-list edit holds for its contents at the head only", () => {
		const file = "skip-list.ts";
		/** The diff touches the skip list; `added` is what it adds, `contents` how the file reads after. */
		const edit = (contents: string, added: readonly string[]) => ({
			...SCOPE,
			diff: {files: [file], added: added.map((text, i) => ({file, line: i + 1, text}))},
			exam: [{file, hash: hashOf(contents)}],
		});
		const line = "export const logs = /^debug:/;";
		const approved = edit(`export const keep = /^error:/;\n${line}\n`, [line]);
		const ask = {...ASK, exam: [file], allowed: changesOf(approved, [file])};
		const name = (scope: Scope) => {
			const {over} = drive({scope}, ask);
			return over.phase === "over" && nameOf(over.outcome);
		};

		it("runs on the contents the owner said yes to", () => {
			expect(name(approved)).toBe("done");
		});

		it("asks again after an edit that adds a line", () => {
			const all = "export const all = /./;";
			expect(name(edit(`export const keep = /^error:/;\n${all}\n`, [all]))).toBe(
				"ask:owner:check_change",
			);
		});

		it("asks again after an edit that only deletes a line", () => {
			// The same lines added; only the contents at the head tell the edit apart.
			expect(name(edit(`${line}\n`, [line]))).toBe("ask:owner:check_change");
		});

		it("asks again when the file is gone at the head", () => {
			expect(name({...approved, exam: [{file, hash: null}]})).toBe("ask:owner:check_change");
		});
	});

	it("runs once the owner said yes to the change, even after the line moved", () => {
		const added = {file: "src/clamp.ts", line: 11, text: DISABLE};
		const scope = {...SCOPE, diff: {...SCOPE.diff, added: [...SCOPE.diff.added, added]}};
		const allowed = [
			{kind: "disable" as const, file: "src/clamp.ts", line: 30, text: DISABLE.trim()},
		];
		const {over} = drive({scope}, {...ASK, allowed});
		expect(over.phase === "over" && nameOf(over.outcome)).toBe("done");
	});

	it("skips when no source line changed and no kept Property covers one", () => {
		const scope = {
			diff: {files: ["README.md"], added: [{file: "README.md", line: 1, text: "# hi"}]},
			kept: [],
			exam: [],
		};
		const {over, cmds} = drive({scope}, {...ASK, kept: []});
		expect(over.phase === "over" && nameOf(over.outcome)).toBe("skip:no_lines");
		expect(cmds).toHaveLength(1);
	});

	it("is stuck, never guessing, when the diff cannot be read, the tests are red, or a run fails", () => {
		const name = (script: Parameters<typeof drive>[0]) => {
			const {over} = drive(script);
			return over.phase === "over" ? nameOf(over.outcome) : over.phase;
		};
		expect(name({scope: "fail"})).toBe("stuck:read_failed");
		expect(name({tests: "red"})).toBe("stuck:tests_red");
		expect(name({tests: "fail"})).toBe("stuck:run_failed");
		expect(name({run: "fail"})).toBe("stuck:run_failed");
	});

	it("asks again for what was in flight after a restart, and ends the same", () => {
		for (const restartAt of ["reading", "testing", "mutating"] as const) {
			const {over, cmds} = drive({run: ONE_LIVED, restartAt});
			expect(over.phase === "over" && nameOf(over.outcome)).toBe(
				"send:test_writer:mutant_survived",
			);
			expect(cmds).toHaveLength(4);
		}
	});
});
