import {Buffer} from "node:buffer";
// p100 and p102 (P37's plan writes them out; the lead commit adds them to docs/plan/tier-1-detail.md,
// "Properties"), for `data/records.ts`: a record part's logic, the one code `job/<process>/<part>`
// and `spans/<part>` both run. From "design for bounded objects" (owner, 2026-11-07) and "an agent
// run keeps its content". Written before the module (Tier 1, P37, ticket 238).
//
// The shape these tests hold the module to, from the plan's `records.ts` sketch:
// - `RecordManager.write(chain, part, rows)` answers `{_tag: "written"}` or
//   `{_tag: "rolled", next, had}`. In one step it (1) drops the rows whose span id this part holds,
//   (2) answers `written` when none are left, (3) when the part has a `rolled` row, or its size is at
//   or past the cap, writes `rolled` once if it is missing and answers it, with `had` naming the
//   batch's span ids this part already holds, and (4) else writes the rows and answers `written`.
// - A part's name is `job/<process>/<part>` or `spans/<part>`, counting from 0; `next` is the next
//   part's name. `RecordManager.sql(open, cap)` opens each part by that name.
// - `read(chain)` walks part 0, then each `rolled.next`, and yields every span once, in write order.
// - `content(chain, spanId)` is none, `{_tag: "kept", spanId, message}`, or
//   `{_tag: "deleted", spanId, by, at, why}`; `at` is the Clock's ms. `deleteContent` looks in every
//   part, and a second delete changes nothing. Nothing but content is ever deleted.
// - A part's tables in `RecordManager.sql`: `spans`, `content` and `rolled` (at most one row).
// - `RecordManager.remote(stub)` asks `stub(name)` for the part's object; a call that rejects is
//   `unreachable`, an answer that does not decode `bad_row`. Its calls' names are the builder's, so
//   the stub here answers any method.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, beforeEach, describe, expect, it} from "@effect/vitest";
import type {Layer} from "effect";
import {Arbitrary, Effect, Option, Schema, Stream} from "effect";
import {TestClock} from "effect/testing";
import {processId, processIds} from "../id.test-support.ts";
import {TraceId} from "./log.ts";
import {RecordManager, type RecordCalls} from "./records.ts";
import type {Sql} from "./referee.ts";
import {SinkError} from "./sink.ts";
import {nodeSql} from "./sqlite.ts";
import type {Chain, SpanRow} from "./trace.ts";

type ChainValue = typeof Chain.Type;
type Row = typeof SpanRow.Type;

const folder = mkdtempSync(join(tmpdir(), "p37-records-"));
const opened: Array<DatabaseSync> = [];
let homes = 0;
afterAll(() => {
	for (const db of opened.splice(0)) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});

/** One home of part files: `open(name)` gives the same node:sqlite file each time it is asked. */
const home = () => {
	const prefix = `home-${++homes}`;
	const dbs = new Map<string, DatabaseSync>();
	const asked: Array<string> = [];
	const db = (name: string): DatabaseSync => {
		const known = dbs.get(name);
		if (known !== undefined) return known;
		const made = new DatabaseSync(join(folder, `${prefix}-${name.replaceAll("/", "_")}.db`));
		opened.push(made);
		dbs.set(name, made);
		return made;
	};
	const sqls = new Map<string, Sql>();
	const open = (name: string): Sql => {
		asked.push(name);
		const known = sqls.get(name);
		if (known !== undefined) return known;
		const made = nodeSql(db(name));
		sqls.set(name, made);
		return made;
	};
	const rows = (name: string, table: string): Array<Record<string, unknown>> =>
		dbs.has(name)
			? (db(name).prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>)
			: [];
	return {open, asked, rows, names: () => [...dbs.keys()]};
};

const PROCESS = Effect.runSync(processId);
const job: ChainValue = {_tag: "job", process: PROCESS};
const spans: ChainValue = {_tag: "spans"};
const part = (n: number) => `job/${PROCESS}/${n}`;

