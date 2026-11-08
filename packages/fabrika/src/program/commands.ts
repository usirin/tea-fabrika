import {Schema} from "effect";
import type {AnyProgram} from "./program.ts";

export const CommandVia = Schema.TaggedUnion({
	key: {keys: Schema.String},
	click: {},
	palette: {},
	word: {},
});
export type CommandVia = typeof CommandVia.Type;

export interface CommandDeclaration {
	readonly name?: string;
	readonly send: {readonly type: string; readonly value: unknown};
	readonly keys: string | readonly string[];
}
export interface CommandRow {
	readonly id: string;
	readonly name: string;
	readonly keys: readonly string[];
	readonly send: {readonly type: string; readonly value: unknown};
}
export interface Press {
	readonly key: string;
	readonly shift: boolean;
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly meta: boolean;
}
const declarations = new WeakMap<object, Readonly<Record<string, CommandDeclaration>>>();
const keyOf = (keys: string): Press => {
	const parts = keys.toLowerCase().split("+");
	const key = parts.pop();
	if (
		!key ||
		(key.length !== 1 &&
			!/^(space|arrowdown|arrowup|arrowleft|arrowright|enter|escape|tab|home|end|pageup|pagedown|backspace|delete|f(?:[1-9]|1[0-9]|2[0-4]))$/.test(
				key,
			)) ||
		new Set(parts).size !== parts.length ||
		parts.some((part) => !["ctrl", "alt", "meta", "shift"].includes(part))
	)
		throw new Error(`Invalid command key: ${keys}`);
	return {
		key: key === "space" ? " " : key,
		shift: parts.includes("shift"),
		ctrl: parts.includes("ctrl"),
		alt: parts.includes("alt"),
		meta: parts.includes("meta"),
	};
};
export const commandKey = keyOf;
export const registerCommands = (
	program: AnyProgram,
	commands: Readonly<Record<string, CommandDeclaration>>,
) => {
	for (const [name, command] of Object.entries(commands)) {
		const input = program.inputs[command.send.type];
		if (input === undefined || input.shape.problem(command.send.value) !== undefined)
			throw new Error(`${program.name}.${name} does not match a declared input`);
		for (const key of typeof command.keys === "string" ? [command.keys] : command.keys) keyOf(key);
	}
	declarations.set(program, commands);
};
export const commandsOf = (
	program: AnyProgram,
	bindings: Readonly<Record<string, readonly string[]>> = {},
): readonly CommandRow[] =>
	Object.entries(declarations.get(program) ?? {}).map(([name, command]) => {
		const id = `${program.name}.${name}`;
		return {
			id,
			name: command.name ?? name,
			send: command.send,
			keys: bindings[id] ?? (typeof command.keys === "string" ? [command.keys] : command.keys),
		};
	});
export const commandFor = <A extends Pick<CommandRow, "keys">>(
	rows: readonly A[],
	press: Press,
	typing: boolean,
): A | undefined => {
	if (typing) return undefined;
	return rows.find((row) =>
		row.keys.some((keys) => {
			const key = keyOf(keys);
			return (
				key.key === press.key.toLowerCase() &&
				key.shift === press.shift &&
				key.ctrl === press.ctrl &&
				key.alt === press.alt &&
				key.meta === press.meta
			);
		}),
	);
};
