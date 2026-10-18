import {defineMachine} from "@demlik/tea";
import {Schema} from "effect";
import {act, intentOf} from "../../primitives.ts";
import {Item} from "../build/ticket.ts";
import {nameOf} from "../outcome.ts";
import {TextKind} from "../review/pack.ts";
import {Reviewed} from "../review/program.ts";
import {EFFORTS, Settings} from "../review/reviewer.ts";
import type {LoopOutcome} from "./outcome.ts";
import {
	afterBuild,
	afterReview,
	afterShip,
	BuildEnd,
	type Next,
	openItems,
	type Round,
	ShipEnd,
} from "./stop.ts";

// The loop machine: one ticket in, rounds of build and review until the stop
// rule (./stop.ts) says to ship or to stop. It is small on purpose: each stage
// is a machine of its own, and the loop starts each one as an Act and reads
// its outcome. It never reads a stage's state, and no stage knows the loop.
//
//   building   a build machine runs this round, told what the last review left open
//   reviewing  a review machine reads the pull request at its new head
//   posting    the review's verdicts go on the pull request as comments, so
//              the ship stage reads them the way it reads a reviewer's
//   shipping   a ship machine runs on the pull request
//   over       the outcome, every round, and which stage's outcome ended it
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
	/** The most build rounds. */
	rounds: Schema.Finite,
	/** read: ship says what it would do and writes nothing. write: ship runs to its end. */
	ship: Schema.Literals(["read", "write"]),
});
export type LoopSettings = typeof LoopSettings.Type;

export const runBuild = act("loop_build", {
	input: Schema.Struct({
		ticket: Schema.String,
		number: Schema.Finite,
		round: Schema.Finite,
		open: Schema.Array(Item),
		settings: Settings,
	}),
	ok: BuildEnd,
	err: Unknown,
});

export const runReview = act("loop_review", {
	input: Schema.Struct({
		ticket: Schema.String,
		pr: Schema.String,
		round: Schema.Finite,
		rubrics: Schema.String,
		settings: Settings,
	}),
	ok: Reviewed,
	err: Unknown,
});

/** One verdict to post: the kind, pass or fail, the reason, and the review's text. */
export const Post = Schema.Struct({
	kind: TextKind,
	verdict: Schema.Literals(["pass", "fail"]),
	reason: Schema.String,
	text: Schema.String,
});
export type Post = typeof Post.Type;

export const postVerdicts = act("loop_post", {
	input: Schema.Struct({pr: Schema.String, head: Schema.String, posts: Schema.Array(Post)}),
	ok: Schema.Literal("posted"),
	err: Unknown,
});

export const runShip = act("loop_ship", {
	input: Schema.Struct({
		ticket: Schema.String,
		pr: Schema.String,
		round: Schema.Finite,
		mode: Schema.Literals(["read", "write"]),
	}),
	ok: ShipEnd,
	err: Unknown,
});

type BuildCmd = ReturnType<typeof runBuild>;
type ReviewCmd = ReturnType<typeof runReview>;
type PostCmd = ReturnType<typeof postVerdicts>;
type ShipCmd = ReturnType<typeof runShip>;
export type LoopCmd = BuildCmd | ReviewCmd | PostCmd | ShipCmd;

type Held = {
	readonly ticket: string;
	readonly number: number;
	readonly settings: LoopSettings;
	readonly rounds: readonly Round[];
};
type At = Held & {readonly round: number};

export type Loop =
	| {readonly phase: "idle"}
	| (At & {readonly phase: "building"; readonly asked: BuildCmd})
	| (At & {readonly phase: "reviewing"; readonly pr: string; readonly asked: ReviewCmd})
	| (At & {
			readonly phase: "posting";
			readonly pr: string;
			readonly next: Next;
			readonly asked: PostCmd;
	  })
	| (At & {readonly phase: "shipping"; readonly pr: string; readonly asked: ShipCmd})
	| (Held & {
			readonly phase: "over";
			readonly outcome: LoopOutcome;
			/** The last stage outcome the loop read before it ended, by name, or why no stage could be run. */
			readonly said: string;
	  });

export type LoopMsg =
	| {
			readonly type: "start";
			readonly ticket: string;
			readonly number: number;
			readonly settings: LoopSettings;
	  }
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"};

type Step = readonly [Loop, readonly LoopCmd[]];
const stay = (s: Loop): Step => [s, []];
const held = (s: Held): Held => ({
	ticket: s.ticket,
	number: s.number,
	settings: s.settings,
	rounds: s.rounds,
});
const intent = (s: At, stage: string) => intentOf("loop", s.ticket, s.round, stage);
const agent = (s: Held) => ({
	model: s.settings.model,
	effort: s.settings.effort,
	budget: s.settings.budget,
});

