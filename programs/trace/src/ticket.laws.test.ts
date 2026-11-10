import type {Writer} from "@kampus/fabrika-old";
import type {Entry, Fact} from "@kampus/pipeline/tickets/ticket";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Lane, type LaneRow, lanesOf, type Price, stopsOf, summaryOf} from "./ticket.ts";
import {STOPS, type Story, stories, type TrueLane} from "./timelines.ts";

// The ticket view's fold, as laws (ticket 141, plan section 4, L1 to L6). Today's version. Each
// story is made with its truth beside it (./timelines.ts): which lane each run and ask is in, each
// lane's ends, each step's price. A law checks `lanesOf` against that truth, never against a second
// fold. The stories carry noise (`commented`, `planned`, `session`, `pushed`, a `filed` days before
// the first run), which no law lets move a lane.
//
// What the plan leaves open, and these laws take as given:
//   - "the lane running at its time", for an ask with no `trace`: the newest lane begun by then
//   - an older lane is never open: the stories never leave one with a step not ended or an ask not
//     answered, so the laws say nothing of one. ./ticket.running.test.ts says what one does
//     (review A1)

const OPTS = {numRuns: 300, seed: 141};

/** The whole story, live: up to every fact, now as the story says. */
const live = (story: Story): readonly Lane[] => lanesOf(story.timeline, story.now, Infinity);

const stepsIn = (lane: Lane) => lane.rows.flatMap((r) => (r.kind === "step" ? [r] : []));
const waitsIn = (lane: Lane) => lane.rows.flatMap((r) => (r.kind === "wait" ? [r] : []));

/** A price with its dollars to nine places, so two sums in another order compare equal. */
const rounded = (p: Price | undefined): Price | undefined =>
	p?.kind === "usd" ? {kind: "usd", usd: Math.round(p.usd * 1e9) / 1e9} : p;

/** A lane's end, as the truth says it: its last ended or answered, or now while it is open. */
const endOf = (lane: TrueLane, now: number): number => lane.to ?? now;

