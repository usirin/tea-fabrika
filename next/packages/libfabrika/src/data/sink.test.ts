import {Buffer} from "node:buffer";
// p98 and p99 (P37's plan writes them out; the lead commit adds them to docs/plan/tier-1-detail.md,
// "Properties"), for `data/sink.ts` and `data/trace.ts`: a span that ends is never dropped, and its
// tags hold names, ids and numbers only. From "design for bounded objects" and "monitoring is in
// Tier 1" (owner, 2026-11-07). Written before the modules (Tier 1, P37, ticket 238).
//
// The shape these tests hold the modules to, from the plan's sketches:
// - `SpanSink.layer(sql, {object})` gives Effect's `Tracer.Tracer` and `SpanSink` over the object's
//   own SQLite, and needs nothing else. Building it touches nothing.
// - A span that ends writes, before `end` returns, in one step: a `health` row (piece = the span's
//   name) and an `unsent` row. Its chain is its own `fab.process` tag, else its nearest ancestor's,
//   else `spans`.
// - `SpanSink.flush` sends `unsent` to each chain's part (`parts`, 0 if none), follows `rolled`,
//   deletes a row only after a good answer, and answers `{sent}`. The sink's own calls end no span.
// - A write that throws `SQLITE_FULL` is held in memory and tried again at each later `end`; the
//   next `flush` fails with `SinkError {why: "storage", held}` before it sends anything.
// - A row keeps OTLP's span fields. Tags are strings (cut at 128, `<key>.length` beside), numbers
//   and booleans; a `Redacted` is `"<redacted>"`; anything else is dropped and counted in
//   `fab.sink.dropped`. A failed span's class is `error.type`; `Cause.pretty` goes only to content.
// - Words: "run" is an agent run only. A program start is a process, and its tag is `fab.process`.
import {createHash} from "node:crypto";
import {mkdtempSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, beforeEach, describe, expect, it} from "@effect/vitest";
import {
	Arbitrary,
	Cause,
	Effect,
	Exit,
	Layer,
	Option,
	Redacted,
	Schema,
	Stream,
	Tracer,
} from "effect";
import {TestClock} from "effect/testing";
import {processId, processIds} from "../id.test-support.ts";
import {Archive, type BucketCalls} from "./archive.ts";
import {RecordManager} from "./records.ts";
import type {Sql} from "./referee.ts";
import {SinkError, SpanSink} from "./sink.ts";
import {nodeSql} from "./sqlite.ts";
import type {Chain, SpanRow} from "./trace.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

type ChainValue = typeof Chain.Type;
type Row = typeof SpanRow.Type;

const root = mkdtempSync(join(tmpdir(), "p37-sink-"));
const opened: Array<DatabaseSync> = [];
let homes = 0;
afterAll(() => {
	for (const db of opened.splice(0)) if (db.isOpen) db.close();
	rmSync(root, {recursive: true, force: true});
});

/** A folder of its own: the object's file, and any part files, so a test can read every byte. */
const home = () => {
	const dir = mkdtempSync(join(root, `h${++homes}-`));
	const open = (file: string): DatabaseSync => {
		const db = new DatabaseSync(join(dir, file));
		opened.push(db);
		return db;
	};
	const db = open("object.db");
	const parts = new Map<string, DatabaseSync>();
	const sqls = new Map<string, Sql>();
	const part = (name: string): Sql => {
		const known = sqls.get(name);
		if (known !== undefined) return known;
		const made = open(`${name.replaceAll("/", "_")}.db`);
		parts.set(name, made);
		const sql = nodeSql(made);
		sqls.set(name, sql);
		return sql;
	};
	const bytes = (marker: string) =>
		readdirSync(dir).filter((file) => readFileSync(join(dir, file)).includes(marker));
	return {dir, db, sql: nodeSql(db), open, part, parts, bytes};
};

const OBJECT = Effect.runSync(processId);
const P1 = OBJECT;
const P2 = Effect.runSync(processId);
const job = (process: string): ChainValue => ({_tag: "job", process});
const spans: ChainValue = {_tag: "spans"};
const BIG = 1024 * 1024 * 1024;

const world = (
	sql: Sql,
	records: Layer.Layer<RecordManager> = RecordManager.memory(BIG),
	archive: Layer.Layer<Archive> = Archive.memory,
) => Layer.mergeAll(SpanSink.layer(sql, {object: OBJECT}), records, archive);

const flush = SpanSink.use((sink) => sink.flush);
const recorded = (chain: ChainValue) =>
	RecordManager.use((records) => Stream.runCollect(records.read(chain)));
const traced = <A, E, R>(
	name: string,
	attributes: Record<string, unknown>,
	body: Effect.Effect<A, E, R>,
	kind: Tracer.SpanKind = "internal",
) => body.pipe(Effect.withSpan(name, {attributes, kind}));
const step = (name: string, attributes: Record<string, unknown> = {}) =>
	traced(name, attributes, Effect.void);

const count = (db: DatabaseSync, table: string, where = "1"): number =>
	Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get()?.["n"]);

/** Each table and column in a database whose text holds `marker`, as `table.column`. */
const places = (db: DatabaseSync, marker: string): Array<string> => {
	const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all();
	const found = new Set<string>();
	for (const {name} of tables) {
		for (const row of db.prepare(`SELECT * FROM "${String(name)}"`).all()) {
			for (const [column, value] of Object.entries(row)) {
				if (typeof value === "string" && value.includes(marker))
					found.add(`${String(name)}.${column}`);
			}
		}
	}
	return [...found].sort();
};

const full = () =>
	Object.assign(new Error("database or disk is full"), {
		code: "ERR_SQLITE_ERROR",
		errcode: 13,
		errstr: "database or disk is full",
	});
const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i;
/** A Sql over a real one that throws SQLITE_FULL on its next `armed` writes, as a full disk would. */
const filling = (inner: Sql) => {
	let armed = 0;
	let inside = false;
	const sql: Sql = {
		exec: (query, ...params) => {
			if (!inside && armed > 0 && WRITE.test(query)) {
				armed -= 1;
				throw full();
			}
			return inner.exec(query, ...params);
		},
		transaction: (work) => {
			if (armed > 0) {
				armed -= 1;
				throw full();
			}
			inside = true;
			try {
				return inner.transaction(work);
			} finally {
				inside = false;
			}
		},
		size: () => inner.size(),
	};
	return {sql, arm: (times: number) => (armed = times)};
};

