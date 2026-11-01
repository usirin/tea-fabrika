import {defineMachine, type Sub} from "@demlik/tea";
import {Schema} from "effect";
import {act, gather, intentOf, keptAct, keptCmd, listen} from "../../primitives.ts";
import {Criterion} from "../review/pack.ts";
import {Commit, PrBody} from "./body.ts";
import {type BuildBrief, type Built, HeldBuilt, Ran, Settings} from "./form.ts";
import {BuildOutcome} from "./outcome.ts";
import {Copied, Pushed} from "./services.ts";
import {branchOf, buildGate, Item, openOf, Ticket} from "./ticket.ts";

// The build machine: one ticket and one round in, one typed outcome and a
// report out. One agent sits inside it, the builder, and the machine decides
// everything around it:
//
//   reading   read the ticket and the pull requests from its branch, then the
//             gate (./ticket.ts), a pure Check: go, or the one reason not to
//   copying   make the working copy on the ticket's branch, or find the one
//             an earlier round left, and install it. An Act: it writes a folder
//   building  the builder runs, as a Sub, and hands back its form
//   pushing   code commits what the builder left and pushes the branch. An Act
//   opening   code opens the pull request, or finds the open one and makes its
//             text this round's. An Act, read before written
//   over      the outcome, and the report it was worked out from
//
// The builder never commits, pushes or opens anything: it has no network and
// no account. Code does each write, from the state, with an intent kept in
// the state before the write goes out, so a restart sends the same write
// again and the service finds its own first one.
//
// Its input is the ticket, the round, what the last review left open, and
// the settings, so it runs alone or under a parent, the same way.

const Unknown = ["unknown"] as const;

/** One build, as asked: a ticket, its round, and what the round before it left open. */
export const BuildAsk = Schema.Struct({
	ticket: Schema.String,
	number: Schema.Finite,
	round: Schema.Finite,
	open: Schema.Array(Item),
});
export type BuildAsk = typeof BuildAsk.Type;

/** A ticket, by url and number. */
const TicketIn = Schema.Struct({ticket: Schema.String, number: Schema.Finite});
const PushIn = Schema.Struct({ticket: Schema.String, copied: Copied, message: Commit});
const OpenIn = Schema.Struct({
	ticket: Schema.String,
	number: Schema.Finite,
	title: Schema.String,
	body: PrBody,
});

export const readTicket = gather("build_ticket", {input: TicketIn, ok: Ticket, err: Unknown});

export const copyTree = act("build_copy", {input: TicketIn, ok: Copied, err: Unknown});

export const pushBranch = act("build_push", {
	input: PushIn,
	ok: Pushed,
	err: ["unknown", "exam_touched"],
});

export const openPr = act("build_open", {input: OpenIn, ok: Schema.String, err: Unknown});

type TicketCmd = ReturnType<typeof readTicket>;
type CopyCmd = ReturnType<typeof copyTree>;
type PushCmd = ReturnType<typeof pushBranch>;
type OpenCmd = ReturnType<typeof openPr>;
export type BuildCmd = TicketCmd | CopyCmd | PushCmd | OpenCmd;

type At = {readonly ticket: string; readonly round: number; readonly run: number};
/** One builder run. `run` numbers the runs of one round, so a run started again after a restart is told apart. */
export type RunSub = Sub<
	"build_run",
	At & {readonly brief: BuildBrief; readonly settings: Settings}
>;

/**
 * How many times one round may start its builder: the first, and once more
 * after a restart. A restart in `building` starts the agent again on the
 * working copy as it stands, and on the round's conversation where one was
 * kept (`session`), so it carries on rather than starting over.
 */
export const MAX_RUNS = 2;

/** What a build leaves besides its outcome. */
export const BuildReport = Schema.Struct({
	/** The pull request. `null`: none was opened or found. */
	pr: Schema.NullOr(Schema.String),
	/** The branch's commit after the push. `null`: nothing was pushed. */
	head: Schema.NullOr(Schema.String),
	/** This round added a commit. */
	changed: Schema.Boolean,
	/** The builder's form. `null`: it handed none back. */
	built: Schema.NullOr(HeldBuilt),
	/** What the builder's last run cost. `null`: none was started. */
	ran: Schema.NullOr(Ran),
	runs: Schema.Finite,
	/** Why it stopped, in words, where the outcome alone does not say. */
	problems: Schema.Array(Schema.String),
});
export type BuildReport = typeof BuildReport.Type;

/** `session`: the round's conversation with the builder, named by the starter (see `BuildBrief`). */
const Held = Schema.Struct({ask: BuildAsk, settings: Settings, session: Schema.String});
type Held = typeof Held.Type;
const Read = Schema.Struct({
	...Held.fields,
	ticket: Ticket,
	/** The ticket's criteria, at least one: the gate let no other ticket through. */
	criteria: Schema.NonEmptyArray(Criterion),
});
const Made = Schema.Struct({...Read.fields, copied: Copied});
type Made = typeof Made.Type;
const Done = Schema.Struct({...Made.fields, built: HeldBuilt, ran: Ran, runs: Schema.Finite});
type Done = typeof Done.Type;

