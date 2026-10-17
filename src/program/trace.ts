import type {Cmd, Machine, Sub} from "@demlik/tea";
import {
	type CellErrors,
	type EffectBootingRuntime,
	type EffectInterpret,
	type EffectRunOptions,
	type EffectSubscribe,
	type InterpretServices,
	run,
	type SubscribeServices,
} from "@demlik/tea/effect";
import {runTraceId} from "@demlik/tea/otel";
import {Clock, Effect, Exit, type Scope, Stream, Tracer} from "effect";

// Tracing, in Effect's own terms: spans, events, links. Nothing here knows
// OpenTelemetry. A host that wants the spans somewhere provides a tracer
// Layer (src/trace/otel.ts does it over OTLP); without one, Effect's own
// tracer keeps them in memory and drops them, and a host that turns tracing
// off (`Effect.withTracerEnabled(false)`) makes each one a no-op.
//
//   run <program>       one span per program run, from its start to its end (./program.ts)
//     told <input>      an event: a value was told on an input. Never the value.
//     sent <output>     an event: the program sent a value. Never the value.
//     machine <name>    one span per run of a machine, made by `runTraced`
//       msg <type>      an event: a Msg the machine folded
//       cmd <type>      a span: a Cmd's cell, from its start to its answer, with how it ended
//       sub <type>      a span: a Sub's stream, while it is on
//
// Spans carry names, tags and ids, never values: a Msg's tag, not its
// fields; a pull request's url, not its body.

/** The attributes this repo writes, by name. */
export const ATTR = {
	program: "tea.program.name",
	run: "tea.run.id",
	machine: "tea.machine.name",
	msg: "tea.msg.type",
	cmd: "tea.cmd.type",
	cmdOutcome: "tea.cmd.outcome",
	sub: "tea.sub.type",
	input: "tea.input.name",
	output: "tea.output.name",
	pipeOutput: "tea.pipe.output",
	pipeInput: "tea.pipe.input",
} as const;

/**
 * The parent a trace keyed by `key` hangs off: an external span whose trace
 * id is tea's `runTraceId(key)`. Nothing is exported under it; it only names
 * the trace. The same key gives the same trace in any process, so a run
 * started again after a kill writes into the trace it wrote into before.
 */
export const traceOf = (key: string): Tracer.ExternalSpan =>
	Tracer.externalSpan({
		traceId: runTraceId(key),
		// Derived, not a constant: two traces never share a parent span id.
		spanId: runTraceId(`${key}/parent`).slice(0, 16),
		sampled: true,
	});

/** The current time on Effect's clock, as a span takes it. */
export const nowNanos = Clock.clockWith((clock) => Effect.succeed(clock.currentTimeNanosUnsafe()));

/** How a Cmd's cell ended, as `tea.cmd.outcome` says it. */
const outcomeOf = (exit: Exit.Exit<unknown, unknown>): string => {
	if (Exit.isSuccess(exit)) return "ok";
	return Exit.hasInterrupts(exit) ? "interrupted" : "failed";
};

/** One cell of an `interpret` map, seen from outside its type: a Cmd in, an Effect out. */
type Cell = (cmd: unknown) => Effect.Effect<unknown, unknown, unknown>;
/** One runner of a `subscribe` map, seen the same way: a Sub in, a Stream out. */
type Runner = (sub: unknown) => Stream.Stream<unknown, unknown, unknown>;

/** Each entry of a map of functions, wrapped. `undefined`: there was no map. */
const eachOf = <F extends Cell | Runner>(
	map: object | undefined,
	wrap: (type: string, f: F) => F,
): Readonly<Record<string, F>> | undefined =>
	map === undefined
		? undefined
		: Object.fromEntries(
				// Every value of an `interpret` or `subscribe` map is one of its cells or runners.
				Object.entries(map).map(([type, f]) => [type, wrap(type, f as F)]),
			);

/**
 * tea's Effect `run`, traced. The machine's run is one span, `machine <name>`,
 * from here to the end of the caller's scope, under the span current here.
 * Each Msg it folds is an event on it; each Cmd's cell and each Sub's stream
 * is a span under it. The options are tea's own, unchanged: a cell gets the
 * same Cmd and answers the same way.
 *
 * `attributes`: ids that tell this run from the others, such as the pull
 * request it is on. Never a value.
 */
export const runTraced = <
	S,
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	Ctx,
	I extends EffectInterpret<M, C> = EffectInterpret<M, C, never>,
	B extends EffectSubscribe<M, U> = EffectSubscribe<M, U, never>,
	E extends {type: string} = never,
>(
	name: string,
	machine: Machine<S, M, C, U, Ctx>,
	opts: EffectRunOptions<S, M, C, U, Ctx, E, I, B>,
	attributes: Readonly<Record<string, string>> = {},
) =>
	Effect.gen(function* () {
		const span = yield* Effect.makeSpanScoped(`machine ${name}`, {
			attributes: {[ATTR.machine]: name, ...attributes},
		});
		const options = {parent: span} as const;
		const given: {readonly interpret?: object; readonly subscribe?: object} = opts;
		const interpret = eachOf(
			given.interpret,
			(type, cell: Cell) => (cmd) =>
				cell(cmd).pipe(
					Effect.onExit((exit) => Effect.annotateCurrentSpan(ATTR.cmdOutcome, outcomeOf(exit))),
					Effect.withSpan(`cmd ${type}`, {
						...options,
						attributes: {[ATTR.machine]: name, [ATTR.cmd]: type},
					}),
				),
		);
		const subscribe = eachOf(
			given.subscribe,
			(type, runner: Runner) => (sub) =>
				runner(sub).pipe(
					Stream.withSpan(`sub ${type}`, {
						...options,
						attributes: {[ATTR.machine]: name, [ATTR.sub]: type},
					}),
				),
		);
		// Each cell above takes the Cmd its own was given and answers as it does; the
		// compiler cannot carry the map's per-key types through `Object.entries`.
		const traced = {
			...opts,
			...(interpret === undefined ? {} : {interpret}),
			...(subscribe === undefined ? {} : {subscribe}),
		} as EffectRunOptions<S, M, C, U, Ctx, E, I, B>;
		const booting = yield* run(machine, traced);
		const clock = yield* Clock.Clock;
		const off = booting.observe((msg) =>
			span.event(`msg ${msg.type}`, clock.currentTimeNanosUnsafe(), {
				[ATTR.machine]: name,
				[ATTR.msg]: msg.type,
			}),
		);
		yield* Effect.addFinalizer(() => Effect.sync(off));
		return booting;
	}) as Effect.Effect<
		EffectBootingRuntime<S, M, E, CellErrors<C, I>>,
		never,
		Scope.Scope | InterpretServices<I> | SubscribeServices<B>
	>;
