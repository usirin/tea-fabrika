import {describe, expect, it} from "vitest";
import type {PrFacts} from "../ship/facts.ts";
import {laneFactsOver, openArgs} from "./github.ts";
import {type Pull, pullUrl} from "./pulls.ts";

// Today's version. The parts of the GitHub host that can be read with no GitHub. The rest has never
// run: the first live run is the first time.

const FACTS: PrFacts = {
	head: "h",
	state: "open",
	ours: false,
	ticket: "none",
	approval: "given",
	reviews: null,
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: {tested: "m", tip: "m"},
};
const PULL: Pull = {
	id: "https://github.invalid/o/r/pull/9",
	kind: "lane",
	ticket: 7,
	branch: "lane/7",
	head: "h",
	tree: "t",
	state: "open",
	title: "t",
	body: "b",
	verdicts: [],
};

describe("what GitHub says, under the lane's own facts", () => {
	it("an approval on GitHub is not the person's yes", () => {
		expect(laneFactsOver(FACTS, PULL, "o/r", false).approval).toBe("missing");
		expect(laneFactsOver(FACTS, PULL, "o/r", true).approval).toBe("given");
	});

	it("the ticket is the one the lane kept, not one a pull request's text names", () => {
		const read = laneFactsOver(
			{...FACTS, ticket: {id: "o/r#99", link: "closes_it"}},
			PULL,
			"o/r",
			true,
		);
		expect(read.ticket).toEqual({id: "o/r#7", link: "closes_it"});
	});

	it("keeps what only GitHub knows", () => {
		const read = laneFactsOver(
			{...FACTS, checks: "red", mergeable: "conflicts"},
			PULL,
			"o/r",
			true,
		);
		expect(read).toMatchObject({checks: "red", mergeable: "conflicts", head: "h"});
	});

	it("opens on the lane's branch, into main, in the repo the home names", () => {
		const args = openArgs("o/r", {branch: "lane/7", title: "T", body: "B"});
		expect(args.slice(0, 2)).toEqual(["pr", "create"]);
		expect(args).toContain("--head");
		expect(args[args.indexOf("--head") + 1]).toBe("lane/7");
		expect(args[args.indexOf("--repo") + 1]).toBe("o/r");
	});
});

describe("the url a window shows", () => {
	it("a real one stays, and a local one says it is local", () => {
		expect(pullUrl("https://github.invalid/o/r/pull/9")).toBe("https://github.invalid/o/r/pull/9");
		expect(pullUrl("local:o/r/pull/9")).toBe("https://local.invalid/o/r/pull/9");
	});
});