describe("the ticket's lanes (L1 to L6)", () => {
	it("L1: every started run is in exactly one step row of exactly one lane, none lost, none twice", () => {
		fc.assert(
			fc.property(stories, (story) => {
				const lanes = live(story);
				const runs = lanes.flatMap((l) => stepsIn(l).map((r) => r.run));
				const started = story.timeline.flatMap((e) =>
					e.fact.type === "started" ? [e.fact.run] : [],
				);
				expect(runs.toSorted()).toEqual(started.toSorted());
				expect(new Set(runs).size).toBe(runs.length);
				// And in the lane of its own trace.
				lanes.forEach((lane, i) => {
					expect(stepsIn(lane).map((r) => r.run)).toEqual(story.lanes[i]?.steps.map((s) => s.run));
				});
			}),
			OPTS,
		);
	});

	it("L1: a step row says what its started and ended say", () => {
		fc.assert(
			fc.property(stories, (story) => {
				const lanes = live(story);
				story.lanes.forEach((truth, i) => {
					const rows = lanes[i] === undefined ? [] : stepsIn(lanes[i]);
					truth.steps.forEach((step, j) => {
						const row = rows[j];
						const ended = story.timeline.find(
							(e) => e.fact.type === "ended" && e.fact.run === step.run,
						)?.fact;
						expect(row).toMatchObject({
							kind: "step",
							run: step.run,
							stage: step.stage,
							from: step.from,
							// A step not ended runs to now.
							to: step.to ?? story.now,
							ended: ended ?? null,
							model: step.model,
							harness: step.harness,
						});
					});
				});
			}),
			OPTS,
		);
	});

	it("L2: lanes are the distinct started traces, in order of first start, oldest first", () => {
		fc.assert(
			fc.property(stories, (story) => {
				expect(live(story).map((l) => l.trace)).toEqual(story.lanes.map((l) => l.trace));
			}),
			OPTS,
		);
	});

	it("L2: a restarted before a new trace is that lane's restart, and only there", () => {
		fc.assert(
			fc.property(stories, (story) => {
				expect(live(story).map((l) => l.restart)).toEqual(story.lanes.map((l) => l.restart));
			}),
			OPTS,
		);
	});

	it("L3: a lane's axis is inside its own facts: its restart or first start, to its last ended or answered, or now", () => {
		fc.assert(
			fc.property(stories, (story) => {
				const lanes = live(story);
				expect(lanes.map((l) => [l.from, l.to, l.open])).toEqual(
					story.lanes.map((l) => [l.from, endOf(l, story.now), l.to === null]),
				);
			}),
			OPTS,
		);
	});

	it("L3: a filed or a commented fact never moves a lane, wherever it falls (the 19 h sliver)", () => {
		const extra = fc.array(
			fc.record({
				where: fc.double({min: 0, max: 1, noNaN: true}),
				kind: fc.constantFrom("filed", "commented"),
			}),
			{minLength: 1, maxLength: 4},
		);
		fc.assert(
			fc.property(stories, extra, (story, adds) => {
				const first = story.timeline[0]?.at ?? 0;
				let timeline = story.timeline;

				for (const add of adds) {
					// Days before the first fact, or anywhere up to now.
					const at = Math.floor(
						first - 3 * 86_400_000 + add.where * (story.now - first + 3 * 86_400_000),
					);
					timeline = noted(timeline, at, add.kind);
				}

				expect(lanesOf(timeline, story.now, Infinity)).toEqual(live(story));
			}),
			OPTS,
		);
	});

	it("L4: every asked has one wait row, in the lane its trace names, else the lane running at its time", () => {
		fc.assert(
			fc.property(stories, (story) => {
				const lanes = live(story);
				const asked = story.timeline.flatMap((e) => (e.fact.type === "asked" ? [e.fact.ask] : []));
				const rows = lanes.flatMap((l) => waitsIn(l).map((r) => r.ask));
				expect(rows.toSorted()).toEqual(asked.toSorted());
				lanes.forEach((lane, i) => {
					const want = story.lanes[i]?.asks.map((a) => a.ask) ?? [];
					expect(
						waitsIn(lane)
							.map((r) => r.ask)
							.toSorted(),
					).toEqual(want.toSorted());
				});
			}),
			OPTS,
		);
	});

	it("L4: a wait row is open iff no answered names its ask, and says the pick and who picked", () => {
		fc.assert(
			fc.property(stories, (story) => {
				const rows = new Map(
					live(story).flatMap((l) => waitsIn(l).map((r): [string, LaneRow] => [r.ask, r])),
				);

				for (const ask of story.lanes.flatMap((l) => l.asks)) {
					expect(rows.get(ask.ask)).toEqual({
						kind: "wait",
						ask: ask.ask,
						what: ask.what,
						from: ask.at,
						to: ask.answer?.at ?? story.now,
						pick: ask.answer?.pick ?? null,
						by: ask.answer?.by ?? null,
					});
				}
			}),
			OPTS,
		);
	});

	it("L5: replay is truncation: up to t is the facts up to t, at t (Elm's debugger, as a law)", () => {
		fc.assert(
			fc.property(
				stories.chain((story) => {
					const first = story.timeline[0]?.at ?? 0;
					const stops = story.timeline.flatMap((e) => [e.at - 1, e.at]);
					return fc.tuple(
						fc.constant(story),
						fc.oneof(
							fc.constantFrom(...stops, story.now),
							fc.integer({min: first - 1, max: story.now}),
						),
					);
				}),
				([story, t]) => {
					expect(lanesOf(story.timeline, story.now, t)).toEqual(
						lanesOf(
							story.timeline.filter((e) => e.at <= t),
							t,
							t,
						),
					);
				},
			),
			OPTS,
		);
	});

	it("L6: a step's price: usd from listUsd or claude's billed, unknown with a model and neither, none for code", () => {
		fc.assert(
			fc.property(stories, (story) => {
				const rows = new Map(
					live(story).flatMap((l) => stepsIn(l).map((r): [string, Price] => [r.run, r.price])),
				);
				// A step not ended with a model has no price yet: the next law says what it is not.
				const priced = story.lanes.flatMap((l) => l.steps).filter((s) => s.price !== null);

				for (const step of priced) {
					expect(rounded(rows.get(step.run))).toEqual(rounded(step.price ?? undefined));
				}
			}),
			OPTS,
		);
	});

	it("L6: a step with a model that has not ended has no price yet: never unknown, usd or none (review B2)", () => {
		let seen = 0;
		fc.assert(
			fc.property(stories, (story) => {
				const rows = new Map(
					live(story).flatMap((l) => stepsIn(l).map((r): [string, Price] => [r.run, r.price])),
				);
				const running = story.lanes.flatMap((l) => l.steps).filter((s) => s.price === null);
				seen += running.length;

				for (const step of running) {
					expect(["usd", "unknown", "none"], step.run).not.toContain(rows.get(step.run)?.kind);
				}
			}),
			OPTS,
		);
		expect(seen).toBeGreaterThan(0);
	});

	it("L6: the summary sums usd rows only, null when none, and counts the unknown rows; per lane and for the ticket", () => {
		fc.assert(
			fc.property(stories, (story) => {
				const lanes = live(story);
				const want = (truths: readonly TrueLane[]) => {
					const prices = truths.flatMap((l) => l.steps.map((s) => s.price));
					const usd = prices.flatMap((p) => (p?.kind === "usd" ? [p.usd] : []));
					const asks = truths.flatMap((l) => l.asks);
					return {
						lanes: truths.length,
						steps: prices.length,
						waits: asks.length,
						waited: asks.reduce((sum, a) => sum + ((a.answer?.at ?? story.now) - a.at), 0),
						usd: usd.length === 0 ? null : usd.reduce((sum, u) => sum + u, 0),
						// A step not ended yet is not counted as "no list price" (review B2).
						unknown: prices.filter((p) => p?.kind === "unknown").length,
					};
				};
				const check = (got: ReturnType<typeof summaryOf>, truths: readonly TrueLane[]) => {
					const w = want(truths);
					expect({...got, usd: null}).toEqual({...w, usd: null});

					if (w.usd === null) {
						expect(got.usd).toBeNull();
					} else {
						expect(got.usd).toBeCloseTo(w.usd, 9);
					}
				};
				check(summaryOf(lanes), story.lanes);
				lanes.forEach((lane, i) => {
					const truth = story.lanes[i];

					if (truth !== undefined) {
						check(summaryOf([lane]), [truth]);
					}
				});
			}),
			OPTS,
		);
	});
});

describe("the replay's stops", () => {
	it("are each started, ended, asked, answered and restarted, in order, and no other fact", () => {
		fc.assert(
			fc.property(stories, (story) => {
				expect(stopsOf(story.timeline)).toEqual(
					story.timeline.filter((e) => STOPS.has(e.fact.type)).map((e) => e.at),
				);
			}),
			OPTS,
		);
	});
});

/** The timeline with one more fact of `kind` at `at`, in time order, its places counted again. */
const noted = (timeline: readonly Entry[], at: number, kind: "filed" | "commented"): Entry[] => {
	const by: Writer = {kind: "user", id: "owner"};
	const fact: Fact =
		kind === "filed"
			? {type: "filed", title: "Filed again, by mistake", body: ""}
			: {type: "commented", body: "A comment far from any run."};
	const place = timeline.findIndex((e) => e.at > at);
	const before = place === -1 ? timeline : timeline.slice(0, place);
	const after = place === -1 ? [] : timeline.slice(place);
	return [...before, {pos: 0, ticket: timeline[0]?.ticket ?? 1, by, at, fact}, ...after].map(
		(e, i) => ({
			...e,
			pos: i + 1,
		}),
	);
};
