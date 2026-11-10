// P34, next/. Coordination owns protected dead writes and referee-authored status.
// P33's existing monitor/window tests stay untouched. These add the ended-process read and
// fixed dead operation that supervision needs, including file reopen and foreign ledger rows.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {Ledger} from "../data/ledger.ts";
import {lineFor, valueFor} from "../data/log.ts";
import {fcProcessIds} from "../id.test-support.ts";
import {ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	W,
	X,
	BRAIN,
	CLIENT,
	again,
	brain,
	events,
	first,
	from,
	ids,
	manager,
	read,
	storage,
	watcher,
} from "./process.test-support.ts";
import {brainOnly, canRestart, Dead, ProcessEvent, Start} from "./process.ts";
import {Recovery} from "./recovery.ts";

const deadInput = {
	tries: 3,
	limit: 3,
	m: "poison",
	build: "build-a",
	errors: ["TypeError", "RangeError", "TypeError"],
};

// Keep the older authority law exercising an already-tagged caller, which is still valid input.
const dead = Dead.make({process: A, program: "counter", name: "counter:1", ...deadInput});

const processId = fcProcessIds;
const text = fc.string({minLength: 1, maxLength: 256});
const name = fc.stringMatching(/^p:[a-z0-9._:-]{1,254}$/);

const input = fc
	.record({m: text, build: text, errors: fc.array(text, {minLength: 1, maxLength: 32})})
	.map((value) => ({...value, tries: value.errors.length, limit: value.errors.length}));

const invalidInputs = fc
	.tuple(
		input,
		fc.string({minLength: 257, maxLength: 300}),
		fc.oneof(
			fc.integer({max: 0}),
			fc.integer({min: 0, max: 32}).map((n) => n + 0.5),
		),
	)
	.map(([value, long, count]) => [
		{...value, errors: value.errors.slice(1)},
		{...value, m: ""},
		{...value, m: long},
		{...value, build: ""},
		{...value, build: long},
		{...value, errors: ["", ...value.errors.slice(1)]},
		{...value, errors: [long, ...value.errors.slice(1)]},
		{...value, tries: count},
		{...value, limit: count},
	]);

// Two programs with different registered names; either may restart several times.
const history = fc.record({
	programs: fc.uniqueArray(text, {minLength: 2, maxLength: 2}),
	names: fc.uniqueArray(name, {minLength: 2, maxLength: 2}),
	processes: fc.uniqueArray(processId, {minLength: 6, maxLength: 6}),
	restarts: fc.array(fc.integer({min: 0, max: 1}), {minLength: 1, maxLength: 3}),
	reverse: fc.boolean(),
	reopen: fc.boolean(),
	repeat: fc.boolean(),
	input,
});

type History = typeof history extends fc.Arbitrary<infer Value> ? Value : never;

const seeded = Effect.fnUntraced(function* (h: History) {
	const disk = storage();
	const next = ids(...h.processes);
	const starts: Array<typeof ProcessEvent.cases.started.Type> = [];
	const current: string[] = [];
	const layer = () => manager(disk, brain(), next.next);

	for (const i of [0, 1]) {
		const started = yield* ProcessManager.use((p) =>
			p.start(first(`start:${i}`, h.names[i]!, {program: h.programs[i]!, hash: "build-a"}), from()),
		).pipe(Effect.provide(layer()));
		current[i] = started.process;
	}

	for (const i of h.restarts) {
		yield* Effect.gen(function* () {
			const p = yield* ProcessManager;
			const after = current[i]!;
			yield* p.exit(after, "crashed", from());
			const started = yield* p.start(
				Start.cases.again.make({
					id: `restart:${after}`,
					name: h.names[i]!,
					code: {program: h.programs[i]!, hash: "build-b"},
					after,
					reason: "crashed",
				}),
				from(),
			);
			current[i] = started.process;
		}).pipe(Effect.provide(layer()));

		if (h.reopen) {
			disk.reopen();
		}
	}

	for (const row of disk.rows()) {
		if (row._tag === "started" && row.by === BRAIN) {
			starts.push(Schema.decodeUnknownSync(ProcessEvent.cases.started)(valueFor(row)));
		}
	}

	return {disk, layer, starts: h.reverse ? starts.reverse() : starts};
});

