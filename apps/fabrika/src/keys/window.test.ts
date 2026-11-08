import {applyCell} from "@demlik/tea";
import {Result} from "effect";
import {createElement, isValidElement, type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {decodeKeys, defaults, type Keys} from "../desk/keymap.ts";
import {type Editor, type EditorCmd, type EditorMsg, editorMachine} from "./machine.ts";
import {KeysWindow} from "./window.tsx";

const step = (model: Editor, msg: EditorMsg) =>
	applyCell<Editor, EditorMsg, EditorCmd>(editorMachine, model, msg)[0];
const table = (text: string): Keys => {
	const read = decodeKeys(text, true);
	if (Result.isFailure(read)) throw new Error(read.failure.why);
	return read.success;
};
const selected = (keys: Keys, does: Editor["selected"]) =>
	step(editorMachine.init(keys, undefined)[0], {type: "select", does});
const draw = (editor: Editor) =>
	renderToStaticMarkup(createElement(KeysWindow, {keys: editor.keys, editor, send: () => {}}));

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
		expect(html).toContain("<h3>zoom</h3>");
		expect(html).toContain("tsh: <code>zoom</code>");
		expect(html).not.toContain('role="alert"');
		expect(html).not.toContain("No commands found.");
		expect(
			draw(step(selected(read.success, "tezgah.zoom"), {type: "query", query: "no such command"})),
		).toContain("No commands found.");
	});

	it("K18: settings show their own labels and standalone keys, including Escape", () => {
		const keys = table('prefix = "ctrl+a"\nignore = ["ctrl+escape"]');
		const prefix = draw(selected(keys, "prefix"));
		const selectedRow = (html: string) =>
			/<li[^>]*aria-selected="true"[^>]*>[\s\S]*?<\/li>/.exec(html)?.[0];
		expect(selectedRow(prefix)).toContain("Prefix · ctrl+a");
		expect(prefix).toContain('aria-keyshortcuts="Control+A"');
		expect(prefix).toContain("yours");
		const ignore = draw(selected(keys, "ignore"));
		expect(selectedRow(ignore)).toContain("Ignore · ctrl+esc");
		expect(ignore).toContain('aria-keyshortcuts="Control+Escape"');
		expect(ignore).toContain("Esc");
	});

	it("K8: moved keys name their new owner; a recording lists only actual conflicts", () => {
		const moved = table('tezgah.fold = "<prefix>z"');
		expect(draw(selected(moved, "tezgah.zoom"))).toContain("ctrl+b then z moved to tezgah.fold");
		let editor = step(selected(defaults, "tezgah.zoom"), {type: "change"});
		for (const [key, ctrl] of [
			["b", true],
			["f", false],
		] as const)
			editor = step(editor, {
				type: "press",
				press: {key, ctrl, alt: false, meta: false},
			});
		const candidate = draw(editor);
		expect(candidate).toContain("New key");
		expect(candidate.match(/Saving moves this key from/g)).toHaveLength(1);
		expect(candidate).toContain("Saving moves this key from tezgah.fold.");
	});

	it("K1: typing in search sends the entered query to the editor", () => {
		const sent: EditorMsg[] = [];
		const inputs: Record<string, unknown>[] = [];
		const walk = (node: unknown): void => {
			if (Array.isArray(node)) {
				for (const child of node) walk(child);
				return;
			}
			if (!isValidElement<Record<string, unknown>>(node)) return;
			if (node.props.label === "Search commands or keys") inputs.push(node.props);
			walk(node.props.children);
		};
		function Read(): ReactNode {
			const node = KeysWindow({
				keys: defaults,
				editor: editorMachine.init(defaults, undefined)[0],
				send: (msg) => sent.push(msg),
			});
			walk(node);
			return node;
		}
		renderToStaticMarkup(createElement(Read));
		expect(inputs).toHaveLength(1);
		const change = inputs[0]?.onChange;
		if (typeof change !== "function") throw new Error("search has no change handler");
		change({currentTarget: {value: "fold"}});
		expect(sent).toEqual([{type: "query", query: "fold"}]);
	});
});
