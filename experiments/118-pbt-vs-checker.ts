// Experiment 118: can property tests on the real code replace our own model checkers?
//
// For every planted mistake our checkers catch today (explore.ts for one machine,
// world/search.ts for many), the same real reducer, the same laws and the same world are walked
// by a property test instead (packages/pipeline/src/laws/walk.ts and sample.ts): random choices among the
// world's own moves, drawn and shrunk by Effect's Arbitrary. Each plant gets a fixed budget on
// 5 seeds; then the real machines, with no plant, are walked deeper than our checker's bound.
//
// Run with
//   node experiments/118-pbt-vs-checker.ts
//   BUDGET_MS=10000 SEEDS=1,2,3,4,5 ONLY=<group,group,deep> DEEP_MS=10000 DEEP=0 node experiments/118-pbt-vs-checker.ts
//
// One run per seed with the long budget (10 s). A seed counts as caught at 1 s when that run
// caught it within 1,000 ms: the inputs drawn are the same, only the clock differs.
// No model, no key, no network. Writes results/118-pbt-vs-checker.json.

import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {
	createHost,
	type Host,
	type HostCmd,
	type HostMsg,
	Monitor,
	NOT_BEGUN,
	START,
} from "@kampus/fabrika";
import * as agent from "@kampus/pipeline/laws/agent";
import * as build from "@kampus/pipeline/laws/build";
import * as catchup from "@kampus/pipeline/laws/catchup";
import * as runs from "@kampus/pipeline/laws/check-runs";
import * as criteria from "@kampus/pipeline/laws/criteria";
import {explore, type Law, stepOf, type Update, type World} from "@kampus/pipeline/laws/explore";
import * as lane from "@kampus/pipeline/laws/lane";
import * as loop from "@kampus/pipeline/laws/loop";
import * as plan from "@kampus/pipeline/laws/plan";
import * as queue from "@kampus/pipeline/laws/queue";
import * as refine from "@kampus/pipeline/laws/refine";
import * as review from "@kampus/pipeline/laws/review";
import {CHOICE, type Sampled, sample} from "@kampus/pipeline/laws/sample";
import * as session from "@kampus/pipeline/laws/session";
import * as ship from "@kampus/pipeline/laws/ship";
import {forgetsMissingReview} from "@kampus/pipeline/laws/ship";
import * as sort from "@kampus/pipeline/laws/sort";
import * as task from "@kampus/pipeline/laws/task";
import * as host from "@kampus/pipeline/laws/tea-host";
import * as transcript from "@kampus/pipeline/laws/transcript";
import {
	ENDS,
	type Machine,
	type Walked,
	walk,
	walkEnds,
	walkWorld,
} from "@kampus/pipeline/laws/walk";
import {hostedWorld, notWaitingOnAChild} from "@kampus/pipeline/laws/world/hosted";
import {type LanesOptions, lanesWorld, REAL} from "@kampus/pipeline/laws/world/lanes";
import {
	askLeavesByAnAnswer,
	asksReachTheOwner,
	deskWorld,
	dropsAnAskOnProgress,
	ignoresAFailedPost,
	LANE_LAWS,
	mergesPastTheQueue,
	oneLaneATicket,
	onlyPassedLands,
	testedWithMain,
	waitsForEver,
} from "@kampus/pipeline/laws/world/laws";
import {type Safety, type System, search} from "@kampus/pipeline/laws/world/search";
import {Arbitrary, Effect, FileSystem, Path} from "effect";

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const BUDGET_MS = Number(env("BUDGET_MS", "10000"));
const SHORT_MS = 1000;
const SEEDS = env("SEEDS", "1,2,3,4,5").split(",").map(Number);
const ONLY = env("ONLY", "")
	.split(",")
	.filter((x) => x !== "");
const DEEP = env("DEEP", "1") !== "0";
const DEEP_MS = Number(env("DEEP_MS", "10000"));
const HERE = import.meta.dirname;
const OUT = `${HERE}/results/118-pbt-vs-checker.json`;

/** The longest walk a property test draws: one machine, a world, and "every lane ends". */
const ONE_LENGTH = 60;
const WORLD_LENGTH = 150;
const ENDS_LIMIT = 400;

// ---------------------------------------------------------------- the plants

/** Our checker on one plant: caught, how long its shortest bad run is, and the time it took. */
interface Ours {
	readonly caught: boolean;
	readonly length: number | null;
	readonly ms: number;
	readonly states: number;
}

interface Plant {
	readonly group: string;
	readonly name: string;
	readonly law: string;
	/** Our checker's depth bound in the test that catches it. */
	readonly depth: number;
	/** Where it comes from: a planted mistake, or a real break replayed as one. */
	readonly kind: "plant" | "real";
	readonly ours: () => Ours;
	readonly walk: (choices: readonly number[]) => Walked;
	/** The same walk with swarm testing on: one machine only. */
	readonly swarm: ((choices: readonly number[]) => Walked) | null;
	readonly length: number;
}

