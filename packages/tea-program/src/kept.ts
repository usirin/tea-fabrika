import {type Cmd, type Machine, type OnError, RuntimeDiscardNotice, type Sub} from "@demlik/tea";
import type {
	CellErrors,
	EffectInterpret,
	EffectRunOptions,
	EffectRuntime,
	EffectSubscribe,
	InterpretServices,
	Stopped,
	StoreFailed,
	SubscribeServices,
} from "@demlik/tea/effect";
import {Deferred, Effect, Latch, type Scope, Stream} from "effect";
import type {Handle, StorageFailed} from "./storage.ts";
import {type Drawing, runTraced} from "./trace.ts";

// How a program starts one copy of one of its machines, kept: what a ref's
// `start` does under the live table (./program.ts). It is the only way a
// program can hand a machine its storage, and it starts a kept run the way
// Elm's `init` starts a program, from what was kept:
//
//   const runtime = yield* machines.ship.get(id).start({type: "start", pr});
//   const end = yield* runtime.done();
//
// 1. The kept state is read first, before the machine exists, and `first`
//    says from it which Msg goes first: the kind's `recovered` Msg for a run
//    that stopped part way, the caller's start Msg for one that never began,
//    or nothing.
// 2. The machine is booted with every Listen and every timer held shut. tea
//    loads the kept state at boot and opens the Listens that state asks for
//    at once; a Listen that answers fast could move the machine on before
//    the `resume` arrives, and `resume` would then send a write the machine
//    had already sent. Held, none of them can.
// 3. `first`'s Msg is dispatched to quiescence: it is folded, and every Cmd
//    it set going has answered and been folded. Then the Listens open, on
//    the state that left. (A Listen never holds quiescence up: none is in
//    tea's queue until it sends.)
//
// So the first Msg the machine folds after a restart is always decided from
// the state as it was kept: in Elm, nothing reaches `update` before `init`
// has returned. A Listen the first Msg replaces (a run the resume counts
// again) is closed before it ever started.
//
// A run kept in a state its `terminal` calls over is finished. It is booted
// and shown, and `first` is not asked: no Msg goes to it, so no work in it is
// done again. Its `done()` answers the state it was kept in.
//
// What tea reports to its `onError` ends the run, never the process. tea's
// own default rethrows on a macrotask, so one bad Listen or one failed last
// save crashes every program in the process; a Listen whose stream fails
// also leaves `done()` waiting forever (experiment 73, finding 2). tea's own
// rule decides what is a failure, by the error's class and not its phase: a
// `RuntimeDiscardNotice` is a loss the host asked for, and every other
// report is a failure. One while the run is live ends its `done()`, so the
// parent waiting on it dies with the cause, tea's phase named:
//
//   review run review/.../pull/14 failed (tea's "sub"): the checks feed broke
//
// One once the run is closing (its last save: tea's "stop-save") has nobody
// waiting on `done()`: it ends the program run instead, in the same words.

/** tea's own timer, the one its Effect engine runs when it is given none: here it is held like every other Sub. */
const timer = (sub: {readonly deps: {readonly ms: number; readonly msg: unknown}}) =>
	Stream.fromEffect(Effect.as(Effect.sleep(sub.deps.ms), sub.deps.msg));

/** tea's run options for a kept machine run: the store is never given here, the program gives it. */
export type KeptOptions<
	S,
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	Ctx,
	I,
	B,
> = EffectRunOptions<S, M, C, U, Ctx, never, I, B> & {
	readonly store?: never;
	/** The program says what a failure tea reports does: it ends the run (see the top of this file). */
	readonly onError?: never;
};

/** From the state as it was kept (`null`: nothing was), the Msg that goes first. `null`: none; the machine goes on as it stood. */
export type First<S, M> = (kept: S | null) => M | null;

/** A machine run going, kept, after its first Msg. */
export type KeptRuntime<M extends {type: string}, S, C extends Cmd, I> = EffectRuntime<
	S,
	M,
	never,
	CellErrors<C, I>
>;

