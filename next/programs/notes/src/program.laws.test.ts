// P13, next/. Seeded laws run on the real tea machine. Bases come from this test's own model.
import {applyCell} from "@demlik/tea";
import {propertyInvariant} from "@demlik/tea/pbt";
import {describe, expect, it} from "@effect/vitest";
import {stepper} from "@kampus/libfabrika";
import {syncTest} from "@kampus/libfabrika/testing";
import {Result, Schema} from "effect";
import * as fc from "fast-check";

const SEED = 119120;
type Save = {
	note: string;
	base: number;
	body: string;
	how?: "pause" | "leave" | "done" | "kept";
	from?: {note: string; version: number};
};
type Msg = {type: "save"; value: Save};
type Model = {notes: ReadonlyArray<{note: string; version: number; body: string}>};
const text = fc.oneof(
	fc.string({maxLength: 80}),
	fc.constantFrom("", "\n  ", "# Title\n🙂\nשלום  \r\n"),
);
const sequences = fc
	.array(fc.record({note: fc.constantFrom("a", "b", "c"), body: text}), {
		minLength: 1,
		maxLength: 30,
	})
	.map((values): Msg[] => {
		const versions = new Map<string, number>();
		return values.map(({note, body}) => {
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

describe("P13 notes pure laws", () => {
	it("p52 progress plant: ignore a valid update or count versions across notes", async () => {
		const {notes} = await import("./program.ts");
		propertyInvariant<typeof notes.state.schema.Type, Msg, never, never, Record<string, never>>(
			notes.machine,
			{},
			sequences,
			({
				prev,
				msg,
				next,
				cmds,
			}: {
				prev: Model;
				msg: Msg;
				next: Model;
				cmds: ReadonlyArray<unknown>;
			}) => {
				expect(next).toEqual(expected(prev, msg.value));
				expect(cmds).toEqual([]);
				return true;
			},
			{seed: SEED, numRuns: 100},
		);
		const p = stepper(notes);
		fc.assert(
			fc.property(sequences, (messages) => {
				let model: Model = {notes: []};
				for (const msg of messages) {
					const old = structuredClone(model);
					const answer = p.step(model, msg);
					expect(answer).toMatchObject({
						_tag: "stepped",
						model: expected(model, msg.value),
						cmds: [],
					});
					expect(model).toEqual(old);
					model = expected(model, msg.value);
				}
			}),
			{seed: SEED, numRuns: 100},
		);
	});
	it("p52 progress plant: refuse every save, including empty text", async () => {
		const {notes} = await import("./program.ts");
		const p = stepper(notes);
		const first = p.step({notes: []}, {type: "save", value: {note: "empty", base: 0, body: ""}});
		expect(first).toMatchObject({
			_tag: "stepped",
			model: {notes: [{note: "empty", version: 1, body: ""}]},
			cmds: [],
		});
	});
	it("p54 plant: use < instead of exact equality, or report a stale now", async () => {
		const {notes} = await import("./program.ts");
		const p = stepper(notes);
		fc.assert(
			fc.property(fc.integer({min: 0, max: 50}), fc.integer({min: 0, max: 60}), (now, base) => {
				const model = {notes: now === 0 ? [] : [{note: "a", version: now, body: "old"}]};
				const answer = p.step(model, {type: "save", value: {note: "a", base, body: "draft"}});
				expect(answer).toMatchObject(
					base === now
						? {_tag: "stepped", model: {notes: [{note: "a", version: now + 1, body: "draft"}]}}
						: {_tag: "refused", why: "changed_elsewhere", now},
				);
			}),
			{seed: SEED, numRuns: 150},
		);
	});
	it("p54 shape plant: admit a negative, fractional or nonnumeric base", async () => {
		const {notes} = await import("./program.ts");
		for (const base of [-1, 0.5, "0", null, Number.NaN, Infinity])
			expect(
				stepper(notes).step({notes: []}, {type: "save", value: {note: "a", base, body: ""}}),
			).toEqual({_tag: "refused", why: "bad_msg"});
	});
	it("p54 size plant: count JS characters or reject equality; body bytes win before base", async () => {
		const {notes, MOST} = await import("./program.ts");
		expect(MOST).toBe(256 * 1024);
		for (const unit of ["x", "é", "🙂", "\u0000", '"', "\\"]) {
			const bytes = Buffer.byteLength(unit);
			const exact = unit.repeat(Math.floor(MOST / bytes)) + "x".repeat(MOST % bytes);
			expect(Buffer.byteLength(exact)).toBe(MOST);
			const p = stepper(notes);
			expect(
				p.step({notes: []}, {type: "save", value: {note: "a", base: 0, body: exact}}),
			).toMatchObject({_tag: "stepped", model: {notes: [{body: exact, version: 1}]}});
			for (const base of [0, 7])
				expect(
					p.step({notes: []}, {type: "save", value: {note: "a", base, body: `${exact}x`}}),
				).toEqual({_tag: "refused", why: "too_long", most: MOST});
		}
	});
	it("p55 replay plant: call refuse, trim text or order notes by a clock", async () => {
		const {notes} = await import("./program.ts");
		let refusals = 0;
		const p = stepper({
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
					for (const m of messages) {
						const folded = p.fold(model, m);
						expect(folded._tag).toBe("stepped");
						if (folded._tag === "stepped") {
							model = folded.model;
							expect(folded.cmds).toEqual([]);
						}
					}
					expect(model).toEqual(oracle);
				}
			}),
			{seed: SEED, numRuns: 100},
		);
		expect(refusals).toBe(0);
	});
	it("S2 p88 plant: drop note id, body or version at a JSON cut", async () => {
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
						seed: SEED,
					},
				);
			}),
			{seed: SEED, numRuns: 100},
		);
		const schema = notes.state.schema;
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(schema)({
					notes: [
						{note: "a", version: 1, body: "one"},
						{note: "a", version: 2, body: "two"},
					],
				}),
			),
		).toBe(true);
		// A later lower refusal limit cannot make saved state undecodable.
		expect(
			Result.isSuccess(
				Schema.decodeUnknownResult(schema)({
					notes: [{note: "a", version: 1, body: "x".repeat(256 * 1024 + 1)}],
				}),
			),
		).toBe(true);
	});
	it("read/list plant: write from read, share versions, reorder on read, or trim saved bodies", async () => {
		const {notes} = await import("./program.ts");
		const model: Model = {
			notes: [
				{note: "a", version: 3, body: "\n# Heading\nKeep trailing  \n"},
				{note: "b", version: 1, body: "\n  First line  \nnext"},
				{note: "c", version: 8, body: ""},
			],
		};
		const snapshot = structuredClone(model);
		const checked = Schema.decodeUnknownSync(notes.state.schema)(model);
		const read = notes.inputs.read;
		const list = notes.inputs.list;
		expect(read._tag).toBe("read");
		expect(list._tag).toBe("read");
		expect(read.answer(checked, {note: "a"})).toMatchObject({_tag: "found", ...model.notes[0]});
		expect(read.answer(checked, {note: "absent"})).toEqual({_tag: "missing", note: "absent"});
		for (let i = 0; i < 3; i++)
			expect(list.answer(checked)).toEqual([
				{note: "a", version: 3, name: "Heading"},
				{note: "b", version: 1, name: "First line"},
				{note: "c", version: 8, name: "Untitled"},
			]);
		expect(model).toEqual(snapshot);
		expect(stepper(notes).step(model, {type: "read", value: {note: "a"}})).toEqual({
			_tag: "refused",
			why: "bad_msg",
		});
		expect(notes.inputs.save.personOnly).toBe(false);
		expect(
			Schema.decodeUnknownSync(notes.inputs.save.schema)({
				type: "save",
				value: {note: "d", base: 0, body: ""},
			}),
		).toMatchObject({type: "save", value: {body: ""}});
		const [boot, cmds] = notes.machine.init(null, {});
		expect(boot).toEqual({notes: []});
		expect(cmds).toEqual([]);
		const [, out] = applyCell(notes.machine, boot, {
			type: "save",
			value: {note: "a", base: 0, body: ""},
		});
		expect(out).toEqual([]);
	});
});
