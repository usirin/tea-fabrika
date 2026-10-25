import {applyCell} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {sentBack} from "../../refine.ts";
import {nameOf} from "../outcome.ts";
import {
	commitTests,
	onBase,
	readChecked,
	readTaken,
	recordFacts,
	runSub,
	type TestWriter,
	type TestWriterCmd,
	testWriter,
} from "./machine.ts";
import {ASK, BASE, COMMIT, drive, GOOD, pid} from "./scripted.ts";
import type {Written} from "./written.ts";

// The test writer from `start` to `over`, every outside thing answered by a
// script (./scripted.ts). No agent, no box, no test runner.

const intent = (step: string) => `tests/acme/widgets#7/1/${step}`;
const cannot: Written = {
	...GOOD,
	answers: [
		...GOOD.answers.slice(0, 1),
		{property: pid("p2"), kind: "cannot", why: "a healthy exit leaves nothing to read"},
	],
};

describe("the test writer", () => {
	it("writes one test per Property, commits them on the base, runs them, records and reads back: done", () => {
		const {over, cmds, prompts} = drive({drafts: [GOOD]});
		expect(over).toMatchObject({
			phase: "over",
			outcome: {kind: "done", part: false, commit: COMMIT},
			report: {commit: COMMIT, found: [], tries: 1, costUsd: 0.25},
		});
		expect(nameOf(over.phase === "over" ? over.outcome : {kind: "done", part: false})).toBe("done");
		const checked = [
			{fact: "checked", property: pid("p1"), version: 1, head: COMMIT, tool: "test", result: "red"},
			{
				fact: "checked",
				property: pid("p2"),
				version: 1,
				head: COMMIT,
				tool: "test",
				result: "green",
			},
		] as const;
		expect(cmds).toEqual([
			readTaken({base: BASE, includes: ASK.includes}),
			commitTests({
				ticket: ASK.ticket,
				base: BASE,
				files: GOOD.files,
				intent: intent("commit"),
			}),
			onBase({
				commit: COMMIT,
				tests: GOOD.answers.flatMap((a) =>
					a.kind === "test" ? [{property: a.property, file: a.file, name: a.name}] : [],
				),
			}),
			recordFacts({
				ticket: ASK.ticket,
				written: {fact: "tests_written", ticket: ASK.ticket, commit: COMMIT},
				checked: [...checked],
				intent: intent("record"),
			}),
			readChecked({ticket: ASK.ticket, version: 1, head: COMMIT}),
		]);
		expect(prompts[0]).toContain("These exist already, so they are never written:");
	});

	it("sends an edit to an existing file back to the writer, and goes on once it adds a new one", () => {
		const edit: Written = {
			...GOOD,
			files: [{path: "packages/pipeline/src/hosted/lane.test.ts", text: "changed"}],
			answers: GOOD.answers.map((a) =>
				a.kind === "test" ? {...a, file: "packages/pipeline/src/hosted/lane.test.ts"} : a,
			),
		};
		const {over, prompts} = drive({drafts: [edit, GOOD]});
		expect(prompts[1]).toBe(
			sentBack([
				"`packages/pipeline/src/hosted/lane.test.ts` exists already. Never change a file that exists: add a new one.",
			]),
		);
		expect(over).toMatchObject({outcome: {kind: "done"}, report: {tries: 2, costUsd: 0.5}});
	});

	it("asks the owner `already_passes` when a new Property's test is green on the base", () => {
		const {over} = drive({drafts: [GOOD], run: {p1: "green", p2: "green"}});
		expect(over).toMatchObject({
			outcome: {kind: "ask", who: "owner", for: "already_passes"},
			report: {commit: COMMIT, found: [{property: "p1", for: "already_passes"}]},
		});
	});

	it("asks the owner `fails_on_base` when an existing Property's test is red there, and records both results first", () => {
		const {over, cmds} = drive({drafts: [GOOD], run: {p1: "red", p2: "red"}});
		expect(over).toMatchObject({outcome: {kind: "ask", who: "owner", for: "fails_on_base"}});
		expect(cmds.find((c) => c.type === "tests_record")).toMatchObject({
			checked: [
				{property: "p1", result: "red"},
				{property: "p2", result: "red"},
			],
		});
	});

	it("asks `cannot_test` for a Property no test can check, after running the others", () => {
		const {over, cmds} = drive({drafts: [cannot]});
		expect(over).toMatchObject({
			outcome: {kind: "ask", who: "owner", for: "cannot_test"},
			report: {
				checked: [{property: "p1", result: "red"}],
				found: [{property: "p2", for: "cannot_test"}],
			},
		});
		expect(cmds.map((c) => c.type)).toContain("tests_on_base");
	});

	it("asks `cannot_test` at once, with no commit, when no Property got a test", () => {
		const none: Written = {
			files: [],
			answers: [
				{property: pid("p1"), kind: "cannot", why: "x"},
				{property: pid("p2"), kind: "cannot", why: "y"},
			],
		};
		const {over, cmds} = drive({drafts: [none]});
		expect(over).toMatchObject({
			outcome: {kind: "ask", for: "cannot_test"},
			report: {commit: null, found: [{property: "p1"}, {property: "p2"}]},
		});
		expect(cmds.map((c) => c.type)).toEqual(["tests_taken"]);
	});

	it("skips a plan with no Property, and asks for nothing", () => {
		const {over, cmds} = drive({drafts: []}, {...ASK, properties: []});
		expect(over).toMatchObject({outcome: {kind: "skip", why: "no_properties"}});
		expect(cmds).toEqual([]);
	});

	it("is stuck `unchecked` out of tries, with the last draft and its problems", () => {
		const {over} = drive({drafts: [{...GOOD, answers: []}]}, {...ASK, tries: 1});
		expect(over).toMatchObject({
			outcome: {kind: "stuck", why: "unchecked"},
			report: {written: {answers: []}, tries: 1},
		});
		if (over.phase !== "over") throw new Error("over");
		expect(over.report.problems).toHaveLength(2);
	});

	it("is stuck `draft_failed` when the writer breaks or its answer does not fit", () => {
		expect(drive({drafts: [{error: "boom"}]}).over).toMatchObject({
			outcome: {why: "draft_failed"},
			report: {problems: ["boom"]},
		});
		expect(drive({drafts: [null]}).over).toMatchObject({outcome: {why: "draft_failed"}});
	});

	it("stops, never guesses, when a read, write or run fails", () => {
		expect(drive({drafts: [], taken: "fail"}).over).toMatchObject({outcome: {why: "read_failed"}});
		expect(drive({drafts: [GOOD], commit: "fail"}).over).toMatchObject({
			outcome: {why: "commit_failed"},
		});
		expect(drive({drafts: [GOOD], run: "fail"}).over).toMatchObject({
			outcome: {why: "run_failed"},
			report: {commit: COMMIT},
		});
		expect(drive({drafts: [GOOD], run: {p2: "green"}}).over).toMatchObject({
			outcome: {why: "no_result"},
			report: {problems: ["the run on the base said nothing for p1's test"]},
		});
		expect(drive({drafts: [GOOD], record: "fail"}).over).toMatchObject({
			outcome: {why: "record_failed"},
		});
		expect(drive({drafts: [GOOD], back: (wrote) => wrote.slice(1)}).over).toMatchObject({
			outcome: {why: "record_failed"},
			report: {problems: ["the ledger, read after the write, does not show every result"]},
		});
	});

	it("after a restart sends again what was in flight, the same write with the same intent", () => {
		for (const phase of ["reading", "committing", "running", "recording"] as const) {
			const {over, cmds} = drive({drafts: [GOOD], restartAt: phase});
			expect(over).toMatchObject({outcome: {kind: "done"}});
			const types = cmds.map((c) => c.type);
			expect(types.length).toBe(6);
			expect(new Set(cmds.map((c) => JSON.stringify(c))).size).toBe(5);
		}
	});

	it("starts the writer over once after a restart cuts it off, under a new name, and is stuck `cut_off` the second time", () => {
		const {over, prompts} = drive({drafts: [GOOD], restartAt: "writing"});
		expect(over).toMatchObject({outcome: {kind: "done"}});
		expect(prompts).toHaveLength(1);

		type Msg = {readonly type: string; readonly [field: string]: unknown};
		const step = (s: TestWriter, m: Msg) =>
			applyCell<TestWriter, Msg, TestWriterCmd>(testWriter, s, m);
		const [reading, [taken]] = step({phase: "idle"}, {type: "start", ask: ASK, key: "k"});
		const [first] = step(reading, {type: readTaken.okType, cmd: taken, value: []});
		const [again] = step(first, {type: "resume"});
		expect([runSub.deps(first)?.key, runSub.deps(again)?.key]).toEqual(["k", "k/again/1"]);
		expect(step(again, {type: "resume"})[0]).toMatchObject({
			phase: "over",
			outcome: {kind: "stuck", why: "cut_off"},
		});
	});
});
