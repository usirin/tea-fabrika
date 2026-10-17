import {randomUUID} from "node:crypto";
import type {Machine, Store} from "@demlik/tea";
import {
	Cause,
	Clock,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Option,
	Queue,
	type Scope,
	Stream,
	SubscriptionRef,
	type Tracer,
} from "effect";
import {
	described,
	type Flag,
	fit,
	type Input,
	type JsonSchema,
	type Output,
	type PayloadOf,
	type Shape,
} from "./shape.ts";
import {type Handle, type Key, memoryStorage, type Storage, type StorageFailed} from "./storage.ts";
import {ATTR, traceOf} from "./trace.ts";

// A program: the thing you start. It has a name, a sentence that says what it
// does, typed flags, inputs and outputs, and `main`. It is not a machine. A
// machine is a data structure, a state and the rules that move it (tea's
// `defineMachine`). A program *uses* machines: `main` runs one or more of them
// with tea's Effect engine, and does the program's I/O.
//
//   const ship = defineProgram({
//     name: "ship",
//     description: "Puts pull requests in the merge queue, one after another.",
//     flags: {mode: flag(Mode, "read or write, for the whole run.")},
//     inputs: {pr: input(Url, "A pull request to ship. Tell it any time.")},
//     outputs: {outcome: output(Shipped, "How one pull request ended.")},
//     machines: {ship: shipMachine},
//     main: ({flags, inputs, send, watch}) =>
//       inputs.pr.pipe(Stream.runForEach((pr) => runShipMachine(pr, watch).pipe(Effect.flatMap((o) => send("outcome", o))))),
//   });
//
//   const started = yield* start(ship, {mode: "write"}, {outcome: (o) => console.log(o)})
//   // Effect<..., never, CodeHost | CodeHostWrites | Scope>; the listener is in place before `main` begins
//   if (started.kind === "running") {
//     const {run, close, stop} = started;                     // `close` and `stop` are the starter's alone; hand others `run`
//     tell(run, "pr", url);                                   // never waits: "queued" | "closed" | "stopped" | "bad_shape" | "no_cell"
//     run.listen("outcome", (o) => show(o));                  // from now on: a listener never hears the past
//     run.machines.ship.state();                              // what a late viewer reads: the ship machine's state now
//     close("pr");                                            // stdin's end: `main` finishes what it holds, then the run ends
//     yield* run.ended;                                       // { kind: "ended" }; or yield* stop
//   }
//
//   yield* pipe({program: review, flags}, "passed", started, "pr")   // review | ship: starts review, wired before it runs
//   yield* pipe({program: other, flags}, "passed", started, "pr")    // a second writer: `pr` closes when the last one ends
//
// Flags are argv: values the program needs once, checked against their shapes
// before `main` runs. One that does not fit answers `bad_shape` and runs
// nothing. Inputs are stdin: a running program can be told on them at any
// time, and `main` reads each as a Stream that ends when the starter closes
// that input, or when the run ends.
// Outputs are events, one-way, like Elm's outgoing ports: `main` sends,
// whoever listens at that moment hears, nothing comes back, and nothing is
// kept. A listener given to `start` is in place before `main` begins, the way
// a shell wires a pipe before the program runs. Anything a viewer who comes
// late needs belongs in a machine's state, which the handle serves as
// `run.machines.<name>.state()` and `.changes`.
// A program asks for services (`CodeHost`, `CodeHostWrites`, ...) through
// Effect's context and never makes a real connection itself: the caller
// provides them, so a test hands it fake Layers.
//
// The handle has no way to hand a machine a Msg of its own choosing. Whether
// it should is an open question; until it is settled, a program's inputs are
// the only door in.

export type Flags = Readonly<Record<string, Flag<any>>>;
export type Inputs = Readonly<Record<string, Input<any>>>;
export type Outputs = Readonly<Record<string, Output<any>>>;
/** The machines a program runs, by name, so a host can watch each one. */
export type Machines = Readonly<Record<string, Machine<any, any, any, any, any>>>;

/** One typed value per declaration. */
export type Given<D extends Readonly<Record<string, {readonly shape: Shape<any>}>>> = {
	readonly [K in keyof D]: PayloadOf<D[K]>;
};

/** The State of a tea machine. */
export type StateOf<X> = X extends Machine<infer S, any, any, any, any> ? S : never;

/** How `main` sends a value on one of its outputs. A value its output's shape refuses is a bug in the program, and dies. */
export type Send<O extends Outputs> = <K extends keyof O & string>(
	name: K,
	value: PayloadOf<O[K]>,
) => Effect.Effect<void>;

/** What a running tea machine shows: tea's Effect runtime is one. */
export interface Watchable<S> {
	getState(): S;
	subscribe(listener: () => void): () => void;
}