/** The build machine's state, and the schema it is kept and read back through. */
export const Build = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("reading"),
		asked: keptCmd(readTicket, TicketIn),
	}),
	Schema.Struct({
		...Read.fields,
		phase: Schema.Literal("copying"),
		asked: keptAct(copyTree, TicketIn),
	}),
	Schema.Struct({...Made.fields, phase: Schema.Literal("building"), run: Schema.Finite}),
	Schema.Struct({
		...Done.fields,
		phase: Schema.Literal("pushing"),
		asked: keptAct(pushBranch, PushIn),
	}),
	Schema.Struct({
		...Done.fields,
		phase: Schema.Literal("opening"),
		pushed: Pushed,
		asked: keptAct(openPr, OpenIn),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("over"),
		outcome: BuildOutcome,
		report: BuildReport,
	}),
]);
export type Build = typeof Build.Type;

/** Why a run left no form. */
export type Failed = "broke" | "misfit" | "over_budget";

export type BuildMsg =
	| {
			readonly type: "start";
			readonly ask: BuildAsk;
			readonly settings: Settings;
			readonly session: string;
	  }
	/**
	 * Sent once after booting from saved state: re-issue whatever was in
	 * flight. A ref's `start` sends it before the builder's Listen opens again, so
	 * it always finds the phase the state was kept in.
	 */
	| {readonly type: "resume"}
	| (At & {readonly type: "build_built"; readonly built: Built; readonly ran: Ran})
	| (At & {
			readonly type: "build_failed";
			readonly why: Failed;
			readonly error: string | null;
			readonly ran: Ran;
	  });

type Step = readonly [Build, readonly BuildCmd[]];
const stay = (s: Build): Step => [s, []];
const held = (s: Held): Held => ({ask: s.ask, settings: s.settings, session: s.session});

const blank: BuildReport = {
	pr: null,
	head: null,
	changed: false,
	built: null,
	ran: null,
	runs: 0,
	problems: [],
};
const end = (s: Held, outcome: BuildOutcome, report: Partial<BuildReport> = {}): Step => [
	{...held(s), phase: "over", outcome, report: {...blank, ...report}},
	[],
];

const intent = (s: Held, step: string) => intentOf("build", s.ask.ticket, s.ask.round, step);

/** The brief one run is handed, from the state. */
export const briefOf = (s: Made): BuildBrief => ({
	ticket: s.ask.ticket,
	number: s.ask.number,
	title: s.ticket.title,
	body: s.ticket.body,
	criteria: s.criteria,
	round: s.ask.round,
	open: s.ask.open,
	rules: s.ticket.rules,
	tree: s.copied.tree,
	branch: s.copied.branch,
	session: s.session,
});

/** The commit's message, as parts (`./body.ts` writes it). It closes nothing. Pure. */
export const messageOf = (s: Done): Commit => ({
	title: s.ticket.title,
	round: s.ask.round,
	summary: s.built.summary,
	refs: s.ask.number,
});

/**
 * The pull request's text, as parts (`./body.ts` writes it). It closes the
 * ticket the build was asked for, and only that: the builder's words are
 * parts of their own, never a reference. Pure.
 */
export const bodyOf = (s: Done): PrBody => ({
	closes: s.ask.number,
	round: s.ask.round,
	summary: s.built.summary,
	deviations: s.built.deviations,
	ran: s.built.ran,
	left: s.built.left,
});

const isRun = (s: Build, m: At): s is Extract<Build, {phase: "building"}> =>
	s.phase === "building" && m.ticket === s.ask.ticket && m.round === s.ask.round && m.run === s.run;

function push(s: Done): Step {
	const asked = pushBranch({
		ticket: s.ask.ticket,
		copied: s.copied,
		message: messageOf(s),
		intent: intent(s, "push"),
	});
	return [{...s, phase: "pushing", asked}, [asked]];
}

const doneOf = (s: Extract<Build, {phase: "pushing" | "opening"}>): Done => ({
	...held(s),
	ticket: s.ticket,
	criteria: s.criteria,
	copied: s.copied,
	built: s.built,
	ran: s.ran,
	runs: s.runs,
});

/** The builder's run: on only while building. */
export const runSub = listen("build_run", (s: Build) =>
	s.phase === "building"
		? {
				ticket: s.ask.ticket,
				round: s.ask.round,
				run: s.run,
				brief: briefOf(s),
				settings: s.settings,
			}
		: null,
);

