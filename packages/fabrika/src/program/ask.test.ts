import {it} from "@effect/vitest";
import {Arbitrary, type Cause, Deferred, type Duration, Effect, Fiber, Schema} from "effect";
import {TestClock} from "effect/testing";
import {describe, expectTypeOf} from "vitest";
import {type AnyRun, defineProgram, end, fork, start, type Word, type Run} from "./program.ts";
import {input} from "./shape.ts";

// Run.ask (tracker 411, today's version): hand a value to an input and wait until the handler for
// THAT value returns, or the caller's time is up. `tell` and `offer` keep their meaning: they answer
// when the mailbox admits the value. The laws here are L5 to L8 and L11 of the plan, on real `start`
// and `serve`, with TestClock for the time: a wait is simulated, never slept.
//
// `ask` is not on `Run` before the build, so every law reaches it through `askOf`: the file runs,
// and each law fails cleanly with "Run.ask is missing" until the build adds it.
//
//   ask(name, value, within): Effect<Word, Cause.TimeoutError>
//   // "queued": the value was admitted, and its handler returned, or `within` ran out while it ran
//   // TimeoutError: the value never entered the mailbox in `within`; nothing is sent later

const OPTS = {seed: 119120, runs: 200, concurrency: 1} as const;

/** `Run.ask`, as the plan's sketch gives it. */
interface Asking {
	readonly ask: (
		name: string,
		value: unknown,
		within: Duration.Input,
	) => Effect.Effect<Word, Cause.TimeoutError>;
}
const isAsking = (run: AnyRun): run is AnyRun & Asking =>
	typeof Reflect.get(run, "ask") === "function";
const askOf = (run: AnyRun, name: string, value: unknown, within: Duration.Input) =>
	isAsking(run) ? run.ask(name, value, within) : Effect.die("Run.ask is missing");

/** Run a property and fail with fast-check's own report of the shrunk case. */
const holds = <A, R>(
	arb: Arbitrary.Arbitrary<A>,
	body: (a: A) => Effect.Effect<void, unknown, R>,
) =>
	Arbitrary.checkEffect(arb, (a) => body(a).pipe(Effect.as(true)), OPTS).pipe(
		Effect.flatMap((result) =>
			result._tag === "Passed"
				? Effect.void
				: Effect.die(Arbitrary.formatCheckFailure(result) ?? result._tag),
		),
	);

const settle = Effect.forEach(Array.from({length: 40}), () => Effect.yieldNow, {
	discard: true,
	concurrency: 1,
});
const ensure = (ok: boolean, what: string) => (ok ? Effect.void : Effect.fail(what));
const same = (what: string, actual: unknown, expected: unknown) =>
	ensure(
		JSON.stringify(actual) === JSON.stringify(expected),
		`${what}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`,
	);

/** A mailbox with an ordinary input, a control input and a manual one; every handler waits on `gate`. */
const lane = (options: {
	readonly gate: Deferred.Deferred<void>;
	readonly handled: string[];
	readonly capacity: number;
	readonly serving: boolean;
}) =>
	defineProgram({
		name: "lane",
		description: "Handlers that wait for a gate, to see when an ask is answered.",
		capacity: options.capacity,
		inputs: {
			plain: input(Schema.Int, "A number."),
			signal: input(Schema.Int, "A control number.", {control: true}),
			hand: input(Schema.Int, "A number, acked by hand.", {ack: "manual"}),
		},
		outputs: {},
		main: ({serve}) => {
			if (!options.serving) return Effect.never;
			const held = (label: string, n: number) =>
				Deferred.await(options.gate).pipe(
					Effect.andThen(Effect.sync(() => options.handled.push(`${label} ${n}`))),
				);
			return serve({
				// -1 ends serving and -2 fails it, each after the gate.
				plain: (n) =>
					n === -1
						? Deferred.await(options.gate).pipe(Effect.andThen(end))
						: n === -2
							? Deferred.await(options.gate).pipe(Effect.andThen(Effect.fail("boom" as const)))
							: held("plain", n),
				signal: fork((n) => held("signal", n)),
				hand: ({value, ack}) => ack.pipe(Effect.andThen(held("hand", value))),
			});
		},
	});

const begin = (options: {capacity?: number; serving?: boolean} = {}) =>
	Effect.gen(function* () {
		const gate = yield* Deferred.make<void>();
		const handled: string[] = [];
		const started = yield* start(
			lane({gate, handled, capacity: options.capacity ?? 100, serving: options.serving ?? true}),
			{},
		);
		if (started.kind !== "running") return yield* Effect.die("the lane did not start");
		return {gate, handled, started, run: started.run};
	});

