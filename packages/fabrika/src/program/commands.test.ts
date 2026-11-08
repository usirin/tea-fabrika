import {existsSync} from "node:fs";
import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {defineProgram} from "./program.ts";
import {input} from "./shape.ts";

const definition = {
	name: "command-toy",
	description: "Checks the public command declaration.",
	inputs: {
		move: input(Schema.Int, "Move by a number."),
		open: input(Schema.Null, "Open the tile."),
	},
	outputs: {},
	main: () => Effect.void,
};

describe("today's program command declaration", () => {
	it("I18: a glance cannot read a machine the program did not declare", () => {
		expect(
			() =>
				Reflect.apply(defineProgram, undefined, [
					{...definition, glance: {machine: "missing", data: Schema.String, of: () => "a count"}},
				]),
			"I18: program definitions do not check glance ownership",
		).toThrow();
	});
	it("I17: rejects commands whose input, payload or key declaration is invalid", async () => {
		for (const command of [
			{send: {type: "missing", value: null}, keys: "r"},
			{send: {type: "move", value: "wrong"}, keys: "j"},
			{send: {type: "open", value: null}, keys: "ctrl+"},
		]) {
			expect(
				() => Reflect.apply(defineProgram, undefined, [{...definition, commands: {bad: command}}]),
				"invalid commands cannot enter the registry",
			).toThrow();
		}
	});
	it("I17: prepared commands use current bindings and keep unbound actions available", async () => {
		const declared = {
			...definition,
			commands: {
				open: {name: "Open all", send: {type: "open", value: null}, keys: "shift+o"},
			},
		};
		const program = defineProgram(declared);
		const path = "./commands.ts";
		expect(
			existsSync(new URL(path, import.meta.url)),
			"I17: no shared program command registry exists",
		).toBe(true);
		const {commandsOf, commandFor} = await import(path);
		const rows: readonly {id: string; keys: readonly string[]}[] = commandsOf(program, {
			"command-toy.open": ["shift+i"],
		});
		expect(rows.find((r) => r.id === "command-toy.open")).toMatchObject({
			name: "Open all",
			keys: ["shift+i"],
			send: {type: "open", value: null},
		});
		expect(
			commandFor(rows, {key: "O", shift: true, meta: false, ctrl: false, alt: false}, false),
		).toBeUndefined();
		const unbound: readonly {id: string; keys: readonly string[]}[] = commandsOf(program, {
			"command-toy.open": [],
		});
		expect(unbound.find((r) => r.id === "command-toy.open")?.keys).toEqual([]);
	});
});
