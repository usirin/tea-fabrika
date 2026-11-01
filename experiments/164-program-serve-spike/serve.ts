import {
	type BadShape,
	CAPACITY,
	capacityOf,
	type Program as Defined,
	type Run as DefinedRun,
	type Delivery,
	input as declareInput,
	defineProgram,
	type Ended,
	type Flags,
	type Given,
	type Heard,
	type Input,
	type Inputs,
	type KeepingOf,
	type Kinds,
	type Kit,
	type Listeners,
	type Outputs,
	type Parented,
	type PayloadOf,
	type StandardShape,
	start as startDefined,
	type Told,
	type Unread,
	type Watch,
	type Word,
} from "@kampus/fabrika";
import {
	type Cause,
	Deferred,
	Effect,
	Fiber,
	FiberSet,
	Queue,
	Schema,
	type Scope,
	Stream,
} from "effect";

// A throwaway spike (experiment 164): shape B of the program API study. One
// mailbox per run, in arrival order, and `main` hands `serve` one handler per
// input. Nothing in the repo uses it but the spike's own ports and tests. The
// names are Effect's (`make`, `input`, `fork`, `end`, `MailboxFull`) and stay
// in this file: read it as `import * as Program from "./serve.ts"`.
//
// A record since 2026-10-30: shape B was built into the runtime itself in
// https://github.com/usirin/tea-fabrika/pull/195. This file rode on the
// runtime before that, and was moved here out of `@kampus/fabrika` unchanged
// but for its imports. It no longer runs on main: it reads its hidden input
// as a stream from the kit, and since #195 the kit hands `serve` instead.
//
//   const echo = Program.make("echo", {
//     description: "Says back each number.",
//     inputs: {n: Program.input(Schema.Int, "A number."), quit: Program.input(Schema.Null, "Stop.")},
//     outputs: {said: output(Schema.Int, "The same number.")},
//     main: ({serve, send}) => serve({n: (n) => send("said", n), quit: () => Program.end}),
//   });
//   yield* Program.tell(run, "n", 1);      // "queued"; fails MailboxFull past the program's capacity
//   yield* Program.tell(run, "quit", null); // handled after 1, never before it
//
// How it runs: it rides on today's runtime. The program it makes is a
// `defineProgram` program with one hidden input, `letters`: every value told
// to any input and every close goes on that one line, in the order told, so
// today's storage, machines, kit and spans work unchanged. What the spike does
// not carry: a close kept on the run's record, pipes into its inputs, and a
// pipe's outbox. The real change would put the mailbox in `begin`.
//
// The bound is Effect cluster's (`entityManager.ts`, `MailboxFull`): values
// told and not yet handled, from every input together. A value is handled
// when its handler's Effect ends, so a pile of values behind a slow handler
// counts, and so does a forked handler still running.

/** What a handler of one input is handed: its value, or a `manual` input's delivery. */
export type ValueOf<D> = D extends Input<infer T, "manual"> ? Delivery<T> : PayloadOf<D>;

const EndId: unique symbol = Symbol.for("@kampus/fabrika/spike/serve/End");
/** What a handler answers to stop serving. */
export interface End {
	readonly [EndId]: typeof EndId;
}
const ending: End = {[EndId]: EndId};
/** Stop serving after this value: whatever is still in the mailbox stays unread. */
export const end: Effect.Effect<End> = Effect.succeed(ending);
const isEnd = (value: unknown): value is End =>
	typeof value === "object" && value !== null && EndId in value;

/** One input's handler: run once per value, one value at a time, in arrival order. */
export type Handler<A, E, R> = (value: A) => Effect.Effect<unknown, E, R>;

const ForkedId: unique symbol = Symbol.for("@kampus/fabrika/spike/serve/Forked");
/** A handler that runs beside the order: Effect's `Rpc.fork`. */
export interface Forked<A, E, R> {
	readonly [ForkedId]: typeof ForkedId;
	readonly handler: (value: A) => Effect.Effect<unknown, E, R>;
}
/**
 * Run this input's handler beside the order, at once, as each value is read:
 * a value of it never waits behind a slow handler, and nothing waits behind it.
 */
