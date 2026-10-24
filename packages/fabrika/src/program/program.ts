import type {Cmd, Machine, Sub} from "@demlik/tea";
import type {
	EffectInterpret,
	EffectSubscribe,
	InterpretServices,
	SubscribeServices,
} from "@demlik/tea/effect";
import {
	Cause,
	Clock,
	Deferred,
	Effect,
	Equal,
	Exit,
	Fiber,
	Option,
	Queue,
	Schema,
	type Scope,
	Stream,
	SubscriptionRef,
	type Tracer,
} from "effect";
import type {KeptFailed, KeptOptions, KeptRuntime} from "./kept.ts";
import {type Outbox, outboxOf} from "./outbox.ts";
import {type AlreadyStarted, type Conflict, lineOf, refsOf} from "./refs.ts";
import {
	type Ack,
	capacityOf,
	defaulted,
	described,
	type Flag,
	fit,
	type Input,
	type JsonSchema,
	type Output,
	type PayloadOf,
	type Shape,
} from "./shape.ts";
import {type Handle, memoryStorage, type Storage, type StorageFailed} from "./storage.ts";
import {ATTR, type Drawing, SERVICE_NAME, traceOf} from "./trace.ts";

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
//     machines: {ship: kind({machine: shipMachine, parent: "main", options, recovered, drawing,
//       status: (s) => s.phase === "queued" ? `${s.pr}: in the merge queue` : s.phase})},  // one line per copy, typed by ship's state
//     main: ({flags, inputs, send, machines}) =>
//       inputs.pr.pipe(Stream.runForEach((pr) => shipOne(machines.ship.get(idOf(pr)), pr).pipe(Effect.flatMap((o) => send("outcome", o))))),
//   });
//
//   const started = yield* start(ship, {mode: "write"}, {outcome: (o) => console.log(o)})
//   // Effect<..., never, CodeHost | CodeHostWrites | Scope>; the listener is in place before `main` begins
//   if (started.kind === "running") {
//     const {run, close, stop} = started;                     // `close` and `stop` are the starter's alone; hand others `run`
//     yield* tell(run, "pr", url);                            // never waits: "queued" | "closed" | "stopped" | "bad_shape" | "no_cell"; fails Full on a full line
//     run.listen("outcome", (o) => show(o));                  // from now on: a listener never hears the past
//     run.machines.ship.state();                              // what a late viewer reads: the ship machine's state now
//     run.machines.ship.copies();                             // [{id, line: "#597: in the merge queue", live: true}, ...]: one per copy
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
// The one exception is a pipe into an input declared `{ack: "manual"}`: the
// sender keeps each value in its run's outbox until the receiver acks that it
// has saved it, and sends it again at the next start if no ack came
// (./outbox.ts, experiment 75d).
// A program says, for each machine, its status line: a plain `state =>
// string`, like Elm's `title`. Each copy of a machine the run starts (one
// review per pull request) is shown under the id it is kept under, with its
// line, so a host lists every copy and a stuck one is never hidden by a newer
// one: `run.machines.<name>.copies()` and `.lines`. tea is unchanged.
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
/** One typed value per declaration. */
export type Given<D extends Readonly<Record<string, {readonly shape: Shape<any>}>>> = {
	readonly [K in keyof D]: PayloadOf<D[K]>;
};

/** The State of a tea machine. */
export type StateOf<X> = X extends Machine<infer S, any, any, any, any> ? S : never;

/**
 * One value told to a `manual` input, and the way to say it is saved: AMQP's
 * delivery and its `basic.ack`. `main` acks once the value is in its own
 * saved state (the kept queue does it after its `told` is saved), never
 * later: a pipe stops sending once `WINDOW` values wait on their ack.
 */
export interface Delivery<T> {
	readonly value: T;
	/** It is saved. Saying it again changes nothing. A value a host told, not a pipe, has nobody waiting, and its ack does nothing. */
	readonly ack: Effect.Effect<void>;
}

/** What `main` reads from one input: its values, or a `manual` input's deliveries. */
export type StreamOf<D> =
	D extends Input<infer T, "manual"> ? Stream.Stream<Delivery<T>> : Stream.Stream<PayloadOf<D>>;

// ---------------------------------------------------------------- kinds and refs
//
// A program declares each machine it runs once, as a kind: the machine, who
// starts its runs again after a crash, tea's run options, the Msg a run found
// part way gets, and how its trace draws it. `main` then reaches one run of a
// kind by its id, and sends it the start Msg:
//
//   machines: {ship: kind({machine: ship, parent: "main", options: () => ({...}), recovered: (s) => ..., drawing})},
//   main: ({machines}) => machines.ship.get(id).start({type: "start", pr}),
//
// The shape and the names are the durable-entity systems' (experiment 75):
// a kind registered once with its behavior (Akka's `Entity(TypeKey)`, Effect's
// `Entity.make(type)`), `get(id)` that does nothing yet (Durable Objects,
// Orleans `GetGrain`, Temporal `getHandle`), `start` (Temporal), `clear`
// (Restate `clearAll`, Orleans `ClearStateAsync`), `list` (Temporal) and
// `read` (Temporal `describe`). The caller never says "resume": the kind's
// `recovered` does, the way Akka's entity reacts to `RecoveryCompleted`.

/** What a kind's run is drawn from: its id, its state as it was kept, and the caller's start Msg. */
export interface Drawn<S, M> {
	readonly id: string;
	/** `null`: nothing was kept. */
	readonly kept: S | null;
	/** `null`: the caller sent none. */
	readonly start: M | null;
}

