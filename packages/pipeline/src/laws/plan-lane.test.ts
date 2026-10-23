import {describe, expect, it} from "vitest";
import * as catchup from "./catchup.ts";
import {explore, type Law, type Update, type World} from "./explore.ts";
import * as lane from "./lane.ts";
import * as task from "./task.ts";

// The plan lane's three machines (experiment 105): each law shown to bite on a planted mistake.
// standard.test.ts checks each one holds on the real machine.

const caught = <S, M extends {readonly type: string}, C>(
	init: S,
	update: Update<S, M, C>,
	world: World<S, M, C>,
	laws: readonly Law<S, M, C>[],
	depth: number,
): readonly string[] => explore({init, update, world, laws, depth}).broken.map((b) => b.law);

describe("plan task", () => {
	const run = (update: typeof task.taskStep) =>
		caught(task.taskInit, update, task.taskWorld(), task.taskLaws(), 6);

	it("holds on the machine", () => {
		expect(run(task.taskStep)).toEqual([]);
	});

	it("catches a builder's closing word put into the commit as it came", () => {
		expect(run(task.rawSummary)).toContain("the commit closes no ticket");
	});

	it("catches a push from anywhere but where the branch stood", () => {
		expect(run(task.pushesFromMain)).toContain(
			"a push goes out only after the gate let the task through, from the base it read",
		);
	});
});

describe("plan catch-up", () => {
	const run = (update: typeof catchup.catchupStep) =>
		caught(catchup.catchupInit, update, catchup.catchupWorld(), catchup.catchupLaws(), 6);

	it("holds on the machine", () => {
		expect(run(catchup.catchupStep)).toEqual([]);
	});

	it("catches a merge pushed with a conflict no one resolved", () => {
		expect(run(catchup.pushesUnresolved)).toContain(
			"a push goes from the branch as read and takes in the main it read, or only reverts",
		);
	});

	it("catches the lockfile handed to the resolver", () => {
		expect(run(catchup.resolvesTheLockfile)).toContain("the lockfile never goes to the resolver");
	});
});

describe("plan lane", () => {
	const run = (update: typeof lane.laneStep, world = lane.laneWorld(), depth = 6) =>
		caught(lane.laneInit, update, world, lane.laneLaws(), depth);

	it("holds on the machine", () => {
		expect(run(lane.laneStep)).toEqual([]);
	});

	it("catches a planner's closing word put into the pull request as it came", () => {
		expect(run(lane.rawBody)).toContain(
			"the pull request opens only at a met head that has main in, and closes exactly the plan's tickets",
		);
	});

	it("catches a pull request opened while main has moved on", () => {
		expect(run(lane.opensBehind)).toContain(
			"the pull request opens only at a met head that has main in, and closes exactly the plan's tickets",
		);
	});

	it("catches a child's name that leaves out its round", () => {
		const world = lane.laneWorld({views: ["a task not done"]});
		expect(run(lane.forgetsTheRound, world, 14)).toContain(
			"a child's name always means the same job",
		);
	});

	it("catches a fixed cap put back: the lane stops at round 2 on its own count", () => {
		const world = lane.laneWorld({views: ["a task not done"]});
		expect(run(lane.aCapPutBack(1), world, 12)).toContain(
			"no count of the lane's own ends it: only a read, a child stuck or a failed write does",
		);
	});

	it("catches a last review the stall rule never counts", () => {
		const world = lane.laneWorld({views: ["not met"]});
		expect(run(lane.forgetsTheLastReviews, world, 8)).toContain(
			"every review, and every ship run that did not merge, is counted for the stall rule with what it left open",
		);
	});
});