/** A span row; `fill` pads one tag so a part reaches a small cap in a few rows. */
const row = (spanId: string, fill = 0): Row => ({
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	spanId,
	parentSpanId: null,
	name: "runner.step",
	kind: "internal",
	startTimeUnixNano: "1792713600000000000",
	endTimeUnixNano: "1792713600004000000",
	attributes: {
		"fab.process": PROCESS,
		"fab.letter.id": "m-17",
		...(fill > 0 ? {"fab.fill": "f".repeat(fill)} : {}),
	},
	events: [],
	links: [],
	resource: {attributes: {"fab.object": PROCESS}},
	ok: true,
});
const id = (n: number) => `s${String(n).padStart(15, "0")}`;
const originalRow = row;

const CAP = 64 * 1024;
const FILL = 2000;

const read = (chain: ChainValue) =>
	RecordManager.use((records) => Stream.runCollect(records.read(chain)));

/** Sends rows as the sink would: to `from`, then on to each `rolled.next` with what is left. */
const send = (
	chain: ChainValue,
	from: number,
	rows: ReadonlyArray<{span: Row; content: string | null}>,
) =>
	Effect.gen(function* () {
		const records = yield* RecordManager;
		let at = from;
		let left = rows;
		for (let hops = 0; hops < 64; hops++) {
			const answer = yield* records.write(chain, at, left);
			if (answer._tag === "written") return at;
			const had = new Set(answer.had);
			left = left.filter((r) => !had.has(r.span.spanId));
			at += 1;
			expect(answer.next).toBe(chain._tag === "job" ? `job/${chain.process}/${at}` : `spans/${at}`);
		}
		return yield* Effect.die(new Error("more than 64 rolls for one batch"));
	});

const kept = (span: Row, content: string | null = null) => ({span, content});

type Backend = {
	readonly name: string;
	readonly make: (cap: number) => {
		layer: Layer.Layer<RecordManager>;
		parts?: ReturnType<typeof home>;
	};
};
const backends: ReadonlyArray<Backend> = [
	{name: "memory", make: (cap) => ({layer: RecordManager.memory(cap)})},
	{
		name: "sql",
		make: (cap) => {
			const parts = home();
			return {layer: RecordManager.sql(parts.open, cap), parts};
		},
	},
];

const N = (minimum: number, maximum: number) =>
	Schema.Int.check(Schema.isBetween({minimum, maximum}));
const text = (minLength: number, maxLength: number) =>
	Arbitrary.array(Arbitrary.schema(N(0, 65535)), {minLength, maxLength}).pipe(
		Arbitrary.map((units) => Buffer.from(String.fromCharCode(...units), "utf8").toString("utf8")),
	);
