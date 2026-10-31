import {DatabaseSync} from "node:sqlite";
import {describe, expect, it} from "vitest";
import {createLog, type Line, type Sql} from "./log.ts";

/** node:sqlite in the shape of `ctx.storage.sql`, so the same SQL runs here as on workerd. */
const memory = (): Sql => {
	const db = new DatabaseSync(":memory:");
	return {
		exec: (query, ...bindings) => {
			const statement = db.prepare(query);
			const rows = query.trimStart().startsWith("SELECT") ? statement.all(...bindings) : [];
			if (rows.length === 0 && !query.trimStart().startsWith("SELECT")) statement.run(...bindings);
			return {toArray: () => rows.map((r) => ({...r}))};
		},
	};
};

const line = (kind: string, body: unknown = {}): Line => ({by: "w1", said: "t0", kind, body});

describe("the log's numbers (D3)", () => {
	it("rev is the place in the whole log, pos the place in its stream", () => {
		const log = createLog(memory());
		expect(log.append("a", "1", line("x"), "t1")).toEqual({rev: 1, pos: 1, fresh: true});
		expect(log.append("b", "1", line("x"), "t2")).toEqual({rev: 2, pos: 1, fresh: true});
		expect(log.append("a", "2", line("x"), "t3")).toEqual({rev: 3, pos: 2, fresh: true});
		expect(log.append("b", "2", line("x"), "t4")).toEqual({rev: 4, pos: 2, fresh: true});
		expect(log.append("a", "3", line("x"), "t5")).toEqual({rev: 5, pos: 3, fresh: true});
	});

	it("saves a resend once, and answers with the first place", () => {
		const log = createLog(memory());
		log.append("a", "1", line("x"), "t1");
		log.append("a", "2", line("x"), "t2");
		expect(log.append("a", "1", line("changed"), "t9")).toEqual({rev: 1, pos: 1, fresh: false});
		expect(log.read("a", 0)).toHaveLength(2);
		expect(log.read("a", 0)[0]?.kind).toBe("x");
	});

	it("takes one id once per stream, not once in the whole log", () => {
		const log = createLog(memory());
		log.append("a", "1", line("x"), "t1");
		expect(log.append("b", "1", line("x"), "t2").fresh).toBe(true);
	});
});

describe("reading", () => {
	it("gives one stream's lines after a rev, whole and in order", () => {
		const log = createLog(memory());
		log.append("a", "1", line("x", {n: 1}), "t1");
		log.append("b", "1", line("x", {n: 2}), "t2");
		log.append("a", "2", line("x", {n: 3}), "t3");
		expect(log.read("a", 1)).toEqual([
			{
				id: "2",
				stream: "a",
				pos: 2,
				rev: 3,
				at: "t3",
				by: "w1",
				said: "t0",
				kind: "x",
				body: {n: 3},
			},
		]);
		expect(log.read("a", 3)).toEqual([]);
	});

	it("knows the last rev of a stream", () => {
		const log = createLog(memory());
		expect(log.head("a")).toBe(0);
		log.append("a", "1", line("x"), "t1");
		log.append("b", "1", line("x"), "t2");
		expect(log.head("a")).toBe(1);
		expect(log.head("b")).toBe(2);
	});

	it("keeps its lines when it is opened again", () => {
		const sql = memory();
		createLog(sql).append("a", "1", line("x"), "t1");
		expect(createLog(sql).append("a", "2", line("x"), "t2")).toEqual({rev: 2, pos: 2, fresh: true});
	});
});
