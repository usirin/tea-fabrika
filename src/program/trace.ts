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
//   run                 one span per program run, from its start to its end (./program.ts)
//     told <input>      an event: a value was told on an input. Never the value.
//     sent <output>     an event: the program sent a value. Never the value.
//     round 2           one span per run of a machine, made by `runTraced`, named by its `Drawing`
//       msg <type>      an event: a Msg the machine folded
//       read ticket     a span: a Cmd's cell, from its start to its answer, with how it ended
//       builder         a span: a Sub's stream, while it is on
//
// Each span says which program or stage it belongs to in `service.name`
// (SERVICE_NAME): a trace viewer lists and colors spans by it. The exporter
// moves it to where OpenTelemetry keeps it (src/trace/view.ts).
//
// Spans carry names, tags and ids, never values: a Msg's tag, not its
// fields; a pull request's url, not its body. One tag is a few words the
// program wrote about its own state: `tea.status`, a machine copy's status
// line, the same one `jobs` shows, kept up as the state moves.

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
	/** How many values were still on an input's line, never read, when its run ended. */
	unread: "tea.input.unread",
	output: "tea.output.name",
	pipeOutput: "tea.pipe.output",
	pipeInput: "tea.pipe.input",
	/** The whole line typed at tsh, on its root span only: the one place a value may be. */
	line: "tsh.line",
	ticket: "tea.ticket",
	round: "tea.round",
	pr: "tea.pr",
	/** A commit, its first seven characters. */
	head: "tea.head",
	/** How a stage ended, by its name: `done`, `send:builder:checks_red`, `stuck:read_failed`. */
	outcome: "tea.outcome",
	costUsd: "tea.cost.usd",
	/** A machine copy's status line, as its program declares it: a few plain words about where it stands. */
	status: "tea.status",
} as const;

/** OpenTelemetry's name for what a span belongs to: a viewer's service. */
export const SERVICE_NAME = "service.name";

/** The id of the span a trace keyed by `key` hangs off. Never exported: the exporter drops it (src/trace/view.ts). */
export const traceParentIdOf = (key: string): string => runTraceId(`${key}/parent`).slice(0, 16);

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
		spanId: traceParentIdOf(key),
		sampled: true,
	});

/** The current time on Effect's clock, as a span takes it. */
export const nowNanos = Clock.clockWith((clock) => Effect.succeed(clock.currentTimeNanosUnsafe()));

/** The service the spans made here belong to: the one `Effect.annotateSpans` set around here. `undefined`: none. */
export const currentService = Effect.map(Effect.spanAnnotations, (annotations) => {
	const service = annotations[SERVICE_NAME];
	return typeof service === "string" ? service : undefined;
});

/** How a Cmd's cell ended, as `tea.cmd.outcome` says it. */
const outcomeOf = (exit: Exit.Exit<unknown, unknown>): string => {
	if (Exit.isSuccess(exit)) return "ok";
	return Exit.hasInterrupts(exit) ? "interrupted" : "failed";
};

/** Tags on a span: ids and counts, never a value. */
export type Tags = Readonly<Record<string, string | number>>;

/**
 * How one machine's run is drawn in a trace: the name of its span, a short
 * name for each Cmd's and each Sub's span, and the tags read from its state.
 * A name is plain words a person reads in a list of spans (`read ticket`,
 * `waiting on checks`), with the service shown beside it saying whose it is.
 */
export interface Drawing<S, C extends Cmd, U extends Sub> {
	/** The machine's span, such as `round 2` or `pr #597`. */
	readonly name: string;
	/** The service its spans are listed under, such as `review`. Unset: the one around it. */
	readonly service?: string;
	/**
	 * A name for each Cmd's and Sub's span. `null`: no span of its own, and
	 * what it starts hangs under the machine's span instead. Every Cmd and Sub
	 * is named here, so a new one cannot show up under its tag by mistake.
	 * tea's own timer is not drawn.
	 */
	readonly steps: {readonly [T in Exclude<C["type"] | U["type"], "timer">]: string | null};
	/** Tags read from the state: set at the start, and again after each Msg. */
	readonly tags?: (state: S) => Tags;
	/** Tags fixed for the run, such as the pull request it is on. */
	readonly attributes?: Tags;
}

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
 * tea's Effect `run`, traced. The machine's run is one span, named by
 * `drawing`, from here to the end of the caller's scope, under the span
 * current here. Each Msg it folds is an event on it, and its tags follow the
 * state; each Cmd's cell and each Sub's stream is a span under it, by the
 * name the drawing gives it. The options are tea's own, unchanged: a cell
 * gets the same Cmd and answers the same way.
 *
 * `machineName`: the machine's name in its program, kept as `tea.machine.name`.
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
	machineName: string,
	machine: Machine<S, M, C, U, Ctx>,
	opts: EffectRunOptions<S, M, C, U, Ctx, E, I, B>,
	drawing: Drawing<S, C, U>,
) =>
	Effect.gen(function* () {
		// Set on each span, not around them: a cell runs on whichever fiber dispatched its Msg.
		const service = drawing.service ?? (yield* currentService);
		const mine = service === undefined ? {} : {[SERVICE_NAME]: service};
		const span = yield* Effect.makeSpanScoped(drawing.name, {
			attributes: {[ATTR.machine]: machineName, ...drawing.attributes, ...mine},
		});
		const steps: Readonly<Record<string, string | null>> = drawing.steps;
		const given: {readonly interpret?: object; readonly subscribe?: object} = opts;
		const interpret = eachOf(given.interpret, (type, cell: Cell) => {
			const name = steps[type] ?? null;
			return name === null
				? (cmd) => cell(cmd).pipe(Effect.withParentSpan(span))
				: (cmd) =>
						cell(cmd).pipe(
							Effect.onExit((exit) => Effect.annotateCurrentSpan(ATTR.cmdOutcome, outcomeOf(exit))),
							Effect.withSpan(name, {
								parent: span,
								attributes: {[ATTR.machine]: machineName, [ATTR.cmd]: type, ...mine},
							}),
						);
		});
		const subscribe = eachOf(given.subscribe, (type, runner: Runner) => {
			const name = steps[type] ?? null;
			return name === null
				? (sub) => runner(sub).pipe(Stream.provideService(Tracer.ParentSpan, span))
				: (sub) =>
						runner(sub).pipe(
							Stream.withSpan(name, {
								parent: span,
								attributes: {[ATTR.machine]: machineName, [ATTR.sub]: type, ...mine},
							}),
						);
		});
		// Each cell above takes the Cmd its own was given and answers as it does; the
		// compiler cannot carry the map's per-key types through `Object.entries`.
		const traced = {
			...opts,
			...(interpret === undefined ? {} : {interpret}),
			...(subscribe === undefined ? {} : {subscribe}),
		} as EffectRunOptions<S, M, C, U, Ctx, E, I, B>;
		const booting = yield* run(machine, traced);
		const clock = yield* Clock.Clock;
		const tag = (state: S) => {
			for (const [key, value] of Object.entries(drawing.tags?.(state) ?? {}))
				span.attribute(key, value);
		};
		const offBoot = booting.onBoot(tag);
		const off = booting.observe((msg, state) => {
			span.event(`msg ${msg.type}`, clock.currentTimeNanosUnsafe(), {
				[ATTR.machine]: machineName,
				[ATTR.msg]: msg.type,
			});
			tag(state);
		});
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				offBoot();
				off();
			}),
		);
		return booting;
	}) as Effect.Effect<
		EffectBootingRuntime<S, M, E, CellErrors<C, I>>,
		never,
		Scope.Scope | InterpretServices<I> | SubscribeServices<B>
	>;