const one = <S, M extends {readonly type: string}, C>(
	group: string,
	name: string,
	parts: {
		readonly init: S;
		readonly world: World<S, M, C>;
		readonly laws: () => readonly Law<S, M, C>[];
		readonly show: (m: M) => string;
	},
	update: Update<S, M, C>,
	law: string,
	depth: number,
	kind: Plant["kind"] = "plant",
): Plant => {
	const machine: Machine<S, M, C> = {...parts, update};
	return {
		group,
		name,
		law,
		depth,
		kind,
		ours: () => {
			const r = explore({...parts, update, laws: parts.laws(), depth});
			const b = r.broken.find((x) => x.law === law);
			return {caught: b !== undefined, length: b?.path.length ?? null, ms: r.ms, states: r.states};
		},
		walk: (cs) => walk(machine, cs, law),
		swarm: (cs) => walk(machine, cs, law, true),
		length: ONE_LENGTH,
	};
};

const shipParts = {
	init: ship.shipInit as ship.Keeping,
	world: ship.shipWorld() as World<ship.Keeping, ship.AnyShipMsg, ship.ShipCmd>,
	laws: () => ship.shipLaws<ship.Keeping>(),
	show: ship.showShipMsg,
};
const reviewParts = {
	init: review.reviewInit,
	world: review.reviewWorld(),
	laws: review.reviewLaws,
	show: review.showReviewMsg,
};
const buildParts = {
	init: build.buildInit,
	world: build.buildWorld(),
	laws: build.buildLaws,
	show: build.showBuildMsg,
};
const loopParts = (world = loop.loopWorld(), laws = loop.loopLaws) => ({
	init: loop.loopInit,
	world,
	laws,
	show: loop.showLoopMsg,
});
const partsOf = <S, M, C>(
	init: S,
	world: World<S, M, C>,
	laws: () => readonly Law<S, M, C>[],
	show: (m: M) => string,
) => ({init, world, laws, show});

const showAny = (m: {readonly type: string}): string => JSON.stringify(m);

