import {describe, expect, it} from "vitest";
import {MAX_WAITS as REVIEW_MAX_WAITS} from "../stages/review/machine.ts";
import {MAX_WAITS as SHIP_MAX_WAITS, type ShipCmd} from "../stages/ship/machine.ts";
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

	it("every run ends on its own: checks that keep restarting are waited on a counted number of times", () => {
		const settled = Array.from({length: SHIP_MAX_WAITS}, () => [
			"read at A: checks pending",
			"ship_checks at A",
		]).flat();
		const path = follow(
			{init: ship.shipInit, update: ship.shipStep, world: ship.shipWorld(), laws: ship.shipLaws()},
			ship.showShipMsg,
			["start", ...settled, "read at A: checks pending"],
		);
		expect(path.broken).toEqual([]);
		expect(path.state).toMatchObject({
			phase: "over",
			outcome: {kind: "stuck", why: "checks_stuck"},
		});
		// With the count, the whole space is walked: every law holds in every order, at any length.
		const {report, broken} = run(ship.shipStep, ship.shipWorld(), 2 * SHIP_MAX_WAITS + 20);
		expect({broken, complete: report.complete}).toEqual({broken: {}, complete: true});
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
		expect(caught(ship.takesAnOldVersion)).toMatchObject({
			"a merge carries a passing row per criterion, on its current version, at its head":
				"1. start\n2. read at A: c2 judged on v1",
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

	it("every run ends on its own: checks that keep restarting are waited on a counted number of times", () => {
		const settled = Array.from({length: REVIEW_MAX_WAITS}, () => [
			"pack at A: checks pending, deviations none",
			"checks settled at A",
		]).flat();
		const path = follow(
			{
				init: review.reviewInit,
				update: review.reviewStep,
				world: review.reviewWorld(),
				laws: review.reviewLaws(),
			},
			review.showReviewMsg,
			["start", ...settled, "pack at A: checks pending, deviations none"],
		);
		expect(path.broken).toEqual([]);
		expect(path.state).toMatchObject({
			phase: "over",
			outcome: {kind: "stuck", why: "checks_stuck"},
		});
		// With the count, the whole space is walked: every law holds in every order, at any length.
		const {report, broken} = run(review.reviewStep, review.reviewWorld(), 2 * REVIEW_MAX_WAITS + 8);
		expect({broken, complete: report.complete}).toEqual({broken: {}, complete: true});
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
			"a criterion's id, version and words are the ticket's":
				'1. start\n2. pack at A: checks green, deviations listed\n3. form "pass" from A run 1',
		});
		expect(caught(review.judgesTheFirstVersion)).toMatchObject({
			"a criterion's id, version and words are the ticket's":
				'1. start\n2. pack at A: checks green, deviations none\n3. form "pass" from A run 1',
		});
		expect(caught(review.actsAfterTheEnd)).toMatchObject({
			"an ended review sends nothing":
				"1. start\n2. pack at A: checks red, deviations none\n3. restart, then resume",
		});
		// Six whole searches, CPU-bound: about 3.8s on a 2-core CI runner that other test files share.
	}, 20_000);
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
		"start",
		"claim: taken",
		"build (round 1): done at A",
		"review (round 1): send:builder:review_failed at A, 1 open",
		"verdicts posted (round 1)",
	];

	it("holds every law in every order up to 14 messages, and the search ends", () => {
		const {report, broken} = run(loop.loopStep, loop.loopWorld(), 14);
		expect({broken, complete: report.complete}).toEqual({broken: {}, complete: true});
		expect(run(loop.loopStep, loop.loopWorld({heads: ["A"]}), 14).broken).toEqual({});
	});

	/** The loop's laws, and every loop ending by round `last`. */
	const ending = (last: number) =>
		runner(loop.loopInit, () => [...loop.loopLaws(), loop.endsBy(last)], loop.showLoopMsg);

	it("no cap: a list that never grows is ended by the stall rule alone, in every order", () => {
		// Bounded by the inputs, not a cap: the world answers reviews for one round past the last
		// the stall rule allows, so a loop that ran on would be seen. Reviews leave 1 open; a ship
		// that sends it back leaves 1. With at most 1 open, round 3 is the last (2 x 1 + 1).
		const world = loop.loopWorld({reviews: 4, heads: ["A"], opens: [1]});
		const {report, broken} = ending(3)(loop.loopStep, world, 20);
		expect({broken, complete: report.complete}).toEqual({broken: {}, complete: true});
		// Planted: a stall rule that never stalls on an equal count builds on past round 3.
		expect(ending(3)(loop.stallOffByOne, world, 12).broken).toMatchObject({
			"every loop ends by round 3":
				"1. start\n2. claim: taken\n3. build (round 1): done at A\n4. review (round 1): send:builder:review_failed at A, 1 open\n5. verdicts posted (round 1)\n6. build (round 2): done at A\n7. review (round 2): send:builder:review_failed at A, 1 open\n8. verdicts posted (round 2)\n9. build (round 3): done at A\n10. review (round 3): send:builder:review_failed at A, 1 open\n11. verdicts posted (round 3)",
		});
	});

	/** The messages of a loop whose round `i` review leaves `opens[i]` open, each round built at A and its verdicts posted. */
	const roundsOf = (opens: readonly number[]): string[] => [
		"start",
		"claim: taken",
		...opens.flatMap((open, i) => [
			`build (round ${i + 1}): done at A`,
			`review (round ${i + 1}): send:builder:review_failed at A, ${open} open`,
			`verdicts posted (round ${i + 1})`,
		]),
	];
	const numbered = (msgs: readonly string[]) => msgs.map((m, i) => `${i + 1}. ${m}`).join("\n");

	it("no cap: a list that grows and shrinks by turns is ended by the stall rule too, in every order", () => {
		// A list going 1, 2, 1, 2 never stalls twice in a row, but its third round with no new
		// lowest asks the owner. With at most 2 open, round 6 is the last (3 x 2; 2, 2, 1, 2, 1, 1
		// takes that long), and the world answers reviews for one round past it.
		const world = loop.loopWorld({reviews: 7, heads: ["A"], opens: [1, 2]});
		const {report, broken} = ending(6)(loop.loopStep, world, 26);
		expect({broken, complete: report.complete}).toEqual({broken: {}, complete: true});
		// Round 6 is needed: 2, 2, 1, 2, 1 asks nothing, so round 6 is started.
		expect(ending(5)(loop.loopStep, world, 17).broken).toEqual({
			"every loop ends by round 5": numbered(roundsOf([2, 2, 1, 2, 1])),
		});
		const path = follow(search(world), loop.showLoopMsg, [...roundsOf([1, 2, 1, 2]), "let go"]);
		expect(path.broken).toEqual([]);
		expect(path.state).toMatchObject({
			phase: "over",
			outcome: {kind: "ask", who: "owner", for: "no_progress"},
		});
		// Planted: a rule that never sees a lowest from before the last three rounds builds on
		// after 1, 2, 1, 1, whose third round with no new lowest asks the owner.
		expect(ending(6)(loop.forgetsTheLowest, world, 21).broken).toMatchObject({
			"a round the stall rule asks the owner at never starts another build": numbered(
				roundsOf([1, 2, 1, 1]),
			),
		});
	});

	it("regression: a pass at another head is not shipped (was experiment 90's 4-message break)", () => {
		const path = follow(search(), loop.showLoopMsg, [
			"start",
			"claim: taken",
			"build (round 1): done at A",
			"review (round 1): done at B, 0 open",
			"verdicts posted (round 1)",
			"let go",
		]);
		expect(path.broken).toEqual([]);
		expect(path.state).toMatchObject({
			phase: "over",
			outcome: {kind: "stuck", why: "review"},
			said: "the review passed B, and this round built A",
		});
	});

	it("one lane a ticket: held by another, it ends there, writes nothing, and has nothing to let go; else it lets go at the end, even when letting go fails", () => {
		const refused = follow(search(), loop.showLoopMsg, ["start", "claim: L2 holds it"]);
		expect(refused.state).toMatchObject({
			phase: "over",
			outcome: {kind: "skip", why: "claimed"},
			said: "L2 holds it",
		});
		const failed = follow(search(), loop.showLoopMsg, [
			"start",
			"claim: the ledger could not be asked",
		]);
		expect(failed.state).toMatchObject({
			phase: "releasing",
			outcome: {kind: "stuck", why: "claim"},
		});
		const ended = follow(search(), loop.showLoopMsg, [
			"start",
			"claim: taken",
			"build (round 1): stuck:draft_failed",
			"letting go failed",
		]);
		expect(ended.state).toMatchObject({phase: "over", outcome: {kind: "stuck", why: "build"}});
		expect([refused.broken, failed.broken, ended.broken]).toEqual([[], [], []]);
	});

	it("holds every law with late and repeated answers, up to 7 messages", () => {
		// Deeper runs are in experiment 90's script: depth 8 takes seconds.
		expect(run(loop.loopStep, loop.loopWorld({echoes: true}), 7).broken).toEqual({});
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
		const caught = (update: typeof loop.loopStep, world = loop.loopWorld(), depth = 7) =>
			run(update, world, depth).broken;
		expect(caught(loop.stuckIsPassed)).toMatchObject({
			"ship only on a passed review of the head this round built":
				"1. start\n2. claim: taken\n3. build (round 1): done at A\n4. review (round 1): stuck:unseen at A, 1 open\n5. verdicts posted (round 1)",
		});
		expect(caught(loop.forgetsTheOpenList)).toMatchObject({
			"the builder never sets what the next round is told is open":
				"1. start\n2. claim: taken\n3. build (round 1): done at A\n4. review (round 1): send:builder:review_failed at A, 1 open\n5. verdicts posted (round 1)",
		});
		// A cap put back: the loop stops at round 2 while its list still shrinks.
		expect(caught(loop.aCapPutBack, loop.loopWorld(), 8)).toMatchObject({
			"a round the stall rule does not ask the owner at never ends the loop: there is no cap":
				"1. start\n2. claim: taken\n3. build (round 1): done at A\n4. review (round 1): send:builder:review_failed at A, 1 open\n5. verdicts posted (round 1)\n6. build (round 2): done at A\n7. review (round 2): send:builder:review_failed at A, 1 open\n8. verdicts posted (round 2)",
		});
		expect(caught(loop.actsAfterTheEnd)).toMatchObject({
			"an ended loop sends nothing": "1. start\n2. claim: L2 holds it\n3. restart, then resume",
		});
		expect(
			caught(loop.stallOffByOne, loop.loopWorld({reviews: 4, heads: ["A"], opens: [1]}), 12),
		).toMatchObject({
			"a round the stall rule asks the owner at never starts another build":
				"1. start\n2. claim: taken\n3. build (round 1): done at A\n4. review (round 1): send:builder:review_failed at A, 1 open\n5. verdicts posted (round 1)\n6. build (round 2): done at A\n7. review (round 2): send:builder:review_failed at A, 1 open\n8. verdicts posted (round 2)\n9. build (round 3): done at A\n10. review (round 3): send:builder:review_failed at A, 1 open\n11. verdicts posted (round 3)",
		});
		expect(caught(loop.takesAnyAnswer, loop.loopWorld({echoes: true}), 6)).toMatchObject({
			"an answer counts only for the stage asked now":
				"1. start\n2. claim: taken\n3. build (round 1): done at A\n4. review (round 1): send:builder:review_failed at A, 1 open\n5. verdicts posted (round 1)\n6. build (round 1): done at A",
		});
		expect(caught(loop.takesAnyClaim)).toMatchObject({
			"builds and ships only while it holds its ticket": "1. start\n2. claim: L2 holds it",
		});
		expect(caught(loop.keepsItsClaim)).toMatchObject({
			"a loop that may hold its ticket lets it go before it ends":
				"1. start\n2. claim: the ledger could not be asked",
		});
	});
});
