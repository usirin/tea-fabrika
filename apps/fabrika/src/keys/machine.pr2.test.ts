import {applyCell} from "@demlik/tea";
import {Result} from "effect";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {browser, packs} from "../../../../fixtures/keybindings/programs.ts";
import {decodeKeys, defaults} from "../desk/keymap.ts";
import {commandsOf, infoFor} from "../window/frame.ts";
import {editorMachine, matching} from "./machine.ts";
import {KeysWindow} from "./window.tsx";

const select = {program: "tezgah", word: "exit", mode: "info"};

it("P7: editor Add, Unbind and Reset send the complete selected target", () => {
	let state = editorMachine.init(defaults, undefined)[0];
	state = applyCell(editorMachine, state, {type: "select", target: select})[0];
	expect(state.selected).toEqual(select);
	state = applyCell(editorMachine, state, {type: "add"})[0];
	state = applyCell(editorMachine, state, {
		type: "press",
		press: {key: "g", ctrl: true, alt: false, meta: false},
	})[0];
	const [, add] = applyCell(editorMachine, state, {type: "save"});
	expect(add).toContainEqual(
		expect.objectContaining({
			type: "edit",
			edit: expect.objectContaining({target: select, keys: expect.arrayContaining(["ctrl+g"])}),
		}),
	);
	for (const type of ["unbind", "reset"] as const) {
		const [, cmds] = applyCell(editorMachine, state, {type});
		expect(cmds).toContainEqual(
			expect.objectContaining({type: "edit", edit: expect.objectContaining({target: select})}),
		);
	}
});

it("P13: unloading clears selected controls, recording, mapping and stale Undo", () => {
	const decoded = decodeKeys("", false, {programs: packs});
	expect(Result.isSuccess(decoded)).toBe(true);
	if (Result.isFailure(decoded)) throw new Error(decoded.failure.why);
	let state = editorMachine.init(decoded.success, undefined)[0];
	state = applyCell(editorMachine, state, {
		type: "select",
		target: {program: "alpha", word: "next", mode: null},
	})[0];
	expect(state.selected).toEqual({program: "alpha", word: "next", mode: null});
	state = applyCell(editorMachine, state, {type: "mapping"})[0];
	state = applyCell(editorMachine, state, {type: "change"})[0];
	state = applyCell(editorMachine, state, {
		type: "keys",
		keys: defaults,
		version: "same-file",
		catalog: 2,
	})[0];
	expect(state.selected).toBeNull();
	expect(state.recording._tag).toBe("idle");
	expect(state.undo).toBeNull();
	expect(applyCell(editorMachine, state, {type: "save"})[1]).toEqual([]);
});

describe("today's editor, palette and mode hints", () => {
	it("P22: one applied mode row feeds search, palette, visible keys and spoken keys", () => {
		const decoded = decodeKeys('[mode.tezgah.info.keys]\nexit = ["escape", "ctrl+g"]', true, {
			programs: packs,
		});
		expect(Result.isSuccess(decoded)).toBe(true);
		if (Result.isFailure(decoded)) throw new Error(decoded.failure.why);
		const keys = decoded.success;
		const state = editorMachine.init(keys, undefined)[0];
		const html = renderToStaticMarkup(
			createElement(KeysWindow, {keys, editor: state, send: () => {}}),
		);
		expect(html).toMatch(/Map controls/i);
		expect(html).toMatch(/info/);
		expect(html).toMatch(/Control\+G|ctrl\+g/);
		expect(matching(keys, "ctrl+g")).toEqual(
			expect.arrayContaining([expect.objectContaining({target: select})]),
		);
		const palette = commandsOf(keys, 1, {
			target: {program: "tsh", tile: "t1"},
			modes: {tezgah: "info"},
		});
		expect(palette[0]).toMatchObject({target: select});
		expect(JSON.stringify(infoFor(keys))).toMatch(/C-g|ctrl\+g|Control\+G/i);
	});
	it("P26: disabled client bindings remain searchable with their reason in the editor", () => {
		const decoded = decodeKeys('alpha.previous = "ctrl+w"', false, {
			programs: packs,
			client: browser,
		});
		expect(Result.isSuccess(decoded)).toBe(true);
		if (Result.isFailure(decoded)) throw new Error(decoded.failure.why);
		const keys = decoded.success;
		const html = renderToStaticMarkup(
			createElement(KeysWindow, {
				keys,
				editor: editorMachine.init(keys, undefined)[0],
				send: () => {},
			}),
		);
		expect(html).toContain("alpha.previous");
		expect(html).toMatch(/browser|tab/i);
		expect(html).toMatch(/ctrl\+w|Control\+W/i);
	});
});
