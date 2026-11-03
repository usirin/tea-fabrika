import {defineMachine, type Sub} from "@demlik/tea";
import {createDraft, type DraftRun, type Spend} from "@kampus/fabrika-old/agents/claude";
import {Schema} from "effect";
import {createRefineLoop, type Refining} from "../../combos.ts";
import {act, gather, intentOf, listen} from "../../primitives.ts";
import {Spent} from "../plan/machine.ts";
import {type SortAnswer, SortReply} from "./answer.ts";
import {type Brief, promptFor, sortProblems} from "./brief.ts";
import type {SortOutcome} from "./outcome.ts";
import {type Settings, SortContext, type SortMsg, SortTicket, SortWrite} from "./services.ts";
import {outcomeOf, writesFor} from "./writes.ts";

// The sort machine: one raw report in, one answer out (docs/direction/sort-answers-yes-or-no.md),
// and the writes that answer makes. One agent sits inside it, the sorter; the machine decides
// everything around it. Elm's answer for each part, and nothing new:
//
//   reading    read the ticket. A Gather (Elm's Http.get as a Cmd)
//   gathering  the repo's other tickets, open or closed, and the plans still open. A Gather
//   sorting    the refine combo (nested TEA, ../../combos.ts): the sorter answers, the pure Check
//              (./brief.ts) reads the answer, and its problems go back in a whole new prompt, up
//              to `tries` answers. The sorter's run is a Sub, as the planner's is
//   checking   the door: the ticket read again before the first write (read fresh, run alone).
//              Closed meanwhile: nothing is written. Its words changed: stop, never guess
//   writing    the answer's writes (./writes.ts), one Act at a time, each kept in the state as
//              `asked` before it goes out, so a restart sends the same write with the same intent
//   over       the outcome, and the report it was worked out from
//
// Its input is the ticket's url, the settings and the conversation's name, so it runs alone or
// under a parent.

const Unknown = ["unknown"] as const;

/** One sort, as asked. `tries`: the most answers the Check may send back for. */
export const SortAsk = Schema.Struct({ticket: Schema.String, tries: Schema.Finite});
export type SortAsk = typeof SortAsk.Type;

export const readTicket = gather("sort_ticket", {
	input: Schema.Struct({ticket: Schema.String}),
	ok: SortTicket,
	err: Unknown,
});

export const readContext = gather("sort_context", {
	input: Schema.Struct({ticket: SortTicket}),
	ok: SortContext,
	err: Unknown,
});

/** One write, named by its intent. */
export const writeOne = act("sort_write", {
	input: Schema.Struct({write: SortWrite}),
	ok: Schema.Null,
	err: Unknown,
});

type TicketCmd = ReturnType<typeof readTicket>;
type ContextCmd = ReturnType<typeof readContext>;
type WriteCmd = ReturnType<typeof writeOne>;
export type SortCmd = TicketCmd | ContextCmd | WriteCmd;

/** The sorter's run as the Sub asks for it. */
export type RunSub = Sub<"sort_run", {readonly run: DraftRun; readonly settings: Settings}>;

/** The sorter answers with one object holding the answer. */
export const sortDraft = createDraft({name: "sort", output: SortReply});

export const refine = createRefineLoop({
	draft: sortDraft,
	check: sortProblems,
	prompt: promptFor,
	agent: null,
	folder: null,
});

const nothing: Spent = {costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: 0};
const add = (a: Spent, b: Spend): Spent => ({
	costUsd: a.costUsd + b.costUsd,
	tokens: a.tokens + b.tokens,
	context: b.context === 0 ? a.context : b.context,
	turns: a.turns + b.turns,
	minutes: a.minutes + b.minutes,
});