const tag: Arbitrary.Arbitrary<string | number | boolean> = Arbitrary.schema(N(0, 2)).pipe(
	Arbitrary.flatMap((n): Arbitrary.Arbitrary<string | number | boolean> =>
		n === 0
			? text(0, 400)
			: n === 1
				? Arbitrary.schema(Schema.Finite).pipe(Arbitrary.map((n) => (Object.is(n, -0) ? 0 : n)))
				: Arbitrary.schema(Schema.Boolean),
	),
);
const tags = Arbitrary.array(Arbitrary.all({key: text(0, 64), value: tag}), {
	minLength: 0,
	maxLength: 8,
}).pipe(Arbitrary.map((pairs) => Object.fromEntries(pairs.map(({key, value}) => [key, value]))));
const trace = Arbitrary.schema(TraceId);
const spanId = Arbitrary.schema(Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/))).pipe(
	Arbitrary.filter((id) => id !== "0".repeat(16)),
);
const events = Arbitrary.array(
	Arbitrary.all({name: text(1, 256), at: Arbitrary.schema(N(0, 4102444800000)), attributes: tags}),
	{minLength: 0, maxLength: 8},
).pipe(
	Arbitrary.map((events) =>
		events.map(({at, ...event}) => ({...event, timeUnixNano: String(BigInt(at) * 1000000n)})),
	),
);
const links = Arbitrary.array(Arbitrary.all({traceId: trace, spanId, attributes: tags}), {
	minLength: 0,
	maxLength: 8,
});
const Inputs = Arbitrary.all({
	process: processIds,
	trace,
	name: text(1, 256),
	kind: Arbitrary.schema(Schema.Literals(["internal", "server", "client", "producer", "consumer"])),
	at: Arbitrary.schema(N(0, 4102444800000)),
	duration: Arbitrary.schema(N(0, 900)),
	message: text(0, 256),
	part: Arbitrary.schema(N(0, 8)),
	made: Arbitrary.schema(N(501, 1501)),
	attributes: tags,
	events,
	links,
	object: text(1, 256),
	parent: Arbitrary.schema(Schema.Boolean).pipe(
		Arbitrary.flatMap((own): Arbitrary.Arbitrary<string | null> =>
			own ? Arbitrary.Constant(null) : spanId,
		),
	),
	ok: Arbitrary.schema(Schema.Boolean),
	idBase: spanId,
	cap: Arbitrary.schema(N(1, 131072)),
	total: Arbitrary.schema(N(1, 200)),
	batch: Arbitrary.schema(N(1, 100)),
	retries: Arbitrary.schema(N(0, 8)),
	by: text(0, 256),
	why: text(0, 256),
	delta: Arbitrary.schema(N(0, 60000)),
});
type Detail = {
	cap: number;
	total: number;
	batch: number;
	retries: number;
	by: string;
	why: string;
	delta: number;
};
const oldDetail: Detail = {
	cap: CAP,
	total: 80,
	batch: 40,
	retries: 3,
	by: "owner",
	why: "a note's text was in the message",
	delta: 60000,
};
const law = (
	name: string,
	check: (
		row: (spanId: string, fill?: number) => Row,
		id: (n: number) => string,
		job: ChainValue,
		part: (n: number) => string,
		T: number,
		MESSAGE: string,
		made: number,
		start: number,
		detail: Detail,
	) => Effect.Effect<unknown, unknown>,
	runs = 60,
) =>
	describe(name, () => {
		const close = Effect.sync(() => {
			for (const db of opened.splice(0)) if (db.isOpen) db.close();
		});
		beforeEach(() =>
			Effect.runPromise(
				Effect.suspend(() => check(row, id, job, part, T, MESSAGE, 1201, 2, oldDetail)).pipe(
					Effect.provide(TestClock.layer()),
					Effect.ensuring(close),
				),
			),
		);
		it.effect.prop(
			name,
			{input: Inputs},
			({input}) =>
				Effect.suspend(() => {
					// Chain's job branch has an opaque ProcessId filter; draw the full-clock process explicitly.
					const job: ChainValue = {_tag: "job", process: input.process};
					const id = (n: number) =>
						(((BigInt(`0x${input.idBase}`) + BigInt(n)) % ((1n << 64n) - 1n)) + 1n)
							.toString(16)
							.padStart(16, "0");
					const base = (spanId: string, fill = 0): Row => ({
						...row(spanId, fill),
						traceId: input.trace,
						name: input.name,
						kind: input.kind,
						parentSpanId: input.parent,
						startTimeUnixNano: String(BigInt(input.at) * 1000000n),
						endTimeUnixNano: String(BigInt(input.at + input.duration) * 1000000n),
						attributes: {
							...Object.fromEntries(Object.entries(input.attributes).slice(0, fill > 0 ? 7 : 8)),
							...(fill > 0 ? {"fab.fill": "f".repeat(fill)} : {}),
						},
						events: input.events,
						links: input.links,
						ok: input.ok,
						resource: {attributes: {"fab.object": input.object}},
					});
					return check(
						base,
						id,
						job,
						(n) => `job/${input.process}/${n}`,
						input.at,
						input.message,
						input.made,
						input.part,
						input,
					);
				}).pipe(Effect.ensuring(close)),
			{arbitrary: {seed: 119120, runs, size: 4096}, timeout: 60000},
		);
	});

