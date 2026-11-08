// P13, next/. Runner spans must already be in P37 when an answer returns. No manual flush here.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {
	Alarm,
	CheckedWriter,
	Id,
	type Incoming,
	ProgramLoader,
	ProgramRunner,
	Recording,
	WatcherManager,
	type Program,
} from "@kampus/libfabrika";
import {Mailbox, ProcessStore, Writer} from "@kampus/libfabrika/coordination";
import {
	Archive,
	Chain,
	Doorbell,
	Ledger,
	LedgerError,
	RecordManager,
	SpanSink,
} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Effect, Layer, Stream} from "effect";
import * as fc from "fast-check";
import {afterAll, describe, expect, it} from "vitest";

const NOTES = "@kampus/notes";
const PROCESS = Id.make("process").make("process_0000000000e008000000000001");
const options = {seed: 119120, numRuns: 6};
const InputId = Id.make("input");
const inputIds = fc.uuid({version: 7}).map((uuid) => {
	let bits = BigInt(`0x${uuid.replaceAll("-", "")}`),
		text = "";
	for (let n = 0; n < 26; n++) {
		text = "0123456789abcdefghjkmnpqrstvwxyz"[Number(bits & 31n)] + text;
		bits >>= 5n;
	}
	return InputId.make(`input_${text}`);
});
const letters = fc.sample(inputIds, {seed: options.seed, numRuns: 80});
const BODY = "accepted-body-marker-8af2",
	DRAFT = "refused-body-marker-93b7";
const folder = mkdtempSync("/tmp/fh.");
const databases: DatabaseSync[] = [];
afterAll(() => {
	for (const db of databases) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
let serial = 0;
const disk = () => {
	const db = new DatabaseSync(join(folder, `${++serial}.db`));
	databases.push(db);
	return db;
};
const allText = (db: DatabaseSync) => {
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
	return tables.flatMap(({name}) =>
		db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all(),
	);
};
const world = (program: Program) => {
	const state = disk(),
		ledger = disk(),
		sink = disk(),
		records = new Map<string, DatabaseSync>();
	const recordManager = RecordManager.sql((name) => {
		let db = records.get(name);
		if (db === undefined) {
			db = disk();
			records.set(name, db);
		}
		return nodeSql(db);
	}, 100_000_000);
	const monitor = Layer.mergeAll(
		SpanSink.layer(nodeSql(sink), {object: PROCESS}),
		recordManager,
		Archive.memory,
	);
	const data = Ledger.sql(nodeSql(ledger), {reader: "p13-recording"}).pipe(
		Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
	);
	const by = Writer.cases.person.make({key: "SHA256:person", for: "person"});
	const checked = Layer.effect(
		CheckedWriter,
		Effect.gen(function* () {
			const mail = yield* Mailbox;
			return {
				append: (i: typeof Incoming.Type) =>
					mail.send("notes:1", i.id, i.envelope.input, {
						by: i.envelope.by.key,
						for: i.envelope.by.for,
						parent: i.envelope.id,
						sentAt: i.sentAt,
						seen: i.seen,
						traceId: i.span.traceId,
						build: "notes-build",
					}),
				own: () => Effect.die("no Cmds"),
				commit: () => Effect.die("no Cmds"),
			};
		}),
	);
	const fault = {recording: false};
	const recording = Layer.effect(
		Recording,
		Effect.gen(function* () {
			const actual = yield* Recording;
			return {
				flush: Effect.suspend(() =>
					fault.recording ? Effect.fail(new LedgerError({why: "storage"})) : actual.flush,
				),
			};
		}),
	).pipe(Layer.provide(Recording.layer));
	const layer = () =>
		ProgramRunner.layer({
			id: PROCESS,
			name: "notes:1",
			program: "notes",
			build: "notes-build",
			owner: by,
		}).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					ProgramLoader.layer({notes: program}, {}),
					ProcessStore.layer(nodeSql(state), {process: PROCESS}),
					checked,
					Layer.succeed(WatcherManager, {publish: () => Effect.void}),
					Layer.succeed(Alarm, {set: () => Effect.void}),
					recording,
				).pipe(
					Layer.provideMerge(Layer.merge(Mailbox.layer.pipe(Layer.provideMerge(data)), monitor)),
				),
			),
		);
	const incoming = (n: number, base: number, body: string) => ({
		id: letters[n - 1]!,
		envelope: {
			id: letters[n + 39]!,
			by,
			arrivedAt: n,
			input: {type: "save", value: {note: "a", base, body}},
		},
		sentAt: "writer-clock",
		seen: 0,
		span: {traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7"},
	});
	const rows = RecordManager.use((r) =>
		Stream.runCollect(r.read(Chain.cases.job.make({process: PROCESS}))),
	);
	return {layer, incoming, rows, state, sink, records, fault};
};

