import {structuralHash} from "@demlik/tea";
import {criterionId, laneId} from "../ids.ts";
import {intentOf} from "../primitives.ts";
import type {BuildOutcome} from "../stages/build/outcome.ts";
import {
	claimTicket,
	type Loop,
	type LoopCmd,
	type LoopSettings,
	loop,
	postVerdicts,
	releaseTicket,
	runBuild,
	runReview,
	runShip,
} from "../stages/operate/machine.ts";
import type {BuildEnd, ShipEnd} from "../stages/operate/stop.ts";
import {nameOf} from "../stages/outcome.ts";
import type {ReviewOutcome} from "../stages/review/outcome.ts";
import type {Reviewed} from "../stages/review/program.ts";
import type {Judged} from "../stages/review/verdict.ts";
import type {ShipOutcome} from "../stages/ship/outcome.ts";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	type Step,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// The operate loop under every order of messages. It starts a build, a
// review and a ship as Acts and reads only their typed outcomes, so its world
// is the set of outcomes each stage can hand back.
//
// What the loop models: rounds of build and review, a stall rule (a second
// round in a row with no fewer open, or a third in a row with no new lowest:
// ask the owner), and ship after a passed review. What it does not model: a
// person's answer. There is no "keep going" Msg, no owner removing a
// criterion, and no plan with tasks.
//
// There is no cap on rounds, so the loop's own state never stops growing: each
// round adds one to its list. The search is bounded by its inputs instead: the
// world has a finite number of review results (`reviews`), and a review asked
// for in a later round is never answered.
//
// What the stall rule alone ends: every loop. A list that never grows, with at
// most K open a round, ends by round 2K + 1: each count can stand for two
// rounds (the second is the one stall it earns), and it must fall between
// counts. A list that grows and shrinks by turns (1, 2, 1, 2) never stalls
// twice in a row, but it must bring a new lowest every third round, and the
// lowest cannot fall below 1: with at most K open, it ends by round 3K
// (`endsBy`; a search of every list for K up to 3 finds no longer one).

export type AnyLoopMsg = MsgOf<typeof loop>;
type Msg = AnyLoopMsg;
const loopUpdate = stepOf<Loop, Msg, LoopCmd>(loop);

const PR = "P";
export const SETTINGS: LoopSettings = {
	rubrics: "r",
	model: "m",
	effort: "low",
	budget: 1,
	ship: "write",
};

/** The most a round leaves open in this world: a review's 3 criteria. A ship that sends it back leaves 1. */
const MOST_OPEN = 3;

const buildEnd = (outcome: BuildOutcome, head: string | null): BuildEnd => ({
	outcome,
	name: nameOf(outcome),
	report: {
		pr: PR,
		head,
		changed: outcome.kind === "done" ? outcome.changed : false,
		built: null,
		ran: null,
		runs: 1,
		problems: [],
	},
});

const judged = (n: number, met: boolean): Judged => ({
	id: criterionId(`c${n}`),
	version: 1,
	text: `criterion ${n}`,
	from: "ticket",
	state: met ? "met" : "open",
	says: met ? "seen" : "not met",
	where: [],
	findings: [],
});

/** A review's end, at one head, with `open` of the `MOST_OPEN` criteria left open. */
const reviewed = (outcome: ReviewOutcome, head: string, open: number): Reviewed => ({
	pr: PR,
	outcome,
	name: nameOf(outcome) as Reviewed["name"],
	head,
	replay: false,
	// The loop reads no verdict row: those are ship's, through the criteria record.
	ticket: null,
	criteria: Array.from({length: MOST_OPEN}, (_, i) => judged(i + 1, i + 1 > open)),
	rows: [],
	verdicts: [{kind: "review-code", verdict: outcome.kind === "done" ? "pass" : "fail"}],
	left: [],
	comments: [{kind: "review-code", text: "the review"}],
	notes: [],
	problems: [],
	refusals: [],
	ran: null,
	cost: 0,
	runs: 1,
});