export const build = defineMachine({
	types: {
		model: {} as Build,
		msg: {} as BuildMsg,
		sub: {} as RunSub,
		ctx: undefined,
	},
	cmds: [readTicket, copyTree, pushBranch, openPr],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const asked = readTicket({ticket: m.ask.ticket, number: m.ask.number});
			return [
				{ask: m.ask, settings: m.settings, session: m.session, phase: "reading", asked},
				[asked],
			];
		},
		resume: (s): Step => {
			if (
				s.phase === "reading" ||
				s.phase === "copying" ||
				s.phase === "pushing" ||
				s.phase === "opening"
			)
				return [s, [s.asked]];
			if (s.phase !== "building") return stay(s);
			// The run that was on is gone with the process. Start it again, once, on the copy as it stands.
			if (s.run >= MAX_RUNS)
				return end(
					s,
					{kind: "stuck", why: "over_budget"},
					{
						runs: s.run,
						problems: [`the builder was cut off ${s.run} times, and is not started again`],
					},
				);
			return [{...s, run: s.run + 1}, []];
		},

		build_ticket_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const ticket = m.value;
			const gate = buildGate(ticket);
			if (gate.answer === "stop") return end(s, gate.outcome, {pr: openOf(ticket)?.url ?? null});
			const asked = copyTree({
				ticket: s.ask.ticket,
				number: s.ask.number,
				intent: intent(s, "copy"),
			});
			return [{...held(s), ticket, criteria: gate.criteria, phase: "copying", asked}, [asked]];
		},
		build_ticket_err: (s): Step =>
			s.phase === "reading" ? end(s, {kind: "stuck", why: "read_failed"}) : stay(s),

		build_copy_ok: (s, m): Step =>
			s.phase === "copying"
				? [
						{
							...held(s),
							ticket: s.ticket,
							criteria: s.criteria,
							copied: m.value,
							phase: "building",
							run: 1,
						},
						[],
					]
				: stay(s),
		build_copy_err: (s): Step =>
			s.phase === "copying" ? end(s, {kind: "stuck", why: "copy_failed"}) : stay(s),

		build_built: (s, m): Step =>
			isRun(s, m)
				? push({
						...held(s),
						ticket: s.ticket,
						criteria: s.criteria,
						copied: s.copied,
						built: m.built,
						ran: m.ran,
						runs: s.run,
					})
				: stay(s),
		build_failed: (s, m): Step => {
			if (!isRun(s, m)) return stay(s);
			const base = {ran: m.ran, runs: s.run};
			if (m.why === "over_budget")
				return end(
					s,
					{kind: "stuck", why: "over_budget"},
					{...base, problems: [`the builder reached its limit of ${s.settings.budget} dollars`]},
				);
			const problem =
				m.why === "misfit"
					? "what the builder handed back does not read as a form"
					: (m.error ?? "the builder broke");
			return end(s, {kind: "stuck", why: "draft_failed"}, {...base, problems: [problem]});
		},

		build_push_ok: (s, m): Step => {
			if (s.phase !== "pushing") return stay(s);
			const done = doneOf(s);
			const pushed = m.value;
			const report = {
				head: pushed.head,
				changed: pushed.changed,
				built: s.built,
				ran: s.ran,
				runs: s.runs,
			};
			const open = openOf(s.ticket);
			if (!pushed.changed) {
				// Nothing new: the open pull request stands as it was. With none, there is nothing to open one on.
				if (open === null)
					return end(
						s,
						{kind: "stuck", why: "no_change"},
						{
							...report,
							problems: [
								"the builder changed nothing, and no pull request is open from the branch",
							],
						},
					);
				return end(
					s,
					{kind: "done", part: false, pr: open.url, head: pushed.head, changed: false},
					{
						...report,
						pr: open.url,
					},
				);
			}
			const asked = openPr({
				ticket: s.ask.ticket,
				number: s.ask.number,
				title: s.ticket.title,
				body: bodyOf(done),
				intent: intent(s, "open"),
			});
			return [{...done, phase: "opening", pushed, asked}, [asked]];
		},
		build_push_err: (s, m): Step =>
			s.phase === "pushing"
				? end(
						s,
						{kind: "stuck", why: m.error._tag === "exam_touched" ? "exam_touched" : "push_failed"},
						{built: s.built, ran: s.ran, runs: s.runs},
					)
				: stay(s),

		build_open_ok: (s, m): Step =>
			s.phase === "opening"
				? end(
						s,
						{kind: "done", part: false, pr: m.value, head: s.pushed.head, changed: true},
						{
							pr: m.value,
							head: s.pushed.head,
							changed: true,
							built: s.built,
							ran: s.ran,
							runs: s.runs,
						},
					)
				: stay(s),
		build_open_err: (s): Step =>
			s.phase === "opening"
				? end(
						s,
						{kind: "stuck", why: "open_failed"},
						{
							head: s.pushed.head,
							changed: s.pushed.changed,
							built: s.built,
							ran: s.ran,
							runs: s.runs,
						},
					)
				: stay(s),
	},
	subs: [runSub],
});

export {branchOf};