/**
 * Show a run of one of the program's machines on the handle, under its name,
 * until the scope closes. A later watch of the same name takes its place: a
 * program that starts a fresh machine per input shows the newest.
 */
export type Watch<Ms extends Machines> = <K extends keyof Ms & string>(
	name: K,
	runtime: Watchable<StateOf<Ms[K]>>,
) => Effect.Effect<void, never, Scope.Scope>;

/** One run of a machine, as the storage kept it. */
export interface KeptRun<S> {
	readonly id: string;
	/** How long it is kept: until its asker forgets it, or until it is over. */
	readonly until: "forgotten" | "over";
	/** As last saved. */
	readonly state: S;
}

/**
 * Where the program's machine runs keep their state, in the storage the
 * starter handed `start`, under the run's id. The program picks each machine
 * run's id and how long it is kept:
 *
 *   keep.store("ship", {id: ask.id, until: "forgotten"})               // asked: kept to answer the same ask again
 *   keep.store("ship", {id: fresh, until: (s) => s.phase === "over"})  // bare: dropped once it is over
 *
 * Every write is fenced: once the run is started again, the older start's
 * writes fail `Stale`, and its machine stops with tea's `StoreFailed`.
 */
export interface Keep<Ms extends Machines> {
	/** Where one run of a machine keeps its state. Hand it to tea's `run` as its `store`. */
	store<K extends keyof Ms & string>(name: K, key: Key<StateOf<Ms[K]>>): Store<StateOf<Ms[K]>>;
	/** Every run of a machine kept, finished or not. */
	kept<K extends keyof Ms & string>(
		name: K,
	): Effect.Effect<readonly KeptRun<StateOf<Ms[K]>>[], StorageFailed>;
	/** One run of a machine, by its id alone. `null`: none is kept. */
	find<K extends keyof Ms & string>(
		name: K,
		id: string,
	): Effect.Effect<StateOf<Ms[K]> | null, StorageFailed>;
	/** Drop one run of a machine: its asker has the answer. Forgetting one not kept changes nothing. */
	forget<K extends keyof Ms & string>(name: K, id: string): Effect.Effect<void, StorageFailed>;
}

/** What `main` is handed. */
export interface Io<F extends Flags, I extends Inputs, O extends Outputs, Ms extends Machines> {
	readonly flags: Given<F>;
	/**
	 * Each input as a Stream: every value told to it, in order. It ends when
	 * the starter closes the input, after the values told before the close,
	 * so a `main` that reads one to its end finishes its last value and
	 * returns. Never closed, it stays open until the run is stopped.
	 */
	readonly inputs: {readonly [K in keyof I]: Stream.Stream<PayloadOf<I[K]>>};
	readonly send: Send<O>;
	readonly watch: Watch<Ms>;
	readonly keep: Keep<Ms>;
}

export interface Program<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Machines,
	E,
	R,
> {
	readonly name: string;
	readonly description: string;
	readonly flags: F;
	readonly inputs: I;
	readonly outputs: O;
	readonly machines: Ms;
	/** The program itself: reads its inputs, runs its machines, asks for its services, sends its outputs. */
	readonly main: (io: Io<F, I, O, Ms>) => Effect.Effect<void, E, R>;
}

export type AnyProgram = Program<any, any, any, any, any, any>;

/** What `defineProgram` takes: `flags` and `machines` may be left out. */
export interface Definition<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Machines,
	E,
	R,
> extends Omit<Program<F, I, O, Ms, E, R>, "flags" | "machines"> {
	readonly flags?: F;
	readonly machines?: Ms;
}

/** Define a program. A blank name or description is refused here; `flag`, `input` and `output` refuse a blank one of theirs. */
export function defineProgram<
	I extends Inputs,
	O extends Outputs,
	F extends Flags = Record<never, never>,
	Ms extends Machines = Record<never, never>,
	E = never,
	R = never,
>(definition: Definition<F, I, O, Ms, E, R>): Program<F, I, O, Ms, E, R> {
	if (definition.name.trim() === "") throw new Error("a program needs a name");
	described(definition.description);
	// Left out means none. The type says `F` and `Ms`, which default to the empty table when left out.
	const none = {} as F & Ms;
	return {...definition, flags: definition.flags ?? none, machines: definition.machines ?? none};
}

/** `name`: the first value that did not fit. `why`: what is wrong with it, in the schema's words. */
export interface BadShape {
	readonly kind: "bad_shape";
	readonly name: string;
	readonly why: string;
}

/**
 * Read values from outside (a host's JSON, a command line) as a program's
 * flags. It answers the flags, typed, or the first one that does not fit. A
 * name the program does not declare does not fit either.
 */
