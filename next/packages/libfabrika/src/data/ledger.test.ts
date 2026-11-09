import {Buffer} from "node:buffer";
// p18, p19, p20 and p93 (docs/plan/tier-1-detail.md, "Properties"; P6's plan writes them out), for
// `data/ledger.ts` and `data/referee.ts`: the ledger suite on `Ledger.sql` over node:sqlite, `read`
// as a lazy Stream, `arrivedAt` from the referee's Clock, typed failures that pass, and `seen`
// bounded by the log's head. Written before the modules (Tier 1, P6, ticket 233).
//
// The shape these tests hold the modules to:
// - `append(stream, id, line)` answers `{_tag: "placed", rev, pos}` or `{_tag: "refused", why}`.
//   `rev` is the place in the whole log, `pos` the place in the stream, both from 1. The same id on
//   the same stream with the same `by`, `for`, `parent`, `_tag` and `body` gets its first placing
//   again and writes nothing; with any of those different it is `id_reused` (owner, 2026-11-07).
//   `sentAt`, `seen`, `traceId` and `build` may differ on a resend. `seen` past the log's head is `seen_ahead`.
// - `read(stream, after)` is a Stream of the stream's entries past `after`, oldest first, fetched
//   in pages of 256 only when it runs. `wait(stream, after)` answers at once: `{_tag: "ready", rev}`
//   with the stream's newest rev, or `{_tag: "parked"}`.
// - Failures are `LedgerError` with `why`: `unreachable` and `bad_row` from `Ledger.remote`,
//   `storage` when the Sql throws. No Layer fails when it is built.
import {mkdtempSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, beforeEach, describe, expect, it} from "@effect/vitest";
import {
	Arbitrary,
	Duration,
	Effect,
	Exit,
	Layer,
	ManagedRuntime,
	References,
	Schema,
	Stream,
	Tracer,
} from "effect";
import {TestClock} from "effect/testing";
import {inputParents, processId} from "../id.test-support.ts";
import {Doorbell, Ledger, LedgerError, type LedgerCalls} from "./ledger.ts";
import {type Line, TraceId} from "./log.ts";
import type {Sql} from "./referee.ts";
import {nodeSql} from "./sqlite.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const READER = "gateway:t1";
const PARENT = `in-${Effect.runSync(processId)}-41`;
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const OTHER_TRACE = "5bf92f3577b34da6a3ce929d0e0e4737";

// Every ledger is a fresh node:sqlite file in one temp folder, removed after.
const folder = mkdtempSync(join(tmpdir(), "p6-ledger-"));
const opened: Array<DatabaseSync> = [];
let files = 0;
const freshPath = (): string => join(folder, `ledger-${++files}.db`);
const openDb = (path: string): DatabaseSync => {
	const db = new DatabaseSync(path);
	opened.push(db);
	return db;
};
const fresh = (): Sql => nodeSql(openDb(freshPath()));
afterAll(() => {
	for (const db of opened.splice(0)) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
const closeOpened = Effect.sync(() => {
	for (const db of opened.splice(0)) if (db.isOpen) db.close();
});

type Rung = {readonly to: string; readonly stream: string; readonly rev: number};
const bell = () => {
	const rang: Array<Rung> = [];
	const layer = Layer.succeed(Doorbell, {
		ring: (to, stream, rev) =>
			Effect.sync(() => {
				rang.push({to, stream, rev});
			}),
	});
	return {rang, layer};
};
const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
const onSql = (sql: Sql, doorbell: Layer.Layer<Doorbell> = quiet) =>
	Ledger.sql(sql, {reader: READER}).pipe(Layer.provide(doorbell));

const line = (over: Partial<Line> = {}): Line => ({
	by: "SHA256:writer-a",
	for: "owner",
	sentAt: "2026-11-07T21:10:01.204Z",
	seen: 0,
	parent: null,
	traceId: TRACE,
	build: "b-7c1d073",
	_tag: "saved",
	body: {note: "n-7f3a", base: 3},
	...over,
});
const placed = (rev: number, pos: number) => ({_tag: "placed", rev, pos});
const fixedLine = line;
const signed32 = (n: number) => (n % 4294967296) - 2147483648;
const refused = (why: string) => ({_tag: "refused", why});
const readAll = (stream: string, after = 0) =>
	Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, after)));

/** A Sql that counts its calls, so a test can see that nothing was read. */
const counting = (sql: Sql) => {
	let calls = 0;
	const counted: Sql = {
		exec: (query, ...params) => {
			calls++;
			return sql.exec(query, ...params);
		},
		transaction: (step) => {
			calls++;
			return sql.transaction(step);
		},
		size: () => sql.size(),
	};
	return {sql: counted, calls: () => calls};
};