const open = (gate: Deferred.Deferred<void>) => Deferred.succeed(gate, undefined);

/** The ask, forked, and whether it has answered yet. */
const asking = (run: AnyRun, name: string, value: unknown, within: Duration.Input) =>
	Effect.gen(function* () {
		if (!isAsking(run)) return yield* Effect.die("Run.ask is missing");
		const fiber = yield* Effect.forkChild(run.ask(name, value, within));
		yield* settle;
		return fiber;
	});
const pending = (fiber: Fiber.Fiber<Word, Cause.TimeoutError>) =>
	Effect.sync(() => fiber.pollUnsafe() === undefined);

const Within = Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 5000}));
const Small = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 3}));
const Count = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 1000}));

// -------------------------------------------------------------------------------- L5

describe("L5: a handler that never returns, or a main that never serves", () => {
	const BlockedInputs = Schema.Struct({
		serving: Schema.Boolean,
		within: Within,
		before: Small,
		value: Count,
	});

	it.effect(
		"answers queued only at the caller's time, keeps the value, and runs its handler once when let go",
		() =>
			holds(Arbitrary.schema(BlockedInputs), ({serving, within, before, value}) =>
				Effect.gen(function* () {
					const {gate, handled, run} = yield* begin({serving});
					for (let i = 0; i < before; i += 1) yield* run.offer("plain", 2000 + i);
					const fiber = yield* asking(run, "plain", value, within);
					yield* TestClock.adjust(within - 1);
					yield* settle;
					yield* ensure(yield* pending(fiber), "answered before its time");
					yield* TestClock.adjust(1);
					yield* settle;
					const word = yield* Fiber.join(fiber).pipe(Effect.exit);
					yield* same("the answer at the cap", word, {_tag: "Success", value: "queued"});
					// It was not cancelled: let go, and the handler runs once for this value.
					yield* open(gate);
					yield* settle;
					if (serving) {
						const mine = handled.filter((h) => h === `plain ${value}`).length;
						yield* same("runs of its handler after the cap", mine, 1);
					} else {
						yield* same("handled with no serve", handled, []);
						yield* same("unread kept", run.mailbox().inputs.plain.length, before + 1);
					}
				}).pipe(Effect.scoped),
			),
	);
});

// -------------------------------------------------------------------------------- L6

describe("L6: admission spends the caller's time", () => {
	const AdmissionOrders = Schema.Struct({
		within: Within,
		capacity: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 3})),
		room: Schema.Literals(["never", "early"]),
		freeAt: Count,
	});

	// Room opens exactly at the deadline, with TestClock one tick before, at and after it. Whatever the
	// answer, it must be true: an admitted value is "queued" and gets handled; an unadmitted one is a
	// TimeoutError and is never handled. Never "not queued" for a value that went in.
	it.effect(
		"room opening just before, at and after the deadline: the answer is true to whether the value was admitted",
		() =>
			holds(
				Arbitrary.schema(
					Schema.Struct({
						within: Within,
						capacity: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 3})),
						offset: Schema.Literals([-1, 0, 1]),
					}),
				),
				({within, capacity, offset}) =>
					Effect.gen(function* () {
						const {gate, handled, run} = yield* begin({capacity});
						for (let i = 0; i < capacity + 1; i += 1) yield* run.offer("plain", 3000 + i);
						yield* settle;
						const fiber = yield* asking(run, "plain", 1, within);
						yield* TestClock.adjust(Math.max(0, within + offset));
						yield* open(gate);
						yield* settle;
						const exit = yield* Fiber.join(fiber).pipe(Effect.exit);
						const admitted = handled.includes("plain 1");
						const waiting = run.mailbox().inputs.plain.waiting;
						yield* same("a waiter left behind", waiting, 0);
						if (exit._tag === "Success") {
							yield* same("the word", exit.value, "queued");
							yield* ensure(admitted, "answered queued, but the value was never handled");
						} else {
							yield* ensure(
								!admitted,
								"answered not queued, but the value was admitted and handled",
							);
						}
						if (offset === -1)
							yield* ensure(exit._tag === "Success", "room before the deadline did not admit it");
					}).pipe(Effect.scoped),
			),
	);

	it.effect(
		"a full mailbox times out unadmitted: TimeoutError, no waiter left, nothing sent later; room before the time admits it and says queued",
		() =>
			holds(Arbitrary.schema(AdmissionOrders), ({within, capacity, room, freeAt}) =>
				Effect.gen(function* () {
					const {gate, handled, run} = yield* begin({capacity});
					// One in the handler's hand, `capacity` waiting: no room for one more.
					const told = capacity + 1;
					for (let i = 0; i < told; i += 1) yield* run.offer("plain", 3000 + i);
					yield* settle;
					const fiber = yield* asking(run, "plain", 1, within);
					yield* same("waiting for room", run.mailbox().inputs.plain.waiting, 1);
					const at = Math.min(freeAt, within - 1);
					if (room === "early") {
						yield* TestClock.adjust(at);
						yield* open(gate);
						yield* settle;
						const answer = yield* Fiber.join(fiber).pipe(Effect.exit);
						yield* same("admitted in time", answer, {_tag: "Success", value: "queued"});
						yield* ensure(handled.includes("plain 1"), "admitted, but never handled");
						return;
					}
					yield* TestClock.adjust(within - 1);
					yield* settle;
					yield* ensure(yield* pending(fiber), "answered before its time");
					yield* TestClock.adjust(1);
					yield* settle;
					const exit = yield* Fiber.join(fiber).pipe(
						Effect.flip,
						Effect.map((e) => e._tag),
					);
					yield* same("the unadmitted answer", exit, "TimeoutError");
					yield* same("a waiter left behind", run.mailbox().inputs.plain.waiting, 0);
					yield* open(gate);
					yield* settle;
					yield* ensure(!handled.includes("plain 1"), "a timed-out value was sent later");
					yield* same("handled", handled.length, told);
				}).pipe(Effect.scoped),
			),
	);
});

