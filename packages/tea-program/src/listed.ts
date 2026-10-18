import {Effect, Layer, type Scope} from "effect";
import {
	type AnyProgram,
	type BadShape,
	type Called,
	call,
	type DoesNotFit,
	type Flags,
	type Given,
	type Inputs,
	type Kept,
	type Kinds,
	type Listeners,
	type Outputs,
	type Program,
	pipe,
	type Running,
	type Started,
	start,
} from "./program.ts";

// A program packed with the services it asks for, so a host can start it
// without knowing what those are. The type of `listed` takes a Layer for
// exactly the program's services, so a program cannot be packed without what
// it needs:
//
//   const entry = listed(shipProgram, Layer.mergeAll(gitHubCodeHost(accounts), noWrites));
//   entry.start(flags, listeners, keeping)
//
// The services are made fresh for each run, inside the run's scope, and are
// let go when the run's scope closes. Fresh means fresh even when the host
// starts the run inside a Layer of its own that built the same service. A host (tsh, or any other) keeps the
// entries it can start and never sees a service.

/** A run's starter handle, of any program. */
export type AnyRunning = Running<any, any, any, any, any>;
export type AnyStarted = Started<any, any, any, any, any>;

/** A program and its services, ready to start. Every value a host passes was checked against its own shape first. */
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
 * Pack a program with its services. `services` must give every service the
 * program asks for: a program whose `main` reads `CodeHost` does not
 * type-check with a Layer that gives none.
 */
export function listed<
	F extends Flags,
	I extends Inputs,
	O extends Outputs,
	Ms extends Kinds,
	E,
	R,
>(program: Program<F, I, O, Ms, E, R>, services: Layer.Layer<R>): Entry {
	// A memo map of the run's own. `Layer.build` forks the memo map the starting fiber carries,
	// so a run started while its host's own Layer is being built would be handed any service
	// that build already made, instead of a fresh one.
	const served = <A>(effect: Effect.Effect<A, never, R | Scope.Scope>) =>
		Effect.gen(function* () {
			const scope = yield* Effect.scope;
			const memo = yield* Layer.makeMemoMap;
			const context = yield* Layer.buildWithMemoMap(services, memo, scope);
			return yield* Effect.provideContext(effect, context);
		});
	// A host hands each entry values its own shapes took, by name, and the run's id and storage
	// (which every program takes). The types below cannot see that: they are the program's own,
	// and the values were read at run time.
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