const ONE_MACHINE: readonly Plant[] = [
	one(
		"ship",
		"forgetsMissingReview",
		shipParts,
		ship.forgetsMissingReview,
		"merge only when the last read shows it ready",
		6,
	),
	one(
		"ship",
		"skipsTheRead",
		shipParts,
		ship.skipsTheRead,
		"merge only when the last read shows it ready",
		6,
	),
	one(
		"ship",
		"keepsAnOldPass",
		shipParts,
		ship.keepsAnOldPass,
		"a review pass for another head never counts",
		6,
	),
	one(
		"ship",
		"landsAnyHead",
		shipParts,
		ship.landsAnyHead,
		"only the head that was sent to the queue lands",
		6,
	),
	one(
		"ship",
		"takesAnOldVersion",
		shipParts,
		ship.takesAnOldVersion,
		"a merge carries a passing row per criterion, on its current version, at its head",
		6,
	),
	one("ship", "actsAfterTheEnd", shipParts, ship.actsAfterTheEnd, "an ended run sends nothing", 6),
	one(
		"review",
		"unseenIsMet",
		reviewParts,
		review.unseenIsMet,
		"done only when every criterion passed at the head, with checks green",
		6,
	),
	one(
		"review",
		"takesAnyHead",
		reviewParts,
		review.takesAnyHead,
		"a form for another head or an old run never counts",
		6,
	),
	one(
		"review",
		"deviationExcuses",
		reviewParts,
		review.deviationExcuses,
		"the builder's text never changes a criterion or the outcome",
		6,
	),
	one(
		"review",
		"rewordsFromDeviations",
		reviewParts,
		review.rewordsFromDeviations,
		"a criterion's id, version and words are the ticket's",
		6,
	),
	one(
		"review",
		"judgesTheFirstVersion",
		reviewParts,
		review.judgesTheFirstVersion,
		"a criterion's id, version and words are the ticket's",
		6,
	),
	one(
		"review",
		"actsAfterTheEnd",
		reviewParts,
		review.actsAfterTheEnd,
		"an ended review sends nothing",
		6,
	),
	one(
		"review",
		"limitIsAPass (90's 3-message break)",
		reviewParts,
		review.limitIsAPass,
		"a pass with a named limit leaves the criterion open",
		6,
		"real",
	),
	one(
		"build",
		"leftDescopes",
		buildParts,
		build.leftDescopes,
		"a builder's form never changes a criterion",
		6,
	),
	one(
		"build",
		"actsAfterTheEnd",
		buildParts,
		build.actsAfterTheEnd,
		"an ended build sends nothing",
		6,
	),
	one(
		"loop",
		"stuckIsPassed",
		loopParts(),
		loop.stuckIsPassed,
		"ship only on a passed review of the head this round built",
		7,
	),
	one(
		"loop",
		"forgetsTheOpenList",
		loopParts(),
		loop.forgetsTheOpenList,
		"the builder never sets what the next round is told is open",
		7,
	),
	one(
		"loop",
		"aCapPutBack",
		loopParts(),
		loop.aCapPutBack,
		"a round the stall rule does not ask the owner at never ends the loop: there is no cap",
		8,
	),
	one(
		"loop",
		"actsAfterTheEnd",
		loopParts(),
		loop.actsAfterTheEnd,
		"an ended loop sends nothing",
		7,
	),
	one(
		"loop",
		"stallOffByOne",
		loopParts(loop.loopWorld({reviews: 4, heads: ["A"], opens: [1]})),
		loop.stallOffByOne,
		"a round the stall rule asks the owner at never starts another build",
		12,
	),
	one(
		"loop",
		"stallOffByOne, every loop ends by round 3",
		loopParts(loop.loopWorld({reviews: 4, heads: ["A"], opens: [1]}), () => [
			...loop.loopLaws(),
			loop.endsBy(3),
		]),
		loop.stallOffByOne,
		"every loop ends by round 3",
		12,
	),
	one(
		"loop",
		"forgetsTheLowest",
		loopParts(loop.loopWorld({reviews: 7, heads: ["A"], opens: [1, 2]}), () => [
			...loop.loopLaws(),
			loop.endsBy(6),
		]),
		loop.forgetsTheLowest,
		"a round the stall rule asks the owner at never starts another build",
		21,
	),
	one(
		"loop",
		"takesAnyAnswer (90's 5-message echo break)",
		loopParts(loop.loopWorld({echoes: true})),
		loop.takesAnyAnswer,
		"an answer counts only for the stage asked now",
		6,
		"real",
	),
	one(
		"loop",
		"takesAnyClaim",
		loopParts(),
		loop.takesAnyClaim,
		"builds and ships only while it holds its ticket",
		7,
	),
	one(
		"loop",
		"keepsItsClaim",
		loopParts(),
		loop.keepsItsClaim,
		"a loop that may hold its ticket lets it go before it ends",
		7,
	),
	...(
		[
			["queuesTwice", queue.queuesTwice, "a value is on the queue once"],
			[
				"dropsTheWorked",
				queue.dropsTheWorked,
				"the value being worked stays first until its work ends",
			],
			["jumpsTheQueue", queue.jumpsTheQueue, "values are worked in the order told"],
			["forgetsTheTidy", queue.forgetsTheTidy, "work that ended is tidied before it is forgotten"],
		] as const
	).map(([name, update, law]) =>
		one(
			"queue",
			name,
			partsOf(queue.queueInit, queue.queueWorld(), queue.queueLaws, queue.showQueueMsg),
			update,
			law,
			4,
		),
	),
	one(
		"acp session",
		"endsTheLast",
		partsOf(
			session.sessionInit,
			session.sessionWorld(),
			session.sessionLaws,
			session.showSessionMsg,
		),
		session.endsTheLast,
		"a turn ends only for the prompt whose turn is running",
		4,
	),
	...(
		[
			[
				"countsAStrayAnswer",
				transcript.countsAStrayAnswer,
				"every ask is answered once: open, or counted once by how it was answered",
			],
			[
				"overwritesTheLast",
				transcript.overwritesTheLast,
				"what a person was shown is never taken back",
			],
		] as const
	).map(([name, update, law]) =>
		one(
			"acp transcript",
			name,
			partsOf(
				transcript.transcriptInit,
				transcript.transcriptWorld(),
				transcript.transcriptLaws,
				transcript.showTranscriptMsg,
			),
			update,
			law,
			4,
		),
	),
	...(
		[
			[
				"passesUnchecked",
				refine.passesUnchecked,
				"done with a verdict only when it found no problem, and without one only when the parent accepted",
				4,
			],
			["retriesPastTheLimit", refine.retriesPastTheLimit, "tries never pass the limit", 7],
			["actsAfterTheEnd", refine.actsAfterTheEnd, "a done run sends nothing", 4],
		] as const
	).map(([name, update, law, depth]) =>
		one(
			"refine",
			name,
			partsOf(refine.refineInit, refine.refineWorld(), refine.refineLaws, refine.showRefineMsg),
			update,
			law,
			depth,
		),
	),
	...(
		[
			[
				"doneWithQuestions",
				plan.doneWithQuestions,
				"done only with a plan the Check passes and nothing left to ask; asks only with questions",
			],
			["takesAnyRun", plan.takesAnyRun, "a planner Msg counts only for the run asked for"],
			[
				"dropsAFailedSpend",
				plan.dropsAFailedSpend,
				"every dollar the planner spent is in the report",
			],
		] as const
	).map(([name, update, law]) =>
		one(
			"plan",
			name,
			partsOf(plan.planInit, plan.planWorld(), plan.planLaws, plan.showPlanMsg),
			update,
			law,
			6,
		),
	),
	...(
		[
			["reusesIds", criteria.reusesIds, "an id is never given twice"],
			[
				"keysVerdictsByPlace",
				criteria.keysVerdictsByPlace,
				"an added criterion never moves another criterion's verdict",
			],
			[
				"rewordKeepsVersion",
				criteria.rewordKeepsVersion,
				"a reworded criterion is open until judged at its new version",
			],
			[
				"passCarriesOver",
				criteria.passCarriesOver,
				"a reworded criterion is open until judged at its new version",
			],
			["rewordRevives", criteria.rewordRevives, "a removed id never comes back"],
		] as const
	).map(([name, update, law]) =>
		one(
			"criteria book",
			name,
			partsOf(
				criteria.criteriaInit,
				criteria.criteriaWorld(),
				criteria.criteriaLaws,
				criteria.showCriteriaMsg,
			),
			update,
			law,
			4,
		),
	),
	...(
		[
			["filesUnderTheAskedHead", runs.filesUnderTheAskedHead],
			["firstRunWins", runs.firstRunWins],
		] as const
	).map(([name, update]) =>
		one(
			"local check runs",
			name,
			partsOf(runs.runsInit, runs.runsWorld(), runs.runsLaws, runs.showRunsMsg),
			update,
			"checks count only from a run at this exact head",
			3,
		),
	),
	...(
		[
			[
				"writesBeforeTheDoor",
				sort.writesBeforeTheDoor,
				"nothing is written before the ticket is read again, open and unchanged",
				6,
			],
			["takesAnyRun", sort.takesAnyRun, "a sorter Msg counts only for the run asked for", 6],
			[
				"leavesANoOpen",
				sort.leavesANoOpen,
				"an answer ends only once every write it makes went out",
				8,
			],
		] as const
	).map(([name, update, law, depth]) =>
		one(
			"sort",
			name,
			partsOf(sort.sortInit, sort.sortWorld(), sort.sortLaws, sort.showSortMsg),
			update,
			law,
			depth,
		),
	),
	...(
		[
			["rawSummary", task.rawSummary, "the commit closes no ticket"],
			[
				"pushesFromMain",
				task.pushesFromMain,
				"a push goes out only after the gate let the task through, from the base it read",
			],
		] as const
	).map(([name, update, law]) =>
		one(
			"plan task",
			name,
			partsOf(task.taskInit, task.taskWorld(), task.taskLaws, task.showTaskMsg),
			update,
			law,
			6,
		),
	),
	...(
		[
			[
				"pushesUnresolved",
				catchup.pushesUnresolved,
				"a push goes from the branch as read and takes in the main it read, or only reverts",
			],
			[
				"resolvesTheLockfile",
				catchup.resolvesTheLockfile,
				"the lockfile never goes to the resolver",
			],
		] as const
	).map(([name, update, law]) =>
		one(
			"plan catch-up",
			name,
			partsOf(
				catchup.catchupInit,
				catchup.catchupWorld(),
				catchup.catchupLaws,
				catchup.showCatchupMsg,
			),
			update,
			law,
			6,
		),
	),
	...(
		[
			[
				"rawBody",
				lane.rawBody,
				lane.laneWorld(),
				"the pull request opens only at a met head that has main in, and closes exactly the plan's tickets",
				6,
			],
			[
				"opensBehind",
				lane.opensBehind,
				lane.laneWorld(),
				"the pull request opens only at a met head that has main in, and closes exactly the plan's tickets",
				6,
			],
			[
				"forgetsTheRound",
				lane.forgetsTheRound,
				lane.laneWorld({views: ["a task not done"]}),
				"a child's name always means the same job",
				14,
			],
			[
				"aCapPutBack(1)",
				lane.aCapPutBack(1),
				lane.laneWorld({views: ["a task not done"]}),
				"no count of the lane's own ends it: only a read, a child stuck or a failed write does",
				12,
			],
			[
				"forgetsTheLastReviews",
				lane.forgetsTheLastReviews,
				lane.laneWorld({views: ["not met"]}),
				"every review, and every ship run that did not merge, is counted for the stall rule with what it left open",
				8,
			],
		] as const
	).map(([name, update, world, law, depth]) =>
		one(
			"plan lane",
			name,
			partsOf(lane.laneInit, world, lane.laneLaws, lane.showLaneMsg),
			update,
			law,
			depth,
		),
	),
];

