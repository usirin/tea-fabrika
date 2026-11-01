import {defineMachine, type Sub} from "@demlik/tea";
import type {DraftMsg, DraftRun} from "@kampus/fabrika-old/agents/claude";
import {Schema} from "effect";
import {type Refining, refiningOf} from "../../combos.ts";
import type {Result} from "../../controls.ts";
import {act, gather, intentOf, keptAct, keptCmd} from "../../primitives.ts";
import {Survived} from "../mutation/mutant.ts";
import {mutantsWriter} from "./brief.ts";
import {
	Answered,
	answering,
	type Killing,
	killRan,
	kills,
	MutantsOutcome,
	mutantsAnswer,
	outcomeOf,
	startKills,
} from "./mutants.ts";
import {File} from "./written.ts";

// The test writer's second job as a machine (docs/direction/the-test-writer.md): the pieces in
// ./mutants.ts, in order. It answers each mutant that lived, code commits its new tests, and each
// new test is run with its mutant in and without.
//
//   reading    which files at the head `includes` covers
//   writing    the refine combo: the writer answers, the pure Check reads it
//   committing the new tests, on the head
//   killing    both runs per `test` answer
//   over       `done`, `ask:owner:disable`, or a named stuck

const stuckOutcome = (why: "not_killed" | "run_failed") => ({kind: "stuck", why}) as const;

export const AnswersAsk = Schema.Struct({
	ticket: Schema.String,
	head: Schema.String,
	survived: Schema.Array(Survived),
	includes: Schema.Array(Schema.String),
	tries: Schema.Finite,
});
export type AnswersAsk = typeof AnswersAsk.Type;

const TakenIn = Schema.Struct({head: Schema.String, includes: Schema.Array(Schema.String)});
const CommitIn = Schema.Struct({
	ticket: Schema.String,
	base: Schema.String,
	files: Schema.Array(File),
});
export const readAnswersTaken = gather("answers_taken", {
	input: TakenIn,
	ok: Schema.Array(Schema.String),
	err: ["unknown"],
});
export const commitAnswers = act("answers_commit", {
	input: CommitIn,
	ok: Schema.String,
	err: ["unknown"],
});

type KillCmd = ReturnType<typeof kills.run>;
export type AnswersCmd =
	| ReturnType<typeof readAnswersTaken>
	| ReturnType<typeof commitAnswers>
	| KillCmd;

export const AnswersReport = Schema.Struct({
	answered: Schema.NullOr(Answered),
	commit: Schema.NullOr(Schema.String),
	problems: Schema.Array(Schema.String),
});
export type AnswersReport = typeof AnswersReport.Type;

const Held = Schema.Struct({ask: AnswersAsk, key: Schema.String});
type Held = typeof Held.Type;

// Two parts of the kept state hold shapes the combos make and name no schema for (the filled brief,
// and Controls' children with their Cmds). This machine alone writes them, so they read back as kept.
const keptBrief: Schema.Codec<ReturnType<typeof mutantsWriter.fill>, unknown> = Schema.Any;
const keptKilling: Schema.Codec<Killing, unknown> = Schema.Any;

export const Answers = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("reading"),
		asked: keptCmd(readAnswersTaken, TakenIn),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("writing"),
		refining: refiningOf(keptBrief, Answered),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("committing"),
		answered: Answered,
		asked: keptAct(commitAnswers, CommitIn),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("killing"),
		answered: Answered,
		commit: Schema.String,
		killing: keptKilling,
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("over"),
		outcome: MutantsOutcome,
		report: AnswersReport,
	}),
]);
export type Answers = typeof Answers.Type;

export type AnswersMsg =
	| {readonly type: "start"; readonly ask: AnswersAsk; readonly key: string}
	| {readonly type: "resume"}
	| DraftMsg<"mutants_answer", typeof Answered.Type>;

type Step = readonly [Answers, readonly AnswersCmd[]];
const stay = (s: Answers): Step => [s, []];
const held = (s: Held): Held => ({ask: s.ask, key: s.key});

