// P33 extends p97/p99 through P37's real SQLite sink and JobRecords.
// Raw process failure text may be content. It must never become tags or health data.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Redacted, Stream, Tracer} from "effect";
import {TestClock} from "effect/testing";
import {Archive} from "../data/archive.ts";
import {RecordManager} from "../data/records.ts";
import {SpanSink} from "../data/sink.ts";
import {Chain, type SpanRow} from "../data/trace.ts";
import {Mailbox} from "./mailbox.ts";
import {ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	W,
	again,
	brain,
	first,
	from,
	ids,
	manager,
	receive,
	storage,
	watcher as processCaller,
} from "./process.test-support.ts";

const capture = () => {
	const spans: Array<Tracer.NativeSpan> = [];
	const tracer = Tracer.make({
		span: (options) => {
			const span = new Tracer.NativeSpan(options);
			spans.push(span);
			return span;
		},
	});
	return {
		tracer,
		spans,
		ended: (name: string) =>
			spans.filter((span) => span.name === name && span.status._tag === "Ended"),
	};
};
const records = () => {
	const sink = storage();
	const parts = new Map<string, ReturnType<typeof storage>>();
	const open = (name: string) => {
		let part = parts.get(name);
		if (part === undefined) {
			part = storage();
			parts.set(name, part);
		}
		return part.sql;
	};
	return {
		sink,
		parts,
		layer: Layer.mergeAll(
			SpanSink.layer(sink.sql, {object: "project:test"}),
			RecordManager.sql(open, 1_000_000_000),
			Archive.memory,
		),
	};
};
const recorded = (process: string) =>
	RecordManager.use((records) => Stream.runCollect(records.read(Chain.cases.job.make({process}))));
const leakFree = (rows: ReadonlyArray<SpanRow>, marks: ReadonlyArray<string>) => {
	for (const row of rows) {
		const text = JSON.stringify({attributes: row.attributes, events: row.events, links: row.links});
		for (const mark of marks) expect(text, row.name).not.toContain(mark);
		for (const value of Object.values(row.attributes))
			if (typeof value === "string") expect(value.length, row.name).toBeLessThanOrEqual(128);
	}
};

