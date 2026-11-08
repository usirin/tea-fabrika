// P13, next/. Expected history comes from independently authored ledger entries, never notes.save.
import {readFileSync} from "node:fs";
import {describe, expect, it} from "@effect/vitest";
import {stepper} from "@kampus/libfabrika";
import {Entry} from "@kampus/libfabrika/data";
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const fields = (n: number) => ({
	id: `input_0000000000e00800000000000${n}`,
	stream: "notes:1/inbox",
	rev: n * 2,
	pos: n,
	by: n % 2 ? "SHA256:person" : "SHA256:agent",
	for: `person-${n % 2}`,
	arrivedAt: 1000 + n,
	sentAt: `writer-clock-${10 - n}`,
	seen: n - 1,
	parent: null,
	traceId: TRACE,
	build: `build-${n}`,
});
const entry = (n: number, note: string, base: number, body: string) => ({
	...fields(n),
	_tag: "send",
	body: {
		m: {
			type: "save",
			value: {
				note,
				base,
				body,
				...(n % 2 ? {how: "kept", from: {note: "source", version: 3}} : {}),
			},
		},
	},
});
const entries = [
	entry(1, "a", 0, "# First\n  \r\n🙂"),
	entry(2, "b", 0, "שלום\n"),
	entry(3, "a", 1, ""),
];
// The plan permits Result or Effect failures. Both must decode untrusted saved data without throws.
type Checked = Effect.Effect<unknown, unknown> | Result.Result<unknown, unknown>;
const result = async (answer: Checked): Promise<unknown> => {
	if (Effect.isEffect(answer)) return Effect.runPromise(answer);
	expect(Result.isResult(answer), "history returns a checked Result or Effect").toBe(true);
	if (!Result.isResult(answer)) throw new Error("unchecked history answer");
	expect(Result.isSuccess(answer)).toBe(true);
	return Result.isSuccess(answer) ? answer.success : undefined;
};
const failed = async (answer: Checked) => {
	if (Effect.isEffect(answer)) return Effect.runPromise(Effect.flip(answer));
	expect(Result.isResult(answer)).toBe(true);
	if (!Result.isResult(answer)) throw new Error("unchecked history failure");
	expect(Result.isFailure(answer)).toBe(true);
	return Result.isFailure(answer) ? answer.failure : undefined;
};