/** How a kept run can fail to start: its storage, tea's load or save, or the first Msg's Cmd. */
export type KeptFailed<C extends Cmd, I> = StorageFailed | StoreFailed | Stopped | CellErrors<C, I>;

/**
 * Run `machine`, kept under `id` in `handle`'s run, from where it was kept.
 * `show` is called with the booted machine before its first Msg, so a viewer
 * sees it from the kept state on. `drawing`: how its trace shows it
 * (`runTraced`), from the state as it was kept. `broken`: how a failure tea
 * reports once the run is closing ends the program run. See the note at the
 * top of this file.
 */
export const runKept = <
	S,
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	Ctx,
	I extends EffectInterpret<M, C> = EffectInterpret<M, C, never>,
	B extends EffectSubscribe<M, U> = EffectSubscribe<M, U, never>,
>(
	handle: Handle,
	name: string,
	machine: Machine<S, M, C, U, Ctx>,
	id: string,
	options: KeptOptions<S, M, C, U, Ctx, I, B>,
	first: First<S, M>,
	show: (runtime: KeptRuntime<M, S, C, I>) => Effect.Effect<void, never, Scope.Scope>,
	drawing: (kept: S | null) => Drawing<S, C, U>,
	broken: (cause: Error) => void,
): Effect.Effect<
	KeptRuntime<M, S, C, I>,
	KeptFailed<C, I>,
	Scope.Scope | InterpretServices<I> | SubscribeServices<B>
> =>
	Effect.gen(function* () {
		// Saved by this program's own machine under this name: its own state.
		const kept = (yield* handle.read(name, id)) as S | null;
		// A run kept already over is finished: it is never sent a first Msg, so nothing in it runs again.
		const over = kept !== null && options.terminal?.(kept) === true;
		const msg = over ? null : first(kept);

		const shut = yield* Latch.make(false);
		const given: Readonly<
			Record<string, (sub: never) => Stream.Stream<unknown, unknown, unknown>>
		> = {timer, ...(options.subscribe ?? {})};
		const held = Object.fromEntries(
			Object.entries(given).map(([type, runner]) => [
				type,
				(sub: never) => Stream.unwrap(shut.await.pipe(Effect.map(() => runner(sub)))),
			]),
		);
		// Each runner above answers the Sub it was given as it did; the compiler cannot carry the map's
		// per-key types through `Object.entries`. The store is the run's own, fenced.
		// How this run ended, when tea reported a failure while it was live. Set once: the first is the cause.
		const failed = yield* Deferred.make<never>();
		let closing = false;
		const onError: OnError = (error, {phase}) => {
			if (error instanceof RuntimeDiscardNotice) return;
			const ended = new Error(`${name} run ${id} failed (tea's "${phase}"): ${wordsOf(error)}`, {
				cause: error,
			});
			if (closing) broken(ended);
			else Deferred.doneUnsafe(failed, Effect.die(ended));
		};
		const opts = {
			...options,
			subscribe: held,
			store: handle.store(name, id),
			onError,
		} as EffectRunOptions<S, M, C, U, Ctx, never, I, B>;
		const booting = yield* runTraced(name, machine, opts, drawing(kept));
		// Added after the run, so it runs before tea's `stop()`: what tea reports from here on, its last
		// save among them, has nobody waiting on `done()`.
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				closing = true;
			}),
		);
		const runtime = yield* booting.ready;
		yield* show(runtime);
		// To quiescence, not once: tea's `done()` reads the state its fold set, before that state's save and
		// its listeners have run. A caller that waits on `done()` must find a first Msg that has settled.
		if (msg !== null) yield* runtime.dispatch(msg);
		yield* shut.open;
		const done = () => Effect.raceFirst(runtime.done(), Deferred.await(failed));
		return {...runtime, done};
	});

/** A failure in a few words: its message, else its tag, else itself. */
const wordsOf = (error: unknown): string => {
	if (error instanceof Error && error.message !== "") return error.message;
	const tag = (error as {readonly _tag?: unknown} | null)?._tag;
	return typeof tag === "string" ? tag : String(error);
};
