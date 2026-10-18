import {Context} from "effect";
import type {Line, Stage} from "./check.ts";

// What a line typed at tsh is called in a trace: what ran, not what was typed.
// Each stage is its program's name, then each input it was told on, with each
// value told there that whoever started tsh knows how to shorten (`Shorten`).
// fabrika's tsh shortens a GitHub ticket or pull request to its number:
//
//   operate --rubrics ~/rubrics --budget 3 ticket=https://github.com/o/r/issues/6
//     → operate ticket #6
//   review-scripted pr=…/pull/597 pr=…/pull/596 | ship --mode read
//     → review-scripted pr #597 #596 | ship
//
// Flags and every other value are left out. The whole line is kept beside it,
// on the line's span only (`tsh.line`).

/** A value told on a line, as its title shows it; `null`: left out. */
export type Short = (value: string) => string | null;

/** How values are shortened in a title. Whoever starts tsh hands it in. Left out: every value is left out. */
export const Shorten = Context.Reference<Short>("tsh/Shorten", {defaultValue: () => () => null});

/** A stage, by what ran and what it was told about. */
const stageTitle = (stage: Stage, short: Short): string => {
	const told = new Map<string, string[]>();
	for (const {name, source} of stage.told) {
		const refs = told.get(name) ?? [];
		const ref =
			source.kind === "value" && typeof source.value === "string" ? short(source.value) : null;
		told.set(name, ref === null ? refs : [...refs, ref]);
	}
	return [stage.entry.program.name, ...[...told].flatMap(([name, refs]) => [name, ...refs])].join(
		" ",
	);
};

/** A line, by what ran: its stages, as a pipe joins them. */
export const titleOf = (line: Line, short: Short): string =>
	line.stages.map((stage) => stageTitle(stage, short)).join(" | ");

/** A job started again by `attach`: the programs it runs, as a pipe joins them. */
export const attachTitleOf = (programs: readonly string[]): string =>
	`attach ${programs.join(" | ")}`;