/** node:sqlite's error for a full disk, as it throws it. */
const sqliteFull = (): Error =>
	Object.assign(new Error("database or disk is full"), {
		code: "ERR_SQLITE_ERROR",
		errcode: 13,
		errstr: "database or disk is full",
	});
/** A Sql whose next call throws once `arm` is called, then works again. */
const throwingOnce = (sql: Sql) => {
	let armed = false;
	const trip = (): void => {
		if (!armed) return;
		armed = false;
		throw sqliteFull();
	};
	const wrapped: Sql = {
		exec: (query, ...params) => {
			trip();
			return sql.exec(query, ...params);
		},
		transaction: (step) => sql.transaction(step),
		size: () => sql.size(),
	};
	return {
		sql: wrapped,
		arm: () => {
			armed = true;
		},
	};
};
/** A tracer that keeps every span it makes, so a test can count the ones that ended. */
const capture = () => {
	const spans: Array<Tracer.NativeSpan> = [];
	const tracer = Tracer.make({
		span(options) {
			const span = new Tracer.NativeSpan(options);
			spans.push(span);
			return span;
		},
	});
	const ended = (name: string) =>
		spans.filter((span) => span.name === name && span.status._tag === "Ended");
	return {tracer, ended};
};

const N = (minimum: number, maximum: number) =>
	Schema.Int.check(Schema.isBetween({minimum, maximum}));
const text = (minLength: number, maxLength: number) =>
	Arbitrary.array(Arbitrary.schema(N(0, 65535)), {minLength, maxLength}).pipe(
		Arbitrary.map((units) => Buffer.from(String.fromCharCode(...units), "utf8").toString("utf8")),
	);
const choose = <A>(first: Arbitrary.Arbitrary<A>, ...rest: ReadonlyArray<Arbitrary.Arbitrary<A>>) =>
	Arbitrary.schema(N(0, rest.length)).pipe(
		Arbitrary.flatMap((n) => (n === 0 ? first : (rest[n - 1] ?? first))),
	);
const scalar: Arbitrary.Arbitrary<Schema.Json> = choose<Schema.Json>(
	Arbitrary.Constant(null),
	text(0, 256),
	Arbitrary.schema(Schema.Boolean),
	Arbitrary.schema(Schema.Finite).pipe(Arbitrary.map((n) => JSON.parse(JSON.stringify(n)))),
);
const jsonLevel = (value: Arbitrary.Arbitrary<Schema.Json>): Arbitrary.Arbitrary<Schema.Json> =>
	choose(
		value,
		Arbitrary.array(value, {minLength: 0, maxLength: 10}),
		Arbitrary.array(Arbitrary.all({key: text(0, 64), value}), {minLength: 0, maxLength: 10}).pipe(
			Arbitrary.map((pairs) => Object.fromEntries(pairs.map(({key, value}) => [key, value]))),
		),
	);
const fields = Arbitrary.all({
	by: text(1, 256),
	for: text(1, 256),
	sentAt: text(0, 4096),
	build: text(1, 256),
	_tag: text(1, 256),
	traceId: Arbitrary.schema(TraceId),
	body: jsonLevel(jsonLevel(jsonLevel(scalar))),
});
const retry = Arbitrary.all({fields, parent: inputParents}).pipe(
	Arbitrary.map(({fields, parent}) => ({...fields, parent})),
);
const canonical = (value: Schema.Json) =>
	JSON.stringify(value, (_key, value) =>
		value !== null && typeof value === "object" && !Array.isArray(value)
			? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: value,
	);
const Inputs = {
	fields,
	writes: Schema.Array(
		Schema.Struct({
			stream: Schema.Literals(["a", "b", "c"]),
			id: Schema.Literals(["w-1", "w-2", "w-3", "w-4"]),
			body: Schema.Literals([1, 2]),
			ahead: N(0, 2),
		}),
	).check(Schema.isMaxLength(40)),
	seen: Schema.Array(Schema.Struct({stream: Schema.Literals(["a", "b"]), offset: N(-3, 2)})).check(
		Schema.isMaxLength(40),
	),
	pages: Arbitrary.schema(N(0, 1501)),
	clock: Arbitrary.schema(N(0, 4102444800000)),
	writers: Arbitrary.schema(N(1, 80)),
	streams: Arbitrary.schema(N(1, 4)),
	sent: text(0, 4096),
};
const law = (
	name: string,
	check: (
		line: (over?: Partial<Line>) => Line,
		n: number,
		t: number,
		streams: number,
		sent: string,
		retry: Omit<Line, "seen">,
	) => Effect.Effect<unknown, unknown>,
	runs = 60,
) =>
	describe(name, () => {
		const close = Effect.sync(() => {
			for (const db of opened.splice(0)) if (db.isOpen) db.close();
		});
		const run = (work: () => Effect.Effect<unknown, unknown>) =>
			Effect.suspend(work).pipe(Effect.provide(TestClock.layer()), Effect.ensuring(close));
		beforeEach(() => Effect.runPromise(run(() => check(line, 300, 1762549801311, 3, "", line()))));
		it.effect.prop(
			name,
			{
				fields,
				pages: Inputs.pages,
				t: Inputs.clock,
				streams: Inputs.streams,
				sent: Inputs.sent,
				retry,
			},
			({fields, pages, t, streams, sent, retry}) =>
				run(() => check((over = {}) => line({...fields, ...over}), pages, t, streams, sent, retry)),
			{arbitrary: {seed: SEED, runs, size: 4096}, timeout: 60000},
		);
	});

