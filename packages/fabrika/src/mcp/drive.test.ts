import {defineMachine} from "@demlik/tea";
import {it} from "@effect/vitest";
import {Arbitrary, Deferred, Effect, Fiber, Layer, Schema, Tracer} from "effect";
import {TestClock} from "effect/testing";
import {describe} from "vitest";
import {listed} from "../program/listed.ts";
import {defineProgram, end, kind} from "../program/program.ts";
import {input} from "../program/shape.ts";
import {ATTR} from "../program/trace.ts";
import {programList} from "../shell/programs.ts";
import {type Answer, driveFor} from "./drive.ts";

// An MCP call on a program input answers with the view its OWN input made (tracker 411, today's
// version). Before the fix `drive` offered the value, got "queued" on admission and read the view at
// once: the answer showed the state from before the input was handled, and a client that asked twice
// saw each answer one step late. These laws run the real `driveFor`, `start` and `serve`; the one
// program here keeps the numbers its handlers saw, and its view is that list.
//
//   gated_put {value: {p: 5, turns: 2}}   handler: 2 turns, then it saw 5
//   // {kind: "done", data: {program: "gated", run: "gated:agent:..", word: "queued", view: {seen: [.., 5]}}}
//
// Time is TestClock's. No follow-up call, sleep or poll may repair the answer under test.

const OPTS = {seed: 119120, runs: 200, concurrency: 1} as const;

const holds = <A, R>(arb: Arbitrary.Arbitrary<A>, body: (a: A) => Effect.Effect<void, string, R>) =>
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

const Turns = Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 3}));
const Payload = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 2}));
const Seen = Schema.Struct({seen: Schema.Array(Schema.Int)});
const Put = Schema.Struct({p: Schema.Int, turns: Schema.Int});

const log = defineMachine({
	types: {
		model: {} as typeof Seen.Type,
		msg: {} as {readonly type: "saw"; readonly p: number},
		ctx: undefined,
	},
	cmds: [],
	init: (loaded) => [loaded ?? {seen: []}, []],
	update: {saw: (s, m) => [{seen: [...s.seen, m.p]}, []]},
});

/** A program whose inputs wait `turns`, then `block`, then log the number they were told. */
const gated = (block: Effect.Effect<void>, capacity = 100) =>
	defineProgram({
		name: "gated",
		description: "Logs the numbers it is told, each after some turns and a gate.",
		capacity,
		inputs: {put: input(Put, "A number."), note: input(Put, "Another number.")},
		outputs: {},
		machines: {
			log: kind({
				machine: log,
				state: Seen,
				parent: "main",
				options: () => ({ctx: undefined}),
				drawing: () => ({name: "log", steps: {}}),
				status: (s) => `${s.seen.length} seen`,
			}),
		},
		view: {machine: "log", data: Seen, of: (s) => ({seen: s.seen})},
		main: ({serve, machines}) =>
			Effect.gen(function* () {
				const logged = yield* machines.log.get("log").start();
				const handle = ({p, turns}: typeof Put.Type) =>
					Effect.forEach(Array.from({length: turns}), () => Effect.yieldNow, {
						discard: true,
						concurrency: 1,
					}).pipe(
						Effect.andThen(block),
						Effect.andThen(logged.dispatch({type: "saw", p}).pipe(Effect.orDie)),
					);
				yield* serve({put: handle, note: handle});
			}).pipe(Effect.scoped),
	});

const driving = (block: Effect.Effect<void> = Effect.void, capacity?: number) =>
	driveFor({
		list: programList([listed(gated(block, capacity), Layer.empty)]),
		tiles: () => [],
	}).pipe(Effect.map(({drive}) => drive));

type Driving = Effect.Success<ReturnType<typeof driving>>;

const put = (drive: Driving, to: "put" | "note", p: number, turns: number) =>
	drive.call(`gated_${to}`, {value: {p, turns}});