/**
 * One machine of a program, declared once. `Kt`: what `options` is handed,
 * a part of the program's {@link Kit}; the program checks that it is one.
 */
export interface Kind<
	S,
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	Ctx,
	I,
	B,
	Kt,
	P extends string,
> {
	readonly machine: Machine<S, M, C, U, Ctx>;
	/**
	 * Who starts its runs again after a crash, under the same id: `main`, or
	 * another machine of the program (Temporal's parent workflow). Checked
	 * when `main` returns: a run that began, is not over, and is still kept
	 * fails the run, and names this parent.
	 */
	readonly parent: P;
	/** tea's own run options, less the store. Handed the kit, so a cell can `send` or start another kind's run. */
	readonly options: (kit: Kt) => KeptOptions<S, M, C, U, Ctx, I, B>;
	/**
	 * The Msg a run found part way gets first, before any Listen opens: Akka's
	 * `RecoveryCompleted`, Elm's `init` branching on its flags. `null`: it never
	 * began, so the caller's start Msg goes instead. Left out: a run of this
	 * kind has no unfinished work to carry on (a running total, a queue), and
	 * the parent check leaves its runs alone.
	 */
	readonly recovered?: (kept: NoInfer<S>) => M | null;
	/** How its trace draws one run (experiment 70). */
	readonly drawing: (
		run: Drawn<NoInfer<S>, NoInfer<M>>,
	) => Drawing<NoInfer<S>, NoInfer<C>, NoInfer<U>>;
	/**
	 * Its status line: what one copy is doing, in a few plain words, read from
	 * its state alone (experiment 73). A host shows it, one per copy, and sends
	 * it on only when it changes. Like Elm's `title`, it is a pure function of
	 * the state; one that throws shows why in place of its line, and hurts
	 * nobody else.
	 */
	readonly status: (state: NoInfer<S>) => string;
}

/** Any kind. Its options are only an object here: tea's own type for them asks for `subscribe` once its types are `any`. */
export type AnyKind = Omit<Kind<any, any, any, any, any, any, any, any, string>, "options"> & {
	readonly options: (kit: any) => object;
};

/** The machines a program runs, by name: one kind each. */
export type Kinds = Readonly<Record<string, AnyKind>>;

/**
 * Declare one kind. The types come from the machine, and what `options`
 * answers says which services its runs need: `main` asks for them by starting
 * one. A kind whose `options` reads the kit types the kit it reads by hand.
 */
export const kind = <
	S,
	const M extends {type: string},
	C extends Cmd,
	U extends Sub,
	Ctx,
	I = EffectInterpret<M, C, never>,
	B = EffectSubscribe<M, U, never>,
	Kt = unknown,
	P extends string = string,
>(
	declared: Kind<S, M, C, U, Ctx, I, B, Kt, P>,
): Kind<S, M, C, U, Ctx, I, B, Kt, P> => declared;

export {AlreadyStarted, type Conflict} from "./refs.ts";

/** One run of one kind, by its id. Getting it does nothing. */
export interface Ref<S, M extends {type: string}, C extends Cmd, I, B> {
	readonly id: string;
	/**
	 * The one live copy of this run. Live already: it is shared, and `msg`
	 * goes nowhere; another Msg than the one that started it fails with
	 * {@link AlreadyStarted} unless `conflict` says `use_existing`, and no
	 * Msg at all always shares. Not live: its kept state is read, the
	 * machine is booted with its Listens shut, and one Msg goes first, to
	 * quiescence: the kind's `recovered` Msg for a run that began, else
	 * `msg`. A run kept over gets none. The copy lives while any caller's
	 * scope holds it.
	 */
	start(
		msg?: M,
		options?: {readonly conflict?: Conflict},
	): Effect.Effect<
		KeptRuntime<M, S, C, I>,
		KeptFailed<C, I> | AlreadyStarted,
		Scope.Scope | InterpretServices<I> | SubscribeServices<B>
	>;
	/** Its state as kept. `null`: none is. */
	readonly read: Effect.Effect<S | null, StorageFailed>;
	/** Drop it: its parent is done with it. Clearing one not kept changes nothing. */
	readonly clear: Effect.Effect<void, StorageFailed>;
}

/** One run of a machine, as the storage kept it. */
export interface KeptRun<S> {
	readonly id: string;
	/** As last saved. */
	readonly state: S;
}

/** The runs of one kind. */
export interface Refs<S, M extends {type: string}, C extends Cmd, I, B> {
	/** One run, by its id. Nothing is read or started. */
	get(id: string): Ref<S, M, C, I, B>;
	/** Every run of it kept, finished or not: for a host or a tidy-up, not for driving work. */
	readonly list: Effect.Effect<readonly KeptRun<S>[], StorageFailed>;
}

/** The refs of one kind. */
// Every slot is inferred, none is `any`: tea's run options ask for `subscribe` once their types are
// `any`, so a kind with no Listen would not match.
export type RefsOf<Kd> =
	Kd extends Kind<
		infer S,
		infer M,
		infer C,
		infer _U,
		infer _Ctx,
		infer I,
		infer B,
		infer _Kt,
		infer _P
	>
		? Refs<S, M, C, I, B>
		: never;

/** The State of a kind's machine. */
export type StateOfKind<Kd> = Kd extends {readonly machine: Machine<infer S, any, any, any, any>}
	? S
	: never;

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
 * Show a run of one of the program's machines on the handle, under its name
 * and `id`, as one copy of that machine: its status line follows its state,
 * and it is live until the scope closes. Each id is one copy, so a program
 * that runs one machine per input shows each of them. A copy watched again
 * under its id takes its old place. `state()` and `changes` follow the copy
 * watched last.
 */