/** What a sort leaves besides its outcome. */
export const SortReport = Schema.Struct({
	/** The answer the Check passed, or the last one when the tries ran out. `null`: none came back. */
	answer: Schema.NullOr(SortReply.fields.sort),
	/** The writes that went out, in order. */
	wrote: Schema.Array(SortWrite),
	/** What the Check still found, or why it stopped, in words. */
	problems: Schema.Array(Schema.String),
	tries: Schema.Finite,
	spend: Spent,
});
export type SortReport = typeof SortReport.Type;

type Held = {readonly ask: SortAsk; readonly settings: Settings; readonly key: string};
type Read = Held & {readonly ticket: SortTicket};
type Known = Read & {readonly context: SortContext};
type Answered = Known & {
	readonly answer: SortAnswer;
	readonly tries: number;
	readonly spend: Spent;
};

export type SortState =
	| {readonly phase: "idle"}
	| (Held & {readonly phase: "reading"; readonly asked: TicketCmd})
	| (Read & {readonly phase: "gathering"; readonly asked: ContextCmd})
	| (Known & {
			readonly phase: "sorting";
			readonly refining: Refining<Brief, SortReply>;
			readonly spend: Spent;
	  })
	| (Answered & {readonly phase: "checking"; readonly asked: TicketCmd})
	| (Answered & {
			readonly phase: "writing";
			/** The writes the answer makes, all of them, in order. */
			readonly writes: readonly SortWrite[];
			/** How many of them went out. */
			readonly wrote: number;
			readonly asked: WriteCmd;
	  })
	| (Held & {readonly phase: "over"; readonly outcome: SortOutcome; readonly report: SortReport});

export type SortMachineMsg =
	| {
			readonly type: "start";
			readonly ask: SortAsk;
			readonly settings: Settings;
			readonly key: string;
	  }
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"}
	| SortMsg;

type Step = readonly [SortState, readonly SortCmd[]];
const stay = (s: SortState): Step => [s, []];
const held = (s: Held): Held => ({ask: s.ask, settings: s.settings, key: s.key});
const known = (s: Known): Known => ({...held(s), ticket: s.ticket, context: s.context});

const blank: SortReport = {answer: null, wrote: [], problems: [], tries: 0, spend: nothing};
const end = (s: Held, outcome: SortOutcome, report: Partial<SortReport> = {}): Step => [
	{...held(s), phase: "over", outcome, report: {...blank, ...report}},
	[],
];

const OVER_BUDGET = "error_max_budget_usd";

/** The write at `at`, as the Act that sends it: its intent is the ticket, its place, and its op. */
const writeAt = (s: Answered, writes: readonly SortWrite[], at: number): Step => {
	const write = writes[at];
	if (write === undefined)
		return end(s, outcomeOf(s.answer), {
			answer: s.answer,
			wrote: writes,
			tries: s.tries,
			spend: s.spend,
		});
	const asked = writeOne({write, intent: intentOf("sort", s.ticket.url, at + 1, write.op)});
	return [{...known(s), ...answered(s), phase: "writing", writes, wrote: at, asked}, [asked]];
};
const answered = (s: Answered) => ({answer: s.answer, tries: s.tries, spend: s.spend});

/** A sorter Msg, folded into the refine combo, and what it ends in. */
function sorted(s: SortState, m: Extract<SortMsg, {type: "sort_finished" | "sort_failed"}>): Step {
	if (s.phase !== "sorting" || refine.runOf(s.refining)?.id !== m.id) return stay(s);
	const spend = add(s.spend, m.spend);
	const next = refine.update(s.refining, m);
	switch (next.phase) {
		case "drafting":
			return [{...s, refining: next, spend}, []];
		case "done": {
			// The door: the ticket is read again before anything is written.
			const asked = readTicket({ticket: s.ask.ticket});
			return [
				{
					...known(s),
					phase: "checking",
					answer: next.output.sort,
					tries: next.tries,
					spend,
					asked,
				},
				[asked],
			];
		}
		case "out_of_tries":
			return end(
				s,
				{kind: "stuck", why: "unchecked"},
				{answer: next.output.sort, problems: next.problems, tries: next.tries, spend},
			);
		case "failed":
			return next.error.startsWith(OVER_BUDGET)
				? end(
						s,
						{kind: "stuck", why: "over_budget"},
						{
							tries: next.tries,
							spend,
							problems: [`the sorter reached its limit of ${s.settings.budget} dollars`],
						},
					)
				: end(
						s,
						{kind: "stuck", why: "draft_failed"},
						{tries: next.tries, spend, problems: [next.error]},
					);
	}
}

