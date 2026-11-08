// P13, next/. Real ProgramRunner, Mailbox and SQLite. The checked edge stamps the test caller.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {
	Alarm,
	CheckedWriter,
	ProgramLoader,
	ProgramRunner,
	Recording,
	WatcherManager,
	type Program,
	type Update,
} from "@kampus/libfabrika";
import {Mailbox, ProcessStore, Writer} from "@kampus/libfabrika/coordination";
import {Doorbell, Ledger, type Entry} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Effect, Layer, Schema, Stream} from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const PROCESS = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
const NAME = "notes:1";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const folder = mkdtempSync("/tmp/fh.");
const databases: DatabaseSync[] = [];
afterAll(() => {
	for (const db of databases) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
let files = 0;
const disk = () => {
	const path = join(folder, `${++files}.db`);
	let db = new DatabaseSync(path);
	databases.push(db);
	return {
		sql: () => nodeSql(db),
		removeCheckpoint: () => db.prepare("DELETE FROM process_state WHERE process=?").run(PROCESS),
		reopen: () => {
			db.close();
			db = new DatabaseSync(path);
			databases.push(db);
		},
	};
};
type Save = {
	note: string;
	base: number;
	body: string;
	how?: "pause" | "leave" | "done" | "kept";
	from?: {note: string; version: number};
};
const View = Schema.Struct({
	notes: Schema.Array(
		Schema.Struct({note: Schema.String, version: Schema.Int, body: Schema.String}),
	),
});
type Model = typeof View.Type;
const who = (as: "person" | "agent" = "person") =>
	Writer.cases[as].make({key: `SHA256:${as}`, for: `person-${as}`});
// UUIDv7 wrapped as a TypeID. Stable letter ids are independent of P10's stamped input parent.
const letter = (n: number) => {
	let value = (1794099600000n << 80n) | (7n << 76n) | (2n << 62n) | BigInt(n);
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	let suffix = "";
	for (let k = 0; k < 26; k++) {
		suffix = alphabet[Number(value & 31n)] + suffix;
		value >>= 5n;
	}
	return `input_${suffix}`;
};
const input = (n: number, save: Save, as: "person" | "agent" = "person") => ({
	id: letter(n),
	envelope: {
		id: `in-${PROCESS}-${n}`,
		by: who(as),
		arrivedAt: 1794099600000 + n,
		input: {type: "save", value: save},
	},
	sentAt: `2026-11-08T01:00:${String(59 - (n % 60)).padStart(2, "0")}Z`,
	seen: 0,
	span: {traceId: TRACE, spanId: "00f067aa0ba902b7"},
});
const readInbox = Ledger.use((l) => Stream.runCollect(l.read(`${NAME}/inbox`, 0)));
const world = (program: Program) => {
	const log = disk(),
		state = disk();
	const published: Update[] = [];
	const data = () =>
		Ledger.sql(log.sql(), {reader: "p13-notes"}).pipe(
			Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
		);
	const checked = Layer.effect(
		CheckedWriter,
		Effect.gen(function* () {
			const mailbox = yield* Mailbox;
			return {
				append: (i: Parameters<typeof CheckedWriter.Service.append>[0]) =>
					mailbox.send(NAME, i.id, i.envelope.input, {
						by: i.envelope.by.key,
						for: i.envelope.by.for,
						sentAt: i.sentAt,
						seen: i.seen,
						parent: i.envelope.id,
						traceId: i.span.traceId,
						build: "p13-build",
					}),
				commit: () => Effect.die("notes has no write Cmd"),
				own: () => Effect.die("notes has no own Cmd"),
			};
		}),
	);
	const layer = () =>
		ProgramRunner.layer({
			id: PROCESS,
			name: NAME,
			program: "notes",
			build: "p13-build",
			owner: who(),
		}).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					ProgramLoader.layer({notes: program}, {}),
					ProcessStore.layer(state.sql(), {process: PROCESS}),
					checked,
					Layer.succeed(WatcherManager, {
						publish: (_client, change) =>
							Effect.sync(() => {
								published.push(change);
							}),
					}),
					Layer.succeed(Alarm, {set: () => Effect.void}),
					Layer.succeed(Recording, {flush: Effect.void}),
				).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data())))),
			),
		);
	return {
		layer,
		published,
		reopen: () => {
			log.reopen();
			state.reopen();
		},
		rebuild: () => {
			state.removeCheckpoint();
			log.reopen();
			state.reopen();
		},
	};
};
const view = (r: typeof ProgramRunner.Service) =>
	r.open("inspect").pipe(Effect.map((v) => Schema.decodeUnknownSync(View)(v.view)));