export type Watch<Ks extends Kinds> = <K extends keyof Ks & string>(
	name: K,
	id: string,
	runtime: Watchable<StateOfKind<Ks[K]>>,
) => Effect.Effect<void, never, Scope.Scope>;

/** The Msg of a tea machine. */
export type MsgOf<X> =
	X extends Machine<any, infer M extends {type: string}, any, any, any> ? M : never;

/**
 * What a kind's `options` is handed, and `main` with it: the flags, the
 * outputs, and the runs of every kind. Each run keeps its state in the
 * storage the starter handed `start`, under the program run's id, and every
 * write is fenced: once the program run is started again, the older start's
 * writes fail `Stale`, and its machine stops with tea's `StoreFailed`.
 */
export interface Kit<F extends Flags, O extends Outputs, Ks extends Kinds> {
	readonly flags: Given<F>;
	readonly send: Send<O>;
	readonly machines: {readonly [K in keyof Ks]: RefsOf<Ks[K]>};
}

/** What `main` is handed. */
export interface Io<F extends Flags, I extends Inputs, O extends Outputs, Ks extends Kinds>
	extends Kit<F, O, Ks> {
	/** Show a machine that is not run through a ref (a table kept elsewhere) on the handle. */
	readonly watch: Watch<Ks>;
	/**
	 * Each input as a Stream: every value told to it, in order; for a
	 * `manual` input, each with its ack ({@link Delivery}). It ends when the
	 * starter closes the input, after the values told before the close, so a
	 * `main` that reads one to its end finishes its last value and returns.
	 * Never closed, it stays open until the run is stopped.
	 */
	readonly inputs: {readonly [K in keyof I]: StreamOf<I[K]>};
}

/** The mark only `defineProgram` gives, in the types alone: an object built by hand has none, so it is no `Program`. */
declare const defined: unique symbol;

/** The programs `defineProgram` made, so a run refuses any other: a spread copy keeps the type's mark, not this. */
const made = new WeakSet<object>();

/** How a run of a program `defineProgram` did not make dies, before anything runs: its refusals were skipped. */
const notMade = (program: {readonly name: string}): Effect.Effect<never> =>
	Effect.die(
		new Error(
			`the program ${JSON.stringify(program.name)} was not made by defineProgram, so nothing checked it`,
		),
	);

export interface Program<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ks extends Kinds,
	E,
	R,
> {
	readonly [defined]: true;
	readonly name: string;
	readonly description: string;
	readonly flags: F;
	readonly inputs: I;
	readonly outputs: O;
	/** Each machine it runs, as a kind ({@link Kind}), with its status line. */
	readonly machines: Ks;
	/** The program itself: reads its inputs, runs its machines, asks for its services, sends its outputs. */
	readonly main: (io: Io<F, I, O, Ks>) => Effect.Effect<void, E, R>;
}

export type AnyProgram = Program<any, any, any, any, any, any>;

/**
 * What a program's window is shown, as data: one of its machines' state, picked by a pure
 * function, with a schema for what it picks (docs/direction/tea-program.md, changed 2026-10-22).
 * Elm's `view`, less the HTML. There is no renderer here and no React: the window is a React
 * component in the program's own package, on `<package>/window`, drawing this data. It reaches
 * the program only through its declared inputs (./view.ts reads what it sends).
 *
 *   view: {machine: "count", data: Schema.Struct({n: Schema.Int}), of: (s) => ({n: s.n})}
 *   viewOf(counter)   // the view, for a host; `undefined` for a program with no window
 *
 * The view is not in {@link Program}'s type, so a program with a window and one without are
 * still one type a host holds. A host reads it with `viewOf`, from what `defineProgram` made.
 */
export interface View<S, V> {
	/** The machine it reads, by its name in the program's `machines`. */
	readonly machine: string;
	/** The schema of what it picks: one type on both sides, as a shape's is. */
	readonly data: Schema.Codec<V, V>;
	/** What the window is shown, from that machine's state alone. Pure: a checker may call it. */
	readonly of: (state: S) => V;
}

/** A program's view, of any machine and any data: what a host holds. */
export interface AnyView {
	readonly machine: string;
	readonly data: Schema.Top;
	readonly of: (state: any) => unknown;
}

/** The view of each program `defineProgram` made with one. */
const views = new WeakMap<object, AnyView>();

/** What a program's window is shown, as it declared it. `undefined`: it has no window. */
export const viewOf = (program: AnyProgram): AnyView | undefined => views.get(program);

/** A view of one of the machines `Ks`, typed by that machine's state, its data `V`. */
export type ViewOf<Ks extends Kinds, V> = {
	readonly [K in keyof Ks & string]: Omit<View<StateOfKind<Ks[K]>, V>, "machine"> & {
		readonly machine: K;
	};
}[keyof Ks & string];

/** What `defineProgram` takes: `flags`, `machines` and `view` may be left out. */
export interface Definition<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ks extends Kinds,
	E,
	R,
> extends Omit<Program<F, I, O, Ks, E, R>, "flags" | "machines" | typeof defined> {
	readonly flags?: F;
	readonly machines?: Ks;
}

/** What a program with a view shows of it in its type: its data's type, for its window. */
export type Viewed<V> = [V] extends [never] ? unknown : {readonly view: View<any, V>};

/**
 * What the types check of each kind against the program it is declared in:
 * its `parent` is `main` or another of its machines, never itself, and its
 * `options` reads no more than the program's kit holds.
 */