const hex = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
/** R2 in memory, as its binding behaves: `put` fails when the body does not match its SHA-256. */
const bucket = () => {
	const files = new Map<string, Uint8Array>();
	const calls: BucketCalls = {
		put: (key, body, sha256) => {
			if (hex(body) !== sha256) return Promise.reject(new Error("checksum mismatch"));
			files.set(key, body.slice());
			return Promise.resolve();
		},
		head: (key) => {
			const body = files.get(key);
			return Promise.resolve(body === undefined ? null : {sha256: hex(body)});
		},
	};
	return {calls, files};
};

const ids = (rows: ReadonlyArray<Row>) => rows.map((r) => r.spanId);

const N = (minimum: number, maximum: number) =>
	Schema.Int.check(Schema.isBetween({minimum, maximum}));
const text = (minLength: number, maxLength: number) =>
	Arbitrary.array(Arbitrary.schema(N(0, 65535)), {minLength, maxLength}).pipe(
		Arbitrary.map((units) => unicode(String.fromCharCode(...units))),
	);
// UTF-8 replaces lone surrogates, including one left at a generated marker's cut.
const unicode = (value: string) => Buffer.from(value, "utf8").toString("utf8");
const Inputs = Arbitrary.all({
	P1: processIds,
	P2: processIds,
	time: Arbitrary.schema(N(0, 4102444800000)),
	duration: Arbitrary.schema(N(0, 900)),
	kind: Arbitrary.schema(Schema.Literals(["internal", "server", "client", "producer", "consumer"])),
	count: Arbitrary.schema(N(1, 8)),
	batch: Arbitrary.schema(N(1, 100)),
	cap: Arbitrary.schema(N(1, 131072)),
	made: Arbitrary.schema(N(120, 160)),
	pad: Arbitrary.schema(N(100, 256)),
	length: Arbitrary.schema(N(0, 4096)),
	astral: Arbitrary.schema(N(65536, 1114111)),
	content: Arbitrary.schema(N(0, 1100001)).pipe(Arbitrary.map((n) => (n === 0 ? 1100000 : n - 1))),
	secret: text(16, 128),
	note: text(16, 128),
	other: text(16, 128),
	ops: Arbitrary.schema(
		Schema.Array(Schema.Literals(["success", "failure", "flush", "retry", "refusal"])).check(
			Schema.isMinLength(1),
			Schema.isMaxLength(12),
		),
	),
});
const roots = Schema.Array(
	Schema.Array(Schema.Literals(["one", "two", "none"])).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(8),
	),
).check(Schema.isMinLength(1), Schema.isMaxLength(5));
const eventInputs = Arbitrary.schema(N(0, 8)).pipe(
	Arbitrary.flatMap((count) =>
		Arbitrary.array(
			Arbitrary.all({
				name: text(1, 256),
				time: Arbitrary.schema(N(0, 4102444800000)),
				attributes: tags,
			}),
			{minLength: count, maxLength: count},
		),
	),
);
type Params = {
	time: number;
	duration: number;
	kind: Tracer.SpanKind;
	count: number;
	batch: number;
	cap: number;
	made: number;
	pad: number;
	length: number;
	astral: number;
	content: number;
	secret: string;
	note: string;
	other: string;
	old: boolean;
	roots: ReadonlyArray<ReadonlyArray<"one" | "two" | "none">>;
	events: ReadonlyArray<{
		name: string;
		time: number;
		attributes: Readonly<Record<string, unknown>>;
	}>;
	ops: ReadonlyArray<"success" | "failure" | "flush" | "retry" | "refusal">;
};
const law = (
	name: string,
	check: (P1: string, P2: string, input: Params) => Effect.Effect<unknown, unknown>,
	runs = 60,
	profile: "base" | "events" | "roots" = "base",
) =>
	describe(name, () => {
		const run = (P1: string, P2: string, input: Params) =>
			Effect.suspend(() => check(P1, P2, input)).pipe(
				Effect.provide(TestClock.layer()),
				Effect.ensuring(
					Effect.sync(() => {
						for (const db of opened.splice(0)) if (db.isOpen) db.close();
					}),
				),
			);
		beforeEach(() =>
			Effect.runPromise(
				run(P1, P2, {
					time: Date.UTC(2026, 10, 7, 21, 59, 59, 990),
					duration: 3,
					kind: "internal",
					count: 4,
					batch: 30,
					cap: 16384,
					made: 120,
					pad: 100,
					length: 200,
					astral: 65536,
					content: 1100000,
					secret: SECRET,
					note: NOTE,
					other: NOTE_TWO,
					old: true,
					events: [],
					roots: [],
					ops: [],
				}),
			),
		);
		it.effect.prop(
			name,
			{
				input: Arbitrary.all({
					input: Inputs,
					events: profile === "events" ? eventInputs : Arbitrary.Constant([]),
					roots: profile === "roots" ? Arbitrary.schema(roots) : Arbitrary.Constant([]),
				}).pipe(Arbitrary.map(({input, events, roots}) => ({...input, events, roots}))),
			},
			({input}) =>
				run(
					input.P1,
					input.P2 === input.P1
						? `${input.P2.slice(0, -1)}${input.P2.endsWith("0") ? "1" : "0"}`
						: input.P2,
					{
						...input,
						secret: unicode(`secret${input.secret.slice(6)}`),
						note: unicode(`note--${input.note.slice(6)}`),
						other: unicode(`other-${input.other.slice(6)}`),
						old: false,
					},
				),
			{arbitrary: {seed: SEED, runs, size: 4096}, timeout: 60000},
		);
	});

