import {Exit, Schema} from "effect";
import {type Span, SpanId, TraceId} from "./traces.ts";

// OTLP over HTTP, its JSON form: what an OpenTelemetry exporter posts to `/v1/traces`
// (opentelemetry.io/docs/specs/otlp/#otlphttp), read into the rows a job's record keeps, by
// trace. Only what the record keeps is read: ids, names, times, status, tags and events. Links,
// dropped counts and the scope are let go.
//
//   spansOf({resourceSpans: [{resource: {attributes: [{key: "service.name", value: {stringValue: "tsh"}}]},
//            scopeSpans: [{spans: [{traceId: "9c41…", spanId: "…", name: "run", startTimeUnixNano: "1730…", ...}]}]}]})
//   // {ok: true, traces: Map {"9c41…" => [{span: "…", parent: null, name: "run", service: "tsh", start: 1730…, ...}]}}
//
// In JSON, OTLP writes ids as hex and 64-bit numbers as strings (or numbers, from some
// exporters); both are read. The protobuf form is not read yet: a POST of it is refused with 415.

/** OTLP's AnyValue: one of these keys is set. */
const AnyValue = Schema.Struct({
	stringValue: Schema.optional(Schema.String),
	boolValue: Schema.optional(Schema.Boolean),
	intValue: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
	doubleValue: Schema.optional(Schema.Number),
	arrayValue: Schema.optional(Schema.Unknown),
	kvlistValue: Schema.optional(Schema.Unknown),
	bytesValue: Schema.optional(Schema.String),
});
const KeyValue = Schema.Struct({key: Schema.String, value: Schema.optional(AnyValue)});
const Attributes = Schema.optional(Schema.Array(KeyValue));
const Nanos = Schema.Union([Schema.String.check(Schema.isPattern(/^[0-9]{1,20}$/)), Schema.Finite]);

const OtlpSpan = Schema.Struct({
	traceId: Schema.String,
	spanId: Schema.String,
	parentSpanId: Schema.optional(Schema.String),
	name: Schema.String,
	startTimeUnixNano: Nanos,
	endTimeUnixNano: Nanos,
	attributes: Attributes,
	events: Schema.optional(
		Schema.Array(Schema.Struct({timeUnixNano: Nanos, name: Schema.String, attributes: Attributes})),
	),
	status: Schema.optional(Schema.Struct({code: Schema.optional(Schema.Int)})),
});

export const TracesRequest = Schema.Struct({
	resourceSpans: Schema.optional(
		Schema.Array(
			Schema.Struct({
				resource: Schema.optional(Schema.Struct({attributes: Attributes})),
				scopeSpans: Schema.optional(
					Schema.Array(Schema.Struct({spans: Schema.optional(Schema.Array(OtlpSpan))})),
				),
			}),
		),
	),
});

/** The most spans one request may hold, and the most text a tag's value may: the record is forever. */
export const MAX_SPANS = 5000;
export const MAX_TAG = 1024;

type Tag = string | number | boolean;

const tagOf = (v: typeof AnyValue.Type | undefined): Tag | undefined => {
	if (v === undefined) return undefined;
	const t: Tag | undefined =
		v.stringValue ??
		v.boolValue ??
		(v.intValue === undefined ? undefined : Number(v.intValue)) ??
		v.doubleValue ??
		(v.arrayValue === undefined ? undefined : JSON.stringify(v.arrayValue));
	return typeof t === "string" && t.length > MAX_TAG ? `${t.slice(0, MAX_TAG)}…` : t;
};

const tagsOf = (kvs: readonly (typeof KeyValue.Type)[] | undefined): Record<string, Tag> => {
	const out: Record<string, Tag> = {};
	for (const kv of kvs ?? []) {
		const t = tagOf(kv.value);
		if (t !== undefined) out[kv.key] = t;
	}
	return out;
};

/** Unix ms from OTLP's nanoseconds, to the microsecond: a string keeps every digit until here. */
const msOf = (nanos: string | number): number =>
	typeof nanos === "number" ? nanos / 1e6 : Number(BigInt(nanos) / 1000n) / 1000;

const isTrace = Schema.is(TraceId);
const isSpan = Schema.is(SpanId);
const decode = Schema.decodeUnknownExit(TracesRequest);

/** A span as the record keeps it, before the door stamps who sent it. */
export type SpanRow = Omit<Span, "by">;

/** The spans of one OTLP request, by trace id, or why it is refused. */
export const spansOf = (
	body: unknown,
):
	| {readonly ok: true; readonly traces: ReadonlyMap<string, readonly SpanRow[]>}
	| {readonly ok: false; readonly why: string} => {
	const exit = decode(body);
	if (Exit.isFailure(exit)) return {ok: false, why: "not an OTLP traces request"};
	const traces = new Map<string, SpanRow[]>();
	let count = 0;
	for (const rs of exit.value.resourceSpans ?? []) {
		const resource = tagsOf(rs.resource?.attributes);
		for (const ss of rs.scopeSpans ?? [])
			for (const s of ss.spans ?? []) {
				count += 1;
				if (count > MAX_SPANS) return {ok: false, why: `more than ${MAX_SPANS} spans`};
				const trace = s.traceId.toLowerCase();
				const span = s.spanId.toLowerCase();
				const parent = (s.parentSpanId ?? "").toLowerCase();
				if (!isTrace(trace) || !isSpan(span) || (parent !== "" && !isSpan(parent)))
					return {ok: false, why: "a span's ids are not hex of OpenTelemetry's lengths"};
				const tags = tagsOf(s.attributes);
				const service = tags["service.name"] ?? resource["service.name"];
				const code = s.status?.code ?? 0;
				const row: SpanRow = {
					span,
					parent: parent === "" ? null : parent,
					name: s.name,
					service: typeof service === "string" ? service : "unknown",
					start: msOf(s.startTimeUnixNano),
					end: msOf(s.endTimeUnixNano),
					status: code === 2 ? "error" : code === 1 ? "ok" : "unset",
					tags,
					events: (s.events ?? []).map((e) => ({
						name: e.name,
						at: msOf(e.timeUnixNano),
						tags: tagsOf(e.attributes),
					})),
				};
				const list = traces.get(trace);
				if (list === undefined) traces.set(trace, [row]);
				else list.push(row);
			}
	}
	return {ok: true, traces};
};
