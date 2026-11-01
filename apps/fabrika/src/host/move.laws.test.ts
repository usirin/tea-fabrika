import {
	byOf,
	type Db,
	importChunk,
	MEMBERS,
	migrateMove,
	moveProgress,
	type Progress,
	type Row,
	Rows,
	read,
	register,
	append as rulesAppend,
	sealMove,
	writerFor,
	writeUnguarded,
} from "@kampus/fabrika-old";
import {openDb} from "@kampus/fabrika-old/sqlite";
import {fold, ROOT, readRow} from "@tea-fabrika/tracker";
import {Effect, Layer, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {copyInto, LinkDropped, MoveStopped, MoveTarget} from "./move.ts";

// The move's law: any tracker streams, moved in chunks of any size over a link that may drop
// mid-copy and then resume, fold to the same tickets on the new ledger as on the old one, with
// every writer mapped to the founder. The server's side is its own window on node:sqlite in this
// process (`importChunk`, `sealMove`), the same code the Durable Object runs.

const FOUNDER = "github:7";
const alice = {kind: "user", id: FOUNDER} as const;

const WRITERS = ["user:owner", "user:github:7", "agent:x", "agent:y for:github:7"] as const;

/** One write a tracker could have made: a fact on a ticket, by someone, maybe not fitting. */
const arbOp = fc.record({
	ticket: fc.integer({min: 1, max: 4}),
	writer: fc.constantFrom(...WRITERS),
	fact: fc.oneof(
		fc.record({type: fc.constant("filed"), title: fc.constantFrom("A", "B c"), body: fc.string()}),
		fc.record({type: fc.constant("commented"), body: fc.constantFrom("ok", "seen it", " x ")}),
		fc.constant({type: "closed"}),
		fc.constant({type: "reopened"}),
		fc.record({
			type: fc.constant("asked"),
			ask: fc.constantFrom("a-1", "a-2"),
			what: fc.constant("Go?"),
			picks: fc.constant(["yes", "no"]),
		}),
		fc.record({
			type: fc.constant("answered"),
			ask: fc.constantFrom("a-1", "a-2"),
			pick: fc.constantFrom("yes", "maybe"),
			note: fc.constant(""),
		}),
	),
});

/** A laptop ledger with these writes, as the tracker makes them, among a host's own rows. */
type Op = typeof arbOp extends fc.Arbitrary<infer T> ? T : never;

const laptop = (ops: readonly Op[]) => {
	const {db} = openDb(":memory:");
	register(db, 1, "host/h1", "h1");
	let t = 1000;
	ops.forEach((op, i) => {
		const name = `${ROOT}/${op.ticket}`;
		register(db, t++, name, op.writer);
		// Only a person answers: the tracker refuses an agent's, and so does the door.
		const writer = op.fact.type === "answered" ? "user:owner" : op.writer;
		rulesAppend(db, t++, `${name}/inbox`, "any", {
			kind: op.fact.type,
			writer,
			data: op.fact,
			id: `w${i}`,
		});
		if (i % 3 === 0)
			rulesAppend(db, t++, "host/h1/inbox", "any", {kind: "tick", writer: "h1", data: {}});
	});
	return db;
};

const server = () => {
	const {db} = openDb(":memory:");
	migrateMove(db);
	writeUnguarded(db, 1, MEMBERS, "any", {
		kind: "founded",
		writer: `user:${FOUNDER}`,
		data: {id: FOUNDER, name: "alice"},
	});
	return db;
};

const answer = <T>(r: {ok: true; value: {progress: T}} | {ok: false; why: string}) =>
	r.ok ? Effect.succeed(r.value.progress) : Effect.fail(new MoveStopped({why: r.why}));

const target = (db: Db, drop: number | null) => {
	let landed = 0;
	return Layer.succeed(
		MoveTarget,
		MoveTarget.of({
			founder: FOUNDER,
			progress: Effect.sync(() => moveProgress(db)),
			send: (events) =>
				Effect.suspend((): Effect.Effect<Progress, MoveStopped | LinkDropped> => {
					if (drop !== null && landed >= drop) return Effect.fail(new LinkDropped({why: "gone"}));
					landed++;
					return answer(importChunk(db, FOUNDER, alice, {events}));
				}),
			seal: (seal) =>
				Effect.tryPromise({
					try: () => sealMove(db, FOUNDER, alice, seal, 9),
					catch: (e) => new MoveStopped({why: String(e)}),
				}).pipe(Effect.flatMap(answer)),
		}),
	);
};

/** The tickets a ledger's rows fold to, less where each row sits: `pos` is the new ledger's own. */
const ticketsOf = (rows: readonly Row[]) => {
	const entries = rows.flatMap((r) => {
		const x = readRow(r);
		return x.kind === "entry" ? [x.entry] : [];
	});
	const folded = fold([], entries);
	return {
		tickets: folded.tickets.map((t) => ({...t, timeline: t.timeline.map(({pos: _, ...e}) => e)})),
		problems: folded.problems.map((p) => p.replace(/^row \d+/, "row")),
	};
};

const decodeRows = Schema.decodeUnknownSync(Rows);

const rowsOf = (db: Db, mapped: boolean): Row[] =>
	decodeRows(read(db, 0, 1_000_000, ROOT)).map((row) => {
		const by = byOf(row.writer, FOUNDER);
		return mapped && by !== null ? {...row, writer: writerFor(by, FOUNDER)} : row;
	});

describe("a moved ledger folds as the old one did", () => {
	it("for any tracker streams, chunk size and dropped link", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(arbOp, {maxLength: 40}),
				fc.integer({min: 1, max: 7}),
				fc.option(fc.integer({min: 0, max: 5}), {nil: null}),
				async (ops, chunk, drop) => {
					const old = laptop(ops);
					const rows = read(old, 0, 1_000_000, ROOT);
					const db = server();
					if (drop !== null)
						await Effect.runPromise(
							copyInto(rows, {chunk, pauseMs: 1}).pipe(
								Effect.provide(target(db, drop)),
								Effect.ignore,
							),
						);
					const done = await Effect.runPromise(
						copyInto(rows, {chunk}).pipe(Effect.provide(target(db, null))),
					);
					expect(done.progress.state).toMatchObject({kind: "open", by: "seal"});
					expect(ticketsOf(rowsOf(db, false))).toEqual(ticketsOf(rowsOf(old, true)));
				},
			),
			{numRuns: 60, seed: 145},
		);
	});
});
