import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import type {Writer} from "@kampus/fabrika-old";
import {start} from "@kampus/fabrika-old";
import {fileStorage} from "@kampus/fabrika-old/storage/node";
import {type Cause, Effect, Fiber, Layer, Queue, Stream} from "effect";
import {layerLanes} from "../../asks/claims.ts";
import type {LocalCheck} from "../../code-host-local.ts";
import {ticketsOnLedger, watcherOnLedger} from "../../tickets/tickets.ts";
import {noFacts} from "../plan/services.ts";
import {ledgerPlans} from "../sort/services.ts";
import {laneAgents, laneBuilder, laneNow, lanePlanner, laneReviewer, laneSorter} from "./agents.ts";
import {brokeWords} from "./found.ts";
import {laneGitHubHost} from "./github.ts";
import {laneBuildHost, lanePlanHost, laneSortHost, laneSortWrites} from "./hosts.ts";
import {laneProgram} from "./program.ts";
import {laneLocalHost, lanePulls, laneRecord, laneWatch, localWire} from "./pulls.ts";
import {
	laneBuildWrites,
	laneExamWork,
	laneMutationRunner,
	laneMutationScope,
	lanePushWork,
	laneTestsAgents,
	laneTestsWork,
} from "./tools.ts";
import {LaneHome, LaneWork, laneWork} from "./work.ts";

// Every service a lane's steps use, for one run. `lane` writes as the agent it is, for the person
// who typed the line: its facts are the code's, and an answer it wrote would not count.

/** The checks a head must pass, as the repo's `fabrika.toml` names them. */
const checksFromSettings = Effect.gen(function* () {
	const work = yield* LaneWork;
	const settings = yield* work.settings;
	return (settings.checks?.run ?? []) as readonly LocalCheck[];
}).pipe(Effect.mapError(() => ({_tag: "unknown" as const})));

/**
 * The code host the checkout's origin names. A checkout with no origin gets the local one: it serves
 * nothing, since the lane's first read says what is missing and stops.
 */
const laneHost = Layer.unwrap(
	Effect.gen(function* () {
		const work = yield* LaneWork;
		const origin = yield* work.origin.pipe(Effect.orElseSucceed(() => null));
		return origin?.host === "github"
			? laneGitHubHost(origin.repo, checksFromSettings)
			: Layer.merge(laneLocalHost(checksFromSettings), localWire);
	}),
);

/** All of it. Needs only the app's `Ledger`. */
export const laneLayer = (home: LaneHome["Service"]) => {
	const writer: Writer = {kind: "agent", id: "lane", for: home.person};
	const first = Layer.mergeAll(
		Layer.succeed(LaneHome, home),
		ticketsOnLedger(writer),
		laneNow,
		layerLanes(),
	);
	const second = laneWork.pipe(Layer.provideMerge(first));
	const third = Layer.mergeAll(laneAgents, lanePulls, laneMutationRunner).pipe(
		Layer.provideMerge(second),
	);
	return Layer.mergeAll(
		lanePlanner,
		laneSorter,
		laneBuilder,
		laneReviewer,
		laneSortHost,
		laneSortWrites,
		ledgerPlans,
		lanePlanHost,
		noFacts,
		laneBuildHost,
		laneBuildWrites,
		laneTestsWork,
		laneTestsAgents,
		laneExamWork,
		lanePushWork,
		laneMutationScope,
		laneRecord,
		laneWatch,
	).pipe(
		Layer.provideMerge(laneHost),
		Layer.provideMerge(watcherOnLedger({kind: "agent", id: "watcher", for: home.person})),
		Layer.provideMerge(third),
		Layer.provideMerge(nodeServices),
	);
};

/** The lanes this process is running: a second line for one says so, and starts no second lane. */
const live = new Set<number>();

/**
 * Ticket `n`'s lane, kept under an id only the ticket names, so typing the line again finds it where
 * it stood. Each line it says goes to `say`, and the lane ends when it ends. A lane that ended on
 * anything says so again and runs nothing.
 */
export const runLane = (n: number, say: (line: string) => Effect.Effect<void>) =>
	Effect.gen(function* () {
		if (live.has(n)) {
			yield* say(`#${n} is already running in this app. Watch it with: runs --ticket ${n}`);
			return;
		}
		const {home} = yield* LaneHome;
		yield* Effect.acquireRelease(
			Effect.sync(() => live.add(n)),
			() => Effect.sync(() => live.delete(n)),
		);
		const lines = yield* Queue.unbounded<string, Cause.Done>();
		const heard = (line: string) => {
			Queue.offerUnsafe(lines, line);
		};
		const started = yield* start(
			laneProgram,
			{ticket: n},
			{
				step: heard,
				ended: (end) => heard(`#${n} ended: ${end.name}. ${end.said}`),
			},
			{id: `lane-${n}`, storage: fileStorage(`${home}/storage/lanes`)},
		);
		if (started.kind !== "running") return yield* Effect.die(started.why);
		const printing = yield* Stream.fromQueue(lines).pipe(Stream.runForEach(say), Effect.forkScoped);
		const end = yield* started.run.ended;
		// The lane's own end says itself, on `ended`. A run that broke past it has only this line.
		for (const line of brokeWords(n, end)) heard(line);
		yield* Queue.end(lines);
		yield* Fiber.await(printing);
	}).pipe(Effect.scoped);
