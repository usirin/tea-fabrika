import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import type {Gh} from "../../code-host-github.ts";
import {markerOf, reviewWritesOn, type Verdict} from "./writes.ts";

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
		// Self-fix PR 11b: the read may take more than one call, one per page, so only its path is pinned.
		const reads = calls.slice(0, -1);
		expect(reads.length).toBeGreaterThan(0);
		for (const read of reads) {
			expect(read).not.toContain("--method");
			expect(read.find((arg) => arg.startsWith("repos/"))).toMatch(
				/^repos\/acme\/widgets\/issues\/9\/comments\?/,
			);
		}
		expect(calls.at(-1)?.slice(0, 4).join(" ")).toBe(
			"api --method POST repos/acme/widgets/issues/9/comments",
		);
		expect(calls.at(-1)?.at(-1)).toMatch(
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
		// Self-fix PR 11b: read, maybe page by page, and never written.
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.filter((c) => c.includes("--method"))).toEqual([]);
	});

	// Self-fix PR 11b (docs/plan/pipeline-self-fix.md, PR 11, the record holes). Experiment 193: the post
	// read one page of 100 before it looked for its marker, so past 100 comments it could post twice.
	it("reads every page: 150 comments, the verdict already there on the second page, and no second post", async () => {
		const comments = Array.from({length: 150}, (_, i) => ({body: `comment ${i + 1}`}));
		comments[119] = {body: `${markerOf(verdict(PR))}\n\nold`};
		const calls: (readonly string[])[] = [];
		// GitHub's pages of 100, as `gh api` gives them: `page=<n>` in the query, or `--paginate`, whose
		// pages print one after another, or as one list of pages with `--slurp`.
		const gh: Gh = (args) => {
			calls.push(args);
			const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
			const per = Number(/[?&]per_page=(\d+)/.exec(path)?.[1] ?? 30);
			const pages = Array.from({length: Math.ceil(comments.length / per)}, (_, i) =>
				comments.slice(i * per, (i + 1) * per),
			);
			if (args.includes("--method")) return Effect.succeed("{}");
			if (args.includes("--paginate"))
				return Effect.succeed(
					args.includes("--slurp")
						? JSON.stringify(pages)
						: pages.map((page) => JSON.stringify(page)).join(""),
				);
			const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1);
			return Effect.succeed(JSON.stringify(pages[page - 1] ?? []));
		};
		await Effect.runPromise(reviewWritesOn(gh).post(verdict(PR)));
		expect(calls.filter((c) => c.includes("--method"))).toEqual([]);
		expect(calls.length).toBeGreaterThan(0);
	});
});