export function readFlags<F extends Flags>(
	program: {readonly name: string; readonly flags: F},
	raw: unknown,
): {readonly kind: "given"; readonly flags: Given<F>} | BadShape {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		return {kind: "bad_shape", name: "", why: "the flags are not a table of named values"};
	const values = new Map(Object.entries(raw));
	for (const name of values.keys())
		if (!Object.hasOwn(program.flags, name))
			return {kind: "bad_shape", name, why: `${program.name} has no flag named ${name}`};
	for (const [name, declared] of Object.entries<Flag<unknown>>(program.flags)) {
		const why = declared.shape.problem(values.get(name));
		if (why !== undefined) return {kind: "bad_shape", name, why};
	}
	// Every declared flag passed its own shape's check and no other name is
	// there. That is what `Given<F>` says; the compiler cannot add the checks up.
	return {kind: "given", flags: raw as Given<F>};
}

/** What `tell` answers, at once. */
export type Word =
	/** On the input's line. `main` reads it when it gets to it. */
	| "queued"
	/** The run is alive, but its starter closed this input: it takes nothing more. */
	| "closed"
	/** The run has ended or is stopping. Nobody will read it. */
	| "stopped"
	/** The value fails the input's shape. Checked here, before the run sees it. */
	| "bad_shape"
	/** The program has no input of that name. */
	| "no_cell";

/** How a run ended. */
export type Ended<E> =
	/** `main` finished on its own. */
	| {readonly kind: "ended"}
	/** Stopped from outside: `stop`, or its scope closed. */
	| {readonly kind: "stopped"}
	/** `main` failed or died. */
	| {readonly kind: "failed"; readonly cause: Cause.Cause<E>};

/** One machine of a run, as a host sees it. `null`: no run of it has been watched yet. */
export interface MachineView<S> {
	state(): S | null;
	/** The state now, then every change. It ends when the run ends. */
	readonly changes: Stream.Stream<S | null>;
}

/** A running program. */
export interface Run<F extends Flags, I extends Inputs, O extends Outputs, Ms extends Machines, E> {
	/** Stable for the run's whole life. */
	readonly id: string;
	readonly program: Program<F, I, O, Ms, E, any>;
	/**
	 * Hand a value to an input by name, from outside: a host's JSON, a pipe.
	 * Never waits. `tell(run, name, value)` is the typed way in code.
	 */
	tell(name: string, value: unknown): Word;
	/**
	 * Listen to an output from now on. A value sent before it came is not
	 * kept and not heard: to hear from the first instant, give the listener
	 * to `start`. Returns the way to stop listening. A listener that throws
	 * hurts nobody else.
	 */
	listen<K extends keyof O & string>(
		name: K,
		listener: (value: PayloadOf<O[K]>) => void,
	): () => void;
	/** Each of the program's machines, by name. */
	readonly machines: {readonly [K in keyof Ms]: MachineView<StateOf<Ms[K]>>};
	/** Wait for the run's end. */
	readonly ended: Effect.Effect<Ended<E>>;
}

export type AnyRun = Run<any, any, any, any, any>;

/** The run of a program. */
export type RunOf<P> =
	P extends Program<infer F, infer I, infer O, infer Ms, infer E, any>
		? Run<F, I, O, Ms, E>
		: never;

/** Who hears a program's outputs from the first instant: one optional listener per output, typed by that output's shape. */
export type Listeners<O extends Outputs> = {
	readonly [K in keyof O]?: (value: PayloadOf<O[K]>) => void;
};

/** The listeners of a program. */
export type ListenersOf<P> =
	P extends Program<any, any, infer O, any, any, any> ? Listeners<O> : never;

/** Close one of a run's inputs. Saying it again changes nothing. */
export type Close<I extends Inputs> = (name: keyof I & string) => void;

/**
 * What the starter holds: the run, and the only ways to close its inputs and
 * to stop it. `close` and `stop` are separate values, not methods of the run,
 * so whoever is handed `run` can tell it and listen to it, and nothing else:
 * the type has no `close` or `stop`, and neither does the object.
 */
export interface Running<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Machines,
	E,
> {
	readonly kind: "running";
	readonly run: Run<F, I, O, Ms, E>;
	/**
	 * End an input's stream, like stdin's end, whatever pipes still write to
	 * it. `main` still reads every value told before it, and work in flight
	 * finishes: close is not stop. A `tell` on it after answers `closed`.
	 */
	readonly close: Close<I>;
	/** Stop the run and wait for its end. Stopping a run that has ended answers how it ended. */
	readonly stop: Effect.Effect<Ended<E>>;
}

/** What the starter of a program holds. */
export type RunningOf<P> =
	P extends Program<infer F, infer I, infer O, infer Ms, infer E, any>
		? Running<F, I, O, Ms, E>
		: never;

