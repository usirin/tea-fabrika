import {type Jobs, jobNamed} from "../host/jobs.ts";
import type {Flag, Input} from "../program/shape.ts";
import {own} from "./check.ts";
import {choices} from "./decode.ts";
import {BUILTINS, HELP_WORDS} from "./grammar.ts";
import type {ProgramList} from "./programs.ts";
import {type Token, words} from "./words.ts";

// Tab completion, from the line as typed so far and nothing else: the program
// list's declarations and the job table. Pure, so the launcher calls it from
// readline's completer, and a test calls it with a string.
//
//   complete("sh", …)                       ship                 a program, or a built-in
//   complete("ship --m", …)                 --mode               a flag ship declares
//   complete("ship --mode ", …)             read write           the values its shape takes
//   complete("ship --mode read p", …)       pr=                  an input, told on the line
//   complete("ship --h", …)                 --help               every program's help
//   complete("ship --help ", …)             --mode pr >found …   the parts it can show whole
//   complete("seq --to 3 | do", …)          double               after a pipe: programs only
//   complete("tell ", …)                    %1 tally:3f2a…       the jobs in the table
//   complete("tell %1 ", …)                 add                  the inputs of the job's program
//
// The answer is what readline wants: the candidates, and the part of the line
// they replace.

export interface Completed {
	/** Every candidate, whole: readline puts the one picked in place of `word`. */
	readonly candidates: readonly string[];
	/** The end of the line the candidates replace: the word under the cursor, as typed. */
	readonly word: string;
}

const none = (word: string): Completed => ({candidates: [], word});

/** The candidates that start with what was typed, each once, in order. */
const matching = (typed: string, all: Iterable<string>): readonly string[] => [
	...new Set([...all].filter((c) => c.startsWith(typed))),
];

/** Complete the line, as typed up to the cursor. */
export function complete(line: string, list: ProgramList, jobs: Jobs): Completed {
	const {tokens, open, trailing} = words(line);
	// Inside an open quote the word's text is not what is on the line: no guess beats a wrong one.
	if (open) return none("");
	const last = tokens.at(-1);
	const current: Extract<Token, {kind: "word"}> | undefined =
		!trailing && last?.kind === "word" ? last : undefined;
	const typed = current?.text ?? "";
	const raw = current === undefined ? "" : line.slice(current.start);
	// A word with quotes or escapes in it reads differently from how it is typed: leave it be.
	if (typed !== raw) return none(raw);

	// The words of the command the cursor is in, before the cursor's own word.
	const before = current === undefined ? tokens : tokens.slice(0, -1);
	const cut = before.findLastIndex((t) => t.kind === "op");
	const opener = before[cut];
	const args = before.slice(cut + 1).flatMap((t) => (t.kind === "word" ? [t.text] : []));
	const [head, ...rest] = args;

	if (head === undefined) {
		// The program's own name. After `|` or `$(` a built-in cannot stand.
		const inPipe = opener?.kind === "op" && (opener.op === "|" || opener.op === "$(");
		return {candidates: matching(typed, [...list.keys(), ...(inPipe ? [] : BUILTINS)]), word: raw};
	}

	if ((BUILTINS as readonly string[]).includes(head))
		return builtinWord(head, rest, typed, list, jobs);

	const entry = list.get(head);
	if (entry === undefined) return none(raw);
	const {program} = entry;
	const valuesOf = (schema: Record<string, unknown> | undefined) => choices(schema).map(String);

	// A value after `--flag ` (the flag's word before this one, with no `=`).
	const prior = rest.at(-1);
	if (prior !== undefined && HELP_WORDS.has(prior)) {
		const parts = [
			...Object.keys(program.flags).map((f) => `--${f}`),
			...Object.keys(program.inputs),
			...Object.keys(program.outputs).map((o) => `>${o}`),
		];
		return {candidates: matching(typed, parts), word: raw};
	}
	if (prior?.startsWith("--") && !prior.includes("=")) {
		const flag: Flag<unknown> | undefined = own(program.flags, prior.slice(2));
		return {candidates: matching(typed, valuesOf(flag?.shape.json)), word: raw};
	}
	const given = new Set(
		rest.filter((w) => w.startsWith("--")).map((w) => w.slice(2).split("=")[0]),
	);
	if (typed.startsWith("--") && typed.includes("=")) {
		const name = typed.slice(2, typed.indexOf("="));
		const flag: Flag<unknown> | undefined = own(program.flags, name);
		const values = valuesOf(flag?.shape.json).map((v) => `--${name}=${v}`);
		return {candidates: matching(typed, values), word: raw};
	}
	if (typed.startsWith(">"))
		return {
			candidates: matching(
				typed,
				Object.keys(program.outputs).map((o) => `>${o}`),
			),
			word: raw,
		};
	if (typed.startsWith("<"))
		return {
			candidates: matching(
				typed,
				Object.keys(program.inputs).map((i) => `<${i}`),
			),
			word: raw,
		};
	if (!typed.startsWith("-") && typed.includes("=")) {
		const name = typed.slice(0, typed.indexOf("="));
		const into: Input<unknown> | undefined = own(program.inputs, name);
		const values = valuesOf(into?.shape.json).map((v) => `${name}=${v}`);
		return {candidates: matching(typed, values), word: raw};
	}
	const flags = Object.keys(program.flags)
		.filter((f) => !given.has(f))
		.map((f) => `--${f}`);
	const inputs = typed.startsWith("-") ? [] : Object.keys(program.inputs).map((i) => `${i}=`);
	// `--help` on an empty command, or once a dash is typed: anywhere else it would only crowd the inputs.
	const help = rest.length === 0 || typed.startsWith("-") ? ["--help"] : [];
	return {candidates: matching(typed, [...flags, ...help, ...inputs]), word: raw};
}

/** A built-in's words: a job first, then (for tell and close) one of its program's inputs, then (for tell) values. */
function builtinWord(
	name: string,
	rest: readonly string[],
	typed: string,
	list: ProgramList,
	jobs: Jobs,
): Completed {
	if (name === "help")
		return rest.length === 0
			? {candidates: matching(typed, list.keys()), word: typed}
			: none(typed);
	const onJob = name === "tell" || name === "close" || name === "stop" || name === "attach";
	if (!onJob) return none(typed);
	const [jobWord, inputWord] = rest;
	if (jobWord === undefined)
		return {
			candidates: matching(
				typed,
				jobs.jobs.flatMap((job) => [`%${job.n}`, ...job.stages.map((s) => s.run)]),
			),
			word: typed,
		};
	if (name !== "tell" && name !== "close") return none(typed);
	const job = jobNamed(jobs, jobWord);
	const stage = job?.stages.find((s) => s.run === jobWord) ?? job?.stages[0];
	const program = stage === undefined ? undefined : list.get(stage.program)?.program;
	if (program === undefined) return none(typed);
	if (inputWord === undefined)
		return {candidates: matching(typed, Object.keys(program.inputs)), word: typed};
	if (name === "close") return none(typed);
	const into: Input<unknown> | undefined = own(program.inputs, inputWord);
	return {candidates: matching(typed, choices(into?.shape.json).map(String)), word: typed};
}
