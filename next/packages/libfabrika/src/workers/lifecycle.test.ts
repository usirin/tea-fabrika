// P24, next/. Activation is a new instance, never a new program process.
import {DatabaseSync} from "node:sqlite";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Layer, Redacted, Schema, Stream} from "effect";
import {Recording} from "../app/entry.ts";
import {Archive} from "../data/archive.ts";
import {RecordManager} from "../data/records.ts";
import {SpanSink} from "../data/sink.ts";
import {nodeSql} from "../data/sqlite.ts";
import {Chain, ProcessId, SinkError, SpanRow} from "../data/trace.ts";

const runs = {arbitrary: {seed: 119120, runs: 100, size: 100}};
const Wake = Schema.Struct({
	object: Schema.NonEmptyString,
	process: Schema.NullOr(ProcessId),
	build: Schema.NonEmptyString,
});
const wakeRows = (
	rows: readonly (typeof SpanRow.Type)[],
	object: string,
	process: string | null,
	build: string,
) => {
	const wakes = rows.filter((r) => r.name === "object.wake");
	expect(wakes).toHaveLength(2);
	const instances: unknown[] = [];
	for (const wake of wakes) {
		expect(wake.ok).toBe(true);
		expect(wake.resource.attributes["fab.object"]).toBe(object);
		expect(Object.values(wake.attributes)).toContain(build);
		const instance = Object.values(wake.attributes).find(
			(v) => typeof v === "string" && /^instance_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(v),
		);
		expect(instance).toBeDefined();
		instances.push(instance);
		if (process !== null) expect(Object.values(wake.attributes)).toContain(process);
	}
	expect(new Set(instances).size).toBe(2);
	expect(rows.some((r) => /exited|restarted|DOWN/.test(r.name))).toBe(false);
};

describe("P24 activation records", () => {
	it.effect.prop(
		"each wake records a fresh instance and preserves the restored process",
		{input: Wake},
		({input}) =>
			Effect.gen(function* () {
				const {recordWake, InstanceId} = yield* Effect.promise(() => import("./lifecycle.ts"));
				const {IdGenerator} = yield* Effect.promise(() => import("../data/id.ts"));
				const db = new DatabaseSync(":memory:");
				try {
					const env = Layer.mergeAll(
						SpanSink.layer(nodeSql(db), {object: input.object}),
						RecordManager.memory(64 * 1024),
						Archive.memory,
						IdGenerator.layer,
					);
					yield* Effect.gen(function* () {
						const a = yield* recordWake(input),
							b = yield* recordWake(input);
						expect(Schema.is(InstanceId)(a)).toBe(true);
						expect(Schema.is(InstanceId)(b)).toBe(true);
						expect(a).not.toBe(b);
						const chain =
							input.process === null
								? Chain.cases.spans.make({})
								: Chain.cases.job.make({process: input.process});
						const rows = yield* RecordManager.use((records) =>
							Stream.runCollect(records.read(chain)),
						);
						wakeRows(rows, input.object, input.process, input.build);
					}).pipe(Effect.provide(Recording.layer), Effect.provide(env));
				} finally {
					db.close();
				}
			}),
		runs,
	);
	it.effect.prop(
		"recording failure is a typed failure, never a successful wake",
		{input: Wake},
		({input}) =>
			Effect.gen(function* () {
				const {recordWake} = yield* Effect.promise(() => import("./lifecycle.ts"));
				const {IdGenerator} = yield* Effect.promise(() => import("../data/id.ts"));
				const exit = yield* Effect.exit(
					recordWake(input).pipe(
						Effect.provideService(Recording, {
							flush: Effect.fail(new SinkError({why: "storage", held: 1})),
						}),
						Effect.provide(IdGenerator.layer),
					),
				);
				expect(Exit.isFailure(exit)).toBe(true);
			}),
		runs,
	);
	it.effect.prop(
		"RED spans end before flush and secret wrappers never reach saved output",
		{secret: Schema.NonEmptyString, failed: Schema.Boolean},
		({secret, failed}) =>
			Effect.gen(function* () {
				const marker = `p24-secret-${secret}`;
				const db = new DatabaseSync(":memory:");
				try {
					const input = {object: "project", process: null, build: "public-build"};
					const {recordWake} = yield* Effect.promise(() => import("./lifecycle.ts"));
					const {IdGenerator} = yield* Effect.promise(() => import("../data/id.ts"));
					yield* Effect.gen(function* () {
						yield* recordWake(input);
						yield* (failed ? Effect.fail(new Error("failed operation")) : Effect.void).pipe(
							Effect.withSpan("p24.operation", {attributes: {secret: Redacted.make(marker)}}),
							Effect.exit,
						);
						yield* Recording.use((recording) => recording.flush);
						const rows = yield* RecordManager.use((records) =>
							Stream.runCollect(records.read(Chain.cases.spans.make({}))),
						);
						const operation = rows.find((r) => r.name === "p24.operation");
						expect(operation?.ok).toBe(!failed);
						expect(operation?.endTimeUnixNano).toBeDefined();
						expect(JSON.stringify(rows)).not.toContain(marker);
					}).pipe(
						Effect.provide(Recording.layer),
						Effect.provide(
							Layer.mergeAll(
								SpanSink.layer(nodeSql(db), {object: "project"}),
								RecordManager.memory(64 * 1024),
								Archive.memory,
								IdGenerator.layer,
							),
						),
					);
				} finally {
					db.close();
				}
			}),
		runs,
	);
	it.prop(
		"plants: missing instance, process restart and success-only recording are caught",
		{row: SpanRow},
		({row}) => {
			for (const name of ["exited", "restarted", "DOWN"])
				expect(() =>
					wakeRows(
						[
							{...row, name},
							{...row, name: "object.wake"},
						],
						"project",
						null,
						"build",
					),
				).toThrow();
			expect(() => wakeRows([], "project", null, "build")).toThrow();
		},
		runs,
	);
});
