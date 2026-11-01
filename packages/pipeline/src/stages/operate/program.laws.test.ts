import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {type MsgOf, memoryStorage} from "@kampus/fabrika-old";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {criterionId, laneId} from "../../ids.ts";
import {intentOf} from "../../primitives.ts";
import type {BuildOutcome} from "../build/outcome.ts";
import {nameOf} from "../outcome.ts";
import type {ReviewOutcome} from "../review/outcome.ts";
import type {Reviewed} from "../review/program.ts";
import {noRun, type Ran, type Settings} from "../review/reviewer.ts";
import type {Judged} from "../review/verdict.ts";
import type {ShipOutcome} from "../ship/outcome.ts";
import {
	claimTicket,
	Loop,
	type LoopSettings,
	loop,
	postVerdicts,
	releaseTicket,
	runBuild,
	runReview,
	runShip,
} from "./machine.ts";
import type {BuildEnd, ShipEnd} from "./stop.ts";

// The operate loop as its kind keeps it, on tea's pbt: every state `loop` reaches from its init,
// driven by any list of its Msgs, saves through `Loop`, the schema the kind declares
// (./program.ts), and loads back equal. A start after a kill reads it back through that schema
// and sends its Act again, so a state the loop can reach and the schema cannot read is a lane
// that cannot go on.
//
// Beside the kind: the loop's machine file has its specs in ../../laws/specs.ts. The stages'
// ends are drawn the way ../../laws/loop.ts draws them, copied here, not imported: that file
// stands on the search engine, which a laws file does not use.

type Machine = typeof loop;
type Msg = MsgOf<Machine>;

const ctx = stubCtxThrowingProxy<undefined>();
const T = "o/r#1";
const PR = "P";
const LANE = laneId("L1");
const OTHER = laneId("L2");
const AGENT: Settings = {model: "m", effort: "low", budget: 1};
const SHARED: LoopSettings = {rubrics: "r", model: "m", effort: "low", budget: 1, ship: "write"};
const SETTINGS: readonly LoopSettings[] = [
	SHARED,
	{...SHARED, ship: "read", agents: {}},
	{
		...SHARED,
		agents: {build: {model: "b", effort: "high", budget: 2}, review: {...AGENT, model: "r"}},
	},
];
const SPENT: Ran = {
	spend: {costUsd: 0.5, tokens: 1200, context: 900, turns: 3, minutes: 2},
	tools: ["Read", "Edit"],
	refused: [{tool: "WebFetch", why: "no network"}],
	links: 1,
};

const buildEnd = (
	outcome: BuildOutcome,
	head: string | null,
	ran: Ran | null = null,
): BuildEnd => ({
	outcome,
	name: nameOf(outcome),
	report: {
		pr: head === null ? null : PR,
		head,
		changed: outcome.kind === "done" ? outcome.changed : false,
		built: null,
		ran,
		runs: 1,
		problems: outcome.kind === "stuck" ? ["the builder broke"] : [],
	},
});
const BUILDS: readonly BuildEnd[] = [
	buildEnd({kind: "done", part: false, pr: PR, head: "A", changed: true}, "A", SPENT),
	buildEnd({kind: "done", part: false, pr: PR, head: "B", changed: true}, "B"),
	buildEnd({kind: "done", part: false, pr: PR, head: "A", changed: false}, "A"),
	buildEnd({kind: "stuck", why: "draft_failed"}, null, noRun),
	buildEnd({kind: "skip", why: "closed"}, null),
];

/** Criterion `n`, met or open. An open third one is the review's own, which no ticket named. */
const judged = (n: number, met: boolean): Judged => {
	const finding = {
		id: `f${n}`,
		state: "open",
		kind: "review-code",
		from: {source: "criterion", id: criterionId(`c${n}`)},
		fault: `criterion ${n} is not met`,
		at: null,
		proof: "p",
		wants: `criterion ${n} met`,
	} as const;
	const base = {
		text: `criterion ${n}`,
		says: met ? "seen" : "not met",
		where: met ? [] : [{file: "a.ts", first: n, last: n + 1}],
		findings: met ? [] : [finding],
	};
	return n === 3 && !met
		? {...base, from: "review", state: "open"}
		: {...base, from: "ticket", id: criterionId(`c${n}`), version: 1, state: met ? "met" : "open"};
};
/** A review's end, at one head, with `open` of its 3 criteria left open. */
const reviewed = (outcome: ReviewOutcome, head: string | null, open: number): Reviewed => ({
	pr: PR,
	outcome,
	name: nameOf(outcome) as Reviewed["name"],
	head,
	replay: false,
	ticket: null,
	criteria: [1, 2, 3].map((n) => judged(n, n > open)),
	rows: [],
	verdicts: [{kind: "review-code", verdict: outcome.kind === "done" ? "pass" : "fail"}],
	left: [],
	comments: [{kind: "review-code", text: "the review"}],
	notes: [],
	problems: open > 1 ? ["no row for c2"] : [],
	refusals: open > 1 ? [["no row for c2"]] : [],
	ran: open > 0 ? SPENT : null,
	cost: open > 0 ? 0.25 : 0,
	runs: 1,
});
const REVIEWS: readonly Reviewed[] = [
	reviewed({kind: "done", part: false, head: "A"}, "A", 0),
	reviewed({kind: "done", part: false, head: "B"}, "B", 0),
	...[1, 2, 3].map((open) =>
		reviewed({kind: "send", to: "builder", why: "review_failed"}, "A", open),
	),
	reviewed({kind: "send", to: "builder", why: "checks_red"}, "A", 0),
	reviewed({kind: "stuck", why: "unseen"}, "B", 1),
	reviewed({kind: "skip", why: "closed"}, null, 0),
];
const shipEnd = (outcome: ShipOutcome | null): ShipEnd => ({
	outcome,
	said: outcome === null ? "would enqueue" : nameOf(outcome),
});
const SHIPS: readonly ShipEnd[] = [
	{kind: "done", part: false, commit: "main-1", cleanup: "done"} as const,
	{kind: "send", to: "builder", why: "checks_red"} as const,
	{kind: "send", to: "reviewer", why: "no_review"} as const,
	{kind: "ask", who: "owner", for: "approval"} as const,
	{kind: "stuck", why: "checks_stuck"} as const,
	null,
].map(shipEnd);

