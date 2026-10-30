import {
	defineProgram,
	ear,
	input,
	type Life,
	listing,
	memoryStorage,
	mortalDisk,
	output,
	pipe,
	type RunningOf,
	type RunOf,
	readFlags,
	type Storage,
	start,
	tell,
} from "@kampus/fabrika";
import {Deferred, Effect, Fiber, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {CriteriaRecord} from "../../criteria/record.ts";
import {verdictId} from "../../ids.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import type {PrFacts} from "./facts.ts";
import {launch, type Parts} from "./launch.ts";
import type {Look} from "./look.ts";
import {type Answer, keyOf, PullRequestUrl, type Shipped, shipProgram} from "./program.ts";
import {ON_TIP, provenAt, TICKET} from "./scripted.ts";

// The ship program, started from code the way a parent would start it: fake
// services as Layers, pull requests told on its input while it runs, and an
// outcome heard on the output for each one. The stand-in parent here is a few
// lines; `operate` is the real one, and is not wired to this yet.
//
// The ship machine takes one pull request per run (it ends at `over`), so the
// program starts a fresh one for each pull request it is told, one after
// another, inside one program run that keeps going until it is stopped, or
// until its input is closed and it has finished what it was told. First, the
// job a user has: `review | ship`, with a stand-in review program piped in.

const url = (n: number) => `https://github.com/example/repo/pull/${n}`;
/** A run started once and never again: it keeps its machines in memory, and says so. */
const kept = () => ({id: "ship:test", storage: memoryStorage()});

/** A pull request with nothing in its way, as the code host reads it. */
const clear: PrFacts = {
	head: "abc1234",
	state: "open",
	ours: true,
	ticket: {id: TICKET, link: "closes_it"},
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: ON_TIP,
};
const PART = {id: TICKET, link: "part_of_it"} as const;

/** How the fake world answers for one pull request. */
interface World {
	/** The facts every read gets. `fails`: the read breaks. */
	readonly facts: PrFacts | "fails";
	/** `no_queue`: the repository has no merge queue, and ship merges it straight in. */
	readonly enqueue?: "queued" | "conflicts" | "no_queue" | "fails";
	/** How a merge straight in goes. Left out, it merges. */
	readonly merge?: "merged" | "conflicts" | "fails";
	/** The queue holds it until this is done. Left out, it lands at once. */
	readonly hold?: Effect.Effect<void>;
	/** Checks run again settle once this is done. Left out, at once. */
	readonly settle?: Effect.Effect<void>;
	/**
	 * From this read of the ticket's record on (counted from 1), a later
	 * review's fail on c1 at the head stands in it, after the passes: another
	 * review of the same head, kept while ship was on its way to the write.
	 */
	readonly failsFrom?: number;
	/** From this read of the pull request on (counted from 1), the code host reads `facts` instead. */
	readonly later?: {readonly from: number; readonly facts: PrFacts};
}

/** Fake `CodeHost` and `CodeHostWrites` over a table of pull requests. `writes`: each write, in order. */
function fake(worlds: ReadonlyMap<string, World>) {
	const writes: string[] = [];
	const reads: string[] = [];
	/** How many times each ticket's record was read. */
	const recordReads = new Map<string, number>();
	const world = (pr: string): World => {
		const found = worlds.get(pr);
		if (found === undefined) throw new Error(`no world for ${pr}`);
		return found;
	};
	const broke = Effect.fail({_tag: "unknown" as const});
	const host = Layer.succeed(CodeHost, {
		pullRequests: () => Effect.succeed([]),
		prFacts: (pr) => {
			reads.push(pr);
			const {facts, later} = world(pr);
			const n = reads.filter((r) => r === pr).length;
			if (later !== undefined && n >= later.from) return Effect.succeed(later.facts);
			return facts === "fails" ? broke : Effect.succeed(facts);
		},
		change: () => broke,
		// The checks settle at once, or once `settle` is done; the facts read after say how they went.
		checksSettled: (pr) => Stream.fromEffect(world(pr).settle ?? Effect.void),
		leftQueue: (pr) =>
			Stream.fromEffect(
				(world(pr).hold ?? Effect.void).pipe(
					Effect.as({reading: "landed" as const, commit: `merged-${pr.slice(-1)}`}),
				),
			),
	});
	const hostWrites = Layer.succeed(CodeHostWrites, {
		enqueue: ({pr, head}) => {
			writes.push(`enqueue ${pr} ${head}`);
			const answer = world(pr).enqueue ?? "queued";
			return answer === "fails" ? broke : Effect.succeed(answer);
		},
		merge: ({pr, head}) => {
			writes.push(`merge ${pr} ${head}`);
			const answer = world(pr).merge ?? "merged";
			return answer === "fails"
				? broke
				: Effect.succeed(
						answer === "merged"
							? {reading: "merged" as const, commit: `direct-${pr.slice(-1)}`}
							: {reading: answer},
					);
		},
		rerunChecks: (pr, head) => {
			writes.push(`rerun ${pr} ${head}`);
			return Effect.succeed([{run: 11, attempt: 1}]);
		},
	});
	// Every ticket's criteria are proven at the one head these worlds read, until a late fail stands beside them.
	const lateFor = (ticket: string): number | undefined =>
		[...worlds.values()].find(
			(w) => w.facts !== "fails" && w.facts.ticket !== "none" && w.facts.ticket.id === ticket,
		)?.failsFrom;
	const record = Layer.succeed(CriteriaRecord, {
		read: (ticket) =>
			Effect.sync(() => {
				const n = (recordReads.get(ticket) ?? 0) + 1;
				recordReads.set(ticket, n);
				const proven = provenAt("abc1234");
				const from = lateFor(ticket);
				const [first] = proven.verdicts;
				if (from === undefined || n < from || first === undefined) return proven;
				const late = {
					...first,
					id: verdictId("v9"),
					grade: "fail" as const,
					proof: "a later review",
				};
				return {...proven, verdicts: [...proven.verdicts, late]};
			}),
		judged: () => Effect.void,
	});
	return {
		host,
		hostWrites,
		record,
		writes,
		reads,
		both: Layer.mergeAll(host, hostWrites, record),
	};
}

const WORLDS: ReadonlyMap<string, World> = new Map([
	[url(1), {facts: clear}],
	[url(2), {facts: {...clear, checks: "red"}}],
	[url(3), {facts: {...clear, approval: "missing"}}],
	[url(4), {facts: clear, enqueue: "fails"}],
	[url(5), {facts: "fails"}],
	[url(6), {facts: {...clear, ticket: PART}}],
]);

type ShipRun = RunOf<typeof shipProgram>;
type Stop = RunningOf<typeof shipProgram>["stop"];
type Outcomes = ReturnType<typeof ear<Shipped>>;

/** Start the ship program in write mode on the fake world, with an ear on `outcome` from the first instant, and hand the run, the ear and the starter's `stop` to `body`. */
const writing = <A, E>(
	world: ReturnType<typeof fake>,
	body: (run: ShipRun, outcomes: Outcomes, stop: Stop) => Effect.Effect<A, E>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const outcomes = ear<Shipped>();
			const started = yield* start(shipProgram, {mode: "write"}, {outcome: outcomes.hear}, kept());
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			return yield* body(started.run, outcomes, started.stop);
		}).pipe(Effect.scoped, Effect.provide(world.both)),
	);

