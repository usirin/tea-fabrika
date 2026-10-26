import {defineMachine} from "@demlik/tea";
import {Schema} from "effect";
import {LaneId} from "../../ids.ts";
import {act, intentOf, keptAct} from "../../primitives.ts";
import {Item} from "../build/ticket.ts";
import {nameOf} from "../outcome.ts";
import {problemsOf} from "../review/machine.ts";
import {TextKind} from "../review/pack.ts";
import {Reviewed} from "../review/program.ts";
import {EFFORTS, Settings} from "../review/reviewer.ts";
import {LoopOutcome} from "./outcome.ts";
import {
	afterBuild,
	afterReview,
	afterShip,
	BuildEnd,
	Next,
	openItems,
	Round,
	ShipEnd,
	shipItems,
} from "./stop.ts";

// The loop machine: one ticket in, rounds of build and review until the stop
// rule (./stop.ts) says to ship or to stop. It is small on purpose: each stage
// is a machine of its own, and the loop starts each one as an Act and reads
// its outcome. It never reads a stage's state, and no stage knows the loop.
//
//   claiming   the loop's lane takes its ticket on the ledger (../../asks/claims.ts).
//              Held by another lane, the loop ends there: one lane works a ticket
//   building   a build machine runs this round, told what the last review left open
//   reviewing  a review machine reads the pull request at its new head
//   posting    the review's verdicts go on the pull request as comments, so
//              the ship stage reads them the way it reads a reviewer's
//   shipping   a ship machine runs on the pull request
//   releasing  the loop has its outcome, and lets its ticket go
//   over       the outcome, every round, and which stage's outcome ended it
//
// A build and a ship are asked for only between a claim this lane won and the
// release: each carries the lane, so its handler can check, at the write,
// that the lane still holds the ticket.
//
// Each Act's intent names the ticket, the round and the stage. The program
// keeps each stage's machine in the run's storage under that intent
// (./program.ts), so after a restart the same Act, sent again, finds its
// machine where it stood: a pull request is not opened twice, and a review
// already over is not run again.

const Unknown = ["unknown"] as const;

/** How the loop runs, chosen when it starts and kept in its state. */
export const LoopSettings = Schema.Struct({
	rubrics: Schema.String,
	model: Schema.String,
	effort: Schema.Literals(EFFORTS),
	/** The dollars one agent run may cost: one builder run, one reviewer run. */
	budget: Schema.Finite,
	/** read: ship says what it would do and writes nothing. write: ship runs to its end. */
	ship: Schema.Literals(["read", "write"]),
	/**
	 * The builder's and the reviewer's own model, effort and budget, as a
	 * repository's `[agents.<step>]` picked them. A step left out runs on the
	 * three above; a loop kept from before this key ran both on them.
	 */
	agents: Schema.optionalKey(
		Schema.Struct({build: Schema.optionalKey(Settings), review: Schema.optionalKey(Settings)}),
	),
});
export type LoopSettings = typeof LoopSettings.Type;

/** A ticket, and the lane that claims or lets it go. */
const LaneIn = Schema.Struct({ticket: Schema.String, lane: LaneId});
const BuildIn = Schema.Struct({
	ticket: Schema.String,
	/** The lane that holds the ticket: the handler builds only while it still does. */
	lane: LaneId,
	number: Schema.Finite,
	round: Schema.Finite,
	open: Schema.Array(Item),
	settings: Settings,
});
const ReviewIn = Schema.Struct({
	ticket: Schema.String,
	pr: Schema.String,
	round: Schema.Finite,
	rubrics: Schema.String,
	settings: Settings,
});

export const claimTicket = act("loop_claim", {
	input: LaneIn,
	/** The lane that holds the ticket after the claim: this one, or the one that held it before. */
	ok: LaneId,
	err: Unknown,
});

export const releaseTicket = act("loop_release", {
	input: LaneIn,
	ok: Schema.Literal("released"),
	err: Unknown,
});

export const runBuild = act("loop_build", {input: BuildIn, ok: BuildEnd, err: Unknown});

export const runReview = act("loop_review", {input: ReviewIn, ok: Reviewed, err: Unknown});

