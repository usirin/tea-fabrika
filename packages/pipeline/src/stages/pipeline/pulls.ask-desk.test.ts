import {readFileSync} from "node:fs";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {sealAsk} from "../../tickets/ask.ts";
import {type Pull, yesOf} from "./pulls.ts";

// Today's version. A person's merge binds only to the newest sealed merge ask, and only as `merge`.
const {DRAFT, HEAD, NONE, TOOK} = JSON.parse(
	readFileSync(new URL("../../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);
const PULL: Pull = {
	id: "local:117",
	kind: "lane",
	ticket: 117,
	branch: "lane/117",
	head: HEAD,
	tree: "t",
	state: "open",
	title: "t",
	body: "b",
	verdicts: [],
};
const evidence = {
	_tag: "change",
	head: HEAD,
	diff: "diff --git a/file b/file\n+one",
	checks: [],
	review: null,
	rules: [],
};
const merge = {
	...DRAFT,
	for: "merge",
	step: "merge",
	picks: [
		{pick: "merge", does: "Merge the pull request"},
		{pick: "no", does: "Keep the lane parked"},
	],
	rec: {...DRAFT.rec, pick: "merge"},
	evidence,
};
const LANE = {kind: "agent"};
const OWNER = {kind: "user"};
const said = (ask: {ask: string; saw: string}, answer: unknown) => ({
	by: OWNER,
	fact: {
		type: "answered",
		format: 1,
		ask: ask.ask,
		answer,
		saw: ask.saw,
		via: {_tag: "window", took: TOOK},
	},
});

describe("ask desk P22: the merge read takes the sealed answer", () => {
	it("binds a merge answer to the head the ask showed", async () => {
		const ask = await Effect.runPromise(sealAsk({...merge, ask: "a-merge-1"}));
		const timeline = [{by: LANE, fact: ask}, said(ask, {_tag: "rec"})];
		expect(yesOf({timeline}, PULL)).toEqual({_tag: "asked", head: HEAD});
	});
	it("a no answer is not a merge", async () => {
		const ask = await Effect.runPromise(sealAsk({...merge, ask: "a-merge-1"}));
		const timeline = [
			{by: LANE, fact: ask},
			said(ask, {_tag: "against", pick: "no", note: "Wait"}),
		];
		expect(yesOf({timeline}, PULL)).toEqual({_tag: "none"});
	});
	it("a merge to an older ask does not answer the newest one, though it showed the same", async () => {
		// No rec, so no blind draw tells the two displays apart.
		const plain = {...merge, rec: NONE};
		const first = await Effect.runPromise(sealAsk({...plain, ask: "a-merge-1"}));
		const newest = await Effect.runPromise(sealAsk({...plain, ask: "a-merge-2"}));
		expect(newest.saw).toBe(first.saw);
		const yes = said(first, {_tag: "chose", pick: "merge"});
		expect(yesOf({timeline: [{by: LANE, fact: first}, yes]}, PULL)).toEqual({
			_tag: "asked",
			head: HEAD,
		});
		const timeline = [{by: LANE, fact: first}, yes, {by: LANE, fact: newest}];
		expect(yesOf({timeline}, PULL)).toEqual({_tag: "none"});
	});
});
