// P15a, next/. P12's reusable build must live here, with the same strict Compiler on reload.
// Fixture layout follows the app's next/programs/<name>/src entry convention.
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Effect, Layer, Queue, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {checks, disk} from "../app/reload.test-support.ts";
import {Archive} from "../data/archive.ts";
import {RecordManager} from "../data/records.ts";
import {SpanSink} from "../data/sink.ts";
import {Chain} from "../data/trace.ts";

const project = (groups: readonly boolean[]) => {
	const root = mkdtempSync("/tmp/p15-watch.");
	symlinkSync(
		resolve(import.meta.dirname, "../../../../../node_modules"),
		join(root, "node_modules"),
	);
	const base = join(root, "next/programs");
	mkdirSync(base, {recursive: true});
	writeFileSync(join(base, "shared.ts"), "export const amount = 1;\n");
	for (const [i, shared] of groups.entries()) {
		const path = join(base, `test${i}`, "src");
		mkdirSync(path, {recursive: true});
		writeFileSync(
			join(path, "program.ts"),
			`import {Program} from '@kampus/libfabrika';
import {Machine} from '@demlik/tea/effect'; import {Schema} from 'effect';
${shared ? "import {amount} from '../../shared.ts';" : "const amount = 1;"}
export const machine = Machine.make({model: Schema.Struct({count: Schema.Int}), msg: Schema.Struct({type: Schema.Literal('inc')}), cmds: [], init: loaded => [loaded ?? {count: 0}, []], update: {inc: s => [{count: s.count + amount}, []]}});
export const program = Program.make({name: 'test${i}', machine, state: {v: 1, upgrades: []}, view: s => s, refuse: () => null, inputs: {inc: 'Add'}, outputs: {}, writes: {}, wake: () => null});
`,
		);
		writeFileSync(
			join(path, "window.tsx"),
			"export const Window = (p: {count: number}) => <b>{p.count}</b>;\n",
		);
	}
	writeFileSync(join(root, "compiler-ledger.json"), "[]\n");
	return {root, base, close: () => rmSync(root, {recursive: true, force: true})};
};

describe("P15a real build/watch", () => {
	it("p77: a shared dependency edit rebuilds exactly its affected programs", async () => {
		// Plant: hash only the entry file or broadcast every edit to all registered programs.
		const {watchPrograms} = await import("./reload.ts");
		const {CodeInstaller} = await import("../app/loader.ts");
		const {CodeBundle} = await import("../data/code.ts");
		await fc.assert(
			fc.asyncProperty(
				fc.tuple(fc.constant(true), fc.boolean(), fc.constant(false)),
				fc.integer({min: 2, max: 10}),
				async (groups, amount) => {
					const p = project(groups);
					try {
						const seen: Array<typeof CodeBundle.Type> = [];
						await Effect.runPromise(
							Effect.scoped(
								Effect.gen(function* () {
									const installed = yield* Queue.unbounded<typeof CodeBundle.Type>();
									const layer = Layer.succeed(CodeInstaller, {
										install: (_req, raw) =>
											Schema.decodeUnknownEffect(CodeBundle)(raw).pipe(
												Effect.orDie,
												Effect.flatMap((bundle) =>
													Effect.sync(() => {
														seen.push(bundle);
													}).pipe(Effect.andThen(Queue.offer(installed, bundle)), Effect.asVoid),
												),
											),
										failed: () => Effect.die("valid dependency edit failed"),
									});
									yield* watchPrograms({
										programs: groups.map((_, i) => `test${i}`),
										root: p.root,
									}).pipe(Effect.provide(layer), Effect.forkChild);
									for (const _ of groups) yield* Queue.take(installed);
									const before = new Map(seen.map((b) => [b.program, b.hash]));
									yield* Effect.sync(() =>
										writeFileSync(join(p.base, "shared.ts"), `export const amount = ${amount};\n`),
									);
									const expected = groups.flatMap((shared, i) => (shared ? [`test${i}`] : []));
									const changed: (typeof CodeBundle.Type)[] = [];
									for (const _ of expected) changed.push(yield* Queue.take(installed));
									expect(changed.map((b) => b.program).sort()).toEqual(expected.sort());
									for (const b of changed) expect(b.hash).not.toBe(before.get(b.program));
								}),
							),
						).then(() => {
							expect(seen.filter((b) => b.program === "test2")).toHaveLength(1);
						});
					} finally {
						p.close();
					}
				},
			),
			{...checks, numRuns: 4},
		);
	});
	it("H4: syntax and Compiler failures publish no bundle and retain last-good emitted files", async () => {
		// Plant: transform without full check, overwrite output early, or never close failed builds.
		const {watchPrograms} = await import("./reload.ts");
		const {CodeInstaller} = await import("../app/loader.ts");
		await fc.assert(
			fc.asyncProperty(fc.constantFrom("syntax", "compiler"), async (kind) => {
				const p = project([true]);
				const sinkDisk = disk(p.root, "spans");
				const monitoring = Layer.mergeAll(
					SpanSink.layer(sinkDisk.sql, {object: "p15-watcher"}),
					RecordManager.memory(1024 * 1024 * 1024),
					Archive.memory,
				);
				try {
					const installed: unknown[] = [];
					const failures: unknown[] = [];
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const answers = yield* Queue.unbounded<"loaded" | "failed">();
								const sink = yield* SpanSink;
								const layer = Layer.succeed(CodeInstaller, {
									install: (_r, bundle) =>
										Effect.sync(() => {
											installed.push(structuredClone(bundle));
										}).pipe(
											Effect.andThen(sink.flush.pipe(Effect.orDie)),
											Effect.andThen(Queue.offer(answers, "loaded")),
											Effect.asVoid,
										),
									failed: (_id, _program, diagnostic) =>
										Effect.sync(() => {
											failures.push(diagnostic);
										}).pipe(
											Effect.andThen(sink.flush.pipe(Effect.orDie)),
											Effect.andThen(Queue.offer(answers, "failed")),
											Effect.asVoid,
										),
								});
								yield* watchPrograms({programs: ["test0"], root: p.root}).pipe(
									Effect.provide(layer),
									Effect.forkChild,
								);
								expect(yield* Queue.take(answers)).toBe("loaded");
								yield* Effect.sync(() =>
									writeFileSync(
										join(p.base, "test0/src/window.tsx"),
										kind === "syntax"
											? "export const Window = <;"
											: "import {useRef} from 'react'; export const Window = () => {const r = useRef(1); return <b>{r.current}</b>;};",
									),
								);
								expect(yield* Queue.take(answers)).toBe("failed");
								expect(installed).toHaveLength(1);
								expect(failures).toHaveLength(1);
								expect(failures[0]).toMatchObject({
									path: expect.stringMatching(/window\.tsx$/),
									line: expect.any(Number),
								});
								const recorded = yield* RecordManager.use((r) =>
									Stream.runCollect(r.read(Chain.cases.spans.make({}))),
								);
								const builds = recorded.filter((row) => row.name === "code.build");
								expect(builds.some((row) => row.ok)).toBe(true);
								expect(builds.some((row) => !row.ok)).toBe(true);
								for (const span of builds)
									expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(
										BigInt(span.startTimeUnixNano),
									);
							}).pipe(Effect.provide(monitoring)),
						),
					);
				} finally {
					sinkDisk.close();
					p.close();
				}
			}),
			{...checks, numRuns: 2},
		);
	});
});
