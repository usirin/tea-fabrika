import {existsSync} from "node:fs";
import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {defineProgram} from "../program/program.ts";
import {input} from "../program/shape.ts";
import {readInput} from "../program/view.ts";

describe("today's tsh program commands", () => {
	it("I17: tsh, toolbar, palette and key dispatch resolve the same declaration after rebinding", async () => {
		const path = "../program/commands.ts";
		expect(
			existsSync(new URL(path, import.meta.url)),
			"I17: no shared program command registry exists",
		).toBe(true);
		const {commandsOf, commandFor} = await import(path);
		const shellPath = "./commands.ts";
		expect(
			existsSync(new URL(shellPath, import.meta.url)),
			"I17: tsh cannot dispatch declared program commands",
		).toBe(true);
		const {readCommand} = await import(shellPath);
		const declaration = {
			name: "inbox",
			description: "A command consumer for the shell law.",
			inputs: {open: input(Schema.Null, "Open the tile.")},
			outputs: {},
			main: () => Effect.void,
			commands: {open: {name: "Open all", send: {type: "open", value: null}, keys: "shift+o"}},
		};
		const program = defineProgram(declaration);
		const rows: readonly {id: string; send: {type: string; value: unknown}}[] = commandsOf(
			program,
			{"inbox.open": ["shift+i"]},
		);
		const button = rows.find((r) => r.id === "inbox.open");
		expect(button).toBeDefined();
		const key = commandFor(
			rows,
			{key: "I", shift: true, meta: false, ctrl: false, alt: false},
			false,
		);
		expect(key?.send).toEqual(button?.send);
		expect(readCommand(program, ["open"])).toEqual({kind: "read", msg: button?.send});
		expect(readInput(program, button?.send).kind).toBe("read");
		expect(readCommand(program, ["unknown"]).kind).toBe("refused");
		expect(readCommand(program, ["open", "unexpected"]).kind).toBe("refused");
	});
});
