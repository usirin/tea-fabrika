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
import {MAX_TAG, type SpanRow} from "../../host/otlp.ts";
import type {Records} from "../../host/records.ts";
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
//   recordTracing(records)             kept in the host's own job records, each as it ends
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

/**
 * Spans exported over OTLP/HTTP to `endpoint` (a collector's base url), in batches, through the view.
 * `headers`: sent with each batch, as OTLP exporters send them. A job's record takes spans at
 * `<ledger url>/<ledger>`, behind the door, so its exporter sends `authorization`.
 */
export const tracing = (
	endpoint: string,
	viewing: Viewing = {},
	headers: Readonly<Record<string, string>> = {},
) =>
	over(
		new BatchSpanProcessor(
			new OTLPTraceExporter({
				url: `${endpoint}/v1/traces`,
				headers: {...headers},
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

/** A tag as a record keeps it: text cut at `MAX_TAG`, a list as its JSON. */
const keptTag = (v: unknown): string | number | boolean | undefined => {
	const t =
		typeof v === "string" || typeof v === "number" || typeof v === "boolean"
			? v
			: Array.isArray(v)
				? JSON.stringify(v)
				: undefined;
	return typeof t === "string" && t.length > MAX_TAG ? `${t.slice(0, MAX_TAG)}…` : t;
};

/** Attributes as a record keeps its tags: each one `keptTag` keeps. */
const keptTags = (attributes: Readonly<Record<string, unknown>>) => {
	const out: Record<string, string | number | boolean> = {};
	for (const [k, v] of Object.entries(attributes)) {
		const t = keptTag(v);
		if (t !== undefined) out[k] = t;
	}
	return out;
};

/** Unix ms, to the microsecond, from OpenTelemetry's `[seconds, nanoseconds]`. */
const toMillis = ([s, ns]: readonly [number, number]) => s * 1000 + Math.round(ns / 1000) / 1000;

/** A span as a job's record keeps it, as `spansOf` reads the same span off OTLP. */
export const toSpanRow = (s: ReadableSpan): SpanRow => {
	const tags = keptTags(s.attributes);
	const service = tags["service.name"] ?? s.resource.attributes["service.name"];
	return {
		span: s.spanContext().spanId,
		parent: s.parentSpanContext?.spanId ?? null,
		name: s.name,
		service: typeof service === "string" ? service : "unknown",
		start: toMillis(s.startTime),
		end: toMillis(s.endTime),
		// OpenTelemetry's `SpanStatusCode`: 0 unset, 1 ok, 2 error.
		status: s.status.code === 2 ? "error" : s.status.code === 1 ? "ok" : "unset",
		tags,
		events: s.events.map((e) => ({
			name: e.name,
			at: toMillis(e.time),
			tags: keptTags(e.attributes ?? {}),
		})),
	};
};

/**
 * Spans kept in the host's own records (../../host/records.ts), each the moment it ends, through
 * the view: in the record of the trace it ran in. No collector and no network: what the trace
 * tile reads on a laptop. A span the record cannot keep is lost, never the run.
 */
export const recordTracing = (records: Pick<Records, "keep">, viewing: Viewing = {}) => {
	const keeping: SpanExporter = {
		export: (batch, done) => {
			const traces = new Map<string, SpanRow[]>();
			for (const s of batch) {
				const trace = s.spanContext().traceId;
				const list = traces.get(trace);
				if (list === undefined) traces.set(trace, [toSpanRow(s)]);
				else list.push(toSpanRow(s));
			}
			// One record after another: each is one SQLite file, written in this thread.
			const all = Effect.forEach([...traces], ([trace, rows]) => records.keep(trace, rows), {
				concurrency: 1,
				discard: true,
			});
			// OpenTelemetry's `ExportResultCode`: 0 SUCCESS, 1 FAILED.
			void Effect.runPromise(
				Effect.match(all, {onFailure: () => done({code: 1}), onSuccess: () => done({code: 0})}),
			);
		},
		shutdown: () => Promise.resolve(),
	};
	return over(new SimpleSpanProcessor(keeping), viewing);
};