export type Parented<F extends Flags, O extends Outputs, Ks extends Kinds> = {
	readonly machines?: {
		readonly [K in keyof Ks]: {
			readonly parent: "main" | Exclude<keyof Ks & string, K>;
			readonly options: (kit: Kit<F, O, Ks>) => unknown;
		};
	};
};

/**
 * Define a program. A blank name or description is refused here; `flag`,
 * `input` and `output` refuse a blank one of theirs. So is a kind with no
 * status line, or a `parent` that names no machine of the program, or the
 * machine itself: past the types, the check still holds. A `view` that names
 * no machine of the program is refused too.
 */
export function defineProgram<
	I extends Inputs,
	O extends Outputs,
	F extends Flags = Record<never, never>,
	Ks extends Kinds = Record<never, never>,
	E = never,
	R = never,
	V = never,
>(
	definition: Definition<F, I, O, Ks, E, R> &
		NoInfer<Parented<F, O, Ks>> & {readonly view?: ViewOf<NoInfer<Ks>, V>},
): Program<F, I, O, Ks, E, R> & Viewed<V> {
	if (definition.name.trim() === "") throw new Error("a program needs a name");
	described(definition.description);
	// `input` refuses a capacity no line can hold; an input built past it is refused here.
	for (const declared of Object.values<Input<unknown>>(definition.inputs))
		capacityOf(declared.capacity);
	// Left out means none. The type says `F` and `Ks`, which default to the empty table when left out.
	const none = {} as F & Ks;
	const machines = definition.machines ?? none;
	for (const [name, declared] of Object.entries<AnyKind>(machines)) {
		if (typeof declared.status !== "function")
			throw new Error(`${definition.name} says no status line for ${name}`);
		if (
			declared.parent === name ||
			(declared.parent !== "main" && !Object.hasOwn(machines, declared.parent))
		)
			throw new Error(
				`${definition.name}'s ${name} names ${declared.parent} as its parent, which is not another of its machines or main`,
			);
	}
	const view = definition.view;
	if (view !== undefined && !Object.hasOwn(machines, view.machine))
		throw new Error(
			`${definition.name}'s view reads ${view.machine}, which is not one of its machines`,
		);
	// The mark is in the types only; `made` is what a run checks.
	const program = {...definition, flags: definition.flags ?? none, machines} as Program<
		F,
		I,
		O,
		Ks,
		E,
		R
	>;
	made.add(program);
	if (view !== undefined) views.set(program, view);
	// The view's data type is in the returned type alone: what its window is typed by.
	return program as typeof program & Viewed<V>;
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
	const flags: Record<string, unknown> = {...raw};
	for (const [name, declared] of Object.entries<Flag<unknown>>(program.flags)) {
		// A flag not given takes its default, so a run keeps, and is shown, the value it ran with.
		if (values.get(name) === undefined && declared.default !== undefined)
			flags[name] = declared.default.value;
		const why = declared.shape.problem(flags[name]);
		if (why !== undefined) return {kind: "bad_shape", name, why};
	}
	// Every declared flag passed its own shape's check and no other name is
	// there. That is what `Given<F>` says; the compiler cannot add the checks up.
	return {kind: "given", flags: flags as Given<F>};
}

/**
 * `flags`, each one named in `values` taking its value there as its default
 * (`defaulted`). A host fills a program's defaults from its own settings
 * this way, and a value that does not fit its flag is refused here.
 */
export function withDefaults<F extends Flags>(
	flags: F,
	values: {readonly [K in keyof F]?: PayloadOf<F[K]>},
): F {
	return Object.fromEntries(
		Object.entries<Flag<unknown>>(flags).map(([name, declared]) => {
			const value: unknown = (values as Readonly<Record<string, unknown>>)[name];
			return [name, value === undefined ? declared : defaulted(declared, value)];
		}),
	) as F;
}

/**
 * The first flag whose value differs from the one a run kept at its first
 * start, or `undefined`: they are the same. Compared as kept, in JSON, and
 * by value, not by key order.
 */
const otherFlag = (given: unknown, kept: unknown): string | undefined => {
	if (kept === null || typeof kept !== "object" || Array.isArray(kept)) return undefined;
	const now = JSON.parse(JSON.stringify(given)) as Record<string, unknown>;
	const then = kept as Record<string, unknown>;
	return [...new Set([...Object.keys(then), ...Object.keys(now)])].find(
		(name) => !Equal.equals(now[name], then[name]),
	);
};

// How many values one input's line holds that `main` has not read yet is the
// input's own `capacity`, `CAPACITY` when its program says none. Every writer
// shares it. A `tell` past it fails `Full` and never waits; `offer`, a pipe and
// `call` wait for room, as a writer on a full Unix pipe does.
export {CAPACITY} from "./shape.ts";

/**
 * A `tell` found the input's line full: it holds `capacity` values `main` has
 * not read. Nothing was put on it. An error, not an answer, so a caller that
 * does not handle it fails, and the type says so: tell it again later, `offer`
 * it, or `catchTag("Full", ...)`.
 */
export class Full extends Schema.TaggedError<Full>()("Full", {
	input: Schema.String,
	capacity: Schema.Number,
}) {}

/** What `tell` answers, at once, when the line was not full. */
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

/**
 * The values still on each input's line when its run ended: told and queued,
 * never read by `main`. Nothing reads them after, so they are gone, and this
 * says how many, the way Akka counts its dead letters. An input with none is
 * left out: `{}` is a run that read all it was told. A pipe into a `manual`
 * input still holds its own in its outbox and sends them again (./outbox.ts);
 * a host's tell has nobody who will.
 */
