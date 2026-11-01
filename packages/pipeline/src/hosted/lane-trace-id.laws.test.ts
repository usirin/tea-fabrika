import {runTraceId} from "@demlik/tea/otel";
import {memoryTracing} from "@kampus/fabrika-old/otel";
import type {ReadableSpan} from "@opentelemetry/sdk-trace-base";
import {Arbitrary, Effect} from "effect";
import {describe, expect, it} from "vitest";
import {endingsOf, LANE, LIMIT_MS, runCase, type Seen} from "./lane-ends.ts";

// A lane is one job, so one trace: the law, on the real host and the in-memory ledger
// (./lane-ends.ts's world). The lane leads its job; each stage it starts is its child on the
// ledger, so the host starts that stage in the lane's trace (../../../fabrika/src/host/leader.ts).
//
//   the law   every span the case makes, the lane's and each stage's, is in the lane's trace,
//             `runTraceId(LANE)`, and each stage the lane started has its run span there
//
// On any endings, rows or none: a stage that crashes is in the trace as much as one that ends.

const program = (span: ReadableSpan) => span.attributes["tea.program.name"];

/** One case, its spans kept raw, as they were made. */
const traced = (endings: Seen["children"][number]["ending"][]) =>
	Effect.gen(function* () {
		const {spans, layer} = memoryTracing({raw: true});
		const seen = yield* runCase({endings, variant: "fixed", limitMs: LIMIT_MS}).pipe(
			Effect.provide(layer),
		);
		return {seen, spans};
	});

const oneTrace = ({seen, spans}: {seen: Seen; spans: readonly ReadableSpan[]}) => {
	const trace = runTraceId(LANE);
	const stageRuns = spans.filter((s) => s.name === "run" && program(s) === "stand-in-child");
	return (
		seen.ended &&
		spans.length > 0 &&
		spans.every((s) => s.spanContext().traceId === trace) &&
		stageRuns.length >= seen.children.length
	);
};

describe("a lane and its stages share one trace", () => {
	it("on any endings: every span is in the lane's trace, each stage's run among them", async () => {
		const r = await Effect.runPromise(
			Arbitrary.checkEffect(
				endingsOf(),
				(endings) => traced([...endings]).pipe(Effect.map(oneTrace)),
				{runs: 20, seed: 72},
			),
		);
		expect(Arbitrary.formatCheckFailure(r)).toBeUndefined();
	});

	it("one case, by hand: two stages end done, the third stuck, all under the lane's trace id", async () => {
		const {seen, spans} = await Effect.runPromise(traced(["row_done", "row_done"]));
		const runs = spans.filter((s) => s.name === "run");
		expect(seen.children).toHaveLength(3);
		expect(runs.filter((s) => program(s) === "stand-in-child").length).toBeGreaterThanOrEqual(3);
		expect(new Set(spans.map((s) => s.spanContext().traceId))).toEqual(new Set([runTraceId(LANE)]));
	});
});
