import {describe, expect, it} from "vitest";
import {
	applyCorrections,
	type CompiledLane,
	compileLane,
	isPark,
	parseLog,
	stageOf,
	statusOf,
	walk,
} from "./lane-log.ts";
import {epicWorkflow, issueWorkflow, log} from "./lane-scripted.ts";

// A lane's log, folded through its own machine the way fabrika 0.9.0 folds
// it. The workflows here are written by hand in fabrika's shape.

const issue = (classes: readonly string[] = []) =>
	compileLane(issueWorkflow(classes)) as CompiledLane;
/** Fold a log and give back the states the task went through, and where the lane ended. */
function fold(lines: readonly string[], lane = issue()) {
	const walked = walk(lane, parseLog(log(...lines)).entries);
	const steps = Object.values(walked.steps).flat();
	return {walked, path: steps.map((s) => s.to), status: walked.status, last: steps.at(-1)};
}

describe("reading a log", () => {
	it("strips the task's name from the event, and keeps what the fold reads", () => {
		const {entries, malformed} = parseLog(
			log(
				"WIP",
				'DONE {"pr":"https://example.test/pull/7","partial":false}',
				'BLOCKED {"cause":"head-ci-red","classes":["code"]}',
			),
		);

		expect(malformed).toBe(0);
		expect(entries.map((e) => [e.task, e.event])).toEqual([
			["issue", "WIP"],
			["issue", "DONE"],
			["issue", "BLOCKED"],
		]);
		expect(entries[1]).toMatchObject({
			pr: "https://example.test/pull/7",
			partial: false,
			cause: null,
		});
		expect(entries[2]).toMatchObject({cause: "head-ci-red", classes: ["code"]});
		expect((entries[1]?.at ?? 0) - (entries[0]?.at ?? 0)).toBe(60_000);
	});

	it("counts a line that is not an event, and reads on", () => {
		const {entries, malformed} = parseLog(
			`${log("WIP")}\nnot json\n{"task":"issue"}\n\n${log("DONE")}`,
		);

		expect(malformed).toBe(2);
		expect(entries.map((e) => e.event)).toEqual(["WIP", "DONE"]);
	});
});

describe("folding one issue's lane", () => {
	it("walks a lane straight through, by the merge queue", () => {
		const {path, status} = fold(["WIP", "DONE", "PASS", "WIP", "DONE"]);

		expect(path).toEqual(["build", "review", "ship", "ship:queued", "shipped"]);
		expect(status).toBe("complete");
	});

	it("sends a failed review back to build, and counts the round", () => {
		const {path, last} = fold(["WIP", "DONE", "FAIL", "DONE", "PASS", "DONE"]);

		expect(path).toEqual(["build", "review", "build", "review", "ship", "shipped"]);
		expect(last?.after.retries).toBe(1);
	});

	it("trips the lane when the repair budget is spent, and a cleared round opens it again", () => {
		const rounds = ["WIP", "DONE", "FAIL", "DONE", "FAIL", "DONE", "FAIL", "DONE", "FAIL"];
		const spent = fold(rounds);

		expect(spent.path.at(-1)).toBe("human:budget-spent");
		expect(spent.status).toBe("tripped");

		const cleared = fold([
			...rounds,
			'CLEARED {"round":4}',
			"UNBLOCKED",
			"FAIL",
			"DONE",
			"PASS",
			"DONE",
		]);

		// The clearance moves nothing; the unblock goes back to review, where the fourth round is now in budget.
		expect(cleared.path.slice(9)).toEqual([
			"human:budget-spent",
			"review",
			"build",
			"review",
			"ship",
			"shipped",
		]);
		expect(cleared.last?.after).toMatchObject({retries: 4, maxRetries: 4, cleared: [4]});
		expect(cleared.status).toBe("complete");
	});

	it("routes rendered work by its class, and keeps the class once an event has named it", () => {
		const booted = fold(["WIP", "DONE", "PASS", "PASS", "DONE"], issue(["ui"]));
		const named = fold(["WIP", 'DONE {"classes":["ui","code"]}', "PASS", "PASS", "DONE"]);

		expect(booted.path).toEqual(["build:ui", "review", "review:ui", "ship", "shipped"]);
		expect(named.path).toEqual(["build", "review", "review:ui", "ship", "shipped"]);
	});

	it("returns an unblocked task to the state it was parked out of", () => {
		const {path} = fold([
			"WIP",
			"DONE",
			'BLOCKED {"cause":"verdict-owed"}',
			"UNBLOCKED",
			"PASS",
			'BLOCKED {"cause":"awaiting-cp-approval"}',
			"UNBLOCKED",
			"DONE",
		]);

		expect(path).toEqual([
			"build",
			"review",
			"blocked",
			"review",
			"ship",
			"human:cp-approval",
			"ship",
			"shipped",
		]);
	});

	it("sends an investigation's DONE to its own end, with no review", () => {
		const {path, status} = fold(["WIP", 'DONE {"diagnosis":true}']);

		expect(path).toEqual(["build", "diagnosed"]);
		expect(status).toBe("diagnosed");
	});

	it("takes a merge that left its issue open round again, and a correction can say so after the fact", () => {
		const partial = fold(["WIP", "DONE", "PASS", 'DONE {"partial":true}']);

		expect(partial.path.at(-1)).toBe("queued");
		expect(partial.status).toBe("active");

		const {entries} = parseLog(log("WIP", "DONE", "PASS", "DONE"));
		const shipped = entries.at(-1);
		const corrected = [
			...entries,
			...parseLog(log(`CORRECTED {"corrects":"${shipped?.stamp}","partial":true}`)).entries,
		];
		const walked = walk(issue(), corrected);

		expect(applyCorrections(corrected).map((e) => e.event)).toEqual([
			"WIP",
			"DONE",
			"PASS",
			"DONE",
		]);
		expect(walked.steps.issue?.at(-1)?.to).toBe("queued");
		expect(walked.corrected).toBe(1);
	});

	it("routes a lap by its cause: a conflicted base goes back to build, any other lap stays", () => {
		const conflicted = fold(["WIP", "DONE", "PASS", 'LAP {"cause":"base-conflicted"}']);
		const ejected = fold(["WIP", "DONE", "PASS", 'LAP {"cause":"queue-ejected"}']);

		expect(conflicted.path.at(-1)).toBe("build");
		expect(ejected.path.at(-1)).toBe("ship");
		expect(ejected.last?.after).toMatchObject({laps: 1, retries: 0});
	});

	it("parks a pull request the merge queue holds past its wait budget, and a granted wait lets it back in", () => {
		const stalled = fold(["WIP", "DONE", "PASS", "WIP", "WIP", "WIP", "WIP", "WIP"]);

		expect(stalled.path.slice(3)).toEqual([
			"ship:queued",
			"ship:queued",
			"ship:queued",
			"ship:queued",
			"human:queue-stall",
		]);

		const resumed = fold([
			"WIP",
			"DONE",
			"PASS",
			"WIP",
			"WIP",
			"WIP",
			"WIP",
			"WIP",
			'UNBLOCKED {"waitGrant":1}',
			"WIP",
			"DONE",
		]);

		expect(resumed.path.slice(8)).toEqual(["ship:queued", "ship:queued", "shipped"]);
	});

	it("ends a lane from any state when the board says so", () => {
		const landed = fold(["WIP", 'BLOCKED {"cause":"ruling-owed"}', "LANDED"]);
		const cancelled = fold(["WIP", "DONE", "CANCELLED"]);

		expect([landed.path.at(-1), landed.status]).toEqual(["board:landed", "board:landed"]);
		expect([cancelled.path.at(-1), cancelled.status]).toEqual([
			"board:cancelled",
			"board:cancelled",
		]);
	});

	it("marks a line the state has no arm for, and leaves the task where it was", () => {
		const {walked, path} = fold(["WIP", "PASS", "DONE"]);

		expect(walked.steps.issue?.map((s) => s.noCell)).toEqual([false, true, false]);
		expect(path).toEqual(["build", "build", "review"]);
	});
});