describe("p18, the ledger suite on Ledger.sql", () => {
	law(
		"the same id sent twice with the same content is one entry, placed the same, the first kept",
		(line, _n, _t, _streams, _sent, retry) =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				const firstMeta =
					line === fixedLine
						? {sentAt: "first", build: "b-1"}
						: {sentAt: line().sentAt, build: line().build};
				const secondMeta =
					line === fixedLine
						? {sentAt: "second", build: "b-2"}
						: {sentAt: retry.sentAt, build: retry.build};
				const first = yield* ledger.append("notes:1", "w-9", line({...firstMeta, seen: 0}));
				const again = yield* ledger.append("notes:1", "w-9", line({...secondMeta, seen: 1}));
				expect(first).toEqual(placed(1, 1));
				expect(again).toEqual(first);
				const entries = yield* readAll("notes:1");
				expect(entries.map((e) => [e.id, e.rev, e.sentAt, e.seen, e.build])).toEqual([
					["w-9", 1, firstMeta.sentAt, 0, firstMeta.build],
				]);
				expect(yield* ledger.append("notes:1", "w-10", line())).toEqual(placed(2, 2));
			}).pipe(Effect.provide(onSql(fresh()))),
	);

	// Plant: same() compares traceId, so a retry in another trace is refused.
	law(
		"traceId never decides: a resend gets its first placing and keeps the first trace",
		(line, _n, _t, _streams, _sent, retry) =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				const trace = line().traceId;
				const other =
					line === fixedLine
						? OTHER_TRACE
						: retry.traceId === trace
							? `${trace.startsWith("1") ? "2" : "1"}${trace.slice(1)}`
							: retry.traceId;
				expect(yield* ledger.append("notes:1", "w-1", line())).toEqual(placed(1, 1));
				expect(yield* ledger.append("notes:1", "w-2", line())).toEqual(placed(2, 2));
				expect(yield* ledger.append("notes:1", "w-1", line({traceId: other}))).toEqual(
					placed(1, 1),
				);
				const entries = yield* readAll("notes:1");
				expect(entries.map((entry) => [entry.id, entry.rev, entry.pos, entry.traceId])).toEqual([
					["w-1", 1, 1, trace],
					["w-2", 2, 2, trace],
				]);
				expect(yield* ledger.append("notes:1", "w-3", line())).toEqual(placed(3, 3));
			}).pipe(Effect.provide(onSql(fresh()))),
	);

	const changes: ReadonlyArray<readonly [string, Partial<Line>]> = [
		["by", {by: "SHA256:writer-b"}],
		["for", {for: "someone-else"}],
		["parent", {parent: PARENT}],
		["_tag", {_tag: "deleted"}],
		["body", {body: {note: "n-7f3a", base: 4}}],
	];
	for (const [field, oldChange] of changes)
		law(
			`the same id with another ${field} is refused id_reused, and nothing is written`,
			(line, _n, _t, _streams, _sent, retry) =>
				Effect.gen(function* () {
					const base = line();
					const change =
						line === fixedLine
							? oldChange
							: field === "body"
								? {
										body:
											canonical(base.body) === canonical(retry.body)
												? base.body === null
													? false
													: null
												: retry.body,
									}
								: field === "parent"
									? {parent: retry.parent}
									: {
											[field]:
												base[field as "by" | "for" | "_tag"] ===
												retry[field as "by" | "for" | "_tag"]
													? base[field as "by" | "for" | "_tag"] === "\u0000"
														? "\u0001"
														: "\u0000"
													: retry[field as "by" | "for" | "_tag"],
										};
					const ledger = yield* Ledger;
					expect(yield* ledger.append("notes:1", "w-9", line())).toEqual(placed(1, 1));
					expect(yield* ledger.append("notes:1", "w-9", line(change))).toEqual(
						refused("id_reused"),
					);
					const entries = yield* readAll("notes:1");
					expect(entries).toHaveLength(1);
					expect(entries[0]).toMatchObject(line());
					expect(yield* ledger.append("notes:1", "w-10", line())).toEqual(placed(2, 2));
				}).pipe(Effect.provide(onSql(fresh()))),
		);

	law("an id is checked per stream: the same id on another stream is a new entry", (line) =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			expect(yield* ledger.append("notes:1", "w-1", line())).toEqual(placed(1, 1));
			expect(yield* ledger.append("notes:2", "w-1", line({body: "other"}))).toEqual(placed(2, 1));
		}).pipe(Effect.provide(onSql(fresh()))),
	);

	law(
		"two streams written in turn: reads in rev order, pos 1, 2, 3, rev only grows, after cuts",
		(line) =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				const answers = [];
				for (const n of [1, 2, 3]) {
					answers.push(yield* ledger.append("a", `a-${n}`, line({body: n})));
					answers.push(yield* ledger.append("b", `b-${n}`, line({body: n})));
				}
				expect(answers).toEqual([
					placed(1, 1),
					placed(2, 1),
					placed(3, 2),
					placed(4, 2),
					placed(5, 3),
					placed(6, 3),
				]);
				const a = yield* readAll("a");
				expect(a.map((e) => [e.id, e.rev, e.pos, e.body])).toEqual([
					["a-1", 1, 1, 1],
					["a-2", 3, 2, 2],
					["a-3", 5, 3, 3],
				]);
				expect((yield* readAll("a", 3)).map((e) => e.id)).toEqual(["a-3"]);
				expect((yield* readAll("b", 2)).map((e) => e.id)).toEqual(["b-2", "b-3"]);
				expect(yield* readAll("b", 6)).toEqual([]);
				expect(yield* readAll("c")).toEqual([]);
			}).pipe(Effect.provide(onSql(fresh()))),
	);

	it.effect.prop(
		"for any run of appends, every answer and every read match a plain model",
		{commands: Inputs.writes},
		({commands}) => {
			type Command = (typeof Inputs.writes.Type)[number];
			const model = (commands: ReadonlyArray<Command>) => {
				const kept = new Map<string, {id: string; body: number; rev: number; pos: number}>();
				const streams = new Map<
					string,
					Array<{id: string; body: number; rev: number; pos: number}>
				>();
				let head = 0;
				const answers = commands.map(({stream, id, body, ahead}) => {
					const first = kept.get(`${stream} ${id}`);
					if (first !== undefined) {
						return first.body === body ? placed(first.rev, first.pos) : refused("id_reused");
					}
					if (ahead > 0) return refused("seen_ahead");
					const list = streams.get(stream) ?? [];
					const entry = {id, body, rev: ++head, pos: list.length + 1};
					kept.set(`${stream} ${id}`, entry);
					streams.set(stream, [...list, entry]);
					return placed(entry.rev, entry.pos);
				});
				return {answers, streams};
			};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const answers = [];
				let head = 0;
				const ids = new Set<string>();
				for (const {stream, id, body, ahead} of commands) {
					// A new id may be sent ahead of the head; a resend always sends a seen in range.
					const known = ids.has(`${stream} ${id}`);
					const seen = known ? head : head + ahead;
					const answer = yield* ledger.append(stream, id, line({body, seen}));
					if (answer._tag === "placed") {
						ids.add(`${stream} ${id}`);
						head = Math.max(head, answer.rev);
					}
					answers.push(answer);
				}
				const expected = model(commands);
				expect(answers).toEqual(expected.answers);
				for (const stream of ["a", "b", "c"]) {
					const entries = yield* readAll(stream);
					expect(entries.map((e) => ({id: e.id, body: e.body, rev: e.rev, pos: e.pos}))).toEqual(
						expected.streams.get(stream) ?? [],
					);
				}
			}).pipe(Effect.provide(onSql(fresh())), Effect.ensuring(closeOpened));
		},
		{arbitrary: {seed: SEED, runs: 60, size: 4096}, timeout: 60000},
	);

	law(
		"a wait is ready with news, parks without, and the next append to its stream rings it once",
		(line) => {
			const {rang, layer} = bell();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.append("a", "w-1", line());
				expect(yield* ledger.wait("a", 0)).toEqual({_tag: "ready", rev: 1});
				expect(yield* ledger.wait("a", 1)).toEqual({_tag: "parked"});
				yield* ledger.append("b", "w-1", line());
				yield* ledger.append("a", "w-1", line());
				expect(rang).toEqual([]);
				yield* ledger.append("a", "w-2", line());
				yield* ledger.append("a", "w-3", line());
				expect(rang).toEqual([{to: READER, stream: "a", rev: 3}]);
			}).pipe(Effect.provide(onSql(fresh(), layer)));
		},
	);

	law(
		"the file closed and opened again holds every placed entry once, with no gap, and a parked wait still rings",
		(line) =>
			Effect.gen(function* () {
				const path = freshPath();
				const first = openDb(path);
				yield* Effect.gen(function* () {
					const ledger = yield* Ledger;
					for (const n of [1, 2, 3, 4, 5]) yield* ledger.append("a", `w-${n}`, line());
					expect(yield* ledger.wait("b", 5)).toEqual({_tag: "parked"});
				}).pipe(Effect.provide(onSql(nodeSql(first))));
				first.close();
				const {rang, layer} = bell();
				yield* Effect.gen(function* () {
					const ledger = yield* Ledger;
					const entries = yield* readAll("a");
					expect(entries.map((e) => [e.id, e.rev, e.pos])).toEqual([
						["w-1", 1, 1],
						["w-2", 2, 2],
						["w-3", 3, 3],
						["w-4", 4, 4],
						["w-5", 5, 5],
					]);
					expect(yield* ledger.append("a", "w-5", line())).toEqual(placed(5, 5));
					expect(yield* ledger.append("b", "w-1", line())).toEqual(placed(6, 1));
					expect(rang).toEqual([{to: READER, stream: "b", rev: 6}]);
				}).pipe(Effect.provide(onSql(nodeSql(openDb(path)), layer)));
			}),
	);

	// Live, not under TestClock: the test clock's scheduler holds a yielded fiber until the clock moves.
	// The plan asks for a yield after every op, `MaxOpsBeforeYield` 1. On effect 4.1.1, 1 hangs even a
	// plain `Effect.forEach` of three fibers and 2 never finishes it (measured 2026-11-07), so this
	// takes 3, the smallest that runs: a fiber still yields every few ops.
	law(
		"many writers at once, as fibers that yield every few ops, all place with no rev or pos twice",
		(line, n, _t, streams) =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				const made = n === 300 ? 60 : 1 + (n % 80);
				const writes = Array.from({length: made}, (_, i) => i);
				const answers = yield* Effect.forEach(
					writes,
					(i) => ledger.append(`s${i % streams}`, `w-${i}`, line({body: i})),
					{concurrency: "unbounded"},
				).pipe(Effect.provideService(References.MaxOpsBeforeYield, 3));
				const revs = answers.map((answer) => (answer._tag === "placed" ? answer.rev : -1));
				expect([...revs].sort((x, y) => x - y)).toEqual(writes.map((i) => i + 1));
				for (const stream of Array.from({length: streams}, (_, i) => `s${i}`)) {
					const entries = yield* readAll(stream);
					expect(entries.map((e) => e.pos)).toEqual(
						Array.from(
							{length: writes.filter((i) => `s${i % streams}` === stream).length},
							(_, i) => i + 1,
						),
					);
					expect(entries.map((e) => e.rev)).toEqual(
						[...entries.map((e) => e.rev)].sort((x, y) => x - y),
					);
				}
			}).pipe(Effect.provide(onSql(fresh())), TestClock.withLive),
	);
});