describe("T319, next/ dead-letter identity", () => {
	it("plant, drop bad_text: invalid dead input returns a typed refusal and writes nothing", async () => {
		await fc.assert(
			fc.asyncProperty(invalidInputs, (values) => {
				const disk = storage();
				return Effect.runPromise(
					Effect.gen(function* () {
						const processes = yield* ProcessManager;
						yield* processes.start(first(), from());
						const before = disk.rows();

						for (const invalid of values) {
							const error = yield* processes.dead(A, invalid, from()).pipe(Effect.flip);
							expect(error).toMatchObject({_tag: "ProcessError", reason: "bad_text"});
							expect(disk.rows()).toEqual(before);
						}
					}).pipe(Effect.provide(manager(disk))),
				);
			}),
			{seed: 119120, numRuns: 12},
		);
	});

	for (const [field, plant] of [
		["process", "use the successor ID or a registered-name stream"],
		["program", "use another process's program or a constant"],
		["name", "use the program or another registered name"],
	] as const) {
		it(`plant, ${plant}: dead.${field} matches its historical started event after replacement`, async () => {
			await fc.assert(
				fc.asyncProperty(history, (h) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const w = yield* seeded(h);

							for (const started of w.starts) {
								// A tagged caller remains legal extra input. This also reaches the identity
								// assertion before the old manager's refusal of untagged input can hide it.
								const tagged = {...h.input, _tag: "dead" as const};
								yield* ProcessManager.use((p) => p.dead(started.process, tagged, from())).pipe(
									Effect.provide(w.layer()),
								);

								if (h.reopen) {
									w.disk.reopen();
								}

								const rows = yield* read(`${started.process}/dead`).pipe(Effect.provide(w.layer()));
								expect(rows).toHaveLength(1);
								expect(rows[0]!.stream).toBe(`${started.process}/dead`);
								expect(rows[0]!.by).toBe(BRAIN);
								expect(rows[0]!.body).toMatchObject({[field]: started[field]});

								if (h.repeat) {
									// Repeating with only DeadInput's fields must also be accepted and deduplicated.
									yield* ProcessManager.use((p) => p.dead(started.process, h.input, from())).pipe(
										Effect.provide(w.layer()),
									);
									expect(
										yield* read(`${started.process}/dead`).pipe(Effect.provide(w.layer())),
									).toEqual(rows);
								}
							}

							const deadRows = w.disk.rows().filter((row) => row._tag === "dead");
							expect(deadRows).toHaveLength(w.starts.length);

							for (const row of deadRows) {
								expect(row.body).toMatchObject({process: row.stream.slice(0, -"/dead".length)});
							}
						}),
					),
				),
				{seed: 119120, numRuns: 12},
			);
		});
	}

	it("plant, append caller identity: extra process, program and name cannot replace checked history", async () => {
		await fc.assert(
			fc.asyncProperty(history, (h) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = yield* seeded(h);

						for (const started of w.starts) {
							const other = w.starts.find((s) => s.name !== started.name)!;
							const forged = {
								...h.input,
								_tag: "dead" as const,
								process: h.processes[5]!,
								program: other.program,
								name: other.name,
							};
							yield* ProcessManager.use((p) => p.dead(started.process, forged, from())).pipe(
								Effect.provide(w.layer()),
							);

							if (h.reopen) {
								w.disk.reopen();
							}

							const rows = yield* read(`${started.process}/dead`).pipe(Effect.provide(w.layer()));
							expect(rows).toMatchObject([
								{
									by: BRAIN,
									body: {
										...h.input,
										process: started.process,
										program: started.program,
										name: started.name,
									},
								},
							]);

							if (h.repeat) {
								const changed = {
									...forged,
									process: other.process,
									program: "ignored",
									name: "ignored",
								};
								yield* ProcessManager.use((p) => p.dead(started.process, changed, from())).pipe(
									Effect.provide(w.layer()),
								);
								expect(
									yield* read(`${started.process}/dead`).pipe(Effect.provide(w.layer())),
								).toEqual(rows);
							}
						}

						expect(yield* read(`${h.processes[5]!}/dead`).pipe(Effect.provide(w.layer()))).toEqual(
							[],
						);
					}),
				),
			),
			{seed: 119120, numRuns: 12},
		);
	});
});

