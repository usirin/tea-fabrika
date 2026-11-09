import {readFileSync} from "node:fs";
import {Effect, Schema} from "effect";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	Answer,
	Asked,
	Rec,
	answerOf,
	blindDraw,
	questionLine,
	sealAsk,
	type Asked as Sealed,
} from "./ask.ts";
import {Fact} from "./ticket.ts";
const {DRAFT, NONE, NOW, REC, TOOK} = JSON.parse(
	readFileSync(new URL("../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);
const policyFor = (
	ask: string,
	hidden: boolean,
	choose: (ask: string, seed: number, policy: number) => {hidden: boolean},
) => {
	for (let seed = 119120; seed < 120120; seed++)
		if (choose(ask, seed, 1).hidden === hidden) return {seed};
	throw new Error("the blind policy produces no matching case in 1000 seeds");
};

// These call signatures specify the new public contract; they implement no product behavior.
const seal: (draft: unknown, policy?: {seed: number}) => Effect.Effect<Sealed, unknown> = sealAsk;
const resolve: (asked: Sealed, answer: unknown) => {pick: string; note: string} | null = answerOf;
const draw: (ask: string, seed: number, policy: number) => {policy: number; hidden: boolean} =
	blindDraw;
const sealed = () => Effect.runPromise(seal(DRAFT, policyFor(DRAFT.ask, false, draw)));

describe("ask desk P1: a sealed ask is complete", () => {
	it("keeps every recorded field and builds display rec from the sole sealed rec", async () => {
		const ask = await sealed();
		expect(ask).toMatchObject({
			type: "asked",
			format: 1,
			ask: DRAFT.ask,
			for: "approve",
			step: "plan",
			repo: DRAFT.repo,
			why: null,
			rec: REC,
			until: null,
		});
		expect(ask.shows).toEqual({
			what: DRAFT.what,
			picks: DRAFT.picks,
			ticket: DRAFT.ticket,
			evidence: DRAFT.evidence,
			rec: REC,
		});
		expect(ask.saw).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(Schema.is(Asked)(ask)).toBe(true);
		expect(Schema.decodeUnknownSync(Fact)(ask)).toEqual(ask);
	});
	it.each([
		["unoffered rec", {...DRAFT, rec: {...REC, pick: "merge"}}],
		["long question", {...DRAFT, what: "x".repeat(121)}],
		["blank question", {...DRAFT, what: "   "}],
		["multiline question", {...DRAFT, what: "Approve?\nReally?"}],
		["missing effects", {...DRAFT, picks: [{pick: "approve"}, {pick: "no"}]}],
		["no picks", {...DRAFT, picks: []}],
		["no full plan", {...DRAFT, evidence: {_tag: "plan", version: 2}}],
		["missing repo", {...DRAFT, repo: undefined}],
		["missing reason", {...DRAFT, why: undefined}],
	])("refuses %s", async (_name, draft) => {
		expect(await Effect.runPromise(Effect.exit(seal(draft)))).toMatchObject({_tag: "Failure"});
	});
	it.each([-1, 101, Number.NaN, Infinity])("refuses confidence %s", (sure) => {
		expect(Schema.is(Rec)({...REC, sure})).toBe(false);
	});
	it("keeps unknown confidence and an absent recommendation honest", async () => {
		expect(Schema.is(Rec)({...REC, sure: null})).toBe(true);
		const ask = await Effect.runPromise(seal({...DRAFT, rec: NONE}));
		expect(ask.shows.rec).toEqual(NONE);
	});
});

describe("ask desk P7: what an answer means", () => {
	it("rec resolves to this ask's recommendation, including when it recommends stop", async () => {
		const ask = await sealed();
		expect(resolve(ask, {_tag: "rec"})).toEqual({pick: "approve", note: ""});
		const stopped = await Effect.runPromise(
			seal({...DRAFT, rec: {...REC, pick: "no"}}, policyFor(DRAFT.ask, false, draw)),
		);
		expect(resolve(stopped, {_tag: "rec"})).toEqual({pick: "no", note: ""});
		expect(resolve(stopped, {_tag: "against", pick: "approve", note: "Keep going"})).toEqual({
			pick: "approve",
			note: "Keep going",
		});
	});
	it.each(["", " ", "\t", "\n", "x".repeat(121)])("against rejects note %j", (note) => {
		expect(Schema.is(Answer)({_tag: "against", pick: "no", note})).toBe(false);
	});
	it.each([undefined, "Keep the empty input test."])(
		"chose keeps an optional note exactly, note=%j",
		(note) => {
			const answer = {_tag: "chose", pick: "no", ...(note === undefined ? {} : {note})};
			expect(Schema.is(Answer)(answer)).toBe(true);
			expect(Schema.decodeUnknownSync(Answer)(JSON.parse(JSON.stringify(answer)))).toStrictEqual(
				answer,
			);
		},
	);
	it.each(["", " ", "\t", "\n", "x".repeat(121)])("chose rejects note %j", (note) => {
		expect(Schema.is(Answer)({_tag: "chose", pick: "no", note})).toBe(false);
	});
	it.each([false, true])("resolves a chose note with hidden=%s", async (hidden) => {
		const ask = await Effect.runPromise(
			seal(
				hidden ? {...DRAFT, for: "step", rec: REC} : {...DRAFT, rec: NONE},
				policyFor(DRAFT.ask, hidden, draw),
			),
		);
		expect(resolve(ask, {_tag: "chose", pick: "no", note: "Keep the empty input test."})).toEqual({
			pick: "no",
			note: "Keep the empty input test.",
		});
		expect(resolve(ask, {_tag: "chose", pick: "no"})).toEqual({pick: "no", note: ""});
	});
	it("refuses foreign picks, rec without a visible rec, and chose when the rec was shown", async () => {
		const ask = await sealed();
		expect(resolve(ask, {_tag: "against", pick: "merge", note: "No"})).toBeNull();
		expect(resolve(ask, {_tag: "chose", pick: "approve"})).toBeNull();
		const absent = await Effect.runPromise(seal({...DRAFT, rec: NONE}));
		expect(resolve(absent, {_tag: "rec"})).toBeNull();
	});
});

describe("ask desk P8/P9: blind asks", () => {
	it("an ask with no rec records no hidden recommendation, even when its draw is blind", async () => {
		const ask = await Effect.runPromise(
			seal({...DRAFT, for: "step", rec: NONE}, policyFor(DRAFT.ask, true, draw)),
		);
		expect(ask.blind.hidden).toBe(false);
		expect(ask.shows.rec).toEqual(NONE);
	});
	it("never hands a hidden rec to the display and keeps a blind answer chose after reveal", async () => {
		// A step's ask: an approve ask is never drawn blind (review 2, medium 2, below).
		const ask = await Effect.runPromise(
			seal({...DRAFT, for: "step"}, policyFor(DRAFT.ask, true, draw)),
		);
		expect(ask.rec).toEqual(REC);
		expect(ask.shows.rec).toEqual({_tag: "hidden"});
		expect(JSON.stringify(ask.shows)).not.toContain(REC.why);
		expect(resolve(ask, {_tag: "rec"})).toBeNull();
		const fact = {
			type: "answered",
			format: 1,
			ask: ask.ask,
			answer: {_tag: "chose", pick: "no"},
			saw: ask.saw,
			via: {_tag: "window", took: {...TOOK, rec: "hidden"}},
		};
		expect(resolve(ask, fact.answer)).toEqual({pick: "no", note: ""});
		expect(Schema.decodeUnknownSync(Fact)(JSON.parse(JSON.stringify(fact)))).toEqual(fact);
	});
	it("uses a stable seeded one-in-five draw, with its policy recorded across restarts", async () => {
		fc.assert(
			fc.property(fc.string({minLength: 1, maxLength: 60}), (id) => {
				expect(draw(id, 119120, 1)).toEqual(draw(JSON.parse(JSON.stringify(id)), 119120, 1));
			}),
			{seed: 119120, numRuns: 100},
		);
		const draws = Array.from({length: 1000}, (_, i) => draw(`ask-${i}`, 119120, 1));
		expect(draws.every((d) => d.policy === 1)).toBe(true);
		// Decided p=1/5. Our binomial calculation: mean 200, sd sqrt(1000*.2*.8)=12.65.
		// This fixed sample allows about four standard deviations and catches biased draws.
		expect(draws.filter((d) => d.hidden).length).toBeGreaterThan(150);
		expect(draws.filter((d) => d.hidden).length).toBeLessThan(250);
		const first = await Effect.runPromise(seal(DRAFT, {seed: 119120}));
		const restarted = await Effect.runPromise(
			seal(JSON.parse(JSON.stringify(DRAFT)), {seed: 119120}),
		);
		expect(restarted).toEqual(first);
		expect(first.blind).toEqual(draw(DRAFT.ask, 119120, 1));
	});
});

describe("ask desk review 2, medium 2: a rec that can only be one pick is never blind", () => {
	// The lane's approve rec comes only from the plan's leans, and it can only ever be approve
	// (recOfLeans): hiding it would hide nothing. The lead's decision: such a kind is never drawn
	// blind, and the sealed fact says it was not.
	it("an approve ask whose draw would hide its rec shows the rec, and records blind as not hidden", async () => {
		const ask = await Effect.runPromise(seal(DRAFT, policyFor(DRAFT.ask, true, draw)));
		expect(ask.for).toBe("approve");
		expect(ask.blind.hidden).toBe(false);
		expect(ask.shows.rec).toEqual(REC);
		expect(resolve(ask, {_tag: "rec"})).toEqual({pick: "approve", note: ""});
	});
	it("an approve ask is not blind for any seed", async () => {
		for (let seed = 119120; seed < 119140; seed++) {
			const ask = await Effect.runPromise(seal(DRAFT, {seed}));
			expect(ask.blind.hidden).toBe(false);
			expect(ask.shows.rec).toEqual(REC);
		}
	});
	it("another kind with the same draw stays blind", async () => {
		const ask = await Effect.runPromise(
			seal({...DRAFT, for: "step"}, policyFor(DRAFT.ask, true, draw)),
		);
		expect(ask.blind.hidden).toBe(true);
		expect(ask.shows.rec).toEqual({_tag: "hidden"});
	});
});

describe("ask desk P17: needed is optional data", () => {
	it.each([undefined, true, false])(
		"round-trips needed=%s without collapsing states",
		async (needed) => {
			const ask = await sealed();
			const fact = {
				type: "answered",
				format: 1,
				ask: ask.ask,
				answer: {_tag: "rec"},
				saw: ask.saw,
				via: {_tag: "window", took: TOOK},
				...(needed === undefined ? {} : {needed}),
			};
			const read = Schema.decodeUnknownSync(Fact)(JSON.parse(JSON.stringify(fact)));
			expect(read).toStrictEqual(fact);
			expect(Object.hasOwn(read, "needed")).toBe(needed !== undefined);
		},
	);
	it("accepts chat without made-up timing, but requires timing for a window answer", async () => {
		const ask = await sealed();
		const fact = {type: "answered", format: 1, ask: ask.ask, answer: {_tag: "rec"}, saw: ask.saw};
		expect(Schema.is(Fact)({...fact, via: {_tag: "chat", session: "session-1"}})).toBe(true);
		expect(Schema.is(Fact)({...fact, via: {_tag: "window"}})).toBe(false);
		expect(Schema.is(Fact)({...fact, via: {_tag: "window", took: {...TOOK, ms: -1}}})).toBe(false);
		expect(NOW).toBe(TOOK.said);
	});
});

describe("ask desk P1: an ask id is one word, whole", () => {
	it.each([
		["a space inside", "a b"],
		["a space at the end", "a-1 "],
		["129 characters", "x".repeat(129)],
	])("refuses an id with %s", async (_name, id) => {
		const ask = await sealed();
		expect(Schema.is(Asked)({...ask, ask: id})).toBe(false);
		expect(Schema.is(Asked)({...ask, replaces: id})).toBe(false);
	});
	it("keeps an id of 128 characters", async () => {
		const ask = await sealed();
		expect(Schema.is(Asked)({...ask, ask: "x".repeat(128)})).toBe(true);
	});
});

describe("ask desk P21: a replacement names the ask it replaces", () => {
	it("keeps replaces on the sealed fact, and leaves it out when the draft has none", async () => {
		const replacing = await Effect.runPromise(seal({...DRAFT, replaces: "a-approve-8"}));
		expect(replacing.replaces).toBe("a-approve-8");
		expect(Object.hasOwn(await sealed(), "replaces")).toBe(false);
	});
});

describe("ask desk P1: any question as one line", () => {
	it("joins every run of whitespace into one space", () => {
		expect(questionLine("a\n  b\tc")).toBe("a b c");
		expect(questionLine("  Approve?  ")).toBe("Approve?");
	});
	it("keeps a line of 120 characters, and cuts a longer one at a word with an ellipsis", () => {
		expect(questionLine("x".repeat(120))).toBe("x".repeat(120));
		const line = questionLine(`${"word ".repeat(30)}end`);
		expect(line.length).toBeLessThanOrEqual(120);
		expect(line.endsWith("word…")).toBe(true);
		expect(questionLine("x".repeat(130))).toBe(`${"x".repeat(119)}…`);
	});
});
