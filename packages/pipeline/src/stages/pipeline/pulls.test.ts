import {Effect, Layer, Option} from "effect";
import {describe, expect, it} from "vitest";
import {Tickets} from "../../tickets/tickets.ts";
import type {Given, Now} from "./carry.ts";
import {carriedOf, judgedAt, type Pull, yesOf} from "./pulls.ts";
import {LaneWork} from "./work.ts";

// Today's version. Two reads of the lane's pull requests that need no git: what a person's `merge`
// binds to, and how the verdicts posted on a pull stand at a head.

const PULL: Pull = {
	id: "local:7",
	kind: "lane",
	ticket: 7,
	branch: "lane/7",
	head: "A",
	tree: "t",
	state: "open",
	title: "t",
	body: "b",
	verdicts: [{kind: "review-code", verdict: "pass"}],
};

const person = {kind: "user"};
const lane = {kind: "code"};

describe("what a person's merge binds to", () => {
	const asked = (head?: string) => ({
		by: lane,
		fact: {type: "asked", ask: "a-merge-1", ...(head === undefined ? {} : {head})},
	});
	const merge = (head?: string) => ({
		by: person,
		fact: {
			type: "answered",
			ask: "a-merge-1",
			pick: "merge",
			...(head === undefined ? {} : {head}),
		},
	});

	it("an answer with no head, to an ask that kept one, binds to the ask's head", () => {
		expect(yesOf({timeline: [asked("H"), merge()]}, PULL)).toEqual({_tag: "asked", head: "H"});
	});

	it("an answer's own head comes before the ask's", () => {
		expect(yesOf({timeline: [asked("H"), merge("K")]}, PULL)).toEqual({_tag: "asked", head: "K"});
	});

	it("with no head on either, it is unbound: said before self-fix PR 10", () => {
		expect(yesOf({timeline: [asked(), merge()]}, PULL)).toEqual({_tag: "unbound"});
	});
});

// No git read may run here: every Gather and write dies when called.
const nothingRead = Layer.mergeAll(Layer.mock(LaneWork, {at: () => ""}), Layer.mock(Tickets, {}));
const judged = (pull: Pull, head: string) =>
	Effect.runSync(judgedAt(pull, head).pipe(Effect.provide(nothingRead)));

describe("how the posted verdicts stand at a head", () => {
	const posted: Given = {head: "A", onto: "main", base: "M", diff: "d"};

	it("verdicts judged at the head they were posted at stand there with no hop", () => {
		const at = judged({...PULL, posted}, "A");
		expect(at).toEqual(Option.some([]));
		// So the facts name no carry: never a hop from a head to itself.
		expect(carriedOf(at)).toEqual({});
	});

	it("a pull from before, with no `posted`, stands only at its own head", () => {
		expect(judged(PULL, "A")).toEqual(Option.some([]));
		expect(judged(PULL, "B")).toEqual(Option.none());
	});

	it("verdicts carried from the head they were posted at name that one hop", () => {
		const now: Now = {head: "B", tree: "T", replayed: "T", formatted: null, diff: "d", range: ""};
		const work = Layer.mock(LaneWork, {at: () => "", now: () => Effect.succeed(now)});
		const tickets = Layer.mock(Tickets, {write: () => Effect.void});
		const at = Effect.runSync(
			judgedAt({...PULL, posted}, "B").pipe(Effect.provide(Layer.mergeAll(work, tickets))),
		);
		expect(at).toEqual(Option.some([{from: "A", to: "B"}]));
		expect(carriedOf(at)).toEqual({carried: [{from: "A", to: "B"}]});
	});
});
