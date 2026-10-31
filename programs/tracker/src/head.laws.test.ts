import {type Entry, type Fact, fold} from "@kampus/pipeline/tickets/ticket";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Head, HOUR, headOf, openAsksOf} from "./head.ts";

// The laws of a ticket's top line, over random lists of facts. The facts go through the real fold
// first, so a fact that does not fit (an answer to an ask never asked, an agent's answer, a run
// ended twice) is kept out as it is on a real ticket, and the line is read off what is left.

// ---------------------------------------------------------------- generators

const owner = {kind: "user", id: "owner"} as const;
const build = {kind: "agent", id: "build", for: "owner"} as const;
const writer = fc.constantFrom(owner, build);

const ask = fc.constantFrom("a-1", "a-2", "a-3");
const run = fc.constantFrom("r-1", "r-2", "r-3");
const stage = fc.constantFrom("triage", "plan", "build", "review");
const PICKS = ["approve", "no"] as const;
const SHA = "a1b2c3d";

const outcome: fc.Arbitrary<Extract<Fact, {type: "ended"}>["outcome"]> = fc.oneof(
	fc.record({kind: fc.constant("done" as const), part: fc.boolean()}),
	fc.record({kind: fc.constant("send" as const), to: stage, why: fc.constant("built")}),
	fc.record({
		kind: fc.constant("ask" as const),
		who: fc.constant("owner"),
		for: fc.constant("approval"),
	}),
	fc.record({kind: fc.constant("skip" as const), why: fc.constant("closed")}),
	fc.record({kind: fc.constant("stuck" as const), why: fc.constant("read_failed")}),
);

/** Any fact but `filed`, which every timeline starts with. Lane facts weigh more, so lanes happen. */
const fact: fc.Arbitrary<Fact> = fc.oneof(
	fc.constant<Fact>({type: "commented", body: "Seen it."}),
	fc.constant<Fact>({type: "closed"}),
	fc.constant<Fact>({type: "reopened"}),
	{
		arbitrary: fc
			.tuple(run, stage, fc.option(fc.constant("t-1"), {nil: null}))
			.map(([r, s, task]): Fact => ({type: "started", run: r, stage: s, task, log: null})),
		weight: 3,
	},
	{
		arbitrary: fc.tuple(run, stage, outcome).map(([r, s, o]): Fact => ({
			type: "ended",
			run: r,
			stage: s,
			outcome: o,
			usd: 0.1,
			input: 10,
			output: 5,
			turns: 3,
		})),
		weight: 3,
	},
	{
		arbitrary: ask.map((a): Fact => ({
			type: "asked",
			ask: a,
			what: `approve ${a}`,
			picks: [...PICKS],
		})),
		weight: 3,
	},
	{
		arbitrary: fc
			.tuple(ask, fc.constantFrom("approve", "no", "maybe"))
			.map(([a, pick]): Fact => ({type: "answered", ask: a, pick, note: ""})),
		weight: 3,
	},
	{
		arbitrary: fc.constantFrom("draft", "open", "merged", "closed").map((state): Fact => ({
			type: "pr",
			url: "https://github.com/o/r/pull/12",
			state: state as "draft" | "open" | "merged" | "closed",
			head: SHA,
			checks: [],
		})),
		weight: 2,
	},
	fc.constant<Fact>({type: "rated", finding: "f-1", says: "noise"}),
);

/** A ticket's timeline: `filed`, then what the fold keeps of the facts after it. */
const timeline: fc.Arbitrary<readonly Entry[]> = fc
	.array(fc.tuple(writer, fact, fc.nat({max: 3 * HOUR})), {maxLength: 25})
	.map((rows) => {
		let at = 1_000;
		const entries: Entry[] = [
			{pos: 1, ticket: 1, by: owner, at, fact: {type: "filed", title: "Login fails", body: ""}},
		];
		rows.forEach(([by, f, gap], i) => {
			at += gap;
			entries.push({pos: i + 2, ticket: 1, by, at, fact: f});
		});
		return fold([], entries).tickets[0]?.timeline ?? [];
	});

const lastAt = (t: readonly Entry[]) => t.at(-1)?.at ?? 0;
/** A time some way after the last fact: before or after the hour. */
const nowOf = (t: readonly Entry[], gap: number) => lastAt(t) + gap;
const gap = fc.nat({max: 3 * HOUR});

const OPTS = {numRuns: 2000, seed: 6};

// ---------------------------------------------------------------- what is wanted, said again

const since = (t: readonly Entry[]) =>
	t.slice(t.findLastIndex((e) => e.fact.type === "reopened") + 1);
const mergedSince = (t: readonly Entry[]) =>
	since(t).some((e) => e.fact.type === "pr" && e.fact.state === "merged");
