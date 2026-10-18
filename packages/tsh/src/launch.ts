import {join} from "node:path";
import type {Show} from "./short.ts";

// What the launcher (./main.ts) reads before it starts tsh: how it was
// started and where its home is. Kept apart from the terminal, so a test
// reaches every piece. Which programs it lists is not tsh's to choose: whoever
// starts tsh hands it its list, the way a shell is handed its PATH.
//
//   tsh                    a terminal: prompt, history, editing, completion, Ctrl-R
//   tsh -c 'seq --to 3'    the lines of the text, then the end
//   tsh script.tsh         the lines of the file, then the end
//   echo … | tsh           the lines of stdin, then the end
//   tsh --json …           any of the above, each value printed whole as JSON, for a script
//
// The settings are read from the environment, like a shell's:
//
//   TSH_HOME       where the job storage and the history live. ~/.tsh when left out.
//   TSH_TRACE      1: each line a trace, sent over OTLP/HTTP to http://localhost:4318
//                  (`pnpm trace:up` starts Jaeger there). A url: that collector. Left out: off.

export const USAGE = "usage: tsh [--json] [-c <lines> | <script file>]";

/** `--json` first: print each value a program sends whole, as JSON, for a script. Answers the rest of the command line. */
export function showOf(argv: readonly string[]): {
	readonly show: Show;
	readonly rest: readonly string[];
} {
	const [first, ...rest] = argv;
	return first === "--json" ? {show: "json", rest} : {show: "short", rest: argv};
}

/** Where tsh's lines come from. */
export type Source =
	| {readonly kind: "terminal"}
	| {readonly kind: "text"; readonly text: string}
	| {readonly kind: "file"; readonly path: string}
	| {readonly kind: "stdin"};

/** How tsh was started, or why the command line is not one. */
export function sourceOf(
	argv: readonly string[],
	stdinIsTerminal: boolean,
): Source | {readonly kind: "usage"; readonly why: string} {
	const [first, second, ...rest] = argv;
	if (first === undefined) return stdinIsTerminal ? {kind: "terminal"} : {kind: "stdin"};
	if (first === "-c") {
		if (second === undefined) return {kind: "usage", why: "-c needs the lines to run"};
		if (rest.length > 0) return {kind: "usage", why: "-c takes one text: quote it"};
		return {kind: "text", text: second};
	}
	if (first.startsWith("-")) return {kind: "usage", why: `no option ${first}`};
	if (second !== undefined) return {kind: "usage", why: "one script file at a time"};
	return {kind: "file", path: first};
}

/** A text's lines, as tsh is told them: one per line, the last one's newline not making an empty one. */
export function linesOf(text: string): readonly string[] {
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

export type Env = Readonly<Record<string, string | undefined>>;

/** tsh's home: where its storage (`storage/`), history and lock are. */
export const homeOf = (env: Env, userHome: string): string =>
	env.TSH_HOME !== undefined && env.TSH_HOME !== "" ? env.TSH_HOME : join(userHome, ".tsh");