describe("p93, seen is bounded by the log's head", () => {
	law(
		"seen past the head is refused seen_ahead and nothing is written; seen at the head is placed",
		(line) =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("a", "w-1", line({seen: 1}))).toEqual(refused("seen_ahead"));
				expect(yield* ledger.append("a", "w-2", line({seen: 0}))).toEqual(placed(1, 1));
				expect(yield* ledger.append("a", "w-3", line({seen: 1}))).toEqual(placed(2, 2));
				expect(yield* ledger.append("a", "w-4", line({seen: 3}))).toEqual(refused("seen_ahead"));
				expect(yield* ledger.append("a", "w-5", line({seen: 50}))).toEqual(refused("seen_ahead"));
				expect((yield* readAll("a")).map((e) => e.id)).toEqual(["w-2", "w-3"]);
				expect(yield* ledger.append("a", "w-6", line({seen: 2}))).toEqual(placed(3, 3));
			}).pipe(Effect.provide(onSql(fresh()))),
	);

	law("seen is checked against the whole log's head, not its stream's newest", (line) =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			yield* ledger.append("a", "w-1", line());
			yield* ledger.append("b", "w-1", line());
			yield* ledger.append("b", "w-2", line());
			expect(yield* ledger.append("a", "w-2", line({seen: 3}))).toEqual(placed(4, 2));
			expect(yield* ledger.append("c", "w-1", line({seen: 4}))).toEqual(placed(5, 1));
			expect(yield* ledger.append("a", "w-3", line({seen: 6}))).toEqual(refused("seen_ahead"));
		}).pipe(Effect.provide(onSql(fresh()))),
	);

	it.effect.prop(
		"for any interleaving of writers, a line is placed exactly when seen is at most the head, and every entry has seen < rev",
		{writes: Inputs.seen},
		({writes}) =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				let head = 0;
				for (const [i, {stream, offset}] of writes.entries()) {
					const seen = Math.max(0, head + offset);
					const answer = yield* ledger.append(stream, `w-${i}`, line({seen}));
					expect(answer).toEqual(
						seen > head ? refused("seen_ahead") : placed(head + 1, expect.any(Number)),
					);
					if (answer._tag === "placed") head = answer.rev;
				}
				const entries = [...(yield* readAll("a")), ...(yield* readAll("b"))];
				expect(entries).toHaveLength(head);
				expect(entries.filter((e) => e.seen >= e.rev)).toEqual([]);
			}).pipe(Effect.provide(onSql(fresh())), Effect.ensuring(closeOpened)),
		{arbitrary: {seed: SEED, runs: 60, size: 4096}, timeout: 60000},
	);
});

