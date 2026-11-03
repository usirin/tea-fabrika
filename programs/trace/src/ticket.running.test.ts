import {foldEvents, stubCtxThrowingProxy} from "@demlik/tea/pbt";
import type {Writer} from "@kampus/fabrika-old";
import {listUsdOf} from "@kampus/pipeline/stages/price";
import type {Entry, Fact} from "@kampus/pipeline/tickets/ticket";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {type Model, type TraceMsg, trace} from "./machine.ts";
import {MIN, SEC, T0} from "./t117.ts";
import {type Lane, lanesOf, summaryOf} from "./ticket.ts";
import {type LaneShown, shownOf} from "./view.ts";
import {TraceWindow} from "./window.tsx";

// What the ticket view says of what has not ended yet (ticket 141, the one review's B2 and A1).
// Today's version. Small made-up tickets, each built for the one case it shows.
//
// B2: a step that is still running has no price yet. It is not "no list price": that says its
// model is not in the table, and gpt-6-astra is. So the ticket line, the lane and the step's
// detail never say it of a running astra step, and the summary never counts one as unknown.
//
// A1: a lane whose last step never ended, or whose ask was never answered (the app quit mid-step,
// or a restart while an ask was open), is over once a newer lane starts. The plan does not say
// this. The smallest rule that keeps the view sane, and the one these tests hold to:
//   - a lane with a newer lane after it is never open, so it is never "running" or "waiting on a
//     person", and the clock does not tick for it
//   - it does not grow with now: its end, its rows' ends and its waits are the same an hour later
//   - when nothing of it comes after the newer lane starts, it ends by that lane's start
//   - so the newer lane's restart gap is never negative
// Where in that span it ends (its own last fact, or the newer lane's start) is the builder's pick.

const ctx = stubCtxThrowingProxy<undefined>();
const HOUR = 60 * MIN;
const NUMBER = 117;
const LANE_A = "d4".repeat(16);
const LANE_B = "e5".repeat(16);
const ASTRA = "gpt-6-astra";

const laneWriter: Writer = {kind: "agent", id: "lane", for: "owner"};
const owner: Writer = {kind: "user", id: "owner"};

/** A ticket's facts, each at its time, in order, filed first. */
const ticketOf = (facts: readonly (readonly [number, Fact])[]): readonly Entry[] =>
	[[T0 - HOUR, {type: "filed", title: "A made-up ticket", body: ""}] as const, ...facts].map(
		([at, fact], i) => ({
			pos: i + 1,
			ticket: NUMBER,
			by: fact.type === "filed" || fact.type === "restarted" ? owner : laneWriter,
			at,
			fact,
		}),
	);

const started = (run: string, trace: string, model: string | null = ASTRA): Fact => ({
	type: "started",
	run,
	stage: "build",
	task: null,
	log: null,
	trace,
	...(model === null ? {} : {model, harness: "codex"}),
});

/** An astra step's end, with no list price written: the price comes back from its tokens. */
const ended = (run: string): Fact => ({
	type: "ended",
	run,
	stage: "build",
	outcome: {kind: "done", part: false},
	usd: 0,
	input: 1_000,
	output: 100,
	turns: 1,
	cached: 0,
	model: ASTRA,
	harness: "codex",
});

const asked = (ask: string, trace: string): Fact => ({
	type: "asked",
	ask,
	what: "Do you approve plan version 1?",
	picks: ["approve", "no"],
	trace,
});

const restarted: Fact = {type: "restarted", from: "plan", base: null, onto: "abcdef0"};

/** The state with this ticket's facts read, then these Msgs. */
const shown = (timeline: readonly Entry[], more: readonly TraceMsg[] = []): Model =>
	foldEvents(trace, ctx, null, [
		{type: "ticket", number: NUMBER},
		{type: "facts", number: NUMBER, timeline},
		...more,
	]).finalState;

/** The window's markup for a state, and its text with the tags taken out. */
const drawn = (s: Model): {readonly markup: string; readonly text: string} => {
	const markup = renderToStaticMarkup(
		createElement(TraceWindow, {view: shownOf(s), send: () => {}}),
	);
	return {markup, text: markup.replaceAll(/<[^>]*>/g, " ").replaceAll(/\s+/g, " ")};
};

const lanesOfShown = (s: Model): readonly LaneShown[] => shownOf(s).ticket?.lanes ?? [];

/** What each Sub entry of `type` asks for in `s`: its deps, each one that is on. */
const depsOf = (type: string, s: Model): readonly unknown[] =>
	(trace.subs ?? []).flatMap((sub): unknown[] => {
		if (sub.type !== type) return [];
		const deps: unknown = sub.deps(s);
		return deps === null || deps === undefined ? [] : [deps];
	});

/** One astra step's list price at the `ended` above's tokens. */
const ONE_STEP = listUsdOf(ASTRA, {input: 1_000, cached: 0, output: 100});

/** One lane: an astra step that ended, then a second still running. */
const runningAfterOne = ticketOf([
	[T0, started("r-a", LANE_A)],
	[T0 + MIN, ended("r-a")],
	[T0 + MIN + SEC, started("r-b", LANE_A)],
]);

/** One lane: an astra step still running, nothing ended yet. */
const runningAlone = ticketOf([[T0, started("r-a", LANE_A)]]);

