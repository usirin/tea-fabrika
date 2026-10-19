import {describe, expect, it} from "vitest";
import type {ShipCmd} from "../stages/ship/machine.ts";
import * as build from "./build.ts";
import {
	explore,
	follow,
	type Law,
	pathText,
	type Report,
	type Update,
	type World,
} from "./explore.ts";
import * as loop from "./loop.ts";
import * as review from "./review.ts";
import * as ship from "./ship.ts";

// Every law on the real machines, walked to a small bound, and every planted
// mistake caught. A law the real code breaks is pinned here as a finding,
// with its shortest breaking sequence: the test fails the day that changes,
// either way. Longer runs and the blowup tables are in experiment 90's script.

/** Each broken law, by name, as its shortest breaking sequence. */
const broken = <M>(r: Report<M>, show: (m: M) => string): Record<string, string> =>
	Object.fromEntries(r.broken.map((b) => [b.law, pathText(b.path, show)]));

const runner =
	<S, M extends {readonly type: string}, C>(
		init: S,
		laws: () => readonly Law<S, M, C>[],
		show: (m: M) => string,
	) =>
	(update: Update<S, M, C>, world: World<S, M, C>, depth: number) => {
		const r = explore({init, update, world, laws: laws(), depth});
		return {report: r, broken: broken(r, show)};
	};

describe("ship", () => {
	const run = runner(ship.shipInit, ship.shipLaws, ship.showShipMsg);

	it("holds every law in every order up to 8 messages", () => {
		expect(run(ship.shipStep, ship.shipWorld(), 8).broken).toEqual({});
	});

	it("regression: a failed review beside a passed one is not shipped (was experiment 90's 2-message break)", () => {
		const path = follow(
			{init: ship.shipInit, update: ship.shipStep, world: ship.shipWorld(), laws: ship.shipLaws()},
			ship.showShipMsg,
			["start", "read at A: review-doc failed"],
		);
		expect(path.broken).toEqual([]);
		expect(path.state).toMatchObject({
			phase: "over",
			outcome: {kind: "send", to: "builder", why: "review_failed"},
		});
	});

	it("catches each planted mistake in a few messages", () => {
		const keeping = runner<ship.Keeping, ship.AnyShipMsg, ShipCmd>(
			ship.shipInit,
			ship.shipLaws,
			ship.showShipMsg,
		);
		const caught = (update: Update<ship.Keeping, ship.AnyShipMsg, ShipCmd>) =>
			keeping(update, ship.shipWorld(), 6).broken;
		expect(caught(ship.forgetsMissingReview)).toMatchObject({
			"merge only when the last read shows it ready": "1. start\n2. read at A: review-code missing",
		});
		expect(caught(ship.skipsTheRead)).toMatchObject({
			"merge only when the last read shows it ready":
				"1. start\n2. read at A: checks pending\n3. ship_checks at A",
		});
		expect(caught(ship.keepsAnOldPass)).toMatchObject({
			"a review pass for another head never counts":
				"1. start\n2. read at A: ready\n3. ship_enqueue_ok head_moved\n4. read at B: review-code failed",
		});
		expect(caught(ship.landsAnyHead)).toMatchObject({
			"only the head that was sent to the queue lands":
				"1. start\n2. read at A: ready\n3. ship_enqueue_ok queued\n4. queue says landed at B",
		});
		expect(caught(ship.actsAfterTheEnd)).toMatchObject({
			"an ended run sends nothing":
				"1. start\n2. read at A: review-code failed\n3. restart, then resume",
		});
	});
});