const WATCHER_INIT: host.Watcher = {monitors: Monitor.noMonitors, last: null};

const TEA_HOST: readonly Plant[] = [
	...host.HOST_PLANTED.map((p) =>
		one(
			"tea-host: host",
			p.name,
			{
				init: START,
				world: host.hostWorld(),
				laws: () => host.hostLaws(p.view),
				show: host.showHostMsg,
			},
			p.update,
			p.law,
			8,
		),
	),
	...host.CALLER_PLANTED.map((p) =>
		one(
			"tea-host: call",
			p.name,
			partsOf(host.callerInit, host.callerWorld(), host.callerLaws, host.showCallerMsg),
			p.update,
			p.law,
			6,
		),
	),
	...host.SUPERVISOR_PLANTED.map((p) =>
		one(
			"tea-host: supervisor",
			`${p.name} (${p.strategy})`,
			partsOf(NOT_BEGUN, host.supervisorWorld(), () => host.supervisorLaws(p.strategy), showAny),
			p.update,
			p.law,
			5,
		),
	),
	...host.WATCHER_PLANTED.map((p) =>
		one(
			"tea-host: monitor",
			p.name,
			partsOf(WATCHER_INIT, host.watcherWorld(), host.watcherLaws, showAny),
			p.update,
			p.law,
			7,
		),
	),
];