describe.each(backends)(
	"p102, a record rolls and never fills, on RecordManager.$name",
	(backend) => {
		law(
			"rows past the cap go to the next part; read walks every part, each span once, in write order",
			(row, id, job, part, _T, _MESSAGE, _made, _start, detail) => {
				// SQLite's existing 64 KiB flow fixture leaves space for its tables. Tiny caps have their own refusal law below.
				const CAP = backend.name === "sql" ? Math.max(65536, detail.cap) : detail.cap;
				const {layer, parts} = backend.make(CAP);
				return Effect.gen(function* () {
					let at = 0;
					const used = new Set<number>();
					for (let n = 0; n < detail.total; n++) {
						at = yield* send(job, at, [kept(row(id(n), FILL))]);
						used.add(at);
					}
					if ((detail.total - 1) * FILL >= CAP)
						expect(
							used.size,
							"80 rows of about 2 KB under a 64 KB cap need more than one part",
						).toBeGreaterThan(1);
					const all = yield* read(job);
					expect(all.map((r) => r.spanId)).toEqual(
						Array.from({length: detail.total}, (_, n) => id(n)),
					);
					if (parts !== undefined) {
						for (const p of [...used].sort((x, y) => x - y).slice(0, -1)) {
							const rolled = parts.rows(part(p), "rolled");
							expect(rolled, `${part(p)} keeps one rolled row`).toHaveLength(1);
							const values = Object.values(rolled[0] ?? {});
							expect(values, "rolled names the next part").toContain(part(p + 1));
							expect(
								values.some((v) => typeof v === "number" && v >= CAP),
								"rolled keeps the part's size then, at or past the cap",
							).toBe(true);
						}
					}
				}).pipe(Effect.provide(layer));
			},
		);

		law(
			"a rolled part accepts no new span, and keeps one rolled row however often it is asked",
			(row, id, job, part, _T, _MESSAGE, _made, _start, detail) => {
				const CAP = backend.name === "sql" ? Math.max(65536, detail.cap) : detail.cap;
				const {layer, parts} = backend.make(CAP);
				return Effect.gen(function* () {
					const records = yield* RecordManager;
					let n = 0;
					let answer = yield* records.write(job, 0, [kept(row(id(n++), FILL))]);
					while (answer._tag === "written" && n < 200)
						answer = yield* records.write(job, 0, [kept(row(id(n++), FILL))]);
					expect(answer).toEqual({_tag: "rolled", next: part(1), had: []});
					const held = n - 1;
					for (let again = 0; again < detail.retries; again++) {
						expect(yield* records.write(job, 0, [kept(row(id(1000 + again)))])).toEqual({
							_tag: "rolled",
							next: part(1),
							had: [],
						});
					}
					if (parts !== undefined) {
						expect(parts.rows(part(0), "spans")).toHaveLength(held);
						expect(parts.rows(part(0), "rolled")).toHaveLength(1);
					}
					yield* send(job, 1, [
						kept(row(id(n - 1))),
						kept(row(id(1000))),
						kept(row(id(1001))),
						kept(row(id(1002))),
					]);
					const all = (yield* read(job)).map((r) => r.spanId);
					expect(all).toHaveLength(held + 4);
					expect(new Set(all).size).toBe(all.length);
				}).pipe(Effect.provide(layer));
			},
		);

		law(
			"a resend after the roll lands nowhere twice: held rows answer written, a mixed batch names them in had",
			(row, id, job, _part, _T, _MESSAGE, _made, _start, detail) => {
				const CAP = backend.name === "sql" ? Math.max(65536, detail.cap) : detail.cap;
				const {layer} = backend.make(CAP);
				return Effect.gen(function* () {
					const records = yield* RecordManager;
					const length = Math.max(detail.batch, Math.ceil(CAP / FILL) + 1);
					const first = Array.from({length}, (_, n) => kept(row(id(n), FILL)));
					// One batch may take a part past its cap: the check is before the write, so it lands whole.
					expect(yield* records.write(job, 0, first)).toEqual({_tag: "written"});
					// A full resend: every row is held, so nothing is left and nothing is written.
					expect(yield* records.write(job, 0, first)).toEqual({_tag: "written"});
					// A lost answer: the batch comes again with one new row. Part 0 is past its cap.
					const cut = Math.max(0, length - 10);
					const again = [...first.slice(cut), kept(row(id(length)))];
					const answer = yield* records.write(job, 0, again);
					expect(answer._tag).toBe("rolled");
					if (answer._tag === "rolled") {
						expect([...answer.had].sort()).toEqual(
							first
								.slice(cut)
								.map((r) => r.span.spanId)
								.sort(),
						);
					}
					yield* send(job, 0, again);
					const all = (yield* read(job)).map((r) => r.spanId);
					expect(all).toEqual(Array.from({length: length + 1}, (_, n) => id(n)));
				}).pipe(Effect.provide(layer));
			},
		);

		law(
			"read pages past 500 spans in one part, each span once, in write order",
			(row, id, job, _part, _T, _MESSAGE, made) => {
				const {layer} = backend.make(1024 * 1024 * 1024);
				return Effect.gen(function* () {
					const records = yield* RecordManager;
					for (let from = 0; from < made; from += 100) {
						const batch = Array.from({length: Math.min(100, made - from)}, (_, n) =>
							kept(row(id(from + n))),
						);
						expect(yield* records.write(job, 0, batch)).toEqual({_tag: "written"});
					}
					expect((yield* read(job)).map((r) => r.spanId)).toEqual(
						Array.from({length: made}, (_, n) => id(n)),
					);
				}).pipe(Effect.provide(layer));
			},
			10,
		);

		law(
			"spans/<part> rolls by the same code, and a chain with no write reads empty",
			(row, id, job, _part, _T, _MESSAGE, _made, _start, detail) => {
				const CAP = backend.name === "sql" ? Math.max(65536, detail.cap) : detail.cap;
				const total = row === originalRow ? 60 : detail.total;
				const {layer, parts} = backend.make(CAP);
				return Effect.gen(function* () {
					expect(yield* read(spans)).toEqual([]);
					let at = 0;
					for (let n = 0; n < total; n++) at = yield* send(spans, at, [kept(row(id(n), FILL))]);
					if ((total - 1) * FILL >= CAP) expect(at).toBeGreaterThan(0);
					expect((yield* read(spans)).map((r) => r.spanId)).toEqual(
						Array.from({length: total}, (_, n) => id(n)),
					);
					expect(yield* read(job)).toEqual([]);
					if (parts !== undefined) {
						expect(
							parts.asked
								.filter((name) => name.startsWith("spans/"))
								.every((name) => /^spans\/\d+$/.test(name)),
						).toBe(true);
						expect(parts.names()).toContain("spans/0");
						if ((total - 1) * FILL >= CAP) expect(parts.names()).toContain("spans/1");
					}
				}).pipe(Effect.provide(layer));
			},
		);
	},
);