describe("review", () => {
	const run = runner(review.reviewInit, review.reviewLaws, review.showReviewMsg);
	const limit = {
		"a pass with a named limit leaves the criterion open":
			'1. start\n2. pack at A: checks green, deviations none\n3. form "pass with a limit" from A run 1',
	};

	it("holds every law in every order up to 6 messages", () => {
		expect(run(review.reviewStep, review.reviewWorld(), 6).broken).toEqual({});
	});

	it("regression: a pass with a named limit leaves the criterion open (was experiment 90's 3-message break)", () => {
		const path = follow(
			{
				init: review.reviewInit,
				update: review.reviewStep,
				world: review.reviewWorld(),
				laws: review.reviewLaws(),
			},
			review.showReviewMsg,
			[
				"start",
				"pack at A: checks green, deviations none",
				'form "pass with a limit" from A run 1',
			],
		);
		expect(path.broken).toEqual([]);
		// The form is refused and sent back: nothing is met on it.
		expect(path.state).toMatchObject({phase: "reviewing", run: 2, tries: 2});
		expect(run(review.limitIsAPass, review.reviewWorld(), 6).broken).toMatchObject(limit);
	});

	it("catches each planted mistake in three messages", () => {
		const caught = (update: typeof review.reviewStep) =>
			run(update, review.reviewWorld(), 6).broken;
		expect(caught(review.unseenIsMet)).toMatchObject({
			"done only when every criterion passed at the head, with checks green":
				'1. start\n2. pack at A: checks green, deviations none\n3. form "unseen 2" from A run 1',
		});
		expect(caught(review.takesAnyHead)).toMatchObject({
			"a form for another head or an old run never counts":
				'1. start\n2. pack at A: checks green, deviations none\n3. form "pass" from B run 1',
		});
		expect(caught(review.deviationExcuses)).toMatchObject({
			"the builder's text never changes a criterion or the outcome":
				'1. start\n2. pack at A: checks green, deviations listed\n3. form "fail 1" from A run 1',
		});
		expect(caught(review.rewordsFromDeviations)).toMatchObject({
			"a criterion's words are the ticket's":
				'1. start\n2. pack at A: checks green, deviations listed\n3. form "pass" from A run 1',
		});
		expect(caught(review.actsAfterTheEnd)).toMatchObject({
			"an ended review sends nothing":
				"1. start\n2. pack at A: checks red, deviations none\n3. restart, then resume",
		});
	});
});

describe("build", () => {
	const run = runner(build.buildInit, build.buildLaws, build.showBuildMsg);
	const search = {
		init: build.buildInit,
		update: build.buildStep,
		world: build.buildWorld(),
		laws: build.buildLaws(),
	};
	const opened = (name: string) => [
		"start",
		"ticket read: open, 0 pull request(s)",
		"build_copy_ok",
		`builder hands back "${name}" (run 1)`,
		"pushed A",
	];

	it("holds every law in every order, and the search ends", () => {
		const {report, broken} = run(build.buildStep, build.buildWorld(), 10);
		expect({broken, complete: report.complete}).toEqual({broken: {}, complete: true});
	});

	it.each(["names another ticket", "closes in its lists"])(
		"regression: a builder's %s closes nothing (was experiment 90's 5-message break)",
		(name) => {
			const path = follow(search, build.showBuildMsg, opened(name));
			expect(path.broken).toEqual([]);
			expect(path.state.phase).toBe("opening");
		},
	);

	it("reads the closing words the way GitHub does", () => {
		expect(build.closes("Closes #1\n\nOpens the windows. Also fixes #2, resolved #3.")).toEqual([
			"#1",
			"#2",
			"#3",
		]);
		expect(
			build.closes("Fixes: GH-5. Closed a/b#6, resolves https://github.com/a/b/issues/7, FIX #8"),
		).toEqual(["#5", "#8", "a/b#6", "a/b#7"]);
		expect(build.closes("Refs #4. Fixing #5 later. prefixes #6. Closes #9x")).toEqual([]);
	});

	it("catches each planted mistake", () => {
		const caught = (update: typeof build.buildStep) => run(update, build.buildWorld(), 6).broken;
		expect(caught(build.leftDescopes)).toMatchObject({
			"a builder's form never changes a criterion":
				'1. start\n2. ticket read: open, 0 pull request(s)\n3. build_copy_ok\n4. builder hands back "left criterion 2" (run 1)',
		});
		expect(caught(build.actsAfterTheEnd)).toMatchObject({
			"an ended build sends nothing":
				"1. start\n2. ticket read: closed, 0 pull request(s)\n3. restart, then resume",
		});
	});
});