describe("T246, P37 decodes TypeID process ids", () => {
	it.effect.prop(
		"a generated valid process reaches its JobRecord",
		{process: processIds},
		({process}) => {
			const {db, sql} = home();
			return Effect.gen(function* () {
				yield* step("runner.step", {"fab.process": process});
				expect(yield* flush).toEqual({sent: 1});
				expect(count(db, "unsent")).toBe(0);
				expect((yield* recorded(job(process))).map((row) => row.name)).toEqual(["runner.step"]);
			}).pipe(
				Effect.provide(world(sql)),
				Effect.ensuring(
					Effect.sync(() => {
						if (db.isOpen) db.close();
					}),
				),
			);
		},
		{arbitrary: {seed: SEED, runs: 60, size: 4096}},
	);

	// Plant: keep ProcessId as NonEmptyString. P37 must refuse a stored chain with a bad id.
	for (const [label, original] of [
		["old eight-hex id", "3f9a0c21"],
		...["i", "l", "o", "u"].map((char) => [char, `process_0${char}${"0".repeat(24)}`] as const),
		["first character 8", `process_8${"0".repeat(25)}`],
		["uppercase suffix", `process_${P1.slice(8).toUpperCase()}`],
		["25 characters", `process_${"0".repeat(25)}`],
		["27 characters", `process_${"0".repeat(27)}`],
		["wrong prefix", `person_${P1.slice(8)}`],
		["leading space", ` ${P1}`],
		["trailing space", `${P1} `],
		["trailing newline", `${P1}\n`],
	] as const)
		law(
			`a stored process with ${label} fails bad_row, keeps its row, and sends nothing`,
			(P1, _P2, input) => {
				const process = input.old
					? original
					: label === "uppercase suffix"
						? `process_${P1.slice(8).toUpperCase()}`
						: label === "wrong prefix"
							? `person_${P1.slice(8)}`
							: label === "leading space"
								? ` ${P1}`
								: label === "trailing space"
									? `${P1} `
									: label === "trailing newline"
										? `${P1}\n`
										: original;
				const {db, sql} = home();
				return Effect.gen(function* () {
					yield* step("runner.step", {"fab.process": P1});
					expect(count(db, "unsent")).toBe(1);
					sql.exec(`UPDATE unsent SET chain = json_set(chain, '$.process', ?)`, process);
					const exit = yield* Effect.exit(flush);
					expect(Exit.isFailure(exit), "P37 must reject the stored process id before sending").toBe(
						true,
					);
					const error = Exit.match(exit, {onFailure: Cause.squash, onSuccess: () => undefined});
					expect(error).toBeInstanceOf(SinkError);
					expect(error).toMatchObject({why: "bad_row", held: 0});
					expect(count(db, "unsent")).toBe(1);
					expect(yield* recorded(job(P1))).toEqual([]);
					expect(yield* recorded(job(process))).toEqual([]);
					sql.exec(`UPDATE unsent SET chain = json_set(chain, '$.process', ?)`, P1);
					expect(yield* flush).toEqual({sent: 1});
					expect(count(db, "unsent")).toBe(0);
					expect((yield* recorded(job(P1))).map((row) => row.name)).toEqual(["runner.step"]);
				}).pipe(Effect.provide(world(sql)));
			},
		);
});

