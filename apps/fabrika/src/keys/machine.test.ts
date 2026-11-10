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

		if (Result.isFailure(read)) {
			throw new Error(read.failure.why);
		}

		for (const query of ["zoom", "tezgah.zoom", "<prefix>m", "ctrl+b m"]) {
			expect(matching(read.success, query).map((row: {does: string}) => row.does)).toContain(
				"tezgah.zoom",
			);
		}

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

	it("K1: searching changes only the query and sends no edit", () => {
		const model = select();
		expect(step(model, {type: "query", query: "fold"})).toEqual([{...model, query: "fold"}, []]);
	});

	it("K14: live keys retain Undo only for its saved version", () => {
		const read = decodeKeys('prefix = "ctrl+a"', true);

		if (Result.isFailure(read)) {
			throw new Error(read.failure.why);
		}

		const model = {...select(), undo: "saved-version"};

		for (const version of [{}, {version: "saved-version"}]) {
			const [next, out] = step(model, {type: "keys", keys: read.success, ...version});
			expect(next.keys).toEqual(read.success);
			expect(next.undo).toBe("saved-version");
			expect(next.error).toBeNull();
			expect(out).toEqual([]);
		}

		const [newer, out] = step(model, {type: "keys", keys: read.success, version: "newer"});
		expect(newer.keys).toEqual(read.success);
		expect(newer.undo).toBeNull();
		expect(newer.error).toMatch(/file changed.*Undo/i);
		expect(out).toEqual([]);
	});

	it("K11: only a matching save failure ends the save; opening failures are shown too", () => {
		const [saving, cmds] = step(select(), {type: "unbind"});
		const request = cmds[0]?.request;

		if (request === undefined) {
			throw new Error("no save request");
		}

		expect(step(saving, {type: "failed", request: "older", why: "old failure"})).toEqual([
			saving,
			[],
		]);
		const [failed, out] = step(saving, {type: "failed", request, why: "rename denied"});
		expect(failed.recording._tag).toBe("idle");
		expect(failed.error).toBe("Save failed: rename denied");
		expect(out).toEqual([]);
		const [unopened, opening] = step(start(), {
			type: "failed",
			request: "open",
			why: "editor refused",
		});
		expect(unopened.error).toBe("editor refused");
		expect(opening).toEqual([]);
	});
	it("K14: a second save's broadcast landing before its answer never says Undo is gone", () => {
		const read = decodeKeys('tezgah.zoom = "<prefix>u"', true);

		if (Result.isFailure(read)) {
			throw new Error(read.failure.why);
		}

		const saved = {...select(), undo: "first"};
		const [saving, cmds] = step(saved, {type: "unbind"});
		const request = cmds[0]?.request;

		if (request === undefined) {
			throw new Error("no save request");
		}

		const [heard] = step(saving, {type: "keys", keys: read.success, version: "second"});
		expect(heard.error).toBeNull();
		expect(heard.undo).toBeNull();
		const [answered] = step(heard, {type: "saved", request, version: "second"});
		expect(answered.undo).toBe("second");
		expect(answered.error).toBeNull();
	});
});