/** What `start` answers. */
export type Started<F extends Flags, I extends Inputs, O extends Outputs, Ms extends Machines, E> =
	| Running<F, I, O, Ms, E>
	| BadShape;

/** Hand `value` to the input `name` of `run`. Never waits. */
export const tell = <I extends Inputs, K extends keyof I & string>(
	run: Run<any, I, any, any, any>,
	name: K,
	value: PayloadOf<I[K]>,
): Word => run.tell(name, value);

/** What a machine's view holds. */
interface Shown {
	readonly state: unknown;
	readonly over: boolean;
}

/** How a run ended, as its record keeps it. */
const statusOf = (exit: Exit.Exit<void, unknown>): "ended" | "stopped" | "failed" => {
	if (Exit.isSuccess(exit)) return "ended";
	return Cause.hasInterruptsOnly(exit.cause) ? "stopped" : "failed";
};

const endedOf = <E>(exit: Exit.Exit<void, E>): Ended<E> => {
	if (Exit.isSuccess(exit)) return {kind: "ended"};
	if (Cause.hasInterruptsOnly(exit.cause)) return {kind: "stopped"};
	return {kind: "failed", cause: exit.cause};
};

/**
 * How a run is kept across a restart: its id, the same at every start, and the
 * storage its record and its machines' states are kept in. Started again with
 * both, the run finds what it left.
 */
export interface Kept {
	readonly id: string;
	readonly storage: Storage;
}

/**
 * What a starter must say about keeping. A program with machines has state
 * that a restart can lose, so its starter must hand it an id and a storage: a
 * run that keeps nothing says so, with `memoryStorage()`, and is never started
 * that way by leaving something out. A program with none may be given an id,
 * or both.
 */
export type KeepingOf<Ms extends Machines> = keyof Ms extends never
	? {readonly id?: string} | Kept
	: Kept;

/**
 * Start a program and answer at once with its run, and the way to close its
 * inputs. Its flags are checked first, even typed ones, since a type cannot
 * hold every check (a url's pattern): one that does not fit answers
 * `bad_shape`, and `main` never runs. `listeners` are in place before `main`
 * begins, so they hear every value it sends, from its first instant. The run
 * lives in the caller's scope: closing it stops the run.
 *
 * `keeping`: the run's id and its storage ({@link KeepingOf}). Each start
 * opens the run in its storage, and the starter's handle holds that storage
 * handle: an older start of the same run, still running, has its next write
 * fail `Stale`. Inputs the record marks closed start closed.
 */
export const start = <
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Machines,
	E,
	R,
>(
	program: Program<F, I, O, Ms, E, R>,
	flags: Given<F>,
	listeners: Listeners<O> = {},
	...keeping: keyof Ms extends never ? [keeping?: KeepingOf<Ms>] : [keeping: KeepingOf<Ms>]
): Effect.Effect<Started<F, I, O, Ms, E>, never, R | Scope.Scope> =>
	begin(program, flags, listeners, keeping[0] ?? {}, undefined);

/**
 * One writer on one input of a run, like one open write end of a Unix pipe.
 * The input closes when its last writer ends, unless the starter closed it
 * first.
 */
interface Writer {
	/** Tell one value. Any word but `queued` breaks the pipe. */
	readonly tell: (value: unknown) => Word;
	/** This writer is done. Saying it again changes nothing. */
	readonly end: () => void;
}

/** One output wired into another run's input: each value is told there, and the run's end ends its writer. */
interface Wire {
	readonly output: string;
	readonly input: string;
	readonly writer: Writer;
	/** The span of the run it writes into: the two runs' spans link to each other. */
	readonly into: Tracer.Span | undefined;
}

/**
 * How `pipe` opens a writer on an input of a run it was handed the starter's
 * `Running` for. Kept here, by that `Running`, so neither the run nor the
 * starter's handle carries a way to do it: only `pipe` can.
 */
const writers = new WeakMap<object, (input: string) => Writer>();

/** Each run's span, by its starter's `Running`, so `pipe` can link the run it starts to the run it writes into. */
const spans = new WeakMap<object, Tracer.Span>();