describe("p98, a span that ends is never dropped", () => {
	law(
		"its rows are in the object's own SQLite before end returns, and a later process's flush sends them",
		(P1) =>
			Effect.promise(async () => {
				const {db, open} = home();
				// Effect.runSync: nothing may wait on a fiber or a timer for the rows to land.
				const exit = Effect.runSyncExit(
					traced("runner.step", {"fab.process": P1}, step("ledger.call")).pipe(
						Effect.provide(SpanSink.layer(nodeSql(db), {object: OBJECT})),
					),
				);
				expect(Exit.isSuccess(exit)).toBe(true);
				db.close();
				const again = open("object.db");
				expect(count(again, "health", "piece IN ('runner.step', 'ledger.call')")).toBe(2);
				expect(count(again, "unsent")).toBe(2);
				await Effect.runPromise(
					Effect.gen(function* () {
						expect(yield* flush).toEqual({sent: 2});
						const rows = yield* recorded(job(P1));
						expect(rows.map((r) => r.name).sort()).toEqual(["ledger.call", "runner.step"]);
						expect(count(again, "unsent")).toBe(0);
					}).pipe(Effect.provide(world(nodeSql(again)))),
				);
			}),
	);

	law(
		"a span goes to its own process, else its nearest ancestor's, else to spans; each to one chain",
		(P1, P2, input) => {
			const {db, sql} = home();
			return Effect.gen(function* () {
				yield* traced(
					"runner.step",
					{"fab.process": P1},
					traced("runner.cmd", {}, step("ledger.call")),
				);
				yield* traced("runner.step", {"fab.process": P2}, step("runner.cmd"));
				yield* traced("door.envelope", {}, step("ledger.append"));
				yield* traced(
					"runner.step",
					{"fab.process": P1},
					traced("supervisor.restart", {"fab.process": P2}, step("leaf")),
				);
				expect(count(db, "unsent"), "every span gets an unsent row, none is health only").toBe(10);
				expect(count(db, "health")).toBe(10);
				expect(yield* flush).toEqual({sent: 10});
				const one = yield* recorded(job(P1));
				const two = yield* recorded(job(P2));
				const outside = yield* recorded(spans);
				expect(one.map((r) => r.name).sort()).toEqual([
					"ledger.call",
					"runner.cmd",
					"runner.step",
					"runner.step",
				]);
				expect(two.map((r) => r.name).sort()).toEqual([
					"leaf",
					"runner.cmd",
					"runner.step",
					"supervisor.restart",
				]);
				expect(outside.map((r) => r.name).sort()).toEqual(["door.envelope", "ledger.append"]);
				const all = [...ids(one), ...ids(two), ...ids(outside)];
				expect(new Set(all).size, "no span in two chains").toBe(10);
				expect(count(db, "unsent")).toBe(0);
				if (!input.old) {
					const expected = new Map<string, Array<string>>([
						["one", []],
						["two", []],
						["none", []],
					]);
					for (const [root, routes] of input.roots.entries()) {
						let owner = "none";
						for (const [n, route] of routes.entries()) {
							if (route !== "none") owner = route;
							expected.get(owner)?.push(`generated.${root}.${n}`);
						}
						let body = Effect.void;
						for (let n = routes.length - 1; n >= 0; n--)
							body = traced(
								`generated.${root}.${n}`,
								routes[n] === "one"
									? {"fab.process": P1}
									: routes[n] === "two"
										? {"fab.process": P2}
										: {},
								body,
							);
						yield* body;
					}
					const total = input.roots.reduce((n, root) => n + root.length, 0);
					expect(count(db, "unsent")).toBe(total);
					expect(yield* flush).toEqual({sent: total});
					const extra: Array<string> = [];
					for (const [owner, names] of expected) {
						const rows = (yield* recorded(
							owner === "one" ? job(P1) : owner === "two" ? job(P2) : spans,
						)).filter((row) => row.name.startsWith("generated."));
						expect(rows.map((row) => row.name).sort()).toEqual([...names].sort());
						extra.push(...ids(rows));
					}
					expect(new Set(extra).size).toBe(total);
					expect(count(db, "unsent")).toBe(0);
				}
			}).pipe(Effect.provide(world(sql)));
		},
		60,
		"roots",
	);

	law("a row keeps OTLP's span fields, its parent and its times", (P1, _P2, input) => {
		const {db, sql} = home();
		const T = input.time;
		const nanos = (ms: number) => String(BigInt(ms) * 1_000_000n);
		return Effect.gen(function* () {
			yield* TestClock.setTime(T);
			yield* traced(
				"runner.step",
				{"fab.process": P1, "fab.letter.id": "m-17"},
				TestClock.adjust(4).pipe(
					Effect.andThen(
						traced("ledger.call", {"rpc.method": "append"}, TestClock.adjust(input.duration)),
					),
				),
				input.kind,
			);
			yield* flush;
			const rows = yield* recorded(job(P1));
			const parent = rows.find((r) => r.name === "runner.step");
			const child = rows.find((r) => r.name === "ledger.call");
			expect(parent).toEqual({
				traceId: expect.any(String),
				spanId: expect.any(String),
				parentSpanId: null,
				name: "runner.step",
				kind: input.kind,
				startTimeUnixNano: nanos(T),
				endTimeUnixNano: nanos(T + 4 + input.duration),
				attributes: {"fab.process": P1, "fab.letter.id": "m-17"},
				events: [],
				links: [],
				resource: {attributes: {"fab.object": OBJECT}},
				ok: true,
			});
			expect(child).toMatchObject({
				traceId: parent?.traceId,
				parentSpanId: parent?.spanId,
				startTimeUnixNano: nanos(T + 4),
				endTimeUnixNano: nanos(T + 4 + input.duration),
				attributes: {"rpc.method": "append"},
				ok: true,
			});
			const health = db.prepare(`SELECT piece, ms, ok FROM health ORDER BY piece`).all();
			expect(health.map((h) => [h["piece"], h["ms"], Boolean(h["ok"])])).toEqual([
				["ledger.call", input.duration, true],
				["runner.step", 4 + input.duration, true],
			]);
		}).pipe(Effect.provide(world(sql)));
	});

	law(
		"every row names the object that ended it, as OTLP's resource, inside a process and outside one",
		(P1, P2) => {
			// Two objects end spans. The spans outside a process share one chain, `spans`, so the row
			// is the only place that says which object ended each one (review must-fix, p98).
			const one = home();
			const two = home();
			const ends = (sql: Sql, object: string, process: string) =>
				Effect.gen(function* () {
					yield* traced("runner.step", {"fab.process": process}, step("ledger.call"));
					yield* step("door.envelope", {"fab.n": 1});
					expect(yield* flush).toEqual({sent: 3});
				}).pipe(Effect.provide(SpanSink.layer(sql, {object})));
			return Effect.gen(function* () {
				yield* ends(one.sql, OBJECT, P1);
				yield* ends(two.sql, P2, P2);
				const outside = yield* recorded(spans);
				expect(outside).toHaveLength(2);
				expect(
					outside
						.map((r) => r.resource)
						.sort((x, y) =>
							String(x.attributes["fab.object"]).localeCompare(String(y.attributes["fab.object"])),
						),
				).toEqual(
					[{attributes: {"fab.object": OBJECT}}, {attributes: {"fab.object": P2}}].sort((x, y) =>
						String(x.attributes["fab.object"]).localeCompare(String(y.attributes["fab.object"])),
					),
				);
				for (const row of outside)
					expect(row.attributes, "the object is the resource's, not a span tag").not.toHaveProperty(
						"fab.object",
					);
				for (const [process, object] of [
					[P1, OBJECT],
					[P2, P2],
				] as const) {
					const rows = yield* recorded(job(process));
					expect(rows).toHaveLength(2);
					for (const row of rows)
						expect(row.resource).toEqual({attributes: {"fab.object": object}});
				}
			}).pipe(Effect.provide(Layer.merge(RecordManager.memory(BIG), Archive.memory)));
		},
	);

	law(
		"a span's links stay on its row, in OTLP's link shape, their tags kept as a span's are",
		(P1, _P2, input) => {
			const secret = input.old ? "sk-p98-link" : input.secret;
			const {sql, bytes} = home();
			const first = Tracer.externalSpan({
				traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
				spanId: "00f067aa0ba902b7",
			});
			const second = Tracer.externalSpan({
				traceId: "5bf92f3577b34da6a3ce929d0e0e4737",
				spanId: "10f067aa0ba902b8",
			});
			return Effect.gen(function* () {
				yield* Effect.void.pipe(
					Effect.withSpan("runner.step", {
						attributes: {"fab.process": P1},
						links: [
							{
								span: first,
								attributes: {
									"fab.link": "follows-from",
									"fab.n": 2,
									"fab.key": Redacted.make(secret),
								},
							},
							{span: second, attributes: {}},
						],
					}),
				);
				yield* flush;
				const [row] = yield* recorded(job(P1));
				expect(row?.links).toEqual([
					{
						traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
						spanId: "00f067aa0ba902b7",
						attributes: {"fab.link": "follows-from", "fab.n": 2, "fab.key": "<redacted>"},
					},
					{traceId: "5bf92f3577b34da6a3ce929d0e0e4737", spanId: "10f067aa0ba902b8", attributes: {}},
				]);
				for (const marker of [
					secret,
					JSON.stringify(secret).slice(1, -1),
					encodeURIComponent(secret),
				])
					expect(bytes(marker), "a link's secret is never written").toEqual([]);
			}).pipe(Effect.provide(world(sql)));
		},
	);

	law(
		"a RecordManager that fails leaves every unsent row; a lost answer's resend adds nothing",
		(P1, _P2, input) => {
			const {db, sql} = home();
			return Effect.gen(function* () {
				for (let n = 0; n < input.count; n++)
					yield* step("runner.step", {"fab.process": P1, "fab.n": n});
				const real = yield* RecordManager;
				const down = {
					...real,
					write: () => Effect.fail(new SinkError({why: "unreachable", held: 0})),
				};
				const failed = yield* Effect.flip(flush.pipe(Effect.provideService(RecordManager, down)));
				expect(failed).toBeInstanceOf(SinkError);
				expect(count(db, "unsent"), "unsent is deleted only after a good answer").toBe(input.count);
				expect(yield* recorded(job(P1))).toEqual([]);

				// The part takes the write, and the answer is lost on the way back.
				let lose = 1;
				const lossy = {
					...real,
					write: (...args: Parameters<typeof real.write>) =>
						real
							.write(...args)
							.pipe(
								Effect.flatMap((written) =>
									lose-- > 0
										? Effect.fail(new SinkError({why: "unreachable", held: 0}))
										: Effect.succeed(written),
								),
							),
				};
				yield* Effect.exit(flush.pipe(Effect.provideService(RecordManager, lossy)));
				expect(count(db, "unsent")).toBe(input.count);
				expect(yield* flush).toEqual({sent: input.count});
				const rows = yield* recorded(job(P1));
				expect(rows).toHaveLength(input.count);
				expect(new Set(ids(rows)).size, "the resend wrote nothing twice").toBe(input.count);
				expect(count(db, "unsent")).toBe(0);
				expect(yield* flush).toEqual({sent: 0});
			}).pipe(Effect.provide(world(sql)));
		},
	);

	law("flush follows a part's roll and the next batch starts at the new part", (P1, _P2, input) => {
		const {db, sql} = home();
		const batches = input.old ? 3 : input.count;
		const batchSize = input.batch;
		return Effect.gen(function* () {
			const real = yield* RecordManager;
			const calls: Array<number> = [];
			const observed = {
				...real,
				write: (...args: Parameters<typeof real.write>) => {
					calls.push(args[1]);
					return real.write(...args);
				},
			};
			for (let batch = 0; batch < batches; batch++) {
				for (let n = 0; n < batchSize; n++)
					yield* step("runner.step", {"fab.process": P1, "fab.n": batch * batchSize + n});
				const from = Number(db.prepare(`SELECT max(part) AS part FROM parts`).get()?.["part"] ?? 0);
				calls.length = 0;
				expect(yield* flush.pipe(Effect.provideService(RecordManager, observed))).toEqual({
					sent: batchSize,
				});
				expect(calls[0], "a new batch starts at the saved part").toBe(from);
			}
			const rows = yield* recorded(job(P1));
			expect(rows.map((r) => r.attributes["fab.n"])).toEqual(
				Array.from({length: batches * batchSize}, (_, n) => n),
			);
			const part = db.prepare(`SELECT max(part) AS part FROM parts`).get()?.["part"];
			const priorBytes = rows
				.slice(0, -batchSize)
				.reduce((n, row) => n + new TextEncoder().encode(JSON.stringify(row)).length, 0);
			if (priorBytes >= input.cap)
				expect(Number(part), "rows past the cap roll past part 0").toBeGreaterThan(0);
		}).pipe(Effect.provide(world(sql, RecordManager.memory(input.cap))));
	});

	law(
		"a write that meets SQLITE_FULL once: the step's flush fails with storage, the span lands later",
		(P1) => {
			const {db, sql: real} = home();
			const {sql, arm} = filling(real);
			return Effect.gen(function* () {
				yield* step("runner.step", {"fab.process": P1, "fab.n": 0});
				arm(1);
				const exit = yield* Effect.exit(step("runner.step", {"fab.process": P1, "fab.n": 1}));
				expect(Exit.isSuccess(exit), "end never fails the fiber").toBe(true);
				const error = yield* Effect.flip(flush);
				expect(error).toBeInstanceOf(SinkError);
				expect(error.why).toBe("storage");
				expect(error.held).toBe(1);
				expect(yield* recorded(job(P1)), "flush fails before it sends anything").toEqual([]);
				yield* step("runner.step", {"fab.process": P1, "fab.n": 2});
				expect(count(db, "unsent"), "the held span landed at the next end").toBe(3);
				expect(yield* flush).toEqual({sent: 3});
				const rows = yield* recorded(job(P1));
				expect(rows.map((r) => r.attributes["fab.n"]).sort()).toEqual([0, 1, 2]);
			}).pipe(Effect.provide(world(sql)));
		},
	);

	law(
		"a disk that stays full: every flush fails, held counts every span, none goes missing",
		(_P1, _P2, input) => {
			const {db, sql: real} = home();
			const {sql, arm} = filling(real);
			return Effect.gen(function* () {
				yield* step("warm", {});
				arm(Number.POSITIVE_INFINITY);
				const first = input.old ? 5 : input.count;
				const total = first + 3;
				for (let n = 0; n < first; n++) yield* step("runner.step", {"fab.n": n});
				expect((yield* Effect.flip(flush)).held).toBe(first);
				for (let n = first; n < total; n++) yield* step("runner.step", {"fab.n": n});
				const error = yield* Effect.flip(flush);
				expect(error.why).toBe("storage");
				expect(error.held).toBe(total);
				expect(count(db, "unsent")).toBe(1);
				arm(0);
				yield* step("runner.step", {"fab.n": total});
				expect(yield* flush).toEqual({sent: total + 2});
				const rows = yield* recorded(spans);
				expect(rows.map((r) => r.attributes["fab.n"] ?? "warm").sort()).toEqual(
					[...Array.from({length: total + 1}, (_, n) => n), "warm"].sort(),
				);
			}).pipe(Effect.provide(world(sql)));
		},
	);

	law(
		"a real full file (max_page_count): unsent plus held is every span, and all land once it has room",
		(_P1, _P2, input) => {
			const {db, sql} = home();
			return Effect.gen(function* () {
				yield* step("warm", {});
				const pages = Number(db.prepare("PRAGMA page_count").get()?.["page_count"]);
				db.exec(`PRAGMA max_page_count = ${pages}`);
				const made = input.made;
				for (let n = 0; n < made; n++)
					yield* step("runner.step", {"fab.n": n, "fab.pad": "p".repeat(input.pad)});
				const error = yield* Effect.flip(flush);
				expect(error.why).toBe("storage");
				expect(error.held).toBeGreaterThan(0);
				expect(count(db, "unsent") + error.held).toBe(made + 1);
				expect(yield* recorded(spans)).toEqual([]);
				db.exec("PRAGMA max_page_count = 1073741823");
				yield* step("runner.step", {"fab.n": made});
				expect(yield* flush).toEqual({sent: made + 2});
				const rows = yield* recorded(spans);
				expect(new Set(ids(rows)).size).toBe(made + 2);
			}).pipe(Effect.provide(world(sql)));
		},
		3,
	);

	law(
		"a second flush after a storage failure still fails while spans are held, and sends nothing",
		(_P1, _P2, input) => {
			const {db, sql: real} = home();
			const {sql, arm} = filling(real);
			return Effect.gen(function* () {
				yield* step("warm", {});
				arm(Number.POSITIVE_INFINITY);
				yield* step("runner.step", {"fab.n": input.old ? 0 : input.count});
				expect((yield* Effect.flip(flush)).held).toBe(1);
				arm(0);
				const retried = yield* Effect.exit(flush);
				expect(Exit.isFailure(retried), "a held span keeps the second flush failed").toBe(true);
				const again = yield* Effect.flip(retried);
				expect(again.why, "no end since, but the span is still only in memory").toBe("storage");
				expect(again.held).toBe(1);
				expect(yield* recorded(spans), "the second flush sent nothing").toEqual([]);
				expect(count(db, "unsent")).toBe(1);
				yield* step("runner.step", {"fab.n": 1});
				expect(yield* flush).toEqual({sent: 3});
			}).pipe(Effect.provide(world(sql)));
		},
	);

	law(
		"after a roll, rows the old part already holds are not written again to the next part",
		(P1) => {
			const {db, sql} = home();
			return Effect.gen(function* () {
				yield* step("runner.step", {"fab.process": P1, "fab.n": 0});
				yield* step("runner.step", {"fab.process": P1, "fab.n": 1});
				const real = yield* RecordManager;
				// Part 0 takes both rows, and the answer is lost on the way back.
				let lose = 1;
				const lossy = {
					...real,
					write: (...args: Parameters<typeof real.write>) =>
						real
							.write(...args)
							.pipe(
								Effect.flatMap((written) =>
									lose-- > 0
										? Effect.fail(new SinkError({why: "unreachable", held: 0}))
										: Effect.succeed(written),
								),
							),
				};
				yield* Effect.exit(flush.pipe(Effect.provideService(RecordManager, lossy)));
				expect(count(db, "unsent")).toBe(2);
				// Part 0 is now past its 1-byte cap: the resend with one new row rolls it.
				yield* step("runner.step", {"fab.process": P1, "fab.n": 2});
				expect(yield* flush).toEqual({sent: 3});
				const rows = yield* recorded(job(P1));
				expect(rows.map((r) => r.attributes["fab.n"])).toEqual([0, 1, 2]);
				expect(count(db, "unsent")).toBe(0);
				expect(Number(db.prepare(`SELECT part FROM parts`).get()?.["part"])).toBe(1);
			}).pipe(Effect.provide(world(sql, RecordManager.memory(1))));
		},
	);

	law(
		"building touches nothing: on a Sql that always throws it builds, and traced work still succeeds",
		(P1) => {
			const throwing: Sql = {
				exec: () => {
					throw full();
				},
				transaction: () => {
					throw full();
				},
				size: () => 0,
			};
			return Effect.gen(function* () {
				const work = yield* Effect.exit(
					traced("runner.step", {"fab.process": P1}, Effect.succeed(7)),
				);
				expect(Exit.isSuccess(work), "traced work succeeds when storage throws").toBe(true);
				expect(yield* work).toBe(7);
				const error = yield* Effect.flip(flush);
				expect(error.why).toBe("storage");
				expect(error.held).toBe(1);
			}).pipe(Effect.provide(world(throwing)));
		},
	);
});

