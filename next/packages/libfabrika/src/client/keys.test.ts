// T293, next/. Generated mode keys and settings, through the real parser and matcher.
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";

const options = {seed: 119120, numRuns: 80};
const setup = async () => {
	const keys = await import("./keys.ts");
	const {NoteEditor} = await import("./note-editor.ts");
	const {spec} = await import("./editor.test-support.ts");
	const editor = NoteEditor.make(spec);
	const defaults = Schema.decodeUnknownSync(keys.KeyTable)({
		prefix: "ctrl+b",
		ignore: [],
		tiles: {notes: {edit: ["e"], history: [], new: []}},
		modes: {notes: {editing: {done: ["mod+enter", "escape"], keep: [], drop: [], new: []}}},
		error: null,
	});
	return {...keys, defaults, commands: {notes: {commands: editor.commands, modes: ["editing"]}}};
};
const press = (key: string, editable = false, composing = false) => ({
	key,
	code: key,
	ctrl: false,
	meta: false,
	alt: false,
	shift: false,
	composing,
	editable,
});

describe("P20 keys", () => {
	it("L09 Escape and Mod-Enter match the same Done command", async () => {
		const k = await setup();
		fc.assert(
			fc.property(fc.boolean(), (meta) => {
				const escape = k.matchKey(k.defaults, "notes", false, press("Escape", true), "editing");
				const enter = k.matchKey(
					k.defaults,
					"notes",
					false,
					{...press("Enter", true), meta, ctrl: !meta},
					"editing",
				);
				expect(escape).toMatchObject({does: "notes.done", prevent: true});
				expect(enter.does).toBe(escape.does);
				const plant = {...escape, does: "notes.drop"};
				expect(() => expect(plant.does).toBe(enter.does)).toThrow();
			}),
			options,
		);
	});
	it("L20 generated overrides, mode sections, matching and displayed hints agree", async () => {
		const k = await setup();
		fc.assert(
			fc.property(
				fc.constantFrom("a", "b", "q", "x"),
				fc.constantFrom("f2", "f3", "f4"),
				(edit, done) => {
					const table = Effect.runSync(
						k.readKeys(
							`[notes.keys]\nedit = "${edit}"\n[mode.notes.editing.keys]\ndone = ["${done}", "escape"]\n`,
							k.defaults,
							k.commands,
						),
					);
					const matched = k.matchKey(table, "notes", false, press(edit), null);
					expect(matched).toMatchObject({does: "notes.edit", keys: edit});
					expect(
						k.matchKey(table, "notes", false, press(done.toUpperCase(), true), "editing"),
					).toMatchObject({does: "notes.done", keys: done});
					expect(k.matchKey(table, "notes", false, press(edit, true), "editing").does).toBeNull();
					expect(() => expect({...matched, keys: "e"}).toMatchObject({keys: edit})).toThrow();
				},
			),
			options,
		);
	});
	it("L20 unknown commands, flat mode commands, clashes and removing every exit fail", async () => {
		const k = await setup();
		fc.assert(
			fc.property(fc.constantFrom("a", "q", "x"), (key) => {
				for (const bad of [
					`[notes.keys]\nunknown_${key} = "${key}"`,
					`[notes.keys]\ndone = "${key}"`,
					`[notes.keys]\nedit = "${key}"\nhistory = "${key}"`,
					"[mode.notes.editing.keys]\ndone = []",
				]) {
					const result = Effect.runSync(Effect.result(k.readKeys(bad, k.defaults, k.commands)));
					expect(Result.isFailure(result)).toBe(true);
					expect(() => expect(Result.succeed(k.defaults)).toEqual(result)).toThrow();
				}
			}),
			options,
		);
	});
	it("L20 editing text and composition retain ordinary keys; focus and prefix remain reachable", async () => {
		const k = await setup();
		fc.assert(
			fc.property(fc.constantFrom("e", "j", "k", " "), fc.boolean(), (key, composing) => {
				expect(
					k.matchKey(k.defaults, "notes", false, press(key, true, composing), "editing"),
				).toMatchObject({does: null, prevent: false});
				expect(
					k.matchKey(k.defaults, "notes", false, press("Escape", true, true), "editing"),
				).toMatchObject({does: null, prevent: false});
				expect(k.matchKey(k.defaults, "notes", false, press("F6", true), "editing").prevent).toBe(
					true,
				);
				expect(
					k.matchKey(k.defaults, "notes", false, {...press("b", true), ctrl: true}, "editing")
						.armed,
				).toBe(true);
			}),
			options,
		);
	});
	it("L11 positive configured pauses decode, defaults are 1500 and invalid edits fail", async () => {
		const {EditorOptions, readEditorOptions} = await import("./settings.ts");
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 100000}),
				fc.oneof(fc.integer({max: 0}), fc.string()),
				(pauseMs, invalid) => {
					expect(Effect.runSync(readEditorOptions(`[notes]\npauseMs = ${pauseMs}`))).toEqual({
						pauseMs,
					});
					expect(Effect.runSync(readEditorOptions(""))).toEqual({pauseMs: 1500});
					expect(
						Result.isFailure(
							Effect.runSync(
								Effect.result(Schema.decodeUnknownEffect(EditorOptions)({pauseMs: invalid})),
							),
						),
					).toBe(true);
					expect(
						Result.isFailure(
							Effect.runSync(
								Effect.result(readEditorOptions(`[notes]\npauseMs = ${JSON.stringify(invalid)}`)),
							),
						),
					).toBe(true);
					expect(() =>
						expect({pauseMs: 1500}).toEqual({pauseMs: pauseMs === 1500 ? 1501 : pauseMs}),
					).toThrow();
				},
			),
			options,
		);
	});
});
