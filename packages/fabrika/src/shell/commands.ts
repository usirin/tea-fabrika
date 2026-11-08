import {commandsOf} from "../program/commands.ts";
import type {AnyProgram} from "../program/program.ts";
import {readInput} from "../program/view.ts";

export const readCommand = (program: AnyProgram, words: readonly string[]) => {
	const row =
		words.length === 1
			? commandsOf(program).find((r) => r.id === `${program.name}.${words[0]}`)
			: undefined;
	return row === undefined
		? {kind: "refused" as const, why: "Unknown program command"}
		: readInput(program, row.send);
};