export const fork = <A, E, R>(
	handler: (value: A) => Effect.Effect<unknown, E, R>,
): Forked<A, E, R> => ({
	[ForkedId]: ForkedId,
	handler,
});
const isForked = (handler: unknown): handler is Forked<unknown, unknown, unknown> =>
	typeof handler === "object" && handler !== null && ForkedId in handler;

/** One handler per input, typed by that input. */
export type Handlers<I extends Inputs> = {
	readonly [K in keyof I]: Handler<ValueOf<I[K]>, any, any> | Forked<ValueOf<I[K]>, any, any>;
};
/** The errors of a handler table. */
export type ErrorOf<H> = {
	[K in keyof H]: H[K] extends Forked<any, infer E, any>
		? E
		: H[K] extends Handler<any, infer E, any>
			? E
			: never;
}[keyof H];
/** The services of a handler table. */
export type ServicesOf<H> = {
	[K in keyof H]: H[K] extends Forked<any, any, infer R>
		? R
		: H[K] extends Handler<any, any, infer R>
			? R
			: never;
}[keyof H];

export interface ServeOptions<I extends Inputs> {
	/** Stop serving once these inputs have closed, stdin's end. Left out: once every input has. */
	readonly until?: ReadonlyArray<keyof I & string>;
}

/**
 * Read the mailbox until it ends: each value to its input's handler, one
 * after another, in arrival order. A forked handler starts at once, beside the
 * order. Every input needs a handler, and a name that is no input is refused.
 */
export type Serve<I extends Inputs> = <H extends Handlers<I>>(
	handlers: H & {readonly [K in Exclude<keyof H, keyof I>]: never},
	options?: ServeOptions<I>,
) => Effect.Effect<void, ErrorOf<H>, ServicesOf<H>>;

/** What `main` is handed: today's kit, `watch`, and `serve` in place of `inputs`. */
export interface Io<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ks extends Kinds,
> extends Kit<F, O, Ks> {
	readonly watch: Watch<Ks>;
	readonly serve: Serve<I>;
}

/** One thing on the mailbox: a value told to an input, or its close. */
type Letter =
	| {
			readonly kind: "told";
			readonly to: string;
			readonly told: Delivery<unknown>;
			/** Its handler has ended: it no longer counts against the capacity. */
			readonly handled: Effect.Effect<void>;
	  }
	| {readonly kind: "closed"; readonly to: string};
type ToldLetter = Extract<Letter, {readonly kind: "told"}>;

/** The hidden line takes any letter: each value was checked against its own input when it was told. */
const anyLetter: StandardShape<Letter> = {
	"~standard": {
		version: 1,
		vendor: "spike-serve",
		// Only the spike's own `tell` puts a letter on this line.
		validate: (value) => ({value: value as Letter}),
	},
};

type Hidden = {readonly letters: Input<Letter, "auto">};

/** A program made by {@link make}: its own declarations, and the program of today it rides on. */
export interface Serving<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ks extends Kinds,
	E,
	R,
> {
	readonly name: string;
	readonly description: string;
	readonly flags: F;
	readonly inputs: I;
	readonly outputs: O;
	readonly machines: Ks;
	/** Values the mailbox holds told and not yet handled, from every input together. */
	readonly capacity: number;
	readonly inner: Defined<F, Hidden, O, Ks, E, R>;
}

/** What {@link make} takes beside the name. */
export interface Definition<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ks extends Kinds,
	E,
	R,
> {
	readonly description: string;
	readonly flags?: F;
	readonly inputs: I;
	readonly outputs: O;
	readonly machines?: Ks;
	/** The mailbox's capacity: told and not yet handled, every input together. `CAPACITY` (1000) when left out. */
	readonly capacity?: number;
	readonly main: (io: Io<F, I, O, Ks>) => Effect.Effect<void, E, R>;
}

