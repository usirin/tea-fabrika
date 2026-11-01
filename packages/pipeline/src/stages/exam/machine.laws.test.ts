import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika-old";
import {noSpend} from "@kampus/fabrika-old/agents/claude";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Exam, type ExamAsk, type ExamCmd, exam, landExam, ruleFiles} from "./machine.ts";

// The exam step's laws on its real reducer, from its real `init`, each seen to fail on a planted
// mistake. Today's version.

type Machine = typeof exam;
type Msg = MsgOf<Machine>;
type ExamStep = Step<Exam, Msg, ExamCmd>;

const RULE = ".oxlintrc.json";
const ask = (paths: readonly string[]): ExamAsk => ({
	ticket: "o/r#1",
	number: 1,
	base: "b",
	changes: paths.map((path) => ({path, change: "c", why: "w"})),
	tries: 2,
});
const LAND = landExam({ticket: "o/r#1", number: 1, base: "b", files: [], intent: "i"});

const output = (paths: readonly string[]) => ({files: paths.map((path) => ({path, text: "t"}))});

const arbs: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {
		ask: fc.constantFrom(ask([]), ask([RULE])),
		key: fc.constant("k"),
	}),
	resume: arbConstantMsg("resume"),
	exam_write_tool: arbRecordMsg("exam_write_tool", {
		key: fc.constant("k"),
		id: fc.constant("run"),
		tool: fc.constant("Read"),
	}),
	exam_write_finished: arbRecordMsg("exam_write_finished", {
		key: fc.constant("k"),
		id: fc.constant("run"),
		output: fc.constantFrom(output([RULE]), output(["src/other.ts"]), output([])),
		session: fc.constant("s"),
		spend: fc.constant(noSpend),
	}),
	exam_write_failed: arbRecordMsg("exam_write_failed", {
		key: fc.constant("k"),
		id: fc.constant("run"),
		error: fc.constant("broke"),
		spend: fc.constant(noSpend),
	}),
	exam_land_ok: fc.constant(landExam.ok(LAND, {pr: "P", head: "h"}, 0)),
	exam_land_err: fc.constant(landExam.err(LAND, {_tag: "unknown"}, 0)),
};

const lists = fc.array(arbMsg(arbs), {minLength: 1, maxLength: 40});

/** A draft's answer names the run the machine is on, whatever the list said. */
const onItsRun = (machine: Machine): Machine => {
	const named = (s: Exam, m: {readonly id: string}) => ({
		...m,
		id: s.phase === "writing" && s.refining.phase === "drafting" ? s.refining.run.id : m.id,
	});
	return {
		...machine,
		update: {
			...machine.update,
			exam_write_finished: (s, m) => machine.update.exam_write_finished(s, named(s, m) as typeof m),
			exam_write_failed: (s, m) => machine.update.exam_write_failed(s, named(s, m) as typeof m),
		},
	} as Machine;
};

const check = (machine: Machine, law: (t: ExamStep) => void) =>
	propertyInvariant(
		onItsRun(machine),
		undefined,
		lists,
		(t: ExamStep) => {
			law(t);
			return true;
		},
		{numRuns: 400, seed: 9},
	);

const plant = (update: Partial<Machine["update"]>): Machine =>
	({...exam, update: {...exam.update, ...update}}) as Machine;

/** A plan with no rule change is written as skipped, at once. One with a rule change is not skipped. */
const skipIsWritten = ({prev, msg, next}: ExamStep) => {
	if (msg.type !== "start" || prev.phase !== "idle") return;
	expect(next).toMatchObject(
		msg.ask.changes.length === 0
			? {phase: "over", outcome: {kind: "skip", why: "no_rules_change"}}
			: {phase: "writing"},
	);
};

/** What lands is only what the plan listed: an agent cannot slip in another file. */
const landsOnlyWhatIsListed = ({next, cmds}: ExamStep) => {
	for (const cmd of cmds) {
		if (next.phase === "idle") throw new Error("landed from nothing");
		const asked = next.ask.changes.map((c) => c.path);
		for (const file of cmd.files) expect(asked).toContain(file.path);
	}
};

/** With a rule change, the step never ends done on its own: it asks the person. */
const asksThePerson = ({prev, msg, next}: ExamStep) => {
	if (msg.type !== "exam_land_ok" || prev.phase !== "landing") return;
	expect(next).toMatchObject({
		phase: "over",
		outcome: {kind: "ask", who: "owner", for: "check_change"},
	});
};

/** Over stays over. */
const overStays = ({prev, next, cmds}: ExamStep) => {
	if (prev.phase !== "over") return;
	expect(next).toEqual(prev);
	expect(cmds).toEqual([]);
};

describe("the exam step's laws", () => {
	it("a plan with no rule change is written as skipped", () => check(exam, skipIsWritten));
	it("lands only what the plan listed", () => check(exam, landsOnlyWhatIsListed));
	it("asks the person, and never says done", () => check(exam, asksThePerson));
	it("stays over", () => check(exam, overStays));
	it("the rules cover what they must", () => {
		expect(ruleFiles(["a/b.laws.test.ts", RULE, "src/a.ts", ".github/workflows/ci.yml"])).toEqual([
			"a/b.laws.test.ts",
			RULE,
			".github/workflows/ci.yml",
		]);
	});
});

describe("each law fails on a planted mistake", () => {
	it("a rule change that is skipped", () => {
		const planted = plant({
			start: (s, m) => exam.update.start(s, {...m, ask: {...m.ask, changes: []}}),
		});
		expect(() => check(planted, skipIsWritten)).toThrow();
	});

	it("the check taken out, so an unlisted file lands", () => {
		const planted = plant({
			exam_write_finished: (s) => {
				if (s.phase !== "writing") return [s, []];
				const {ticket, number, base} = s.ask;
				const asked = landExam({
					ticket,
					number,
					base,
					files: [{path: "src/other.ts", text: "t"}],
					intent: "i",
				});
				return [{ask: s.ask, key: s.key, phase: "landing", guard: s.guard, asked}, [asked]];
			},
		});
		// `check` puts its own run id in, and this plant does not read it.
		expect(() => check(planted, landsOnlyWhatIsListed)).toThrow();
	});

	it("a landed exam that says done", () => {
		const planted = plant({
			exam_land_ok: (s) =>
				s.phase === "landing"
					? [
							{
								ask: s.ask,
								key: s.key,
								phase: "over",
								outcome: {kind: "done", part: false},
								report: {pr: null, head: null, files: [], problems: []},
							},
							[],
						]
					: [s, []],
		});
		expect(() => check(planted, asksThePerson)).toThrow();
	});

	it("a finished step that starts again", () => {
		const planted = plant({
			start: (s, m) => exam.update.start(s.phase === "over" ? {phase: "idle"} : s, m),
		});
		expect(() => check(planted, overStays)).toThrow();
	});
});
