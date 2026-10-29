import type {ReadableSpan} from "@opentelemetry/sdk-trace-base";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {HostJobs, openJobs} from "../host/host-jobs.ts";
import {ear} from "../program/ear.ts";
import {start, tell} from "../program/program.ts";
import {memoryStorage} from "../program/storage.ts";
import {ATTR} from "../program/trace.ts";
import {runTraceId} from "../program/trace-id.ts";
import {Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import {SMALL} from "./small.ts";
import {memoryTracing} from "./trace/otel.ts";

// A tsh line is one job, so one trace: the law, over any lines of `seq | double | ...`, told one
// after another to one tsh.
//
//   the law   each line's span roots a trace of its own, named by its first program's run id
//             (`traceIdOf` in ../host/jobs.ts), and every stage's run span is in it, under the
//             line; no span is anywhere but in a line's trace or in tsh's own
//
// A few runs: each starts a tsh. ../../../pipeline/src/tsh/trace.test.ts reads one line's tree.

const SMALL_LIST = programList(SMALL);
const TSH = "tsh:line-trace";

/** One line: `seq --to k`, then `double` as many times as `doubles`. */
const Line = fc.record({k: fc.integer({min: 1, max: 4}), doubles: fc.integer({min: 0, max: 3})});
type Line = {readonly k: number; readonly doubles: number};
const textOf = (l: Line) => [`seq --to ${l.k}`, ...Array(l.doubles).fill("double")].join(" | ");

const traceOf = (span: ReadableSpan) => span.spanContext().traceId;

/** Tell one tsh each line, and answer every span the session made, raw. */
const session = (lines: readonly Line[]) =>
	Effect.gen(function* () {
		const {spans, layer} = memoryTracing({raw: true});
		const statuses = yield* Effect.gen(function* () {
			const printed = ear<Printed>();
			const ready = ear<Ready>();
			const storage = memoryStorage();
			const jobs = yield* openJobs(storage);
			const started = yield* start(
				tsh,
				{show: "short"},
				{printed: printed.hear, ready: ready.hear},
				{id: TSH, storage},
			).pipe(Effect.provideService(Programs, SMALL_LIST), Effect.provideService(HostJobs, jobs));
			if (started.kind !== "running") return yield* Effect.die("tsh did not start");
			for (const l of lines) yield* tell(started.run, "line", textOf(l));
			const all = yield* ready.upTo(lines.length);
			started.close("line");
			yield* started.run.ended;
			return all.map((r) => r.status);
		}).pipe(Effect.scoped, Effect.provide(layer));
		return {statuses, spans};
	});

const oneTracePerLine = (lines: readonly Line[], spans: readonly ReadableSpan[]) => {
	const roots = spans.filter((s) => s.attributes[ATTR.line] !== undefined);
	const lineTraces = new Set<string>();
	for (const root of roots) {
		const trace = traceOf(root);
		const runs = spans.filter(
			(s) => s.name === "run" && s.parentSpanContext?.spanId === root.spanContext().spanId,
		);
		const first = runs.find((s) => s.attributes[ATTR.program] === "seq");
		const stages = String(root.attributes[ATTR.line]).split(" | ").length;
		if (first === undefined || runs.length !== stages) return false;
		if (trace !== runTraceId(String(first.attributes[ATTR.run]))) return false;
		if (runs.some((s) => traceOf(s) !== trace)) return false;
		lineTraces.add(trace);
	}
	const known = new Set([...lineTraces, runTraceId(TSH)]);
	return (
		roots.length === lines.length &&
		lineTraces.size === lines.length &&
		spans.every((s) => known.has(traceOf(s)))
	);
};

describe("a tsh line and its stages share one trace", () => {
	it("on any lines: each its own trace, named by its first run, every stage in it", async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(Line, {minLength: 1, maxLength: 3}), async (lines) => {
				const {statuses, spans} = await Effect.runPromise(session(lines));
				expect(statuses).toEqual(lines.map(() => 0));
				expect(oneTracePerLine(lines, spans)).toBe(true);
			}),
			{numRuns: 8, seed: 72},
		);
	});
});