/** Rounds the answers name: the loop asks round 1 first, and a late answer may name any. */
const round = fc.integer({min: 1, max: 3});
const UNKNOWN = {_tag: "unknown"} as const;
const at = (r: number, stage: string) => intentOf("loop", T, r, stage);
const claimed = claimTicket({ticket: T, lane: LANE, intent: intentOf("loop", T, "claim")});
const released = releaseTicket({ticket: T, lane: LANE, intent: intentOf("loop", T, "release")});
const buildOf = (r: number) =>
	runBuild({
		ticket: T,
		lane: LANE,
		number: 1,
		round: r,
		open: [],
		settings: AGENT,
		intent: at(r, "build"),
	});
const reviewOf = (r: number) =>
	runReview({ticket: T, pr: PR, round: r, rubrics: "r", settings: AGENT, intent: at(r, "review")});
const postOf = (r: number) => postVerdicts({pr: PR, head: "A", posts: [], intent: at(r, "post")});
const shipOf = (r: number) =>
	runShip({
		ticket: T,
		lane: LANE,
		pr: PR,
		round: r,
		head: "A",
		mode: "write",
		intent: at(r, "ship"),
	});

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {
		ticket: fc.constant(T),
		number: fc.constant(1),
		lane: fc.constant(LANE),
		settings: fc.constantFrom(...SETTINGS),
	}),
	resume: arbConstantMsg("resume"),
	loop_claim_ok: fc
		.oneof({weight: 4, arbitrary: fc.constant(LANE)}, {weight: 1, arbitrary: fc.constant(OTHER)})
		.map((holder) => claimTicket.ok(claimed, holder, 0)),
	loop_claim_err: fc.constant(claimTicket.err(claimed, UNKNOWN, 0)),
	loop_release_ok: fc.constant(releaseTicket.ok(released, "released", 0)),
	loop_release_err: fc.constant(releaseTicket.err(released, UNKNOWN, 0)),
	loop_build_ok: fc
		.tuple(round, fc.constantFrom(...BUILDS))
		.map(([r, end]) => runBuild.ok(buildOf(r), end, 0)),
	loop_build_err: round.map((r) => runBuild.err(buildOf(r), UNKNOWN, 0)),
	loop_review_ok: fc
		.tuple(round, fc.constantFrom(...REVIEWS))
		.map(([r, end]) => runReview.ok(reviewOf(r), end, 0)),
	loop_review_err: round.map((r) => runReview.err(reviewOf(r), UNKNOWN, 0)),
	loop_post_ok: round.map((r) => postVerdicts.ok(postOf(r), "posted", 0)),
	loop_post_err: round.map((r) => postVerdicts.err(postOf(r), UNKNOWN, 0)),
	loop_ship_ok: fc
		.tuple(round, fc.constantFrom(...SHIPS))
		.map(([r, end]) => runShip.ok(shipOf(r), end, 0)),
	loop_ship_err: round.map((r) => runShip.err(shipOf(r), UNKNOWN, 0)),
};
/** Weighted to the answers that move a loop on, so every phase is reached. */
const WEIGHTS = {
	loop_claim_ok: 4,
	loop_build_ok: 8,
	loop_review_ok: 8,
	loop_post_ok: 6,
	loop_ship_ok: 4,
	loop_release_ok: 2,
};
/** A loop begins as its parent begins it, with `start`; the rest comes in any order. */
const lists = fc
	.tuple(table.start, fc.array(arbMsg(table, {weights: WEIGHTS}), {maxLength: 40, size: "max"}))
	.map(([start, rest]) => [start, ...rest]);

/**
 * Every state `machine` reaches from its init, saved through the kind's schema and loaded back.
 * `saved`: the phase of each state saved, so a test can say the law held on every shape of state.
 */
const keepsEvery = (machine: Machine, runs = 150, saved = new Set<string>()) =>
	fc.assert(
		fc.asyncProperty(lists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("loop:r1", null));
			const store = handle.store("loop", T, Loop);
			for (const s of foldEvents(machine, ctx, null, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
				saved.add(s.phase);
			}
		}),
		{numRuns: runs, seed: 1},
	);

/** Every phase the schema has. */
const PHASES = [
	"idle",
	"claiming",
	"building",
	"reviewing",
	"posting",
	"shipping",
	"releasing",
	"over",
];

describe("the operate loop is kept", () => {
	it("every state it reaches from its init saves and loads back equal, in every phase", async () => {
		const saved = new Set<string>();
		await keepsEvery(loop, 150, saved);
		expect([...saved].sort()).toEqual([...PHASES].sort());
	});

	it("the law is seen to fail on a planted mistake: a loop that keeps the review's whole Msg dies at its next save", async () => {
		const keepsTheMsg: Machine = {
			...loop,
			update: {
				...loop.update,
				loop_review_ok: (s, m) => {
					const [next, cmds] = loop.update.loop_review_ok(s, m);
					return [{...next, ...m} as Loop, cmds];
				},
			},
		};
		await expect(keepsEvery(keepsTheMsg, 40)).rejects.toThrow(/Counterexample/);
	});
});
