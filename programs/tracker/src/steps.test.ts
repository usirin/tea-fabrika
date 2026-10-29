import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {describe, expect, it} from "vitest";
import {atSeven, LANE, OWNER, SEVEN, trackerAtSeven} from "./seven.ts";
import {currentOf, stepsOf} from "./steps.ts";

const at = (pos: number, by: Entry["by"], minute: number, fact: Entry["fact"]): Entry => ({
	pos,
	ticket: 7,
	by,
	at: atSeven(10, minute),
	fact,
});

describe("stepsOf", () => {
	it("reads ticket 7: triage and plan done, the approval waits on you, the rest not run", () => {
		const steps = stepsOf(SEVEN);
		expect(steps.map((s) => [s.step, s.state, s.runs])).toEqual([
			["triage", "done", 1],
			["plan", "done", 1],
			["approval", "you", 1],
			["test_writer", "none", 0],
			["build", "none", 0],
			["mutation", "none", 0],
			["review", "none", 0],
			["push", "none", 0],
			["merge", "none", 0],
		]);
		expect(steps[0]).toMatchObject({usd: 0.11, last: "sent to plan: yes"});
		expect(steps[2]?.last).toBe("approve plan v1");
		expect(currentOf(steps)?.step).toBe("approval");
	});

	it("says a step runs while a run is open, and names its task", () => {
		const steps = stepsOf([
			...SEVEN,
			at(8, OWNER, 20, {type: "answered", ask: "a-1", pick: "approve", note: ""}),
			at(9, LANE, 21, {type: "started", run: "r-3", stage: "test_writer", task: "t-1", log: null}),
		]);
		expect(steps[2]).toMatchObject({state: "done", last: "answered: approve"});
		expect(steps[3]).toMatchObject({state: "running", last: "running, task t-1"});
		expect(currentOf(steps)?.step).toBe("test_writer");
	});

	it("says stuck when the last run ended stuck, and counts only asks with an approve pick", () => {
		const steps = stepsOf([
			at(1, LANE, 2, {type: "asked", ask: "a-9", what: "which repo?", picks: ["app", "api"]}),
			at(2, LANE, 2, {type: "started", run: "r-1", stage: "triage", task: null, log: null}),
			at(3, LANE, 3, {
				type: "ended",
				run: "r-1",
				stage: "triage",
				outcome: {kind: "stuck", why: "unclear"},
				usd: 0.02,
				input: 10,
				output: 1,
				turns: 1,
			}),
		]);
		expect(steps[0]?.state).toBe("stuck");
		expect(steps[2]).toMatchObject({state: "none", runs: 0});
	});
});

describe("trackerAtSeven", () => {
	it("is the tracker read to the end, with ticket 7 open at 10:14", () => {
		const s = trackerAtSeven();
		expect(s.ready).toBe(true);
		expect(s.open).toBe(7);
		expect(s.tickets.find((t) => t.number === 7)?.timeline).toHaveLength(SEVEN.length);
	});
});
