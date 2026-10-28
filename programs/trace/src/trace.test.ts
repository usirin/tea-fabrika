import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {atSeven, OWNER, SEVEN, SEVEN_NOW} from "@tea-fabrika/tracker/seven";
import {describe, expect, it} from "vitest";
import {axisOf, placeOf, stopsOf, ticksOf, traceOf} from "./trace.ts";

const track = (trace: ReturnType<typeof traceOf>, name: string) => {
	const found = trace.tracks.find((t) => t.name === name);
	if (found === undefined) throw new Error(`no track ${name}`);
	return found;
};

describe("traceOf", () => {
	it("lays ticket 7 out live: a ticket row, the nine steps, a clip per run, the open wait", () => {
		const trace = traceOf(SEVEN, SEVEN_NOW);
		expect(trace.tracks.map((t) => t.name)).toEqual([
			"ticket",
			"triage",
			"plan",
			"approval",
			"test_writer",
			"build",
			"mutation",
			"review",
			"push",
			"merge",
		]);
		expect(trace.from).toBe(atSeven(10, 2));
		expect(trace.to).toBe(SEVEN_NOW);
		expect(trace.spans).toBe(2);
		expect(trace.usd).toBeCloseTo(0.49);
		const plan = track(trace, "plan");
		expect(plan.who).toBe("agent");
		expect(plan.clips).toMatchObject([
			{run: "r-2", from: atSeven(10, 3), to: atSeven(10, 9), open: false},
		]);
		expect(track(trace, "approval")).toMatchObject({
			who: "person",
			waits: [{ask: "a-1", from: atSeven(10, 9), to: SEVEN_NOW, pick: null}],
		});
		expect(track(trace, "build")).toMatchObject({who: "none", clips: [], usd: 0});
		expect(trace.markers).toEqual([]);
	});

	it("replays up to the playhead: the plan's run is open, and nothing after it is there", () => {
		const trace = traceOf(SEVEN, SEVEN_NOW, atSeven(10, 5));
		expect(trace.from).toBe(atSeven(10, 2));
		expect(trace.to).toBe(SEVEN_NOW);
		expect(trace.upTo).toBe(atSeven(10, 5));
		expect(track(trace, "plan").clips).toMatchObject([
			{run: "r-2", to: atSeven(10, 5), open: true, ended: null},
		]);
		expect(track(trace, "approval").waits).toEqual([]);
		expect(trace.usd).toBeCloseTo(0.11);
	});

	it("marks an answer on the ruler and closes its wait; the axis ends at the last fact", () => {
		const answered: Entry = {
			pos: 8,
			ticket: 7,
			by: OWNER,
			at: atSeven(10, 20),
			fact: {type: "answered", ask: "a-1", pick: "approve", note: ""},
		};
		const trace = traceOf([...SEVEN, answered], atSeven(10, 30));
		expect(trace.to).toBe(atSeven(10, 20));
		expect(trace.markers).toEqual([{at: atSeven(10, 20), kind: "answer", says: "approve"}]);
		expect(track(trace, "approval").waits).toMatchObject([{to: atSeven(10, 20), pick: "approve"}]);
	});

	it("keeps a stage outside the nine on a track of its own after them", () => {
		const extra: Entry = {
			pos: 8,
			ticket: 7,
			by: SEVEN[1]?.by ?? OWNER,
			at: atSeven(10, 10),
			fact: {type: "started", run: "r-3", stage: "sort", task: null, log: null},
		};
		const trace = traceOf([...SEVEN, extra], SEVEN_NOW);
		expect(trace.tracks.at(-1)).toMatchObject({name: "sort", clips: [{run: "r-3", open: true}]});
	});
});

describe("the axis", () => {
	it("is at least five minutes, so one fact does not fill it", () => {
		const one = SEVEN.slice(0, 1);
		expect(axisOf(one, atSeven(10, 2))).toEqual({from: atSeven(10, 2), to: atSeven(10, 7)});
	});

	it("places a time from 0 to 100, ticks on round minutes, and stops at each fact", () => {
		const trace = traceOf(SEVEN, SEVEN_NOW);
		expect(placeOf(trace, trace.from)).toBe(0);
		expect(placeOf(trace, trace.to)).toBe(100);
		expect(ticksOf(trace)).toEqual([
			atSeven(10, 2),
			atSeven(10, 4),
			atSeven(10, 6),
			atSeven(10, 8),
			atSeven(10, 10),
			atSeven(10, 12),
			atSeven(10, 14),
		]);
		expect(stopsOf(SEVEN)).toEqual([atSeven(10, 2), atSeven(10, 3), atSeven(10, 9)]);
	});
});