/** The rounds, with the last one changed. */
const lastIs = (rounds: readonly Round[], change: Partial<Round>): readonly Round[] => {
	const last = rounds.at(-1);
	return last === undefined ? rounds : [...rounds.slice(0, -1), {...last, ...change}];
};

const over = (s: Held, outcome: LoopOutcome, said: string): Step => [
	{...held(s), phase: "over", outcome, said},
	[],
];

function build(s: Held, round: number, open: readonly Item[]): Step {
	const at = {...held(s), round};
	const asked = runBuild({
		ticket: s.ticket,
		number: s.number,
		round,
		open,
		settings: agent(s),
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
		settings: agent(s),
		intent: intent(s, "review"),
	});
	return [{...held(s), round: s.round, phase: "reviewing", pr, asked}, [asked]];
}

function ship(s: At, pr: string): Step {
	const asked = runShip({
		ticket: s.ticket,
		pr,
		round: s.round,
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
			return ship(s, pr);
		case "build":
			return build(s, s.round + 1, next.items);
		case "end":
			return over(s, next.outcome, said);
	}
}

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
	cmds: [runBuild, runReview, postVerdicts, runShip],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step =>
			s.phase === "idle"
				? build({ticket: m.ticket, number: m.number, settings: m.settings, rounds: []}, 1, [])
				: stay(s),
		resume: (s): Step => (s.phase === "idle" || s.phase === "over" ? stay(s) : [s, [s.asked]]),

		loop_build_ok: (s, m): Step => {
			if (s.phase !== "building") return stay(s);
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
			};
			const at = {...held(s), rounds: [...s.rounds, round], round: s.round};
			const next = afterBuild(s.round, m.value);
			// Only a build that is done goes on to a review, and a done build names its pull request.
			if (next.go === "review" && outcome.kind === "done") return review(at, outcome.pr);
			return next.go === "end"
				? over(at, next.outcome, m.value.name)
				: over(at, {kind: "stuck", why: "build"}, m.value.name);
		},
		loop_build_err: (s): Step =>
			s.phase === "building"
				? over(s, {kind: "stuck", why: "build"}, "the build could not be run")
				: stay(s),

		loop_review_ok: (s, m): Step => {
			if (s.phase !== "reviewing") return stay(s);
			const reviewed = m.value;
			const items = openItems(reviewed);
			const rounds = lastIs(s.rounds, {
				reviewed: reviewed.name,
				open: reviewed.outcome.kind === "done" ? 0 : items.length,
				items,
				spend: (s.rounds.at(-1)?.spend ?? 0) + (reviewed.ran?.spend.costUsd ?? 0),
			});
			const at = {...held(s), rounds, round: s.round};
			const next = afterReview(rounds, s.settings.rounds, reviewed, items);
			const posts = postsOf(reviewed);
			if (posts.length === 0 || reviewed.head === null) return go(at, s.pr, next, reviewed.name);
			const asked = postVerdicts({
				pr: s.pr,
				head: reviewed.head,
				posts,
				intent: intent(at, "post"),
			});
			return [{...at, phase: "posting", pr: s.pr, next, asked}, [asked]];
		},
		loop_review_err: (s): Step =>
			s.phase === "reviewing"
				? over(s, {kind: "stuck", why: "review"}, "the review could not be run")
				: stay(s),

		loop_post_ok: (s): Step =>
			s.phase === "posting" ? go(s, s.pr, s.next, s.rounds.at(-1)?.reviewed ?? "posted") : stay(s),
		loop_post_err: (s): Step =>
			s.phase === "posting"
				? over(s, {kind: "stuck", why: "post"}, "the verdicts could not be posted")
				: stay(s),

		loop_ship_ok: (s, m): Step => {
			if (s.phase !== "shipping") return stay(s);
			const said = m.value.outcome === null ? m.value.said : nameOf(m.value.outcome);
			const at = {...held(s), rounds: lastIs(s.rounds, {shipped: said}), round: s.round};
			return go(at, s.pr, afterShip(s.pr, s.round, s.settings.rounds, m.value), said);
		},
		loop_ship_err: (s): Step =>
			s.phase === "shipping"
				? over(s, {kind: "stuck", why: "ship"}, "the ship stage could not be run")
				: stay(s),
	},
	subs: [],
});
