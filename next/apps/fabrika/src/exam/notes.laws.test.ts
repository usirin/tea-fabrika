// P8, next/. Port: programs/markdown/src/index.laws.test.ts at 2c29c13.
// Replacement is per note's accepted save, not today's text stream. Source sample sizes retained.
// The control machine validates the examiner only. P13 has not supplied the real notes machine.
import {existsSync, readFileSync, readdirSync} from "node:fs";
import {resolve} from "node:path";
import {Machine} from "@demlik/tea/effect";
import {
	arbMsg,
	arbMsgSequence,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
} from "@demlik/tea/pbt";
import {Entry, valueFor} from "@kampus/libfabrika/data";
import {syncTest} from "@kampus/libfabrika/testing";
import {Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it, vi} from "vitest";

const Save = Schema.Struct({
	type: Schema.Literal("save"),
	value: Schema.Struct({note: Schema.String, base: Schema.Number, body: Schema.String}),
});
type Msg = typeof Save.Type;
const Note = Schema.Struct({version: Schema.Int, body: Schema.String});
const Model = Schema.Record(Schema.String, Note);
type Model = typeof Model.Type;
const text = fc.oneof(
	fc.constantFrom("# Hi", "- a\n- b", "| a |\n|---|\n| 1 |", "```\ncode\n```", "> q", "---", ""),
	fc.string({maxLength: 80}),
);
const table: MsgArbitraryTable<Msg> = {
	save: arbRecordMsg("save", {
		value: fc.record({note: fc.constantFrom("a", "b"), base: fc.nat(20), body: text}),
	}),
};
const lists = arbMsgSequence(arbMsg(table), {maxLength: 20});
const opts = {numRuns: 300, seed: 119120};
const machine = Machine.make({
	model: Model,
	msg: Save,
	cmds: [],
	init: (saved) => [saved ?? {}, []],
	update: {
		save: (s, m) => [
			{...s, [m.value.note]: {version: (s[m.value.note]?.version ?? 0) + 1, body: m.value.body}},
			[],
		],
	},
});
type Page = typeof machine;
const replacement = (page: Page) =>
	propertyInvariant(
		page,
		{},
		lists,
		({prev, msg, next, cmds}) => {
			const n = msg.value.note;
			return (
				JSON.stringify(next[n]) ===
					JSON.stringify({version: (prev[n]?.version ?? 0) + 1, body: msg.value.body}) &&
				Object.entries(prev).every(
					([id, note]) => id === n || JSON.stringify(next[id]) === JSON.stringify(note),
				) &&
				cmds.length === 0
			);
		},
		opts,
	);
const lastSave = (page: Page) =>
	propertyTrace(
		page,
		{},
		lists,
		(steps, last, initCmds) => {
			const expected: Record<string, typeof Note.Type> = {};
			for (const {msg} of steps)
				expected[msg.value.note] = {
					version: (expected[msg.value.note]?.version ?? 0) + 1,
					body: msg.value.body,
				};
			return JSON.stringify(last) === JSON.stringify(expected) && initCmds.length === 0;
		},
		opts,
	);
const checkpoint = (page: Page) =>
	fc.assert(
		fc.property(lists, (msgs) =>
			syncTest(
				page,
				{},
				{
					msgs,
					encode: (s) => s,
					decode: Schema.decodeUnknownSync(Model),
					equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
					seed: opts.seed,
				},
			),
		),
		opts,
	);
const detects = (law: string, run: () => unknown) => {
	let caught: unknown;
	try {
		run();
	} catch (error) {
		caught = error;
	}
	expect(caught, `plant must fail ${law}`).toBeInstanceOf(Error);
	const message = String(caught);
	expect(message).toContain("119120");
	console.info(`${law} plant, seed 119120, shortest failing input: ${message}`);
};

const fixture = resolve(import.meta.dirname, "../../../../../fixtures/next/notes-letters.jsonl");
const Send = Schema.TaggedStruct("send", {m: Save});
const entries = readFileSync(fixture, "utf8")
	.trimEnd()
	.split("\n")
	.map((s) => Schema.decodeUnknownSync(Schema.fromJsonString(Entry))(s));
