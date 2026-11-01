import {defineMachine, type Sub} from "@demlik/tea";
import type {DraftRun} from "@kampus/fabrika-old/agents/claude";
import {createDraft, type DraftMsg} from "@kampus/fabrika-old/agents/claude";
import {Schema} from "effect";
import {type CheckChange, checkChange, matcherFor} from "../../codeowners.ts";
import {createRefineLoop, type Refining, refiningOf} from "../../combos.ts";
import {act, type Check, intentOf, keptAct} from "../../primitives.ts";
import {outcomesOf} from "../outcome.ts";

// The exam step (docs/direction/nobody-writes-their-own-exam.md): before any test or code, the
// rule changes a plan lists land in a pull request of their own, written by an agent that builds
// nothing, and a person says yes to them. `checkChange` decides it:
//
//   null        the plan changes no rule: `skip:no_rules_change`, written like any other answer
//   otherwise   writing   an agent writes those files whole, a pure Check holds it to the list
//               landing   code commits them on their own branch, pushes, opens the pull request
//               over      `ask:owner:check_change`, with the files. The lane asks the person
//
//   start {changes: []}                                 -> over, skip:no_rules_change
//   start {changes: [{path: ".oxlintrc.json", ...}]}    -> writing -> landing -> over, ask:owner

const outcomes = outcomesOf({
	done: {},
	send: {},
	ask: {owner: ["check_change"]},
	skip: ["no_rules_change"],
	stuck: ["draft_failed", "unchecked", "land_failed"],
});
export const ExamOutcome = outcomes.schema;
export type ExamOutcome = typeof ExamOutcome.Type;

/**
 * What counts as the exam, with no list from a repo: laws, lint rules, CI rules, ownership, and
 * what the mutation step leaves out. Each a pattern the way a CODEOWNERS row reads.
 */
export const RULES: readonly string[] = [
	"**/*.laws.test.ts",
	".oxlintrc.json",
	".oxfmtrc.json",
	"oxlint-plugins/**",
	".github/workflows/**",
	".github/CODEOWNERS",
	"CODEOWNERS",
	"layer-rules.json",
	"unreachable-ledger.json",
	"**/ignorer.ts",
	"stryker*.json",
];

/** The paths a set of rule patterns covers. Pure. */
export const ruleFiles = (paths: readonly string[], rules: readonly string[] = RULES) => {
	const matchers = rules.map(matcherFor);
	return paths.filter((path) => matchers.some((m) => m.test(path)));
};

/** One rule change the plan lists. */
export const ExamChange = Schema.Struct({
	path: Schema.String,
	change: Schema.String,
	why: Schema.String,
});
export type ExamChange = typeof ExamChange.Type;

export const ExamAsk = Schema.Struct({
	ticket: Schema.String,
	number: Schema.Finite,
	base: Schema.String,
	changes: Schema.Array(ExamChange),
	tries: Schema.Finite,
});
export type ExamAsk = typeof ExamAsk.Type;

const ExamFile = Schema.Struct({path: Schema.String, text: Schema.String});
/** What the agent hands back: each listed file, whole. */
export const ExamWritten = Schema.Struct({files: Schema.Array(ExamFile)});
export type ExamWritten = typeof ExamWritten.Type;

const ExamBrief = Schema.Struct({ticket: Schema.String, changes: Schema.Array(ExamChange)});
type ExamBrief = typeof ExamBrief.Type;

/** The Check: every listed file, and nothing else. None is a pass. */
export const examProblems: Check<ExamWritten, ExamBrief> = (written, brief) => {
	const asked = new Set(brief.changes.map((c) => c.path));
	const wrote = new Set(written.files.map((f) => f.path));
	return [
		...written.files.flatMap((f) =>
			asked.has(f.path) ? [] : [`\`${f.path}\` is not a change this plan lists.`],
		),
		...brief.changes.flatMap((c) =>
			wrote.has(c.path) ? [] : [`\`${c.path}\` is listed, and you did not hand it back.`],
		),
	];
};

export const examWrite = createDraft({name: "exam_write", output: ExamWritten});

const refine = createRefineLoop({
	draft: examWrite,
	check: examProblems,
	prompt: (brief, note) =>
		note ?? brief.changes.map((c) => `${c.path}: ${c.change} (${c.why})`).join("\n"),
	agent: null,
	folder: null,
});

