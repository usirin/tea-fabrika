import type {AgentEvent} from "@demlik/tea/agent";
import {type AgentSpans, agentSpans, maskBase64DataUris, type SpanMask} from "@demlik/tea/otel";
import * as OtelTracer from "@effect/opentelemetry/OtelTracer";
import {type Context, ROOT_CONTEXT, type Tracer, trace} from "@opentelemetry/api";
import {Clock, Effect, Option} from "effect";
import {ATTR} from "../../program/trace.ts";
import {sdkRunner} from "../claude/draft.ts";
import {sdkEvents} from "./sdk-events.ts";

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
// and ids, not what an agent read or wrote. A lane's runs are the exception
// (docs/direction/an-agent-run-keeps-its-content.md): they keep their content,
// with any text shaped like a key cut first, and a job's record keeps it apart
// from the spans, where a person can delete it.
//
//   agentTrace("build")                     every input and output: "[not exported]"
//   agentTrace("build", {content: "kept"})  each as it was, a key in it "[key cut]"

/** What every value `agentSpans` would export becomes. */
export const KEPT_OUT = "[not exported]";

/** What a key-shaped string in kept content becomes. */
const KEY_CUT = "[key cut]";

/**
 * Where a key starts: not inside a longer word, so the `sk-` in `task-list` stays whole. Right
 * after JSON's `\n`, `\r` or `\t` is a start too: the mask reads a value as JSON text, where a key
 * on its own line follows the `n` of `\n`.
 */
const START = String.raw`(?:(?<![A-Za-z0-9])|(?<=\\[nrt]))`;

/** A key shape: `body` from a {@link START}. */
const word = (body: string) => new RegExp(`${START}${body}`, "g");

/**
 * Text shaped like a key, as the makers write theirs: what a leak grep looks for. Each is the
 * maker's published prefix, where a word starts, and the run of characters after it. A word that
 * starts with a prefix and runs on long enough is still cut. Text fabrika gave an agent as a
 * `Redacted` is not here: the content a lane keeps holds none yet.
 */
const KEY_SHAPES: readonly RegExp[] = [
	// GitHub: classic tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`), and fine-grained ones.
	word(String.raw`gh[pousr]_[A-Za-z0-9]{30,}`),
	word(String.raw`github_pat_[A-Za-z0-9_]{30,}`),
	// Anthropic (`sk-ant-`), and OpenAI's `sk-`, `sk-proj-` and the rest.
	word(String.raw`sk-[A-Za-z0-9_-]{20,}`),
	// AWS access key ids.
	word(String.raw`(?:AKIA|ASIA)[0-9A-Z]{16}`),
	// Slack.
	word(String.raw`xox[abposr]-[A-Za-z0-9-]{10,}`),
	// Google API keys.
	word(String.raw`AIza[0-9A-Za-z_-]{35}`),
	// Stripe secret and restricted keys.
	word(String.raw`[rs]k_(?:live|test)_[0-9A-Za-z]{20,}`),
	// npm access tokens.
	word(String.raw`npm_[A-Za-z0-9]{36,}`),
	// A JWT: a header and a payload, each JSON as base64url (`{"` is `eyJ`), and a signature.
	word(String.raw`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`),
	// A private key, PEM or OpenSSH, whole, its line breaks as text or as JSON's `\n`.
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** `text` with every key-shaped string in it cut to {@link KEY_CUT}, and the rest as it was. Pure. */
export const cutKeys = (text: string): string =>
	KEY_SHAPES.reduce((out, shape) => out.replace(shape, KEY_CUT), text);

/** What a run's content is: kept out, as every run's is, or kept, as a lane's runs are. */
export type ContentIs = "kept_out" | "kept";

/** The mask a kept run's content goes through: keys cut, then tea's own default. */
const keptMask: SpanMask = ({data}) =>
	maskBase64DataUris({data: typeof data === "string" ? cutKeys(data) : data});

/**
 * A tracer that starts any span `agentSpans` parents to its made-up remote parent under `parent`
 * instead. `marks`: attributes every span it starts carries, as a kept run's `tea.agent.content`.
 */
export const underParent = (
	tracer: Tracer,
	parent: Context,
	marks: Readonly<Record<string, string>> = {},
): Tracer => {
	const at = (context: Context | undefined) =>
		context !== undefined && trace.getSpanContext(context)?.isRemote === true ? parent : context;
	return {
		startSpan: (name, options, context) =>
			tracer.startSpan(
				name,
				{...options, attributes: {...options?.attributes, ...marks}},
				at(context),
			),
		// `agentSpans` never makes a span current; this keeps the interface whole all the same.
		startActiveSpan: tracer.startActiveSpan.bind(tracer),
	};
};

/**
 * The span writer for one agent, under the Effect span current here. `null`
 * when nothing traces: no OpenTelemetry tracer was provided (tracing is off),
 * or there is no span to hang it under. `content`: kept out unless a caller
 * keeps it, as a lane does.
 */
export const agentTrace = <R>(
	name: string,
	{content = "kept_out"}: {readonly content?: ContentIs} = {},
): Effect.Effect<AgentSpans<R> | null> =>
	Effect.gen(function* () {
		const tracer = yield* Effect.serviceOption(OtelTracer.OtelTracer);
		const current = yield* Effect.option(OtelTracer.currentOtelSpan);

		if (Option.isNone(tracer) || Option.isNone(current)) {
			return null;
		}

		const parent = trace.setSpan(ROOT_CONTEXT, current.value);
		const traceId = current.value.spanContext().traceId;
		return agentSpans<R>({
			tracer: underParent(tracer.value, parent, content === "kept" ? {[ATTR.content]: "kept"} : {}),
			name,
			mask: content === "kept" ? keptMask : () => KEPT_OUT,
			// The agent run's own made-up parent names the same trace, though nothing hangs off it.
			traceIdOf: () => traceId,
		});
	});

/**
 * What an SDK run is traced through. `runner` is the runner (`sdkRunner`,
 * ../claude/draft.ts) to start the run with, so the options tracing needs and the
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

		if (spans === null) {
			return untraced;
		}

		const clock = yield* Clock.Clock;
		const fold = sdkEvents(runId);
		const draw = (events: readonly AgentEvent<null>[]) => {
			for (const event of events) {
				spans.onEvent(event);
			}
		};
		return {
			runner: (draft, options, more = {}) =>
				sdkRunner(draft, (run) => ({...options(run), includePartialMessages: true}), {
					...more,
					seen: (run, message) => {
						if (message.type !== "stream_event") {
							more.seen?.(run, message);
						}

						draw(fold.seen(message, clock.currentTimeMillisUnsafe()));
					},
				}),
			end: () => {
				draw(fold.end(clock.currentTimeMillisUnsafe()));
				spans.end();
			},
		};
	});