/**
 * A stand-in for the review stage, shaped like it: told pull requests, it
 * passes each one on, and ends once its input is closed. Its output is the
 * same shape as ship's input, so the two can be piped.
 */
const review = defineProgram({
	name: "review",
	description: "A stand-in for the review stage: passes on each pull request it is told.",
	inputs: {pr: input(PullRequestUrl, "A pull request to review.")},
	outputs: {passed: output(PullRequestUrl, "A pull request that passed review, ready to ship.")},
	main: ({serve, send}) => serve({pr: (pr) => send("passed", pr)}),
});

describe("review | ship: the user's job", () => {
	it("five pull requests flow from review into ship; ship's outcomes arrive in order, and when review ends, ship finishes its last one and the pipe ends on its own", async () => {
		/** One whole pipe, on a fresh fake world. The fifth pull request sits in the queue until review has ended. */
		const once = () => {
			const released = Deferred.makeUnsafe<void>();
			const world = fake(
				new Map([
					...[1, 2, 3, 4].map((n) => [url(n), WORLDS.get(url(n)) ?? {facts: clear}] as const),
					[url(7), {facts: clear, hold: Deferred.await(released)}],
				]),
			);
			return Effect.runPromise(
				Effect.gen(function* () {
					const outcomes = ear<Shipped>();
					const ship = yield* start(shipProgram, {mode: "write"}, {outcome: outcomes.hear}, kept());
					if (ship.kind !== "running") return yield* Effect.die("ship did not start");
					const reviewing = yield* pipe({program: review, flags: {}}, "passed", ship, "pr");
					if (reviewing.kind !== "running") return yield* Effect.die("review did not start");

					const told = yield* Effect.forEach(
						[1, 2, 3, 4, 7],
						(n) => tell(reviewing.run, "pr", url(n)),
						{concurrency: 1},
					);
					reviewing.close("pr");
					const reviewEnded = yield* reviewing.run.ended;
					const heardWhenReviewEnded = outcomes.values.length;
					const toldShipAfter = yield* tell(ship.run, "pr", url(8));
					yield* Deferred.succeed(released, undefined);
					const shipEnded = yield* ship.run.ended;
					return {
						told,
						reviewEnded,
						heardWhenReviewEnded,
						toldShipAfter,
						shipEnded,
						outcomes: outcomes.values.map((o) => [o.pr, o.name]),
						writes: world.writes,
					};
				}).pipe(Effect.scoped, Effect.provide(world.both)),
			);
		};

		const runs = [await once(), await once(), await once()];

		for (const seen of runs) {
			expect(seen.told).toEqual(["queued", "queued", "queued", "queued", "queued"]);
			expect(seen.reviewEnded).toEqual({kind: "ended", unread: {}});
			// The last pull request was still in the queue when review ended.
			expect(seen.heardWhenReviewEnded).toBeLessThan(5);
			// Review's end closed ship's input; ship was still running.
			expect(seen.toldShipAfter).toBe("closed");
			expect(seen.shipEnded).toEqual({kind: "ended", unread: {}});
			expect(seen.outcomes).toEqual([
				[url(1), "done"],
				[url(2), "send:builder:checks_red"],
				[url(3), "ask:owner:approval"],
				[url(4), "stuck:enqueue_failed"],
				[url(7), "done"],
			]);
			expect(seen.writes).toEqual([
				`enqueue ${url(1)} abc1234`,
				`rerun ${url(2)} abc1234`,
				`enqueue ${url(4)} abc1234`,
				`enqueue ${url(7)} abc1234`,
			]);
		}
	});

	it("two reviews feed one ship: the first ends early, the second's later pull requests still ship, and ship's input closes only when both have ended", async () => {
		const world = fake(WORLDS);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const outcomes = ear<Shipped>();
				const ship = yield* start(shipProgram, {mode: "write"}, {outcome: outcomes.hear}, kept());
				if (ship.kind !== "running") return yield* Effect.die("ship did not start");
				const first = yield* pipe({program: review, flags: {}}, "passed", ship, "pr");
				const second = yield* pipe({program: review, flags: {}}, "passed", ship, "pr");
				if (first.kind !== "running" || second.kind !== "running")
					return yield* Effect.die("a review did not start");

				yield* tell(first.run, "pr", url(1));
				first.close("pr");
				const firstEnded = yield* first.run.ended;
				yield* outcomes.upTo(1);
				// One writer is gone and one is left: ship's input is still open, to the second and to its starter.
				const viaSecond = yield* tell(second.run, "pr", url(6));
				yield* outcomes.upTo(2);
				const afterFirst = [viaSecond, yield* tell(ship.run, "pr", url(3))];
				yield* outcomes.upTo(3);
				const shipRunningBeforeSecondEnds = yield* Effect.raceFirst(
					ship.run.ended.pipe(Effect.as(false)),
					Effect.sleep("20 millis").pipe(Effect.as(true)),
				);
				second.close("pr");
				const secondEnded = yield* second.run.ended;
				return {
					firstEnded,
					afterFirst,
					shipRunningBeforeSecondEnds,
					secondEnded,
					shipEnded: yield* ship.run.ended,
					outcomes: outcomes.values.map((o) => [o.pr, o.name]),
				};
			}).pipe(Effect.scoped, Effect.provide(world.both)),
		);

		expect(seen).toEqual({
			firstEnded: {kind: "ended", unread: {}},
			afterFirst: ["queued", "queued"],
			shipRunningBeforeSecondEnds: true,
			secondEnded: {kind: "ended", unread: {}},
			// The last writer ended, so ship's input closed, and ship finished what it held and ended on its own.
			shipEnded: {kind: "ended", unread: {}},
			outcomes: [
				[url(1), "done"],
				[url(6), "done:part"],
				[url(3), "ask:owner:approval"],
			],
		});
	});
});