describe("p102, the cap is checked before the write (RecordManager.sql)", () => {
	law("a part already at its cap writes rolled and none of the batch", (row, id, job, part) => {
		const parts = home();
		return Effect.gen(function* () {
			yield* RecordManager.use((records) =>
				records.write(
					job,
					0,
					Array.from({length: 5}, (_, n) => kept(row(id(n), FILL))),
				),
			).pipe(Effect.provide(RecordManager.sql(parts.open, 1024 * 1024 * 1024)));
			// The same files under a cap the part is already past.
			const answer = yield* RecordManager.use((records) =>
				records.write(job, 0, [kept(row(id(5)))]),
			).pipe(Effect.provide(RecordManager.sql(parts.open, 1)));
			expect(answer).toEqual({_tag: "rolled", next: part(1), had: []});
			expect(parts.rows(part(0), "spans")).toHaveLength(5);
			expect(parts.rows(part(0), "rolled")).toHaveLength(1);
		});
	});

	law("a part's Sql that throws answers storage, and writes nothing", (row, id, job) => {
		const throwing: Sql = {
			exec: () => {
				throw Object.assign(new Error("database or disk is full"), {errcode: 13});
			},
			transaction: () => {
				throw Object.assign(new Error("database or disk is full"), {errcode: 13});
			},
			size: () => 0,
		};
		return Effect.gen(function* () {
			const error = yield* Effect.flip(
				RecordManager.use((records) => records.write(job, 0, [kept(row(id(0)))])),
			);
			expect(error).toBeInstanceOf(SinkError);
			expect(error.why).toBe("storage");
		}).pipe(Effect.provide(RecordManager.sql(() => throwing, CAP)));
	});
});

