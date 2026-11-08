import {replay} from "@demlik/tea";
import {Shell} from "@kampus/fabrika-old";
import {Result} from "effect";
import {describe, expect, it} from "vitest";
import {decodeKeys} from "../desk/keymap.ts";
import {editor} from "./editor.ts";
import {keyOf} from "./keys.ts";

const keys = (data: string) => ({type: "keys" as const, data});
const read = decodeKeys(
	'tsh."beginning-of-line" = "ctrl+x"\n[mode.tsh.search.keys]\nexit = "ctrl+x"',
	false,
);
if (Result.isFailure(read)) throw new Error(read.failure.why);
const applied = read.success;
const programs = Shell.programList(Shell.SMALL);

describe("today's tsh effective bindings", () => {
	it("P18: rebinding removes old prompt bytes, including alternate encodings", () => {
		for (const raw of ["\x01", "\x1b[H", "\x1bOH", "\x1b[1~"]) {
			expect(keyOf(raw, {keys: applied, mode: null})).not.toEqual({
				kind: "command",
				command: "beginning-of-line",
			});
		}
		expect(keyOf("\x18", {keys: applied, mode: null})).toEqual({
			kind: "command",
			command: "beginning-of-line",
		});
		const old = replay(editor, {
			ctx: {programs, history: [], keys: applied},
			msgs: [keys("hello"), keys("\x01")],
		});
		expect(old.state.mode).toMatchObject({kind: "prompt", line: {left: "hello", right: ""}});
		const changed = replay(editor, {
			ctx: {programs, history: [], keys: applied},
			msgs: [keys("hello"), keys("\x18")],
		});
		expect(changed.state.mode).toMatchObject({kind: "prompt", line: {left: "", right: "hello"}});
	});
	it("P18: search also drops the old exit and uses the mode table", () => {
		const history = ["echo one", "echo two"];
		const old = replay(editor, {
			ctx: {programs, history, keys: applied},
			msgs: [keys("\x12"), keys("\x1b")],
		});
		expect(old.state.mode.kind).toBe("search");
		const changed = replay(editor, {
			ctx: {programs, history, keys: applied},
			msgs: [keys("\x12"), keys("\x18")],
		});
		expect(changed.state.mode.kind).toBe("prompt");
	});
});