/** `serve`, over the hidden line: one puller that never waits on a handler, and one in-order lane. */
const serveOn = <I extends Inputs>(letters: Stream.Stream<Letter>, inputs: I): Serve<I> => {
	const handed = (letter: ToldLetter): unknown =>
		inputs[letter.to]?.ack === "manual" ? letter.told : letter.told.value;
	const serve = (
		handlers: Readonly<Record<string, unknown>>,
		options?: ServeOptions<I>,
	): Effect.Effect<void, unknown, unknown> =>
		Effect.gen(function* () {
			const open = new Set<string>(options?.until ?? Object.keys(inputs));
			const lane = yield* Queue.unbounded<ToldLetter, Cause.Done>();
			const forks = yield* FiberSet.make<unknown, never>();
			const failed = yield* Deferred.make<never, unknown>();
			const run = (
				letter: ToldLetter,
				handler: unknown,
			): Effect.Effect<unknown, unknown, unknown> =>
				typeof handler === "function"
					? Effect.suspend(() => handler(handed(letter))).pipe(Effect.ensuring(letter.handled))
					: Effect.die(new Error(`no handler for ${letter.to}`));
			// The runtime keeps pulling, as Effect's RPC server does: a forked value starts at once,
			// every other one waits its turn on the lane.
			const pull = letters.pipe(
				Stream.runForEachWhile((letter) =>
					Effect.suspend(() => {
						if (letter.kind === "closed") {
							open.delete(letter.to);
							if (open.size > 0) return Effect.succeed(true);
							Queue.endUnsafe(lane);
							return Effect.succeed(false);
						}
						const handler = handlers[letter.to];
						if (isForked(handler))
							return FiberSet.run(
								forks,
								run(letter, handler.handler).pipe(
									Effect.asVoid,
									Effect.catchCause((cause) => Deferred.failCause(failed, cause)),
								),
							).pipe(Effect.as(true));
						Queue.offerUnsafe(lane, letter);
						return Effect.succeed(true);
					}),
				),
				Effect.catchCause((cause) => Deferred.failCause(failed, cause)),
			);
			const work = Stream.fromQueue(lane).pipe(
				Stream.runForEachWhile((letter) =>
					run(letter, handlers[letter.to]).pipe(Effect.map((answer) => !isEnd(answer))),
				),
			);
			const puller = yield* Effect.forkScoped(pull);
			yield* Effect.raceFirst(
				work.pipe(
					Effect.andThen(Fiber.interrupt(puller)),
					Effect.andThen(FiberSet.awaitEmpty(forks)),
				),
				Deferred.await(failed),
			);
		}).pipe(Effect.scoped);
	// The table's types are checked where `serve` is called; inside, each handler is read by its input's name.
	return serve as Serve<I>;
};

/** Make a program whose `main` serves its inputs from one mailbox. */
export const make = <
	I extends Inputs,
	O extends Outputs,
	F extends Flags = Record<never, never>,
	Ks extends Kinds = Record<never, never>,
	E = never,
	R = never,
>(
	name: string,
	definition: Definition<F, I, O, Ks, E, R> & NoInfer<Parented<F, O, Ks>>,
): Serving<F, I, O, Ks, E, R> => {
	const capacity = capacityOf(definition.capacity ?? CAPACITY);
	const inputs = definition.inputs;
	// Room for every close beside the values: a close never waits on a full mailbox.
	const letters = declareInput(
		anyLetter,
		"The run's one mailbox: every value told to any input, and each close, in arrival order.",
		{capacity: capacity + Object.keys(inputs).length},
	);
	const declared = {
		name,
		description: definition.description,
		...(definition.flags === undefined ? {} : {flags: definition.flags}),
		...(definition.machines === undefined ? {} : {machines: definition.machines}),
		inputs: {letters},
		outputs: definition.outputs,
		main: (io: {
			readonly flags: Given<F>;
			readonly send: Kit<F, O, Ks>["send"];
			readonly machines: Kit<F, O, Ks>["machines"];
			readonly watch: Watch<Ks>;
			readonly inputs: {readonly letters: Stream.Stream<Letter>};
		}) =>
			definition.main({
				flags: io.flags,
				send: io.send,
				machines: io.machines,
				watch: io.watch,
				serve: serveOn(io.inputs.letters, inputs),
			}),
	};
	// `defineProgram` checks the kinds against the program's kit; `make`'s own type already did.
	const inner = defineProgram<Hidden, O, F, Ks, E, R>(
		declared as Parameters<typeof defineProgram<Hidden, O, F, Ks, E, R>>[0],
	);
	return {
		name,
		description: definition.description,
		flags: inner.flags,
		inputs,
		outputs: definition.outputs,
		machines: inner.machines,
		capacity,
		inner,
	};
};

