// P12, next/. Corrupt saved rows at each synchronous decoder in the changed record files.
import {DatabaseSync} from "node:sqlite";
import {Cause, Effect, Exit, Layer} from "effect";
import * as fc from "fast-check";
import {expect, it} from "vitest";
import {Archive} from "./archive.ts";
import {recordPart, RecordManager} from "./records.ts";
import type {Sql} from "./referee.ts";
import {SpanSink} from "./sink.ts";
import {nodeSql} from "./sqlite.ts";
import type {SpanRow} from "./trace.ts";

const span: SpanRow = {
	spanId: "00f067aa0ba902b7",
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	parentSpanId: null,
	name: "parse.test",
	kind: "internal",
	startTimeUnixNano: "1",
	endTimeUnixNano: "2",
	attributes: {},
	events: [],
	links: [],
	resource: {attributes: {"fab.object": "parse-test"}},
	ok: true,
};

const typed = (exit: Exit.Exit<unknown, unknown>) => {
	expect(Exit.isFailure(exit)).toBe(true);
	const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
	expect(Cause.hasDies(cause)).toBe(false);
	expect(Cause.hasFails(cause)).toBe(true);
	expect(Cause.findErrorOption(cause)).toMatchObject({
		_tag: "Some",
		value: {_tag: "SinkError", reason: "bad_row"},
	});
};

for (const reader of ["span", "seq", "state", "kept", "deleted", "rolled"] as const) {
	it(`record ${reader} decoder refuses malformed disk rows with a typed failure`, async () => {
		await fc.assert(
			fc.asyncProperty(fc.string(), async (text) => {
				const db = new DatabaseSync(":memory:"),
					real = nodeSql(db);
				let corrupt = false;
				// SQLite's rowid is always an integer. Plant a bad adapter answer for its seq decoder.
				const sql: Sql = {
					...real,
					exec: (query, ...args) => {
						const rows = real.exec(query, ...args);

						if (corrupt && reader === "kept" && query.includes("SELECT * FROM content")) {
							return rows.map((r) => ({...r, message: text.length}));
						}

						return corrupt && reader === "seq" && query.includes("rowid AS seq")
							? rows.map((r) => ({...r, seq: text}))
							: rows;
					},
				};

				try {
					const part = recordPart(sql, {_tag: "spans"}, 0, 1_000_000_000);
					await Effect.runPromise(part.write([{span, content: "deletable message"}]));

					if (reader === "span") {
						db.prepare("UPDATE spans SET attributes=?").run(`${text}!`);
					}

					if (reader === "state") {
						db.prepare("UPDATE content SET state=?").run(`unknown-${text}`);
					}

					if (reader === "deleted") {
						db.prepare(
							"UPDATE content SET state='deleted', at=?, \"by\"='actor', reason='requested'",
						).run(`bad-${text}`);
					}

					if (reader === "rolled") {
						db.prepare("INSERT INTO rolled (one,part,next,bytes) VALUES (1,?,?,?)").run(
							`bad-${text}`,
							"spans/1",
							1,
						);
					}

					corrupt = true;
					typed(
						await Effect.runPromiseExit(
							["state", "kept", "deleted"].includes(reader)
								? part.content(span.spanId).pipe(Effect.asVoid)
								: part.read(0).pipe(Effect.asVoid),
						),
					);
				} finally {
					db.close();
				}
			}),
			{seed: 119120, numRuns: 20},
		);
	});
}

for (const reader of ["chain", "row", "part"] as const) {
	it(`sink ${reader} decoder refuses malformed saved rows and keeps the unsent span`, async () => {
		await fc.assert(
			fc.asyncProperty(fc.string(), async (text) => {
				const db = new DatabaseSync(":memory:"),
					sql = nodeSql(db);

				try {
					await Effect.runPromise(
						Effect.gen(function* () {
							yield* Effect.void.pipe(Effect.withSpan("parse.test"));

							if (reader === "part") {
								db.prepare("INSERT INTO parts (chain,part) VALUES ('spans',?)").run(`bad-${text}`);
							} else {
								db.prepare(`UPDATE unsent SET ${reader}=?`).run(`${text}!`);
							}

							typed(yield* SpanSink.use((sink) => sink.flush).pipe(Effect.exit));
							expect(db.prepare("SELECT count(*) AS n FROM unsent").get()?.n).toBe(1);
						}).pipe(
							Effect.provide(
								Layer.mergeAll(
									SpanSink.layer(sql, {object: "parse-test"}),
									RecordManager.memory(1_000_000_000),
									Archive.memory,
								),
							),
						),
					);
				} finally {
					db.close();
				}
			}),
			{seed: 119120, numRuns: 20},
		);
	});
}