const LandIn = Schema.Struct({
	ticket: Schema.String,
	number: Schema.Finite,
	base: Schema.String,
	files: Schema.Array(ExamFile),
});
/** The pull request the rule changes are on, and its head. */
export const Landed = Schema.Struct({pr: Schema.String, head: Schema.String});
export type Landed = typeof Landed.Type;

export const landExam = act("exam_land", {
	input: LandIn,
	ok: Landed,
	err: ["unknown"],
});

export const ExamReport = Schema.Struct({
	pr: Schema.NullOr(Schema.String),
	head: Schema.NullOr(Schema.String),
	files: Schema.Array(Schema.String),
	problems: Schema.Array(Schema.String),
});
export type ExamReport = typeof ExamReport.Type;

const Held = Schema.Struct({ask: ExamAsk, key: Schema.String});
type Held = typeof Held.Type;

export const Exam = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("writing"),
		guard: Schema.Array(Schema.String),
		refining: refiningOf(ExamBrief, ExamWritten),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("landing"),
		guard: Schema.Array(Schema.String),
		asked: keptAct(landExam, LandIn),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("over"),
		outcome: ExamOutcome,
		report: ExamReport,
	}),
]);
export type Exam = typeof Exam.Type;

export type ExamMsg =
	| {readonly type: "start"; readonly ask: ExamAsk; readonly key: string}
	| {readonly type: "resume"}
	| DraftMsg<"exam_write", ExamWritten>;
export type ExamCmd = ReturnType<typeof landExam>;

type Step = readonly [Exam, readonly ExamCmd[]];
const stay = (s: Exam): Step => [s, []];
const held = (s: Held): Held => ({ask: s.ask, key: s.key});

const end = (s: Held, outcome: ExamOutcome, report: Partial<ExamReport> = {}): Step => [
	{
		...held(s),
		phase: "over",
		outcome,
		report: {pr: null, head: null, files: [], problems: [], ...report},
	},
	[],
];

const writing = (s: Held, guard: CheckChange): Step => {
	const brief: ExamBrief = {ticket: s.ask.ticket, changes: s.ask.changes};
	return [
		{
			...held(s),
			phase: "writing",
			guard: guard.files,
			refining: refine.start(s.key, brief, s.ask.tries) as Refining<ExamBrief, ExamWritten>,
		},
		[],
	];
};

export const examSub = examWrite.sub((s: Exam): DraftRun | null => {
	if (s.phase !== "writing") return null;
	const run = refine.runOf(s.refining);
	return run === null ? null : {...run, folder: s.ask.base};
});

const drafted = (s: Exam, m: Exclude<ExamMsg, {type: "start" | "resume"}>): Step => {
	if (s.phase !== "writing" || refine.runOf(s.refining)?.id !== m.id) return stay(s);
	const next = refine.update(s.refining, m);
	switch (next.phase) {
		case "drafting":
			return [{...s, refining: next}, []];
		case "done": {
			const {ticket, number, base} = s.ask;
			const asked = landExam({
				ticket,
				number,
				base,
				files: next.output.files,
				intent: intentOf("exam", ticket, "land"),
			});
			return [{...held(s), phase: "landing", guard: s.guard, asked}, [asked]];
		}
		case "out_of_tries":
			return end(s, {kind: "stuck", why: "unchecked"}, {problems: next.problems});
		case "failed":
			return end(s, {kind: "stuck", why: "draft_failed"}, {problems: [next.error]});
	}
};

export const exam = defineMachine({
	types: {
		model: {} as Exam,
		msg: {} as ExamMsg,
		sub: {} as Sub<"exam_write", DraftRun>,
		ctx: undefined,
	},
	cmds: [landExam],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const at = {ask: m.ask, key: m.key};
			const guard = checkChange(m.ask.changes.map((c) => c.path));
			return guard === null ? end(at, {kind: "skip", why: "no_rules_change"}) : writing(at, guard);
		},
		resume: (s): Step => (s.phase === "landing" ? [s, [s.asked]] : stay(s)),
		exam_write_tool: (s): Step => stay(s),
		exam_write_finished: drafted,
		exam_write_failed: drafted,
		exam_land_ok: (s, m): Step =>
			s.phase === "landing"
				? end(
						s,
						{kind: "ask", who: "owner", for: "check_change"},
						{pr: m.value.pr, head: m.value.head, files: s.guard},
					)
				: stay(s),
		exam_land_err: (s): Step =>
			s.phase === "landing" ? end(s, {kind: "stuck", why: "land_failed"}) : stay(s),
	},
	subs: [examSub],
});