/** One verdict to post: the kind, pass or fail, the reason, and the review's text. */
export const Post = Schema.Struct({
	kind: TextKind,
	verdict: Schema.Literals(["pass", "fail"]),
	reason: Schema.String,
	text: Schema.String,
});
export type Post = typeof Post.Type;

const PostIn = Schema.Struct({pr: Schema.String, head: Schema.String, posts: Schema.Array(Post)});
const ShipIn = Schema.Struct({
	ticket: Schema.String,
	/** The lane that holds the ticket: the handler ships only while it still does. */
	lane: LaneId,
	pr: Schema.String,
	round: Schema.Finite,
	/** The head the review passed, which this round built: the only one the loop sends to ship. */
	head: Schema.String,
	mode: Schema.Literals(["read", "write"]),
});

export const postVerdicts = act("loop_post", {
	input: PostIn,
	ok: Schema.Literal("posted"),
	err: Unknown,
});

export const runShip = act("loop_ship", {input: ShipIn, ok: ShipEnd, err: Unknown});

type ClaimCmd = ReturnType<typeof claimTicket>;
type ReleaseCmd = ReturnType<typeof releaseTicket>;
type BuildCmd = ReturnType<typeof runBuild>;
type ReviewCmd = ReturnType<typeof runReview>;
type PostCmd = ReturnType<typeof postVerdicts>;
type ShipCmd = ReturnType<typeof runShip>;
export type LoopCmd = ClaimCmd | BuildCmd | ReviewCmd | PostCmd | ShipCmd | ReleaseCmd;

const Held = Schema.Struct({
	ticket: Schema.String,
	number: Schema.Finite,
	/** This loop's lane: the one its claim names. */
	lane: LaneId,
	settings: LoopSettings,
	rounds: Schema.Array(Round),
});
type Held = typeof Held.Type;
const At = Schema.Struct({...Held.fields, round: Schema.Finite});
type At = typeof At.Type;
const Ended = Schema.Struct({
	outcome: LoopOutcome,
	/** The last stage outcome the loop read before it ended, by name, or why no stage could be run. */
	said: Schema.String,
});
type Ended = typeof Ended.Type;

/** The loop machine's state, and the schema it is kept and read back through. */
export const Loop = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("claiming"),
		asked: keptAct(claimTicket, LaneIn),
	}),
	Schema.Struct({
		...At.fields,
		phase: Schema.Literal("building"),
		asked: keptAct(runBuild, BuildIn),
	}),
	Schema.Struct({
		...At.fields,
		phase: Schema.Literal("reviewing"),
		pr: Schema.String,
		asked: keptAct(runReview, ReviewIn),
	}),
	Schema.Struct({
		...At.fields,
		phase: Schema.Literal("posting"),
		pr: Schema.String,
		next: Next,
		asked: keptAct(postVerdicts, PostIn),
	}),
	Schema.Struct({
		...At.fields,
		phase: Schema.Literal("shipping"),
		pr: Schema.String,
		asked: keptAct(runShip, ShipIn),
	}),
	Schema.Struct({
		...Held.fields,
		...Ended.fields,
		phase: Schema.Literal("releasing"),
		asked: keptAct(releaseTicket, LaneIn),
	}),
	Schema.Struct({...Held.fields, ...Ended.fields, phase: Schema.Literal("over")}),
]);
export type Loop = typeof Loop.Type;

export type LoopMsg =
	| {
			readonly type: "start";
			readonly ticket: string;
			readonly number: number;
			/** The lane this loop is: a new one from the ledger (`newLane`, ../../asks/claims.ts). */
			readonly lane: LaneId;
			readonly settings: LoopSettings;
	  }
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"};

type Step = readonly [Loop, readonly LoopCmd[]];
const stay = (s: Loop): Step => [s, []];
const held = (s: Held): Held => ({
	ticket: s.ticket,
	number: s.number,
	lane: s.lane,
	settings: s.settings,
	rounds: s.rounds,
});
const intent = (s: At, stage: string) => intentOf("loop", s.ticket, s.round, stage);
/** The agent one step runs: its own, when the loop was given one, else the loop's shared one. */
const agent = (s: Held, step: "build" | "review"): Settings =>
	s.settings.agents?.[step] ?? {
		model: s.settings.model,
		effort: s.settings.effort,
		budget: s.settings.budget,
	};