// -------------------------------------------------------------------------------- L7

describe("L7: an ending releases every accepted ask", () => {
	const Endings = Schema.Struct({
		ending: Schema.Literals(["stop", "failure", "natural"]),
		asks: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 4})),
		unread: Small,
	});
	const IN_HAND = {stop: 7, failure: -2, natural: -1} as const;

	/** One value in hand, then `asks` told behind it, then `unread` offered; the run ends in `ending`. */
	const scenario = (
		ending: "stop" | "failure" | "natural",
		asks: number,
		unread: number,
		via: "ask" | "offer",
	) =>
		Effect.gen(function* () {
			const {gate, run, started} = yield* begin();
			yield* run.offer("plain", IN_HAND[ending]);
			yield* settle;
			const fibers: Fiber.Fiber<Word, Cause.TimeoutError>[] = [];
			for (let i = 0; i < asks; i += 1)
				fibers.push(
					via === "ask"
						? yield* asking(run, "plain", 10 + i, "5 seconds")
						: yield* Effect.forkChild(run.offer("plain", 10 + i)),
				);
			for (let i = 0; i < unread; i += 1) yield* run.offer("plain", 20 + i);
			yield* settle;
			// Stop ends it from outside; the other two end it from the handler in hand, once let go.
			const ended =
				ending === "stop" ? yield* started.stop : yield* open(gate).pipe(Effect.andThen(run.ended));
			yield* settle;
			const words = yield* Effect.forEach(fibers, (f) => Fiber.join(f).pipe(Effect.exit), {
				concurrency: 1,
			});
			return {ended, words};
		}).pipe(Effect.scoped);

	it.effect(
		"stop, failure and natural end release accepted asks, unread values included, and leave the unread counts offer leaves",
		() =>
			holds(Arbitrary.schema(Endings), ({ending, asks, unread}) =>
				Effect.gen(function* () {
					const asked = yield* scenario(ending, asks, unread, "ask");
					const offered = yield* scenario(ending, asks, unread, "offer");
					yield* same(
						"every ask released by the end, none left hanging",
						asked.words.map((w) => (w._tag === "Success" ? w.value : w._tag)),
						asked.words.map(() => "queued"),
					);
					yield* same("unread counts", asked.ended.unread, offered.ended.unread);
					yield* same("how it ended", asked.ended.kind, offered.ended.kind);
				}),
			),
	);
});

