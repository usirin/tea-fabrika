import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import type {Gh} from "../../code-host-github.ts";
import {reviewWritesOn, type Verdict} from "./writes.ts";

// A review's verdict, posted as a comment on the pull request's own
// repository: read first, written once.

const PR = "https://github.com/acme/widgets/pull/9";

const verdict = (pr: string): Verdict => ({
	pr,
	head: "a".repeat(40),
	kind: "review-code",
	verdict: "pass",
	reason: "1 of 1 criteria met",
	text: "the review",
});

describe("posting a verdict", () => {
	it("reads the comments first, then writes to the pull request's own repository", async () => {
		const calls: (readonly string[])[] = [];
		const gh: Gh = (args) => {
			calls.push(args);
			return Effect.succeed("[]");
		};
		await Effect.runPromise(reviewWritesOn(gh).post(verdict(PR)));
		expect(calls.map((c) => c.slice(0, 4).join(" "))).toEqual([
			"api repos/acme/widgets/issues/9/comments?per_page=100",
			"api --method POST repos/acme/widgets/issues/9/comments",
		]);
		expect(calls[1]?.at(-1)).toMatch(
			/^body=review-code: PASS @ a{40} — 1 of 1 criteria met\n\nthe review$/,
		);
	});

	it("does not post a verdict that is already there", async () => {
		const there = JSON.stringify([
			{body: `review-code: PASS @ ${"a".repeat(40)} — 1 of 1 criteria met\n\nold`},
		]);
		const calls: (readonly string[])[] = [];
		const gh: Gh = (args) => {
			calls.push(args);
			return Effect.succeed(there);
		};
		await Effect.runPromise(reviewWritesOn(gh).post(verdict(PR)));
		expect(calls).toHaveLength(1);
	});
});
