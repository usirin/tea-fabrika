import {applyCell} from "@demlik/tea";
import {Result} from "effect";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {decodeKeys} from "../desk/keymap.ts";
import {type Editor, type EditorCmd, type EditorMsg, editorMachine} from "./machine.ts";
import {KeysWindow} from "./window.tsx";

describe("today's keyboard shortcuts view", () => {
	it("K18: current keys, source, unbound commands and spoken hints come from the applied table", () => {
		const read = decodeKeys(
			'prefix = "ctrl+a"\ntezgah.zoom = "cmd+shift+w"\ntezgah.fold = []',
			true,
		);
		if (Result.isFailure(read)) throw new Error(read.failure.why);
		let model = editorMachine.init(read.success, undefined)[0];
		model = applyCell<Editor, EditorMsg, EditorCmd>(editorMachine, model, {
			type: "select",
			does: "tezgah.zoom",
		})[0];
		const html = renderToStaticMarkup(
			createElement(KeysWindow, {keys: read.success, editor: model, send: () => {}}),
		);
		expect(html).toContain("Keyboard shortcuts");
		expect(html).toContain("tezgah.zoom");
		expect(html).toContain("yours");
		expect(html).toContain("tezgah.fold");
		expect(html).toMatch(/unbound|no key/i);
		expect(html).toContain('aria-keyshortcuts="Meta+Shift+W"');
		expect(html).not.toContain('aria-keyshortcuts="Control+A ');
		expect(html).toContain("Not ours");
		expect(html).toMatch(/system|macOS/i);
		for (const action of ["Change", "Add", "Unbind", "Reset"]) expect(html).toContain(action);
		expect(html).not.toMatch(/mapping mode/i);
	});
});