const accepted = entries.map((e) => Schema.decodeUnknownSync(Send)(valueFor(e)).m);
type Replay = (
	msgs: readonly Msg[],
	refuse: () => never,
) => {
	readonly notes: Model;
	readonly order: readonly string[];
	readonly history: readonly {
		readonly note: string;
		readonly version: number;
		readonly body: string;
	}[];
};
const checkReplay = (fold: Replay) => {
	const refuse = vi.fn((): never => {
		throw new Error("accepted history must never call refuse");
	});
	const got = fold(accepted, refuse);
	expect(refuse).not.toHaveBeenCalled();
	expect(got.notes, "exact body and per-note version").toEqual({
		"note-a": {version: 3, body: "# Third\n\nسلام 🌍  \n\n```ts\nconst n = 3;\n```\n"},
		"note-b": {version: 5, body: "Last B\n\n"},
	});
	expect(got.order).toEqual(["note-b", "note-a"]);
	expect(got.history).toEqual([
		{note: "note-a", version: 1, body: "# First\n\nSaved text."},
		{note: "note-b", version: 1, body: ""},
		{note: "note-a", version: 2, body: "Second  \n\nשלום 🌱\n"},
		{note: "note-b", version: 2, body: "Copied second"},
		{note: "note-b", version: 3, body: "```html\n<script>unsafe()</script>\n```\n"},
		{note: "note-a", version: 3, body: "# Third\n\nسلام 🌍  \n\n```ts\nconst n = 3;\n```\n"},
		{note: "note-b", version: 4, body: "A new line\nwith two spaces  "},
		{note: "note-b", version: 5, body: "Last B\n\n"},
	]);
};
const replay: Replay = (msgs) => {
	const notes: Record<string, typeof Note.Type> = {},
		history: Array<{note: string; version: number; body: string}> = [],
		order: string[] = [];
	for (const {value: s} of msgs) {
		const version = (notes[s.note]?.version ?? 0) + 1;
		notes[s.note] = {version, body: s.body};
		history.push({note: s.note, version, body: s.body});
		const prior = order.indexOf(s.note);
		if (prior !== -1) order.splice(prior, 1);
		order.unshift(s.note);
	}
	return {notes, history, order};
};
describe("p55 fixed replacement and replay exam, controls and plants only", () => {
	it("replacement and untouched neighbors, no unexpected work, 300 lists", () =>
		replacement(machine));
	it("empty init and final history, 300 lists", () => lastSave(machine));
	it("P11 syncTest at every save boundary, 300 lists", () => checkpoint(machine));
	it("frozen accepted saves, exact text, history and order", () => checkReplay(replay));
	it("plant p61: retain the first body", () => {
		const plant: Page = {
			...machine,
			update: {
				save: (s, m) => [
					s[m.value.note] === undefined
						? {...s, [m.value.note]: {version: 1, body: m.value.body}}
						: s,
					[],
				],
			},
		};
		detects("replacement", () => replacement(plant));
		detects("last saved text", () => lastSave(plant));
	});
	it("plant p55: recheck base with current refusal during replay", () =>
		expect(() =>
			checkReplay((msgs, refuse) => {
				refuse();
				return replay(msgs, refuse);
			}),
		).toThrow("accepted history must never call refuse"));
	it("plant p55: omit the first save", () =>
		expect(() => checkReplay((msgs, refuse) => replay(msgs.slice(1), refuse))).toThrow(
			/version|history/,
		));
	it("plant p55: trim accepted text", () =>
		expect(() =>
			checkReplay((msgs, refuse) =>
				replay(
					msgs.map((m) => ({...m, value: {...m.value, body: m.value.body.trim()}})),
					refuse,
				),
			),
		).toThrow(/body/));
	it("plant sync: discard loaded state", () =>
		expect(() => checkpoint({...machine, init: () => [{}, []]})).toThrow(/119120/));
});
const dir = resolve(import.meta.dirname, "../../../../programs/notes/src");
it("P13 real notes p55 and replacement binding", (ctx) => {
	if (
		!existsSync(dir) ||
		readdirSync(dir).filter((s) => /\.(ts|tsx)$/.test(s) && !/\.test\./.test(s)).length === 0
	)
		return ctx.skip("not built: P13 notes; controls are not product laws");
	throw new Error(
		"P13 exists: bind its real init, reducer, accepted-history fold and P11 syncTest without changing fixed assertions",
	);
});