describe("a step still running has no price yet, never no list price (review B2)", () => {
	it("an astra step still running: the fold neither prices it unknown nor counts it so", () => {
		expect(ONE_STEP).not.toBeNull();
		const lanes = lanesOf(runningAfterOne, T0 + 2 * MIN, Infinity);
		const running = lanes[0]?.rows.find((r) => r.kind === "step" && r.run === "r-b");
		expect(running?.kind === "step" && running.ended).toBeNull();
		expect(running?.kind === "step" && running.price.kind).not.toBe("unknown");
		const summary = summaryOf(lanes);
		expect(summary.unknown).toBe(0);
		expect(summary.usd).toBeCloseTo(ONE_STEP ?? Number.NaN, 9);
		expect(summaryOf(lanesOf(runningAlone, T0 + MIN, Infinity))).toMatchObject({
			usd: null,
			unknown: 0,
		});
	});

	it("the ticket line says the ended step's dollars at list price, and no step with no list price", () => {
		const {text} = drawn(shown(runningAfterOne, [{type: "tick", now: T0 + 2 * MIN}]));
		expect(text).toContain("at list price");
		expect(text).not.toContain("no list price");
	});

	it("when the only step is still running, neither the lane nor the ticket line says no list price", () => {
		const s = shown(runningAlone, [{type: "tick", now: T0 + MIN}]);
		expect(lanesOfShown(s)[0]?.summary.unknown).toBe(0);
		expect(drawn(s).text).not.toContain("no list price");
	});

	it("the running step's detail never says no list price for this model", () => {
		const s = shown(runningAfterOne, [
			{type: "tick", now: T0 + 2 * MIN},
			{type: "choose", row: "run:r-b"},
		]);
		const chosen = shownOf(s).chosen;
		expect(chosen?.kind).toBe("run");
		expect(chosen?.kind === "run" && chosen.priced).not.toBe("unknown");
		expect(drawn(s).text).not.toContain("no list price");
	});
});

/** Lane A's step never ended; two hours later lane B restarts from plan and runs a step. */
const leftRunning = ticketOf([
	[T0, started("r-a", LANE_A)],
	[T0 + 2 * HOUR, restarted],
	[T0 + 2 * HOUR + MIN, started("r-b", LANE_B)],
	[T0 + 2 * HOUR + 2 * MIN, ended("r-b")],
]);

/** Lane A asked and was never answered; three hours later lane B restarts and runs a step. */
const leftAsking = ticketOf([
	[T0, started("r-a", LANE_A)],
	[T0 + MIN, ended("r-a")],
	[T0 + MIN + SEC, asked("a-approve-1", LANE_A)],
	[T0 + 3 * HOUR, restarted],
	[T0 + 3 * HOUR + MIN, started("r-b", LANE_B)],
	[T0 + 3 * HOUR + 2 * MIN, ended("r-b")],
]);

const LATER = T0 + 5 * HOUR;
const MUCH_LATER = T0 + 29 * HOUR;

/** What a lane says that must not move with now: its end, and each row's end. */
const endsOf = (lane: Lane | undefined) => ({
	to: lane?.to,
	rows: lane?.rows.map((r) => r.to),
});

describe("a lane left without its end closes when a newer lane starts (review A1)", () => {
	for (const [name, timeline] of [
		["a step that never ended", leftRunning],
		["an ask never answered", leftAsking],
	] as const) {
		it(`with ${name}: the older lane is not open, and it ends by the newer lane's start`, () => {
			const [older, newer] = lanesOf(timeline, LATER, Infinity);
			expect(older?.open).toBe(false);
			expect(newer?.open).toBe(false);
			expect(older?.to).toBeLessThanOrEqual(newer?.from ?? Number.NaN);
			expect(older?.to).toBeGreaterThanOrEqual(older?.from ?? Number.NaN);
			for (const row of older?.rows ?? []) expect(row.to).toBeLessThanOrEqual(older?.to ?? 0);
		});

		it(`with ${name}: the older lane does not grow with now, nor its waits`, () => {
			const at = (now: number) => lanesOf(timeline, now, Infinity);
			expect(endsOf(at(MUCH_LATER)[0])).toEqual(endsOf(at(LATER)[0]));
			expect(summaryOf(at(MUCH_LATER).slice(0, 1)).waited).toBe(
				summaryOf(at(LATER).slice(0, 1)).waited,
			);
		});

		it(`with ${name}: the newer lane's restart gap is never negative, in the view or the window`, () => {
			const s = shown(timeline, [{type: "tick", now: LATER}]);
			const restart = lanesOfShown(s)[1]?.restart;
			expect(restart).not.toBeNull();
			expect(restart?.after).toBeGreaterThanOrEqual(0);
			const said = /<td colspan="3">([^<]*) later, restarted from plan<\/td>/i.exec(
				drawn(s).markup,
			)?.[1];
			expect(said).toBeDefined();
			expect(said).not.toMatch(/^-/);
		});

		it(`with ${name}: the older lane reads neither running nor waiting on a person`, () => {
			const older = lanesOfShown(shown(timeline, [{type: "tick", now: LATER}]))[0];
			expect(older?.live).toBe(false);
			expect(["running", "waiting"]).not.toContain(older?.state);
			expect(["running", "waiting on a person"]).not.toContain(older?.outcome);
		});

		it(`with ${name}: the ticket view's clock does not tick, since no lane is open`, () => {
			expect(depsOf("tick", shown(timeline))).toEqual([]);
			const ticked = shown(timeline, [{type: "tick", now: LATER}]);
			const again = shown(timeline, [
				{type: "tick", now: LATER},
				{type: "tick", now: MUCH_LATER},
			]);
			expect(lanesOfShown(again)[0]?.length).toBe(lanesOfShown(ticked)[0]?.length);
		});
	}
});
