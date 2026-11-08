import {defineProgram, input} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";

// Made up: two packs and their commands. They use the real program definition.
export const program = (
	name: string,
	commands: Readonly<Record<string, {
		readonly send: {readonly type: "act"; readonly value: string};
		readonly keys: string | readonly string[];
		readonly global?: true;
		readonly mode?: "select" | "search" | readonly ("select" | "search" | null)[];
	}>>,
) => defineProgram({
	name,
	description: "A keybindings fixture.",
	inputs: {act: input(Schema.String, "A named action.")},
	outputs: {},
	mode: (s: {readonly mode: "select" | "search" | null}) => s.mode,
	commands,
	main: () => Effect.void,
});

const action = (value: string) => ({type: "act" as const, value});
export const alpha = program("alpha", {
	next: {send: action("next"), keys: "j"},
	previous: {send: action("previous"), keys: "k"},
	select: {send: action("select"), keys: "/"},
	exit: {send: action("exit"), keys: "escape", mode: ["select", "search"]},
	accept: {send: action("accept"), keys: "enter", mode: [null, "select"]},
	find: {send: action("find"), keys: "n", mode: "search"},
	shared: {send: action("shared"), keys: "ctrl+shift+u", global: true},
});
export const beta = program("beta", {
	next: {send: action("next"), keys: "j"},
	shared: {send: action("shared"), keys: "ctrl+shift+u", global: true},
});
export const packs = [
	{program: alpha, origin: {pack: "pack-a"}},
	{program: beta, origin: {pack: "pack-b"}},
] as const;

// These describe delivery by each client, not whether the TOML is valid.
export const installed = {kind: "installed", mac: false, unavailable: []} as const;
export const browser = {
	kind: "tab", mac: false,
	unavailable: [{key: "<c-w>", why: "The browser closes this tab."}],
} as const;
