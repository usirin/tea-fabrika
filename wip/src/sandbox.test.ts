import {Effect, Exit} from "effect";
import {describe, expect, it} from "vitest";
import {shapeOf} from "../../packages/tea-program/src/shape.ts";
import type {Gh} from "./code-host-github.ts";
import {inSandbox, SANDBOX_URL, SandboxPullRequest, SandboxTicket, sandboxOnly} from "./sandbox.ts";
import {reviewWritesOn, sandboxWritesOn, type Verdict} from "./stages/operate/writes.ts";

// The two holds that keep every write on the sandbox: the input's shape, and
// the check each write side makes before it writes. A demlik target must be
// refused by both, and a gh that is asked to write anything must never be
// reached.

const DEMLIK = [
	"https://github.com/kamp-us/demlik/issues/670",
	"https://github.com/kamp-us/demlik/pull/691",
	"https://github.com/kamp-us/demlik",
];
/** Urls that start like the sandbox's and are not in it. */
const LOOKALIKES = [
	`${SANDBOX_URL}-x/pull/1`,
	`${SANDBOX_URL}/pull/1?https://github.com/kamp-us/demlik/pull/1`,
	`${SANDBOX_URL}/x/https://github.com/kamp-us/demlik/pull/1`,
	`${SANDBOX_URL}/pull/1/../../../../kamp-us/demlik/pull/1`,
	`http://github.com/kamp-us/tea-fabrika-sandbox/pull/1`,
	// Its address before it moved: GitHub still forwards it, but the name is not the sandbox's.
	`https://github.com/usirin/tea-fabrika-sandbox/pull/1`,
];

describe("the first hold: the shape", () => {
	const ticket = shapeOf(SandboxTicket);
	const pr = shapeOf(SandboxPullRequest);

	it("takes a sandbox ticket and a sandbox pull request", () => {
		expect(ticket.check(`${SANDBOX_URL}/issues/1`)).toBe(true);
		expect(pr.check(`${SANDBOX_URL}/pull/12`)).toBe(true);
	});

	it.each([...DEMLIK, ...LOOKALIKES])("refuses %s, and says why", (url) => {
		expect(ticket.check(url)).toBe(false);
		expect(pr.check(url)).toBe(false);
		expect(ticket.problem(url)).toContain("not a ticket in the sandbox");
	});
});

describe("the second hold: each write checks its target", () => {
	it.each([...DEMLIK, ...LOOKALIKES])("%s is not in the sandbox, and a write to it dies", (url) => {
		expect(inSandbox(url)).toBe(false);
		const exit = Effect.runSyncExit(sandboxOnly(url));
		expect(Exit.isFailure(exit) && String(exit.cause)).toContain("refused");
	});

	/** A gh that keeps each call and answers an empty list. */
	const recording = () => {
		const calls: (readonly string[])[] = [];
		const gh: Gh = (args) => {
			calls.push(args);
			return Effect.succeed("[]");
		};
		return {gh, calls};
	};
	const verdict = (pr: string): Verdict => ({
		pr,
		head: "a".repeat(40),
		kind: "review-code",
		verdict: "pass",
		reason: "1 of 1 criteria met",
		text: "the review",
	});

	it.each(DEMLIK.filter((u) => u.includes("/pull/")).concat(LOOKALIKES))(
		"a verdict, an enqueue and a re-run on %s die before gh is called",
		async (url) => {
			const {gh, calls} = recording();
			for (const write of [
				reviewWritesOn(gh).post(verdict(url)),
				sandboxWritesOn(gh).enqueue(url, "a".repeat(40)),
				sandboxWritesOn(gh).rerunChecks(url, "a".repeat(40)),
			]) {
				const exit = await Effect.runPromiseExit(write);
				expect(Exit.isFailure(exit)).toBe(true);
			}
			expect(calls).toEqual([]);
		},
	);

	it("a verdict on a sandbox pull request is read before it is written, to the sandbox's own path", async () => {
		const {gh, calls} = recording();
		await Effect.runPromise(reviewWritesOn(gh).post(verdict(`${SANDBOX_URL}/pull/9`)));
		expect(calls.map((c) => c.slice(0, 4).join(" "))).toEqual([
			"api repos/kamp-us/tea-fabrika-sandbox/issues/9/comments?per_page=100",
			"api --method POST repos/kamp-us/tea-fabrika-sandbox/issues/9/comments",
		]);
		expect(calls[1]?.at(-1)).toMatch(
			/^body=review-code: PASS @ a{40} — 1 of 1 criteria met\n\nthe review$/,
		);
	});

	it("a verdict already there is not posted again", async () => {
		const there = JSON.stringify([
			{body: `review-code: PASS @ ${"a".repeat(40)} — 1 of 1 criteria met\n\nold`},
		]);
		const calls: (readonly string[])[] = [];
		const gh: Gh = (args) => {
			calls.push(args);
			return Effect.succeed(there);
		};
		await Effect.runPromise(reviewWritesOn(gh).post(verdict(`${SANDBOX_URL}/pull/9`)));
		expect(calls).toHaveLength(1);
	});
});