const SECRET = "sk-p99-secret";
const NOTE = "note-body-p99";
const NOTE_TWO = "note-two-p99";
const a = (n: number) => "a".repeat(n);
class NoteError extends Error {
	override readonly name = "NoteError";
}
const choose = (
	...options: ReadonlyArray<Arbitrary.Arbitrary<unknown>>
): Arbitrary.Arbitrary<unknown> =>
	Arbitrary.schema(N(0, options.length - 1)).pipe(
		Arbitrary.flatMap((n) => options[n] ?? Arbitrary.Constant(null)),
	);
const binary = Arbitrary.array(Arbitrary.schema(N(0, 65535)), {minLength: 0, maxLength: 10}).pipe(
	Arbitrary.map((units) => String.fromCharCode(...units)),
);
const scalar = choose(
	text(0, 10),
	Arbitrary.schema(Schema.Boolean),
	Arbitrary.schema(N(-9007199254740991, 9007199254740991)),
	Arbitrary.schema(Schema.Number),
	Arbitrary.Constant(Number.NaN),
	Arbitrary.Constant(Infinity),
	Arbitrary.Constant(-Infinity),
	Arbitrary.Constant(undefined),
	Arbitrary.Constant(null),
);
const object = (value: Arbitrary.Arbitrary<unknown>) =>
	Arbitrary.array(Arbitrary.all({key: binary, value}), {minLength: 0, maxLength: 10}).pipe(
		Arbitrary.map((pairs) => Object.fromEntries(pairs.map(({key, value}) => [key, value]))),
	);