describe("p97, process calls", () => {
	it.effect("plant, omit refusal spans: each call ends exactly one named process span", () => {
		const store = storage();
		const trace = capture();
		return Effect.gen(function* () {
			const processes = yield* ProcessManager;
			yield* processes.start(first(), from());
			yield* processes.start(
				first("watcher:start", "watcher:1", {program: "watcher", hash: "build-a"}),
				from(),
			);
			yield* Effect.flip(
				processes.start(
					first("start:counter:1", "counter:1", {program: "counter", hash: "changed"}),
					from(),
				),
			);
			yield* processes.info;
			yield* processes.monitor("one", A, from());
			yield* processes.exit(A, "crashed", from());
			yield* receive(W);
			yield* processes.demonitor("one", from());
			yield* processes.down(A, {why: "intensity", crashes: 3, until: 50_000}, from());
			expect(trace.ended("process.start")).toHaveLength(3);
			for (const name of [
				"process.info",
				"process.monitor",
				"process.exit",
				"process.receive",
				"process.demonitor",
				"process.down",
			])
				expect(trace.ended(name), name).toHaveLength(1);
			const refusal = trace.ended("process.start")[2]!;
			expect([...refusal.attributes].find(([key]) => key.endsWith(".why"))?.[1]).toBe("id_reused");
			expect(trace.ended("process.start")[0]!.attributes.get("fab.process")).toBe(A);
			expect(trace.ended("process.exit")[0]!.attributes.get("fab.process")).toBe(A);
		}).pipe(
			Effect.provide(manager(store, brain(), ids(A, W).next)),
			Effect.withTracer(trace.tracer),
		);
	});
	it.effect(
		"plant, replacement spans in the old record: P37 stores each life in its own JobRecord",
		() => {
			const store = storage();
			const world = records();
			return Effect.gen(function* () {
				yield* Effect.gen(function* () {
					const processes = yield* ProcessManager;
					yield* processes.start(first(), from());
					yield* processes.exit(A, "crashed", from());
					yield* processes.start(again(A), from());
				}).pipe(Effect.provide(manager(store, brain(), ids(A, B).next)));
				const sink = yield* SpanSink;
				expect((yield* sink.flush).sent).toBeGreaterThanOrEqual(3);
				const old = yield* recorded(A);
				const replacement = yield* recorded(B);
				expect(old.filter((row) => row.name === "process.start")).toHaveLength(1);
				expect(old.filter((row) => row.name === "process.exit")).toHaveLength(1);
				expect(replacement.filter((row) => row.name === "process.start")).toHaveLength(1);
				expect(
					old
						.filter((row) => row.name.startsWith("process."))
						.every((row) => row.attributes["fab.process"] === A),
				).toBe(true);
				expect(
					replacement
						.filter((row) => row.name.startsWith("process."))
						.every((row) => row.attributes["fab.process"] === B),
				).toBe(true);
				expect(world.parts.has(`job/${A}/0`)).toBe(true);
				expect(world.parts.has(`job/${B}/0`)).toBe(true);
			}).pipe(Effect.provide(world.layer));
		},
	);
	it.effect(
		"plant, client clock decides lag: DOWN delivery lag uses the referee's arrivedAt",
		() => {
			const store = storage();
			const world = records();
			return Effect.gen(function* () {
				yield* TestClock.setTime(100_000);
				yield* Effect.gen(function* () {
					const processes = yield* ProcessManager;
					yield* processes.start(first(), from());
					yield* processes.start(
						first("watcher:start", "watcher:1", {program: "watcher", hash: "build-a"}),
						from(),
					);
				}).pipe(Effect.provide(manager(store, brain(), ids(A, W).next)));
				yield* ProcessManager.use((p) =>
					p.monitor("one", A, from({sentAt: "2099-01-01T00:00:00Z"})),
				).pipe(Effect.provide(manager(store, processCaller(W))));
				yield* ProcessManager.use((p) =>
					p.exit(A, "crashed", from({sentAt: "1900-01-01T00:00:00Z"})),
				).pipe(Effect.provide(manager(store)));
				yield* TestClock.setTime(100_037);
				expect(
					yield* receive(W).pipe(Effect.provide(manager(store, processCaller(W)))),
				).toHaveLength(1);
				yield* SpanSink.use((sink) => sink.flush);
				const health = world.sink
					.db()
					.prepare("SELECT * FROM health WHERE piece='process.receive'")
					.all();
				expect(health).toHaveLength(1);
				expect(health[0]?.["lag"]).toBe(37);
			}).pipe(Effect.provide(world.layer));
		},
	);
});

describe("p99, process content stays out of span tags and health", () => {
	it.effect(
		"plant, tag mail or stringify a failure: message and Redacted values never leak",
		() => {
			const store = storage();
			const world = records();
			const MESSAGE = "p33-private-message-marker";
			const SECRET = "p33-redacted-secret-marker";
			return Effect.gen(function* () {
				yield* Effect.gen(function* () {
					const processes = yield* ProcessManager;
					const mailbox = yield* Mailbox;
					yield* processes.start(first(), from());
					yield* mailbox.send("counter:1", "message-17", {type: "save", text: MESSAGE}, from());
					expect(yield* receive(A)).toHaveLength(1);
					store.fault.after = 0;
					store.fault.error = new Error(MESSAGE, {cause: Redacted.make(SECRET)});
					yield* Effect.exit(processes.exit(A, "crashed", from()));
					store.fault.after = null;
				}).pipe(Effect.provide(manager(store)));
				yield* SpanSink.use((sink) => sink.flush);
				const rows = [
					...(yield* recorded(A)),
					...(yield* RecordManager.use((r) =>
						Stream.runCollect(r.read(Chain.cases.spans.make({}))),
					)),
				];
				expect(rows.some((row) => row.name === "process.receive")).toBe(true);
				expect(rows.some((row) => row.name === "process.exit" && !row.ok)).toBe(true);
				leakFree(rows, [MESSAGE, SECRET, "SQLITE_FULL planted after an earlier write"]);
				const health = JSON.stringify(world.sink.db().prepare("SELECT * FROM health").all());
				for (const mark of [MESSAGE, SECRET, "SQLITE_FULL planted after an earlier write"])
					expect(health).not.toContain(mark);
			}).pipe(Effect.provide(world.layer));
		},
	);
});