const begin = <F extends Flags, I extends Inputs, O extends Outputs, Ms extends Machines, E, R>(
	program: Program<F, I, O, Ms, E, R>,
	flags: Given<F>,
	given: Listeners<O>,
	keeping: {readonly id?: string; readonly storage?: Storage},
	wire: Wire | undefined,
): Effect.Effect<Started<F, I, O, Ms, E>, never, R | Scope.Scope> =>
	Effect.gen(function* () {
		const read = readFlags(program, flags);
		if (read.kind === "bad_shape") return read;
		const id = keeping.id ?? `${program.name}:${randomUUID()}`;
		// The type requires a storage for a program with machines; a caller past the type is stopped here.
		if (keeping.storage === undefined && Object.keys(program.machines).length > 0)
			return yield* Effect.die(new Error(`${program.name} has machines and was given no storage`));
		// A program with no machine and no storage keeps its record in memory: nothing asks for it after.
		const handle: Handle = yield* (keeping.storage ?? memoryStorage())
			.open(id, read.flags)
			.pipe(Effect.orDie);

		// The run's span: under the span current at its start (a shell's line), or, with
		// none, in the trace its id names, so a run started again writes into the same trace.
		const parent = yield* Effect.option(Effect.currentParentSpan);
		const span = yield* Effect.makeSpan(`run ${program.name}`, {
			attributes: {[ATTR.program]: program.name, [ATTR.run]: id},
			...(Option.isNone(parent) ? {parent: traceOf(id)} : {}),
			links:
				wire?.into === undefined
					? []
					: [
							{
								span: wire.into,
								attributes: {[ATTR.pipeOutput]: wire.output, [ATTR.pipeInput]: wire.input},
							},
						],
		});
		if (wire?.into !== undefined)
			wire.into.addLinks([
				{span, attributes: {[ATTR.pipeOutput]: wire.output, [ATTR.pipeInput]: wire.input}},
			]);
		const clock = yield* Clock.Clock;
		const mark = (name: string, attributes: Record<string, string>) =>
			span.event(name, clock.currentTimeNanosUnsafe(), attributes);

		const lines = new Map<string, Queue.Queue<unknown, Cause.Done>>();
		for (const name of Object.keys(program.inputs))
			lines.set(name, yield* Queue.unbounded<unknown, Cause.Done>());
		const closed = new Set<string>();
		/** How many pipes write to each input now. */
		const feeding = new Map<string, number>();
		// Each one's type comes from the output it is named for, and `send` hands it only values that output's shape took.
		const wide = given as Readonly<Record<string, ((value: unknown) => void) | undefined>>;
		const listeners = new Map<string, Set<(value: unknown) => void>>();
		for (const name of Object.keys(program.outputs)) {
			const first = wide[name];
			listeners.set(name, new Set(first === undefined ? [] : [first]));
		}
		// `over`: the run has ended, and this is the last state the view will show.
		const views = new Map<string, SubscriptionRef.SubscriptionRef<Shown>>();
		for (const name of Object.keys(program.machines))
			views.set(name, yield* SubscriptionRef.make<Shown>({state: null, over: false}));
		const ended = yield* Deferred.make<Ended<E>>();
		let open = true;
		const finish = () => {
			open = false;
			for (const line of lines.values()) Queue.endUnsafe(line);
			for (const view of views.values())
				Effect.runSync(SubscriptionRef.update(view, (shown) => ({...shown, over: true})));
		};

		const hand = (listener: (value: unknown) => void, value: unknown) =>
			Effect.runSync(Effect.try(() => listener(value)).pipe(Effect.ignore));

		// Heard once, at the moment it is sent, and kept nowhere.
		const heard = (name: string, value: unknown): Effect.Effect<void> => {
			mark(`sent ${name}`, {[ATTR.output]: name});
			for (const listener of [...(listeners.get(name) ?? [])]) hand(listener, value);
			if (wire === undefined || wire.output !== name) return Effect.void;
			const word = wire.writer.tell(value);
			return word === "queued"
				? Effect.void
				: Effect.die(new Error(`${program.name} sent ${name} down a pipe that answered ${word}`));
		};

		const send: Send<O> = (name, value) =>
			Effect.sync(() => {
				const declared: Output<unknown> | undefined = program.outputs[name];
				return declared === undefined ? "there is no such output" : declared.shape.problem(value);
			}).pipe(
				Effect.flatMap((why) =>
					why === undefined
						? Effect.suspend(() => heard(name, value))
						: Effect.die(
								new Error(
									`${program.name} sent its output ${name} a value it does not take: ${why}`,
								),
							),
				),
			);

		const watch: Watch<Ms> = (name, runtime) =>
			Effect.gen(function* () {
				const view = views.get(name);
				if (view === undefined)
					return yield* Effect.die(new Error(`${program.name} has no machine named ${name}`));
				const show = () =>
					Effect.runSync(SubscriptionRef.set(view, {state: runtime.getState(), over: !open}));
				show();
				const off = runtime.subscribe(show);
				yield* Effect.addFinalizer(() => Effect.sync(off));
			});

		const inputs = Object.fromEntries(
			[...lines].map(([name, line]) => [name, Stream.fromQueue(line)]),
		) as Io<F, I, O, Ms>["inputs"];

		// A program with no machine is never asked for a store: `keep` takes only its machines' names.
		// Each state below was saved by the program's own machine under that name.
		const keep: Keep<Ms> = {
			store: (name, key) => handle.store(name, key),
			kept: (name) =>
				handle.left(name) as Effect.Effect<
					readonly KeptRun<StateOf<Ms[typeof name]>>[],
					StorageFailed
				>,
			find: (name, id) =>
				handle.find(name, id) as Effect.Effect<StateOf<Ms[typeof name]> | null, StorageFailed>,
			forget: (name, id) => handle.forget(name, id),
		};

		// An input the starter closed at an earlier start of this run is closed from the start.
		for (const name of handle.found.closed) {
			const line = lines.get(name);
			if (line === undefined || closed.has(name)) continue;
			closed.add(name);
			Queue.endUnsafe(line);
		}

		// The starter's closes, kept one after another. An input's stream ends only once its
		// close is kept, so nothing the run does because of a close comes before the mark.
		// A close that cannot be kept (the run was started again, so this handle is stale) fails the run.
		const marks = yield* Queue.unbounded<string>();
		const fatal = yield* Deferred.make<never>();
		yield* Effect.forkScoped(
			Effect.forever(
				Queue.take(marks).pipe(
					Effect.flatMap((name) =>
						handle.close(name).pipe(Effect.andThen(Effect.sync(() => endLine(name)))),
					),
				),
			).pipe(
				Effect.catchCause((cause) => Deferred.failCause(fatal, Cause.die(Cause.squash(cause)))),
			),
		);
		const endLine = (name: string) => {
			const line = lines.get(name);
			if (line !== undefined) Queue.endUnsafe(line);
		};

		const fiber = yield* Effect.forkScoped(
			program.main({flags: read.flags, inputs, send, watch, keep}).pipe(
				Effect.raceFirst(Deferred.await(fatal)),
				// How the run ended goes on its record before its end is told.
				Effect.onExit((exit) => handle.end(statusOf(exit)).pipe(Effect.ignore)),
				Effect.withParentSpan(span),
			),
		);
		// Observed from outside the fiber, not with `onExit` inside it: a scope
		// that closes before the fiber has started interrupts it without running
		// any of it, and the run must still end.
		fiber.addObserver((exit) => {
			span.end(clock.currentTimeNanosUnsafe(), exit);
			finish();
			// Before the end is told, so whoever waits on it finds the next run's input already closed, when this was its last writer.
			wire?.writer.end();
			Deferred.doneUnsafe(ended, Effect.succeed(endedOf(exit)));
		});

		const machines = Object.fromEntries(
			[...views].map(([name, view]) => [
				name,
				{
					state: () => SubscriptionRef.getUnsafe(view).state,
					changes: SubscriptionRef.changes(view).pipe(
						Stream.takeUntil((shown) => shown.over),
						// The end repeats the last state; a listener who came after it hears it once.
						Stream.changesWith((a, b) => a.state === b.state),
						Stream.map((shown) => shown.state),
					),
				},
			]),
		) as Run<F, I, O, Ms, E>["machines"];

		const run: Run<F, I, O, Ms, E> = {
			id,
			program,
			tell: (name, value) => {
				const declared: Input<unknown> | undefined = program.inputs[name];
				const line = lines.get(name);
				if (declared === undefined || line === undefined) return "no_cell";
				if (!declared.shape.check(value)) return "bad_shape";
				if (!open) return "stopped";
				if (closed.has(name)) return "closed";
				if (!Queue.offerUnsafe(line, value)) return "stopped";
				mark(`told ${name}`, {[ATTR.input]: name});
				return "queued";
			},
			listen: (name, listener) => {
				const these = listeners.get(name);
				// Its type comes from the output `name`, and `send` hands it only values that output's shape took.
				const wide = listener as (value: unknown) => void;
				if (these === undefined) return () => undefined;
				these.add(wide);
				return () => these.delete(wide);
			},
			machines,
			ended: Deferred.await(ended),
		};
		const shut = (name: string) => {
			const line = lines.get(name);
			if (line === undefined || closed.has(name)) return;
			closed.add(name);
			// The values already on the line are still read: the stream ends after them.
			Queue.endUnsafe(line);
		};
		/**
		 * The starter's close is the one kept on the run's record, and kept
		 * before it takes effect: a `tell` answers `closed` at once, and `main`
		 * sees the stream end once the mark is kept. So a crash never leaves a
		 * run that acted on a close the next start does not know. A pipe's last
		 * writer ending is not kept: the starter makes its pipes again at the
		 * next start, and a writer stopped by a crash has not finished.
		 */
		const close: Close<I> = (name) => {
			if (!lines.has(name) || closed.has(name)) return;
			closed.add(name);
			Queue.offerUnsafe(marks, name);
		};
		const stop = Effect.sync(() => {
			open = false;
		}).pipe(Effect.andThen(Fiber.interrupt(fiber)), Effect.andThen(Deferred.await(ended)));
		const running: Running<F, I, O, Ms, E> = {kind: "running", run, close, stop};
		spans.set(running, span);
		writers.set(running, (input) => {
			feeding.set(input, (feeding.get(input) ?? 0) + 1);
			let done = false;
			return {
				tell: (value) => run.tell(input, value),
				end: () => {
					if (done) return;
					done = true;
					const left = (feeding.get(input) ?? 1) - 1;
					feeding.set(input, left);
					if (left === 0) shut(input);
				},
			};
		});
		return running;
	});