describe("operate loop", () => {
	const run = runner(loop.loopInit, loop.loopLaws, loop.showLoopMsg);
	const search = (world = loop.loopWorld()) => ({
		init: loop.loopInit,
		update: loop.loopStep,
		world,
		laws: loop.loopLaws(),
	});
	/** Round 1 builds A and its review sends it back: round 2's build is asked for. */
	const sentBack = [
		"start, cap 2 rounds",
		"build (round 1): done at A",
		"review (round 1): send:builder:review_failed at A, 1 open",
		"verdicts posted (round 1)",
	];

	it("holds every law in every order up to 12 messages, and the search ends", () => {
		const {report, broken} = run(loop.loopStep, loop.loopWorld(), 12);
		expect({broken, complete: report.complete}).toEqual({broken: {}, complete: true});
		expect(run(loop.loopStep, loop.loopWorld({heads: ["A"]}), 12).broken).toEqual({});
	});

	it("regression: a pass at another head is not shipped (was experiment 90's 4-message break)", () => {
		const path = follow(search(), loop.showLoopMsg, [
			"start, cap 1 rounds",
			"build (round 1): done at A",
			"review (round 1): done at B, 0 open",
			"verdicts posted (round 1)",
		]);
		expect(path.broken).toEqual([]);
		expect(path.state).toMatchObject({
			phase: "over",
			outcome: {kind: "stuck", why: "review"},
			said: "the review passed B, and this round built A",
		});
	});

	it("holds every law with late and repeated answers, up to 6 messages", () => {
		// Deeper runs are in experiment 90's script: depth 8 takes seconds.
		expect(run(loop.loopStep, loop.loopWorld({echoes: true}), 6).broken).toEqual({});
	});

	it("regression: round 1's build answer, come again, is not round 2's (was experiment 90's 5-message break)", () => {
		const path = follow(search(loop.loopWorld({echoes: true})), loop.showLoopMsg, [
			...sentBack,
			"build (round 1): done at A",
		]);
		expect(path.broken).toEqual([]);
		// Still waiting on round 2's build, as asked.
		expect(path.state).toMatchObject({phase: "building", round: 2});
	});

	it("catches each planted mistake", () => {
		const caught = (update: typeof loop.loopStep, world = loop.loopWorld(), depth = 6) =>
			run(update, world, depth).broken;
		expect(caught(loop.stuckIsPassed)).toMatchObject({
			"ship only on a passed review of the head this round built":
				"1. start, cap 1 rounds\n2. build (round 1): done at A\n3. review (round 1): stuck:unseen at A, 1 open\n4. verdicts posted (round 1)",
		});
		expect(caught(loop.forgetsTheOpenList)).toMatchObject({
			"the builder never sets what the next round is told is open":
				"1. start, cap 2 rounds\n2. build (round 1): done at A\n3. review (round 1): send:builder:review_failed at A, 1 open\n4. verdicts posted (round 1)",
		});
		expect(caught(loop.ignoresTheCap)).toMatchObject({
			"no round passes the cap":
				"1. start, cap 1 rounds\n2. build (round 1): done at A\n3. review (round 1): send:builder:review_failed at A, 1 open\n4. verdicts posted (round 1)",
		});
		expect(caught(loop.actsAfterTheEnd)).toMatchObject({
			"an ended loop sends nothing":
				"1. start, cap 1 rounds\n2. build (round 1): stuck:draft_failed\n3. restart, then resume",
		});
		expect(caught(loop.stallOffByOne, loop.loopWorld({caps: [3]}), 8)).toMatchObject({
			"a review that leaves no fewer open never starts another build":
				"1. start, cap 3 rounds\n2. build (round 1): done at A\n3. review (round 1): send:builder:review_failed at A, 1 open\n4. verdicts posted (round 1)\n5. build (round 2): done at A\n6. review (round 2): send:builder:review_failed at A, 1 open\n7. verdicts posted (round 2)",
		});
		expect(caught(loop.takesAnyAnswer, loop.loopWorld({echoes: true}), 5)).toMatchObject({
			"an answer counts only for the stage asked now":
				"1. start, cap 2 rounds\n2. build (round 1): done at A\n3. review (round 1): send:builder:review_failed at A, 1 open\n4. verdicts posted (round 1)\n5. build (round 1): done at A",
		});
	});
});
