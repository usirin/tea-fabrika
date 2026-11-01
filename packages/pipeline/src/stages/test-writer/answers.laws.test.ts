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
import {
	type Answers,
	type AnswersAsk,
	type AnswersCmd,
	answers,
	commitAnswers,
	readAnswersTaken,
} from "./answers.ts";
import {kills} from "./mutants.ts";

// The test writer's second job, its laws on the real reducer from its real `init`, each seen to fail
// on a planted mistake. Today's version.

type Machine = typeof answers;
type Msg = MsgOf<Machine>;
type AnswersStep = Step<Answers, Msg, AnswersCmd>;

const ASK: AnswersAsk = {ticket: "o/r#1", head: "h1", survived: [], includes: ["a.ts"], tries: 2};
const READ = readAnswersTaken({head: "h1", includes: ["a.ts"]});
const COMMIT = commitAnswers({ticket: "o/r#1", base: "h1", files: [], intent: "i"});

const KILL = kills.run({
	key: "m",
	side: "bad",
	on: {commit: "c1", file: "a.test.ts", test: "t", mutant: null},
});
const finished = {key: fc.constant("k"), id: fc.constant("x"), spend: fc.constant(noSpend)};

const arbs: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {ask: fc.constant(ASK), key: fc.constant("k")}),
	resume: arbConstantMsg("resume"),
	answers_taken_ok: fc.constant(readAnswersTaken.ok(READ, [], 0)),
	answers_taken_err: fc.constant(readAnswersTaken.err(READ, {_tag: "unknown"}, 0)),
	answers_commit_ok: fc.constant(commitAnswers.ok(COMMIT, "c1", 0)),
	answers_commit_err: fc.constant(commitAnswers.err(COMMIT, {_tag: "unknown"}, 0)),
	mutants_answer_tool: arbRecordMsg("mutants_answer_tool", {
		key: fc.constant("k"),
		id: fc.constant("x"),
		tool: fc.constant("Read"),
	}),
	mutants_answer_failed: arbRecordMsg("mutants_answer_failed", {
		...finished,
		error: fc.constant("broke"),
	}),
	mutants_answer_finished: arbRecordMsg("mutants_answer_finished", {
		...finished,
		output: fc.constant({answers: [], files: []}),
		session: fc.constant("s"),
	}),
	mutant_kill_control_ok: fc.constant(kills.run.ok(KILL, "red", 0)),
	mutant_kill_control_err: fc.constant(kills.run.err(KILL, {_tag: "unknown"}, 0)),
};

// The commit sits three right answers in. A list drawn at random rarely gets there, so a list may
// start on that walk (any part of it, in order) and then go on at random.
const WALK: readonly Msg[] = [
	{type: "start", ask: ASK, key: "k"},
	readAnswersTaken.ok(READ, [], 0),
	{
		type: "mutants_answer_finished",
		key: "k",
		id: "x",
		spend: noSpend,
		output: {answers: [], files: []},
		session: "s",
	},
];
const lists = fc
	.tuple(fc.subarray([...WALK]), fc.array(arbMsg(arbs), {minLength: 1, maxLength: 40, size: "max"}))
	.map(([walk, rest]) => [...walk, ...rest]);

/** A draft's answer names the run the machine is on, whatever the list said. */
const onItsRun = (machine: Machine): Machine => {
	const named = (s: Answers, m: {readonly id: string}) => ({
		...m,
		id: s.phase === "writing" && s.refining.phase === "drafting" ? s.refining.run.id : m.id,
	});
	return {
		...machine,
		update: {
			...machine.update,
			mutants_answer_finished: (s, m) =>
				machine.update.mutants_answer_finished(s, named(s, m) as typeof m),
			mutants_answer_failed: (s, m) =>
				machine.update.mutants_answer_failed(s, named(s, m) as typeof m),
		},
	} as Machine;
};

const check = (machine: Machine, law: (t: AnswersStep) => void) =>
	propertyInvariant(
		onItsRun(machine),
		undefined,
		lists,
		(t: AnswersStep) => {
			law(t);
			return true;
		},
		{numRuns: 300, seed: 11},
	);

const plant = (update: Partial<Machine["update"]>): Machine =>
	({...answers, update: {...answers.update, ...update}}) as Machine;

/** A new test is committed on the head the mutants came from, and on no other. */
const commitsOnTheHead = ({next, cmds}: AnswersStep) => {
	for (const cmd of cmds) {
		if (cmd.type !== "answers_commit") continue;
		if (next.phase === "idle") throw new Error("a commit from nothing");
		expect(cmd.base).toBe(next.ask.head);
	}
};

/** Every read or commit that fails ends the job in a named stuck. */
const failuresAreNamed = ({prev, msg, next}: AnswersStep) => {
	const failed =
		(msg.type === "answers_taken_err" && prev.phase === "reading") ||
		(msg.type === "answers_commit_err" && prev.phase === "committing");
	if (!failed) return;
	expect(next).toMatchObject({phase: "over", outcome: {kind: "stuck", why: "run_failed"}});
};

/** A restart sends again only what was in flight, and changes nothing. */
const resumeRepeats = ({prev, msg, next, cmds}: AnswersStep) => {
	if (msg.type !== "resume") return;
	expect(next).toEqual(prev);
	if (prev.phase === "reading" || prev.phase === "committing") expect(cmds).toEqual([prev.asked]);
	if (prev.phase === "idle" || prev.phase === "over") expect(cmds).toEqual([]);
};

describe("the answers machine's laws", () => {
	it("commits only on the mutants' head", () => check(answers, commitsOnTheHead));
	it("names every failure", () => check(answers, failuresAreNamed));
	it("a restart only repeats", () => check(answers, resumeRepeats));
});

describe("each law fails on a planted mistake", () => {
	it("a commit on another head", () => {
		const planted = plant({
			answers_taken_ok: (s) => {
				if (s.phase !== "reading") return [s, []];
				const asked = commitAnswers({ticket: "o/r#1", base: "elsewhere", files: [], intent: "i"});
				return [
					{
						ask: s.ask,
						key: s.key,
						phase: "committing",
						answered: {answers: [], files: []},
						asked,
					},
					[asked],
				] as never;
			},
		});
		expect(() => check(planted, commitsOnTheHead)).toThrow();
	});

	it("a failed commit taken as no news", () => {
		const planted = plant({answers_commit_err: (s) => [s, []]});
		expect(() => check(planted, failuresAreNamed)).toThrow();
	});

	it("a restart that drops what was in flight", () => {
		const planted = plant({resume: (s) => [s, []]});
		expect(() => check(planted, resumeRepeats)).toThrow();
	});
});
