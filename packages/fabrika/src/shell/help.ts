import type {Entry} from "../program/listed.ts";
import {type Listed, listing} from "../program/program.ts";
import {type Flag, fit, type Input, mustBeGiven, type Output} from "../program/shape.ts";
import {hasTable, type Part} from "./check.ts";
import {shapeLines, typeOf} from "./decode.ts";
import type {ProgramList} from "./programs.ts";

// What `<program> --help` prints: the program's help, read off its declaration
// alone. It is laid out the way well-liked command-line tools lay theirs out
// (GNU's `--help`, cargo's and gh's): a usage line first, with the pipe forms
// as ripgrep shows `command | rg`, then what the program does, then one headed
// section each for flags, inputs and outputs in aligned columns, then pipes
// that fit it, then what few people need: its machines. Plain text and 80
// columns, so a person and an agent read the same page.
//
//   double --help
//   Usage: double [n=N]
//          ... | double
//          double | ...
//
//   Doubles each number it is told, and ends when its input closes.
//
//   Flags:
//     --help  This help (or -h). One part whole: --help n
//
//   Inputs: told on the line as name=value, or fed by a pipe
//     n=  integer  A number to double.
//
//   Outputs: printed, or sent into a pipe (>name picks one)
//     >n  integer  The number, doubled.
//
//   Example pipes:
//     seq --to TO | double
//     tally | double
//     double | tally
//
// A flag the line must give is bare in the usage (`seq --to TO`), one with a
// default is in brackets, and its default is at the end of its text. The
// example pipes are the programs this tsh lists whose shapes fit, so each
// line checks as it is. `<program> --help <name>` shows one flag, input or
// output whole: what it is, its default, and its shape one field a line.

/** The width help is wrapped to: the 80 columns GNU's and cargo's help keep to. */
const WIDTH = 80;
/** A name and shape wider than this put their text on the next line, as cargo's do. */
const LEFT = 30;
/** How many pipes, in and out each, the help shows. */
const PIPES = 2;

/** How each kind of part is written on a line. */
const written: Readonly<Record<Part["kind"], (name: string) => string>> = {
	flag: (n) => `--${n}`,
	input: (n) => `${n}=`,
	output: (n) => `>${n}`,
};

/** `text` cut at spaces into lines of at most `width`. A word longer than that stays whole. */
const wrap = (text: string, width: number): readonly string[] =>
	wrapWords(text.split(/\s+/), width);

/** Words put on lines of at most `width`, a space between two. A word is never cut. */
function wrapWords(words: readonly string[], width: number): readonly string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		if (word === "") continue;
		if (line === "") line = word;
		else if (line.length + 1 + word.length <= width) line += ` ${word}`;
		else {
			lines.push(line);
			line = word;
		}
	}
	return line === "" ? lines : [...lines, line];
}

/** One row of a section: a name as it is written, its shape in a few words, and what it is. */
export interface Row {
	readonly name: string;
	readonly shape: string;
	readonly text: string;
}

/**
 * Rows in aligned columns: names, then shapes, then each text wrapped beside
 * them. A row too wide for that puts its text on the next line, at the same
 * column, so one long shape does not push every text to the right.
 */
export function columns(rows: readonly Row[]): readonly string[] {
	const names = Math.max(0, ...rows.map((r) => r.name.length));
	const left = (r: Row) => `  ${r.shape === "" ? r.name : `${r.name.padEnd(names)}  ${r.shape}`}`;
	const fitting = rows.map(left).filter((l) => l.length <= LEFT);
	// The texts' column: past the widest row that fits, and never left of the shapes.
	const at = Math.max(2 + names + 2, ...fitting.map((l) => l.length + 2));
	const pad = " ".repeat(at);
	return rows.flatMap((r) => {
		const head = left(r);
		const [first, ...rest] = wrap(r.text, WIDTH - at);
		if (first === undefined) return [head];
		const under = rest.map((l) => pad + l);
		return head.length + 2 <= at
			? [head.padEnd(at) + first, ...under]
			: [head, pad + first, ...under];
	});
}

/** A part's description, with its default when it has one. */
const told = (d: Listed) =>
	d.default === undefined
		? d.description
		: `${d.description} (default: ${JSON.stringify(d.default.value)})`;

/** The word that stands for a flag's or an input's value in a usage line: its name in capitals. */
const holder = (name: string) => name.toUpperCase().replaceAll("-", "_");

/** The flags a line must give, each with the word for its value: `--to TO`. */
const needed = (entry: Entry) =>
	Object.entries<Flag<unknown>>(entry.program.flags)
		.filter(([, flag]) => mustBeGiven(flag))
		.map(([name]) => `--${name} ${holder(name)}`);

/** How `entry` is written with only what it must be given: `seq --to TO`. */
const bare = (entry: Entry) => [entry.program.name, ...needed(entry)].join(" ");

