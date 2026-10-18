import {describe, expect, it} from "vitest";
import {type CompiledLane, compileLane, parseLog} from "./lane-log";
import {replayLane} from "./lane-replay";
import {epicWorkflow, issueWorkflow, log} from "./lane-scripted";

// The operator machine, driven over a lane that already happened: the lane's
// own machine folds it, and its recorded events are what lands. The lanes
// here are written by hand in fabrika's shape.

const replay = (lines: readonly string[], workflow: unknown = issueWorkflow()) =>
	replayLane("42", compileLane(workflow) as CompiledLane, parseLog(log(...lines)).entries);

describe("a lane the machine walks to its end", () => {
	it("drives a straight lane: it writes the start, and each shell's report is the log's next line", async () => {
		const r = await replay(["WIP", "DONE", "PASS", "DONE"]);

		expect(r.outcome).toBe("same");
		expect(r.end).toEqual({kind: "terminal", status: "done"});
		expect(r.shells).toEqual(["builder", "reviewer", "shipper"]);
		expect(r.by).toEqual({start: 1, shell: 3});
		expect([r.landed, r.total]).toEqual([4, 4]);
	});

	it("goes round a failed review, and starts the shell each state names", async () => {
		const r = await replay([
			"WIP",
			'DONE {"classes":["ui"]}',
			"FAIL",
			"DONE",
			"PASS",
			"PASS",
			"DONE",
		]);

		expect(r.outcome).toBe("same");
		expect(r.shells).toEqual([
			"builder",
			"reviewer",
			"builder",
			"reviewer",
			"ui-reviewer",
			"shipper",
		]);
	});

	it("listens to the merge queue: a wait is passed over, and the landing is the machine's own write", async () => {
		const r = await replay(["WIP", "DONE", "PASS", "WIP", "WIP", "WIP", "DONE"]);

		expect(r.outcome).toBe("same");
		expect(r.shells).toEqual(["builder", "reviewer", "shipper"]);
		expect(r.by).toEqual({start: 1, shell: 3, wait: 2, queue: 1});
	});

	it("records a stalled queue itself, and clears that park by its recipe", async () => {
		const r = await replay([
			"WIP",
			"DONE",
			"PASS",
			"WIP",
			"WIP",
			"WIP",
			"WIP",
			"WIP",
			'UNBLOCKED {"waitGrant":1}',
			"DONE",
		]);

		expect(r.outcome).toBe("same");
		expect(r.parks).toEqual([
			{
				task: "issue",
				state: "human:queue-stall",
				cause: null,
				recipe: true,
				asked: false,
				cleared: "recipe",
			},
		]);
		expect(r.by).toMatchObject({wait: 3, queue: 2, recipe: 1});
	});

	it("goes back to a builder when the queue throws the pull request out", async () => {
		const r = await replay(["WIP", "DONE", "PASS", "WIP", "FAIL", "DONE", "PASS", "DONE"]);

		expect(r.outcome).toBe("same");
		expect(r.shells).toEqual(["builder", "reviewer", "shipper", "builder", "reviewer", "shipper"]);
	});

	it("writes a dead shell where the log says a spawn died, and starts another", async () => {
		const r = await replay(["WIP", 'LAP {"cause":"spawn-dead"}', "DONE", "PASS", "DONE"]);

		expect(r.outcome).toBe("same");
		expect(r.shells).toEqual(["builder", "builder", "reviewer", "shipper"]);
		expect(r.by).toMatchObject({dead_shell: 1});
	});

	it("starts the build again after a merge that left the issue open", async () => {
		const r = await replay([
			"WIP",
			"DONE",
			"PASS",
			'DONE {"partial":true}',
			"WIP",
			"DONE",
			"PASS",
			"DONE",
		]);

		expect(r.outcome).toBe("same");
		expect(r.by).toMatchObject({start: 2});
	});
});