const shipEnd = (outcome: ShipOutcome | null): ShipEnd => ({
	outcome,
	said: outcome === null ? "would enqueue" : nameOf(outcome),
});

export interface LoopWorldOptions {
	readonly heads?: readonly string[];
	/**
	 * How many rounds' reviews the world answers: a review asked for in a
	 * later round never ends. What bounds the search, now that the loop has no
	 * cap. Default 2.
	 */
	readonly reviews?: number;
	/** How many open a failed review may leave, from 1 to `MOST_OPEN`. Default all. */
	readonly opens?: readonly number[];
	readonly echoes?: boolean;
}

const UNKNOWN = {_tag: "unknown" as const};
/** This loop's lane, and another that may hold its ticket. */
const LANE = laneId("L1");
const OTHER = laneId("L2");

export function loopWorld(options: LoopWorldOptions = {}): World<Loop, Msg, LoopCmd> {
	const heads = options.heads ?? ["A", "B"];
	const reviews = options.reviews ?? 2;
	const opens = options.opens ?? Array.from({length: MOST_OPEN}, (_, i) => i + 1);
	return {
		outside: () => [
			{type: "start", ticket: "T", number: 1, lane: LANE, settings: SETTINGS},
			{type: "resume"},
		],
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "loop_claim":
					// It takes the ticket, another lane holds it, or the ledger could not be asked.
					return [
						claimTicket.ok(cmd, cmd.lane, 0),
						claimTicket.ok(cmd, OTHER, 0),
						claimTicket.err(cmd, UNKNOWN, 0),
					];
				case "loop_release":
					return [releaseTicket.ok(cmd, "released", 0), releaseTicket.err(cmd, UNKNOWN, 0)];
				case "loop_build":
					return [
						...heads.map((head) =>
							runBuild.ok(
								cmd,
								buildEnd({kind: "done", part: false, pr: PR, head, changed: true}, head),
								0,
							),
						),
						runBuild.ok(
							cmd,
							buildEnd({kind: "done", part: false, pr: PR, head: "A", changed: false}, "A"),
							0,
						),
						runBuild.ok(cmd, buildEnd({kind: "stuck", why: "draft_failed"}, null), 0),
						runBuild.err(cmd, UNKNOWN, 0),
					];
				case "loop_review":
					if (cmd.round > reviews) return [];
					return [
						...heads.flatMap((head) => [
							runReview.ok(cmd, reviewed({kind: "done", part: false, head}, head, 0), 0),
							...opens.map((open) =>
								runReview.ok(
									cmd,
									reviewed({kind: "send", to: "builder", why: "review_failed"}, head, open),
									0,
								),
							),
							runReview.ok(cmd, reviewed({kind: "stuck", why: "unseen"}, head, 1), 0),
						]),
						runReview.err(cmd, UNKNOWN, 0),
					];
				case "loop_post":
					return [postVerdicts.ok(cmd, "posted", 0), postVerdicts.err(cmd, UNKNOWN, 0)];
				case "loop_ship":
					return [
						...[
							{kind: "done", part: false, commit: "main-1", cleanup: "done"} as const,
							{kind: "send", to: "builder", why: "checks_red"} as const,
							{kind: "send", to: "reviewer", why: "no_review"} as const,
							{kind: "stuck", why: "checks_stuck"} as const,
							null,
						].map((o) => runShip.ok(cmd, shipEnd(o), 0)),
						runShip.err(cmd, UNKNOWN, 0),
					];
			}
		},
		restart: (msg) => msg.type === "resume",
		...(options.echoes === undefined ? {} : {echoes: options.echoes}),
	};
}

/**
 * The stall rule, counted here on its own, as the laws read it: what each
 * round left open, its review's list, or 1 when the ship sent the passed head
 * back. It does not call the code under test, and keeps the rounds
 * themselves where the code keeps counts.
 */