describe("a parent starts the ship program and feeds it pull requests", () => {
	it("six pull requests told over time, in two batches, to one run: each outcome is heard in order, and the run keeps going until it is stopped", async () => {
		const world = fake(WORLDS);
		const seen = await writing(world, (run, outcomes, stop) =>
			Effect.gen(function* () {
				const firstWords = yield* Effect.forEach(
					[url(1), url(2), url(3)],
					(pr) => tell(run, "pr", pr),
					{
						concurrency: 1,
					},
				);
				yield* outcomes.upTo(3);
				const writesBetween = [...world.writes];
				const laterWords = yield* Effect.forEach(
					[url(4), url(5), url(6)],
					(pr) => tell(run, "pr", pr),
					{
						concurrency: 1,
					},
				);
				const all = yield* outcomes.upTo(6);
				const last = run.machines.ship.state();
				const ended = yield* stop;
				return {firstWords, writesBetween, laterWords, all, last, ended};
			}),
		);

		expect(seen.firstWords).toEqual(["queued", "queued", "queued"]);
		expect(seen.laterWords).toEqual(["queued", "queued", "queued"]);
		expect(seen.all.map((o) => [o.pr, o.name])).toEqual([
			[url(1), "done"],
			[url(2), "send:builder:checks_red"],
			[url(3), "ask:owner:approval"],
			[url(4), "stuck:enqueue_failed"],
			[url(5), "stuck:read_failed"],
			[url(6), "done:part"],
		]);
		expect(seen.all[0]?.outcome).toEqual({
			kind: "done",
			part: false,
			commit: "merged-1",
			cleanup: "done",
		});
		// The first batch was done before the second was told.
		expect(seen.writesBetween).toEqual([`enqueue ${url(1)} abc1234`, `rerun ${url(2)} abc1234`]);
		// The writes, in order: red checks run again once for #2, and an enqueue each for the three that passed the gate.
		expect(world.writes).toEqual([
			`enqueue ${url(1)} abc1234`,
			`rerun ${url(2)} abc1234`,
			`enqueue ${url(4)} abc1234`,
			`enqueue ${url(6)} abc1234`,
		]);
		// #2 was read twice: once before the re-run, once after its checks settled again.
		expect(world.reads.filter((pr) => pr === url(2))).toHaveLength(2);
		// The handle shows the newest run of the machine: #6's, at its end.
		expect(seen.last).toMatchObject({phase: "over", pr: url(6)});
		expect(seen.ended).toEqual({kind: "stopped", unread: {}});
	});

	it("the same pull requests told twice, to two runs, give the same outcomes", async () => {
		const once = () =>
			writing(fake(WORLDS), (run, outcomes) =>
				Effect.gen(function* () {
					for (let n = 1; n <= 6; n++) yield* tell(run, "pr", url(n));
					return (yield* outcomes.upTo(6)).map((o) => o.name);
				}),
			);
		expect(await once()).toEqual(await once());
	});

	it("the machine's state shows on the handle by name, with each change, from idle to over", async () => {
		const phases = await writing(fake(WORLDS), (run, outcomes, stop) =>
			Effect.gen(function* () {
				const first = yield* Deferred.make<void>();
				const watching = yield* run.machines.ship.changes.pipe(
					Stream.tap(() => Deferred.succeed(first, undefined)),
					Stream.filter((state) => state !== null),
					Stream.map((state) => state.phase),
					Stream.runCollect,
					Effect.forkChild,
				);
				yield* Deferred.await(first);
				const before = run.machines.ship.state();
				yield* tell(run, "pr", url(1));
				yield* outcomes.upTo(1);
				yield* stop;
				return {before, phases: [...(yield* Fiber.join(watching))]};
			}),
		);
		// No pull request yet, so no run of the machine yet.
		expect(phases.before).toBeNull();
		expect(phases.phases[0]).toBe("idle");
		expect(phases.phases).toContain("reading");
		expect(phases.phases).toContain("enqueueing");
		expect(phases.phases.at(-1)).toBe("over");
	});

	it("tell answers bad_shape for a url that is not a pull request's, at once, and nothing is read", async () => {
		const world = fake(WORLDS);
		const words = await writing(world, (run) =>
			Effect.all(
				[tell(run, "pr", "https://github.com/example/repo/issues/9"), run.tell("prs", [url(1)])],
				{concurrency: 1},
			),
		);
		expect(words).toEqual(["bad_shape", "no_cell"]);
		expect(world.reads).toEqual([]);
		expect(world.writes).toEqual([]);
	});

	it("from a host's JSON: a mode it does not have is a bad_shape flag", () => {
		expect(readFlags(shipProgram, {mode: "merge"})).toMatchObject({
			kind: "bad_shape",
			name: "mode",
		});
		expect(readFlags(shipProgram, {mode: "read"})).toEqual({
			kind: "given",
			flags: {mode: "read"},
		});
	});
});