// ---------------------------------------------------------------- the world plants

const WORLD_DEPTH = 200;

const safety = <W, N>(
	name: string,
	sys: System<W, N>,
	laws: readonly Safety<W, N>[],
	law: string,
	kind: Plant["kind"] = "plant",
	depth = WORLD_DEPTH,
): Plant => ({
	group: "world",
	name,
	law,
	depth,
	kind,
	ours: () => {
		const r = search(sys, {laws, depth});
		const b = r.broken.find((x) => x.law === law);
		return {caught: b !== undefined, length: b?.path.length ?? null, ms: r.ms, states: r.states};
	},
	walk: (cs) => walkWorld(sys, laws, cs, law),
	swarm: null,
	length: WORLD_LENGTH,
});

const ends = <W, N>(
	name: string,
	sys: System<W, N>,
	kind: Plant["kind"] = "plant",
	depth = WORLD_DEPTH,
): Plant => ({
	group: "world ends",
	name,
	law: ENDS,
	depth,
	kind,
	ours: () => {
		const r = search(sys, {laws: [], depth, eventually: true});
		const lasso = r.lassos?.[0];
		const dead = r.dead?.[0];
		const length =
			lasso !== undefined
				? lasso.prefix.length + lasso.cycle.length
				: dead !== undefined
					? dead.path.length
					: null;
		return {caught: length !== null, length, ms: r.ms, states: r.states};
	},
	walk: (cs) => walkEnds(sys, cs, ENDS_LIMIT),
	swarm: null,
	length: WORLD_LENGTH,
});

const TWO: LanesOptions = {lanes: 2, tickets: "own", queue: true, forms: ["pass", "fail 1"]};
const ONE: LanesOptions = {...TWO, lanes: 1};
const SAME: LanesOptions = {...TWO, tickets: "same", forms: ["pass"]};
const SAME_FAIL: LanesOptions = {...TWO, tickets: "same", fails: 1};
const SAME_FAIL_ONCE: LanesOptions = {...SAME_FAIL, reviews: 1};
const NO_QUEUE: LanesOptions = {...TWO, queue: false};

const WORLD: readonly Plant[] = [
	safety(
		"no claim at all",
		lanesWorld({...SAME, claim: "none"}),
		LANE_LAWS,
		oneLaneATicket.name,
		"real",
	),
	safety(
		"a claim read, then written",
		lanesWorld({...SAME, claim: "read_then_write"}),
		LANE_LAWS,
		oneLaneATicket.name,
	),
	safety(
		"a merge door blind to main, no queue",
		lanesWorld({...NO_QUEUE, door: "no_main"}),
		LANE_LAWS,
		testedWithMain.name,
		"real",
	),
	safety(
		"no merge door, no queue",
		lanesWorld({...NO_QUEUE, door: "none"}),
		LANE_LAWS,
		testedWithMain.name,
		"real",
	),
	safety(
		"ship merges past the queue, no door",
		lanesWorld({...TWO, fails: 1, steps: {...REAL, ship: mergesPastTheQueue}, door: "none"}),
		LANE_LAWS,
		testedWithMain.name,
	),
	safety(
		"no claim, no door: a failed head lands",
		lanesWorld({...SAME_FAIL_ONCE, claim: "none", door: "none"}),
		LANE_LAWS,
		onlyPassedLands.name,
	),
	safety(
		"no claim, with the door: a failed head lands",
		lanesWorld({...SAME_FAIL_ONCE, claim: "none"}),
		LANE_LAWS,
		onlyPassedLands.name,
	),
	safety(
		"ship takes a missing review as passed, no claim, no door",
		lanesWorld({
			...SAME,
			claim: "none",
			steps: {...REAL, ship: forgetsMissingReview},
			door: "none",
		}),
		LANE_LAWS,
		onlyPassedLands.name,
	),
	safety(
		"asksAtTheFirstStall (91's real gap)",
		lanesWorld({...ONE, desk: true, steps: {...REAL, loop: loop.asksAtTheFirstStall}}),
		[asksReachTheOwner],
		asksReachTheOwner.name,
		"real",
	),
	safety(
		"a desk drops a stuck ask on progress",
		deskWorld({rounds: 5, counts: [0, 1, 2], fold: dropsAnAskOnProgress}),
		[askLeavesByAnAnswer],
		askLeavesByAnAnswer.name,
		"plant",
		50,
	),
	ends(
		"waitsForEver: flaky CI waited on for good",
		lanesWorld({...ONE, flaky: true, steps: {...REAL, ship: waitsForEver}}),
	),
	ends(
		"ignoresAFailedPost: a dead state",
		lanesWorld({...ONE, errors: true, steps: {...REAL, loop: ignoresAFailedPost}}),
	),
	ends(
		"the hosted lane today (115's hang), every lane ends",
		hostedWorld({sub: "today"}),
		"real",
		400,
	),
	ends(
		"the hosted lane today (115's hang), every child ends",
		hostedWorld({sub: "today"}, notWaitingOnAChild),
		"real",
		400,
	),
];

