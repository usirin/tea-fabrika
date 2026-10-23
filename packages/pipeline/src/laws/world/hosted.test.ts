import {describe, expect, it} from "vitest";
import {
	type Hosted,
	type HostedOptions,
	hostedWorld,
	laneOver,
	notWaitingOnAChild,
} from "./hosted.ts";
import {type Safety, search} from "./search.ts";

// The hosted lane's world (experiment 115). Today's wiring breaks both laws below: a child that
// ends with no outcome row leaves the lane waiting for good. That run is in experiment 115's
// script, not here, so the suite stays green until the owner decides the fix. Here: the world is
// finite, the lane can reach its end, and the two wirings that should keep the laws keep them.

const FIXED: HostedOptions = {sub: "fixed", errors: true};
/** Every child writes its row before it ends: what today's lane assumes. */
const ASSUMED: HostedOptions = {sub: "today", always: true, errors: true};

const holds = (o: HostedOptions, end = laneOver) => {
	const r = search(hostedWorld(o, end), {laws: [], depth: 400, eventually: true});
	expect(r.complete).toBe(true);
	expect(r.lassos).toEqual([]);
	expect(r.dead).toEqual([]);
};

const reaches = (name: string, at: (w: Hosted) => boolean): Safety<Hosted> => ({
	name,
	check: (_prev, _move, next) => (at(next) ? "reached" : null),
});

describe("the hosted lane's world", () => {
	it("with the Sub that also ends on the child's EXIT, every child ends and every lane ends", () => {
		holds(FIXED, notWaitingOnAChild);
		holds(FIXED, laneOver);
	});

	it("with every child writing its row first, today's Sub keeps both laws too", () => {
		holds(ASSUMED, notWaitingOnAChild);
		holds(ASSUMED, laneOver);
	});

	it("reaches a merged lane, and with the fixed Sub a lane stuck on a missing row", () => {
		const done = reaches("done", (w) => w.lane.phase === "over" && w.lane.outcome.kind === "done");
		const missing = reaches(
			"no row",
			(w) =>
				w.lane.phase === "over" && w.lane.report.problems.some((p) => p.endsWith("no_outcome")),
		);
		const r = search(hostedWorld(FIXED), {laws: [done, missing], depth: 400});
		expect(r.broken.map((b) => b.law).sort()).toEqual(["done", "no row"]);
	});
});