/** The view an answer holds, or why it is not a done answer. */
const seenIn = (answer: Answer): readonly number[] | string => {
	if (answer.kind !== "done") return `refused: ${answer.why}`;
	const view: unknown = Reflect.get(Object(answer.data), "view");
	const seen: unknown = Reflect.get(Object(view), "seen");
	return Array.isArray(seen) ? seen : `no view in ${JSON.stringify(answer.data)}`;
};

const forked = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(effect);
		yield* settle;
		return fiber;
	});
const pending = (fiber: Fiber.Fiber<unknown, unknown>) =>
	Effect.sync(() => fiber.pollUnsafe() === undefined);

// -------------------------------------------------------------------------------- L1

describe("L1: every call returns the view for its own input", () => {
	const InputSequences = Schema.Array(
		Schema.Struct({to: Schema.Literals(["put", "note"]), p: Payload, turns: Turns}),
	).check(Schema.isBetweenLength(2, 12));

	it.effect(
		"in a sequence over two inputs, with repeated values, call i shows the i+1 values handled so far, its own last",
		() =>
			holds(Arbitrary.schema(InputSequences), (calls) =>
				Effect.gen(function* () {
					const drive = yield* driving();
					const answers: Array<readonly number[] | string> = [];
					for (const c of calls) answers.push(seenIn(yield* put(drive, c.to, c.p, c.turns)));
					yield* same(
						"each answer's view",
						answers,
						calls.map((_, i) => calls.slice(0, i + 1).map((c) => c.p)),
					);
				}).pipe(Effect.scoped),
			),
	);

	it.effect("callers at once on one connection each get a view that ends in their own value", () =>
		holds(Arbitrary.schema(InputSequences), (calls) =>
			Effect.gen(function* () {
				const drive = yield* driving();
				// Distinct numbers, so an answer can only end in its own caller's value.
				const answers = yield* Effect.forEach(
					calls.map((c, i) => ({...c, p: i})),
					(c) => put(drive, c.to, c.p, c.turns).pipe(Effect.map((a) => [c.p, seenIn(a)] as const)),
					{concurrency: "unbounded"},
				);
				for (const [p, seen] of answers)
					yield* ensure(
						typeof seen !== "string" && seen.at(-1) === p,
						`the call for ${p} was answered with ${JSON.stringify(seen)}`,
					);
			}).pipe(Effect.scoped),
		),
	);
});

// -------------------------------------------------------------------------------- the cap