describe("a repository with no merge queue: ship merges straight in", () => {
	const NO_QUEUE: ReadonlyMap<string, World> = new Map([
		[url(1), {facts: clear, enqueue: "no_queue"}],
		[url(2), {facts: {...clear, ticket: PART}, enqueue: "no_queue"}],
		[url(3), {facts: clear, enqueue: "no_queue", merge: "conflicts"}],
		[url(4), {facts: clear, enqueue: "no_queue", merge: "fails"}],
		[url(5), {facts: {...clear, checks: "red"}, enqueue: "no_queue"}],
		// A repository with a queue, in the same run: it goes through the queue as ever.
		[url(6), {facts: clear}],
	]);

	it("six pull requests, five on a repository with no queue: each is merged straight in, or says why not, and the queued one still waits in the queue", async () => {
		const world = fake(NO_QUEUE);
		const all = await writing(world, (run, outcomes) =>
			Effect.gen(function* () {
				for (let n = 1; n <= 6; n++) yield* tell(run, "pr", url(n));
				return yield* outcomes.upTo(6);
			}),
		);

		expect(all.map((o) => [o.pr, o.name])).toEqual([
			[url(1), "done"],
			[url(2), "done:part"],
			[url(3), "send:builder:conflicts"],
			[url(4), "stuck:merge_failed"],
			[url(5), "send:builder:checks_red"],
			[url(6), "done"],
		]);
		// The commit is the one the merge made, on the base branch.
		expect(all[0]?.outcome).toEqual({
			kind: "done",
			part: false,
			commit: "direct-1",
			cleanup: "done",
		});
		expect(all[5]?.outcome).toMatchObject({commit: "merged-6"});
		// Each merge went after an enqueue that found no queue, at the head the gate passed; red checks are never merged.
		expect(world.writes).toEqual([
			`enqueue ${url(1)} abc1234`,
			`merge ${url(1)} abc1234`,
			`enqueue ${url(2)} abc1234`,
			`merge ${url(2)} abc1234`,
			`enqueue ${url(3)} abc1234`,
			`merge ${url(3)} abc1234`,
			`enqueue ${url(4)} abc1234`,
			`merge ${url(4)} abc1234`,
			`rerun ${url(5)} abc1234`,
			`enqueue ${url(6)} abc1234`,
		]);
	});

	it("the same pull requests, run twice, give the same outcomes and the same writes", async () => {
		const once = async () => {
			const world = fake(NO_QUEUE);
			const names = await writing(world, (run, outcomes) =>
				Effect.gen(function* () {
					for (let n = 1; n <= 6; n++) yield* tell(run, "pr", url(n));
					return (yield* outcomes.upTo(6)).map((o) => o.name);
				}),
			);
			return {names, writes: world.writes};
		};
		expect(await once()).toEqual(await once());
	});
});

describe("a fail kept after ship's read: each write reads the facts again and lands only what the latest rows prove", () => {
	/** A ticket of its own per pull request, so a late fail on one stands beside no other. */
	const serving = (n: number): PrFacts => ({
		...clear,
		ticket: {id: `example/repo#${10 + n}`, link: "closes_it"},
	});
	const LATE: ReadonlyMap<string, World> = new Map([
		// With a queue: the fail is kept after the read, before the enqueue.
		[url(1), {facts: serving(1), failsFrom: 2}],
		// No queue: the fail is kept after the enqueue found no queue, before the merge.
		[url(2), {facts: serving(2), enqueue: "no_queue", failsFrom: 3}],
		// No queue: the fail is kept before the enqueue.
		[url(3), {facts: serving(3), enqueue: "no_queue", failsFrom: 2}],
		// Nothing late: it lands, through the queue.
		[url(4), {facts: serving(4)}],
		// Nothing late, no queue: it is merged straight in.
		[url(5), {facts: serving(5), enqueue: "no_queue"}],
	]);

	it("five pull requests, three with a fail kept after the read: none of the three is queued or merged, and each goes back to the builder; three runs, one answer", async () => {
		const once = async () => {
			const world = fake(LATE);
			const names = await writing(world, (run, outcomes) =>
				Effect.gen(function* () {
					for (let n = 1; n <= 5; n++) yield* tell(run, "pr", url(n));
					return (yield* outcomes.upTo(5)).map((o) => [o.pr, o.name]);
				}),
			);
			return {names, writes: world.writes};
		};
		const first = await once();
		expect(first.names).toEqual([
			[url(1), "send:builder:review_failed"],
			[url(2), "send:builder:review_failed"],
			[url(3), "send:builder:review_failed"],
			[url(4), "done"],
			[url(5), "done"],
		]);
		// The only writes are the two that land, and #2's enqueue, which found no queue and wrote nothing.
		expect(first.writes).toEqual([
			`enqueue ${url(2)} abc1234`,
			`enqueue ${url(4)} abc1234`,
			`enqueue ${url(5)} abc1234`,
			`merge ${url(5)} abc1234`,
		]);
		expect([await once(), await once()]).toEqual([first, first]);
	});
});

