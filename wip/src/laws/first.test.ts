import {describe, expect, it} from "vitest";
import {explore, follow, type Law, pathText, type Update, type World} from "./explore.ts";
import * as queue from "./queue.ts";
import * as session from "./session.ts";

// The first laws of the machines experiment 90 did not cover. standard.test.ts
// checks each holds; here each law is shown to bite, on a planted mistake,
// and each break the laws found is pinned by its shortest sequence.

/** Each broken law, by name, as its shortest breaking sequence. */
const caught = <S, M extends {readonly type: string}, C>(
	parts: {
		readonly init: S;
		readonly world: World<S, M, C>;
		readonly laws: () => readonly Law<S, M, C>[];
		readonly show: (m: M) => string;
	},
	update: Update<S, M, C>,
	depth: number,
): Record<string, string> =>
	Object.fromEntries(
		explore({init: parts.init, update, world: parts.world, laws: parts.laws(), depth}).broken.map(
			(b) => [b.law, pathText(b.path, parts.show)],
		),
	);

describe("queue", () => {
	const parts = {
		init: queue.queueInit,
		world: queue.queueWorld(),
		laws: queue.queueLaws,
		show: queue.showQueueMsg,
	};

	it("catches each planted mistake in a few messages", () => {
		expect(caught(parts, queue.queuesTwice, 4)).toMatchObject({
			"a value is on the queue once": "1. told a\n2. told a",
		});
		expect(caught(parts, queue.dropsTheWorked, 4)).toMatchObject({
			"the value being worked stays first until its work ends": "1. told a\n2. dropped a",
		});
		expect(caught(parts, queue.jumpsTheQueue, 4)).toMatchObject({
			"values are worked in the order told": "1. told a\n2. told b\n3. told c",
		});
		expect(caught(parts, queue.forgetsTheTidy, 4)).toMatchObject({
			"work that ended is tidied before it is forgotten": "1. told a\n2. done a",
		});
	});
});

describe("acp session", () => {
	const parts = {
		init: session.sessionInit,
		world: session.sessionWorld(),
		laws: session.sessionLaws,
		show: session.showSessionMsg,
	};

	it("regression: a second open never moves the session to another harness", () => {
		const path = follow(
			{init: parts.init, update: session.sessionStep, world: parts.world, laws: parts.laws()},
			parts.show,
			["opened s-1 on claude", "opened s-2 on codex"],
		);
		expect(path.broken).toEqual([]);
		expect(path.state).toMatchObject({agent: "claude", id: "s-1"});
	});

	it("catches a planted mistake in a few messages", () => {
		expect(caught(parts, session.endsTheLast, 4)).toMatchObject({
			"a turn ends only for the prompt whose turn is running":
				"1. told a prompt\n2. told a prompt\n3. ended 2",
		});
	});
});