describe("P13 notes recording", () => {
	it("recording plant: omit outcomes or flush before runner.step ends; leak saved/refused text", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.string({maxLength: 60}),
				fc.string({maxLength: 60}),
				async (saved, draft) => {
					const {notes} = await import(NOTES),
						w = world(notes);
					await Effect.runPromise(
						Effect.gen(function* () {
							const r = yield* ProgramRunner;
							const first = w.incoming(1, 0, BODY + saved);
							const answers = [
								yield* r.msg(first),
								yield* r.msg(first),
								yield* r.msg(w.incoming(2, 0, DRAFT + draft)),
								yield* r.msg(w.incoming(3, 1, DRAFT + draft + "x".repeat(256 * 1024))),
							];
							expect(answers.map((a) => a._tag)).toEqual([
								"accepted",
								"accepted",
								"refused",
								"refused",
							]);
							const spans = (yield* w.rows).filter((row) => row.name === "runner.step");
							expect(spans).toHaveLength(4);
							expect(spans.map((row) => row.attributes["fab.runner.answer"])).toEqual([
								"accepted",
								"duplicate",
								"refused",
								"refused",
							]);
							expect(spans[2]!.attributes).toMatchObject({
								"fab.runner.why": "changed_elsewhere",
								"fab.runner.now": 1,
							});
							expect(spans[3]!.attributes).toMatchObject({
								"fab.runner.why": "too_long",
								"fab.runner.most": 256 * 1024,
							});
							for (const row of spans) {
								expect(row.ok).toBe(true);
								expect(BigInt(row.endTimeUnixNano)).toBeGreaterThanOrEqual(
									BigInt(row.startTimeUnixNano),
								);
							}
							expect(w.sink.prepare("SELECT count(*) AS n FROM unsent").get()?.n).toBe(0);
							const content = JSON.stringify([
								...allText(w.sink),
								...[...w.records.values()].flatMap(allText),
							]);
							expect(content).not.toContain(BODY);
							expect(content).not.toContain(DRAFT);
							const checkpoint = JSON.stringify(allText(w.state));
							expect(checkpoint).not.toContain(DRAFT);
							const replies = allText(w.state)
								.flatMap((row) => Object.values(row))
								.filter((value) => typeof value === "string" && value.includes('"answer"'));
							expect(replies).toHaveLength(2);
							expect(JSON.stringify(replies)).not.toContain(BODY);
							expect(JSON.stringify(replies)).not.toContain(DRAFT);
						}).pipe(Effect.provide(w.layer())),
					);
				},
			),
			options,
		);
	});
	it("recording replay plant: label a checkpoint as a full fold or omit replay count/cursor/timing", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: 10}), async (count) => {
				const {notes} = await import(NOTES),
					w = world(notes);
				await Effect.runPromise(
					Effect.gen(function* () {
						const r = yield* ProgramRunner;
						for (let n = 1; n <= count; n++) yield* r.msg(w.incoming(n, n - 1, `${BODY}-${n}`));
					}).pipe(Effect.provide(w.layer())),
				);
				const sample = (folded: number) =>
					Effect.gen(function* () {
						const before = yield* w.rows;
						const inbox = yield* Ledger.use((l) => Stream.runCollect(l.read("notes:1/inbox", 0)));
						const cursor = inbox.at(-1)!.rev;
						yield* (yield* ProgramRunner).open("wake");
						const known = new Set(before.map((row) => row.spanId));
						const replays = (yield* w.rows).filter(
							(row) => row.name === "runner.replay" && !known.has(row.spanId),
						);
						expect(replays).toHaveLength(1);
						const replay = replays[0]!;
						expect(replay.attributes).toMatchObject({
							"fab.runner.replayed": folded,
							"fab.runner.after": folded === 0 ? cursor : 0,
						});
						expect(BigInt(replay.endTimeUnixNano)).toBeGreaterThanOrEqual(
							BigInt(replay.startTimeUnixNano),
						);
						expect(replay.attributes["fab.runner.duration_ms"]).toEqual(expect.any(Number));
						expect(JSON.stringify(replay)).not.toContain(BODY);
					});
				await Effect.runPromise(sample(0).pipe(Effect.provide(w.layer())));
				w.state.prepare("DELETE FROM process_state WHERE process=?").run(PROCESS);
				await Effect.runPromise(sample(count).pipe(Effect.provide(w.layer())));
			}),
			options,
		);
	});
	it("recording failure plant: return success after a required flush fails on accepted, duplicate or refused input", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("accepted", "duplicate", "refused"),
				fc.string({maxLength: 40}),
				async (outcome, body) => {
					const {notes} = await import(NOTES),
						w = world(notes);
					await Effect.runPromise(
						Effect.gen(function* () {
							const r = yield* ProgramRunner;
							const first = w.incoming(1, 0, BODY + body);
							if (outcome === "duplicate") expect((yield* r.msg(first))._tag).toBe("accepted");
							w.fault.recording = true;
							const error = yield* Effect.flip(
								r.msg(outcome === "refused" ? w.incoming(2, 9, DRAFT + body) : first),
							);
							expect(error).toMatchObject({_tag: "LedgerError", why: "storage"});
							w.fault.recording = false;
							const answer = yield* r.msg(
								outcome === "refused" ? w.incoming(2, 9, DRAFT + body) : first,
							);
							expect(answer._tag).toBe(outcome === "refused" ? "refused" : "accepted");
							const inbox = yield* Ledger.use((l) => Stream.runCollect(l.read("notes:1/inbox", 0)));
							expect(inbox).toHaveLength(outcome === "refused" ? 0 : 1);
							expect(
								JSON.stringify([...allText(w.sink), ...[...w.records.values()].flatMap(allText)]),
							).not.toContain(DRAFT);
						}).pipe(Effect.provide(w.layer())),
					);
				},
			),
			options,
		);
	});
});