describe("p55 checked notes history", () => {
	it("plant: retain only the latest version, sort by sender clock, or drop ledger metadata", async () => {
		const {history} = await import("./history.ts");
		for (let again = 0; again < 3; again++) {
			const versions = await result(history(entries, "a"));
			expect(versions).toMatchObject([
				{
					...fields(1),
					note: "a",
					version: 1,
					body: "# First\n  \r\n🙂",
					how: "kept",
					from: {note: "source", version: 3},
				},
				{
					...fields(3),
					note: "a",
					version: 2,
					body: "",
					how: "kept",
					from: {note: "source", version: 3},
				},
			]);
		}
		expect(await result(history(entries, "b"))).toMatchObject([
			{
				note: "b",
				version: 1,
				body: "שלום\n",
				by: "SHA256:agent",
				sentAt: "writer-clock-8",
				arrivedAt: 1002,
			},
		]);
		expect(await result(history(entries, "absent"))).toEqual([]);
	});
	it("plant: lose versions at a page boundary, trim bodies, or use a global version", async () => {
		const {history} = await import("./history.ts");
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.string({maxLength: 80}), {minLength: 2, maxLength: 40}),
				async (bodies) => {
					const rows = bodies.map((body, n) => ({
						...entry(1, "a", n, body),
						...fields(n + 1),
						id: `input_0000000000e0080000000${String(n + 1).padStart(5, "0")}`,
					}));
					const expected = bodies.map((body, n) => ({
						version: n + 1,
						body,
						by: fields(n + 1).by,
						sentAt: fields(n + 1).sentAt,
						arrivedAt: fields(n + 1).arrivedAt,
					}));
					// Callers supply one page at a time; base + 1 remains correct without earlier pages.
					for (let cut = 1; cut < rows.length; cut++) {
						const first = await result(history(rows.slice(0, cut), "a"));
						const rest = await result(history(rows.slice(cut), "a"));
						expect([...(first as unknown[]), ...(rest as unknown[])]).toMatchObject(expected);
					}
				},
			),
			{seed: SEED, numRuns: 25},
		);
	});
	it("plant: silently skip malformed saved saves or throw while decoding them", async () => {
		const {history} = await import("./history.ts");
		const {notes} = await import("./program.ts");
		for (const value of [
			{note: "a", base: "0", body: "text"},
			{note: "a", base: 0},
			{note: "a", base: -1, body: "text"},
		]) {
			const broken = {...entry(2, "a", 1, ""), body: {m: {type: "save", value}}};
			let answer: Checked = Result.fail("history did not answer");
			expect(() => {
				answer = history([entries[0], broken, entries[2]], "a");
			}).not.toThrow();
			expect(await failed(answer)).toBeDefined();
			expect(() => stepper(notes).fold({notes: []}, broken.body.m)).toThrowError(
				expect.objectContaining({_tag: "ProgramDown", why: "saved_letter"}),
			);
		}
	});
	it("plant: reject additive fields or accept malformed saved metadata", async () => {
		const {history} = await import("./history.ts");
		const additive = {
			...entries[0],
			later: "extra",
			body: {m: {type: "save", value: {note: "a", base: 0, body: "text", later: 42}}},
		};
		expect(await result(history([additive], "a"))).toMatchObject([
			{note: "a", version: 1, body: "text"},
		]);
		for (const change of [
			{id: "not-a-TypeID"},
			{by: null},
			{sentAt: 12},
			{arrivedAt: "today"},
			{traceId: "bad"},
			{seen: -1},
		]) {
			let answer: Checked = Result.fail("history did not answer");
			expect(() => {
				answer = history([{...entries[0], ...change}], "a");
			}).not.toThrow();
			expect(await failed(answer)).toBeDefined();
		}
	});
	it("P8 p55 replay plant: recheck today's limit against yesterday's saved notes fixture", async () => {
		// P8 owns this file. Its absence is an unmet prerequisite, never permission to regenerate it.
		const text = readFileSync(
			new URL("../../../../fixtures/next/notes-letters.jsonl", import.meta.url),
			"utf8",
		);
		const rows = text
			.trim()
			.split("\n")
			.map((line) => Schema.decodeUnknownSync(Entry)(JSON.parse(line)));
		expect(rows.length).toBeGreaterThan(1);
		const {notes} = await import("./program.ts");
		const {history} = await import("./history.ts");
		let called = 0;
		const p = stepper({
			...notes,
			refuse: () => {
				called++;
				return {why: "too_long", most: 0};
			},
		});
		const saved = Schema.Struct({
			m: Schema.Struct({
				type: Schema.Literal("save"),
				value: Schema.Struct({note: Schema.String, base: Schema.Int, body: Schema.String}),
			}),
		});
		const oracle = new Map<string, {note: string; version: number; body: string}>();
		let order: string[] = [];
		for (const e of rows) {
			const s = Schema.decodeUnknownSync(saved)(e.body).m.value;
			oracle.set(s.note, {note: s.note, version: s.base + 1, body: s.body});
			order = [s.note, ...order.filter((id) => id !== s.note)];
		}
		for (let again = 0; again < 3; again++) {
			let model: unknown = {notes: []};
			for (const e of rows) {
				const one = p.fold(model, Schema.decodeUnknownSync(saved)(e.body).m);
				expect(one._tag).toBe("stepped");
				if (one._tag === "stepped") model = one.model;
			}
			expect(model).toEqual({notes: order.map((id) => oracle.get(id))});
		}
		expect(called).toBe(0);
		for (const note of order) {
			const expected = rows.filter(
				(e) => Schema.decodeUnknownSync(saved)(e.body).m.value.note === note,
			);
			const versions = (await result(history(rows, note))) as Array<{
				body: string;
				version: number;
			}>;
			expect(versions.map((v) => ({body: v.body, version: v.version}))).toEqual(
				expected.map((e) => {
					const s = Schema.decodeUnknownSync(saved)(e.body).m.value;
					return {body: s.body, version: s.base + 1};
				}),
			);
		}
	});
});