describe("one 5 s deadline for a program-input call", () => {
	const Capacity = Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 3}));
	const Start = Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 4000}));

	it.effect(
		"a handler that never returns: the call answers queued at 5 s, in the old done shape, and the work goes on",
		() =>
			holds(Arbitrary.schema(Schema.Struct({p: Payload, turns: Turns})), ({p, turns}) =>
				Effect.gen(function* () {
					const gate = yield* Deferred.make<void>();
					const drive = yield* driving(Deferred.await(gate));
					const call = yield* forked(put(drive, "put", p, turns));
					yield* TestClock.adjust(4999);
					yield* settle;
					yield* ensure(yield* pending(call), "answered before 5 s");
					yield* TestClock.adjust(1);
					yield* settle;
					const answer = yield* Fiber.join(call);
					yield* same("the done answer", answer.kind, "done");
					const data = answer.kind === "done" ? Object(answer.data) : {};
					yield* same("its fields, as before", Object.keys(data).sort(), [
						"program",
						"run",
						"view",
						"word",
					]);
					yield* same(
						"word and view",
						[Reflect.get(data, "word"), Reflect.get(data, "view")],
						["queued", {seen: []}],
					);
					// Not cancelled: let go, and the one handler finishes once.
					yield* Deferred.succeed(gate, undefined);
					yield* settle;
					const runs = yield* drive.call("runs", {});
					const yours = runs.kind === "done" ? Reflect.get(Object(runs.data), "yours") : [];
					yield* same("its view later", Reflect.get(Object(yours[0]), "view"), {seen: [p]});
				}).pipe(Effect.scoped),
			),
	);

	it.effect(
		"waiting for the connection's permit spends the same 5 s: the second call answers 5 s after it began, not after it got the permit",
		() =>
			holds(Arbitrary.schema(Start), (later) =>
				Effect.gen(function* () {
					const gate = yield* Deferred.make<void>();
					const drive = yield* driving(Deferred.await(gate));
					const first = yield* forked(put(drive, "put", 1, 1));
					yield* TestClock.adjust(later);
					const second = yield* forked(put(drive, "put", 2, 1));
					// The first answers at 5000 and frees the permit; the second began at `later`.
					yield* TestClock.adjust(5000 - later);
					yield* settle;
					yield* ensure(!(yield* pending(first)), "the first call did not answer at 5 s");
					yield* TestClock.adjust(later - 1);
					yield* settle;
					yield* ensure(yield* pending(second), "the second answered before its own 5 s");
					yield* TestClock.adjust(1);
					yield* settle;
					yield* ensure(!(yield* pending(second)), "the second kept waiting past its own 5 s");
				}).pipe(Effect.scoped),
			),
	);

	it.effect(
		"a value the full mailbox never admitted in 5 s is refused, not queued, and is not sent later",
		() =>
			holds(Arbitrary.schema(Capacity), (capacity) =>
				Effect.gen(function* () {
					const gate = yield* Deferred.make<void>();
					const drive = yield* driving(Deferred.await(gate), capacity);
					// One in the handler's hand and `capacity` waiting: the next finds the mailbox full.
					// Calls go one at a time, so each is answered at its own 5 s.
					const answers: Answer[] = [];
					for (let p = 1; p <= capacity + 2; p += 1) {
						const call = yield* forked(put(drive, "put", p, 1));
						yield* TestClock.adjust(5000);
						yield* settle;
						yield* ensure(!(yield* pending(call)), `call ${p} did not answer at its 5 s`);
						answers.push(yield* Fiber.join(call));
					}
					yield* Deferred.succeed(gate, undefined);
					yield* settle;
					const kinds = answers.map((a) => a.kind);
					yield* same("answers", kinds, [...Array(capacity + 1).fill("done"), "refused"]);
					const last = answers.at(-1);
					yield* ensure(
						last?.kind === "refused" && /not queued/.test(last.why),
						`the refusal does not say the input was not queued: ${JSON.stringify(last)}`,
					);
					const runs = yield* drive.call("runs", {});
					const yours = runs.kind === "done" ? Reflect.get(Object(runs.data), "yours") : [];
					yield* same("what was handled", Reflect.get(Object(yours[0]), "view"), {
						seen: Array.from({length: capacity + 1}, (_, i) => i + 1),
					});
				}).pipe(Effect.scoped),
			),
	);
});

// -------------------------------------------------------------------------------- slow start

