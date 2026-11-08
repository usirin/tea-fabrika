// P13, next/. Saved bytes come from P8. Generated expectations never call notes.save.
import {readFileSync} from "node:fs";
import {describe, expect, it} from "@effect/vitest";
import {Id, stepper} from "@kampus/libfabrika";
import {Entry} from "@kampus/libfabrika/data";
import {Result, Schema} from "effect";
import * as fc from "fast-check";

const options = {seed: 119120, numRuns: 30};
const InputId = Id.make("input");
const inputIds = fc.uuid({version: 7}).map((uuid) => {
	let value = BigInt(`0x${uuid.replaceAll("-", "")}`),
		suffix = "";
	for (let n = 0; n < 26; n++) {
		suffix = "0123456789abcdefghjkmnpqrstvwxyz"[Number(value & 31n)] + suffix;
		value >>= 5n;
	}
	return InputId.make(`input_${suffix}`);
});
const samples = fc.array(
	fc.record({
		id: inputIds,
		note: fc.constantFrom("a", "b", "c"),
		body: fc.string({maxLength: 100}),
		sentAt: fc.string(),
		arrivedAt: fc.integer(),
		agent: fc.boolean(),
		kept: fc.boolean(),
	}),
	{minLength: 2, maxLength: 20},
);
type Sample = {
	id: typeof InputId.Type;
	note: string;
	body: string;
	sentAt: string;
	arrivedAt: number;
	agent: boolean;
	kept: boolean;
};
const rows = (values: ReadonlyArray<Sample>) => {
	const versions = new Map<string, number>();
	return values.map((v, index) => {
		const base = versions.get(v.note) ?? 0;
		versions.set(v.note, base + 1);
		return {
			id: v.id,
			stream: "notes:1/inbox",
			rev: index * 3 + 1,
			pos: index + 1,
			by: v.agent ? "SHA256:agent" : "SHA256:person",
			for: "person",
			sentAt: v.sentAt,
			arrivedAt: v.arrivedAt,
			seen: index,
			parent: null,
			traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
			build: `build-${index}`,
			_tag: "send",
			body: {
				m: {
					type: "save",
					value: {
						note: v.note,
						base,
						body: v.body,
						...(v.kept ? {how: "kept", from: {note: "origin", version: 2}} : {}),
					},
				},
			},
		};
	});
};
const success = <A, E>(result: Result.Result<A, E>): A => {
	expect(Result.isResult(result)).toBe(true);
	if (Result.isFailure(result)) throw result.failure;
	return result.success;
};
type Version = Omit<typeof Entry.Type, "body"> & {
	note: string;
	version: number;
	body: string;
	how?: string;
	from?: {note: string; version: number};
};
const checkedHistory = (result: Result.Result<ReadonlyArray<Version>, Schema.SchemaError>) =>
	success(result);