/** A program's input, declared as today. Its `capacity` is not read: the mailbox's is the program's. */
export const input = declareInput;

/**
 * A `tell` found the mailbox full: it holds `capacity` values told and not
 * yet handled, from every input. Nothing was put on it. Effect cluster's name.
 */
export class MailboxFull extends Schema.TaggedError<MailboxFull>()("MailboxFull", {
	input: Schema.String,
	capacity: Schema.Number,
}) {}

/** The mailbox now, as a host lists it. */
export interface Mailbox {
	/** Values told and not yet handled. At most the program's capacity. */
	readonly length: number;
	/** Writers waiting for room: an `offer`, `call`. */
	readonly waiting: number;
	/** How many of `length` each input holds; an input with none is left out. */
	readonly by: Readonly<Record<string, number>>;
}

/** A running program made by {@link make}. */
export interface Run<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ks extends Kinds,
	E,
> extends Pick<DefinedRun<F, Hidden, O, Ks, E>, "id" | "listen" | "machines"> {
	readonly program: Serving<F, I, O, Ks, E, any>;
	/** Never waits: on a full mailbox it fails {@link MailboxFull}. */
	tell(name: string, value: unknown): Effect.Effect<Word, MailboxFull>;
	/** The same, but waits for room on a full mailbox. */
	offer(name: string, value: unknown): Effect.Effect<Word>;
	queues(): Mailbox;
	readonly ended: Effect.Effect<Ended<E>>;
}

export interface Running<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ks extends Kinds,
	E,
> {
	readonly kind: "running";
	readonly run: Run<F, I, O, Ks, E>;
	/** A close mark on the mailbox, after every value told before it, those still waiting for room too. */
	readonly close: (name: keyof I & string) => void;
	readonly stop: Effect.Effect<Ended<E>>;
}

/** Start a program made by {@link make}, as today's `start`. */
export const start = <F extends Flags, I extends Inputs, O extends Outputs, Ks extends Kinds, E, R>(
	program: Serving<F, I, O, Ks, E, R>,
	flags: Given<F>,
	listeners: Listeners<O> = {},
	...keeping: keyof Ks extends never ? [keeping?: KeepingOf<Ks>] : [keeping: KeepingOf<Ks>]
): Effect.Effect<Running<F, I, O, Ks, E> | BadShape, never, R | Scope.Scope> =>
	Effect.gen(function* () {
		const started = yield* startDefined(program.inner, flags, listeners, ...keeping);
		if (started.kind === "bad_shape") return started;
		const inner = started.run;
		const capacity = program.capacity;
		/** One token per value told and not yet handled. */
		const tokens = yield* Queue.bounded<true>(capacity);
		const left = new Map<string, number>();
		const closed = new Set<string>();
		let waiting = 0;
		let over = false;
		yield* Effect.forkScoped(
			inner.ended.pipe(
				Effect.andThen(
					Effect.sync(() => {
						over = true;
						// An offer still waiting for room is let go with `stopped`.
						Queue.shutdownUnsafe(tokens);
					}),
				),
			),
		);
		const count = (to: string, n: number) => {
			const now = (left.get(to) ?? 0) + n;
			if (now === 0) left.delete(to);
			else left.set(to, now);
		};
		const handled = (to: string) =>
			Effect.sync(() => {
				count(to, -1);
				Queue.takeUnsafe(tokens);
			});
		/** Put a value told to `to` on the mailbox. Its token is taken already. */
		const put = (to: string, value: unknown): Effect.Effect<Word> =>
			Effect.suspend(() => {
				count(to, 1);
				return inner
					.tell("letters", {
						kind: "told",
						to,
						told: {value, ack: Effect.void},
						handled: handled(to),
					})
					.pipe(
						// The line holds the capacity and a close per input: it is never full here.
						Effect.orDie,
						Effect.tap((word) => (word === "queued" ? Effect.void : handled(to))),
					);
			});
		const refused = (to: string, value: unknown): Word | undefined => {
			const declared: Input<unknown> | undefined = program.inputs[to];
			if (declared === undefined) return "no_cell";
			if (!declared.shape.check(value)) return "bad_shape";
			if (over) return "stopped";
			if (closed.has(to)) return "closed";
			return undefined;
		};
		const unread = (): Unread => Object.fromEntries(left);
		const run: Run<F, I, O, Ks, E> = {
			id: inner.id,
			program,
			listen: inner.listen,
			machines: inner.machines,
			tell: (to, value) =>
				Effect.suspend(() => {
					const no = refused(to, value);
					if (no !== undefined) return Effect.succeed(no);
					if (Queue.offerUnsafe(tokens, true)) return put(to, value);
					return over
						? Effect.succeed("stopped" as const)
						: Effect.fail(new MailboxFull({input: to, capacity}));
				}),
			offer: (to, value) =>
				Effect.suspend(() => {
					const no = refused(to, value);
					if (no !== undefined) return Effect.succeed(no);
					if (Queue.offerUnsafe(tokens, true)) return put(to, value);
					waiting += 1;
					return Queue.offer(tokens, true).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								waiting -= 1;
							}),
						),
						Effect.flatMap((taken) => (taken ? put(to, value) : Effect.succeed<Word>("stopped"))),
					);
				}),
			queues: () => ({length: Queue.sizeUnsafe(tokens), waiting, by: unread()}),
			ended: inner.ended.pipe(Effect.map((ended) => ({...ended, unread: unread()}))),
		};
		const mark = (to: string) =>
			inner.tell("letters", {kind: "closed", to}).pipe(Effect.orDie, Effect.asVoid);
		const close = (to: keyof I & string) => {
			if (!Object.hasOwn(program.inputs, to) || closed.has(to)) return;
			closed.add(to);
			if (waiting === 0) return Effect.runSync(mark(to));
			// Offers wait in line for room: the close goes behind them, so what they hold is read first.
			Effect.runFork(
				Queue.offer(tokens, true).pipe(
					Effect.flatMap((taken) =>
						taken
							? mark(to).pipe(Effect.andThen(Effect.sync(() => Queue.takeUnsafe(tokens))))
							: Effect.void,
					),
				),
			);
		};
		const stop = started.stop.pipe(Effect.map((ended) => ({...ended, unread: unread()})));
		return {kind: "running", run, close, stop} satisfies Running<F, I, O, Ks, E>;
	});