const end = (s: Held, outcome: MutantsOutcome, report: Partial<AnswersReport> = {}): Step => [
	{
		...held(s),
		phase: "over",
		outcome,
		report: {answered: null, commit: null, problems: [], ...report},
	},
	[],
];

/** Step a kill check's answer, and end when every one is back. */
const ranKill = (s: Answers, cmd: KillCmd, result: Result | null): Step => {
	if (s.phase !== "killing") return stay(s);
	const killing = killRan(s.killing, cmd, result);
	const outcome = outcomeOf(s.answered.answers, killing);
	if (outcome === null) return [{...s, killing}, []];
	return end(s, outcome, {answered: s.answered, commit: s.commit});
};

const drafted = (s: Answers, m: Exclude<AnswersMsg, {type: "start" | "resume"}>): Step => {
	if (s.phase !== "writing" || answering.runOf(s.refining)?.id !== m.id) return stay(s);
	const next = answering.update(s.refining, m);
	switch (next.phase) {
		case "drafting":
			return [{...s, refining: next}, []];
		case "done": {
			const asked = commitAnswers({
				ticket: s.ask.ticket,
				base: s.ask.head,
				files: next.output.files,
				intent: intentOf("answers", s.ask.ticket, s.ask.head, "commit"),
			});
			return [{...held(s), phase: "committing", answered: next.output, asked}, [asked]];
		}
		case "out_of_tries":
			return end(s, stuckOutcome("not_killed"), {answered: next.output, problems: next.problems});
		case "failed":
			return end(s, stuckOutcome("run_failed"), {problems: [next.error]});
	}
};

export const answersSub = mutantsAnswer.sub((s: Answers): DraftRun | null => {
	if (s.phase !== "writing") return null;
	const run = answering.runOf(s.refining);
	return run === null ? null : {...run, folder: s.ask.head};
});

export const answers = defineMachine({
	types: {
		model: {} as Answers,
		msg: {} as AnswersMsg,
		sub: {} as Sub<"mutants_answer", DraftRun>,
		ctx: undefined,
	},
	cmds: [readAnswersTaken, commitAnswers, kills.run],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const asked = readAnswersTaken({head: m.ask.head, includes: m.ask.includes});
			return [{ask: m.ask, key: m.key, phase: "reading", asked}, [asked]];
		},
		resume: (s): Step => {
			if (s.phase === "reading" || s.phase === "committing") return [s, [s.asked]];
			if (s.phase === "killing") return [s, Object.values(s.killing).flatMap(kills.asked)];
			return stay(s);
		},
		answers_taken_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const filled = mutantsWriter.fill({
				ticket: s.ask.ticket,
				head: s.ask.head,
				survived: s.ask.survived,
				includes: s.ask.includes,
				taken: m.value,
			});
			const refining = answering.start(s.key, filled, s.ask.tries) as Refining<
				typeof filled,
				typeof Answered.Type
			>;
			return [{...held(s), phase: "writing", refining}, []];
		},
		answers_taken_err: (s): Step =>
			s.phase === "reading" ? end(s, stuckOutcome("run_failed")) : stay(s),
		mutants_answer_tool: (s): Step => stay(s),
		mutants_answer_finished: drafted,
		mutants_answer_failed: drafted,
		answers_commit_ok: (s, m): Step => {
			if (s.phase !== "committing") return stay(s);
			const [killing, cmds] = startKills(m.value, s.answered.answers);
			const outcome = outcomeOf(s.answered.answers, killing);
			if (outcome !== null) return end(s, outcome, {answered: s.answered, commit: m.value});
			return [{...held(s), phase: "killing", answered: s.answered, commit: m.value, killing}, cmds];
		},
		answers_commit_err: (s): Step =>
			s.phase === "committing" ? end(s, stuckOutcome("run_failed")) : stay(s),
		mutant_kill_control_ok: (s, m): Step => ranKill(s, m.cmd, m.value),
		mutant_kill_control_err: (s, m): Step => ranKill(s, m.cmd, null),
	},
	subs: [answersSub],
});
