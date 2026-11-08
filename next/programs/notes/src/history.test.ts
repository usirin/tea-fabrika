// T293, next/. P13 owns the projection; P20 fixes its checked Result contract.
import {Result, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";

const options = {seed: 119120, numRuns: 80};
describe("P20 notes history", () => {
	it("L23 mixed-note saved history preserves body, origin and every ledger field", async () => {
		const {history} = await import("./history.ts");
		const {Entry} = await import("@kampus/libfabrika/data");
		const {noteIds, bodies} = await import("./tile.test-support.ts");
		fc.assert(
			fc.property(
				fc.uniqueArray(noteIds, {minLength: 2, maxLength: 4}),
				fc.array(bodies, {minLength: 2, maxLength: 30}),
				(ids, texts) => {
					const note = ids[0];
					if (note === undefined) throw new Error("Generator requires notes");
					const counts = new Map<string, number>();
					const expected: Array<object> = [];
					const entries = texts.map((body, i) => {
						const id = ids[i % ids.length];
						if (id === undefined) throw new Error("Generator requires notes");
						const base = counts.get(id) ?? 0;
						counts.set(id, base + 1);
						const value = {note: id, base, body, how: "kept", from: {note, version: 1}};
						const entry = Schema.decodeUnknownSync(Entry)({
							id: `input_${id.slice(5, -2)}${"0123456789abcdefghjkmnpqrstvwxyz"[Math.floor(i / 32)]}${"0123456789abcdefghjkmnpqrstvwxyz"[i % 32]}`,
							stream: "notes:1/inbox",
							pos: i + 1,
							rev: i * 2 + 1,
							by: `writer-${i % 2}`,
							for: "person-test",
							arrivedAt: i + 1000,
							sentAt: `2026-11-08T00:00:${String(59 - i).padStart(2, "0")}Z`,
							seen: i,
							parent: null,
							traceId: "10000000000000000000000000000001",
							build: "test",
							_tag: "send",
							body: {m: {type: "save", value}},
						});
						if (id === note) expected.push({...entry, ...value, version: base + 1});
						return entry;
					});
					const answer = history(entries, note);
					expect(Result.isSuccess(answer)).toBe(true);
					if (Result.isSuccess(answer)) {
						expect(answer.success).toHaveLength(expected.length);
						for (const [i, version] of answer.success.entries())
							expect(version).toMatchObject(expected[i]);
					}
					const malformed = {
						...entries[0],
						body: {m: {type: "save", value: {note, base: "bad", body: texts[0]}}},
					};
					const failed = history([malformed], note);
					expect(Result.isFailure(failed)).toBe(true);
					if (Result.isFailure(failed))
						expect(failed.failure).toMatchObject({_tag: "NotesHistoryError", rev: entries[0]?.rev});
				},
			),
			options,
		);
	});
});