/** A program not started yet, with what it is to be started with. `keeping`: as `start` takes it, required the same way. */
export type Startable<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Machines,
	E,
	R,
> = {
	readonly program: Program<F, I, O, Ms, E, R>;
	readonly flags: Given<F>;
	readonly listeners?: Listeners<O>;
} & (keyof Ms extends never
	? {readonly keeping?: KeepingOf<Ms>}
	: {readonly keeping: KeepingOf<Ms>});

/** The inputs of `I` that take every value of type `T`. */
export type Into<I extends Inputs, T> = {
	[J in keyof I & string]: [T] extends [PayloadOf<I[J]>] ? J : never;
}[keyof I & string];

/** `pipe` refused: by the fit check, the output's shape is not the input's. Nothing was started. */
export interface DoesNotFit {
	readonly kind: "does_not_fit";
	readonly output: string;
	readonly input: string;
}

/**
 * `from | to`: start `from` with its output wired into `to`'s input, like a
 * shell wires a pipe before the program runs. `from` is not running yet when
 * it is handed in, so no value it sends can go past the pipe. Each value it
 * sends on `output` is told to `to`'s `input`.
 *
 * Each pipe into an input is one writer on it, like one write end of a Unix
 * pipe. When `from` ends, however it ends, its writer ends; when the last
 * writer of the input has ended, the input closes, so a `to` that reads it to
 * its end finishes its last value and ends on its own. Two upstreams piped
 * into one input both get through, whichever ends first. The starter's own
 * `close` closes it at once, for every writer.
 *
 * A tell that answers anything but `queued` breaks the pipe: `from` fails at
 * that send, and its end says why, the way a write to a closed pipe kills the
 * writer. `to` is the starter's `Running`, since a writer can close the input;
 * `pipe` acts as the starter of `from`, and answers its `Running`, `close` and
 * `stop` with it. The types refuse an input that cannot take the output's values;
 * the fit check then compares the two shapes' JSON Schema, and `does_not_fit`
 * starts nothing. `cannot_tell` goes on: each value is still checked by `tell`.
 */
