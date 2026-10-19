import {structuralHash} from "@demlik/tea";
import {criterionId, laneId} from "../ids.ts";
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
// round in a row with no fewer open: ask the owner), a cap on rounds, and ship
// after a passed review. What it does not model: a person's answer. There is
// no "keep going" Msg, no owner removing a criterion, and no plan with tasks.

export type AnyLoopMsg = MsgOf<typeof loop>;
type Msg = AnyLoopMsg;
const loopUpdate = stepOf<Loop, Msg, LoopCmd>(loop);

const PR = "P";
export const SETTINGS: LoopSettings = {
	rubrics: "r",
	model: "m",
	effort: "low",
	budget: 1,
	rounds: 2,
	ship: "write",
};

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

/** A review's end, at one head, with `open` of three criteria left open. */
const reviewed = (outcome: ReviewOutcome, head: string, open: number): Reviewed => ({
	pr: PR,
	outcome,
	name: nameOf(outcome) as Reviewed["name"],
	head,
	replay: false,
	// The loop reads no verdict row: those are ship's, through the criteria record.
	ticket: null,
	criteria: [1, 2, 3].map((n) => judged(n, n > open)),
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
	/** The round caps a start may carry. */
	readonly caps?: readonly number[];
	readonly echoes?: boolean;
}

const UNKNOWN = {_tag: "unknown" as const};
/** This loop's lane, and another that may hold its ticket. */
const LANE = laneId("L1");
const OTHER = laneId("L2");

export function loopWorld(options: LoopWorldOptions = {}): World<Loop, Msg, LoopCmd> {
	const heads = options.heads ?? ["A", "B"];
	const caps = options.caps ?? [1, SETTINGS.rounds];
	return {
		outside: () => [
			...caps.map(
				(rounds): Msg => ({
					type: "start",
					ticket: "T",
					number: 1,
					lane: LANE,
					settings: {...SETTINGS, rounds},
				}),
			),
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
					return [
						...heads.flatMap((head) => [
							runReview.ok(cmd, reviewed({kind: "done", part: false, head}, head, 0), 0),
							...[1, 2, 3].map((open) =>
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
		watched<
			S,
			Msg,
			LoopCmd,
			{readonly open: number | null; readonly stalls: number; readonly stalled: string | null}
		>(
			"a second review in a row that leaves no fewer open never starts another build",
			{open: null, stalls: 0, stalled: null},
			(seen, step) => {
				const {msg, prev} = step;
				const reviewed = msg.type === "loop_review_ok" && prev.phase === "reviewing";
				const now =
					reviewed && msg.value.outcome.kind === "done"
						? {open: 0, stalls: 0, stalled: null}
						: reviewed && msg.value.outcome.kind === "send"
							? (() => {
									const open = msg.value.criteria.filter((c) => c.state === "open").length;
									const stalls = seen.open !== null && open >= seen.open ? seen.stalls + 1 : 0;
									return {
										open,
										stalls,
										stalled:
											stalls >= 2
												? `${open} open after ${seen.open}, the second stall in a row`
												: null,
									};
								})()
							: seen;
				const next = step.cmds.find((c) => c.type === "loop_build");
				if (now.stalled !== null && next !== undefined && next.round > 1)
					return broke(`${now.stalled}, and round ${next.round} was started`);
				return now;
			},
		),
		watched<S, Msg, LoopCmd, number | null>("no round passes the cap", null, (cap, step) => {
			const {msg, prev} = step;
			const now = msg.type === "start" && prev.phase === "idle" ? msg.settings.rounds : cap;
			// A restart sends the same round's build again: the round, not the send, is what counts.
			for (const cmd of step.cmds)
				if (cmd.type === "loop_build" && now !== null && cmd.round > now)
					return broke(`round ${cmd.round} of a cap of ${now}`);
			return now;
		}),
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
			return `start, cap ${m.settings.rounds} rounds`;
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

/** The cap is read from the wrong place, and is never reached. */
export const ignoresTheCap: Update<Loop, Msg, LoopCmd> = (s, m) =>
	m.type === "start"
		? loopUpdate(s, {...m, settings: {...m.settings, rounds: 99}})
		: loopUpdate(s, m);

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