/** The usage lines: the program with every flag and input, then fed by a pipe, then feeding one. */
function usage(entry: Entry): readonly string[] {
	const {program} = entry;
	const words = [
		...Object.entries<Flag<unknown>>(program.flags).map(([name, flag]) =>
			mustBeGiven(flag) ? `--${name} ${holder(name)}` : `[--${name} ${holder(name)}]`,
		),
		...Object.keys(program.inputs).map((name) => `[${name}=${holder(name)}]`),
	];
	// The usage line wraps at the width, each further line under the first word after the name.
	const lead = `Usage: ${program.name} `;
	const lines = wrapWords(words, WIDTH - lead.length).map((l, i) =>
		i === 0 ? lead + l : " ".repeat(lead.length) + l,
	);
	const indent = " ".repeat("Usage: ".length);
	return [
		lines.length === 0 ? `Usage: ${program.name}` : lines,
		Object.keys(program.inputs).length === 0 ? [] : [`${indent}... | ${bare(entry)}`],
		Object.keys(program.outputs).length === 0 ? [] : [`${indent}${bare(entry)} | ...`],
	].flat();
}

/** A pipe from one program into another: the line, and how much its shape says. */
interface Pipe {
	readonly line: string;
	/** The size of the shape sent: a string fits any string input, so a richer shape says more. */
	readonly says: number;
}

/** `a | b`, as a line that checks: with `>out` and `<in` when more than one pair of theirs fits. */
function piped(a: Entry, b: Entry): Pipe | null {
	const pairs = Object.entries<Output<unknown>>(a.program.outputs).flatMap(([output, out]) =>
		Object.entries<Input<unknown>>(b.program.inputs)
			.filter(([, into]) => fit(out, into) === "fits")
			.map(([input]) => ({output, input, says: JSON.stringify(out.shape.json ?? {}).length})),
	);
	const [pair] = pairs;
	if (pair === undefined) return null;
	const line =
		pairs.length === 1
			? `${bare(a)} | ${bare(b)}`
			: `${bare(a)} >${pair.output} | ${bare(b)} <${pair.input}`;
	return {line, says: pair.says};
}

/** A few pipes into and out of `entry` from the other programs this tsh lists, the richest first. */
function pipes(entry: Entry, list: ProgramList): readonly string[] {
	const others = [...list.values()].filter((e) => e.program.name !== entry.program.name);
	const few = (found: readonly Pipe[]) =>
		[...found]
			.sort((x, y) => y.says - x.says)
			.slice(0, PIPES)
			.map((p) => p.line);
	return [
		...few(others.flatMap((e) => piped(e, entry) ?? [])),
		...few(others.flatMap((e) => piped(entry, e) ?? [])),
	];
}

/** The `--all` row of a program that shows a person a table: tsh's word, as `--help` is. */
const allRow = (entry: Entry): readonly Row[] =>
	hasTable(entry)
		? [{name: "--all", shape: "", text: "Every row of its table, not one screen of them."}]
		: [];

/** The help row every program has, its text naming one of the program's own parts. */
function helpRow(entry: Entry): Row {
	const page = listing(entry.program);
	const flag = page.flags[0];
	const input = page.inputs[0];
	const output = page.outputs[0];
	const one =
		flag !== undefined
			? `--${flag.name}`
			: input !== undefined
				? input.name
				: output !== undefined
					? `>${output.name}`
					: undefined;
	return {
		name: "--help",
		shape: "",
		text:
			one === undefined ? "This help (or -h)." : `This help (or -h). One part whole: --help ${one}`,
	};
}

/**
 * A program's help, whole: the lines `<program> --help` prints. `list`: the
 * programs of this tsh, for the pipes that fit; left out, none are shown.
 */
export function helpOf(entry: Entry, list?: ProgramList): readonly string[] {
	const page = listing(entry.program);
	const row = (kind: Part["kind"]) => (d: Listed) => ({
		name: written[kind](d.name),
		shape: typeOf(d.schema),
		text: told(d),
	});
	const flags = [...page.flags.map(row("flag")), ...allRow(entry), helpRow(entry)];
	const section = (title: string, rows: readonly Row[]) =>
		rows.length === 0 ? [] : ["", title, ...columns(rows)];
	const examples = list === undefined ? [] : pipes(entry, list);
	return [
		...usage(entry),
		"",
		...wrap(page.description, WIDTH),
		...section("Flags:", flags),
		...section(
			"Inputs: told on the line as name=value, or fed by a pipe",
			page.inputs.map(row("input")),
		),
		...section(
			"Outputs: printed, or sent into a pipe (>name picks one)",
			page.outputs.map(row("output")),
		),
		...(examples.length === 0 ? [] : ["", "Example pipes:", ...examples.map((l) => `  ${l}`)]),
		...section(
			"Machines:",
			page.machines.map((name) => ({
				name,
				shape: "",
				text: page.status.includes(name)
					? "one status line per copy, under its job in jobs"
					: "no status line",
			})),
		),
	];
}

/** Each part named after `--help`, whole: what it is, its default, and its shape one field a line. */
export function partsHelp(entry: Entry, parts: readonly Part[]): readonly string[] {
	const page = listing(entry.program);
	const declared = {flag: page.flags, input: page.inputs, output: page.outputs};
	return parts.flatMap((part, i) => {
		const one = declared[part.kind].find((d) => d.name === part.name);
		if (one === undefined) return [];
		return [
			...(i === 0 ? [] : [""]),
			`${page.name} ${written[part.kind](part.name)}  (${part.kind === "flag" ? "a" : "an"} ${part.kind} of ${page.name})`,
			"",
			...wrap(told(one), WIDTH - 2).map((l) => `  ${l}`),
			"",
			"Shape:",
			...shapeLines(one.schema, "  "),
		];
	});
}
