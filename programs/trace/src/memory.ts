import {type JobTrace, Traces, TraceUnread} from "@kampus/fabrika-old";
import {Effect, Layer, Stream} from "effect";

// `Traces` over records held in memory: what the tests and the shots read. A trace nobody wrote
// reads as an empty record, as the real one does; an id that is not a trace id is refused, as
// the real one refuses it. A record here never changes, so following one reads it once.
//
//   Effect.provide(Traces.read(TALLY_ID), memoryTraces([TALLY]))   // TALLY
//   Effect.provide(Traces.read("0".repeat(32)), memoryTraces([]))  // {trace: "000…", job: null, runs: [], spans: [], steps: [], opened: []}

const ID = /^[0-9a-f]{32}$/;

export const memoryTraces = (records: readonly JobTrace[]) => {
	const read = (trace: string) =>
		ID.test(trace)
			? Effect.succeed(
					records.find((r) => r.trace === trace) ?? {
						trace,
						job: null,
						runs: [],
						spans: [],
						steps: [],
						opened: [],
					},
				)
			: Effect.fail(new TraceUnread({trace, message: "not a trace id: 32 hex characters"}));
	return Layer.succeed(Traces, Traces.of({read, watch: (trace) => Stream.fromEffect(read(trace))}));
};
