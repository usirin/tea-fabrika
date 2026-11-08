// P17b, next/. Pure folds have an independent oracle. Read laws use the real paged ledger.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {Mailbox, type Letter} from "../coordination/mailbox.ts";
import {Archive} from "../data/archive.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {PAGE} from "../data/log.ts";
import {RecordManager} from "../data/records.ts";
import {SpanSink} from "../data/sink.ts";
import {nodeSql} from "../data/sqlite.ts";
import {Chain} from "../data/trace.ts";

const LIBRARY = "@kampus/libfabrika";
const SEED = 119120;
const LAW = {seed: SEED, numRuns: 100};
const load = (): Promise<typeof import("@kampus/libfabrika")> => import(LIBRARY);
const root = mkdtempSync("/tmp/fh.XXXX-");
const opened: DatabaseSync[] = [];
afterAll(() => {
	for (const db of opened) if (db.isOpen) db.close();
	rmSync(root, {recursive: true, force: true});
});
const database = () => {
	const db = new DatabaseSync(join(root, `${opened.length}.db`));
	opened.push(db);
	return db;
};
const id = (prefix: string, n: number): string => {
	let bits = (1_800_000_000_000n << 80n) | (7n << 76n) | (2n << 62n) | BigInt(n);
	let text = "";
	for (let i = 0; i < 26; i++) {
		text = "0123456789abcdefghjkmnpqrstvwxyz"[Number(bits & 31n)] + text;
		bits >>= 5n;
	}
	return `${prefix}_${text}`;
};
const FROM = {
	by: "SHA256:test",
	for: "person",
	sentAt: "writer clock",
	parent: null,
	seen: 0,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "chaos-test",
};
const target = fc.record({
	program: fc.constantFrom("counter" as const, "notes" as const),
	name: fc.integer({min: 1, max: 20}).map((n) => `target:${n}`),
	process: fc.integer({min: 1, max: 20}).map((n) => id("process", n)),
	client: fc.constant("client"),
	key: fc.constant("SHA256:public-test"),
});
const letters: fc.Arbitrary<ReadonlyArray<Letter>> = fc
	.array(
		fc.record({
			id: fc.integer({min: 1, max: 12}).map((n) => id("input", n)),
			pos: fc.integer({min: 1, max: 80}),
			rev: fc.integer({min: 1, max: 100_000}),
			m: fc.constantFrom({type: "inc"}, {type: "reset"}),
		}),
		{maxLength: 80},
	)
	.map((rows) => rows.map((row) => ({...FROM, ...row})));
const expected = (rows: ReadonlyArray<Letter>) => {
	const positions = new Set(rows.map((r) => r.pos));
	return {
		letters: rows.length,
		doubled: rows.length - new Set(rows.map((r) => r.id)).size,
		gaps:
			rows.length === 0 ? 0 : Math.max(...positions) - Math.min(...positions) + 1 - positions.size,
	};
};

