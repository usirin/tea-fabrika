import {
	type Cmd,
	DispatchDiscardedError,
	type Interpret,
	type Machine,
	NoCellError,
	type OnError,
	type PortEmitter,
	type Sub,
	type Subscribe,
} from "@demlik/tea";
import {
	type EffectInterpret,
	type EffectSubscribe,
	run as runEffect,
	Stopped,
} from "@demlik/tea/effect";
import {run as runPromise} from "@demlik/tea/promise";
import {Cause, Effect, Exit} from "effect";
import type {AnyOutput, Inputs, OutCmd, Program} from "./program.ts";
import type {Late, ProgramRun} from "./tell.ts";

// Starting a program, on either engine tea ships. The host hands the handlers
// for the program's own Cmds and Subs, as for any tea run. tea-program adds
// the handler of each output: it checks the value against the output's shape
// and puts it on the output's Port.
//
// The two engines differ in one place that matters here. A Promise-engine
// handler gets `ctx.emit`. An Effect-engine handler gets no ctx at all, so the
// output handler there emits through the run's handle, which it reads from a
// slot filled once `run` has handed the handle back. An output sent by `init`
// on the Effect engine would find the slot empty; no program here sends one.
//
// Inside, the engine calls are typed loosely: tea's handler tables are mapped
// types over the machine's Cmd union, and "the host's cells plus mine" is a
// table the compiler cannot add up for a generic program. The typed promise
// is the signature of each function and the `ProgramRun` it hands back.

type Box = {late: Late[]; dropped: string[]; stopped: boolean};

/** The handlers the host writes for a Promise-engine run: every Cmd but the outputs. */
export type PromiseHandlers<
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	O extends AnyOutput,
> = {
	readonly interpret: Omit<Interpret<M, C, undefined>, O["type"]>;
	readonly subscribe: Subscribe<M, Exclude<U, {readonly type: "timer"}>, undefined>;
	readonly onError?: OnError;
};

/** Start a program on the Promise engine and wait for it to boot. */
export async function startPromise<
	S extends {type: string},
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	I extends Inputs,
	O extends AnyOutput,
>(
	program: Program<S, M, C, U, I, O>,
	handlers: NoInfer<PromiseHandlers<M, C, U, O>>,
): Promise<ProgramRun<Program<S, M, C, U, I, O>>> {
	const box: Box = {late: [], dropped: [], stopped: false};
	const outputs = Object.fromEntries(
		program.outputs.map((o: AnyOutput) => [
			o.type,
			(cmd: OutCmd<string, unknown>, ctx: PortEmitter) => {
				if (o.shape.check(cmd.payload)) ctx.emit(o.port, cmd.payload);
				else box.dropped.push(o.type);
				return Promise.resolve();
			},
		]),
	);
	const machine: Machine<any, any, any, any, undefined> = program.machine;
	const runtime = await runPromise(machine, {
		ctx: undefined,
		interpret: {...handlers.interpret, ...outputs},
		subscribe: handlers.subscribe,
		...(handlers.onError === undefined ? {} : {onError: handlers.onError}),
	}).ready;
	return {
		program,
		state: () => runtime.getState(),
		observe: (observer) => runtime.observe((msg) => observer(msg)),
		stopped: () => box.stopped,
		enqueue: (name, payload) => {
			// dispatchOnce: on the line now, without waiting for the fold or its follow-ups.
			runtime.dispatchOnce({type: name, payload}).catch((error: unknown) => {
				box.late.push({msg: name, why: whyLate(error)});
			});
		},
		listen: (out, listener) => runtime.subscribePort(out.port, listener),
		late: box.late,
		dropped: box.dropped,
		stop: () => {
			box.stopped = true;
			return runtime.stop();
		},
		idle: () => runtime.idle(),
	};
}

function whyLate(error: unknown): Late["why"] {
	if (error instanceof NoCellError) return "no_cell";
	if (error instanceof DispatchDiscardedError) return "stopped";
	// The Promise engine's own "runtime stopped" error is not exported by tea, so it cannot be named here.
	return "refused";
}

/** The handlers the host writes for an Effect-engine run: every Cmd but the outputs. They read no services. */
export type EffectHandlers<
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	O extends AnyOutput,
> = {
	readonly interpret: Omit<EffectInterpret<M, C, never>, O["type"]>;
	readonly subscribe: EffectSubscribe<M, U, never>;
	readonly onError?: OnError;
};

/** Start a program on the Effect engine, in the caller's Scope, and wait for it to boot. */
export const startEffect = <
	S extends {type: string},
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	I extends Inputs,
	O extends AnyOutput,
>(
	program: Program<S, M, C, U, I, O>,
	handlers: NoInfer<EffectHandlers<M, C, U, O>>,
) =>
	Effect.gen(function* () {
		const box: Box = {late: [], dropped: [], stopped: false};
		const slot: {emit?: (o: AnyOutput, value: unknown) => void} = {};
		const outputs = Object.fromEntries(
			program.outputs.map((o: AnyOutput) => [
				o.type,
				(cmd: OutCmd<string, unknown>) =>
					Effect.sync(() => {
						if (o.shape.check(cmd.payload)) slot.emit?.(o, cmd.payload);
						else box.dropped.push(o.type);
					}),
			]),
		);
		const machine: Machine<any, any, any, any, undefined> = program.machine;
		const booting = yield* runEffect(machine, {
			ctx: undefined,
			interpret: {...handlers.interpret, ...outputs},
			subscribe: handlers.subscribe,
			...(handlers.onError === undefined ? {} : {onError: handlers.onError}),
		});
		const runtime = yield* booting.ready;
		slot.emit = (o, value) => runtime.emitPort(o.port, value);
		// Finalizers run last-added first, so this one runs before the run's own release stops it.
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				box.stopped = true;
			}),
		);
		const handle: ProgramRun<Program<S, M, C, U, I, O>> = {
			program,
			state: () => runtime.getState(),
			observe: (observer) => runtime.observe((msg) => observer(msg)),
			stopped: () => box.stopped,
			enqueue: (name, payload) => {
				// runFork starts the fiber at once, so the Msg is on the line before this returns.
				Effect.runFork(
					runtime.dispatchOnce({type: name, payload}).pipe(
						Effect.exit,
						Effect.tap((exit) => {
							if (Exit.isSuccess(exit)) return Effect.void;
							const failure = Cause.squash(exit.cause);
							const why =
								failure instanceof NoCellError
									? "no_cell"
									: failure instanceof Stopped
										? "stopped"
										: "refused";
							return Effect.sync(() => {
								box.late.push({msg: name, why});
							});
						}),
					),
				);
			},
			listen: (out, listener) => runtime.subscribePort(out.port, listener),
			late: box.late,
			dropped: box.dropped,
			stop: () => {
				box.stopped = true;
				return Effect.runPromise(runtime.stop());
			},
			idle: () => Effect.runPromise(runtime.idle()),
		};
		return handle;
	});