const O1 = object(
	choose(scalar, Arbitrary.array(scalar, {minLength: 0, maxLength: 10}), object(scalar)),
);
const tagValue = choose(
	text(0, 400),
	Arbitrary.schema(N(-2147483648, 2147483647)),
	Arbitrary.schema(Schema.Finite).pipe(Arbitrary.filter((n) => !Object.is(n, -0))),
	Arbitrary.schema(Schema.Boolean),
	text(0, 256).pipe(Arbitrary.map((value) => Redacted.make(`${SECRET}-${value}`))),
	O1,
	Arbitrary.array(Arbitrary.schema(N(-2147483648, 2147483647)), {minLength: 0, maxLength: 3}),
	Arbitrary.Constant(null),
	Arbitrary.schema(
		Schema.BigInt.check(Schema.isBetweenBigInt({minimum: -(2n ** 255n), maximum: 2n ** 255n - 1n})),
	),
);
// Eight optional keys draw every subset, including no keys and all eight.
const subset = Schema.Struct({
	"fab.k0": Schema.optionalKey(Schema.Boolean),
	"fab.k1": Schema.optionalKey(Schema.Boolean),
	"fab.k2": Schema.optionalKey(Schema.Boolean),
	"fab.k3": Schema.optionalKey(Schema.Boolean),
	"fab.k4": Schema.optionalKey(Schema.Boolean),
	"fab.k5": Schema.optionalKey(Schema.Boolean),
	"fab.k6": Schema.optionalKey(Schema.Boolean),
	"fab.k7": Schema.optionalKey(Schema.Boolean),
});
const tags = Arbitrary.all({
	keys: Arbitrary.schema(subset),
	values: Arbitrary.array(tagValue, {minLength: 8, maxLength: 8}),
}).pipe(
	Arbitrary.map(({keys, values}) =>
		Object.fromEntries(Object.keys(keys).map((key) => [key, values[Number(key.slice(5))]])),
	),
);