export const pipe = <
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Machines,
	E,
	R,
	K extends keyof O & string,
	TI extends Inputs,
>(
	from: Startable<F, I, O, Ms, E, R>,
	output: K,
	to: Running<any, TI, any, any, any>,
	input: Into<TI, PayloadOf<O[K]>>,
): Effect.Effect<Started<F, I, O, Ms, E> | DoesNotFit, never, R | Scope.Scope> =>
	Effect.suspend(
		(): Effect.Effect<Started<F, I, O, Ms, E> | DoesNotFit, never, R | Scope.Scope> => {
			const out: Output<unknown> | undefined = from.program.outputs[output];
			const into: Input<unknown> | undefined = to.run.program.inputs[input];
			if (out === undefined || into === undefined || fit(out, into) === "does_not_fit")
				return Effect.succeed({kind: "does_not_fit", output, input});
			const opener = writers.get(to);
			if (opener === undefined)
				return Effect.die(
					new Error(`pipe into ${to.run.program.name} was handed a copy of its starter's handle`),
				);
			const writer = opener(input);
			return begin(from.program, from.flags, from.listeners ?? {}, from.keeping ?? {}, {
				output,
				input,
				writer,
				into: spans.get(to),
			}).pipe(
				// A run that never started is no writer.
				Effect.tap((started) =>
					started.kind === "running" ? Effect.void : Effect.sync(writer.end),
				),
			);
		},
	);

/** One value a program sent, as a caller heard it: the output's name and the value. */
export type Heard<O extends Outputs> = {
	readonly [K in keyof O & string]: {readonly name: K; readonly value: PayloadOf<O[K]>};
}[keyof O & string];

/** Values for a program's inputs, each input's in the order they are told. */
export type Told<I extends Inputs> = {readonly [K in keyof I]?: readonly PayloadOf<I[K]>[]};