/** The rounds, with the last one changed. */
const lastIs = (rounds: readonly Round[], change: Partial<Round>): readonly Round[] => {
	const last = rounds.at(-1);
	return last === undefined ? rounds : [...rounds.slice(0, -1), {...last, ...change}];
};

/** The loop has its outcome: it lets its ticket go, then it is over. */
function over(s: Held, outcome: LoopOutcome, said: string): Step {
	const asked = releaseTicket({
		ticket: s.ticket,
		lane: s.lane,
		intent: intentOf("loop", s.ticket, "release"),
	});
	return [{...held(s), phase: "releasing", outcome, said, asked}, [asked]];
}

/** Over for good. Only a loop that never held its ticket comes here without letting it go. */
const done = (s: Held & Ended): Step => [
	{...held(s), phase: "over", outcome: s.outcome, said: s.said},
	[],
];

function claim(s: Held): Step {
	const asked = claimTicket({
		ticket: s.ticket,
		lane: s.lane,
		intent: intentOf("loop", s.ticket, "claim"),
	});
	return [{...held(s), phase: "claiming", asked}, [asked]];
}

function build(s: Held, round: number, open: readonly Item[]): Step {
	const at = {...held(s), round};
	const asked = runBuild({
		ticket: s.ticket,
		lane: s.lane,
		number: s.number,
		round,
		open,
		settings: agent(s, "build"),
		intent: intent(at, "build"),
	});
	return [{...at, phase: "building", asked}, [asked]];
}

function review(s: At, pr: string): Step {
	const asked = runReview({
		ticket: s.ticket,
		pr,
		round: s.round,
		rubrics: s.settings.rubrics,
		settings: agent(s, "review"),
		intent: intent(s, "review"),
	});
	return [{...held(s), round: s.round, phase: "reviewing", pr, asked}, [asked]];
}

function ship(s: At, pr: string, head: string): Step {
	const asked = runShip({
		ticket: s.ticket,
		lane: s.lane,
		pr,
		round: s.round,
		head,
		mode: s.settings.ship,
		intent: intent(s, "ship"),
	});
	return [{...held(s), round: s.round, phase: "shipping", pr, asked}, [asked]];
}

/** Carry out what the stop rule said. `said`: the stage outcome it read, kept when the loop ends on it. */
function go(s: At, pr: string, next: Next, said: string): Step {
	switch (next.go) {
		case "review":
			return review(s, pr);
		case "ship":
			return ship(s, pr, next.head);
		case "build":
			return build(s, s.round + 1, next.items);
		case "end":
			return over(s, next.outcome, next.said ?? said);
	}
}

type Waiting<P extends Loop["phase"]> = Extract<Loop, {phase: P}>;
type Answer = {readonly cmd: {readonly intent: string}};

/**
 * An answer's handler, run only when the loop waits on that stage for the
 * round the answer was asked in: its Cmd's intent (ticket, round, stage) is
 * the one the state keeps. Any other answer (a late one from an earlier
 * round, one sent twice) leaves the loop where it is. Every answer goes
 * through here, so no handler can take one meant for another round.
 */
const answer =
	<
		P extends "claiming" | "building" | "reviewing" | "posting" | "shipping" | "releasing",
		M extends Answer,
	>(
		phase: P,
		handle: (s: Waiting<P>, m: M) => Step,
	) =>
	(s: Loop, m: M): Step =>
		s.phase === phase && "asked" in s && s.asked.intent === m.cmd.intent
			? handle(s as Waiting<P>, m)
			: stay(s);

/** The verdicts a review would post: one per kind it graded pass or fail. */
export function postsOf(reviewed: Reviewed): readonly Post[] {
	const met = reviewed.criteria.filter((c) => c.state === "met").length;
	const reason = `${met} of ${reviewed.criteria.length} criteria met`;
	return reviewed.verdicts.flatMap((v) => {
		const text = reviewed.comments.find((c) => c.kind === v.kind)?.text;
		if (text === undefined || v.verdict === "unseen") return [];
		return [{kind: v.kind, verdict: v.verdict, reason, text}];
	});
}

