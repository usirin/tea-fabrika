// p22's real counter belongs here: the library's exam forbids importing a program from a library test.
// Uses P11's same injected contracts, actual Ledger.sql and ProcessStore.sql, and no Cmd handlers.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Id} from "@kampus/libfabrika";
import {Mailbox, Writer} from "@kampus/libfabrika/coordination";
import {Doorbell, Ledger} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Effect, Layer, Result, Schema, Stream} from "effect";
import * as fc from "fast-check";

const PROCESS: string = Effect.runSync(
	Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer)),
);
const NAME = "counter:1";
const LIBRARY = "@kampus/libfabrika"; // Missing P11 exports must not prevent collecting the laws.
const SEED = 119120;
const folder = mkdtempSync(join(tmpdir(), "p11-counter-"));
const opened: DatabaseSync[] = [];
afterAll(() => {
	for (const db of opened) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
type Update =
	| {type: "whole"; rev: number; view: unknown}
	| {
			type: "patch";
			base: number;
			rev: number;
			patch: ReadonlyArray<{op: string; path: string; value?: unknown}>;
	  };
type Runner = {
	readonly open: (client: string) => Effect.Effect<{rev: number; view: unknown}, unknown>;
	readonly msg: (input: unknown) => Effect.Effect<{_tag: string; reason?: string}, unknown>;
};
const reconstruct = (before: unknown, change: Update): unknown => {
	if (change.type === "whole") return structuredClone(change.view);
	let root = structuredClone(before);
	for (const p of change.patch) {
		if (p.path === "") {
			root = structuredClone(p.value);
			continue;
		}
		const keys = p.path
			.slice(1)
			.split("/")
			.map((k) => k.replaceAll("~1", "/").replaceAll("~0", "~"));
		let target = root;
		for (const key of keys.slice(0, -1)) target = Reflect.get(Object(target), key);
		if (p.op === "remove") Reflect.deleteProperty(Object(target), keys.at(-1)!);
		else Reflect.set(Object(target), keys.at(-1)!, structuredClone(p.value));
	}
	return root;
};

describe("p22 real counter in the runner", () => {
	it("loads a constructed counter and returns typed load failures for broken modules", async () => {
		const {counter} = await import("./program.ts");
		const {ProgramDown, ProgramLoader}: typeof import("@kampus/libfabrika") = await import(LIBRARY);
		const malformed = fc.option(
			fc.oneof(
				fc
					.constantFrom(
						"name",
						"machine",
						"state",
						"msg",
						"view",
						"refuse",
						"inputs",
						"outputs",
						"writes",
						"wake",
					)
					.map((field) => {
						const raw: Record<string, unknown> = {...counter};
						delete raw[field];
						return raw;
					}),
				fc.jsonValue().map((bad) => ({...counter, msg: bad})),
				fc
					.tuple(fc.constantFrom("refuse", "wake"), fc.jsonValue())
					.map(([field, bad]) => ({...counter, [field]: bad})),
			),
			{nil: null},
		);
		await fc.assert(
			fc.asyncProperty(
				fc.record({
					name: fc.string().map((s) => `broken-${s}`),
					count: fc.integer(),
					broken: malformed,
				}),
				async ({name, count, broken}) => {
					await Effect.runPromise(
						Effect.gen(function* () {
							const loader = yield* ProgramLoader;
							const healthy = yield* loader.load("counter");
							expect(healthy.stepper.program.machine).toBe(counter.machine);
							expect(healthy.stepper.init({count})).toMatchObject({_tag: "stepped", view: {count}});
							const result = yield* Effect.result(loader.load(name));
							expect(Result.isFailure(result)).toBe(true);
							if (Result.isFailure(result)) {
								expect(Schema.is(ProgramDown)(result.failure)).toBe(true);
								expect(result.failure.reason).toBe("load");
							}
						}).pipe(Effect.provide(ProgramLoader.layer({counter, [name]: broken}, {}))),
					);
				},
			),
			{seed: SEED, numRuns: 100},
		);
	});
	it("plant, skip first letter or patch the wrong base: wake and every watcher reproduce the counter", async () => {
		const {counter} = await import("./program.ts");
		const A: typeof import("@kampus/libfabrika") = await import(LIBRARY);
		const C = await import("@kampus/libfabrika/coordination");
		let ledgerDb = new DatabaseSync(join(folder, "ledger.db"));
		opened.push(ledgerDb);
		let storeDb = new DatabaseSync(join(folder, "process.db"));
		opened.push(storeDb);
		const seen = new Map<string, {rev: number; view: unknown}>();
		const expected = Schema.Struct({count: Schema.Int});
		const data = () =>
			Ledger.sql(nodeSql(ledgerDb), {reader: "counter-law"}).pipe(
				Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
			);
		const layer = () => {
			const checked = Layer.effect(
				A.CheckedWriter,
				Effect.gen(function* () {
					const mailbox = yield* Mailbox;
					return {
						append: (i: {id: string; envelope: {input: unknown}; sentAt: string; seen: number}) =>
							mailbox.send(NAME, i.id, i.envelope.input, {
								by: "SHA256:person",
								for: "person",
								sentAt: i.sentAt,
								seen: i.seen,
								parent: null,
								traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
								build: "counter-build",
							}),
						commit: () => Effect.die("counter has no write Cmd"),
						own: () => Effect.die("counter has no own Cmd"),
					};
				}),
			);
			return A.ProgramRunner.layer({
				id: PROCESS,
				name: NAME,
				program: "counter",
				build: "counter-build",
				owner: Writer.cases.person.make({key: "SHA256:person", for: "person"}),
			}).pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						A.ProgramLoader.layer({counter}, {}),
						C.ProcessStore.layer(nodeSql(storeDb), {process: PROCESS}),
						checked,
						Layer.succeed(A.WatcherManager, {
							publish: (client: string, update: Update) =>
								Effect.sync(() => {
									const prior = seen.get(client);
									expect(update.type === "whole" || update.base === prior?.rev).toBe(true);
									seen.set(client, {rev: update.rev, view: reconstruct(prior?.view, update)});
								}),
						}),
						Layer.succeed(A.Alarm, {set: () => Effect.void}),
						Layer.succeed(A.Recording, {flush: Effect.void}),
					).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data())))),
				),
			);
		};
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* A.ProgramRunner;
				yield* r.open("a");
				for (let n = 1; n <= 12; n++) {
					if (n === 5) yield* r.open("b");
					yield* r.msg({
						id: `counter-${n}`,
						envelope: {
							id: `input_0000000000e0080000000000${n.toString(16).padStart(2, "0")}`,
							by: Writer.cases.person.make({key: "SHA256:person", for: "person"}),
							arrivedAt: n,
							input: {type: "inc"},
						},
						sentAt: "writer clock",
						seen: 0,
						span: {traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7"},
					});
					for (const state of seen.values())
						expect(Schema.decodeUnknownSync(expected)(state.view)).toEqual({count: n});
				}
				expect((yield* r.open("inspect")).view).toEqual({count: 12});
				expect(yield* Stream.runCollect((yield* Mailbox).receive(NAME, 0))).toHaveLength(12);
			}).pipe(Effect.provide(layer())),
		);
		ledgerDb.close();
		storeDb.close();
		ledgerDb = new DatabaseSync(join(folder, "ledger.db"));
		opened.push(ledgerDb);
		storeDb = new DatabaseSync(join(folder, "process.db"));
		opened.push(storeDb);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r: Runner = yield* A.ProgramRunner;
				expect((yield* r.open("after-wake")).view).toEqual({count: 12});
			}).pipe(Effect.provide(layer())),
		);
	});
	it("plant, guess a program: the in-process loader returns no_program", async () => {
		const {counter} = await import("./program.ts");
		const {ProgramLoader}: typeof import("@kampus/libfabrika") = await import(LIBRARY);
		await Effect.runPromise(
			Effect.gen(function* () {
				const loader = yield* ProgramLoader;
				expect(yield* Effect.flip(loader.load("missing"))).toMatchObject({reason: "no_program"});
			}).pipe(Effect.provide(ProgramLoader.layer({counter}, {}))),
		);
	});
});