export type Unread = Readonly<Record<string, number>>;

/** How a run ended, and what it left unread. */
export type Ended<E> =
	/** `main` finished on its own. */
	| {readonly kind: "ended"; readonly unread: Unread}
	/** Stopped from outside: `stop`, or its scope closed. */
	| {readonly kind: "stopped"; readonly unread: Unread}
	/** `main` failed or died. */
	| {readonly kind: "failed"; readonly cause: Cause.Cause<E>; readonly unread: Unread};

/**
 * One copy of a machine, as a host lists it: the id it is kept under, its
 * status line now, and whether it still runs. A copy that ended keeps its
 * last line until the run ends: a stuck one stays in the list.
 */
export interface Copy {
	readonly id: string;
	readonly line: string;
	readonly live: boolean;
}

/** One machine of a run, as a host sees it. */
export interface MachineView<S> {
	/** The state of the copy watched last. `null`: no copy has been watched yet. */
	state(): S | null;
	/** That state now, then every change. It ends when the run ends. */
	readonly changes: Stream.Stream<S | null>;
	/** Every copy this start of the run has shown, in the order each was first shown. */
	copies(): readonly Copy[];
	/** The copies now, then again each time one starts, ends, or says a new line; never twice the same. It ends when the run ends. */
	readonly lines: Stream.Stream<readonly Copy[]>;
}

/**
 * One input's line now, as a host lists it: Erlang's `message_queue_len`
 * beside the writers asleep on it, as a writer on a full Unix pipe sleeps
 * until the reader makes room.
 */
export interface InputQueue {
	/** Values on the line `main` has not read yet. At most the input's `capacity`. */
	readonly length: number;
	/** Writers waiting for room on the full line: an `offer`, a pipe, a resend, `call`. A `tell` that failed `Full` is not one: it never waits. */
	readonly waiting: number;
}