export const loop = defineMachine({
	types: {
		model: {} as Loop,
		msg: {} as LoopMsg,
		sub: {} as never,
		ctx: undefined,
	},
	cmds: [claimTicket, runBuild, runReview, postVerdicts, runShip, releaseTicket],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step =>
			s.phase === "idle"
				? claim({
						ticket: m.ticket,
						number: m.number,
						lane: m.lane,
						settings: m.settings,
						rounds: [],
					})
				: stay(s),
		resume: (s): Step => (s.phase === "idle" || s.phase === "over" ? stay(s) : [s, [s.asked]]),

		// Held by another lane, the loop never held it, and has nothing to let go.
		loop_claim_ok: answer("claiming", (s, m) =>
			m.value === s.lane
				? build(s, 1, [])
				: done({...s, outcome: {kind: "skip", why: "claimed"}, said: `${m.value} holds it`}),
		),
		// Not told: the claim may have been written. It is let go, as at any other end.
		loop_claim_err: answer("claiming", (s) =>
			over(s, {kind: "stuck", why: "claim"}, "the claim could not be made"),
		),
		loop_release_ok: answer("releasing", (s) => done(s)),
		// The program lets it go again when it tidies the loop away (./program.ts).
		loop_release_err: answer("releasing", (s) => done(s)),

		loop_build_ok: answer("building", (s, m) => {
			const {outcome, report} = m.value;
			const round: Round = {
				n: s.round,
				built: m.value.name,
				pr: report.pr,
				head: report.head,
				changed: report.changed,
				reviewed: null,
				open: null,
				items: [],
				shipped: null,
				spend: report.ran?.spend.costUsd ?? 0,
				problems: report.problems,
			};
			const at = {...held(s), rounds: [...s.rounds, round], round: s.round};
			const next = afterBuild(s.round, m.value);
			// Only a build that is done goes on to a review, and a done build names its pull request.
			if (next.go === "review" && outcome.kind === "done") return review(at, outcome.pr);
			return next.go === "end"
				? over(at, next.outcome, m.value.name)
				: over(at, {kind: "stuck", why: "build"}, m.value.name);
		}),
		loop_build_err: answer("building", (s) =>
			over(s, {kind: "stuck", why: "build"}, "the build could not be run"),
		),

		loop_review_ok: answer("reviewing", (s, m) => {
			const reviewed = m.value;
			const items = openItems(reviewed);
			const last = s.rounds.at(-1);
			const rounds = lastIs(s.rounds, {
				reviewed: reviewed.name,
				open: reviewed.outcome.kind === "done" ? 0 : items.length,
				items,
				spend: (last?.spend ?? 0) + reviewed.cost,
				problems: [...(last?.problems ?? []), ...problemsOf(reviewed)],
			});
			const at = {...held(s), rounds, round: s.round};
			const next = afterReview(rounds, reviewed, items);
			const posts = postsOf(reviewed);
			if (posts.length === 0 || reviewed.head === null) return go(at, s.pr, next, reviewed.name);
			const asked = postVerdicts({
				pr: s.pr,
				head: reviewed.head,
				posts,
				intent: intent(at, "post"),
			});
			return [{...at, phase: "posting", pr: s.pr, next, asked}, [asked]];
		}),
		loop_review_err: answer("reviewing", (s) =>
			over(s, {kind: "stuck", why: "review"}, "the review could not be run"),
		),

		loop_post_ok: answer("posting", (s) =>
			go(s, s.pr, s.next, s.rounds.at(-1)?.reviewed ?? "posted"),
		),
		loop_post_err: answer("posting", (s) =>
			over(s, {kind: "stuck", why: "post"}, "the verdicts could not be posted"),
		),

		loop_ship_ok: answer("shipping", (s, m) => {
			const said = m.value.outcome === null ? m.value.said : nameOf(m.value.outcome);
			// A ship that sent it back left one item open: the round keeps it, for the stall rule.
			const items = shipItems(m.value);
			const rounds = lastIs(
				s.rounds,
				items.length === 0 ? {shipped: said} : {shipped: said, open: items.length, items},
			);
			const at = {...held(s), rounds, round: s.round};
			return go(at, s.pr, afterShip(s.pr, rounds, m.value), said);
		}),
		loop_ship_err: answer("shipping", (s) =>
			over(s, {kind: "stuck", why: "ship"}, "the ship stage could not be run"),
		),
	},
	subs: [],
});