/** The sorter's run: on only while an answer is asked for. */
export const runSub = listen("sort_run", (s: SortState) => {
	if (s.phase !== "sorting") return null;
	const run = refine.runOf(s.refining);
	return run === null ? null : {run, settings: s.settings};
});

export const sort = defineMachine({
	types: {
		model: {} as SortState,
		msg: {} as SortMachineMsg,
		sub: {} as RunSub,
		ctx: undefined,
	},
	cmds: [readTicket, readContext, writeOne],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const asked = readTicket({ticket: m.ask.ticket});
			return [{ask: m.ask, settings: m.settings, key: m.key, phase: "reading", asked}, [asked]];
		},
		// A Cmd in flight is sent again. The sorter's run is a Sub: it comes back by itself.
		resume: (s): Step => ("asked" in s ? [s, [s.asked]] : stay(s)),

		sort_ticket_ok: (s, m): Step => {
			if (s.phase === "reading") {
				const ticket = m.value;
				if (ticket.state === "closed") return end(s, {kind: "skip", why: "closed"});
				const asked = readContext({ticket});
				return [{...held(s), ticket, phase: "gathering", asked}, [asked]];
			}
			if (s.phase === "checking") {
				const now = m.value;
				const report = {answer: s.answer, tries: s.tries, spend: s.spend};
				if (now.state === "closed") return end(s, {kind: "skip", why: "closed"}, report);
				if (now.title !== s.ticket.title || now.body !== s.ticket.body)
					return end(
						s,
						{kind: "stuck", why: "changed"},
						{
							...report,
							problems: ["the ticket's words changed while it was sorted"],
						},
					);
				return writeAt(s, writesFor(s.ticket, s.answer), 0);
			}
			return stay(s);
		},
		sort_ticket_err: (s): Step =>
			s.phase === "reading"
				? end(s, {kind: "stuck", why: "read_failed"})
				: s.phase === "checking"
					? end(s, {kind: "stuck", why: "read_failed"}, answered(s))
					: stay(s),

		sort_context_ok: (s, m): Step => {
			if (s.phase !== "gathering") return stay(s);
			const context = m.value;
			const brief: Brief = {ticket: s.ticket, context, note: s.settings.note};
			const refining = refine.start(s.key, brief, s.ask.tries);
			return [
				{...held(s), ticket: s.ticket, context, phase: "sorting", refining, spend: nothing},
				[],
			];
		},
		// The duplicate check needs the other tickets: without them, stop.
		sort_context_err: (s): Step =>
			s.phase === "gathering" ? end(s, {kind: "stuck", why: "read_failed"}) : stay(s),

		sort_tool: (s): Step => stay(s),
		sort_finished: (s, m): Step => sorted(s, m),
		sort_failed: (s, m): Step => sorted(s, m),

		sort_write_ok: (s, m): Step => {
			if (s.phase !== "writing" || m.cmd.intent !== s.asked.intent) return stay(s);
			return writeAt(s, s.writes, s.wrote + 1);
		},
		sort_write_err: (s, m): Step => {
			if (s.phase !== "writing" || m.cmd.intent !== s.asked.intent) return stay(s);
			return end(
				s,
				{kind: "stuck", why: "write_failed"},
				{
					...answered(s),
					wrote: s.writes.slice(0, s.wrote),
					problems: [`the ${s.asked.write.op} write was refused`],
				},
			);
		},
	},
	subs: [runSub],
});