/** A running program. */
export interface Run<F extends Flags, I extends Inputs, O extends Outputs, Ms extends Kinds, E> {
	/** Stable for the run's whole life. */
	readonly id: string;
	readonly program: Program<F, I, O, Ms, E, any>;
	/**
	 * Hand a value to an input by name, from outside: a host's JSON, a pipe.
	 * Never waits: on a full line it fails {@link Full}. `tell(run, name,
	 * value)` is the typed way in code.
	 */
	tell(name: string, value: unknown): Effect.Effect<Word, Full>;
	/**
	 * The same, but on a full line it waits for room instead of failing
	 * `Full`: what a host that reads a script or a file uses. `offer(run,
	 * name, value)` is the typed way in code.
	 */
	offer(name: string, value: unknown): Effect.Effect<Word>;
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
	readonly machines: {readonly [K in keyof Ms]: MachineView<StateOfKind<Ms[K]>>};
	/** Each input's line now, by name. Read when asked: a host that lists its runs reads it then. After the end, every line is empty with nobody waiting. */
	queues(): {readonly [K in keyof I]: InputQueue};
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
	Ms extends Kinds,
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
export type Started<F extends Flags, I extends Inputs, O extends Outputs, Ms extends Kinds, E> =
	| Running<F, I, O, Ms, E>
	| BadShape;

/** Hand `value` to the input `name` of `run`. Never waits: on a full line it fails {@link Full}, Effect's `Queue.offerUnsafe` answering false. */
export const tell = <I extends Inputs, K extends keyof I & string>(
	run: Run<any, I, any, any, any>,
	name: K,
	value: PayloadOf<I[K]>,
): Effect.Effect<Word, Full> => run.tell(name, value);

/** Hand `value` to the input `name` of `run`, waiting for room on a full line: Effect's `Queue.offer`. */
export const offer = <I extends Inputs, K extends keyof I & string>(
	run: Run<any, I, any, any, any>,
	name: K,
	value: PayloadOf<I[K]>,
): Effect.Effect<Word> => run.offer(name, value);

/** What a machine's view holds. */
interface Shown {
	/** The state of the copy watched last: `newest`. */
	readonly state: unknown;
	readonly newest: string | null;
	readonly copies: readonly Copy[];
	/** The run has ended, and this is the last the view will show. */
	readonly over: boolean;
}

/** The copies with one put in: in its old place when its id is there, else last. */
const putCopy = (copies: readonly Copy[], copy: Copy): readonly Copy[] => {
	const at = copies.findIndex((c) => c.id === copy.id);
	if (at === -1) return [...copies, copy];
	const old = copies[at];
	if (old !== undefined && old.line === copy.line && old.live === copy.live) return copies;
	return copies.map((c, i) => (i === at ? copy : c));
};

const sameCopies = (a: readonly Copy[], b: readonly Copy[]) =>
	a.length === b.length &&
	a.every((c, i) => {
		const d = b[i];
		return d !== undefined && c.id === d.id && c.line === d.line && c.live === d.live;
	});

/** How a run ended, as its record keeps it. */
const statusOf = (exit: Exit.Exit<void, unknown>): "ended" | "stopped" | "failed" => {
	if (Exit.isSuccess(exit)) return "ended";
	return Cause.hasInterruptsOnly(exit.cause) ? "stopped" : "failed";
};

const endedOf = <E>(exit: Exit.Exit<void, E>, unread: Unread): Ended<E> => {
	if (Exit.isSuccess(exit)) return {kind: "ended", unread};
	if (Cause.hasInterruptsOnly(exit.cause)) return {kind: "stopped", unread};
	return {kind: "failed", cause: exit.cause, unread};
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
export type KeepingOf<Ms extends Kinds> = keyof Ms extends never
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
export const start = <F extends Flags, I extends Inputs, O extends Outputs, Ms extends Kinds, E, R>(
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
	/** How the input takes a value: `manual`, the pipe keeps an outbox and waits on acks (./outbox.ts). */
	readonly ack: Ack;
	/** Why the input does not take the value's shape, or `undefined`: it does. */
	readonly problem: (value: unknown) => string | undefined;
	/** Tell one value, with what its ack runs, waiting for room on a full line. Any word but `queued` breaks the pipe. */
	readonly tell: (value: unknown, ack: Effect.Effect<void>) => Effect.Effect<Word>;
	/** This writer is done. Saying it again changes nothing. */
	readonly end: () => void;
	/** Done once the run it writes into has ended. */
	readonly gone: Effect.Effect<void>;
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

const begin = <F extends Flags, I extends Inputs, O extends Outputs, Ms extends Kinds, E, R>(
	program: Program<F, I, O, Ms, E, R>,
	flags: Given<F>,
	given: Listeners<O>,
	keeping: {readonly id?: string; readonly storage?: Storage},
	wire: Wire | undefined,
): Effect.Effect<Started<F, I, O, Ms, E>, never, R | Scope.Scope> =>
	Effect.gen(function* () {
		if (!made.has(program)) return yield* notMade(program);
		const read = readFlags(program, flags);
		if (read.kind === "bad_shape") return read;
		// The global Web Crypto, not `node:crypto`: this file is on the package's top level, which runs anywhere.
		const id = keeping.id ?? `${program.name}:${crypto.randomUUID()}`;
		// The type requires a storage for a program with machines; a caller past the type is stopped here.
		if (keeping.storage === undefined && Object.keys(program.machines).length > 0)
			return yield* Effect.die(new Error(`${program.name} has machines and was given no storage`));
		// A run keeps the flags it was first started with, as a Temporal workflow keeps its input
		// and a machine run its start Msg (./refs.ts): a later start under its id must give the same
		// ones, so its machines never go on under other flags than they began with. Read before the
		// open, so a refused start fences nothing.
		const before =
			keeping.storage === undefined ? null : yield* keeping.storage.record(id).pipe(Effect.orDie);
		if (before !== null) {
			const other = otherFlag(read.flags, before.flags);
			if (other !== undefined)
				return {
					kind: "bad_shape",
					name: other,
					why: `run ${id} was first started with ${other} ${JSON.stringify((before.flags as Record<string, unknown> | null)?.[other])}, and a run keeps the flags it was first started with`,
				} satisfies BadShape;
		}
		// A program with no machine and no storage keeps its record in memory: nothing asks for it after.
		const handle: Handle = yield* (keeping.storage ?? memoryStorage())
			.open(id, read.flags)
			.pipe(Effect.orDie);

		// The run's span: under the span current at its start (a shell's line), or, with
		// none, in the trace its id names, so a run started again writes into the same trace.
		// Listed under the program's own name, as is every span its `main` makes.
		const parent = yield* Effect.option(Effect.currentParentSpan);
		const span = yield* Effect.makeSpan("run", {
			attributes: {[ATTR.program]: program.name, [ATTR.run]: id, [SERVICE_NAME]: program.name},
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

		const lines = new Map<string, Queue.Queue<Delivery<unknown>, Cause.Done>>();
		for (const [name, declared] of Object.entries<Input<unknown>>(program.inputs))
			lines.set(name, yield* Queue.bounded<Delivery<unknown>, Cause.Done>(declared.capacity));
		const closed = new Set<string>();
		/** How many writers wait for room on each input's full line now. */
		const waiting = new Map<string, number>();
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
			views.set(
				name,
				yield* SubscriptionRef.make<Shown>({state: null, newest: null, copies: [], over: false}),
			);
		const ended = yield* Deferred.make<Ended<E>>();
		let open = true;
		const finish = () => {
			open = false;
			// Shut, not ended: nobody reads after the end, and an offer still waiting for room is let go with `stopped`.
			for (const line of lines.values()) Queue.shutdownUnsafe(line);
			for (const view of views.values())
				Effect.runSync(SubscriptionRef.update(view, (shown) => ({...shown, over: true})));
		};

		/** A failure outside `main` that must end the run: a close or an ack that could not be kept. */
		const fatal = yield* Deferred.make<never>();
		const fail = (cause: Cause.Cause<unknown>) =>
			Deferred.failCause(fatal, Cause.die(Cause.squash(cause))).pipe(Effect.asVoid);
		/** The same, from tea's `onError`, which cannot wait: a machine copy's failure nobody waits on. */
		const broken = (error: Error) => {
			Deferred.doneUnsafe(fatal, Effect.die(error));
		};

		// A pipe into an input that acks keeps what it sends in this run's outbox until the
		// receiver has saved it (./outbox.ts). Into one that does not, a value is told and gone.
		const outbox: Outbox | undefined =
			wire?.writer.ack === "manual"
				? yield* outboxOf({
						handle,
						program: program.name,
						output: wire.output,
						problem: wire.writer.problem,
						hand: wire.writer.tell,
						gone: wire.writer.gone,
						broken: fail,
						mark,
					})
				: undefined;

		const hand = (listener: (value: unknown) => void, value: unknown) =>
			Effect.runSync(Effect.try(() => listener(value)).pipe(Effect.ignore));

		// Heard once, at the moment it is sent, and kept nowhere, but in a pipe's outbox.
		const heard = (name: string, value: unknown): Effect.Effect<void> => {
			mark(`sent ${name}`, {[ATTR.output]: name});
			for (const listener of [...(listeners.get(name) ?? [])]) hand(listener, value);
			if (wire === undefined || wire.output !== name) return Effect.void;
			if (outbox !== undefined) return outbox.send(value);
			return wire.writer
				.tell(value, Effect.void)
				.pipe(
					Effect.flatMap((word) =>
						word === "queued"
							? Effect.void
							: Effect.die(
									new Error(`${program.name} sent ${name} down a pipe that answered ${word}`),
								),
					),
				);
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

		const watch: Watch<Ms> = (name, id, runtime) =>
			Effect.gen(function* () {
				const view = views.get(name);
				if (view === undefined)
					return yield* Effect.die(new Error(`${program.name} has no machine named ${name}`));
				// Each kind's line is only ever handed the state of a copy of its own machine, watched
				// under its own name; the compiler cannot carry that through a lookup by a name read at
				// run time.
				const status = (program.machines as Kinds)[name]?.status as
					| ((state: unknown) => string)
					| undefined;
				const showing = (shown: Shown, live: boolean): Shown => {
					const state = runtime.getState();
					return {
						state: shown.newest === id ? state : shown.state,
						newest: shown.newest,
						copies: putCopy(shown.copies, {id, line: lineOf(status, state), live}),
						over: !open,
					};
				};
				// The copy watched last is the one `state()` follows.
				yield* SubscriptionRef.update(view, (shown) => showing({...shown, newest: id}, true));
				// Each update reads the copy as it is when it lands, so one that waited is not stale, and
				// one that lands after the close still says it is closed.
				let live = true;
				const shown = SubscriptionRef.update(view, (now) => showing(now, live));
				// Forked, not run to its end here: a change while another copy holds the view waits its
				// turn, as a close does. A free view takes it at once, before the dispatch returns.
				const off = runtime.subscribe(() => {
					Effect.runFork(shown);
				});
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						off();
						live = false;
					}).pipe(Effect.andThen(shown)),
				);
			});

		// A `manual` input is read with its acks; any other, as its values, taken once read.
		// One value per pull, never the whole line at once (`Stream.fromQueue` takes all it
		// finds): what `main` has not asked for stays on the line, so the end can count it.
		const inputs = Object.fromEntries(
			[...lines].map(([name, line]) => {
				const read = Stream.fromEffectRepeat(Queue.take(line));
				const declared: Input<unknown> | undefined = program.inputs[name];
				return [
					name,
					declared?.ack === "manual" ? read : read.pipe(Stream.map((told) => told.value)),
				];
			}),
		) as Io<F, I, O, Ms>["inputs"];

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
		yield* Effect.forkScoped(
			Effect.forever(
				Queue.take(marks).pipe(
					Effect.flatMap((name) =>
						handle.close(name).pipe(Effect.andThen(Effect.sync(() => endLine(name)))),
					),
				),
			).pipe(Effect.catchCause(fail)),
		);
		const endLine = (name: string) => {
			const line = lines.get(name);
			if (line !== undefined) Queue.endUnsafe(line);
		};

		// `main`, with the runs of each kind, live while it runs. When it returns, no run that began
		// may be left unfinished: its parent was the one to take it to its end (./refs.ts). A pipe's
		// outbox goes first, what an earlier start sent and never heard acked, and is drained last.
		const working = Effect.gen(function* () {
			if (outbox !== undefined) yield* outbox.resend;
			const kept = yield* refsOf(
				program.name,
				program.machines,
				handle,
				watch as never,
				{flags: read.flags, send},
				broken,
			);
			yield* program.main({...kept.kit, watch, inputs});
			yield* kept.check;
			if (outbox !== undefined) yield* outbox.drained;
		}).pipe(
			Effect.scoped,
			// A copy's last save fails as `main`'s scope closes: the race below may not have heard it yet.
			Effect.andThen(
				Effect.suspend(() => (Deferred.isDoneUnsafe(fatal) ? Deferred.await(fatal) : Effect.void)),
			),
		);

		const fiber = yield* Effect.forkScoped(
			working.pipe(
				Effect.raceFirst(Deferred.await(fatal)),
				// How the run ended goes on its record before its end is told.
				Effect.onExit((exit) => handle.end(statusOf(exit)).pipe(Effect.ignore)),
				Effect.withParentSpan(span),
				Effect.annotateSpans(SERVICE_NAME, program.name),
			),
		);
		// Observed from outside the fiber, not with `onExit` inside it: a scope
		// that closes before the fiber has started interrupts it without running
		// any of it, and the run must still end.
		fiber.addObserver((exit) => {
			// Counted before `finish` shuts the lines, in the same turn, so no tell lands between.
			const unread: Record<string, number> = {};
			for (const [name, line] of lines) {
				const left = Queue.sizeUnsafe(line);
				if (left === 0) continue;
				unread[name] = left;
				mark(`unread ${name}`, {[ATTR.input]: name, [ATTR.unread]: String(left)});
			}
			span.end(clock.currentTimeNanosUnsafe(), exit);
			finish();
			// Before the end is told, so whoever waits on it finds the next run's input already closed, when this was its last writer.
			wire?.writer.end();
			Deferred.doneUnsafe(ended, Effect.succeed(endedOf(exit, unread)));
		});

		/** The line a value told to `name` goes on, or why it cannot go on one now. */
		const lineFor = (
			name: string,
			value: unknown,
		): Queue.Queue<Delivery<unknown>, Cause.Done> | Exclude<Word, "queued"> => {
			const declared: Input<unknown> | undefined = program.inputs[name];
			const line = lines.get(name);
			if (declared === undefined || line === undefined) return "no_cell";
			if (!declared.shape.check(value)) return "bad_shape";
			if (!open) return "stopped";
			if (closed.has(name)) return "closed";
			return line;
		};
		const queued = (name: string): "queued" => {
			mark(`told ${name}`, {[ATTR.input]: name});
			return "queued";
		};
		/** Put one value on an input's line, with its ack, never waiting. The line is open here, so a refused offer means it is full. */
		const put = (name: string, told: Delivery<unknown>): Effect.Effect<Word, Full> =>
			Effect.suspend(() => {
				const line = lineFor(name, told.value);
				if (typeof line === "string") return Effect.succeed(line);
				if (Queue.offerUnsafe(line, told)) return Effect.succeed(queued(name));
				return Effect.fail(new Full({input: name, capacity: line.capacity}));
			});
		/** The same, waiting for room on a full line. One that ends while it waits says why it ended. */
		const putWaiting = (name: string, told: Delivery<unknown>): Effect.Effect<Word> =>
			Effect.suspend(() => {
				const line = lineFor(name, told.value);
				if (typeof line === "string") return Effect.succeed(line);
				const offered = Queue.offer(line, told).pipe(
					Effect.map((taken) => (taken ? queued(name) : closed.has(name) ? "closed" : "stopped")),
				);
				// Counted only when it will wait: one that finds room is taken at once and never shows.
				if (!Queue.isFullUnsafe(line)) return offered;
				const by = (n: number) =>
					Effect.sync(() => waiting.set(name, (waiting.get(name) ?? 0) + n));
				return by(1).pipe(Effect.andThen(offered), Effect.ensuring(by(-1)));
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
					copies: () => SubscriptionRef.getUnsafe(view).copies,
					lines: SubscriptionRef.changes(view).pipe(
						Stream.takeUntil((shown) => shown.over),
						// A state that moves without changing a line sends nothing.
						Stream.changesWith((a, b) => sameCopies(a.copies, b.copies)),
						Stream.map((shown) => shown.copies),
					),
				},
			]),
		) as Run<F, I, O, Ms, E>["machines"];

		const run: Run<F, I, O, Ms, E> = {
			id,
			program,
			tell: (name, value) => put(name, {value, ack: Effect.void}),
			offer: (name, value) => putWaiting(name, {value, ack: Effect.void}),
			listen: (name, listener) => {
				const these = listeners.get(name);
				// Its type comes from the output `name`, and `send` hands it only values that output's shape took.
				const wide = listener as (value: unknown) => void;
				if (these === undefined) return () => undefined;
				these.add(wide);
				return () => these.delete(wide);
			},
			machines,
			queues: () =>
				Object.fromEntries(
					[...lines].map(([name, line]) => [
						name,
						{length: Queue.sizeUnsafe(line), waiting: waiting.get(name) ?? 0},
					]),
				) as {readonly [K in keyof I]: InputQueue},
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
			const declared: Input<unknown> | undefined = program.inputs[input];
			return {
				ack: declared?.ack ?? "auto",
				problem: (value) =>
					declared === undefined
						? `there is no input named ${input}`
						: declared.shape.problem(value),
				tell: (value, ack) => putWaiting(input, {value, ack}),
				gone: Deferred.await(ended).pipe(Effect.asVoid),
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
	Ms extends Kinds,
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
 *
 * Into an input that acks (`{ack: "manual"}`), a send returns once the value
 * is kept in `from`'s outbox, and it stays there until `to` acks that it has
 * saved it: a kill on either side loses nothing, and a value can come twice,
 * so `to` drops a repeat by its own id. At most `WINDOW` values wait on their
 * ack; the next send waits, like a write to a full Unix pipe. `from` ends
 * once every value is acked, or `to` has ended. Into any other input, a value
 * is told and gone, as before (./outbox.ts).
 */
export const pipe = <
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Kinds,
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
			// Before the writer opens: a refused `from` must not hold `to`'s input open.
			if (!made.has(from.program)) return notMade(from.program);
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
export type CallOptions<I extends Inputs, O extends Outputs, Ms extends Kinds> = {
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
export const call = <F extends Flags, I extends Inputs, O extends Outputs, Ms extends Kinds, E, R>(
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
		// Checked above against each input's shape. Offered, so more than a line holds waits for
		// `main` to read, like a file piped into a command; in a fiber, so a stop is not held up behind it.
		yield* Effect.forkScoped(
			Effect.gen(function* () {
				for (const [name, values] of Object.entries(told))
					for (const value of values ?? []) yield* started.run.offer(name, value);
				for (const name of Object.keys(program.inputs)) started.close(name);
			}),
		);
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
	/** A flag's default. Left out: it has none. */
	readonly default?: {readonly value: unknown};
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
	/** The machines that say a status line, one per copy: every one, for a program defined through the types. */
	readonly status: readonly string[];
}

const listed = (
	declared: Readonly<Record<string, Flag<unknown> | Input<unknown> | Output<unknown>>>,
) =>
	Object.entries(declared).map(
		([name, d]): Listed => ({
			name,
			description: d.description,
			schema: d.shape.json,
			...("default" in d && d.default !== undefined ? {default: d.default} : {}),
		}),
	);

export const listing = (program: AnyProgram): Listing => ({
	name: program.name,
	description: program.description,
	flags: listed(program.flags),
	inputs: listed(program.inputs),
	outputs: listed(program.outputs),
	machines: Object.keys(program.machines),
	status: Object.entries<AnyKind>(program.machines)
		.filter(([, declared]) => typeof declared.status === "function")
		.map(([name]) => name),
});