const oracle = (before: Model, s: Save): Model => ({
	notes: [
		{note: s.note, version: s.base + 1, body: s.body},
		...before.notes.filter((n) => n.note !== s.note),
	],
});
const payload = Schema.Struct({
	m: Schema.Struct({
		type: Schema.Literal("save"),
		value: Schema.Struct({
			note: Schema.String,
			base: Schema.Int,
			body: Schema.String,
			how: Schema.optionalKey(Schema.String),
			from: Schema.optionalKey(Schema.Struct({note: Schema.String, version: Schema.Int})),
		}),
	}),
});
const saved = (e: Entry) => Schema.decodeUnknownSync(payload)(e.body).m.value;
const cases = fc.array(
	fc.record({
		note: fc.constantFrom("a", "b", "c"),
		body: fc.oneof(fc.string({maxLength: 40}), fc.constant("")),
		agent: fc.boolean(),
		how: fc.constantFrom(
			undefined,
			"pause" as const,
			"leave" as const,
			"done" as const,
			"kept" as const,
		),
		origin: fc.boolean(),
	}),
	{minLength: 1, maxLength: 18},
);

describe("P13 real notes runner", () => {
	it("p52 plant: replace a row, lose metadata, count across notes or refuse a current base", async () => {
		const {notes} = await import("./program.ts");
		await fc.assert(
			fc.asyncProperty(cases, async (values) => {
				const w = world(notes);
				await Effect.runPromise(
					Effect.gen(function* () {
						const r = yield* ProgramRunner;
						let model: Model = {notes: []};
						let old: ReadonlyArray<Entry> = [];
						for (const [index, value] of values.entries()) {
							const base = model.notes.find((n) => n.note === value.note)?.version ?? 0;
							const s: Save = {
								note: value.note,
								base,
								body: value.body,
								...(value.how === undefined ? {} : {how: value.how}),
								...(value.origin ? {from: {note: "origin", version: 2}} : {}),
							};
							const incoming = input(index + 1, s, value.agent ? "agent" : "person");
							const answer = yield* r.msg(incoming);
							expect(answer._tag).toBe("accepted");
							const rows = yield* readInbox;
							expect(rows).toHaveLength(index + 1);
							expect(rows.slice(0, -1)).toEqual(old);
							const last = rows.at(-1)!;
							expect(saved(last)).toEqual(s);
							expect(last).toMatchObject({
								id: incoming.id,
								by: incoming.envelope.by.key,
								for: incoming.envelope.by.for,
								sentAt: incoming.sentAt,
								seen: incoming.seen,
								parent: incoming.envelope.id,
								traceId: TRACE,
								build: "p13-build",
								arrivedAt: expect.any(Number),
								pos: index + 1,
							});
							if (answer._tag === "accepted")
								expect({rev: last.rev, pos: last.pos}).toEqual({rev: answer.rev, pos: answer.pos});
							model = oracle(model, s);
							expect(yield* view(r)).toEqual(model);
							old = structuredClone(rows);
						}
					}).pipe(Effect.provide(w.layer())),
				);
			}),
			{seed: SEED, numRuns: 25},
		);
	});
	it("p52 sender plant: use supplied writer or expose sentAt to the pure update", async () => {
		const {notes} = await import("./program.ts");
		const calls: unknown[] = [];
		const normal = notes.machine.update.save;
		const program = {
			...notes,
			machine: {
				...notes.machine,
				update: {
					...notes.machine.update,
					save: (model: typeof notes.state.schema.Type, m: typeof notes.msg.Type) => {
						calls.push(structuredClone(m));
						return normal(model, m);
					},
				},
			},
		};
		const w = world(program);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				for (const [index, as] of (["person", "agent"] as const).entries()) {
					const i = input(index + 1, {note: as, base: 0, body: "text"}, as);
					i.envelope.input.value = Object.assign(i.envelope.input.value, {
						by: "SHA256:forged",
						for: "forged",
						sentAt: "forged-clock",
					});
					expect((yield* r.msg(i))._tag).toBe("accepted");
				}
				const rows = yield* readInbox;
				expect(rows.map((e) => [e.by, e.for])).toEqual([
					["SHA256:person", "person-person"],
					["SHA256:agent", "person-agent"],
				]);
				expect(calls.length).toBeGreaterThan(0);
				for (const call of calls) {
					expect(call).not.toHaveProperty("sentAt");
					expect(call).not.toHaveProperty("arrivedAt");
					expect(call).not.toHaveProperty("by");
					expect(call).not.toHaveProperty("value.sentAt");
					expect(call).not.toHaveProperty("value.by");
					expect(call).not.toHaveProperty("value.for");
				}
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("p53 accepted plant: check base before id, deduplicate by body, or lose placing on reopen", async () => {
		const {notes} = await import("./program.ts");
		const w = world(notes),
			first = input(1, {note: "a", base: 0, body: "same"});
		let placing: unknown;
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				placing = yield* r.msg(first); // The driver deliberately discards this answer.
				expect(placing).toMatchObject({_tag: "accepted"});
				expect((yield* r.msg(input(2, {note: "a", base: 1, body: "same"})))._tag).toBe("accepted");
				expect(yield* r.msg(first)).toEqual(placing);
				expect(yield* readInbox).toHaveLength(2);
			}).pipe(Effect.provide(w.layer())),
		);
		w.reopen();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				expect(yield* r.msg(first)).toEqual(placing);
				expect(yield* view(r)).toEqual({notes: [{note: "a", version: 2, body: "same"}]});
				expect(yield* readInbox).toHaveLength(2);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("p54 plant: append refused saves, patch a watcher, or use the wrong now", async () => {
		const {notes} = await import("./program.ts");
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.nat({max: 12}), {minLength: 1, maxLength: 15}),
				async (bases) => {
					const w = world(notes);
					await Effect.runPromise(
						Effect.gen(function* () {
							const r = yield* ProgramRunner;
							yield* r.msg(input(1, {note: "a", base: 0, body: "first"}));
							yield* r.open("watcher");
							expect.hasAssertions();
							let now = 1;
							for (const [index, base] of bases.entries()) {
								const rows = yield* readInbox,
									before = yield* view(r),
									patches = w.published.length;
								const answer = yield* r.msg(
									input(index + 2, {note: "a", base, body: `draft-${index}`}),
								);
								if (base === now) {
									expect(answer._tag).toBe("accepted");
									now++;
								} else {
									expect(answer).toEqual({_tag: "refused", why: "changed_elsewhere", now});
									expect(yield* readInbox).toEqual(rows);
									expect(w.published).toHaveLength(patches);
									expect(yield* view(r)).toEqual(before);
								}
							}
						}).pipe(Effect.provide(w.layer())),
					);
				},
			),
			{seed: SEED, numRuns: 25},
		);
	});
	it("p54 race plant: remove the permit or use a project-wide note version", async () => {
		const {notes} = await import("./program.ts");
		const w = world(notes);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				const race = yield* Effect.all(
					[
						r.msg(input(1, {note: "a", base: 0, body: "one"})),
						r.msg(input(2, {note: "a", base: 0, body: "two"})),
					],
					{concurrency: 2},
				);
				expect(race.filter((a) => a._tag === "accepted")).toHaveLength(1);
				expect(race.filter((a) => a._tag === "refused")).toEqual([
					{_tag: "refused", why: "changed_elsewhere", now: 1},
				]);
				const separate = yield* Effect.all(
					[
						r.msg(input(3, {note: "b", base: 0, body: "b"})),
						r.msg(input(4, {note: "c", base: 0, body: "c"})),
					],
					{concurrency: 2},
				);
				expect(separate.every((a) => a._tag === "accepted")).toBe(true);
				expect(yield* readInbox).toHaveLength(3);
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("p54 size plant: ignore encoded JSON overhead; reject with no partial save or patch", async () => {
		const {notes, MOST} = await import("./program.ts");
		const w = world(notes);
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				yield* r.open("watcher");
				expect.hasAssertions();
				for (const [index, body] of [
					"x".repeat(MOST),
					"\u0000".repeat(MOST),
					"\u0000".repeat(MOST),
					"x".repeat(MOST + 1),
				].entries()) {
					const before = yield* readInbox,
						patches = w.published.length;
					// P6 caps a complete row at 2,000,000 bytes. Escaping alone fits; metadata can tip it over.
					const note = index === 2 ? "\u0000".repeat(100_000) : `size-${index}`;
					const answer = yield* r.msg(input(index + 1, {note, base: 0, body}));
					if (index < 2) expect(answer._tag).toBe("accepted");
					else {
						expect(answer).toMatchObject({
							_tag: "refused",
							why: index === 2 ? "too_big" : "too_long",
						});
						if (index === 3) expect(answer).toHaveProperty("most", MOST);
						expect(yield* readInbox).toEqual(before);
						expect(w.published).toHaveLength(patches);
					}
				}
			}).pipe(Effect.provide(w.layer())),
		);
	});
	it("p55 checkpoint plant: keep only the checkpoint or omit notes during a full rebuild", async () => {
		const {notes} = await import("./program.ts");
		const messages: Save[] = [
			{note: "a", base: 0, body: "# One\n  "},
			{note: "b", base: 0, body: "🙂\r\nשלום"},
			{note: "a", base: 1, body: ""},
		];
		const expected = messages.reduce(oracle, {notes: []} as Model),
			w = world(notes);
		let letters: ReadonlyArray<Entry> = [];
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				for (const [index, s] of messages.entries())
					expect((yield* r.msg(input(index + 1, s)))._tag).toBe("accepted");
				expect(yield* view(r)).toEqual(expected);
				letters = yield* readInbox;
			}).pipe(Effect.provide(w.layer())),
		);
		w.reopen();
		await Effect.runPromise(
			ProgramRunner.use((r) =>
				view(r).pipe(
					Effect.tap((v) =>
						Effect.sync(() => {
							expect(v).toEqual(expected);
						}),
					),
				),
			).pipe(Effect.provide(w.layer())),
		);
		for (let again = 0; again < 2; again++) {
			w.rebuild();
			await Effect.runPromise(
				Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(yield* view(r)).toEqual(expected);
					expect(yield* readInbox).toEqual(letters);
				}).pipe(Effect.provide(w.layer())),
			);
		}
	});
	it("p55 saved failure plant: skip a broken save, reset notes, or delete accepted letters", async () => {
		const {notes} = await import("./program.ts");
		const w = world(notes);
		let letters: ReadonlyArray<Entry> = [];
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				expect((yield* r.msg(input(1, {note: "a", base: 0, body: "kept"})))._tag).toBe("accepted");
				const mailbox = yield* Mailbox;
				const placed = yield* mailbox.send(
					NAME,
					letter(2),
					{type: "save", value: {note: "a", base: 1, body: null}},
					{
						by: "SHA256:person",
						for: "person-person",
						sentAt: "old-writer-clock",
						seen: 0,
						parent: null,
						traceId: TRACE,
						build: "old-build",
					},
				);
				expect(placed._tag).toBe("placed");
				letters = yield* readInbox;
			}).pipe(Effect.provide(w.layer())),
		);
		w.rebuild();
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* ProgramRunner;
				expect(yield* Effect.flip(r.open("wake"))).toMatchObject({
					_tag: "ProgramDown",
					why: "saved_letter",
				});
				expect(yield* readInbox).toEqual(letters);
			}).pipe(Effect.provide(w.layer())),
		);
	});
});