describe("p99, tags hold names, ids and numbers; a message only in content", () => {
	law(
		"no Redacted text anywhere, and a throw's message only in content, never in a tag, health or R2",
		(P1, _P2, input) => {
			const SECRET = input.secret,
				NOTE = input.note,
				NOTE_TWO = input.other;
			const PASS = unicode(`pass--${SECRET.slice(6)}`);
			const h = home();
			const r2 = bucket();
			const day = Date.UTC(2026, 9, 23, 10);
			return Effect.gen(function* () {
				yield* TestClock.setTime(day);
				const thrown = yield* Effect.exit(
					traced(
						"runner.step",
						{"fab.process": P1, "fab.key": Redacted.make(SECRET)},
						(input.old
							? Effect.void
							: Effect.currentSpan.pipe(
									Effect.tap((span) =>
										Effect.sync(() => {
											span.event("flow.event", 1000000n, {"fab.key": Redacted.make(SECRET)});
											span.addLinks([
												{
													span: Tracer.externalSpan({
														traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
														spanId: "00f067aa0ba902b7",
													}),
													attributes: {"fab.pass": Redacted.make(PASS)},
												},
											]);
										}),
									),
								)
						).pipe(
							Effect.andThen(
								Effect.sync(() => {
									// oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- the law is about a step that throws, as the plan's trace has it
									throw new TypeError(`${NOTE} was not a function`);
								}),
							),
						),
					),
				);
				expect(Exit.isFailure(thrown)).toBe(true);
				yield* Effect.exit(
					traced(
						"ledger.call",
						{"fab.process": P1},
						Effect.fail(new NoteError(`${NOTE_TWO} failed`)),
					),
				);

				expect(places(h.db, NOTE), "before flush, only unsent's content holds the message").toEqual(
					["unsent.content"],
				);
				expect(places(h.db, NOTE_TWO)).toEqual(["unsent.content"]);
				for (const marker of [
					SECRET,
					JSON.stringify(SECRET).slice(1, -1),
					encodeURIComponent(SECRET),
				])
					expect(
						places(h.db, marker),
						"unsent, health and local metadata contain no secret",
					).toEqual([]);
				const health = h.db.prepare(`SELECT piece, ok, error FROM health ORDER BY piece`).all();
				expect(health.map((x) => [x["piece"], Boolean(x["ok"]), x["error"]])).toEqual([
					["ledger.call", false, "NoteError"],
					["runner.step", false, "TypeError"],
				]);

				yield* flush;
				const rows = yield* recorded(job(P1));
				const failed = rows.find((x) => x.name === "runner.step");
				expect(failed?.ok).toBe(false);
				expect(failed?.attributes["fab.key"]).toBe("<redacted>");
				expect(failed?.attributes["error.type"]).toBe("TypeError");
				expect(rows.find((x) => x.name === "ledger.call")?.attributes["error.type"]).toBe(
					"NoteError",
				);
				for (const x of rows) {
					for (const value of Object.values(x.attributes)) {
						expect(String(value)).not.toContain(NOTE);
						expect(String(value)).not.toContain(NOTE_TWO);
					}
				}
				const content = yield* RecordManager.use((records) =>
					records.content(job(P1), failed?.spanId ?? ""),
				);
				expect(
					Option.isSome(content) && content.value._tag === "kept" ? content.value.message : "",
				).toContain(NOTE);
				const clean = () => {
					for (const marker of [NOTE, NOTE_TWO]) {
						for (const encoded of [
							marker,
							JSON.stringify(marker).slice(1, -1),
							encodeURIComponent(marker),
						]) {
							for (const place of places(h.db, encoded))
								expect(place, "messages stay in unsent content").toBe("unsent.content");
							for (const db of h.parts.values())
								for (const place of places(db, encoded))
									expect(place.startsWith("content."), `message outside content: ${place}`).toBe(
										true,
									);
						}
					}
					for (const marker of [SECRET, PASS])
						for (const encoded of [
							marker,
							JSON.stringify(marker).slice(1, -1),
							encodeURIComponent(marker),
						]) {
							expect(
								places(h.db, encoded),
								"no secret in unsent, health or local metadata",
							).toEqual([]);
							for (const db of h.parts.values())
								expect(places(db, encoded), "no secret in any record column").toEqual([]);
						}
				};
				clean();
				// Keep the old flow, then vary later success, failure and flush order on the same real stores.
				for (const op of input.ops) {
					if (op === "flush" || op === "retry") yield* flush;
					else if (op === "refusal") {
						yield* step("flow.refusal", {"fab.process": P1, "fab.pass": Redacted.make(PASS)});
						const real = yield* RecordManager;
						const error = yield* Effect.flip(
							flush.pipe(
								Effect.provideService(RecordManager, {
									...real,
									write: () => Effect.fail(new SinkError({why: "bad_row", held: 0})),
								}),
							),
						);
						expect(error.why).toBe("bad_row");
					} else
						yield* Effect.exit(
							traced(
								"flow.generated",
								{"fab.process": P1, "fab.pass": Redacted.make(PASS)},
								op === "failure" ? Effect.fail(new NoteError(NOTE_TWO)) : Effect.void,
							),
						);
					clean();
				}
				yield* flush;

				// Two weeks on, the day's raw rows go to R2: they hold the class, never the message.
				yield* TestClock.setTime(day + 15 * 24 * 3_600_000);
				yield* step("runner.step", {});
				yield* flush;
				expect(r2.files.size, "the day was archived").toBeGreaterThan(0);
				for (const body of r2.files.values()) {
					const text = new TextDecoder().decode(body);
					for (const marker of [SECRET, PASS, NOTE, NOTE_TWO])
						for (const encoded of [
							marker,
							JSON.stringify(marker).slice(1, -1),
							encodeURIComponent(marker),
						])
							expect(text).not.toContain(encoded);
				}

				expect(places(h.db, NOTE), "the object keeps no message after flush").toEqual([]);
				for (const [name, db] of h.parts) {
					for (const place of [...places(db, NOTE), ...places(db, NOTE_TWO)]) {
						expect(place.startsWith("content."), `${name}: ${place}`).toBe(true);
					}
				}
				for (const marker of [
					SECRET,
					JSON.stringify(SECRET).slice(1, -1),
					encodeURIComponent(SECRET),
					PASS,
					JSON.stringify(PASS).slice(1, -1),
					encodeURIComponent(PASS),
				])
					expect(h.bytes(marker), "no file holds the Redacted text, in any byte").toEqual([]);
			}).pipe(
				Effect.provide(world(h.sql, RecordManager.sql(h.part, BIG), Archive.bucket(r2.calls))),
			);
		},
	);

	it.effect.prop(
		"every kept tag is a string of at most 128 characters, a number or a boolean; the rest is counted",
		{tags},
		({tags}) => {
			const {sql} = home();
			return Effect.gen(function* () {
				yield* step("runner.step", {"fab.process": P1, ...tags});
				yield* flush;
				const [row] = yield* recorded(job(P1));
				const kept = row?.attributes ?? {};
				let dropped = 0;
				for (const [k, v] of Object.entries(tags)) {
					if (typeof v === "string") {
						if (v.length <= 128) expect(kept[k]).toBe(v);
						else {
							expect(v.startsWith(String(kept[k]))).toBe(true);
							expect(String(kept[k]).length).toBeLessThanOrEqual(128);
							expect(kept[`${k}.length`]).toBe(v.length);
						}
					} else if (typeof v === "number" || typeof v === "boolean") expect(kept[k]).toBe(v);
					else if (Redacted.isRedacted(v)) expect(kept[k]).toBe("<redacted>");
					else {
						expect(k in kept, `${k} is dropped`).toBe(false);
						dropped += 1;
					}
				}
				expect(kept["fab.sink.dropped"] ?? 0).toBe(dropped);
				for (const v of Object.values(kept)) {
					expect(["string", "number", "boolean"]).toContain(typeof v);
					if (typeof v === "string") {
						expect(v.length).toBeLessThanOrEqual(128);
						expect(v).not.toContain(SECRET);
					}
				}
			}).pipe(
				Effect.provide(world(sql)),
				Effect.ensuring(
					Effect.sync(() => {
						for (const db of opened.splice(0)) if (db.isOpen) db.close();
					}),
				),
			);
		},
		{arbitrary: {seed: SEED, runs: 60, size: 4096}, timeout: 60000},
	);

	law(
		"text past 128 is cut to 128, or to 127 when the cut would split a surrogate pair, with <key>.length beside",
		(P1, _P2, input) => {
			const {sql} = home();
			return Effect.gen(function* () {
				const generated = {
					"fab.short": a(input.length),
					"fab.high": `${a(127) + String.fromCodePoint(input.astral)}x`,
					"fab.fitsPair": a(126) + String.fromCodePoint(input.astral),
					"fab.low": `${a(126) + String.fromCodePoint(input.astral)}x`,
				};
				const values = input.old
					? {
							"fab.process": P1,
							"fab.fits": a(128),
							"fab.over": a(200),
							// A high surrogate at the 128th character: the pair would split, so the cut keeps 127.
							"fab.d800": `${a(127)}\u{10000}`,
							"fab.d83d": `${a(127)}😀`,
							"fab.dbff": `${a(127)}\u{10FFFF}`,
							// A low surrogate there ends a pair, and the characters next to the range are not one.
							"fab.low": `${a(126)}😀b`,
							"fab.d7ff": `${a(127)}퟿b`,
							"fab.e000": `${a(127)}b`,
						}
					: {"fab.process": P1, ...generated};
				yield* step("runner.step", values);
				yield* flush;
				const [row] = yield* recorded(job(P1));
				const expected = input.old
					? {
							"fab.process": P1,
							"fab.fits": a(128),
							"fab.over": a(128),
							"fab.over.length": 200,
							"fab.d800": a(127),
							"fab.d800.length": 129,
							"fab.d83d": a(127),
							"fab.d83d.length": 129,
							"fab.dbff": a(127),
							"fab.dbff.length": 129,
							"fab.low": `${a(126)}😀`,
							"fab.low.length": 129,
							"fab.d7ff": `${a(127)}퟿`,
							"fab.d7ff.length": 129,
							"fab.e000": `${a(127)}`,
							"fab.e000.length": 129,
						}
					: Object.fromEntries(
							Object.entries(values).flatMap(([key, value]): Array<[string, string | number]> =>
								value.length <= 128
									? [[key, value]]
									: [
											[
												key,
												value.slice(
													0,
													value.charCodeAt(127) >= 0xd800 && value.charCodeAt(127) <= 0xdbff
														? 127
														: 128,
												),
											],
											[`${key}.length`, value.length],
										],
							),
						);
				expect(row?.attributes).toEqual(expected);
			}).pipe(Effect.provide(world(sql)));
		},
	);

	law(
		"a row keeps its events' names, times and tags; a tag an event drops is counted",
		(P1, _P2, input) => {
			const {sql} = home();
			return Effect.gen(function* () {
				const events = input.old
					? [
							{
								name: "cache.miss",
								time: 1250000000n,
								attributes: {"fab.key": "k-1", "fab.bad": {}},
							},
							{name: "cache.fill", time: 1260000000n, attributes: {"fab.n": 3, "fab.worse": [1]}},
						]
					: input.events.map((event) => ({...event, time: BigInt(event.time) * 1000000n}));
				let dropped = 0;
				const expected = events.map((event) => {
					const attributes: Record<string, string | number | boolean> = {};
					for (const [key, value] of Object.entries(event.attributes)) {
						if (Redacted.isRedacted(value)) attributes[key] = "<redacted>";
						else if (
							(typeof value === "number" && Number.isFinite(value)) ||
							typeof value === "boolean"
						)
							attributes[key] = value;
						else if (typeof value === "string") {
							const end = value.charCodeAt(127);
							attributes[key] =
								value.length <= 128
									? value
									: value.slice(0, end >= 0xd800 && end <= 0xdbff ? 127 : 128);
							if (value.length > 128) attributes[`${key}.length`] = value.length;
						} else dropped++;
					}
					return {name: event.name, timeUnixNano: String(event.time), attributes};
				});
				yield* Effect.currentSpan.pipe(
					Effect.flatMap((span) =>
						Effect.sync(() => {
							for (const event of events) span.event(event.name, event.time, {...event.attributes});
						}),
					),
					Effect.withSpan("runner.step", {attributes: {"fab.process": P1}}),
				);
				yield* flush;
				const [row] = yield* recorded(job(P1));
				expect(row?.events).toEqual(expected);
				expect(row?.attributes, "the span's own tags drop nothing; its events drop two").toEqual({
					"fab.process": P1,
					...(dropped > 0 ? {"fab.sink.dropped": dropped} : {}),
				});
			}).pipe(Effect.provide(world(sql)));
		},
		60,
		"events",
	);

	law(
		"a failure's text past 1,000,000 characters is cut there, with its full length after",
		(P1, _P2, sample) => {
			const {sql} = home();
			return Effect.gen(function* () {
				// Keep the full 0..1,100,000 draw and also exercise the cut with fresh generated text.
				for (const input of sample.old
					? [sample]
					: [sample, {...sample, content: 1000001 + (sample.content % 100000)}]) {
					const exit = yield* Effect.exit(
						traced(
							"runner.step",
							{"fab.process": P1},
							Effect.fail(new NoteError(a(input.content))),
						),
					);
					expect(Exit.isFailure(exit)).toBe(true);
					yield* flush;
					const row = (yield* recorded(job(P1))).at(-1);
					const content = yield* RecordManager.use((records) =>
						records.content(job(P1), row?.spanId ?? ""),
					);
					const message =
						Option.isSome(content) && content.value._tag === "kept" ? content.value.message : "";
					const tail = /\n\[cut: (\d+) characters\]$/.exec(message);
					const original = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "";
					const expected =
						original.length <= 1000000
							? original
							: `${original.slice(0, 1000000)}\n[cut: ${original.length} characters]`;
					expect(message).toBe(expected);
					if (input.content > 1000000) {
						expect(tail, "the cut text ends with its full length").not.toBeNull();
						const full = Number(tail?.[1]);
						expect(full).toBeGreaterThan(input.content);
						expect(message.length).toBe(1_000_000 + (tail?.[0].length ?? 0));
						expect(message.slice(0, 1_000_000)).toContain(`NoteError: ${a(1000)}`);
					} else if (tail === null) {
						expect(message).toContain(`NoteError: ${a(input.content)}`);
						expect(message.length).toBeLessThanOrEqual(1000000);
					}
				}
			}).pipe(Effect.provide(world(sql)));
		},
		3,
	);
});
