import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {checkHolds, laneStuck, wipOf} from "./lane.ts";

// Today's tooling. Pure rules drive.ts and gc.ts share.
const options = {seed: 119120, numRuns: 300};
const branch = fc.stringMatching(/^fabrikalfa\/[a-z0-9]{1,8}(-[a-z0-9]{1,4})?$/);
const step = fc.constantFrom("tests", "build", "mutation", "review", "lead");

describe("lane rules, today's tooling", () => {
	// Plant: always append -wip. p12, 2026-11-09: a -wip lane was backed up to p12-wip-wip.
	it("the backup branch ends in exactly one -wip, and a -wip branch is kept as it is", () => {
		fc.assert(
			fc.property(branch, fc.nat({max: 3}), (b, n) => {
				const lane = b + "-wip".repeat(n);
				const to = wipOf(lane);
				expect(to).toMatch(/(?<!-wip)-wip$/);
				expect(to.replace(/-wip$/, "")).toBe(b);
				if (n === 1) expect(to).toBe(lane);
			}),
			options,
		);
	});

	// Plants: waive every stale link; waive a stale link of a step the lane signed; waive other stuck.
	// themes tests4, 2026-11-09: PR 565's lead link on ticket 343 made the lane's tests step stale_link lead.
	it("holds every stuck answer except a stale link of a step the lane has not signed", () => {
		const answer = fc.oneof(
			fc.record({_tag: fc.constant("stuck"), why: fc.constant("stale_link"), step}),
			fc.record({
				_tag: fc.constant("stuck"),
				why: fc.constantFrom("unsigned_commit", "broken_chain"),
			}),
			fc.record({
				_tag: fc.constant("ask"),
				who: fc.constant("owner"),
				for: fc.constant("exam_read"),
			}),
		);
		fc.assert(
			fc.property(fc.array(answer), fc.uniqueArray(step), (answers, signed) => {
				const lane = new Set<string>(signed);
				const out = [...answers.map((a) => JSON.stringify(a)), "commits: noise"].join("\n");
				const held = laneStuck(out, lane).map((l) => JSON.parse(l));
				const want = answers.filter(
					(a) =>
						a._tag === "stuck" && !(a.why === "stale_link" && "step" in a && !lane.has(a.step)),
				);
				expect(held).toEqual(want);
				const stuck = answers.some((a) => a._tag === "stuck");
				expect(checkHolds(0, out, lane)).toBe(false);
				expect(checkHolds(1, out, lane)).toBe(want.length > 0 || !stuck);
				expect(checkHolds(2, out, lane)).toBe(true);
			}),
			options,
		);
	});
});
