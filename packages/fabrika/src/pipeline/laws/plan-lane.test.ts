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
});