const PLANTS = [...ONE_MACHINE, ...TEA_HOST, ...WORLD].filter(
	(p) => ONLY.length === 0 || ONLY.includes(p.group),
);

// ---------------------------------------------------------------- deeper, no plant

interface Deep {
	readonly name: string;
	readonly depth: number;
	readonly length: number;
	readonly walk: (choices: readonly number[]) => Walked;
}

const deepOne = <S, M extends {readonly type: string}, C>(
	name: string,
	machine: Machine<S, M, C>,
	depth: number,
): Deep => ({name, depth, length: 250, walk: (cs) => walk(machine, cs)});

const realHost = stepOf<Host, HostMsg, HostCmd>(createHost({renewEveryMs: 300, retryMs: 50}));

const DEEPS: readonly Deep[] = [
	deepOne("ship", {...shipParts, update: ship.shipStep}, 20),
	deepOne("review", {...reviewParts, update: review.reviewStep}, 14),
	deepOne("build", {...buildParts, update: build.buildStep}, 10),
	deepOne("loop", {...loopParts(loop.loopWorld({reviews: 2})), update: loop.loopStep}, 14),
	deepOne("loop, echoes", {...loopParts(loop.loopWorld({echoes: true})), update: loop.loopStep}, 7),
	deepOne(
		"loop, 6 reviews",
		{...loopParts(loop.loopWorld({reviews: 6})), update: loop.loopStep},
		0,
	),
	deepOne(
		"queue",
		{
			...partsOf(queue.queueInit, queue.queueWorld(), queue.queueLaws, queue.showQueueMsg),
			update: queue.queueStep,
		},
		12,
	),
	deepOne(
		"hosted agent child",
		{
			...partsOf(agent.agentInit, agent.agentWorld(), agent.agentLaws, agent.showAgentMsg),
			update: agent.agentStep,
		},
		3,
	),
	deepOne(
		"acp session",
		{
			...partsOf(
				session.sessionInit,
				session.sessionWorld(),
				session.sessionLaws,
				session.showSessionMsg,
			),
			update: session.sessionStep,
		},
		10,
	),
	deepOne(
		"acp transcript",
		{
			...partsOf(
				transcript.transcriptInit,
				transcript.transcriptWorld(),
				transcript.transcriptLaws,
				transcript.showTranscriptMsg,
			),
			update: transcript.transcriptStep,
		},
		5,
	),
	deepOne(
		"refine, echoes",
		{
			...partsOf(
				refine.refineInit,
				refine.refineWorld({echoes: true}),
				refine.refineLaws,
				refine.showRefineMsg,
			),
			update: refine.refineStep,
		},
		8,
	),
	deepOne(
		"criteria book",
		{
			...partsOf(
				criteria.criteriaInit,
				criteria.criteriaWorld(),
				criteria.criteriaLaws,
				criteria.showCriteriaMsg,
			),
			update: criteria.criteriaStep,
		},
		5,
	),
	deepOne(
		"local check runs",
		{
			...partsOf(runs.runsInit, runs.runsWorld(), runs.runsLaws, runs.showRunsMsg),
			update: runs.runsStep,
		},
		3,
	),
	deepOne(
		"plan",
		{
			...partsOf(plan.planInit, plan.planWorld(), plan.planLaws, plan.showPlanMsg),
			update: plan.planStep,
		},
		12,
	),
	deepOne(
		"sort",
		{
			...partsOf(sort.sortInit, sort.sortWorld(), sort.sortLaws, sort.showSortMsg),
			update: sort.sortStep,
		},
		12,
	),
	deepOne(
		"plan task",
		{
			...partsOf(task.taskInit, task.taskWorld(), task.taskLaws, task.showTaskMsg),
			update: task.taskStep,
		},
		8,
	),
	deepOne(
		"plan catch-up",
		{
			...partsOf(
				catchup.catchupInit,
				catchup.catchupWorld(),
				catchup.catchupLaws,
				catchup.showCatchupMsg,
			),
			update: catchup.catchupStep,
		},
		8,
	),
	deepOne(
		"plan lane",
		{
			...partsOf(lane.laneInit, lane.laneWorld(), lane.laneLaws, lane.showLaneMsg),
			update: lane.laneStep,
		},
		8,
	),
	deepOne(
		"tea-host: host",
		{
			init: START,
			world: host.hostWorld(),
			laws: () => host.hostLaws(),
			show: host.showHostMsg,
			update: realHost,
		},
		9,
	),
	deepOne(
		"tea-host: call",
		{
			...partsOf(host.callerInit, host.callerWorld(), host.callerLaws, host.showCallerMsg),
			update: host.callerStep,
		},
		7,
	),
	deepOne(
		"tea-host: monitor",
		{
			...partsOf(WATCHER_INIT, host.watcherWorld(), host.watcherLaws, showAny),
			update: host.watcherStep,
		},
		7,
	),
	{
		name: "world: two lanes, own tickets, queue",
		depth: WORLD_DEPTH,
		length: 400,
		walk: (cs) => walkWorld(lanesWorld(TWO), LANE_LAWS, cs),
	},
	{
		name: "world: three lanes, own tickets, queue",
		depth: 0,
		length: 400,
		walk: (cs) => walkWorld(lanesWorld({...TWO, lanes: 3}), LANE_LAWS, cs),
	},
	{
		name: "world: two lanes, one ticket, may fail",
		depth: WORLD_DEPTH,
		length: 400,
		walk: (cs) => walkWorld(lanesWorld(SAME_FAIL), LANE_LAWS, cs),
	},
	{
		name: "world: two lanes, red CI, errors, flaky, a restart, an outsider",
		depth: 0,
		length: 400,
		walk: (cs) =>
			walkWorld(
				lanesWorld({...TWO, red: true, errors: true, flaky: true, restarts: 1, outsider: 1}),
				LANE_LAWS,
				cs,
			),
	},
	{
		name: "world: two lanes, every lane ends",
		depth: WORLD_DEPTH,
		length: 400,
		walk: (cs) => walkEnds(lanesWorld(TWO), cs, 1000),
	},
	{
		name: "world: one lane, flaky CI, every lane ends",
		depth: WORLD_DEPTH,
		length: 400,
		walk: (cs) => walkEnds(lanesWorld({...ONE, flaky: true}), cs, 1000),
	},
	{
		name: "world: the hosted lane, fixed Sub, every lane ends",
		depth: 400,
		length: 400,
		walk: (cs) => walkEnds(hostedWorld({sub: "fixed", errors: true}), cs, 1000),
	},
	{
		name: "world: the hosted lane, fixed Sub, no refusals, every child ends",
		depth: 400,
		length: 400,
		walk: (cs) => walkEnds(hostedWorld({sub: "fixed"}, notWaitingOnAChild), cs, 1000),
	},
];

