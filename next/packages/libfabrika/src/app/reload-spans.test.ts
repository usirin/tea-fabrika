// P15a, next/. Read P37's real records, never a test tracer that replaces the sink.
import {Effect, Stream} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {RecordManager} from "../data/records.ts";
import {SpanSink} from "../data/sink.ts";
import {Chain} from "../data/trace.ts";
import {body, checks, failure, request, variant, world} from "./reload.test-support.ts";

const records = (w: Awaited<ReturnType<typeof world>>) =>
	w.run(
		RecordManager.use((r) =>
			Effect.gen(function* () {
				const job = yield* Stream.runCollect(r.read(Chain.cases.job.make({process: w.process})));
				const brain = yield* Stream.runCollect(r.read(Chain.cases.spans.make({})));
				return [...job, ...brain];
			}),
		),
	);

describe("P15a facts and ended spans", () => {
	it("successful and failed install/load/swap/rollback operations reach P37 before returning", async () => {
		// Plant: flush inside withSpan, fail without ending a span, or keep only happy-path spans.
		await fc.assert(
			fc.asyncProperty(
				variant,
				fc.constantFrom("loaded", "load_failed", "rollback"),
				async (spec, outcome) => {
					const w = await world([
						{...spec, crash: false},
						{...spec, factor: spec.factor + 1, crash: outcome === "rollback"},
					]);
					try {
						await w.install(0);
						const req = await w.install(1);
						await w.run(w.runner().open("headless"));
						if (outcome === "load_failed") {
							w.fault.load = 1;
							await failure(w.use(w.runner().reload(req)));
						} else {
							await w.run(w.runner().reload(req));
							if (outcome === "rollback")
								await w.run(w.runner().msg(w.input(1, {type: "crash", n: 1})));
						}
						const rows = await records(w);
						const wanted =
							outcome === "rollback"
								? ["code.install", "code.load", "code.swap", "code.rollback"]
								: ["code.install", "code.load", "code.swap"];
						for (const name of wanted) {
							const found = rows.filter(
								(s) => s.name === name && Object.values(s.attributes).includes(req.code.hash),
							);
							expect(found.length).toBeGreaterThan(0);
							for (const span of found) {
								expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(
									BigInt(span.startTimeUnixNano),
								);
								if (name !== "code.install")
									expect(span.attributes).toMatchObject({"fab.process": w.process});
								expect(Object.values(span.attributes)).toContain(req.code.hash);
								if (name === "code.swap") {
									expect(Object.values(span.attributes)).toContain(req.id);
									expect(
										Object.entries(span.attributes).some(
											([key, value]) =>
												/queue.*ms$/.test(key) && typeof value === "number" && value >= 0,
										),
									).toBe(true);
								}
							}
						}
						if (outcome === "load_failed")
							expect(rows.some((s) => s.name === "code.load" && !s.ok)).toBe(true);
					} finally {
						await w.close();
					}
				},
			),
			checks,
		);
	});
	it("diagnostics stay in deletable content; permanent facts and span tags keep fixed classes", async () => {
		// Plant: tag the source/stack/error message, or make a permanent code.failed.why free text.
		await fc.assert(
			fc.asyncProperty(
				fc.string({minLength: 1, maxLength: 200}),
				fc.nat({max: 1000}),
				async (text, line) => {
					const w = await world([{factor: 1, start: 0, v: 1, crash: false, program: "counter"}]);
					try {
						await w.install(0);
						await w.run(w.runner().open("headless"));
						const diagnostic = `PRIVATE_SOURCE_${text}_PRIVATE_STACK`;
						const req = await request(w.bundles[0]!, 99);
						await w.run(
							w.installer().failed(req.id, "counter", {
								why: diagnostic,
								path: "next/programs/counter/src/machine.ts",
								line,
							}),
						);
						const facts = (await w.rows("code")).filter((r) => r._tag === "code.failed");
						expect(facts).toHaveLength(1);
						expect(body(facts[0]!)).toMatchObject({
							path: "next/programs/counter/src/machine.ts",
							line,
						});
						expect(JSON.stringify(facts)).not.toContain("PRIVATE_SOURCE_");
						const rows = await records(w);
						expect(rows.length).toBeGreaterThan(0);
						for (const span of rows) {
							expect(JSON.stringify(span.attributes)).not.toContain("PRIVATE_SOURCE_");
							expect(JSON.stringify(span.events)).not.toContain("PRIVATE_SOURCE_");
						}
						const contents = await w.run(
							RecordManager.use((r) =>
								Effect.forEach(
									rows,
									(s) =>
										Effect.forEach(
											[Chain.cases.job.make({process: w.process}), Chain.cases.spans.make({})],
											(chain) => r.content(chain, s.spanId),
											{concurrency: 1},
										),
									{concurrency: 1},
								),
							),
						);
						expect(JSON.stringify(contents)).toContain(diagnostic);
					} finally {
						await w.close();
					}
				},
			),
			checks,
		);
	});
	it("sink failure and lost flush acknowledgements retry ended spans without duplicates", async () => {
		await fc.assert(
			fc.asyncProperty(variant, async (spec) => {
				const w = await world([
					{...spec, crash: false},
					{...spec, factor: spec.factor + 1, crash: false},
				]);
				try {
					await w.install(0);
					const req = await w.install(1);
					await w.run(w.runner().open("headless"));
					w.fault.flush = true;
					await failure(w.use(w.runner().reload(req)));
					w.fault.flush = false;
					await w.run(SpanSink.use((s) => s.flush));
					const first = await records(w);
					await w.run(SpanSink.use((s) => s.flush));
					const twice = await records(w);
					expect(twice).toEqual(first);
					expect(new Set(twice.map((r) => r.spanId)).size).toBe(twice.length);
					expect(twice.some((r) => r.name === "code.swap")).toBe(true);
				} finally {
					await w.close();
				}
			}),
			checks,
		);
	});
});
