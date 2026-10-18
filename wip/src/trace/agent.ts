import type {AgentEvent} from "@demlik/tea/agent";
import {type AgentSpans, agentSpans} from "@demlik/tea/otel";
import * as OtelTracer from "@effect/opentelemetry/OtelTracer";
import {type Context, ROOT_CONTEXT, type Tracer, trace} from "@opentelemetry/api";
import {Clock, Effect, Option} from "effect";
import {sdkRunner} from "../draft";
import {sdkEvents} from "./sdk-events";

// An agent's turns and tool calls in the trace of the Effect code that runs
// it: tea's `agentSpans` (by its author, in `@demlik/tea/otel`), parented to
// the Effect span current where the agent starts.
//
// `agentSpans` writes with a raw OpenTelemetry tracer, and hangs each agent
// run's span off a parent it makes itself: a span that is never exported, in
// a trace named by the run id. It takes a tracer and a way to name the trace,
// but no parent. So the tracer handed to it here is the one Effect's bridge
// writes with, wrapped: a span started under a parent from another process
// (OpenTelemetry's `isRemote`, which only that made-up parent is) starts under
// the Effect span instead. Every other span it starts (a turn, a tool call)
// already has the agent run's span as its parent, and is left alone.
//
// What `agentSpans` would export of the agent's words (the prompt, each turn,
// each tool's input and result) is replaced before export: spans carry names
// and ids, not what an agent read or wrote.

/** What every value `agentSpans` would export becomes. */
export const KEPT_OUT = "[not exported]";

/** A tracer that starts any span `agentSpans` parents to its made-up remote parent under `parent` instead. */
export const underParent = (tracer: Tracer, parent: Context): Tracer => {
	const at = (context: Context | undefined) =>
		context !== undefined && trace.getSpanContext(context)?.isRemote === true ? parent : context;
	return {
		startSpan: (name, options, context) => tracer.startSpan(name, options, at(context)),
		// `agentSpans` never makes a span current; this keeps the interface whole all the same.
		startActiveSpan: tracer.startActiveSpan.bind(tracer),
	};
};

/**
 * The span writer for one agent, under the Effect span current here. `null`
 * when nothing traces: no OpenTelemetry tracer was provided (tracing is off),
 * or there is no span to hang it under.
 */
export const agentTrace = <R>(name: string): Effect.Effect<AgentSpans<R> | null> =>
	Effect.gen(function* () {
		const tracer = yield* Effect.serviceOption(OtelTracer.OtelTracer);
		const current = yield* Effect.option(OtelTracer.currentOtelSpan);
		if (Option.isNone(tracer) || Option.isNone(current)) return null;
		const parent = trace.setSpan(ROOT_CONTEXT, current.value);
		const traceId = current.value.spanContext().traceId;
		return agentSpans<R>({
			tracer: underParent(tracer.value, parent),
			name,
			mask: () => KEPT_OUT,
			// The agent run's own made-up parent names the same trace, though nothing hangs off it.
			traceIdOf: () => traceId,
		});
	});

/**
 * What an SDK run is traced through. `runner` is the runner (`sdkRunner`,
 * src/draft.ts) to start the run with, so the options tracing needs and the
 * messages it reads come in one piece: a run cannot be traced without them.
 */
export interface SdkTrace {
	readonly runner: typeof sdkRunner;
	/** Ends any span still open: the run was stopped, or broke, before its result. */
	readonly end: () => void;
}

/** Nothing traces: the plain runner, and nothing to end. */
const untraced: SdkTrace = {runner: sdkRunner, end: () => undefined};

/**
 * An agent run on the Claude Agent SDK, drawn as tea's agent spans
 * (./sdk-events.ts) under the Effect span current here.
 *
 * Traced, the run asks the SDK for its partial messages too: a turn's
 * `message_delta` is the one place its real output tokens are said. They are
 * read here and nowhere else: the run's own `seen` is never shown one, so it
 * sees what an untraced run sees. When nothing traces, nothing is built, and
 * the run is started as it would be without this.
 */
export const sdkTrace = (name: string, runId: string): Effect.Effect<SdkTrace> =>
	Effect.gen(function* () {
		const spans = yield* agentTrace<null>(name);
		if (spans === null) return untraced;
		const clock = yield* Clock.Clock;
		const fold = sdkEvents(runId);
		const draw = (events: readonly AgentEvent<null>[]) => {
			for (const event of events) spans.onEvent(event);
		};
		return {
			runner: (draft, options, more = {}) =>
				sdkRunner(draft, (run) => ({...options(run), includePartialMessages: true}), {
					...more,
					seen: (run, message) => {
						if (message.type !== "stream_event") more.seen?.(run, message);
						draw(fold.seen(message, clock.currentTimeMillisUnsafe()));
					},
				}),
			end: () => {
				draw(fold.end(clock.currentTimeMillisUnsafe()));
				spans.end();
			},
		};
	});