const T = Date.UTC(2026, 10, 7, 22, 0, 0, 20);
const MESSAGE = "TypeError: note-body-p100 was not a function\n    at step (counter.ts:12:3)";

describe.each(backends)(
	"p100, content is the one deletable part, on RecordManager.$name",
	(backend) => {
		law(
			"deleteContent keeps who, when and why; the span row stays as it was; a second delete changes nothing",
			(row, id, job, part, T, MESSAGE, _made, _start, detail) => {
				const by = detail.by,
					why = detail.why;
				const {layer, parts} = backend.make(CAP);
				return Effect.gen(function* () {
					const records = yield* RecordManager;
					const failed = {
						...row(id(0)),
						ok: false,
						attributes: {...row(id(0)).attributes, "error.type": "TypeError"},
					};
					yield* records.write(job, 0, [kept(failed, MESSAGE), kept(row(id(1)))]);
					expect(yield* records.content(job, id(0))).toEqual(
						Option.some({_tag: "kept", spanId: id(0), message: MESSAGE}),
					);
					expect(yield* records.content(job, id(1))).toEqual(Option.none());
					const before = yield* read(job);
					const rawBefore = parts?.rows(part(0), "spans");

					yield* TestClock.setTime(T);
					yield* records.deleteContent(job, id(0), {by, why});
					const deleted = {
						_tag: "deleted",
						spanId: id(0),
						by,
						at: T,
						why,
					};
					expect(yield* records.content(job, id(0))).toEqual(Option.some(deleted));

					yield* TestClock.setTime(T + detail.delta);
					yield* records.deleteContent(job, id(0), {by: "someone-else", why: "again"});
					expect(yield* records.content(job, id(0))).toEqual(Option.some(deleted));

					expect(yield* read(job)).toEqual(before);
					if (parts !== undefined) {
						expect(parts.rows(part(0), "spans")).toEqual(rawBefore);
						const content = JSON.stringify(parts.rows(part(0), "content"));
						if (row === originalRow) {
							expect(content).not.toContain("note-body-p100");
							expect(content).toContain("owner");
						}
						expect(
							parts.rows(part(0), "content").map((row) => [row["message"], row["by"], row["why"]]),
						).toEqual([[null, by, why]]);
					}
				}).pipe(Effect.provide(layer));
			},
		);

		law(
			"write of a known span id changes nothing: not its row, not its content, not a deletion",
			(row, id, job, _part, _T, MESSAGE) => {
				const {layer} = backend.make(CAP);
				return Effect.gen(function* () {
					const records = yield* RecordManager;
					const first = {...row(id(0)), ok: false};
					yield* records.write(job, 0, [kept(first, MESSAGE)]);
					const other = {...row(id(0)), name: "overwritten", attributes: {"fab.other": 1}};
					expect(yield* records.write(job, 0, [kept(other, "another message")])).toEqual({
						_tag: "written",
					});
					expect(yield* read(job)).toEqual([first]);
					expect(yield* records.content(job, id(0))).toEqual(
						Option.some({_tag: "kept", spanId: id(0), message: MESSAGE}),
					);
					yield* records.deleteContent(job, id(0), {by: "owner", why: "private"});
					yield* records.write(job, 0, [kept(first, MESSAGE)]);
					const after = yield* records.content(job, id(0));
					expect(Option.map(after, (c) => c._tag)).toEqual(Option.some("deleted"));
					expect(yield* read(job)).toEqual([first]);
				}).pipe(Effect.provide(layer));
			},
		);

		law(
			"a delete finds its span in an older part, after the chain rolled",
			(row, id, job, _part, T, MESSAGE, _made, _start, detail) => {
				const CAP = backend.name === "sql" ? Math.max(65536, detail.cap) : detail.cap;
				const total = row === originalRow ? 60 : Math.max(detail.total, Math.ceil(CAP / FILL) + 2);
				const by = detail.by,
					why = row === originalRow ? "private" : detail.why;
				const {layer} = backend.make(CAP);
				return Effect.gen(function* () {
					const records = yield* RecordManager;
					yield* records.write(job, 0, [kept({...row(id(0)), ok: false}, MESSAGE)]);
					let at = 0;
					for (let n = 1; n < total; n++) at = yield* send(job, at, [kept(row(id(n), FILL))]);
					expect(at, "the chain rolled past part 0").toBeGreaterThan(0);
					yield* TestClock.setTime(T);
					yield* records.deleteContent(job, id(0), {by, why});
					expect(yield* records.content(job, id(0))).toEqual(
						Option.some({_tag: "deleted", spanId: id(0), by, at: T, why}),
					);
					expect((yield* read(job)).map((r) => r.spanId)).toEqual(
						Array.from({length: total}, (_, n) => id(n)),
					);
				}).pipe(Effect.provide(layer));
			},
		);
	},
);