describe("a start that outlives its call's 5 s, and a run that ended", () => {
	// A program with one input, `quit`, that ends the run when handled. Its layer counts the starts
	// and takes `boot` ms of TestClock to build, so the start itself can be slower than the call.
	const starts = (boot: number) =>
		Effect.gen(function* () {
			let count = 0;
			const quitter = defineProgram({
				name: "quitter",
				description: "Quits when told.",
				inputs: {quit: input(Schema.Int, "A number.")},
				outputs: {},
				main: ({serve}) => serve({quit: () => end}),
			});
			const slow = Layer.effectDiscard(
				Effect.sync(() => {
					count += 1;
				}).pipe(Effect.andThen(Effect.sleep(boot))),
			);
			const {drive} = yield* driveFor({
				list: programList([listed(quitter, slow)]),
				tiles: () => [],
			});
			return {drive, count: () => count};
		});

	// pinned: the start goes on in the connection's scope after its call gave up (drive.ts `runOf`).
	// The call that gave up says not queued; the next call joins that one start (it never starts a
	// second run), and once it is up, answers with its own view.
	it.effect(
		"pinned: a start slower than 5 s refuses its call as not queued, the next call joins the same start, and a quit run starts fresh",
		() =>
			holds(
				Arbitrary.schema(Schema.Int.check(Schema.isBetween({minimum: 5001, maximum: 9000}))),
				(boot) =>
					Effect.gen(function* () {
						const {drive, count} = yield* starts(boot);
						const first = yield* forked(drive.call("quitter_quit", {value: 1}));
						yield* TestClock.adjust(5000);
						yield* settle;
						const refused = yield* Fiber.join(first);
						yield* ensure(
							refused.kind === "refused" && /not queued/.test(refused.why),
							`a start past 5 s did not say not queued: ${JSON.stringify(refused)}`,
						);
						const second = yield* forked(drive.call("quitter_quit", {value: 2}));
						yield* TestClock.adjust(boot - 5000);
						yield* settle;
						const done = yield* Fiber.join(second);
						yield* same("the joined start's answer", done.kind, "done");
						yield* same("starts so far", count(), 1);
						// That run quit; the next call starts a fresh one, not the ended run it left behind.
						const third = yield* forked(drive.call("quitter_quit", {value: 3}));
						yield* TestClock.adjust(5000);
						yield* settle;
						yield* Fiber.join(third);
						yield* same("starts after the quit", count(), 2);
						yield* TestClock.adjust(boot - 5000);
						yield* settle;
						const fourth = yield* drive.call("quitter_quit", {value: 4});
						yield* same("the fresh run's answer", fourth.kind, "done");
					}).pipe(Effect.scoped),
			),
	);
});

// -------------------------------------------------------------------------------- L10 [secrets]

describe("L10 [secrets]: what the ask records", () => {
	const Words = Schema.String.check(Schema.isPattern(/^[a-z]{6,12}$/));
	const PrivatePayloads = Schema.Struct({secret: Words, blocked: Schema.Boolean});

	const Text = Schema.Struct({text: Schema.String});
	const said = defineProgram({
		name: "said",
		description: "Takes a text and does nothing with it.",
		inputs: {text: input(Text, "A text.")},
		outputs: {},
		main: ({serve}) => serve({text: ({text}) => Effect.sync(() => text.length)}),
	});

	/** Every event on every span the effect made, as `name` plus its attributes in text. */
	const eventsOf = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
		const events: Array<{name: string; text: string; input: unknown}> = [];
		const tracer = Tracer.make({
			span: (options) => {
				const span = new Tracer.NativeSpan(options);
				const event = span.event.bind(span);
				span.event = (name, time, attributes) => {
					events.push({
						name,
						text: `${name} ${JSON.stringify(attributes ?? {})}`,
						input: attributes?.[ATTR.input],
					});
					event(name, time, attributes);
				};
				return span;
			},
		});
		return effect.pipe(
			Effect.withTracer(tracer),
			Effect.map((a) => ({a, events})),
		);
	};

	it.effect(
		"completion and timeout events name the input and the clock, never the generated payload text",
		() =>
			holds(Arbitrary.schema(PrivatePayloads), ({secret, blocked}) =>
				Effect.gen(function* () {
					const {drive} = yield* driveFor({
						list: programList([
							listed(
								blocked
									? defineProgram({
											name: "said",
											description: said.description,
											inputs: said.inputs,
											outputs: {},
											main: ({serve}) => serve({text: () => Effect.never}),
										})
									: said,
								Layer.empty,
							),
						]),
						tiles: () => [],
					});
					const {events} = yield* eventsOf(
						Effect.gen(function* () {
							const call = yield* forked(drive.call("said_text", {value: {text: secret}}));
							if (blocked) yield* TestClock.adjust(5000);
							yield* settle;
							yield* Fiber.join(call);
						}),
					);
					yield* ensure(
						events.every((e) => !e.text.includes(secret)),
						"a trace event holds the payload text",
					);
					// The new events: not the `told` mark, and each names its input.
					const reply = events.filter(
						(e) =>
							!e.name.startsWith("told ") && !e.name.startsWith("unread ") && e.input === "text",
					);
					yield* ensure(reply.length >= 1, "no completion or timeout event names the input");
				}).pipe(Effect.scoped),
			),
	);
});