// ---------------------------------------------------------------- run

/** One way of walking a plant, on every seed: how many caught at each budget, and how short. */
const score = (run: (choices: readonly number[]) => Walked, length: number) =>
	Effect.gen(function* () {
		const seeds: (Sampled & {readonly seed: number})[] = [];
		for (const seed of SEEDS) {
			const s = yield* sample(run, {ms: BUDGET_MS, seed, length});
			seeds.push({seed, ...s});
		}
		const caught = seeds.filter((s) => s.caught);
		const lengths = caught.map((s) => s.path?.length ?? 0);
		const times = caught.map((s) => s.ms);
		return {
			short: caught.filter((s) => s.ms <= SHORT_MS).length,
			long: caught.length,
			seeds: seeds.length,
			shrunk: lengths.length === 0 ? null : {min: Math.min(...lengths), max: Math.max(...lengths)},
			ms: times.length === 0 ? null : {min: Math.min(...times), max: Math.max(...times)},
			example: caught[0]?.path ?? null,
			runs: seeds.map((s) => ({
				seed: s.seed,
				caught: s.caught,
				ms: s.ms,
				runs: s.runs,
				length: s.path?.length ?? null,
			})),
		};
	});

const said = (s: Effect.Success<ReturnType<typeof score>>) =>
	`${s.short}/${s.seeds} at 1 s, ${s.long}/${s.seeds} at ${BUDGET_MS / 1000} s, shrunk ${s.shrunk === null ? "-" : `${s.shrunk.min}..${s.shrunk.max}`}`;

