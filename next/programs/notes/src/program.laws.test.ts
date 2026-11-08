// P13, next/. Each plant is named beside the law it must break. Seed 119120.
import {propertyInvariant} from "@demlik/tea/pbt";
import {describe, expect, it} from "@effect/vitest";
import {stepper} from "@kampus/libfabrika";
import {syncTest} from "@kampus/libfabrika/testing";
import {Result, Schema} from "effect";
import * as fc from "fast-check";

const options = {seed: 119120, numRuns: 60};
type Save = {note: string; base: number; body: string};
type Msg = {type: "save"; value: Save};
type Model = {notes: ReadonlyArray<{note: string; version: number; body: string}>};
const text = fc.oneof(
	fc.string({maxLength: 80}),
	fc.constantFrom("", "\n  ", "# Title\n🙂\nשלום  \r\n"),
);
const sequences = fc
	.array(fc.record({note: fc.constantFrom("a", "b", "c"), body: text}), {
		minLength: 1,
		maxLength: 25,
	})
	.map((values): Msg[] => {
		const versions = new Map<string, number>();
		return [...values, {note: "empty", body: ""}].map(({note, body}) => {
			const base = versions.get(note) ?? 0;
			versions.set(note, base + 1);
			return {type: "save", value: {note, base, body}};
		});
	});