const closedNow = (t: readonly Entry[]) => since(t).some((e) => e.fact.type === "closed");
const append = (t: readonly Entry[], by: Entry["by"], f: Fact): readonly Entry[] => [
	...t,
	{pos: (t.at(-1)?.pos ?? 0) + 1, ticket: 1, by, at: lastAt(t), fact: f},
];

/** Deep equal, or throw with the difference, so a failed law says what it saw. */
const same = (a: unknown, b: unknown) => {
	expect(a).toEqual(b);
	return true;
};

const holds = (law: (t: readonly Entry[], now: number) => boolean) => () =>
	fc.assert(
		fc.property(timeline, gap, (t, g) => law(t, nowOf(t, g))),
		OPTS,
	);

// ---------------------------------------------------------------- the laws

describe("a ticket's top line", () => {
	it("is drawn as each of its seven lines by these lists, so no law above holds for want of a case", () => {
		const seen = new Set<string>();
		fc.assert(
			fc.property(timeline, gap, (t, g) => {
				seen.add(headOf(t, nowOf(t, g))._tag);
				return true;
			}),
			OPTS,
		);
		expect([...seen].sort()).toEqual(
			["asks", "closed", "done", "idle", "next", "running", "stuck"].sort(),
		);
	});

	it(
		"is done when, and only when, its pull request merged after the last reopen, or a person closed it once every ask was answered",
		holds((t, now) => {
			const head = headOf(t, now);
			const byMerge = mergedSince(t);
			const close = since(t).findLast((e) => e.fact.type === "closed");
			const answered = t.some((e) => e.fact.type === "answered");
			const byClose =
				close !== undefined && close.by.kind === "user" && answered && openAsksOf(t).length === 0;
			expect(head._tag === "done").toBe(byMerge || byClose);
			if (byMerge) expect(head).toEqual({_tag: "done", pr: "https://github.com/o/r/pull/12"});
			return true;
		}),
	);

	it(
		"is never done from what an agent writes alone: no merge, no person's close, no done",
		holds((t, now) => {
			const agentOnly = t.filter(
				(e) =>
					!(e.fact.type === "pr" && e.fact.state === "merged") &&
					!(e.fact.type === "closed" && e.by.kind === "user"),
			);
			return headOf(agentOnly, now)._tag !== "done";
		}),
	);

	it(
		"says an open ask whenever one is open and the ticket is not finished: an open ask always wins",
		holds((t, now) => {
			const open = openAsksOf(t);
			const finished = mergedSince(t) || closedNow(t);
			const head = headOf(t, now);
			if (finished || open.length === 0) return head._tag !== "asks";
			return head._tag === "asks" && same(head.asks, open);
		}),
	);

	it("keeps an open ask open through a comment, from a person or an agent: a comment is never an answer", () =>
		fc.assert(
			fc.property(timeline, gap, writer, (t, g, by) => {
				const commented = append(t, by, {type: "commented", body: "approve"});
				expect(openAsksOf(commented)).toEqual(openAsksOf(t));
				const before = headOf(t, nowOf(t, g));
				const after = headOf(commented, nowOf(t, g));
				return before._tag !== "asks" || after._tag === "asks";
			}),
			OPTS,
		));

	it("is never done or closed again just after a reopen", () =>
		fc.assert(
			fc.property(timeline, gap, (t, g) => {
				const head = headOf(append(t, owner, {type: "reopened"}), nowOf(t, g));
				return head._tag !== "done" && head._tag !== "closed";
			}),
			OPTS,
		));

	it(
		"says a run is going over idle, however long it runs: a running agent wins over the clock",
		holds((t) => {
			const head = headOf(t, lastAt(t) + 10 * HOUR);
			const ended = new Set(t.flatMap((e) => (e.fact.type === "ended" ? [e.fact.run] : [])));
			const going = t.some((e) => e.fact.type === "started" && !ended.has(e.fact.run));
			const before: readonly Head["_tag"][] = ["done", "closed", "asks"];
			if (before.includes(head._tag)) return true;
			return (head._tag === "running") === going;
		}),
	);

	it("changes with the clock only from next to idle, once the hour is gone", () =>
		fc.assert(
			fc.property(timeline, gap, gap, (t, g, more) => {
				const early = headOf(t, nowOf(t, g));
				const late = headOf(t, nowOf(t, g + more));
				if (early._tag === late._tag) return same(late, early);
				return early._tag === "next" && late._tag === "idle" && g + more > HOUR;
			}),
			OPTS,
		));

	it("is idle only past the hour, and never while a run is going or an ask is open", () =>
		fc.assert(
			fc.property(timeline, gap, (t, g) => {
				const head = headOf(t, nowOf(t, g));
				if (head._tag !== "idle") return true;
				return g > HOUR && openAsksOf(t).length === 0;
			}),
			OPTS,
		));
});