// The lane wired to the desk (`withTheDesk`): the stall rule, the asks core's one copy, is what
// stops every loop, and nothing else does (docs/direction/done-is-per-criterion.md).
describe("plan lane, with the desk", () => {
	const down = (from: number) => Array.from({length: from}, (_, i) => from - i);
	const laws = (run: lane.DeskRun) => run.broken.map((b) => b.law);

	it("a task's list that keeps shrinking runs past 12 rounds, is never asked about, and merges", () => {
		const run = lane.withTheDesk(lane.laneStep, {task: down(20)});
		expect(run.broken).toEqual([]);
		expect(run.state).toMatchObject({phase: "over", outcome: {kind: "done"}});
		expect(run.started).toMatchObject({round: 21, ship: 1});
		expect(run.waiting).toEqual([]);
	});

	it("a task's list that stalls asks the owner at its second stall in a row, and the lane waits", () => {
		const run = lane.withTheDesk(lane.laneStep, {task: [3, 3, 3, 3, 3]});
		expect(run.broken).toEqual([]);
		expect(run.state.phase).toBe("waiting");
		expect(run.waiting).toEqual(["stuck:o/r#7/t1/1"]);
		expect(run.noted).toEqual({t1: [3, 3, 3]});
	});

	it("a task's list that wobbles, 1, 2, 1, 2, asks at round 4", () => {
		const run = lane.withTheDesk(lane.laneStep, {task: [1, 2, 1, 2, 1, 2]});
		expect(run.broken).toEqual([]);
		expect(run.waiting).toEqual(["stuck:o/r#7/t1/1"]);
		expect(run.noted).toEqual({t1: [1, 2, 1, 2]});
	});

	it("last reviews: a shrinking list runs past the old cap of 4; a flat or wobbling one asks", () => {
		const long = lane.withTheDesk(lane.laneStep, {finals: down(10)});
		expect(long.broken).toEqual([]);
		expect(long.state).toMatchObject({phase: "over", outcome: {kind: "done"}});
		expect(long.started).toMatchObject({final: 11});
		const flat = lane.withTheDesk(lane.laneStep, {finals: [2, 2, 2, 2]});
		expect(flat.broken).toEqual([]);
		expect(flat.waiting).toEqual(["stuck:o/r#7/plan/1"]);
		expect(flat.noted.plan).toEqual([2, 2, 2]);
		const wobble = lane.withTheDesk(lane.laneStep, {finals: [1, 2, 1, 2, 1]});
		expect(wobble.broken).toEqual([]);
		expect(wobble.noted.plan).toEqual([1, 2, 1, 2]);
		expect(wobble.waiting).toEqual(["stuck:o/r#7/plan/1"]);
	});

	it("ship runs sent back count 1 each, in the plan's list, as in the one-ticket loop", () => {
		// After a pass, the first send starts the list, the second is one stall, the third asks.
		const sends = lane.withTheDesk(lane.laneStep, {ships: 5});
		expect(sends.broken).toEqual([]);
		expect(sends.noted.plan).toEqual([1, 1, 1]);
		expect(sends.waiting).toEqual(["stuck:o/r#7/plan/1"]);
		// After a last review that left 1 open, a send is no shorter: two in a row ask.
		const after = lane.withTheDesk(lane.laneStep, {finals: [1], ships: 5});
		expect(after.noted.plan).toEqual([1, 1, 1]);
		expect(after.started).toMatchObject({final: 2, ship: 2});
		expect(after.waiting).toEqual(["stuck:o/r#7/plan/1"]);
		// Two sends, then a merge: no ask.
		const two = lane.withTheDesk(lane.laneStep, {ships: 2});
		expect(two.broken).toEqual([]);
		expect(two.state).toMatchObject({phase: "over", outcome: {kind: "done"}});
	});

	it("catches a fixed cap put back: 12 rounds a task, 4 last reviews", () => {
		// Both the lane's own law and the desk's catch it.
		const both = [
			"no count of the lane's own ends it: only a read, a child stuck or a failed write does",
			"a list that still shrinks never stops the lane: there is no cap",
		];
		const rounds = lane.withTheDesk(lane.aCapPutBack(12), {task: down(20)});
		expect(laws(rounds)).toEqual(both);
		expect(rounds.started).toMatchObject({round: 12});
		expect(laws(lane.withTheDesk(lane.aCapPutBack(4), {finals: down(10)}))).toEqual(both);
	});

	it("catches last reviews the stall rule never counts: the flat list runs on past its ask", () => {
		const run = lane.withTheDesk(lane.forgetsTheLastReviews, {finals: [2, 2, 2, 2, 2]});
		expect(laws(run)).toContain(
			"a list the stall rule asks the owner on starts no child until the owner answers",
		);
	});
});