const expected = (before: Model, save: Save): Model => ({
	notes: [
		{note: save.note, version: save.base + 1, body: save.body},
		...before.notes.filter((n) => n.note !== save.note),
	],
});
const checkedStepper = (program: unknown) => {
	const decoded = stepper(program);
	if (Result.isFailure(decoded)) throw decoded.failure;
	return decoded.success;
};
const name = (body: string) => {
	const lines = body.split(/\r?\n/);
	const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
	return (
		heading?.replace(/^#{1,6}\s+/, "").trim() ||
		lines.find((line) => line.trim() !== "")?.trim() ||
		"Untitled"
	);
};

describe("P13 notes pure laws", () => {
	it("p52 progress plant: ignore/refuse a current-base save, share versions or emit a Cmd", async () => {
		const {notes} = await import("./program.ts");
		const p = checkedStepper(notes);
		propertyInvariant<Model, Msg, never, never, Record<string, never>>(
			notes.machine,
			{},
			sequences,
			({prev, msg, next, cmds}) => {
				expect(next).toEqual(expected(prev, msg.value));
				expect(cmds).toEqual([]);
				expect(p.step(prev, msg)).toMatchObject({_tag: "stepped", model: next, cmds: []});
				return true;
			},
			options,
		);
	});
	it("p54 plant: use <, give stale now or mutate the model on refusal", async () => {
		const {notes} = await import("./program.ts");
		const p = checkedStepper(notes);
		fc.assert(
			fc.property(fc.nat({max: 50}), fc.nat({max: 60}), text, (now, base, body) => {
				const model = {notes: now === 0 ? [] : [{note: "a", version: now, body: "old"}]};
				const before = structuredClone(model);
				expect(p.step(model, {type: "save", value: {note: "a", base, body}})).toMatchObject(
					base === now
						? {_tag: "stepped", model: {notes: [{note: "a", version: now + 1, body}]}}
						: {_tag: "refused", why: "changed_elsewhere", now},
				);
				expect(model).toEqual(before);
			}),
			options,
		);
	});
	it("p54 malformed plant: admit negative, fractional or nonnumeric bases", async () => {
		const {notes} = await import("./program.ts");
		const invalid = fc.oneof(
			fc.integer({min: -1000, max: -1}),
			fc.integer().map((n) => n + 0.5),
			fc.string(),
			fc.constant(null),
		);
		fc.assert(
			fc.property(invalid, text, (base, body) => {
				expect(
					checkedStepper(notes).step({notes: []}, {type: "save", value: {note: "a", base, body}}),
				).toEqual({_tag: "refused", why: "bad_msg"});
			}),
			options,
		);
	});
	it("p54 size plant: count JS characters, reject equality or check base before bytes", async () => {
		const {notes, MOST} = await import("./program.ts");
		expect(MOST).toBe(256 * 1024);
		fc.assert(
			fc.property(
				fc.constantFrom("x", "é", "🙂", "\u0000", '"', "\\"),
				fc.nat({max: 40}),
				(unit, stale) => {
					for (const delta of [-1, 0, 1]) {
						const size = MOST + delta;
						const bytes = Buffer.byteLength(unit);
						const body = unit.repeat(Math.floor(size / bytes)) + "x".repeat(size % bytes);
						expect(Buffer.byteLength(body)).toBe(size);
						const p = checkedStepper(notes);
						expect(
							p.step({notes: []}, {type: "save", value: {note: "a", base: 0, body}}),
						).toMatchObject(
							delta <= 0
								? {_tag: "stepped", model: {notes: [{note: "a", version: 1, body}]}}
								: {_tag: "refused", why: "too_long", most: MOST},
						);
						if (delta > 0)
							expect(
								p.step({notes: []}, {type: "save", value: {note: "a", base: stale + 1, body}}),
							).toEqual({_tag: "refused", why: "too_long", most: MOST});
					}
				},
			),
			{...options, numRuns: 12},
		);
	});
	it("p55 replay plant: call refuse again, trim text, reorder or lose a note", async () => {
		const {notes} = await import("./program.ts");
		let refusals = 0;
		const p = checkedStepper({
			...notes,
			refuse: () => {
				refusals++;
				return {why: "stricter_now"};
			},
		});
		fc.assert(
			fc.property(sequences, (messages) => {
				const oracle = messages.reduce((s, m) => expected(s, m.value), {notes: []} as Model);
				for (let again = 0; again < 3; again++) {
					let model: unknown = {notes: []};
					for (const msg of messages) {
						const folded = p.fold(model, msg);
						expect(folded._tag).toBe("stepped");
						if (folded._tag !== "stepped") throw new Error("saved input refused");
						expect(folded.cmds).toEqual([]);
						model = folded.model;
					}
					expect(model).toEqual(oracle);
				}
			}),
			options,
		);
		expect(refusals).toBe(0);
	});
	it("Notes duplicate IDs plant: drop the uniqueness decoder check", async () => {
		const {Notes} = await import("./program.ts");
		fc.assert(
			fc.property(
				fc.string({minLength: 1, maxLength: 40}),
				text,
				text,
				fc.integer({min: 1, max: 40}),
				(note, first, last, version) => {
					const one = {note, version, body: first};
					expect(Result.isSuccess(Schema.decodeUnknownResult(Notes)({notes: [one]}))).toBe(true);
					expect(
						Result.isFailure(
							Schema.decodeUnknownResult(Notes)({
								notes: [one, {...one, version: version + 1, body: last}],
							}),
						),
					).toBe(true);
				},
			),
			options,
		);
	});
	it("Notes saved body plant: put the current limit in Notes, Save or saved Msg decoding", async () => {
		const {notes, Notes, Save, Msg, MOST} = await import("./program.ts");
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 64}),
				fc.constantFrom("x", "🙂", "\u0000"),
				(extra, unit) => {
					const body = unit.repeat(MOST + extra);
					const save = {note: "a", base: 0, body};
					const msg = {type: "save", value: save};
					expect(Result.isSuccess(Schema.decodeUnknownResult(Save)(save))).toBe(true);
					expect(Result.isSuccess(Schema.decodeUnknownResult(Msg)(msg))).toBe(true);
					expect(
						Result.isSuccess(
							Schema.decodeUnknownResult(Notes)({notes: [{note: "a", version: 1, body}]}),
						),
					).toBe(true);
					const p = checkedStepper(notes);
					expect(p.fold({notes: []}, msg)).toMatchObject({
						_tag: "stepped",
						model: {notes: [{note: "a", version: 1, body}]},
					});
					expect(p.step({notes: []}, msg)).toEqual({_tag: "refused", why: "too_long", most: MOST});
				},
			),
			{...options, numRuns: 8},
		);
	});
	it("S2 p88 plant: drop ID, body or version at a JSON cut", async () => {
		const {notes} = await import("./program.ts");
		fc.assert(
			fc.property(sequences, (messages) => {
				syncTest(
					notes.machine,
					{},
					{
						msgs: messages,
						encode: Schema.encodeSync(notes.state.schema),
						decode: Schema.decodeUnknownSync(notes.state.schema),
						equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
						seed: options.seed,
					},
				);
			}),
			options,
		);
	});
	it("audit plant: keep a body, lose save metadata or throw on outside values", async () => {
		const {Audit, audit} = await import("./audit.ts");
		fc.assert(
			fc.property(text, fc.nat({max: 30}), fc.boolean(), (body, base, kept) => {
				const fields = {
					type: "save",
					note: "a",
					base,
					...(kept ? {how: "kept", from: {note: "origin", version: 2}} : {}),
				};
				const {type, ...value} = fields;
				const answer = audit({type, value: {...value, body, by: "forged"}});
				expect(Result.isSuccess(answer)).toBe(true);
				if (Result.isFailure(answer)) throw answer.failure;
				expect(answer.success).toEqual(fields);
				expect(Schema.decodeUnknownResult(Audit)(answer.success)).toMatchObject({_tag: "Success"});
				let bad: Result.Result<unknown, unknown> | undefined;
				expect(() => {
					bad = audit({type, value: {...value, body: null}});
				}).not.toThrow();
				expect(bad).toMatchObject({_tag: "Failure"});
			}),
			options,
		);
	});
	it("read/list plant: return another note/version, mutate, duplicate rows, reorder or trim stored text", async () => {
		const {notes} = await import("./program.ts");
		propertyInvariant<Model, Msg, never, never, Record<string, never>>(
			notes.machine,
			{},
			sequences,
			({next, cmds}) => {
				const before = structuredClone(next);
				expect(cmds).toEqual([]);
				expect(notes.inputs.save.personOnly).toBe(false);
				for (const row of next.notes)
					expect(notes.inputs.read.answer(next, {note: row.note})).toEqual({_tag: "found", ...row});
				expect(notes.inputs.read.answer(next, {note: "absent"})).toEqual({
					_tag: "missing",
					note: "absent",
				});
				for (let repeat = 0; repeat < 2; repeat++)
					expect(notes.inputs.list.answer(next, {})).toEqual(
						next.notes.map((row) => ({note: row.note, version: row.version, name: name(row.body)})),
					);
				expect(next).toEqual(before);
				return true;
			},
			options,
		);
	});
});