describe("p55 checked notes history", () => {
	it("plant: latest-only history, sender-clock sorting, lost metadata/page or trimmed body", async () => {
		const {history} = await import("./history.ts");
		fc.assert(
			fc.property(samples, (values) => {
				const entries = rows(values);
				for (const note of ["a", "b", "c", "absent"]) {
					const expected = entries
						.filter((e) => e.body.m.value.note === note)
						.map(({body, _tag: _, ...fields}) => {
							const {base, ...save} = body.m.value;
							return {...fields, _tag: "send", ...save, version: base + 1};
						});
					for (let cut = 0; cut <= entries.length; cut++) {
						const left = checkedHistory(history(entries.slice(0, cut), note));
						const right = checkedHistory(history(entries.slice(cut), note));
						expect([...left, ...right]).toEqual(expected);
					}
					expect(checkedHistory(history(entries, note))).toEqual(expected);
				}
			}),
			options,
		);
	});
	it("plant: throw from saved decoding, skip malformed Msgs or corrupt projected versions", async () => {
		const {history} = await import("./history.ts");
		const {notes} = await import("./program.ts");
		fc.assert(
			fc.property(
				samples,
				fc.constantFrom("missing_body", "bad_base", "empty_note", "bad_from"),
				(values, fault) => {
					const entries = rows(values);
					const value: Record<string, unknown> = {...entries[0]!.body.m.value};
					if (fault === "missing_body") delete value.body;
					if (fault === "bad_base") value.base = -1;
					if (fault === "empty_note") value.note = "";
					if (fault === "bad_from") value.from = {note: "origin", version: 0};
					const msg = {type: "save", value};
					const broken = {...entries[0], body: {m: msg}};
					let answer: Result.Result<unknown, unknown> | undefined;
					expect(() => {
						answer = history([broken, ...entries.slice(1)], "a");
					}).not.toThrow();
					expect(answer).toBeDefined();
					if (answer === undefined || Result.isSuccess(answer))
						throw new Error("saved corruption was not a typed failure");
					expect(answer.failure).toMatchObject({_tag: "SchemaError"});
					const p = success(stepper(notes));
					expect(() => p.fold({notes: []}, msg)).toThrowError(
						expect.objectContaining({_tag: "ProgramDown", why: "saved_letter"}),
					);
				},
			),
			options,
		);
	});
	it("plant: reject additive fields or accept broken saved entry metadata", async () => {
		const {history} = await import("./history.ts");
		fc.assert(
			fc.property(
				samples,
				fc.constantFrom("id", "by", "sentAt", "arrivedAt", "traceId", "seen"),
				(values, field) => {
					const first = rows(values)[0]!;
					const additive = {
						...first,
						later: {number: 42},
						body: {m: {...first.body.m, value: {...first.body.m.value, later: true}}},
					};
					expect(success(history([additive], first.body.m.value.note))).toHaveLength(1);
					const wrong: Record<string, unknown> = {
						id: "not-a-TypeID",
						by: null,
						sentAt: 12,
						arrivedAt: "today",
						traceId: "bad",
						seen: -1,
					};
					let answer: Result.Result<unknown, unknown> | undefined;
					expect(() => {
						answer = history([{...first, [field]: wrong[field]}], first.body.m.value.note);
					}).not.toThrow();
					if (answer === undefined || Result.isSuccess(answer))
						throw new Error("bad metadata was not a typed failure");
					expect(answer.failure).toMatchObject({_tag: "SchemaError"});
				},
			),
			options,
		);
	});
	it("Notes saved body plant: reject oversized accepted-history bodies or reapply a fresh limit", async () => {
		const {history} = await import("./history.ts");
		fc.assert(
			fc.property(samples, fc.integer({min: 1, max: 80}), (values, extra) => {
				const entries = rows(
					values.slice(0, 2).map((v) => ({...v, note: "a", body: "🙂".repeat(256 * 1024 + extra)})),
				);
				const versions = checkedHistory(history(entries, "a"));
				expect(versions.map((v) => v.body)).toEqual(entries.map((e) => e.body.m.value.body));
			}),
			{...options, numRuns: 5},
		);
	});
	it("format: P8 saved notes fold under a stricter policy; plant: rename a stored field or recheck MOST", async () => {
		// Never regenerate or rewrite this fixture. Its original IDs are compatibility evidence.
		const text = readFileSync(
			new URL("../../../../fixtures/next/notes-letters.jsonl", import.meta.url),
			"utf8",
		);
		const entries = text
			.trim()
			.split("\n")
			.map((line) => success(Schema.decodeUnknownResult(Schema.fromJsonString(Entry))(line)));
		expect(entries).toHaveLength(8);
		const {notes} = await import("./program.ts");
		const {history} = await import("./history.ts");
		let refused = 0;
		const p = success(
			stepper({
				...notes,
				refuse: () => {
					refused++;
					return {why: "too_long", most: 0};
				},
			}),
		);
		const Saved = Schema.Struct({
			m: Schema.Struct({
				type: Schema.Literal("save"),
				value: Schema.Struct({note: Schema.String, base: Schema.Int, body: Schema.String}),
			}),
		});
		const saves = entries.map((e) => success(Schema.decodeUnknownResult(Saved)(e.body)).m);
		const oracle = saves.reduce(
			(state, {value}) => ({
				notes: [
					{note: value.note, version: value.base + 1, body: value.body},
					...state.notes.filter((n) => n.note !== value.note),
				],
			}),
			{notes: []} as {notes: Array<{note: string; version: number; body: string}>},
		);
		for (let again = 0; again < 3; again++) {
			let model: unknown = {notes: []};
			for (const msg of saves) {
				const folded = p.fold(model, msg);
				if (folded._tag !== "stepped") throw new Error("saved fixture refused");
				model = folded.model;
			}
			expect(model).toEqual(oracle);
		}
		expect(refused).toBe(0);
		for (const {note} of oracle.notes)
			expect(
				checkedHistory(history(entries, note)).map((v) => ({body: v.body, version: v.version})),
			).toEqual(
				saves
					.filter((m) => m.value.note === note)
					.map(({value}) => ({body: value.body, version: value.base + 1})),
			);
	});
});