type Count = {
	/** The round being worked: the last one a build was asked for. */
	readonly round: number;
	/**
	 * What each round before left open, oldest first, since the count last
	 * started: a round that left nothing open, or sent nothing back, starts it
	 * over.
	 */
	readonly before: readonly number[];
	/** What this round left open, once its review or its ship sent it back. `null`: nothing sent back yet. */
	readonly now: number | null;
};
const NO_COUNT: Count = {round: 0, before: [], now: null};

/** The count after one step: a review or a ship of the round asked now that sends it back sets `now`. */
function counted(c: Count, step: Step<Loop, Msg, LoopCmd>): Count {
	const {msg, prev} = step;
	if (!("cmd" in msg) || !("asked" in prev) || msg.cmd.intent !== prev.asked.intent) return c;
	if (msg.type === "loop_review_ok") {
		const {outcome, criteria} = msg.value;
		if (outcome.kind !== "send") return {...c, now: null};
		const open =
			outcome.why === "checks_red" ? 1 : criteria.filter((x) => x.state === "open").length;
		return {...c, now: open};
	}
	if (msg.type === "loop_ship_ok") {
		const {outcome} = msg.value;
		return {...c, now: outcome?.kind === "send" && outcome.to === "builder" ? 1 : null};
	}
	return c;
}

/**
 * This round is one the owner is asked at: the second in a row to leave no
 * fewer open than the round before, or the third in a row to leave no fewer
 * than the lowest of the rounds before those three.
 */
const asks = (c: Count): boolean => {
	const {now, before} = c;
	if (now === null || now === 0) return false;
	const [a, b] = before.slice(-2);
	const twoStalls = a !== undefined && b !== undefined && b >= a && now >= b;
	const earlier = before.slice(0, -2);
	const noNewLowest =
		earlier.length > 0 &&
		a !== undefined &&
		b !== undefined &&
		Math.min(...earlier) <= Math.min(a, b, now);
	return twoStalls || noNewLowest;
};

/** The round of a build this step asks for, past the one being worked. A restart sends the same round's build again: that one is not new. */
const newBuild = (c: Count, step: Step<Loop, Msg, LoopCmd>): number | null =>
	buildsIn(step.cmds).find((round) => round > c.round) ?? null;

/** The rounds of the builds among `cmds`. */
const buildsIn = (cmds: readonly LoopCmd[]): readonly number[] =>
	cmds.flatMap((cmd) => (cmd.type === "loop_build" ? [cmd.round] : []));

/** A new round started: this one is now the round before. */
const built = (c: Count, round: number): Count => ({
	round,
	before: c.now === null || c.now === 0 ? [] : [...c.before, c.now],
	now: null,
});

/** The rounds the count holds, this one last, for a law's words. */
const shown = (c: Count): string => [...c.before, c.now].join(", ");

type Seen = {
	/** The head the latest build pushed. */
	readonly built: string | null;
	/** The latest review's end, once a build came before it. */
	readonly review: {readonly kind: string; readonly head: string | null} | null;
};