describe("nothing lands on a main it was not tested with: with no queue, only a branch on the main tip merges", () => {
	/** The facts with main where the branch left it (`tested`) and where it is now (`tip`). */
	const on = (tested: string, tip: string): PrFacts => ({...clear, main: {tested, tip}});
	const MAINS: ReadonlyMap<string, World> = new Map([
		// No queue, and main moved on since the branch left it: never merged.
		[url(1), {facts: on("m0", "m1"), enqueue: "no_queue"}],
		// No queue, on the tip: merged.
		[url(2), {facts: on("m0", "m0"), enqueue: "no_queue"}],
		// No queue, on the tip until main moves between the enqueue and the merge (the third read).
		[url(3), {facts: on("m0", "m0"), enqueue: "no_queue", later: {from: 3, facts: on("m0", "m1")}}],
		// A queue, behind main: queued, since the queue tests it on main as it is.
		[url(4), {facts: on("m0", "m2")}],
		// No queue, on a later tip: merged.
		[url(5), {facts: on("m3", "m3"), enqueue: "no_queue"}],
	]);

	it("five pull requests, two behind main with no queue: neither is merged, each goes back to the builder; three runs, one answer", async () => {
		const once = async () => {
			const world = fake(MAINS);
			const names = await writing(world, (run, outcomes) =>
				Effect.gen(function* () {
					for (let n = 1; n <= 5; n++) yield* tell(run, "pr", url(n));
					return (yield* outcomes.upTo(5)).map((o) => [o.pr, o.name]);
				}),
			);
			return {names, writes: world.writes};
		};
		const first = await once();
		expect(first.names).toEqual([
			[url(1), "send:builder:behind"],
			[url(2), "done"],
			[url(3), "send:builder:behind"],
			[url(4), "done"],
			[url(5), "done"],
		]);
		// Each enqueue is asked (no queue writes nothing); only the two on the tip are merged.
		expect(first.writes).toEqual([
			`enqueue ${url(1)} abc1234`,
			`enqueue ${url(2)} abc1234`,
			`merge ${url(2)} abc1234`,
			`enqueue ${url(3)} abc1234`,
			`enqueue ${url(4)} abc1234`,
			`enqueue ${url(5)} abc1234`,
			`merge ${url(5)} abc1234`,
		]);
		expect([await once(), await once()]).toEqual([first, first]);
	});
});

describe("the launcher, the way run.ts uses it", () => {
	const reading = (world: ReturnType<typeof fake>): Parts => ({
		reads: () => world.host,
		writes: () => {
			throw new Error("read mode made the write side");
		},
		record: () => world.record,
	});
	const who = {own: ["a"], reviewers: ["a"]} as const;

	it("read mode over three pull requests: what each would do is heard, and nothing is written", async () => {
		const world = fake(WORLDS);
		const found: Look[] = [];

		const launched = await Effect.runPromise(
			launch({prs: [url(1), url(2), url(3)], mode: "read", ...who}, reading(world), {
				found: (f) => found.push(f),
			}),
		);

		expect(launched).toEqual({kind: "ran"});
		expect(found.map((f) => [f.name, f.wouldSend?.type ?? null])).toEqual([
			[null, "ship_enqueue"],
			[null, "ship_rerun_checks"],
			["ask:owner:approval", null],
		]);
		expect(world.writes).toEqual([]);
	});

	it("a url that is not a pull request's answers bad_shape before anything runs: no service made, nothing read", async () => {
		const world = fake(WORLDS);
		const made: string[] = [];
		const parts: Parts = {
			reads: () => {
				made.push("reads");
				return world.host;
			},
			writes: () => {
				made.push("writes");
				return world.hostWrites;
			},
			record: () => {
				made.push("record");
				return world.record;
			},
		};
		const launched = await Effect.runPromise(
			launch(
				{prs: [url(1), "https://github.com/example/repo/issues/9"], mode: "write", ...who},
				parts,
				{},
			),
		);

		expect(launched).toMatchObject({kind: "bad_shape", name: "pr"});
		expect(made).toEqual([]);
		expect(world.reads).toEqual([]);
	});
});

describe("the ship program's listing", () => {
	it("names the program, its flag, inputs, outputs and machine, each with a description and a JSON Schema", () => {
		const shown = listing(shipProgram);

		expect(shown.name).toBe("ship");
		expect(shown.description).toMatch(/merge queue/);
		expect(shown.flags.map((f) => f.name)).toEqual(["mode"]);
		expect(shown.inputs.map((i) => i.name)).toEqual(["pr", "ask", "forget"]);
		expect(shown.outputs.map((o) => o.name)).toEqual(["found", "outcome", "answer", "forgot"]);
		expect(shown.machines).toEqual(["queue", "ship"]);
		// The url's pattern is not in it: Effect 4.0.0 leaves patterns out of JSON Schema. Its description says the form.
		// `pr` takes a bare url, or a pull request at a head (what review's `passed` sends).
		const bareUrl = {
			type: "string",
			description: "https://github.com/<owner>/<repo>/pull/<number>",
		};
		expect(shown.inputs[0]?.schema).toEqual({
			anyOf: [
				bareUrl,
				{
					type: "object",
					properties: {
						pr: bareUrl,
						head: {type: "string", description: "a whole commit, forty hex digits"},
					},
					required: ["pr", "head"],
					additionalProperties: false,
				},
			],
		});
		expect(shown.flags[0]?.schema).toEqual({type: "string", enum: ["read", "write"]});
		expect(shown.outputs[1]?.schema).toMatchObject({
			type: "object",
			required: ["pr", "outcome", "name"],
			additionalProperties: false,
		});
		for (const one of [...shown.flags, ...shown.inputs, ...shown.outputs]) {
			expect(one.description.length).toBeGreaterThan(10);
			expect(one.schema).toBeDefined();
		}
	});
});

