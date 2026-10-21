import {defineMachine, type Sub} from "@demlik/tea";
import {Schema} from "effect";
import {PlanId, TaskId} from "../../ids.ts";
import {act, gather, intentOf, listen} from "../../primitives.ts";
import {inert} from "../build/body.ts";
import type {BuildBrief, Built, Ran, Settings} from "../build/form.ts";
import {Pushed} from "../build/services.ts";
import {Item} from "../build/ticket.ts";
import type {Criterion} from "../review/pack.ts";
import type {TaskOutcome} from "./outcome.ts";
import {TaskView, taskGate} from "./view.ts";

// One task of a plan, built (docs/direction/done-is-per-criterion.md, "One PR per plan"): a fresh
// builder per task, its commit on the plan's one branch, no pull request. One agent sits inside
// it, the builder; the machine decides everything around it:
//
//   reading   read the task from the ledger (./view.ts) and where the branch stands, then the
//             gate, a pure Check: go, or the one reason not to
//   building  the builder runs, as a Sub, on a copy of the branch at the round's base, and hands
//             back its form
//   pushing   code commits what the builder left and pushes the branch, from the base only and
//             never forced. An Act
//   over      the outcome, and the report it was worked out from
//
// The builder never commits or pushes: code does each write, with its intent in the state first,
// so a restart sends the same write again and the gate finds its first one. Its input is the plan,
// the task, the round and what the last review left open, so it runs alone or under the plan's
// lane, the same way.

const Unknown = ["unknown"] as const;

export const readTask = gather("task_read", {
	input: Schema.Struct({plan: PlanId, task: TaskId}),
	ok: TaskView,
	err: Unknown,
});

export const pushTask = act("task_push", {
	input: Schema.Struct({
		plan: PlanId,
		task: TaskId,
		round: Schema.Finite,
		branch: Schema.String,
		base: Schema.String,
		message: Schema.String,
	}),
	ok: Pushed,
	err: Unknown,
});

type ReadCmd = ReturnType<typeof readTask>;
type PushCmd = ReturnType<typeof pushTask>;
export type TaskCmd = ReadCmd | PushCmd;

/** One task build, as asked. */
export const TaskAsk = Schema.Struct({
	plan: PlanId,
	task: TaskId,
	round: Schema.Finite,
	/** What the last review left open. Empty on a first round. */
	open: Schema.Array(Item),
});
export type TaskAsk = typeof TaskAsk.Type;

type At = {readonly task: TaskId; readonly round: number; readonly run: number};
export type TaskRunSub = Sub<
	"task_run",
	At & {readonly brief: BuildBrief; readonly settings: Settings}
>;

/** How many times one round may start its builder: the first, and once more after a restart. */
export const MAX_RUNS = 2;

export const TaskReport = Schema.Struct({
	head: Schema.NullOr(Schema.String),
	changed: Schema.Boolean,
	runs: Schema.Finite,
	problems: Schema.Array(Schema.String),
});
export type TaskReport = typeof TaskReport.Type;

type Held = {readonly ask: TaskAsk; readonly settings: Settings; readonly session: string};
type Read = Held & {
	readonly view: TaskView;
	readonly base: string;
	readonly criteria: readonly [Criterion, ...Criterion[]];
};
type Done = Read & {readonly built: Built; readonly ran: Ran; readonly runs: number};

export type Task =
	| {readonly phase: "idle"}
	| (Held & {readonly phase: "reading"; readonly asked: ReadCmd})
	| (Read & {readonly phase: "building"; readonly run: number})
	| (Done & {readonly phase: "pushing"; readonly asked: PushCmd})
	| (Held & {readonly phase: "over"; readonly outcome: TaskOutcome; readonly report: TaskReport});

export type TaskMsg =
	| {
			readonly type: "start";
			readonly ask: TaskAsk;
			readonly settings: Settings;
			readonly session: string;
	  }
	| {readonly type: "resume"}
	| (At & {readonly type: "task_built"; readonly built: Built; readonly ran: Ran})
	| (At & {
			readonly type: "task_failed";
			readonly why: "broke" | "misfit" | "over_budget";
			readonly error: string | null;
			readonly ran: Ran;
	  });

type Step = readonly [Task, readonly TaskCmd[]];
const stay = (s: Task): Step => [s, []];
const held = (s: Held): Held => ({ask: s.ask, settings: s.settings, session: s.session});
const blank: TaskReport = {head: null, changed: false, runs: 0, problems: []};
const end = (s: Held, outcome: TaskOutcome, report: Partial<TaskReport> = {}): Step => [
	{...held(s), phase: "over", outcome, report: {...blank, ...report}},
	[],
];
const intent = (s: Held, step: string) =>
	intentOf("task", s.ask.plan, s.ask.task, s.ask.round, step);

