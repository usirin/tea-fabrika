import {describe, expect, it} from "vitest";
import {explore, follow, type Law, pathText, type Update, type World} from "./explore.ts";
import * as queue from "./queue.ts";
import * as refine from "./refine.ts";
import * as session from "./session.ts";
import * as transcript from "./transcript.ts";

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

describe("acp transcript", () => {
	const parts = {
		init: transcript.transcriptInit,
		world: transcript.transcriptWorld(),
		laws: transcript.transcriptLaws,
		show: transcript.showTranscriptMsg,
	};
	const walk = (lines: readonly string[]) =>
		follow(
			{init: parts.init, update: transcript.transcriptStep, world: parts.world, laws: parts.laws()},
			parts.show,
			lines,
		);

	it("regression: a finished tool call never shows as running again", () => {
		const late = walk(["tool_update t1 completed", "tool t1 pending"]);
		expect(late.broken).toEqual([]);
		expect(late.state.tools).toMatchObject([{id: "t1", status: "completed"}]);
		const stale = walk([
			"tool t1 pending",
			"tool_update t1 completed",
			"tool_update t1 in_progress",
		]);
		expect(stale.broken).toEqual([]);
		expect(stale.state.tools).toMatchObject([{id: "t1", status: "completed"}]);
	});

	it("catches each planted mistake in a few messages", () => {
		expect(caught(parts, transcript.countsAStrayAnswer, 4)).toMatchObject({
			"every ask is answered once: open, or counted once by how it was answered": "1. answered q1",
		});
		expect(caught(parts, transcript.overwritesTheLast, 4)).toMatchObject({
			"what a person was shown is never taken back": '1. agent says "x"\n2. turn 1',
		});
	});
});

describe("refine", () => {
	const parts = {
		init: refine.refineInit,
		world: refine.refineWorld(),
		laws: refine.refineLaws,
		show: refine.showRefineMsg,
	};

	it("regression: a late repeat of an earlier write's answer is not taken as the next try's draft", () => {
		const path = follow(
			{
				init: parts.init,
				update: refine.refineStep,
				world: refine.refineWorld({echoes: true}),
				laws: parts.laws(),
			},
			parts.show,
			[
				"start",
				'"bad" for the write first asked',
				'problems for the check of "bad"',
				'"bad" for the write first asked',
			],
		);
		expect(path.broken).toEqual([]);
		// Still waiting on the second try's own answer.
		expect(path.state).toMatchObject({phase: "writing", tries: 2});
	});

	it("catches each planted mistake in a few messages", () => {
		expect(caught(parts, refine.passesUnchecked, 4)).toMatchObject({
			"done with a verdict only when it found no problem, and without one only when the parent accepted":
				'1. start\n2. "good" for the write first asked\n3. draft_check_err for the check of "good"',
		});
		expect(caught(parts, refine.retriesPastTheLimit, 7)).toMatchObject({
			"tries never pass the limit":
				'1. start\n2. "bad" for the write first asked\n3. problems for the check of "bad"\n4. "bad" for the write asked again\n5. problems for the check of "bad"\n6. parent: retry',
		});
		expect(caught(parts, refine.actsAfterTheEnd, 4)).toMatchObject({
			"a done run sends nothing":
				'1. start\n2. "good" for the write first asked\n3. passes for the check of "good"\n4. resume',
		});
	});
});