/** What `call` answers once the run has ended: how it ended, and every value it sent, in order. */
export interface Called<O extends Outputs, E> {
	readonly kind: "called";
	readonly ended: Ended<E>;
	readonly heard: readonly Heard<O>[];
}

/** What `call` takes beside the flags. `keeping`: as `start` takes it, required the same way. */
export type CallOptions<I extends Inputs, O extends Outputs, Ms extends Machines> = {
	/** The values its inputs are told before they close. An input left out closes with nothing told. */
	readonly told?: Told<I>;
	/** Who else hears its outputs from the first instant, beside the call itself. */
	readonly listeners?: Listeners<O>;
	/** When this finishes before the run ends, the call stops the run with the starter's `stop`: a terminal's Ctrl-C. */
	readonly stopOn?: Effect.Effect<unknown>;
} & (keyof Ms extends never
	? {readonly keeping?: KeepingOf<Ms>}
	: {readonly keeping: KeepingOf<Ms>});

/**
 * Run a program like a command: flags in, its inputs told `told` and then
 * closed, like stdin from a file; wait for its end; answer how it ended and
 * every value it sent. `printf '%s\n' a b | prog --flag x`, as one Effect.
 *
 * A flag or a told value that does not fit answers `bad_shape` and nothing
 * runs. The run lives inside the call: when the call is interrupted, the run
 * is stopped with it.
 */
export const call = <
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Machines,
	E,
	R,
>(
	program: Program<F, I, O, Ms, E, R>,
	flags: Given<F>,
	...options: keyof Ms extends never
		? [options?: CallOptions<I, O, Ms>]
		: [options: CallOptions<I, O, Ms>]
): Effect.Effect<Called<O, E> | BadShape, never, R> =>
	Effect.gen(function* () {
		const given: CallOptions<I, O, Ms> | undefined = options[0];
		const told: Readonly<Record<string, readonly unknown[] | undefined>> = given?.told ?? {};
		for (const [name, values] of Object.entries(told)) {
			const declared: Input<unknown> | undefined = program.inputs[name];
			if (declared === undefined)
				return {
					kind: "bad_shape",
					name,
					why: `${program.name} has no input named ${name}`,
				} as const;
			for (const value of values ?? []) {
				const why = declared.shape.problem(value);
				if (why !== undefined) return {kind: "bad_shape", name, why} as const;
			}
		}
		const heard: {readonly name: string; readonly value: unknown}[] = [];
		// Each one's type comes from the output it is named for, and `send` hands it only values that output's shape took.
		const others = (given?.listeners ?? {}) as Readonly<
			Record<string, ((value: unknown) => void) | undefined>
		>;
		const listeners = Object.fromEntries(
			Object.keys(program.outputs).map((name) => [
				name,
				(value: unknown) => {
					heard.push({name, value});
					others[name]?.(value);
				},
			]),
		) as Listeners<O>;
		const keeping: {readonly id?: string; readonly storage?: Storage} = given?.keeping ?? {};
		const started = yield* begin(program, flags, listeners, keeping, undefined);
		if (started.kind === "bad_shape") return started;
		// Checked above against each input's shape, and the run is fresh: each is `queued`.
		for (const [name, values] of Object.entries(told))
			for (const value of values ?? []) started.run.tell(name, value);
		for (const name of Object.keys(program.inputs)) started.close(name);
		const stopOn = given?.stopOn;
		const ended =
			stopOn === undefined
				? yield* started.run.ended
				: yield* Effect.raceFirst(started.run.ended, stopOn.pipe(Effect.andThen(started.stop)));
		// Each was sent on the output it is named for, and passed that output's shape.
		return {kind: "called", ended, heard: heard as readonly Heard<O>[]} as const;
	}).pipe(Effect.scoped);

/** One flag, input or output, as a host shows it. */
export interface Listed {
	readonly name: string;
	readonly description: string;
	/** `undefined`: the shape gives no JSON Schema. */
	readonly schema: JsonSchema | undefined;
}

/** What a host shows of a program without reading its code: a man page. */
export interface Listing {
	readonly name: string;
	readonly description: string;
	readonly flags: readonly Listed[];
	readonly inputs: readonly Listed[];
	readonly outputs: readonly Listed[];
	/** The names a host can watch on the run's handle. */
	readonly machines: readonly string[];
}

const listed = (
	declared: Readonly<Record<string, Flag<unknown> | Input<unknown> | Output<unknown>>>,
) =>
	Object.entries(declared).map(([name, d]) => ({
		name,
		description: d.description,
		schema: d.shape.json,
	}));

export const listing = (program: AnyProgram): Listing => ({
	name: program.name,
	description: program.description,
	flags: listed(program.flags),
	inputs: listed(program.inputs),
	outputs: listed(program.outputs),
	machines: Object.keys(program.machines),
});