describe("kept across a restart: the same id and the same storage", () => {
	/** One start of the run: on `storage` under one id, `body` run, then the scope closes, as a crash would close it. */
	const once = <A, E>(
		world: ReturnType<typeof fake>,
		storage: Storage,
		body: (
			started: RunningOf<typeof shipProgram>,
			heard: {readonly outcomes: Outcomes; readonly answers: ReturnType<typeof ear<Answer>>},
		) => Effect.Effect<A, E>,
	) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const outcomes = ear<Shipped>();
				const answers = ear<Answer>();
				const started = yield* start(
					shipProgram,
					{mode: "write"},
					{outcome: outcomes.hear, answer: answers.hear},
					{id: "ship:kept", storage},
				);
				if (started.kind !== "running") return yield* Effect.die("did not start");
				return yield* body(started, {outcomes, answers});
			}).pipe(Effect.scoped, Effect.provide(world.both)),
		);
	/** Wait until the run keeps no run of `machine`. */
	const noneLeft = (storage: Storage, machine: string) =>
		Effect.gen(function* () {
			const kept = () =>
				storage.record("ship:kept").pipe(
					Effect.orDie,
					Effect.map((r) => r?.machines.some((m) => m.machine === machine)),
				);
			while (yield* kept()) yield* Effect.sleep("5 millis");
		});
	/** Wait until the ship machine on the handle stands in `phase`. */
	const standsIn = (run: ShipRun, phase: string) =>
		run.machines.ship.changes.pipe(
			Stream.filter((s) => s?.phase === phase),
			Stream.take(1),
			Stream.runDrain,
		);

	it("a pull request left in the merge queue is taken to its end by the next start, untold, and is not queued twice", async () => {
		const storage = memoryStorage();
		const before = fake(new Map([[url(7), {facts: clear, hold: Effect.never}]]));
		await once(before, storage, ({run}) =>
			Effect.gen(function* () {
				yield* tell(run, "pr", url(7));
				yield* standsIn(run, "queued");
			}),
		);
		expect(before.writes).toEqual([`enqueue ${url(7)} abc1234`]);

		// The queue lands it while nothing runs. The next start is told nothing.
		const after = fake(new Map([[url(7), {facts: clear}]]));
		const outcome = await once(after, storage, (_, {outcomes}) =>
			outcomes.upTo(1).pipe(Effect.tap(() => noneLeft(storage, "ship"))),
		);

		expect(outcome).toEqual([
			{
				pr: url(7),
				name: "done",
				outcome: {kind: "done", part: false, commit: "merged-7", cleanup: "done"},
			},
		]);
		// Taken on from the queue: no read, no second enqueue.
		expect({reads: after.reads, writes: after.writes}).toEqual({reads: [], writes: []});
		// A bare pull request: nobody can ask about it again, so nothing of it is left once it is over.
		// Its drop runs just after its outcome is said. Only the run's queue stays, its input still open.
		expect((await Effect.runPromise(storage.record("ship:kept")))?.machines).toEqual([
			{machine: "queue", id: "queue"},
		]);
	});

	it("an ask under an id already answered is answered again from storage, and the machine does not run again", async () => {
		const storage = memoryStorage();
		const ask = {id: "lane-42/ship", pr: url(1)};
		const first = await once(fake(WORLDS), storage, ({run}, {answers}) =>
			tell(run, "ask", ask).pipe(Effect.andThen(answers.upTo(1))),
		);
		const world = fake(WORLDS);
		const again = await once(world, storage, ({run}, {answers, outcomes}) =>
			Effect.gen(function* () {
				const word = yield* tell(run, "ask", ask);
				const heard = yield* answers.upTo(1);
				return {word, heard, outcomes: outcomes.values.length};
			}),
		);

		expect(first).toEqual([
			{id: ask.id, pr: url(1), name: "done", outcome: expect.objectContaining({kind: "done"})},
		]);
		// The same answer, said again from the run kept over: on `outcome` too, as each pull request's
		// work is said on both. Nothing ran.
		expect(again).toEqual({word: "queued", heard: first, outcomes: 1});
		expect({reads: world.reads, writes: world.writes}).toEqual({reads: [], writes: []});
	});

	it("an answer is kept until its asker forgets it: then it is gone, and the same id asked again runs afresh", async () => {
		const storage = memoryStorage();
		const ask = {id: "lane-43/ship", pr: url(1)};
		await once(fake(WORLDS), storage, ({run}, {answers}) =>
			tell(run, "ask", ask).pipe(Effect.andThen(answers.upTo(1))),
		);
		const kept = await Effect.runPromise(storage.record("ship:kept"));
		expect(kept?.machines).toEqual([
			{machine: "queue", id: "queue"},
			{machine: "ship", id: ask.id},
		]);

		// The asker has saved its answer, and says so. Ship drops it in its turn.
		const word = await once(fake(WORLDS), storage, ({run}) =>
			Effect.gen(function* () {
				const word = yield* tell(run, "forget", {id: ask.id});
				yield* noneLeft(storage, "ship");
				return word;
			}),
		);
		expect(word).toBe("queued");
		expect((await Effect.runPromise(storage.record("ship:kept")))?.machines).toEqual([
			{machine: "queue", id: "queue"},
		]);

		// Nothing is kept under that id now: an ask under it is a new ask, read and queued again.
		const world = fake(WORLDS);
		await once(world, storage, ({run}, {answers}) =>
			tell(run, "ask", ask).pipe(Effect.andThen(answers.upTo(1))),
		);
		expect(world.writes).toEqual([`enqueue ${url(1)} abc1234`]);
	});

	describe("a pull request at a head, as review's `passed` sends it: its id is the url of that commit (experiment 75c)", () => {
		const H1 = "a".repeat(40);
		const H2 = "b".repeat(40);
		const at = (head: string) => ({pr: url(1), head});
		/** Wait until the run's queue holds nothing and owes nothing: every pull request told is off it. */
		const settled = (run: ShipRun) =>
			run.machines.queue.changes.pipe(
				Stream.filter((s) => s !== null && s.items.length === 0 && s.clearing.length === 0),
				Stream.take(1),
				Stream.runDrain,
			);
		/** One pull request at a head, told and taken off the queue, then the life ends. */
		const shipOnce = (storage: Storage, told: {readonly pr: string; readonly head: string}) =>
			once(fake(WORLDS), storage, ({run}, {outcomes}) =>
				tell(run, "pr", told).pipe(
					Effect.andThen(outcomes.upTo(1)),
					Effect.tap(() => settled(run)),
				),
			);

		it("told at the same head after a restart, it is answered from what was kept: said again, not read, not queued again", async () => {
			const storage = memoryStorage();
			const first = await shipOnce(storage, at(H1));
			const world = fake(WORLDS);
			const again = await once(world, storage, ({run}, {outcomes}) =>
				Effect.gen(function* () {
					const word = yield* tell(run, "pr", at(H1));
					const heard = yield* outcomes.upTo(1);
					yield* settled(run);
					return {word, heard};
				}),
			);
			expect(first).toEqual([expect.objectContaining({pr: url(1), name: "done"})]);
			expect(again).toEqual({word: "queued", heard: first});
			expect({reads: world.reads, writes: world.writes}).toEqual({reads: [], writes: []});
			expect((await Effect.runPromise(storage.record("ship:kept")))?.machines).toEqual([
				{machine: "queue", id: "queue"},
				{machine: "ship", id: keyOf(at(H1))},
			]);
		});

		it("five pull requests, each told three times at one head in one run, the last time after all are over: each is read once and queued once; a new head is new work", async () => {
			const prs = [1, 2, 3, 4, 6].map(url);
			const world = fake(WORLDS);
			const {heard, ended} = await once(world, memoryStorage(), ({run, close}, {outcomes}) =>
				Effect.gen(function* () {
					// Told twice in a row. `main` reads one value at a time (experiment 80), so the second
					// finds the first still on the queue, which holds one (../queue.ts), or already over,
					// and answered from what was kept: either way it is not read or queued again.
					for (let time = 0; time < 2; time++)
						for (const pr of prs) yield* tell(run, "pr", {pr, head: H1});
					yield* outcomes.upTo(5);
					yield* settled(run);
					// Told again once the first five are said: only what ship kept under each head can catch these.
					for (const pr of prs) yield* tell(run, "pr", {pr, head: H1});
					yield* tell(run, "pr", {pr: url(1), head: H2});
					// stdin's end: ship finishes every value told, then ends, with none left unread.
					close("pr");
					return {heard: outcomes.values, ended: yield* run.ended};
				}),
			);
			expect(ended).toEqual({kind: "ended", unread: {}});
			// Each said at least twice, the same way each time; #1 once more, at its new head.
			for (const pr of prs) {
				const said = heard.filter((o) => o.pr === pr);
				expect(said.length).toBeGreaterThanOrEqual(pr === url(1) ? 3 : 2);
				expect(new Set(said.map((o) => o.name)).size).toBe(1);
			}
			// Read once each (#2 again after its checks ran again), and #1 once more at its new head; each
			// one that goes on is read once more at the door of its enqueue.
			expect(world.reads).toEqual([
				url(1),
				url(1),
				url(2),
				url(2),
				url(3),
				url(4),
				url(4),
				url(6),
				url(6),
				url(1),
				url(1),
			]);
			// #1, #4 and #6 reach the merge queue once each (#4's enqueue fails, once); #2's red checks run
			// again once. #1 at its new head is read and queued again.
			expect(world.writes).toEqual([
				`enqueue ${url(1)} abc1234`,
				`rerun ${url(2)} abc1234`,
				`enqueue ${url(4)} abc1234`,
				`enqueue ${url(6)} abc1234`,
				`enqueue ${url(1)} abc1234`,
			]);
		});

		it("a bare url has no id to catch a repeat by: told again once it is over, it is shipped again, and nothing of it is kept", async () => {
			const storage = memoryStorage();
			const world = fake(WORLDS);
			await once(world, storage, ({run}, {outcomes}) =>
				Effect.gen(function* () {
					yield* tell(run, "pr", url(1));
					yield* outcomes.upTo(1);
					yield* settled(run);
					yield* tell(run, "pr", url(1));
					yield* outcomes.upTo(2);
					yield* settled(run);
				}),
			);
			expect(world.writes).toEqual([`enqueue ${url(1)} abc1234`, `enqueue ${url(1)} abc1234`]);
			expect((await Effect.runPromise(storage.record("ship:kept")))?.machines).toEqual([
				{machine: "queue", id: "queue"},
			]);
		});

		it("a forget under its id lets the same head ship again", async () => {
			const storage = memoryStorage();
			await shipOnce(storage, at(H1));
			const world = fake(WORLDS);
			await once(world, storage, ({run}, {outcomes}) =>
				Effect.gen(function* () {
					yield* tell(run, "forget", {id: keyOf(at(H1))});
					yield* noneLeft(storage, "ship");
					yield* tell(run, "pr", at(H1));
					yield* outcomes.upTo(1);
				}),
			);
			expect(world.writes).toEqual([`enqueue ${url(1)} abc1234`]);
		});

		it("a head that is not a whole commit is bad_shape, and nothing is read", async () => {
			const world = fake(WORLDS);
			const words = await once(world, memoryStorage(), ({run}) =>
				// The type refuses the last two before any run; a host's JSON can still send them.
				Effect.all(
					[
						tell(run, "pr", {pr: url(1), head: "abc1234"}),
						run.tell("pr", {pr: url(1)}),
						run.tell("pr", {pr: url(1), head: H1, extra: true}),
					],
					{concurrency: 1},
				),
			);
			expect(words).toEqual(["bad_shape", "bad_shape", "bad_shape"]);
			expect(world.reads).toEqual([]);
		});
	});

	it("an input the starter closed stays closed at the next start of the run", async () => {
		const storage = memoryStorage();
		const ended = await once(fake(WORLDS), storage, ({run, close}) => {
			close("pr");
			return run.ended;
		});
		const next = await once(fake(WORLDS), storage, ({run}) =>
			Effect.gen(function* () {
				const word = yield* tell(run, "pr", url(1));
				return {word, ended: yield* run.ended};
			}),
		);

		expect(ended).toEqual({kind: "ended", unread: {}});
		expect(next).toEqual({word: "closed", ended: {kind: "ended", unread: {}}});
	});

	it("a run on another id keeps apart: it finds nothing of this one's", async () => {
		const storage = memoryStorage();
		await once(fake(WORLDS), storage, ({close, run}) => {
			close("pr");
			return run.ended;
		});
		const other = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(shipProgram, {mode: "write"}, {}, {id: "ship:other", storage});
				return started.kind === "running" ? yield* tell(started.run, "pr", url(1)) : null;
			}).pipe(Effect.scoped, Effect.provide(fake(WORLDS).both)),
		);

		expect(other).toBe("queued");
	});

	it("two starts of one run at once: the older one's writes fail Stale, so it ships nothing, and the newer one ships", async () => {
		const storage = memoryStorage();
		const world = fake(WORLDS);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const outcomes = ear<Shipped>();
				const keeping = {id: "ship:twice", storage};
				const older = yield* start(shipProgram, {mode: "write"}, {}, keeping);
				const newer = yield* start(shipProgram, {mode: "write"}, {outcome: outcomes.hear}, keeping);
				if (older.kind !== "running" || newer.kind !== "running")
					return yield* Effect.die("did not start");
				yield* tell(older.run, "pr", url(1));
				const olderEnded = yield* older.run.ended;
				const writesAfterOlder = [...world.writes];
				yield* tell(newer.run, "pr", url(1));
				return {olderEnded, writesAfterOlder, heard: yield* outcomes.upTo(1)};
			}).pipe(Effect.scoped, Effect.provide(world.both)),
		);

		expect(seen.olderEnded.kind).toBe("failed");
		expect(String(seen.olderEnded.kind === "failed" && seen.olderEnded.cause)).toContain("Stale");
		expect(seen.writesAfterOlder).toEqual([]);
		expect(seen.heard.map((o) => o.name)).toEqual(["done"]);
		expect(world.writes).toEqual([`enqueue ${url(1)} abc1234`]);
	});
});