describe("P34 coordination recovery", () => {
	it.effect.prop(
		"p79 p80 plant, client clock or reset on replacement: status retains referee restart times at the exact edge",
		{generated: Schema.String},
		({generated}) =>
			Effect.forEach(
				["forged", generated],
				(value) =>
					Effect.gen(function* () {
						const disk = storage();
						const next = ids(A, B, W);
						yield* TestClock.setTime(1000);
						yield* ProcessManager.use((p) =>
							p.start(first(), from({sentAt: "2099-01-01T00:00:00Z"})),
						).pipe(Effect.provide(manager(disk, brain(), next.next)));

						for (const [at, old] of [
							[1100, A],
							[1200, B],
						] as const) {
							yield* TestClock.setTime(at);
							yield* Effect.gen(function* () {
								const p = yield* ProcessManager;
								yield* p.exit(old, "crashed", from());
								yield* p.start(again(old), from({sentAt: "1970-01-01T00:00:00Z"}));
							}).pipe(Effect.provide(manager(disk, brain(), next.next)));
							disk.reopen();
						}

						yield* Ledger.use((l) =>
							l.append(
								"processes/counter:1",
								"foreign-down",
								lineFor(from({by: CLIENT}), {
									_tag: "down",
									process: W,
									reason: value,
									crashes: 99,
									until: 999999,
								}),
							),
						).pipe(Effect.provide(manager(disk)));
						yield* TestClock.setTime(6100);
						yield* Effect.gen(function* () {
							const p = yield* ProcessManager;
							expect(p.status, "P34 parent-checked status read is missing").toBeTypeOf("function");
							const status = yield* p.status("counter:1");
							expect(status).toMatchObject({
								name: "counter:1",
								state: {_tag: "live", process: W},
								at: 6100,
								restarts: [1100, 1200],
							});
							expect(canRestart(status.restarts, status.at, 5000, 2)).toBe(false);
							yield* TestClock.setTime(6101);
							const later = yield* p.status("counter:1");
							expect(later.restarts).toEqual([1100, 1200]);
							expect(canRestart(later.restarts, later.at, 5000, 2)).toBe(true);
						}).pipe(Effect.provide(manager(disk, brain(), next.next)));
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);

	it.effect.prop(
		"p80 plant, info loses ended state: status preserves down deadline and refuses another parent",
		{generated: Recovery.cases.down.mapFields(({_tag, process, ...fields}) => fields)},
		({generated}) =>
			Effect.forEach(
				[{reason: "saved_letter", crashes: 2, until: 5001}, generated],
				(value) =>
					Effect.gen(function* () {
						const disk = storage();
						yield* Effect.gen(function* () {
							const p = yield* ProcessManager;
							yield* p.start(first(), from());
							yield* p.exit(A, value.reason, from());
							yield* p.down(A, value, from());
							expect(p.status, "P34 status must include ended and down processes").toBeTypeOf(
								"function",
							);
							expect(yield* p.status("counter:1")).toMatchObject({
								state: {_tag: "down", process: A, until: value.until, crashes: value.crashes},
							});
						}).pipe(Effect.provide(manager(disk)));
						disk.reopen();
						yield* Effect.gen(function* () {
							const p = yield* ProcessManager;
							expect(yield* Effect.flip(p.status("counter:1"))).toMatchObject({
								reason: "not_parent",
							});
						}).pipe(Effect.provide(manager(disk, watcher(X))));
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);

	for (const [stream, tag] of [
		["notes", "dead"],
		[`${A}/dead`, "note"],
	] as const) {
		it(`P33 authority plant, public dead append: shared write policy reserves ${tag} in ${stream}`, () => {
			expect(brainOnly({stream, id: "forged", tag})).toBe(true);
		});
	}

	it.effect.prop(
		"P33 authority plant, write dead as caller: only fixed parent-checked operation creates one brain row",
		{generated: Dead.fields.m},
		({generated}) =>
			Effect.forEach(
				["poison", generated],
				(value) =>
					Effect.gen(function* () {
						const disk = storage();
						yield* Effect.gen(function* () {
							const p = yield* ProcessManager;
							yield* p.start(first(), from());
							expect(p.dead, "P34 fixed dead write is missing").toBeTypeOf("function");
							yield* p.dead(A, {...dead, m: value}, from({by: CLIENT}));
						}).pipe(Effect.provide(manager(disk)));
						disk.reopen();
						yield* Effect.gen(function* () {
							const p = yield* ProcessManager;
							yield* p.dead(A, {...dead, m: value}, from({by: CLIENT}));
							expect(yield* read(`${A}/dead`)).toMatchObject([
								{
									by: BRAIN,
									_tag: "dead",
									body: {m: value, tries: 3, errors: ["TypeError", "RangeError", "TypeError"]},
								},
							]);
						}).pipe(Effect.provide(manager(disk)));
						yield* Effect.gen(function* () {
							const p = yield* ProcessManager;
							expect(yield* Effect.flip(p.dead(A, {...dead, m: value}, from()))).toMatchObject({
								reason: "not_parent",
							});
						}).pipe(Effect.provide(manager(disk, watcher(X))));
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);

	it.effect.prop(
		"p79 plant, new start ID after lost reply: repeated exit/start has one exact DOWN and successor",
		{generated: ProcessEvent.cases.exited.fields.reason},
		({generated}) =>
			Effect.forEach(
				["crashed", generated],
				(value) =>
					Effect.gen(function* () {
						const disk = storage();
						const next = ids(A, B, W);
						yield* Effect.gen(function* () {
							const p = yield* ProcessManager;
							yield* p.start(first(), from());
							yield* p.monitor("watch-a", A, from());
							yield* p.exit(A, value, from());
							yield* p.start(again(A), from());
						}).pipe(Effect.provide(manager(disk, brain(), next.next)));
						disk.reopen();
						yield* Effect.gen(function* () {
							const p = yield* ProcessManager;
							yield* p.exit(A, value, from());
							expect((yield* p.start(again(A), from())).process).toBe(B);
							expect((yield* events("counter:1")).filter((r) => r._tag === "exited")).toHaveLength(
								1,
							);
							expect(
								(yield* events("counter:1")).filter((r) => r._tag === "restarted"),
							).toHaveLength(1);
							expect(yield* read("client:window-a/inbox")).toMatchObject([
								{body: {m: {ref: "watch-a", process: A, to: brain().recipient}}},
							]);
							expect(next.calls()).toBe(2);
						}).pipe(Effect.provide(manager(disk, brain(), next.next)));
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);
});
