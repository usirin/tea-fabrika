import * as OtelTracer from "@effect/opentelemetry/OtelTracer";
import * as Resource from "@effect/opentelemetry/Resource";
import {OTLPTraceExporter} from "@opentelemetry/exporter-trace-otlp-http";
import {
	BasicTracerProvider,
	BatchSpanProcessor,
	type ReadableSpan,
	SimpleSpanProcessor,
	type SpanExporter,
	type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {Duration, Effect, Layer} from "effect";
import {DEFAULT_SERVICE, type Viewing, view} from "./view.ts";

// Where a host's spans go: Effect's OpenTelemetry bridge
// (`@effect/opentelemetry`), over one OpenTelemetry tracer provider. Every
// span Effect makes (a line, a run, a machine, a Cmd) is an OpenTelemetry span
// of that provider, and the raw OpenTelemetry tracer tea's `agentSpans` writes
// with (./agent.ts) is the same provider's, so both land in one trace and go
// out through one exporter.
//
//   tracing("http://localhost:4318")   OTLP over HTTP, batched: Jaeger, or any collector
//   memoryTracing()                    kept in memory, for a test to read back
//
// Each span goes out through the view (./view.ts): listed under its program's
// or stage's service, red when its outcome went wrong, with an agent's turns
// folded into one span.
//
// Tracing is off unless a host asks for it: with no Layer from here, no
// provider and no exporter are built, and tsh turns Effect's own tracer off
// (`Effect.withTracerEnabled(false)`), so a span is a no-op.

/** The service name a span that names none is exported under: what a viewer lists it by. */
export const SERVICE = DEFAULT_SERVICE;

/** OTLP's default port for HTTP, on this machine: where `pnpm trace:up` puts Jaeger. */
export const DEFAULT_ENDPOINT = "http://localhost:4318";

/** How long a process waits at its end for its last spans to go out. */
const FLUSH = Duration.seconds(2);

/**
 * The provider, built from span processors and shut down with the Layer:
 * what it holds is flushed first, so a short-lived process still exports
 * every span it ended. `@effect/opentelemetry`'s own provider Layer is built
 * on the Node SDK; this one needs only the base SDK.
 */
const provider = (processor: SpanProcessor) =>
	Layer.effect(
		OtelTracer.OtelTracerProvider,
		Effect.gen(function* () {
			const resource = yield* Resource.Resource;
			return yield* Effect.acquireRelease(
				Effect.sync(() => new BasicTracerProvider({resource, spanProcessors: [processor]})),
				// A collector that is not there loses the spans, never the run: the failure is
				// dropped. The exporter gives up after FLUSH (its own default, 10s, held the exit).
				(made) =>
					Effect.tryPromise({
						try: () => made.forceFlush().finally(() => made.shutdown()),
						catch: () => ({_tag: "export_failed" as const}),
					}).pipe(Effect.timeout(FLUSH), Effect.ignore),
			);
		}),
	);

/** Effect's tracer and the raw OpenTelemetry tracer, both on one provider fed by `processor` through the view. */
const over = (processor: SpanProcessor, viewing: Viewing | "raw") =>
	OtelTracer.layer.pipe(
		Layer.provide(provider(viewing === "raw" ? processor : view(processor, viewing))),
		Layer.provide(Resource.layer({serviceName: SERVICE})),
	);

/** Spans exported over OTLP/HTTP to `endpoint` (a collector's base url), in batches, through the view. */
export const tracing = (endpoint: string, viewing: Viewing = {}) =>
	over(
		new BatchSpanProcessor(
			new OTLPTraceExporter({
				url: `${endpoint}/v1/traces`,
				timeoutMillis: Duration.toMillis(FLUSH),
			}),
		),
		viewing,
	);

/**
 * Spans kept in memory, for a test: `spans` holds every span that ended, in
 * the order each ended, and still holds them after the Layer is let go (the
 * SDK's own in-memory exporter empties itself at shutdown). They are what a
 * viewer is sent, by `viewing`; `raw`: as they were made, before the view.
 */
export const memoryTracing = ({
	raw = false,
	viewing = {},
}: {
	readonly raw?: boolean;
	readonly viewing?: Viewing;
} = {}) => {
	const spans: ReadableSpan[] = [];
	const keeping: SpanExporter = {
		export: (batch, done) => {
			spans.push(...batch);
			// OpenTelemetry's `ExportResultCode.SUCCESS`.
			done({code: 0});
		},
		shutdown: () => Promise.resolve(),
	};
	return {spans, layer: over(new SimpleSpanProcessor(keeping), raw ? "raw" : viewing)};
};

/**
 * Where to export, from the environment. `TSH_TRACE` unset or empty: off.
 * `1`: the default endpoint. A url: that collector.
 */
export const endpointOf = (env: Readonly<Record<string, string | undefined>>): string | null => {
	const set = env.TSH_TRACE;
	if (set === undefined || set === "" || set === "0") return null;
	return set.startsWith("http://") || set.startsWith("https://") ? set : DEFAULT_ENDPOINT;
};