describe("P17b nemesis laws", () => {
	it("p36 plant, count duplicate bodies or revisions: only repeated IDs count as doubled", async () => {
		const A = await load();
		fc.assert(
			fc.property(letters, (rows) => {
				expect(A.check(rows)).toEqual(expected(rows));
				const sameBody = rows.map((row) => ({...row, m: {type: "inc"}, rev: 1}));
				expect(A.check(sameBody).doubled).toBe(expected(rows).doubled);
			}),
			LAW,
		);
	});

	it("p36 plant, count from zero or global rev: gaps use the observed position interval", async () => {
		const A = await load();
		fc.assert(
			fc.property(letters, fc.integer({min: 1, max: 5000}), (rows, shift) => {
				const moved = rows.map((r, i) => ({...r, pos: r.pos + shift, rev: i * shift + 1}));
				expect(A.check(moved)).toEqual(expected(rows));
				expect(A.check([...moved, ...moved]).gaps).toBe(expected(rows).gaps);
			}),
			LAW,
		);
	});

	it("plant, no off refusal: Nemesis.none refuses both operations with typed off", async () => {
		const A = await load();
		const fault = fc.oneof(
			fc.string({minLength: 1}).map((client) => A.Fault.cases.drop_socket.make({client})),
			fc.string({minLength: 1}).map((client) => A.Fault.cases.drop_answer.make({client})),
			fc.integer({min: 1, max: 5000}).map((ms) => A.Fault.cases.delay.make({client: "client", ms})),
			fc
				.constantFrom("gateway" as const, "process" as const, "project" as const)
				.map((target) => A.Fault.cases.abort.make({target, name: "target:1"})),
			fc.constant(null).map(() => A.Fault.cases.abort_all.make({})),
			fc.constantFrom(1 as const, 3 as const).map((times) =>
				A.Fault.cases.fail_step.make({
					pid: Schema.decodeUnknownSync(A.Target.fields.process)(id("process", 1)),
					times,
				}),
			),
			fc
				.string({minLength: 1})
				.map((key) => A.Fault.cases.revoke_key.make({client: "client", key})),
		);
		await fc.assert(
			fc.asyncProperty(target, fault, fc.integer({min: 1, max: 50}), async (raw, fault, tick) => {
				await Effect.runPromise(
					Effect.gen(function* () {
						const n = yield* A.Nemesis;
						expect(
							yield* Effect.flip(
								n.fire(fault, Schema.decodeUnknownSync(A.Asked.fields.tick)(id("input", tick))),
							),
						).toMatchObject({_tag: "NemesisError", why: "off"});
						expect(
							yield* Effect.flip(n.check(Schema.decodeUnknownSync(A.Target)(raw))),
						).toMatchObject({_tag: "NemesisError", why: "off"});
					}).pipe(Effect.provide(A.Nemesis.none)),
				);
			}),
			LAW,
		);
	});

	it("plant, first page only or skip corrupt row: check reads complete target history and fails bad_row", async () => {
		const A = await load();
		await fc.assert(
			fc.asyncProperty(
				target,
				fc.integer({min: 1, max: 3}),
				fc.integer({min: 1, max: PAGE - 1}),
				fc.nat(),
				fc.boolean(),
				async (raw, pages, tail, corrupt, badPosition) => {
					const db = database();
					const data = A.Nemesis.layer.pipe(
						Layer.provideMerge(Mailbox.layer),
						Layer.provideMerge(
							Ledger.sql(nodeSql(db), {reader: "chaos-check"}).pipe(
								Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
							),
						),
					);
					await Effect.runPromise(
						Effect.gen(function* () {
							const mail = yield* Mailbox;
							const n = yield* A.Nemesis;
							const value = yield* Schema.decodeUnknownEffect(A.Target)(raw);
							const count = pages * PAGE + tail;
							for (let i = 0; i < count; i++) {
								expect(
									yield* mail.send(raw.name, id("input", i + 1), {type: "inc"}, FROM),
								).toMatchObject({_tag: "placed"});
								if (i % 17 === 0) yield* mail.send("other:1", `other-${i}`, {type: "dec"}, FROM);
							}
							const history = yield* Stream.runCollect(mail.read(raw.name, 0));
							expect(history).toHaveLength(count);
							expect((yield* n.check(value)).checked).toEqual(expected(history));
							// Corrupt a known saved row at a drawn position, including pages after the first.
							if (badPosition)
								db.prepare("UPDATE entries SET pos = ? WHERE stream = ? AND pos = ?").run(
									-1,
									`${raw.name}/inbox`,
									1 + (corrupt % count),
								);
							else
								db.prepare("UPDATE entries SET body = ? WHERE stream = ? AND pos = ?").run(
									JSON.stringify({body: "corrupt known send"}),
									`${raw.name}/inbox`,
									1 + (corrupt % count),
								);
							expect(yield* Effect.flip(n.check(value))).toMatchObject({
								_tag: "LedgerError",
								why: "bad_row",
							});
						}).pipe(Effect.provide(data)),
					);
					db.close();
				},
			),
			{...LAW, numRuns: 15},
		);
	});

	it("plant, did.ok or unrelated replacement: recovery requires an exact predecessor after the fault", async () => {
		const A = await load();
		const chain = fc.record({
			length: fc.integer({min: 2, max: 10}),
			at: fc.integer({min: 0, max: 100_000}),
			gap: fc.integer({min: 0, max: 20}),
			name: fc.integer({min: 1, max: 20}).map((n) => `target:${n}`),
		});
		fc.assert(
			fc.property(chain, fc.nat(), fc.boolean(), (draw, cut, reverse) => {
				const rows = Array.from({length: draw.length}, (_, i) =>
					Schema.decodeUnknownSync(A.RestartRow)({
						process: id("process", i + 2),
						after: id("process", i + 1),
						name: draw.name,
						why: "crashed",
						build: "chaos-test",
						arrivedAt: draw.at + i * draw.gap,
						rev: i + 1,
					}),
				);
				const hit = cut % rows.length;
				const askedAt = rows[hit]!.arrivedAt;
				const process = rows[hit]!.after;
				const unrelated = Schema.decodeUnknownSync(A.RestartRow)({
					...rows[0],
					after: id("process", 500),
					name: "unrelated",
					arrivedAt: askedAt,
				});
				const before = Schema.decodeUnknownSync(A.RestartRow)({
					...rows[hit],
					arrivedAt: askedAt - 1,
					rev: 100,
				});
				const later = Schema.decodeUnknownSync(A.RestartRow)({
					...rows[hit],
					arrivedAt: askedAt + draw.gap + 1,
					rev: 200,
				});
				const tied = Schema.decodeUnknownSync(A.RestartRow)({...rows[hit], rev: 201});
				const all = [...rows, later, tied, unrelated, before];
				expect(A.recoveredAt(process, askedAt, reverse ? all.reverse() : all)).toBe(askedAt);
				expect(A.recoveredAt(process, askedAt, [unrelated, before])).toBeNull();
				expect(A.recoveredAt(process, askedAt, [])).toBeNull();
			}),
			LAW,
		);
	});

	it("plant, missing ended spans or text tags: real check and off refusals reach P37 without bodies", async () => {
		const A = await load();
		await fc.assert(
			fc.asyncProperty(
				target,
				fc.integer({min: 1, max: 20}),
				fc.uuid(),
				fc.boolean(),
				async (raw, count, nonce, off) => {
					const db = database();
					const marker = `private-body-${nonce}`;
					const ledger = Ledger.sql(nodeSql(db), {reader: "chaos-records"}).pipe(
						Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
					);
					const services = (off ? A.Nemesis.none : A.Nemesis.layer).pipe(
						Layer.provideMerge(Mailbox.layer),
						Layer.provideMerge(ledger),
					);
					const sink = Layer.mergeAll(
						SpanSink.layer(nodeSql(db), {object: "chaos-check"}),
						RecordManager.memory(1024 ** 3),
						Archive.memory,
					);
					await Effect.runPromise(
						Effect.gen(function* () {
							const mail = yield* Mailbox;
							for (let i = 0; i < count; i++)
								yield* mail.send(raw.name, id("input", i + 1), {body: marker}, FROM);
							const value = yield* Schema.decodeUnknownEffect(A.Target)(raw);
							const result = yield* A.Nemesis.use((n) => n.check(value)).pipe(Effect.result);
							expect(result._tag).toBe(off ? "Failure" : "Success");
							if (off) {
								const refused = yield* A.Nemesis.use((n) =>
									n.fire(
										A.Fault.cases.drop_answer.make({client: raw.client}),
										Schema.decodeUnknownSync(A.Asked.fields.tick)(id("input", count + 1)),
									),
								).pipe(Effect.result);
								expect(refused).toMatchObject({_tag: "Failure", failure: {why: "off"}});
							}
							// Each Effect has ended before flush. The stored JobRecord is the evidence.
							yield* SpanSink.use((s) => s.flush);
							const rows = yield* RecordManager.use((r) =>
								Stream.runCollect(r.read(Chain.cases.spans.make({}))),
							);
							const checks = rows.filter((r) => r.name === "nemesis.check");
							expect(checks).toHaveLength(1);
							expect(rows.filter((r) => r.name === "nemesis.fire")).toHaveLength(off ? 1 : 0);
							const tags = checks[0]!.attributes;
							expect(Object.values(tags)).toContain(raw.name);
							if (off) expect(Object.values(tags)).toContain("off");
							else
								expect(tags).toMatchObject({
									"fab.nemesis.letters": count,
									"fab.nemesis.doubled": 0,
									"fab.nemesis.gaps": 0,
								});
							for (const row of rows)
								expect(
									JSON.stringify({tags: row.attributes, events: row.events, links: row.links}),
								).not.toContain(marker);
							const health = db.prepare("SELECT * FROM health").all();
							expect(JSON.stringify(health)).not.toContain(marker);
						}).pipe(Effect.provide(Layer.mergeAll(services, sink))),
					);
					db.close();
				},
			),
			{...LAW, numRuns: 15},
		);
	});
});