/** Hand `value` to the input `name` of `run`. Never waits: on a full mailbox it fails {@link MailboxFull}. */
export const tell = <I extends Inputs, K extends keyof I & string>(
	run: Run<any, I, any, any, any>,
	name: K,
	value: PayloadOf<I[K]>,
): Effect.Effect<Word, MailboxFull> => run.tell(name, value);

/** The same, waiting for room on a full mailbox. */
export const offer = <I extends Inputs, K extends keyof I & string>(
	run: Run<any, I, any, any, any>,
	name: K,
	value: PayloadOf<I[K]>,
): Effect.Effect<Word> => run.offer(name, value);

/**
 * Run a program with no machines like a command: its inputs told `told`, input
 * by input in key order, then closed; answer how it ended and all it sent.
 */
export const call = <F extends Flags, I extends Inputs, O extends Outputs, E, R>(
	program: Serving<F, I, O, Record<never, never>, E, R>,
	flags: Given<F>,
	told: Told<I> = {},
): Effect.Effect<
	| {readonly kind: "called"; readonly ended: Ended<E>; readonly heard: readonly Heard<O>[]}
	| BadShape,
	never,
	R
> =>
	Effect.gen(function* () {
		const heard: {readonly name: string; readonly value: unknown}[] = [];
		const listeners = Object.fromEntries(
			Object.keys(program.outputs).map((name) => [
				name,
				(value: unknown) => {
					heard.push({name, value});
				},
			]),
		) as Listeners<O>;
		const started = yield* start(program, flags, listeners);
		if (started.kind === "bad_shape") return started;
		const values: Readonly<Record<string, readonly unknown[] | undefined>> = told;
		yield* Effect.forkScoped(
			Effect.gen(function* () {
				for (const [name, list] of Object.entries(values))
					for (const value of list ?? []) yield* started.run.offer(name, value);
				for (const name of Object.keys(program.inputs)) started.close(name);
			}),
		);
		const ended = yield* started.run.ended;
		// Each was sent on the output it is named for, and passed that output's shape.
		return {kind: "called", ended, heard: heard as readonly Heard<O>[]} as const;
	}).pipe(Effect.scoped);