describe("RecordManager.remote, the record object's stub", () => {
	/** A stub that answers any method the builder names; `then` stays undefined so it is no thenable. */
	const stub = (answer: () => Promise<unknown>) => {
		const calls: Array<{name: string; method: string}> = [];
		const make = (name: string): RecordCalls =>
			new Proxy(
				{},
				{
					get: (_, method) =>
						method === "then"
							? undefined
							: () => {
									calls.push({name, method: String(method)});
									return answer();
								},
				},
			) as RecordCalls;
		return {make, calls};
	};

	law(
		"each call goes to the part's own object, by its name",
		(row, id, job, part, _T, _MESSAGE, _made, start) => {
			const {make, calls} = stub(() => Promise.resolve({_tag: "written"}));
			return Effect.gen(function* () {
				const records = yield* RecordManager;
				expect(yield* records.write(job, start, [kept(row(id(0)))])).toEqual({_tag: "written"});
				expect(yield* records.write(spans, 0, [kept(row(id(1)))])).toEqual({_tag: "written"});
				expect(calls.map((c) => c.name)).toEqual([part(start), "spans/0"]);
			}).pipe(Effect.provide(RecordManager.remote(make)));
		},
	);

	law("a rejected call is unreachable, an answer that does not decode is bad_row", (row, id, job) =>
		Effect.gen(function* () {
			const gone = stub(() => Promise.reject(new Error("object went away")));
			const odd = stub(() => Promise.resolve({weird: 1}));
			const unreachable = yield* Effect.flip(
				RecordManager.use((records) => records.write(job, 0, [kept(row(id(0)))])).pipe(
					Effect.provide(RecordManager.remote(gone.make)),
				),
			);
			expect(unreachable).toBeInstanceOf(SinkError);
			expect(unreachable.why).toBe("unreachable");
			const bad = yield* Effect.flip(
				RecordManager.use((records) => records.write(job, 0, [kept(row(id(0)))])).pipe(
					Effect.provide(RecordManager.remote(odd.make)),
				),
			);
			expect(bad.why).toBe("bad_row");
			const readFailed = yield* Effect.flip(
				read(job).pipe(Effect.provide(RecordManager.remote(gone.make))),
			);
			expect(readFailed.why).toBe("unreachable");
		}),
	);

	law(
		"a page keeps each span's events whole; an event that is not one is bad_row",
		(row, id, job, _part, T, _MESSAGE) =>
			Effect.gen(function* () {
				const event =
					row === originalRow
						? {name: "cache.miss", timeUnixNano: "1250000000", attributes: {"fab.n": 3}}
						: {
								name: row(id(0)).name,
								timeUnixNano: String(BigInt(T) * 1000000n),
								attributes: {"fab.n": 3},
							};
				const page = (events: ReadonlyArray<unknown>) =>
					stub(() => Promise.resolve({spans: [{...row(id(0)), events}], after: 1, rolled: false}));
				const good = yield* read(job).pipe(
					Effect.provide(RecordManager.remote(page([event]).make)),
				);
				expect(good.map((r) => r.events)).toEqual([[event]]);
				for (const broken of [{}, {...event, name: 7}, {...event, attributes: {"fab.n": {}}}]) {
					const bad = yield* Effect.flip(
						read(job).pipe(Effect.provide(RecordManager.remote(page([broken]).make))),
					);
					expect(bad.why, JSON.stringify(broken)).toBe("bad_row");
				}
			}),
	);
});