/** The brief one run is handed. The child makes its own copy, so `tree` is its to fill. Pure. */
export const briefOf = (s: Read): BuildBrief => ({
	ticket: s.view.ticket,
	number: s.view.number,
	title: s.view.title,
	body: s.view.body,
	criteria: s.criteria,
	round: s.ask.round,
	open: s.ask.open,
	rules: [],
	tree: "",
	branch: s.view.branch,
	session: s.session,
});

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The commit's message: the task, the round, the builder's summary. It closes nothing: the title
 * and the summary are made inert, as the one-ticket build's are, so a "Fixes #2" in the builder's
 * words cannot close a ticket when the plan's pull request merges. Pure.
 */
export const messageOf = (s: Done): string =>
	`${s.ask.task}: ${inert(flat(s.view.title))} (round ${s.ask.round})\n\n${inert(s.built.summary.trim())}\n\nRefs #${s.view.number}`;

const isRun = (s: Task, m: At): s is Extract<Task, {phase: "building"}> =>
	s.phase === "building" && m.task === s.ask.task && m.round === s.ask.round && m.run === s.run;

/** The builder's run: on only while building. */
export const taskRunSub = listen("task_run", (s: Task) =>
	s.phase === "building"
		? {
				task: s.ask.task,
				round: s.ask.round,
				run: s.run,
				brief: briefOf(s),
				settings: s.settings,
			}
		: null,
);

const readOf = (s: Extract<Task, {phase: "building" | "pushing"}>): Read => ({
	...held(s),
	view: s.view,
	base: s.base,
	criteria: s.criteria,
});

export const task = defineMachine({
	types: {model: {} as Task, msg: {} as TaskMsg, sub: {} as TaskRunSub, ctx: undefined},
	cmds: [readTask, pushTask],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	subs: [taskRunSub],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const asked = readTask({plan: m.ask.plan, task: m.ask.task});
			return [
				{ask: m.ask, settings: m.settings, session: m.session, phase: "reading", asked},
				[asked],
			];
		},
		resume: (s): Step => {
			if (s.phase === "reading" || s.phase === "pushing") return [s, [s.asked]];
			if (s.phase !== "building") return stay(s);
			if (s.run >= MAX_RUNS)
				return end(
					s,
					{kind: "stuck", why: "over_budget"},
					{runs: s.run, problems: [`the builder was cut off ${s.run} times`]},
				);
			return [{...s, run: s.run + 1}, []];
		},
		task_read_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const view = m.value;
			const gate = taskGate(view);
			if (gate.answer === "stop") return end(s, gate.outcome);
			// The gate let no view through without a base.
			const base = view.base ?? "";
			return [{...held(s), view, base, criteria: gate.criteria, phase: "building", run: 1}, []];
		},
		task_read_err: (s): Step =>
			s.phase === "reading" ? end(s, {kind: "stuck", why: "read_failed"}) : stay(s),
		task_built: (s, m): Step => {
			if (!isRun(s, m)) return stay(s);
			const done: Done = {...readOf(s), built: m.built, ran: m.ran, runs: s.run};
			const asked = pushTask({
				plan: s.ask.plan,
				task: s.ask.task,
				round: s.ask.round,
				branch: s.view.branch,
				base: s.base,
				message: messageOf(done),
				intent: intent(s, "push"),
			});
			return [{...done, phase: "pushing", asked}, [asked]];
		},
		task_failed: (s, m): Step => {
			if (!isRun(s, m)) return stay(s);
			const report = {runs: s.run};
			if (m.why === "over_budget")
				return end(
					s,
					{kind: "stuck", why: "over_budget"},
					{
						...report,
						problems: [`the builder reached its limit of ${s.settings.budget} dollars`],
					},
				);
			return end(
				s,
				{kind: "stuck", why: "draft_failed"},
				{
					...report,
					problems: [m.why === "misfit" ? "no form came back" : (m.error ?? "the builder broke")],
				},
			);
		},
		task_push_ok: (s, m): Step =>
			s.phase === "pushing"
				? end(
						s,
						{kind: "done", part: false, head: m.value.head, changed: m.value.changed},
						{head: m.value.head, changed: m.value.changed, runs: s.runs},
					)
				: stay(s),
		task_push_err: (s): Step =>
			s.phase === "pushing" ? end(s, {kind: "stuck", why: "push_failed"}, {runs: s.runs}) : stay(s),
	},
});
