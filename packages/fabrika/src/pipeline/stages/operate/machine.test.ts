import {applyCell} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {laneId} from "../../ids.ts";
import {
	claimTicket,
	type Loop,
	type LoopCmd,
	type LoopMsg,
	type LoopSettings,
	loop,
} from "./machine.ts";

// Which agent the loop hands its builder: a repository's own, else the
// loop's shared one. Pure: the machine's update, one message at a time.

const LANE = laneId("L1");
const SHARED: LoopSettings = {
	rubrics: "/r",
	model: "opus",
	effort: "medium",
	budget: 2,
	ship: "write",
};

type AnyMsg = {readonly type: string; readonly [field: string]: unknown};
const step = (s: Loop, msg: AnyMsg) => applyCell<Loop, AnyMsg, LoopCmd>(loop, s, msg);

/** The build the loop asks for once its claim is answered. */
const firstBuild = (settings: LoopSettings) => {
	const start: LoopMsg = {
		type: "start",
		ticket: "https://github.com/acme/widgets/issues/1",
		number: 1,
		lane: LANE,
		settings,
	};
	const [claiming, [claim]] = step({phase: "idle"}, start);
	const [, [build]] = step(claiming, {type: claimTicket.okType, cmd: claim, value: LANE});
	return build;
};

describe("the agent a step runs", () => {
	it("a loop with no step of its own runs the builder on the shared model, effort and budget", () => {
		expect(firstBuild(SHARED)).toMatchObject({
			type: "loop_build",
			settings: {model: "opus", effort: "medium", budget: 2},
		});
	});

	it("a step the repository named runs on its own, whole", () => {
		const own: LoopSettings = {
			...SHARED,
			agents: {build: {model: "haiku", effort: "low", budget: 0.4}},
		};
		expect(firstBuild(own)).toMatchObject({
			settings: {model: "haiku", effort: "low", budget: 0.4},
		});
	});

	it("only the step named: the review's own does not move the builder", () => {
		const own: LoopSettings = {
			...SHARED,
			agents: {review: {model: "sonnet", effort: "high", budget: 1}},
		};
		expect(firstBuild(own)).toMatchObject({settings: {model: "opus"}});
	});
});
