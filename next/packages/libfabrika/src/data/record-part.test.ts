// P12, next/. A single real SQLite part, reopened as an object would be on storage wake.
// P37 already owns manager traversal. Here the new adapter must not alias multiple parts.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import * as fc from "fast-check";
import type {Sql} from "./referee.ts";
import {nodeSql} from "./sqlite.ts";
import type {SpanRow} from "./trace.ts";

type Lookup = {_tag: "found"; content: unknown} | {_tag: "absent"; rolled: boolean};

type Part = {
	write: (
		rows: ReadonlyArray<{span: SpanRow; content: string | null}>,
	) => Effect.Effect<unknown, unknown>;
	read: (
		after: number,
	) => Effect.Effect<{spans: ReadonlyArray<SpanRow>; after: number; rolled: boolean}, unknown>;
	content: (span: string) => Effect.Effect<Lookup, unknown>;
	deleteContent: (
		span: string,
		by: {by: string; at: number; why: string},
	) => Effect.Effect<Lookup, unknown>;
};

const home = mkdtempSync(join(tmpdir(), "p12-r-"));
const SEED = 119120;
const pageBoundary: [number, string, number] = [503, "private failure", 42];
const rollAtCap: [number[], number, number] = [[1, 2], 1000, 0];
afterAll(() => rmSync(home, {recursive: true, force: true}));

const span = (n: number): SpanRow => ({
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	spanId: n.toString(16).padStart(16, "0"),
	parentSpanId: null,
	name: "runner.step",
	kind: "internal",
	startTimeUnixNano: "1794096000000000000",
	endTimeUnixNano: "1794096000001000000",
	attributes: {},
	events: [],
	links: [],
	resource: {attributes: {"fab.object": "record-test"}},
	ok: true,
});

describe("P12 single record part", () => {
	it("P37 wiring plant: reopen, page past 500, and retry without duplicating a span", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 501, max: 550}),
				fc.string(),
				fc.nat(),
				(total, content, at) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const {recordPart} = yield* Effect.promise(() => import("./record-part.ts"));
							const file = join(home, `page-${total}-${at}.sqlite`);
							rmSync(file, {force: true});
							let db = new DatabaseSync(file);
							try {
								let part: Part = recordPart(nodeSql(db), {_tag: "spans"}, 0, 1_000_000_000);
								const rows = Array.from({length: total}, (_, n) => ({
									span: span(n),
									content: n === total - 1 ? content : null,
								}));
								expect(yield* part.write(rows)).toEqual({_tag: "written"});
								db.close();
								db = new DatabaseSync(file);
								part = recordPart(nodeSql(db), {_tag: "spans"}, 0, 1_000_000_000);
								expect(yield* part.write(rows)).toEqual({_tag: "written"});
								const first = yield* part.read(0);
								const last = yield* part.read(first.after);
								expect(first.spans).toEqual(rows.slice(0, 500).map((r) => r.span));
								expect(last.spans).toEqual(rows.slice(500).map((r) => r.span));
								expect(yield* part.content(span(total - 1).spanId)).toMatchObject({
									_tag: "found",
									content: {_tag: "kept", message: content},
								});
								const by = {by: "person-test", at, why: "requested"};
								yield* part.deleteContent(span(total - 1).spanId, by);
								yield* part.deleteContent(span(total - 1).spanId, {...by, at: at + 1});
								expect(yield* part.content(span(total - 1).spanId)).toMatchObject({
									_tag: "found",
									content: {_tag: "deleted", ...by},
								});
								expect((yield* part.read(500)).spans).toHaveLength(total - 500);
							} finally {
								db.close();
							}
						}),
					),
			),
			{seed: SEED, numRuns: 20, examples: [pageBoundary]},
		);
	});
	it("P37 wiring plant: check held IDs before cap, return had, keep each part separate", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.uniqueArray(fc.nat(), {minLength: 2, maxLength: 2}),
				fc.integer({min: 1, max: 1_000_000}),
				fc.nat({max: 1000}),
				([oldId, freshId], cap, index) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const {recordPart} = yield* Effect.promise(() => import("./record-part.ts"));
							const a = new DatabaseSync(":memory:");
							const b = new DatabaseSync(":memory:");
							let size = 0;
							const inner = nodeSql(a);
							const sql: Sql = {...inner, size: () => size};
							try {
								const first: Part = recordPart(sql, {_tag: "spans"}, index, cap);
								const next: Part = recordPart(
									nodeSql(b),
									{_tag: "spans"},
									index + 1,
									1_000_000_000,
								);
								const old = {span: span(oldId!), content: null};
								const fresh = {span: span(freshId!), content: null};
								yield* first.write([old]);
								size = cap;
								expect(yield* first.write([old])).toEqual({_tag: "written"});
								expect(yield* first.write([old, fresh])).toEqual({
									_tag: "rolled",
									next: `spans/${index + 1}`,
									had: [old.span.spanId],
								});
								yield* next.write([fresh]);
								expect((yield* first.read(0)).spans).toEqual([old.span]);
								expect((yield* next.read(0)).spans).toEqual([fresh.span]);
								expect(yield* first.content(fresh.span.spanId)).toEqual({
									_tag: "absent",
									rolled: true,
								});
							} finally {
								a.close();
								b.close();
							}
						}),
					),
			),
			{seed: SEED, examples: [rollAtCap]},
		);
	});
});