describe("p19, read is a lazy Stream, and arrivedAt is the referee's Clock", () => {
	law(
		"making the read Stream reads nothing, and take(1) asks for one page only",
		(line, n) => {
			const {sql, calls} = counting(fresh());
			const {tracer, ended} = capture();
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				for (let i = 1; i <= n; i++) yield* ledger.append("a", `w-${i}`, line());
				const before = calls();
				const stream = ledger.read("a", 0);
				expect(calls()).toBe(before);
				expect(ended("ledger.read")).toHaveLength(0);
				const one = yield* Stream.runCollect(Stream.take(stream, 1));
				expect(one.map((e) => e.rev)).toEqual(n === 0 ? [] : [1]);
				expect(ended("ledger.read")).toHaveLength(1);
				const all = yield* Stream.runCollect(stream);
				expect(all.map((e) => e.rev)).toEqual(Array.from({length: n}, (_, i) => i + 1));
			}).pipe(Effect.provide(onSql(sql)), Effect.withTracer(tracer));
		},
		10,
	);

	law("arrivedAt is the Clock's time, and never goes back when the clock does", (line, _n, t) =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			yield* TestClock.setTime(t);
			yield* ledger.append("a", "w-1", line());
			yield* TestClock.adjust(Duration.millis(37));
			yield* ledger.append("b", "w-1", line());
			yield* TestClock.setTime(t - 60_000);
			yield* ledger.append("a", "w-2", line());
			yield* TestClock.setTime(t + 100);
			yield* ledger.append("a", "w-3", line());
			const a = yield* readAll("a");
			const b = yield* readAll("b");
			expect(a.map((e) => e.arrivedAt)).toEqual([t, t + 37, t + 100]);
			expect(b.map((e) => e.arrivedAt)).toEqual([t + 37]);
		}).pipe(Effect.provide(onSql(fresh()))),
	);

	describe("sentAt reads back as the writer sent it, byte for byte", () => {
		const examples = [
			"2026-11-07T23:12:04.5+03:00",
			"07/11/2026 23:12",
			"٢٠٢٦-١١-٠٧",
			"1762549801311",
		];
		const check = (sent: ReadonlyArray<string>) =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				for (const [i, sentAt] of sent.entries())
					yield* ledger.append("a", `w-${i}`, line({sentAt}));
				expect((yield* readAll("a")).map((e) => e.sentAt)).toEqual(sent);
			}).pipe(
				Effect.provide(onSql(fresh())),
				Effect.provide(TestClock.layer()),
				Effect.ensuring(closeOpened),
			);
		beforeEach(() => Effect.runPromise(check(examples)));
		it.effect.prop(
			"sentAt reads back as the writer sent it, byte for byte",
			{sent: Arbitrary.array(text(0, 4096), {minLength: 1, maxLength: 40})},
			({sent}) => check(sent),
			{arbitrary: {seed: SEED, runs: 60, size: 4096}, timeout: 60000},
		);
	});
});