describe("L7: a temporary return from serve", () => {
	const Later = Schema.Struct({
		asks: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 4})),
		value: Count,
	});

	it.effect(
		"does not discard later asks: they stay unread and unanswered, and a second serve handles them in order and releases each receipt",
		() =>
			holds(Arbitrary.schema(Later), ({asks, value}) =>
				Effect.gen(function* () {
					const returned = yield* Deferred.make<void>();
					const again = yield* Deferred.make<void>();
					const handled: number[] = [];
					const twice = defineProgram({
						name: "again",
						description: "Serves until its first input closes, waits, then serves the rest.",
						inputs: {first: input(Schema.Int, "A number."), later: input(Schema.Int, "A number.")},
						outputs: {},
						main: ({serve}) =>
							Effect.gen(function* () {
								const handlers = {
									first: () => Effect.void,
									later: (n: number) => Effect.sync(() => handled.push(n)),
								};
								yield* serve(handlers, {until: ["first"]});
								yield* Deferred.succeed(returned, undefined);
								yield* Deferred.await(again);
								yield* serve(handlers);
							}),
					});
					const started = yield* start(twice, {});
					if (started.kind !== "running") return yield* Effect.die("did not start");
					const {run} = started;
					started.close("first");
					yield* Deferred.await(returned);
					const fibers: Fiber.Fiber<Word, Cause.TimeoutError>[] = [];
					for (let i = 0; i < asks; i += 1)
						fibers.push(yield* asking(run, "later", value + i, "5 seconds"));
					yield* settle;
					for (const f of fibers) yield* ensure(yield* pending(f), "released by serve's return");
					yield* same("unread kept", run.mailbox().inputs.later.length, asks);
					yield* same("handled before the second serve", handled, []);
					yield* open(again);
					yield* settle;
					const words = yield* Effect.forEach(fibers, (f) => Fiber.join(f), {concurrency: 1});
					yield* same(
						"the second serve's answers",
						words,
						words.map(() => "queued"),
					);
					yield* same(
						"handled by the second serve, in order",
						handled,
						Array.from({length: asks}, (_, i) => value + i),
					);
				}).pipe(Effect.scoped),
			),
	);
});

// -------------------------------------------------------------------------------- L8

describe("L8: input modes", () => {
	const InputModes = Schema.Struct({
		mode: Schema.Literals(["control", "manual"]),
		before: Small,
		value: Count,
	});

	it.effect(
		"a control or manual ask waits for its own handler's exit, not its launch or its ack, while ordinary work is blocked",
		() =>
			holds(Arbitrary.schema(InputModes), ({mode, before, value}) =>
				Effect.gen(function* () {
					const {gate, handled, run} = yield* begin();
					const label = mode === "control" ? "signal" : "hand";
					const name = mode === "control" ? "signal" : "hand";
					for (let i = 0; i < before; i += 1) yield* run.offer("plain", 5000 + i);
					const fiber = yield* asking(run, name, value, "5 seconds");
					yield* ensure(
						yield* pending(fiber),
						`a ${mode} ask answered before its handler returned`,
					);
					yield* open(gate);
					yield* settle;
					const word = yield* Fiber.join(fiber);
					yield* same("the word", word, "queued");
					yield* ensure(
						handled.includes(`${label} ${value}`),
						`answered before ${label} ${value} was handled`,
					);
				}).pipe(Effect.scoped),
			),
	);

	it.effect("tell and offer still answer on admission, with every handler blocked", () =>
		holds(Arbitrary.schema(InputModes), ({mode, value}) =>
			Effect.gen(function* () {
				const {handled, run} = yield* begin();
				const name = mode === "control" ? "signal" : "hand";
				const told = yield* run.tell(name, value).pipe(Effect.orDie);
				const offered = yield* run.offer(name, value + 1);
				yield* same("tell and offer", [told, offered], ["queued", "queued"]);
				yield* same("nothing handled yet", handled, []);
			}).pipe(Effect.scoped),
		),
	);
});

// -------------------------------------------------------------------------------- L11

describe("L11: ask answers the words offer answers", () => {
	const Situations = Schema.Struct({
		situation: Schema.Literals(["admitted", "closed", "bad_shape", "no_cell", "stopped"]),
		value: Count,
	});

	const answer = (situation: string, value: number, via: "ask" | "offer") =>
		Effect.gen(function* () {
			const {gate, run, started} = yield* begin();
			yield* open(gate);
			let name = "plain";
			let sent: unknown = value;
			if (situation === "closed") started.close("plain");
			if (situation === "bad_shape") sent = "not a number";
			if (situation === "no_cell") name = "nowhere";
			if (situation === "stopped") yield* started.stop;
			yield* settle;
			return yield* via === "ask" ? askOf(run, name, sent, "5 seconds") : run.offer(name, sent);
		}).pipe(Effect.scoped);

	it.effect("for every situation, ask says the word offer says, and only Word's values", () =>
		holds(Arbitrary.schema(Situations), ({situation, value}) =>
			Effect.gen(function* () {
				const viaAsk = yield* answer(situation, value, "ask");
				const viaOffer = yield* answer(situation, value, "offer");
				yield* same("word", viaAsk, viaOffer);
			}),
		),
	);

	it("is typed as the plan gives it: Word, and Effect's own TimeoutError", () => {
		type AskOf<R> = R extends {ask: (...args: infer A) => infer Out} ? [A, Out] : never;
		expectTypeOf<AskOf<Run<any, any, any, any, any>>>().toEqualTypeOf<
			[
				[name: string, value: unknown, within: Duration.Input],
				Effect.Effect<Word, Cause.TimeoutError>,
			]
		>();
	});
});