describe("killed (kill -9) and started again: each start goes on from the kept phase, and no write goes twice", () => {
	/** One life of the process: the ship program on `life`'s storage under one id, `body` run, then the scope closes. */
	const lifeOn = <A, E>(
		world: ReturnType<typeof fake>,
		life: Life,
		body: (run: ShipRun, outcomes: Outcomes) => Effect.Effect<A, E>,
	) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const outcomes = ear<Shipped>();
				const started = yield* start(
					shipProgram,
					{mode: "write"},
					{outcome: outcomes.hear},
					{id: "ship:mortal", storage: life.storage},
				);
				if (started.kind !== "running") return yield* Effect.die("did not start");
				return yield* body(started.run, outcomes);
			}).pipe(Effect.scoped, Effect.provide(world.both)),
		);
	/** Kill the process once the ship machine stands in `phase`. */
	const killIn = (life: Life, phase: string) => (run: ShipRun) =>
		run.machines.ship.changes.pipe(
			Stream.filter((s) => s?.phase === phase),
			Stream.take(1),
			Stream.runDrain,
			Effect.andThen(Effect.sync(() => life.kill())),
		);

	it("killed twice while it waits on checks it ran again, then let run: the checks are run again once, read once after (and at the door), and queued once", async () => {
		const disk = mortalDisk();
		const red = fake(new Map([[url(8), {facts: {...clear, checks: "red"}, settle: Effect.never}]]));
		const first = disk.life();
		await lifeOn(red, first, (run) =>
			tell(run, "pr", url(8)).pipe(Effect.andThen(killIn(first, "waiting")(run))),
		);
		expect(red.writes).toEqual([`rerun ${url(8)} abc1234`]);

		// Started again and killed again while the checks still run: the kept phase is `waiting`, and its
		// Listen is all that goes on. Nothing is read, nothing written.
		const still = fake(
			new Map([[url(8), {facts: {...clear, checks: "red"}, settle: Effect.never}]]),
		);
		const second = disk.life();
		await lifeOn(still, second, killIn(second, "waiting"));
		expect({reads: still.reads, writes: still.writes}).toEqual({reads: [], writes: []});

		// The checks went green while nothing ran. The third start is told nothing.
		const green = fake(new Map([[url(8), {facts: clear}]]));
		const third = disk.life();
		const heard = await lifeOn(green, third, (_, outcomes) => outcomes.upTo(1));
		expect(heard.map((o) => o.name)).toEqual(["done"]);
		// Read after the checks, and once more at the door of the enqueue.
		expect({reads: green.reads, writes: green.writes}).toEqual({
			reads: [url(8), url(8)],
			writes: [`enqueue ${url(8)} abc1234`],
		});
	});

	it("killed in the merge queue: the next start takes it from the queue to its end, with no read and no second enqueue", async () => {
		const disk = mortalDisk();
		const before = fake(new Map([[url(9), {facts: clear, hold: Effect.never}]]));
		const first = disk.life();
		await lifeOn(before, first, (run) =>
			tell(run, "pr", url(9)).pipe(Effect.andThen(killIn(first, "queued")(run))),
		);
		expect(before.writes).toEqual([`enqueue ${url(9)} abc1234`]);

		const after = fake(new Map([[url(9), {facts: clear}]]));
		const heard = await lifeOn(after, disk.life(), (_, outcomes) => outcomes.upTo(1));
		expect(heard).toEqual([
			{
				pr: url(9),
				name: "done",
				outcome: {kind: "done", part: false, commit: "merged-9", cleanup: "done"},
			},
		]);
		expect({reads: after.reads, writes: after.writes}).toEqual({reads: [], writes: []});
	});
});
