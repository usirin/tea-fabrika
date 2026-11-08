// T293, next/. Real P13 declaration and P18 parent are mandatory integration imports.
import {applyCell} from "@demlik/tea";
import {propertyInvariant} from "@demlik/tea/pbt";
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";

const options = {seed: 119120, numRuns: 80};
describe("P20 real notes tile", () => {
	it("L05 L30 real notes declaration uses the reusable editor and reads before Edit", async () => {
		const {notes} = await import("./program.ts");
		const {notesEditor, tile} = await import("./tile.ts");
		const {NoteId, Save, Notes} = await import("./note.ts");
		const {NoteEditor, windowMachine} = await import("@kampus/libfabrika");
		const {plannedNotes, noteIds, bodies} = await import("./tile.test-support.ts");
		expect(windowMachine).toBeDefined();
		expect(notes.tile).toBe(tile);
		fc.assert(
			fc.property(noteIds, bodies, fc.integer({min: 1, max: 5000}), (note, body, version) => {
				const input = {notes: [{note, body, version}]};
				expect(Schema.decodeUnknownSync(plannedNotes.view)(input)).toEqual(
					Schema.decodeUnknownSync(Notes)(input),
				);
				const reusable = NoteEditor.make({note: NoteId, save: Save, view: Notes});
				const seq = [{type: "view", notes: input.notes}, {type: "select", note}, {type: "edit"}];
				propertyInvariant(
					tile,
					{},
					fc.constant(seq),
					({msg, next}: {msg: {type: string}; next: typeof notesEditor.Model.Type}) => {
						if (msg.type !== "edit") return true;
						expect(next.boxes[note]).toMatchObject({_tag: "editing", base: version, draft: body});
						return true;
					},
					{...options, numRuns: 1},
				);
				let [a] = tile.init(null, {}),
					[b] = reusable.machine.init(null, {});
				for (const msg of seq) {
					a = applyCell(tile, a, msg)[0];
					b = applyCell(reusable.machine, b, msg)[0];
				}
				expect(a).toEqual(b);
				expect(notes.mode(a)).toBe("editing");
			}),
			options,
		);
	});
	it("L03 loaded commands retain local Msgs and reject unknown modes or a mode without an exit", async () => {
		const {notes} = await import("./program.ts");
		const {Program} = await import("@kampus/libfabrika");
		const {bodies} = await import("./tile.test-support.ts");
		fc.assert(
			fc.property(
				bodies,
				fc.constantFrom("unknown", "reading", "stuck"),
				fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), bodies),
				(body, mode, extra) => {
					const {msg: _msg, state, view, ...fields} = notes;
					const authoring = {
						...fields,
						state: {v: state.v, upgrades: state.upgrades},
						view: view.select,
						inputs: {save: "Save"},
						commands: {
							...Object.fromEntries(
								Object.entries(extra).map(([name, body]) => [
									name,
									{send: {type: "typed", body}, keys: [], mode: "editing"},
								]),
							),
							...notes.commands,
							typed: {send: {type: "typed", body}, keys: [], mode: "editing"},
						},
					};
					expect(
						Result.isSuccess(Effect.runSync(Effect.result(Program.makeEffect(authoring)))),
					).toBe(true);
					for (const commands of [
						{...authoring.commands, done: {...notes.commands.done, mode}},
						{...authoring.commands, done: {...notes.commands.done, keys: []}},
						{
							...authoring.commands,
							done: {...notes.commands.done, send: {type: "not_a_local_msg"}},
						},
					])
						expect(
							Result.isFailure(
								Effect.runSync(Effect.result(Program.makeEffect({...authoring, commands}))),
							),
						).toBe(true);
				},
			),
			options,
		);
	});
	it("L09 blank new notes allocate safely and emit no save on unchanged Done", async () => {
		const {notesEditor} = await import("./tile.ts");
		const {noteIds} = await import("./tile.test-support.ts");
		fc.assert(
			fc.property(noteIds, (note) => {
				const [initial] = notesEditor.machine.init(null, {});
				const [allocating, cmds] = applyCell(notesEditor.machine, initial, {type: "new"});
				expect(allocating.allocating).toBe(true);
				const cmd = cmds[0];
				expect(cmd).toBeDefined();
				if (cmd === undefined) throw new Error("New must request an ID");
				const [editing] = applyCell(notesEditor.machine, allocating, {
					type: `${cmd.type}_ok`,
					cmd,
					value: note,
					at: 0,
				});
				const [reading, out] = applyCell(notesEditor.machine, editing, {type: "done"});
				expect(out).toEqual([]);
				expect(notesEditor.mode(reading)).toBeNull();
			}),
			options,
		);
	});
});
