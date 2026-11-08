import {applyCell} from "@demlik/tea";
import {Result} from "effect";
import {describe, expect, it} from "vitest";
import {decodeKeys, defaults} from "../desk/keymap.ts";
import {type Editor, type EditorCmd, type EditorMsg, editorMachine, matching} from "./machine.ts";

// Today's version. The new editor's public machine is the builder's contract.
const start = () => editorMachine.init(defaults, undefined)[0];
const step = (model: Editor, msg: EditorMsg) =>
	applyCell<Editor, EditorMsg, EditorCmd>(editorMachine, model, msg);
const select = () => step(start(), {type: "select", does: "tezgah.zoom"})[0];
const press = (key: string, mods = {}) => ({
	key,
	code: "",
	ctrl: false,
	alt: false,
	meta: false,
	shift: false,
	composing: false,
	altGraph: false,
	...mods,
});

describe("today's keys editor", () => {
	it("K1: searches names, file words, tsh words and key spellings, including unbound rows", () => {
		const read = decodeKeys('tezgah.fold = []\ntezgah.zoom = "<prefix>m"', true);
		if (Result.isFailure(read)) throw new Error(read.failure.why);
		for (const query of ["zoom", "tezgah.zoom", "<prefix>m", "ctrl+b m"])
			expect(matching(read.success, query).map((row: {does: string}) => row.does)).toContain(
				"tezgah.zoom",
			);
		expect(matching(read.success, "close-tile").map((row: {does: string}) => row.does)).toContain(
			"tezgah.close",
		);
		expect(matching(read.success, "fold")).toContainEqual(
			expect.objectContaining({does: "tezgah.fold", keys: []}),
		);
		expect(matching(read.success, "no such command")).toEqual([]);
	});

	it("K2: Change replaces, Add keeps, Unbind empties, Reset removes the override", () => {
		for (const [action, keys] of [
			["change", ["<prefix>m"]],
			["add", ["<prefix>z", "<prefix>m"]],
		] as const) {
			let model = step(select(), {type: action})[0];
			model = step(model, {type: "press", press: press("b", {ctrl: true})})[0];
			model = step(model, {type: "press", press: press("m")})[0];
			const [saving, cmds] = step(model, {type: "save"});
			expect(saving.recording._tag).toBe("saving");
			expect(cmds).toContainEqual(
				expect.objectContaining({type: "edit", edit: {_tag: "bind", does: "tezgah.zoom", keys}}),
			);
		}
		expect(step(select(), {type: "unbind"})[1]).toContainEqual(
			expect.objectContaining({type: "edit", edit: {_tag: "bind", does: "tezgah.zoom", keys: []}}),
		);
		expect(step(select(), {type: "reset"})[1]).toContainEqual(
			expect.objectContaining({type: "edit", edit: {_tag: "reset", does: "tezgah.zoom"}}),
		);
	});

	it("K3: recording Cmd-K produces a candidate without running anything or sending bytes", () => {
		const waiting = step(select(), {type: "change"})[0];
		const [candidate, cmds] = step(waiting, {
			type: "press",
			press: press("k", {meta: true, code: "KeyK"}),
		});
		expect(cmds).toEqual([]);
		expect(candidate.recording).toMatchObject({
			_tag: "candidate",
			keys: [{_tag: "alone", key: "<m-k>"}],
		});
		const [canceled, out] = step(candidate, {type: "cancel"});
		expect(canceled.recording._tag).toBe("idle");
		expect(out).toEqual([]);
		expect(defaults.rows.find((row) => row.does === "palette.open")?.keys).toEqual([
			{_tag: "alone", key: "<m-k>"},
		]);
	});
});