export function loopLaws<S extends Loop>(): readonly Law<S, Msg, LoopCmd>[] {
	return [
		watched<S, Msg, LoopCmd, Seen>(
			"ship only on a passed review of the head this round built",
			{built: null, review: null},
			(seen, step) => {
				const {msg, prev} = step;
				const now: Seen =
					msg.type === "loop_build_ok" && prev.phase === "building"
						? {built: msg.value.report.head, review: null}
						: msg.type === "loop_review_ok" && prev.phase === "reviewing"
							? {...seen, review: {kind: msg.value.outcome.kind, head: msg.value.head}}
							: seen;
				for (const cmd of step.cmds) {
					if (cmd.type !== "loop_ship") continue;
					if (now.review === null || now.review.kind !== "done")
						return broke(
							`ship, and the last review ${now.review === null ? "never ended" : `ended ${now.review.kind}`}`,
						);
					if (now.review.head !== now.built)
						return broke(
							`ship, and the review passed ${now.review.head}, while this round built ${now.built}`,
						);
				}
				return now;
			},
		),
		watched<S, Msg, LoopCmd, readonly Judged[] | null>(
			"the builder never sets what the next round is told is open",
			null,
			(last, step) => {
				const {msg, prev} = step;
				const review =
					msg.type === "loop_review_ok" && prev.phase === "reviewing" ? msg.value.criteria : last;
				for (const cmd of step.cmds) {
					if (cmd.type !== "loop_build" || cmd.round === 1) continue;
					const open = (review ?? []).filter((c) => c.state === "open");
					// A criterion by its id; one the review added, which has none, by its words.
					const keyOf = (c: Judged) => (c.from === "ticket" ? c.id : `review: ${c.text}`);
					for (const item of cmd.open)
						if (
							item.criterion !== null &&
							!open.some((c) => keyOf(c) === item.criterion && c.text === item.text)
						)
							return broke(
								`round ${cmd.round} is told criterion ${item.criterion} is open, and no review left it open`,
							);
					const dropped = open.filter(
						(c) =>
							!cmd.open.some((item) => (item.criterion ?? `review: ${item.text}`) === keyOf(c)),
					);
					// A ship send-back follows a passed review, which left nothing open.
					if (dropped.length > 0 && msg.type === "loop_post_ok")
						return broke(
							`round ${cmd.round} is not told criteria ${dropped.map(keyOf).join(", ")} are open`,
						);
				}
				return review;
			},
		),
		watched<S, Msg, LoopCmd, Count>(
			"a round the stall rule asks the owner at never starts another build",
			NO_COUNT,
			(before, step) => {
				const c = counted(before, step);
				const next = newBuild(c, step);
				if (next === null) return c;
				if (asks(c))
					return broke(
						`rounds left ${shown(c)} open, the owner is asked, and round ${next} was started`,
					);
				return built(c, next);
			},
		),
		watched<S, Msg, LoopCmd, Count>(
			"a round the stall rule does not ask the owner at never ends the loop: there is no cap",
			NO_COUNT,
			(before, step) => {
				const c = counted(before, step);
				const {msg, prev, next} = step;
				const decides =
					msg.type === "loop_review_ok" ||
					msg.type === "loop_post_ok" ||
					msg.type === "loop_ship_ok";
				const ends =
					(next.phase === "releasing" || next.phase === "over") &&
					prev.phase !== "releasing" &&
					prev.phase !== "over";
				if (decides && ends && c.now !== null && !asks(c))
					return broke(
						`rounds left ${shown(c)} open, the owner is not asked, and the loop ended at round ${c.round}`,
					);
				const round = newBuild(c, step);
				return round === null ? c : built(c, round);
			},
		),
		watched<S, Msg, LoopCmd, boolean>(
			"builds and ships only while it holds its ticket",
			false,
			(held, step) => {
				const {msg, prev} = step;
				const told =
					msg.type === "loop_claim_ok" &&
					prev.phase === "claiming" &&
					msg.cmd.intent === prev.asked.intent
						? msg.value === prev.lane
						: held;
				// Once it asks to let the ticket go, it holds it no more.
				const now = told && !step.cmds.some((c) => c.type === "loop_release");
				for (const cmd of step.cmds)
					if ((cmd.type === "loop_build" || cmd.type === "loop_ship") && !now)
						return broke(
							`${cmd.type} in round ${cmd.round}, and the loop does not hold its ticket`,
						);
				return now;
			},
		),
		watched<S, Msg, LoopCmd, boolean>(
			"a loop that may hold its ticket lets it go before it ends",
			false,
			(owes, step) => {
				const {msg, prev, next} = step;
				const asked =
					prev.phase === "claiming" && "cmd" in msg && msg.cmd.intent === prev.asked.intent;
				// It owes a release once it may hold the ticket: told it does, or not told at all.
				const now =
					(asked
						? msg.type === "loop_claim_err" ||
							(msg.type === "loop_claim_ok" && prev.phase === "claiming" && msg.value === prev.lane)
						: owes) && !step.cmds.some((c) => c.type === "loop_release");
				if (now && next.phase === "over" && prev.phase !== "over")
					return broke("the loop ended, and never let its ticket go");
				return now;
			},
		),
		law<S, Msg, LoopCmd>("an answer counts only for the stage asked now", (step) => {
			const {msg, prev, next} = step;
			if (!("cmd" in msg) || !("asked" in prev) || !msg.type.startsWith(prev.asked.type))
				return null;
			if (msg.cmd.intent === prev.asked.intent || structuralHash(next) === structuralHash(prev))
				return null;
			return `an answer to ${msg.cmd.intent} moved the loop while it waits on ${prev.asked.intent}`;
		}),
		law<S, Msg, LoopCmd>("an ended loop sends nothing", (step) =>
			step.prev.phase === "over" && step.cmds.length > 0
				? `${step.cmds.map((c) => c.type).join(", ")} after the loop ended`
				: null,
		),
	];
}