describe("p20, failures are typed, and pass", () => {
	law(
		"a stub whose calls reject gives unreachable on append, read and wait",
		(line, n, t, _streams, _sent, retry) => {
			const message = retry.sentAt.slice(0, 256);
			const error =
				n % 7 === 0
					? new Error(message)
					: n % 7 === 1
						? new TypeError(message)
						: n % 7 === 2
							? line().sentAt
							: n % 7 === 3
								? signed32(t)
								: n % 7 === 4
									? null
									: n % 7 === 5
										? undefined
										: line().body;
			const reject = () =>
				Promise.reject(line === fixedLine ? new Error("the object went away") : error);
			const stub: LedgerCalls = {append: reject, read: reject, wait: reject};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const errors = [
					yield* Effect.flip(ledger.append("a", "w-1", line())),
					yield* Effect.flip(Stream.runCollect(ledger.read("a", 0))),
					yield* Effect.flip(ledger.wait("a", 0)),
				];
				for (const error of errors) expect(error).toBeInstanceOf(LedgerError);
				expect(errors.map((error) => error.why)).toEqual([
					"unreachable",
					"unreachable",
					"unreachable",
				]);
			}).pipe(Effect.provide(Ledger.remote(stub, {reader: READER})));
		},
	);

	law(
		"a stub that answers what does not decode gives bad_row on append, read and wait",
		(line, n) => {
			const bad =
				n % 4 === 0
					? line().sentAt
					: n % 4 === 1
						? null
						: n % 4 === 2
							? {payload: line().body}
							: [line().body, {broken: true}];
			const stub: LedgerCalls = {
				append: () => Promise.resolve(line === fixedLine ? {_tag: "placed", rev: "one"} : bad),
				read: () => Promise.resolve(line === fixedLine ? [{id: "w-1"}] : bad),
				wait: () => Promise.resolve(line === fixedLine ? {_tag: "soon"} : bad),
			};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				const errors = [
					yield* Effect.flip(ledger.append("a", "w-1", line())),
					yield* Effect.flip(Stream.runCollect(ledger.read("a", 0))),
					yield* Effect.flip(ledger.wait("a", 0)),
				];
				for (const error of errors) expect(error).toBeInstanceOf(LedgerError);
				expect(errors.map((error) => error.why)).toEqual(["bad_row", "bad_row", "bad_row"]);
			}).pipe(Effect.provide(Ledger.remote(stub, {reader: READER})));
		},
	);

	law(
		"a stub that answers well is decoded, and the reader's name rides on each read and wait",
		(line, _n, _t, _streams, _sent, retry) => {
			const readerName = line === fixedLine ? READER : retry.by;
			const page = [{id: "w-1", stream: "a", pos: 1, rev: 1, arrivedAt: 1762549801311, ...line()}];
			const asked: Array<readonly [string, string, number, string]> = [];
			const stub: LedgerCalls = {
				append: () => Promise.resolve({_tag: "placed", rev: 1, pos: 1}),
				read: (stream, after, reader) => {
					asked.push(["read", stream, after, reader]);
					return Promise.resolve(page.filter((entry) => entry.rev > after));
				},
				wait: (stream, after, reader) => {
					asked.push(["wait", stream, after, reader]);
					return Promise.resolve({_tag: "parked"});
				},
			};
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("a", "w-1", line())).toEqual(placed(1, 1));
				expect(yield* Stream.runCollect(ledger.read("a", 0))).toEqual(page);
				expect(yield* ledger.wait("a", 1)).toEqual({_tag: "parked"});
				expect(asked[0]).toEqual(["read", "a", 0, readerName]);
				expect(asked.at(-1)).toEqual(["wait", "a", 1, readerName]);
				expect(asked.every(([, , , reader]) => reader === readerName)).toBe(true);
			}).pipe(Effect.provide(Ledger.remote(stub, {reader: readerName})));
		},
	);

	law(
		"a SQL throw on one call gives storage, and the next call on the same runtime works",
		(line) =>
			Effect.promise(async () => {
				const {sql, arm} = throwingOnce(fresh());
				const runtime = ManagedRuntime.make(onSql(sql));
				const append = (id: string) => Ledger.use((ledger) => ledger.append("a", id, line()));
				expect(await runtime.runPromise(append("w-1"))).toEqual(placed(1, 1));
				arm();
				const failed = await runtime.runPromise(Effect.flip(append("w-2")));
				expect(failed).toBeInstanceOf(LedgerError);
				expect(failed.why).toBe("storage");
				expect(await runtime.runPromise(append("w-3"))).toEqual(placed(2, 2));
				arm();
				const read = await runtime.runPromise(Effect.flip(readAll("a")));
				expect(read.why).toBe("storage");
				arm();
				const waited = await runtime.runPromise(
					Effect.flip(Ledger.use((ledger) => ledger.wait("a", 9))),
				);
				expect(waited.why).toBe("storage");
				expect((await runtime.runPromise(readAll("a"))).map((e) => e.id)).toEqual(["w-1", "w-3"]);
				await runtime.dispose();
			}),
	);

	for (const [label, thrown] of [
		["an Error", sqliteFull()],
		["text", "disk full"],
		["a number", 13],
		["null", null],
		["undefined", undefined],
	] as const)
		law(
			`no Layer fails at build: a Sql throwing ${label} still builds, and each call answers storage`,
			(line, n, t, _streams, _sent, retry) =>
				Effect.gen(function* () {
					const ledger = yield* Ledger;
					const errors = [
						yield* Effect.flip(ledger.append("a", "w-1", line())),
						yield* Effect.flip(Stream.runCollect(ledger.read("a", 0))),
						yield* Effect.flip(ledger.wait("a", 0)),
					];
					for (const error of errors) expect(error).toBeInstanceOf(LedgerError);
					expect(errors.map((error) => error.why)).toEqual(["storage", "storage", "storage"]);
				}).pipe(
					Effect.provide(
						onSql({
							exec: () => {
								const value =
									line === fixedLine
										? thrown
										: label === "text"
											? retry.sentAt
											: label === "a number"
												? signed32(t)
												: label === "an Error"
													? Object.assign(
															new Error(retry.sentAt.slice(0, 256)),
															n % 3 === 0
																? {code: retry.by.slice(0, 64)}
																: n % 3 === 1
																	? {errcode: signed32(t)}
																	: {},
														)
													: thrown;
								throw value;
							},
							transaction: (step) => step(),
							size: () => 0,
						}),
					),
				),
		);

	law(
		"a stored row that does not decode gives bad_row, not storage, on a read and on its id's resend",
		(line) => {
			const db = openDb(freshPath());
			// Rows the referee never wrote, planted past it straight in SQLite: one whose body is not
			// JSON, one whose `_tag` is empty. Every other column holds what an entry may hold.
			const plant = (rev: number, stream: string, id: string, kind: string, body: string) =>
				db
					.prepare(
						`INSERT INTO entries (rev, stream, pos, id, "arrivedAt", "by", "for", "sentAt", seen,
							parent, "traceId", build, "_tag", body) VALUES (?, ?, 1, ?, 0, 'SHA256:writer-a', 'owner', 'x', 0,
							NULL, ?, 'b-7c1d073', ?, ?)`,
					)
					.run(rev, stream, id, TRACE, kind, body);
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				expect(yield* ledger.append("ok", "w-1", line())).toEqual(placed(1, 1));
				plant(2, "a", "w-2", "saved", "{not json");
				plant(3, "b", "w-3", "", JSON.stringify({note: "n-7f3a"}));
				const errors = [
					yield* Effect.flip(readAll("a")),
					yield* Effect.flip(readAll("b")),
					yield* Effect.flip(ledger.append("a", "w-2", line())),
					yield* Effect.flip(ledger.append("b", "w-3", line())),
				];
				for (const error of errors) expect(error).toBeInstanceOf(LedgerError);
				expect(errors.map((error) => error.why)).toEqual([
					"bad_row",
					"bad_row",
					"bad_row",
					"bad_row",
				]);
				// The rows that do decode still read.
				expect((yield* readAll("ok")).map((e) => e.id)).toEqual(["w-1"]);
			}).pipe(Effect.provide(onSql(nodeSql(db))));
		},
	);

	law(
		"a wait leaves nothing running: Effect.runSync of a parking wait answers parked",
		(_line, _n, _t, _streams, stream) =>
			Effect.sync(() => {
				const outcome = Effect.runSyncExit(
					Effect.try({
						try: () =>
							Effect.runSync(
								Ledger.use((ledger) => ledger.wait(stream || "a", 0)).pipe(
									Effect.provide(onSql(fresh())),
								),
							),
						catch: (cause) => new Error("parking wait failed", {cause}),
					}),
				);
				expect(Exit.isSuccess(outcome), "parking must finish synchronously").toBe(true);
				if (Exit.isSuccess(outcome)) {
					const answer = outcome.value;
					expect(answer).toEqual({_tag: "parked"});
				}
			}),
	);
});

// The plan's "what this piece records": P6 gives `Sql.size()` and its Node half, page_count times
// page_size, for P37's hourly size row (how close the one object is to 10 GB; experiment 224).
describe("Sql.size on node:sqlite, the object's bytes for P37's size row", () => {
	law(
		"answers the file's bytes, positive once the ledger is used, and grows with writes",
		(line) => {
			const path = freshPath();
			const sql = nodeSql(openDb(path));
			return Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.append("a", "w-0", line());
				const first = sql.size();
				expect(first).toBeGreaterThan(0);
				// With SQLite's default rollback journal, the file holds exactly page_count pages.
				expect(first).toBe(statSync(path).size);
				for (let n = 1; n <= 50; n++)
					yield* ledger.append("a", `w-${n}`, line({body: {note: "x".repeat(4_000)}}));
				const after = sql.size();
				expect(after).toBeGreaterThan(first + 50 * 4_000);
				expect(after).toBe(statSync(path).size);
			}).pipe(Effect.provide(onSql(sql)));
		},
	);
});
