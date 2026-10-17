import type {Store} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {Deferred, Effect, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {Fabrika} from "./fabrika.ts";
import {fakeFabrika} from "./fabrika-scripted.ts";
import {
	createOperator,
	defaultKnobs,
	type Knobs,
	type Operator,
	type OperatorMsg,
} from "./operator.ts";
import {
	askShipOn,
	operatorInterpret,
	operatorShipInterpret,
	operatorShipSubscribe,
	operatorSubscribe,
	type ShipRun,
} from "./operator-host.ts";
import {start, tell} from "./program/program.ts";
import {memoryShelf, type Shelf} from "./program/shelf.ts";
import {scriptedJev} from "./scripted.ts";
import {CodeHost, CodeHostWrites} from "./services.ts";
import type {ShipFacts} from "./stages/ship/facts.ts";
import {createShip} from "./stages/ship/machine.ts";
import {type Answer, createShipProgram} from "./stages/ship/program.ts";
import type {AskShipCmd} from "./turn.ts";

// Experiment 66: kill the operator in the middle of a ship, start it again
// from what it saved, and see what the ship stage does. Three ways to fill the
// ship stage, the same five crash points for each:
//
//   child   the ship machine embedded in the operator's own state (today)
//   naive   the ship program started beside the operator, keeping nothing; the
//           ship stage is one Cmd that tells `pr` and waits on `outcome`
//   kept    the ship program started with a stable id and a shelf it keeps
//           each machine run on; the Cmd asks under its intent and waits on
//           `answer` under the same id
//
// A kill stops everything in the process at once: the operator, the ship
// program, every handler in flight. What lives on is what lives outside the
// process: the operator's saved state (as JSON), the shelf, fabrika's lane
// and GitHub. Both are fakes here, and GitHub is modelled as it behaves: an
// enqueue reads first, and a pull request already in the queue or merged is
// answered `queued` with no write. No call leaves the process.

const PR = "https://github.com/example/repo/pull/7";
const HEAD = "abc1234";
const MERGE = "m3rg3c0";
const RUN = "r1";
const knobs: Knobs = {
	...defaultKnobs,
	slots: 2,
	recheckMs: 2,
	rechecks: 3,
	queueStallMs: 5_000,
	ciWaitMs: 5_000,
	msPerMinute: 1_000,
	who: ["owner"],
};
const NO_SHELLS = {
	trees: "",
	plugin: "",
	alsoWritable: [],
	model: "",
	effort: "medium",
	maxShellUsd: 0,
} as const;

type Mode = "child" | "naive" | "kept";
type Point = "before_enqueue" | "after_enqueue" | "in_queue" | "outcome_sent" | "record_in_flight";
type Leaves = "landed" | "ejected";

/** GitHub, for one pull request, with the merge queue in it. It outlives every kill. */
function gitHub() {
	const world = {
		pr: "open" as "open" | "queued" | "merged",
		/** How a queued pull request leaves the queue, once someone listens. `never`: not in this life. */
		queue: "landed" as Leaves | "never",
		enqueueCalls: 0,
		/** Each write that put the pull request in the queue. */
		writes: 0,
		/** Each read of the pull request's facts: one per run of the ship machine from its start. */
		reads: 0,
		hooks: {} as {
			beforeWrite?: Effect.Effect<void>;
			afterWrite?: Effect.Effect<void>;
			listening?: Effect.Effect<void>;
		},
	};
	const facts = (): ShipFacts => ({
		head: HEAD,
		state: world.pr === "merged" ? "merged" : "open",
		ours: true,
		ticket: "closes_it",
		approval: "not_needed",
		reviews: "passed",
		reviewKinds: [],
		checks: "green",
		mergeable: "clean",
		comments: [],
	});
	const landed = {reading: "landed" as const, commit: MERGE};
	const ejected = {reading: "ejected" as const};
	const layer = Layer.mergeAll(
		Layer.succeed(CodeHost, {
			prFacts: () =>
				Effect.sync(() => {
					world.reads += 1;
					return facts();
				}),
			change: () => Effect.fail({_tag: "unknown" as const}),
			checksSettled: () => Stream.make(undefined),
			leftQueue: () =>
				Stream.unwrap(
					Effect.gen(function* () {
						if (world.pr === "merged") return Stream.make(landed);
						if (world.pr === "open") return Stream.make(ejected);
						if (world.hooks.listening !== undefined) yield* world.hooks.listening;
						if (world.queue === "never") return Stream.never;
						world.pr = world.queue === "landed" ? "merged" : "open";
						return Stream.make(world.queue === "landed" ? landed : ejected);
					}),
				),
		}),
		Layer.succeed(CodeHostWrites, {
			// As the real one: read first, and write only when the pull request is neither queued nor merged.
			enqueue: () =>
				Effect.gen(function* () {
					world.enqueueCalls += 1;
					if (world.pr !== "open") return "queued" as const;
					if (world.hooks.beforeWrite !== undefined) yield* world.hooks.beforeWrite;
					world.pr = "queued";
					world.writes += 1;
					if (world.hooks.afterWrite !== undefined) yield* world.hooks.afterWrite;
					return "queued" as const;
				}),
			rerunChecks: () => Effect.fail({_tag: "unknown" as const}),
		}),
	);
	return {world, layer};
}

/** Where the operator saves its state: as JSON, read back as a copy, so a restart sees only what was saved. */
function savedStore(): Store<Operator> & {readonly saved: () => Operator | null} {
	let saved: string | null = null;
	return {
		load: async () => (saved === null ? null : JSON.parse(saved)),
		save: async (state) => {
			saved = JSON.stringify(state);
		},
		migrate: (raw) => raw as Operator | null,
		saved: () => (saved === null ? null : JSON.parse(saved)),
	};
}

/**
 * Step 2's Cmd, as it would be written first: tell the ship program the pull
 * request on `pr`, and wait for that pull request's outcome on `outcome`.
 */
const naiveAsk =
	(ship: ShipRun) =>
	(cmd: AskShipCmd): Effect.Effect<Answer, {readonly _tag: "refused"}> =>
		Effect.callback((resume) => {
			const off = ship.listen("outcome", (shipped) => {
				if (shipped.pr !== cmd.pr) return;
				off();
				resume(Effect.succeed({id: cmd.intent, ...shipped}));
			});
			if (tell(ship, "pr", cmd.pr) !== "queued") {
				off();
				resume(Effect.fail({_tag: "refused"}));
			}
			return Effect.sync(off);
		});

type Fake = ReturnType<typeof fakeFabrika>;

/** A builder that never ends: where a run stops once the lane is back at the build. */
const builderWaits = [{shell: "builder", reports: null, says: null, ends: "hangs"}] as const;
const landedEnd = (s: Operator) => s.phase === "ended";
const backAtBuild = (fake: Fake) => (s: Operator) =>
	fake.lane.state === "build" && s.phase === "driving" && s.turns.issue?.state.phase === "drafting";

interface World {
	readonly mode: Mode;
	readonly fake: Fake;
	readonly gh: ReturnType<typeof gitHub>;
	readonly store: ReturnType<typeof savedStore>;
	readonly shelf: Shelf;
	/** Each lane line the operator sent, with its intent, every time it was sent. */
	readonly records: {readonly intent: string; readonly token: string}[];
	/** Armed for the first life only: what the kill hooks into. */
	hooks: {
		readonly askHeard?: Effect.Effect<void>;
		readonly recording?: Effect.Effect<void>;
	};
}

/**
 * One life of the operator, and in the program modes of the ship program
 * beside it, in one scope. It ends when `until` holds, or when a hook kills
 * it: then the scope closes and everything in it stops where it stood.
 */
function life(
	w: World,
	first: OperatorMsg,
	until: (s: Operator) => boolean,
	kill?: (k: Effect.Effect<never>) => void,
) {
	const body = Effect.gen(function* () {
		const killed = yield* Deferred.make<void>();
		kill?.(Deferred.succeed(killed, undefined).pipe(Effect.andThen(Effect.never)));
		const opts = {
			ctx: undefined,
			store: w.store,
			terminal: until,
			subscribe: {...operatorSubscribe({pollMs: 1, shell: NO_SHELLS}), shell: w.fake.shellRunner},
		};
		const booted = Effect.gen(function* () {
			if (w.mode === "child") {
				const handle = yield* run(createOperator(2, {ship: "machine"}), {
					...opts,
					interpret: operatorShipInterpret("jev-test"),
					subscribe: {...opts.subscribe, ...operatorShipSubscribe},
				});
				return yield* handle.ready;
			}
			const ship = yield* start(
				createShipProgram(
					createShip({waits: {checksMs: knobs.ciWaitMs, queueMs: knobs.queueStallMs}}),
				),
				{mode: "write"},
				{},
				// `naive` keeps nothing: a fresh shelf in every life is no shelf at all.
				{id: `ship:${RUN}`, shelf: w.mode === "kept" ? w.shelf : memoryShelf()},
			);
			if (ship.kind !== "running") return yield* Effect.die("ship did not start");
			const ask = (w.mode === "kept" ? askShipOn : naiveAsk)(ship.run);
			const heard = w.hooks.askHeard;
			const handle = yield* run(createOperator(2, {ship: "program"}), {
				...opts,
				interpret: {
					...operatorInterpret("jev-test"),
					ship_ask: (cmd: AskShipCmd) =>
						heard === undefined ? ask(cmd) : ask(cmd).pipe(Effect.tap(() => heard)),
				},
			});
			return yield* handle.ready;
		});
		const runtime = yield* booted;
		const ran = Effect.gen(function* () {
			yield* runtime.dispatch(first);
			return {kind: "ran" as const, end: yield* runtime.done()};
		});
		return yield* Effect.raceFirst(
			ran,
			Deferred.await(killed).pipe(Effect.as({kind: "killed" as const})),
		);
	});
	const fabrika = Layer.effect(
		Fabrika,
		Effect.gen(function* () {
			const f = yield* Fabrika;
			return {
				...f,
				record: (args: Parameters<typeof f.record>[0]) =>
					Effect.gen(function* () {
						if (args.fact.kind === "token") {
							w.records.push({intent: args.intent, token: args.fact.token});
							if (w.hooks.recording !== undefined) yield* w.hooks.recording;
						}
						return yield* f.record(args);
					}),
			};
		}),
	).pipe(Layer.provide(w.fake.layer));
	const services = Layer.mergeAll(
		w.fake.layer,
		fabrika,
		w.fake.thread,
		scriptedJev([]),
		w.gh.layer,
	);
	return Effect.runPromise(
		body.pipe(Effect.scoped, Effect.provide(services), Effect.timeout("4 seconds")),
	);
}

/**
 * Drive a lane at `ship` to its end, killed once at `point` in the first
 * life and started again from what was saved. `leaves`: how the merge queue
 * lets the pull request go.
 */
async function crash(mode: Mode, point: Point, leaves: Leaves) {
	const fake = fakeFabrika({lane: "42", state: "ship", pr: PR, shells: builderWaits});
	const gh = gitHub();
	const w: World = {
		mode,
		fake,
		gh,
		store: savedStore(),
		shelf: memoryShelf(),
		records: [],
		hooks: {},
	};
	const until = leaves === "landed" ? landedEnd : backAtBuild(fake);
	let kill: Effect.Effect<never> = Effect.never;
	const arm = (k: Effect.Effect<never>) => {
		kill = k;
	};
	const killNow = Effect.suspend(() => kill);
	gh.world.queue = point === "in_queue" ? "never" : leaves;
	if (point === "before_enqueue") gh.world.hooks = {beforeWrite: killNow};
	if (point === "after_enqueue") gh.world.hooks = {afterWrite: killNow};
	if (point === "in_queue") gh.world.hooks = {listening: killNow};
	if (point === "outcome_sent") w.hooks = {askHeard: killNow};
	if (point === "record_in_flight") w.hooks = {recording: killNow};

	const first = await life(w, {type: "start", run: RUN, lane: "42", knobs}, until, arm);
	const savedAt = w.store.saved();

	// Down. Nothing runs; GitHub goes on.
	gh.world.hooks = {};
	w.hooks = {};
	if (point === "in_queue") gh.world.pr = leaves === "landed" ? "merged" : "open";
	gh.world.queue = leaves;

	const second = await life(w, {type: "resume"}, until);
	const end = second.kind === "ran" ? second.end : null;
	const ships = end !== null && "log" in end ? (end.log.ships ?? []) : [];
	return {
		first: first.kind,
		savedAt:
			savedAt?.phase === "driving"
				? (savedAt.turns.issue?.state.phase ?? null)
				: (savedAt?.phase ?? null),
		second: second.kind,
		lane: fake.lane.state,
		enqueueWrites: gh.world.writes,
		enqueueCalls: gh.world.enqueueCalls,
		factReads: gh.world.reads,
		/** The lane lines written: one per intent, as fabrika keeps them. */
		written: fake.writes.filter((x) => x.what === "record token").length,
		/** What the ship stage said, each time the operator heard it. */
		said: ships.map((row) => row.name),
		/** Each lane line the operator sent, a resend under the same intent included. */
		sent: w.records.map((r) => r.token),
		intents: new Set(w.records.map((r) => r.intent)).size,
		trees: fake.trees.standing.size,
	};
}

/** How a lane ends when nothing went wrong: the lane's state, the one line written on it, and what the ship stage said. */
const RIGHT = {
	landed: {lane: "shipped", word: "LANDED", said: "done"},
	ejected: {lane: "build", word: "EJECTED", said: "send:builder:ejected"},
} as const;

/** What the restart ends with: the lane's state, the line on it, and how many times the pull request was put in the queue. */
interface Ended {
	readonly lane: string;
	readonly word: string;
	readonly writes: number;
}
const right = (leaves: Leaves): Ended => ({
	lane: RIGHT[leaves].lane,
	word: RIGHT[leaves].word,
	writes: 1,
});

const POINTS: readonly Point[] = [
	"before_enqueue",
	"after_enqueue",
	"in_queue",
	"outcome_sent",
	"record_in_flight",
];
/**
 * Where each mode does not end right. `child` has no `outcome_sent`: its
 * outcome and the lane line it causes are one fold of one state. Every other
 * cell not named here ends right.
 */
const WRONG: Partial<Record<`${Mode} ${Point} ${Leaves}`, Ended | "n/a">> = {
	"child outcome_sent landed": "n/a",
	"child outcome_sent ejected": "n/a",
	// A fresh machine finds the pull request merged: it lands, but as found, not as landed by this run, and skips the tidy-up.
	"naive in_queue landed": {lane: "shipped", word: "ALREADY-MERGED", writes: 1},
	"naive outcome_sent landed": {lane: "shipped", word: "ALREADY-MERGED", writes: 1},
	// A fresh machine finds an open pull request the queue threw out, and puts it in the queue again.
	"naive in_queue ejected": {lane: "build", word: "EJECTED", writes: 2},
	"naive outcome_sent ejected": {lane: "build", word: "EJECTED", writes: 2},
};

const CELLS = (["child", "naive", "kept"] as const).flatMap((mode) =>
	POINTS.flatMap((point) =>
		(["landed", "ejected"] as const).flatMap((leaves) => {
			const expected = WRONG[`${mode} ${point} ${leaves}`] ?? right(leaves);
			return expected === "n/a" ? [] : [[mode, point, leaves, expected] as const];
		}),
	),
);

describe("a kill at each point of a ship, and a restart from what was saved", () => {
	it.each(CELLS)("%s, %s, %s", async (mode, point, leaves, expected) => {
		const seen = await crash(mode, point, leaves);

		expect(seen).toMatchObject({
			first: "killed",
			second: "ran",
			lane: expected.lane,
			enqueueWrites: expected.writes,
			// One line on the lane: a second send of it is under the same intent, and fabrika keeps the first.
			written: 1,
			intents: 1,
		});
		expect(new Set(seen.sent)).toEqual(new Set([expected.word]));
	});

	it("kept: an answer sent while the operator was down is heard on the restart, and the machine does not run again", async () => {
		const seen = await crash("kept", "outcome_sent", "landed");

		// One read of the facts: the second ask was answered from the shelf.
		expect(seen).toMatchObject({factReads: 1, enqueueCalls: 1, sent: ["LANDED"]});
		expect(seen.said).toEqual(["done"]);
	});

	it("naive: the same restart runs a fresh machine, which reads the pull request again and calls it found merged", async () => {
		const seen = await crash("naive", "outcome_sent", "landed");

		expect(seen).toMatchObject({factReads: 2, sent: ["ALREADY-MERGED"]});
	});

	it("kept: a machine left in the merge queue is taken on from there; nothing reads the facts again", async () => {
		const seen = await crash("kept", "in_queue", "ejected");

		expect(seen).toMatchObject({factReads: 1, enqueueCalls: 1, enqueueWrites: 1, lane: "build"});
	});

	it("the operator's state at each kill: the ask in flight, or the lane line in flight", async () => {
		const at = await Promise.all(
			(["in_queue", "outcome_sent", "record_in_flight"] as const).map(
				async (point) => (await crash("kept", point, "landed")).savedAt,
			),
		);

		expect(at).toEqual(["handed", "handed", "recording"]);
	});
});