const runPlant = (p: Plant) =>
	Effect.gen(function* () {
		const ours = p.ours();
		const plain = yield* score(p.walk, p.length);
		// Swarm only where the plain walk missed on some seed at 1 s: it costs a whole budget per miss.
		const swarm =
			p.swarm === null || plain.short === plain.seeds ? null : yield* score(p.swarm, p.length + 1);
		console.log(
			`${p.group} / ${p.name}: ours ${ours.caught ? `caught at ${ours.length}` : "MISSED"}; property ${said(plain)}${swarm === null ? "" : `; swarm ${said(swarm)}`}`,
		);
		return {
			group: p.group,
			name: p.name,
			law: p.law,
			kind: p.kind,
			depth: p.depth,
			ours,
			plain,
			swarm,
		};
	});

const runDeep = (d: Deep) =>
	Effect.gen(function* () {
		const seeds = [];
		for (const seed of SEEDS) {
			const s = yield* sample(d.walk, {ms: DEEP_MS, seed, length: d.length});
			seeds.push({seed, caught: s.caught, ms: s.ms, runs: s.runs, path: s.path, why: s.why});
		}
		const found = seeds.filter((s) => s.caught);
		// How deep the walks went: 200 inputs drawn at the largest size, each walked.
		const drawn = yield* Arbitrary.sampleEffect(
			Arbitrary.array(Arbitrary.schema(CHOICE), {maxLength: d.length}),
			{count: 200, size: d.length * 4, seed: 118},
		);
		const steps = drawn.map((cs) => d.walk(cs).path.length).sort((a, b) => a - b);
		const walked = {
			median: steps[Math.floor(steps.length / 2)] ?? 0,
			max: steps.at(-1) ?? 0,
		};
		console.log(
			`deep ${d.name}: ${found.length}/${seeds.length} seeds broke a law${found[0] ? `: ${found[0].why} after ${found[0].path?.length} steps` : ""}; ${seeds.reduce((n, s) => n + s.runs, 0)} walks, steps median ${walked.median}, max ${walked.max}`,
		);
		return {name: d.name, ourDepth: d.depth, length: d.length, walked, seeds};
	});

const LINE_FILES = {
	ours: ["packages/pipeline/src/laws/explore.ts", "packages/pipeline/src/laws/world/search.ts"],
	property: ["packages/pipeline/src/laws/walk.ts", "packages/pipeline/src/laws/sample.ts"],
};

const main = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const root = path.resolve(HERE, "..");
	const lines: Record<string, number> = {};
	for (const f of [...LINE_FILES.ours, ...LINE_FILES.property])
		lines[f] = (yield* fs.readFileString(path.join(root, f))).trimEnd().split("\n").length;

	const started = performance.now();
	const plants = [];
	for (const p of PLANTS) plants.push(yield* runPlant(p));
	const deep = [];
	if (DEEP && (ONLY.length === 0 || ONLY.includes("deep")))
		for (const d of DEEPS) deep.push(yield* runDeep(d));

	const total = {
		plants: plants.length,
		ours: plants.filter((p) => p.ours.caught).length,
		/** Caught on every seed. */
		short: plants.filter((p) => p.plain.short === p.plain.seeds).length,
		long: plants.filter((p) => p.plain.long === p.plain.seeds).length,
		/** Caught on at least one seed. */
		shortAny: plants.filter((p) => p.plain.short > 0).length,
		longAny: plants.filter((p) => p.plain.long > 0).length,
		/** Caught on every seed by the plain walk, or else by the swarm walk. */
		shortWithSwarm: plants.filter(
			(p) =>
				p.plain.short === p.plain.seeds || (p.swarm !== null && p.swarm.short === p.swarm.seeds),
		).length,
		longWithSwarm: plants.filter(
			(p) => p.plain.long === p.plain.seeds || (p.swarm !== null && p.swarm.long === p.swarm.seeds),
		).length,
	};
	console.log(JSON.stringify(total));
	console.log(`lines ${JSON.stringify(lines)}`);
	console.log(`took ${Math.round((performance.now() - started) / 1000)} s`);
	yield* fs.writeFileString(
		OUT,
		`${JSON.stringify(
			{
				budgetMs: BUDGET_MS,
				shortMs: SHORT_MS,
				seeds: SEEDS,
				lengths: {one: ONE_LENGTH, world: WORLD_LENGTH, ends: ENDS_LIMIT},
				total,
				lines,
				plants,
				deep,
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(`wrote ${path.relative(root, OUT)}`);
});

// Node at this edge: the runtime runs the script, with Node's file system.
await Effect.runPromise(main.pipe(Effect.provide(nodeServices)));