describe("folding an epic's lane", () => {
	const epic = compileLane(epicWorkflow()) as CompiledLane;

	it("keeps a task per child, and the phases in order", () => {
		expect(epic.phases).toEqual([
			{name: "phase1", tasks: ["issue_2", "issue_3"]},
			{name: "epic", tasks: ["epic_1"]},
		]);
	});

	it("folds each child by its own lines, and is active in the first phase not all done", () => {
		const {entries} = parseLog(
			log(
				"issue_2.WIP",
				"issue_3.WIP",
				"issue_2.DONE",
				"issue_2.PASS",
				"issue_2.DONE",
				"issue_9.WIP",
			),
		);
		const walked = walk(epic, entries);

		expect(walked.states.issue_2?.state).toBe("landed");
		expect(walked.states.issue_3?.state).toBe("build");
		expect(walked.strays).toBe(1);
		expect(statusOf(epic, walked.states)).toEqual({status: "active", phase: "phase1"});
	});

	it("moves to the epic's own task once every child has landed", () => {
		const child = (n: number) => [
			`issue_${n}.WIP`,
			`issue_${n}.DONE`,
			`issue_${n}.PASS`,
			`issue_${n}.DONE`,
		];
		const walked = walk(epic, parseLog(log(...child(2), ...child(3))).entries);

		expect(statusOf(epic, walked.states)).toEqual({status: "active", phase: "epic"});

		const shipped = walk(
			epic,
			parseLog(log(...child(2), ...child(3), "epic_1.PASS", "epic_1.DONE")).entries,
		);

		expect(shipped.status).toBe("complete");
	});
});

describe("what a state is", () => {
	it("names the stage a state belongs to", () => {
		expect(
			[
				"queued",
				"build:ui",
				"review:ui",
				"ship:queued",
				"shipped",
				"integrate",
				"blocked",
				"human:cp-approval",
				"frozen",
				"board:landed",
			].map(stageOf),
		).toEqual([
			"queued",
			"build",
			"review",
			"ship",
			"final",
			"integrate",
			"park",
			"park",
			"park",
			"final",
		]);
		expect([isPark("human:queue-stall"), isPark("ship")]).toEqual([true, false]);
	});

	it("refuses a document that is not a lane's machine", () => {
		expect(compileLane({})).toBeNull();
		expect(compileLane({machine: {states: {done: {type: "final"}}}})).toBeNull();
	});
});