describe("a park, under the machine", () => {
	it("is cleared by code when a recipe covers its state and cause", async () => {
		const r = await replay([
			"WIP",
			"DONE",
			"PASS",
			'BLOCKED {"cause":"head-ci-red"}',
			"UNBLOCKED",
			"DONE",
		]);

		expect(r.outcome).toBe("same");
		expect(r.parks).toEqual([
			{
				task: "issue",
				state: "human:cp-approval",
				cause: "head-ci-red",
				recipe: true,
				asked: false,
				cleared: "recipe",
			},
		]);
		expect(r.shells).toEqual(["builder", "reviewer", "shipper", "shipper"]);
	});

	it("goes to a person when no recipe covers it, and their answer clears it", async () => {
		const r = await replay([
			"WIP",
			"DONE",
			"PASS",
			'BLOCKED {"cause":"head-behind-base"}',
			"UNBLOCKED",
			"DONE",
		]);

		expect(r.outcome).toBe("same");
		expect(r.parks).toEqual([
			{
				task: "issue",
				state: "human:cp-approval",
				cause: "head-behind-base",
				recipe: false,
				asked: true,
				cleared: "person",
			},
		]);
		expect(r.by).toMatchObject({person: 1});
	});

	it("goes to a person when the cause is a word the machine does not know", async () => {
		const r = await replay([
			"WIP",
			'BLOCKED {"cause":"founder-act-owed"}',
			"UNBLOCKED",
			"DONE",
			"PASS",
			"DONE",
		]);

		expect(r.outcome).toBe("same");
		expect(r.parks).toMatchObject([
			{state: "blocked", cause: "founder-act-owed", asked: true, cleared: "person"},
		]);
	});

	it("ends parked, as the lane did, when the recipe says not yet and nobody answers", async () => {
		const r = await replay(["WIP", "DONE", "PASS", 'BLOCKED {"cause":"awaiting-cp-approval"}']);

		expect(r.outcome).toBe("same");
		expect(r.end?.kind).toBe("parked");
		expect(r.parks).toEqual([
			{
				task: "issue",
				state: "human:cp-approval",
				cause: "awaiting-cp-approval",
				recipe: true,
				asked: true,
				cleared: null,
			},
		]);
	});

	it("takes a person's cleared round as their answer to a spent repair budget", async () => {
		const r = await replay([
			"WIP",
			"DONE",
			"FAIL",
			"DONE",
			"FAIL",
			"DONE",
			"FAIL",
			"DONE",
			"FAIL",
			'CLEARED {"round":4}',
			"UNBLOCKED",
			"PASS",
			"DONE",
		]);

		expect(r.outcome).toBe("same");
		expect(r.parks).toMatchObject([
			{state: "human:budget-spent", cause: "repair-budget-spent", asked: true, cleared: "person"},
		]);
		expect(r.by).toMatchObject({outside: 1, person: 1});
	});
});

describe("a lane the machine does not walk to its end", () => {
	it("diverges where the real driver parked a lane before any build: the machine starts every queued task", async () => {
		const r = await replay([
			'BLOCKED {"cause":"ruling-owed"}',
			"UNBLOCKED",
			"WIP",
			"DONE",
			"PASS",
			"DONE",
		]);

		expect(r.outcome).toBe("diverged");
		expect(r.state).toBe("queued");
		expect(r.why).toBe("the machine starts the build; the log has BLOCKED (ruling-owed)");
		expect(r.landed).toBe(0);
	});

	it("runs out where the log ends mid-lane", async () => {
		const r = await replay(["WIP", "DONE"]);

		expect(r.outcome).toBe("ran_out");
		expect(r.state).toBe("review");
		expect([r.landed, r.total]).toEqual([2, 2]);
	});

	it("sees the lane end from outside when the board closed it", async () => {
		const r = await replay(["WIP", 'BLOCKED {"cause":"verdict-owed"}', "LANDED"]);

		expect(r.outcome).toBe("board");
		expect(r.end).toEqual({kind: "terminal", status: "done"});
		expect(r.by).toMatchObject({outside: 1});
	});

	it("ends cancelled when the issue was closed unplanned", async () => {
		const r = await replay(["WIP", "CANCELLED"]);

		expect(r.outcome).toBe("board");
		expect(r.end).toEqual({kind: "terminal", status: "cancelled"});
	});

	it("stops at an epic's child that is ready to land: that state is known and not built", async () => {
		const r = await replay(
			[
				"issue_2.WIP",
				"issue_3.WIP",
				"issue_2.DONE",
				"issue_3.DONE",
				"issue_2.PASS",
				"issue_3.FAIL",
				"issue_2.DONE",
			],
			epicWorkflow(),
		);

		expect(r.outcome).toBe("stopped");
		expect(r.state).toBe("integrate");
		expect(r.why).toContain("not built here yet");
		// Both children were driven side by side until one reached `integrate`.
		expect(r.shells.slice(0, 4)).toEqual(["builder", "builder", "reviewer", "reviewer"]);
	});
});