/**
 * Every loop ends by round `last`: no build past it. Not in `loopLaws`: its
 * round hangs on the world, with `last` at 3K for at most K open a round, or
 * 2K + 1 when the lists never grow (see the top of this file).
 */
export const endsBy = (last: number): Law<Loop, Msg, LoopCmd> =>
	law(`every loop ends by round ${last}`, (step) => {
		const late = buildsIn(step.cmds).find((round) => round > last);
		return late === undefined ? null : `round ${late} was started`;
	});

export const loopInit: Loop = {phase: "idle"};
export const loopStep: Update<Loop, Msg, LoopCmd> = loopUpdate;

/** An answer, with the round it answers, from its Cmd's intent (`loop/<ticket>/<round>/<stage>`): a late answer from round 1 shows as round 1's. */
export function showLoopMsg(m: Msg): string {
	const round = "cmd" in m ? ` (round ${m.cmd.intent.split("/")[2]})` : "";
	switch (m.type) {
		case "loop_claim_ok":
			return `claim: ${m.value === m.cmd.lane ? "taken" : `${m.value} holds it`}`;
		case "loop_claim_err":
			return "claim: the ledger could not be asked";
		case "loop_release_ok":
			return "let go";
		case "loop_release_err":
			return "letting go failed";
		case "loop_build_ok":
			return `build${round}: ${m.value.name}${m.value.report.head === null ? "" : ` at ${m.value.report.head}`}${m.value.outcome.kind === "done" && !m.value.outcome.changed ? ", nothing new" : ""}`;
		case "loop_review_ok":
			return `review${round}: ${m.value.name} at ${m.value.head}, ${m.value.criteria.filter((c) => c.state === "open").length} open`;
		case "loop_post_ok":
			return `verdicts posted${round}`;
		case "loop_ship_ok":
			return `ship${round}: ${m.value.said}`;
		case "start":
			return "start";
		case "resume":
			return "restart, then resume";
		default:
			return `${m.type}${round}`;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** A review that could not decide is taken as a pass. */
export const stuckIsPassed: Update<Loop, Msg, LoopCmd> = (s, m) =>
	m.type === "loop_review_ok" && m.value.outcome.kind === "stuck"
		? loopUpdate(s, {
				...m,
				value: {
					...m.value,
					outcome: {kind: "done", part: false, head: m.value.head ?? "A"},
					name: "done",
				},
			})
		: loopUpdate(s, m);

/** The next round is told nothing: what the review left open is lost. */
export const forgetsTheOpenList: Update<Loop, Msg, LoopCmd> = (s, m) => {
	const [next, cmds] = loopUpdate(s, m);
	if (next.phase !== "building" || next.round === 1) return [next, cmds];
	const asked = runBuild({...next.asked, open: []});
	return [{...next, asked}, cmds.map((c) => (c.type === "loop_build" ? asked : c))];
};

/** The stall rule off by one: "no fewer" is read as "more", so an equal count builds again. */
export const stallOffByOne: Update<Loop, Msg, LoopCmd> = (s, m) => {
	if (m.type !== "loop_review_ok" || s.phase !== "reviewing" || s.rounds.length < 2)
		return loopUpdate(s, m);
	const rounds = s.rounds.map((r, at) =>
		at === s.rounds.length - 2 && r.open !== null ? {...r, open: r.open + 1} : r,
	);
	return loopUpdate({...s, rounds}, m);
};

/**
 * The stall rule without its lowest: shown only the last three rounds, it
 * never sees a lowest from before them, so a list that wobbles runs on.
 */
export const forgetsTheLowest: Update<Loop, Msg, LoopCmd> = (s, m) =>
	m.type === "loop_review_ok" && s.phase === "reviewing"
		? loopUpdate({...s, rounds: s.rounds.slice(-3)}, m)
		: loopUpdate(s, m);

/**
 * The loop's own copy of the stall rule, as it was before it read the asks
 * core's: it asks the owner at the first stall. Planted by showing the rule
 * the round before twice, so one stall reads as two.
 */
export const asksAtTheFirstStall: Update<Loop, Msg, LoopCmd> = (s, m) => {
	if (m.type !== "loop_review_ok" || s.phase !== "reviewing") return loopUpdate(s, m);
	const before = s.rounds.at(-2);
	if (before === undefined) return loopUpdate(s, m);
	return loopUpdate({...s, rounds: [...s.rounds.slice(0, -1), before, ...s.rounds.slice(-1)]}, m);
};

/**
 * A cap on rounds put back: where the real loop would start round 3, it lets
 * its ticket go and asks the owner, though the list may still be shrinking.
 */
export const aCapPutBack: Update<Loop, Msg, LoopCmd> = (s, m) => {
	const [next, cmds] = loopUpdate(s, m);
	if (next.phase !== "building" || next.round <= 2 || !cmds.includes(next.asked))
		return [next, cmds];
	const asked = releaseTicket({
		ticket: next.ticket,
		lane: next.lane,
		intent: intentOf("loop", next.ticket, "release"),
	});
	const {ticket, number, lane, settings, rounds} = next;
	return [
		{
			ticket,
			number,
			lane,
			settings,
			rounds,
			phase: "releasing",
			outcome: {kind: "ask", who: "owner", for: "no_progress"},
			said: "the cap",
			asked,
		},
		[asked],
	];
};

/** An answer is read by its stage alone: one for an earlier round counts for this one. */
export const takesAnyAnswer: Update<Loop, Msg, LoopCmd> = (s, m) =>
	"cmd" in m && "asked" in s
		? loopUpdate(s, {...m, cmd: {...m.cmd, intent: s.asked.intent}} as Msg)
		: loopUpdate(s, m);

/** Any answer to the claim is taken as "it is yours": the loop works a ticket another lane holds. */
export const takesAnyClaim: Update<Loop, Msg, LoopCmd> = (s, m) =>
	m.type === "loop_claim_ok" && s.phase === "claiming"
		? loopUpdate(s, {...m, value: s.lane})
		: loopUpdate(s, m);

/** The loop ends without letting its ticket go: no other lane can ever take it. */
export const keepsItsClaim: Update<Loop, Msg, LoopCmd> = (s, m) => {
	const [next, cmds] = loopUpdate(s, m);
	if (next.phase !== "releasing") return [next, cmds];
	const {asked: _, ...rest} = next;
	return [{...rest, phase: "over"}, cmds.filter((c) => c.type !== "loop_release")];
};

/** A restart after the end ships again. */
export const actsAfterTheEnd: Update<Loop, Msg, LoopCmd> = (s, m) =>
	s.phase === "over" && m.type === "resume"
		? [
				s,
				[
					runShip({
						ticket: s.ticket,
						lane: s.lane,
						pr: PR,
						round: 1,
						head: "A",
						mode: "write",
						intent: "again",
					}),
				],
			]
		: loopUpdate(s, m);
