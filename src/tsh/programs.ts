import {Context, Effect, Layer, type Scope} from "effect";
import type {Flags, Inputs, Outputs} from "../program/program.ts";
import {
	type AnyProgram,
	type BadShape,
	type Called,
	call,
	type DoesNotFit,
	type Ended,
	type Given,
	type Kept,
	type Listeners,
	type Machines,
	type Program,
	pipe,
	type Running,
	type Started,
	start,
} from "../program/program.ts";
import type {Storage} from "../program/storage.ts";
import {BUILTINS} from "./grammar.ts";

// The program list: what tsh can start by name, like the directories on a
// shell's PATH. Each entry is a program and the services it asks for, given
// together, so a program cannot be listed without what it needs: the type of
// `listed` takes a Layer for exactly the program's services. tsh starts every
// program through its entry and never sees a service.
//
//   const list = programList([
//     listed(shipProgram, Layer.mergeAll(gitHubCodeHost(accounts), noWrites)),
//     listed(seq, Layer.empty),
//   ]);
//
// The services are made fresh for each run, inside the run's scope, and are
// let go when the run's scope closes.

/** A run's starter handle, of any program. */
export type AnyRunning = Running<any, any, any, any, any>;
export type AnyStarted = Started<any, any, any, any, any>;

/** What a program can be started with from a line. Every value was checked against its own shape first. */
export interface Entry {
	readonly program: AnyProgram;
	/** `start`, with the program's services given. */
	readonly start: (
		flags: Readonly<Record<string, unknown>>,
		listeners: Listeners<any>,
		keeping: Kept,
	) => Effect.Effect<AnyStarted, never, Scope.Scope>;
	/** `pipe`, with the program's services given: this program's `output` into `to`'s `input`. */
	readonly pipe: (
		flags: Readonly<Record<string, unknown>>,
		listeners: Listeners<any>,
		keeping: Kept,
		output: string,
		to: AnyRunning,
		input: string,
	) => Effect.Effect<AnyStarted | DoesNotFit, never, Scope.Scope>;
	/** `call`, with the program's services given. */
	readonly call: (
		flags: Readonly<Record<string, unknown>>,
		options: {
			readonly told: Readonly<Record<string, readonly unknown[]>>;
			readonly listeners: Listeners<any>;
			readonly keeping: Kept;
			readonly stopOn: Effect.Effect<unknown>;
		},
	) => Effect.Effect<Called<any, unknown> | BadShape, never, Scope.Scope>;
}

/**
 * List a program with its services. `services` must give every service the
 * program asks for: a program whose `main` reads `CodeHost` does not
 * type-check with a Layer that gives none.
 */
export function listed<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Machines,
	E,
	R,
>(program: Program<F, I, O, Ms, E, R>, services: Layer.Layer<R>): Entry {
	const served = <A>(effect: Effect.Effect<A, never, R | Scope.Scope>) =>
		Effect.flatMap(Layer.build(services), (context) => Effect.provideContext(effect, context));
	// tsh hands each entry values its own shapes took, by name, and the run's id and storage
	// (which every program takes). The types below cannot see that: they are the program's own,
	// and the line was read at run time.
	const given = (flags: Readonly<Record<string, unknown>>) => flags as Given<F>;
	const keepingOf = (keeping: Kept) => keeping as never;
	return {
		program,
		start: (flags, listeners, keeping) =>
			served(start(program, given(flags), listeners as Listeners<O>, keepingOf(keeping))),
		pipe: (flags, listeners, keeping, output, to, input) =>
			served(
				pipe(
					{
						program,
						flags: given(flags),
						listeners: listeners as Listeners<O>,
						keeping: keepingOf(keeping),
					},
					output as keyof O & string,
					to,
					input as never,
				),
			),
		call: (flags, options) =>
			served(
				call(program, given(flags), {
					told: options.told,
					listeners: options.listeners as Listeners<O>,
					keeping: keepingOf(options.keeping),
					stopOn: options.stopOn,
				} as never),
			),
	};
}

/** The programs tsh can start, by name. */
export type ProgramList = ReadonlyMap<string, Entry>;

/**
 * Make a program list. Two programs with one name, or a program named like a
 * built-in (`jobs`, `tell`, ...), is refused here, when the list is made:
 * a name on a line must mean one thing.
 */
export function programList(entries: readonly Entry[]): ProgramList {
	const list = new Map<string, Entry>();
	for (const entry of entries) {
		const {name} = entry.program;
		if ((BUILTINS as readonly string[]).includes(name))
			throw new Error(`a program cannot be named ${name}: that is a tsh built-in`);
		if (list.has(name)) throw new Error(`two programs are named ${name}`);
		if (!/^[a-z][a-z0-9-]*$/.test(name))
			throw new Error(`a program on a tsh line is named in small letters, digits and -: ${name}`);
		list.set(name, entry);
	}
	return list;
}

/** The program list tsh starts programs from. Whoever starts tsh provides it. */
export class Programs extends Context.Service<Programs, ProgramList>()("tsh/Programs") {}

/**
 * Where tsh's jobs keep what must outlive tsh: each job's run id names its
 * run in this storage, so a job started again under the same id finds what
 * it left, like a daemon handed its spool directory.
 */
export class JobStorage extends Context.Service<JobStorage, Storage>()("tsh/JobStorage") {}

/** How a run ended, as a shell's exit status: 0 ended, 1 failed, 130 stopped (as by Ctrl-C). */
export const statusOf = (ended: Ended<unknown>): number =>
	ended.kind === "ended" ? 0 : ended.kind === "stopped" ? 130 : 1;

/**
 * How a job of several programs ended: the status of the last one that did
 * not end well, or 0. bash's `pipefail`, on always: in a typed pipe, a stage
 * that failed (one that sent a value the next refused) is the line's failure,
 * even when the last stage ended well on what it got.
 */
export const statusOfJob = (ends: readonly Ended<unknown>[]): number =>
	ends.reduce((status, ended) => (statusOf(ended) === 0 ? status : statusOf(ended)), 0);
