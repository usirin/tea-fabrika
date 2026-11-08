import {Schema} from "effect";
import {Line} from "../data/log.ts";
import {ProcessId} from "../data/trace.ts";
import {Start} from "./process.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Text = Schema.NonEmptyString;

export const Policy = Schema.Struct({
	maxDeliveries: Count.check(Schema.isLessThanOrEqualTo(32)),
	intensity: Count,
	periodMs: Count,
	backoff: Schema.Struct({minMs: Count, maxMs: Count, resetAfterMs: Count}),
}).check(
	Schema.makeFilter((p) => {
		if (p.intensity < p.maxDeliveries || p.backoff.minMs > p.backoff.maxMs)
			return "invalid restart policy";
		// The first intensity waits must fit in one window, or the brake cannot trip.
		let total = 0;
		let wait = p.backoff.minMs;
		for (let n = 0; n < p.intensity; n++) {
			total += wait;
			if (total >= p.periodMs) return "restart waits exceed the window";
			wait = Math.min(wait * 2, p.backoff.maxMs);
		}
		return true;
	}),
);
export type Policy = typeof Policy.Type;

const AttemptFields = {process: ProcessId, letter: Text, build: Text, seq: Count};
export const Failure = Schema.TaggedUnion({
	fresh: {...AttemptFields, error: Text},
	saved: {...AttemptFields, error: Text},
	interrupted: AttemptFields,
});
export type Failure = typeof Failure.Type;

export const Recovery = Schema.TaggedUnion({
	live: {process: ProcessId},
	ending: {process: ProcessId, failure: Failure},
	down: {process: ProcessId, why: Text, crashes: Count, until: Millis},
	starting: {after: ProcessId, request: Start.cases.again},
});

const Action = Schema.Struct({
	type: Schema.Literals(["dead", "exit", "down", "start", "checkpoint"]),
	process: ProcessId,
	id: Schema.optionalKey(Text),
	from: Schema.optionalKey(Line.mapFields(({_tag, body: _body, ...fields}) => fields)),
	after: Schema.optionalKey(ProcessId),
	until: Schema.optionalKey(Millis),
});
const Attempt = Schema.Struct({
	...AttemptFields,
	phase: Schema.Literals(["fresh", "saved"]),
	at: Millis,
});
const Observation = Schema.Struct({
	seq: Count,
	process: ProcessId,
	letter: Text,
	phase: Schema.Literals(["fresh", "saved", "interrupted"]),
	error: Schema.optionalKey(Text),
	at: Millis,
});
const Receipt = Schema.Struct({
	letter: Text,
	input: Schema.Json,
	errors: Schema.Array(Text),
	tries: Millis,
	result: Schema.NullOr(Schema.TaggedStruct("refused", {why: Schema.Literal("dead")})),
	process: ProcessId,
});

export const Supervision = Schema.Struct({
	v: Schema.Literal(1),
	name: Text,
	policy: Policy,
	seq: Millis,
	recovery: Recovery,
	pending: Schema.NullOr(Action),
	attempt: Schema.NullOr(Attempt),
	build: Text,
	restarts: Schema.Array(Millis),
	observations: Schema.Array(Observation),
	receipts: Schema.Array(Receipt),
	crashes: Schema.optionalKey(Millis),
	healthyAt: Schema.optionalKey(Millis),
	restart: Schema.optionalKey(Schema.Struct({id: Text, build: Text})),
	requests: Schema.optionalKey(
		Schema.Array(Schema.Struct({id: Text, build: Text, process: ProcessId})),
	),
});
export type Supervision = typeof Supervision.Type;
