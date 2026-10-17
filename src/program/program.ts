import {randomUUID} from "node:crypto";
import type {Machine} from "@demlik/tea";
import {
	Cause,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Queue,
	type Scope,
	Stream,
	SubscriptionRef,
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
//     const {run, close} = started;                           // `close` is the starter's alone; hand others `run`
//     tell(run, "pr", url);                                   // never waits: "queued" | "closed" | "stopped" | "bad_shape" | "no_cell"
//     run.listen("outcome", (o) => show(o));                  // from now on: a listener never hears the past
//     run.machines.ship.state();                              // what a late viewer reads: the ship machine's state now
//     close("pr");                                            // stdin's end: `main` finishes what it holds, then the run ends
//     yield* run.ended;                                       // { kind: "ended" }; or yield* run.stop
//   }
//
//   yield* pipe({program: review, flags}, "passed", started, "pr")   // review | ship: starts review, wired before it runs
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
	/** Stop the run and wait for its end. Stopping a run that has ended answers how it ended. */
	readonly stop: Effect.Effect<Ended<E>>;
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
 * What the starter holds: the run, and the one way to close its inputs.
 * `close` is a separate value, not a method of the run, so whoever is handed
 * `run` can tell it but cannot close it: the type has no `close`, and neither
 * does the object.
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
	 * End an input's stream, like stdin's end. `main` still reads every value
	 * told before it, and work in flight finishes: close is not stop. A `tell`
	 * on it after answers `closed`.
	 */
	readonly close: Close<I>;
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

const endedOf = <E>(exit: Exit.Exit<void, E>): Ended<E> => {
	if (Exit.isSuccess(exit)) return {kind: "ended"};
	if (Cause.hasInterruptsOnly(exit.cause)) return {kind: "stopped"};
	return {kind: "failed", cause: exit.cause};
};

/**
 * Start a program and answer at once with its run, and the way to close its
 * inputs. Its flags are checked first, even typed ones, since a type cannot
 * hold every check (a url's pattern): one that does not fit answers
 * `bad_shape`, and `main` never runs. `listeners` are in place before `main`
 * begins, so they hear every value it sends, from its first instant. The run
 * lives in the caller's scope: closing it stops the run.
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
	options: {readonly id?: string} = {},
): Effect.Effect<Started<F, I, O, Ms, E>, never, R | Scope.Scope> =>
	begin(program, flags, listeners, options.id, undefined);

/** One output wired into another run's input: each value is told there, and the run's end closes it. */
interface Wire {
	readonly output: string;
	/** Tell one value on. Any word but `queued` breaks the pipe. */
	readonly tell: (value: unknown) => Word;
	/** The run has ended, however it ended. */
	readonly end: () => void;
}

const begin = <F extends Flags, I extends Inputs, O extends Outputs, Ms extends Machines, E, R>(
	program: Program<F, I, O, Ms, E, R>,
	flags: Given<F>,
	given: Listeners<O>,
	id: string | undefined,
	wire: Wire | undefined,
): Effect.Effect<Started<F, I, O, Ms, E>, never, R | Scope.Scope> =>
	Effect.gen(function* () {
		const read = readFlags(program, flags);
		if (read.kind === "bad_shape") return read;

		const lines = new Map<string, Queue.Queue<unknown, Cause.Done>>();
		for (const name of Object.keys(program.inputs))
			lines.set(name, yield* Queue.unbounded<unknown, Cause.Done>());
		const closed = new Set<string>();
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
			for (const listener of [...(listeners.get(name) ?? [])]) hand(listener, value);
			if (wire === undefined || wire.output !== name) return Effect.void;
			const word = wire.tell(value);
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

		const fiber = yield* Effect.forkScoped(program.main({flags: read.flags, inputs, send, watch}));
		// Observed from outside the fiber, not with `onExit` inside it: a scope
		// that closes before the fiber has started interrupts it without running
		// any of it, and the run must still end.
		fiber.addObserver((exit) => {
			finish();
			// Before the end is told, so whoever waits on it finds the next run's input already closed.
			wire?.end();
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
			id: id ?? `${program.name}:${randomUUID()}`,
			program,
			tell: (name, value) => {
				const declared: Input<unknown> | undefined = program.inputs[name];
				const line = lines.get(name);
				if (declared === undefined || line === undefined) return "no_cell";
				if (!declared.shape.check(value)) return "bad_shape";
				if (!open) return "stopped";
				if (closed.has(name)) return "closed";
				return Queue.offerUnsafe(line, value) ? "queued" : "stopped";
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
			stop: Effect.sync(() => {
				open = false;
			}).pipe(Effect.andThen(Fiber.interrupt(fiber)), Effect.andThen(Deferred.await(ended))),
			ended: Deferred.await(ended),
		};
		const close: Close<I> = (name) => {
			const line = lines.get(name);
			if (line === undefined || closed.has(name)) return;
			closed.add(name);
			// The values already on the line are still read: the stream ends after them.
			Queue.endUnsafe(line);
		};
		return {kind: "running", run, close} as const;
	});

/** A program not started yet, with what it is to be started with. */
export interface Startable<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Machines,
	E,
	R,
> {
	readonly program: Program<F, I, O, Ms, E, R>;
	readonly flags: Given<F>;
	readonly listeners?: Listeners<O>;
}

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
 * sends on `output` is told to `to`'s `input`; when `from` ends, however it
 * ends, `to`'s input is closed, so a `to` that reads it to its end finishes
 * its last value and ends on its own.
 *
 * A tell that answers anything but `queued` breaks the pipe: `from` fails at
 * that send, and its end says why, the way a write to a closed pipe kills the
 * writer. `to` is the starter's `Running`, since only the starter may close
 * its input. The types refuse an input that cannot take the output's values;
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
			return begin(from.program, from.flags, from.listeners ?? {}, undefined, {
				output,
				tell: (value) => to.run.tell(input, value),
				end: () => to.close(input),
			});
		},
	);

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
