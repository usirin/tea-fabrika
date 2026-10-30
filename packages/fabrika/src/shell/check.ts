import type {Entry} from "../program/listed.ts";
import {type Declared, type Flag, fit, mustBeGiven, type Shape} from "../program/shape.ts";
import {readValue, typeOf} from "./decode.ts";
import {didYouMean} from "./did-you-mean.ts";
import {
	BUILTINS,
	type Command,
	type Given,
	type Pipeline,
	type Refused,
	type Value,
} from "./grammar.ts";
import type {ProgramList} from "./programs.ts";
import type {At} from "./words.ts";

// A parsed command line, checked against the program list before anything
// runs: every program exists, every flag and input is declared, every value
// fits its own shape, every required flag is there, and every pipe and
// `$( )` fits. Anything that does not is refused here, with where it is on
// the line and why. What passes is a plan: which entry to start, with which
// values, wired how.
//
//   seq --to 3 | double         seq's output n (integer) fits double's input n (integer): wired n → n
//   seq --to 3 | upper          refused at the |: seq's outputs fit no input of upper
//   ship --mdoe read            refused at --mdoe: ship has no flag --mdoe. Did you mean --mode?

/** Where a value comes from: the line, or the output of a `$( )` that runs first. */
export type Source =
	| {readonly kind: "value"; readonly value: unknown}
	| {
			readonly kind: "sub";
			readonly line: Line;
			/** The output of the line's last stage whose values are taken. */
			readonly output: string;
			readonly at: At;
	  };

export interface Stage {
	readonly entry: Entry;
	readonly flags: readonly {readonly name: string; readonly source: Source}[];
	readonly told: readonly {readonly name: string; readonly source: Source}[];
	/** Into the next stage: this stage's output and the next one's input. `null` on the last stage. */
	readonly wire: {readonly output: string; readonly input: string} | null;
	/** The input the stage before feeds. `null` on the first stage. */
	readonly fed: string | null;
	readonly text: string;
}

export interface Line {
	readonly stages: readonly [Stage, ...Stage[]];
	readonly text: string;
}

/** A refusal, and the exit status it ends the line with: 127 for a program that is not there, as a shell says, 2 for the rest. */
export type Refusal = Refused & {readonly status: number};

export type Checked =
	| {readonly kind: "line"; readonly line: Line}
	| {
			readonly kind: "help";
			readonly entry: Entry;
			/** The parts named after `--help`, to show whole. `null`: the whole program, short. */
			readonly parts: readonly Part[] | null;
	  }
	| Refusal;

/**
 * The part a program declared under `name`, or `undefined`. Only the table's
 * own keys count, so a name typed on a line is only ever a name: `constructor`
 * is no flag unless the program declares one.
 *
 *   own(seq.flags, "to")            seq's --to
 *   own(seq.flags, "constructor")   undefined
 */
export const own = <T>(table: Readonly<Record<string, T>>, name: string): T | undefined =>
	Object.hasOwn(table, name) ? table[name] : undefined;

/** One declared flag, input or output of a program. */
export interface Part {
	readonly kind: "flag" | "input" | "output";
	readonly name: string;
}

/**
 * The parts a name after `--help` means: `--mode` a flag, `>found` an
 * output, `<pr` or `pr=` an input, and a bare `pr` every part so named
 * (double has an input n and an output n).
 */
function partsNamed(entry: Entry, word: string): readonly Part[] {
	const {program} = entry;
	const has = (kind: Part["kind"], name: string) =>
		Object.hasOwn(
			kind === "flag" ? program.flags : kind === "input" ? program.inputs : program.outputs,
			name,
		)
			? [{kind, name}]
			: [];
	if (word.startsWith("--")) return has("flag", word.slice(2));
	if (word.startsWith(">")) return has("output", word.slice(1));
	if (word.startsWith("<")) return has("input", word.slice(1));
	if (word.endsWith("=")) return has("input", word.slice(0, -1));
	return [...has("flag", word), ...has("input", word), ...has("output", word)];
}

const no = (at: number, why: string, guess?: string, status = 2): Refusal => ({
	kind: "refused",
	at,
	why,
	status,
	...(guess === undefined ? {} : {didYouMean: guess}),
});

/** A stop in the walk: the check is refused. Thrown inside this file only, and caught by `check`. */
class Stop {
	readonly refusal: Refusal;
	constructor(refusal: Refusal) {
		this.refusal = refusal;
	}
}
const stop = (refusal: Refusal): never => {
	throw new Stop(refusal);
};

/** Check one statement's pipeline against the program list. `text` is the whole line, for each stage's own text. */
export function check(pipeline: Pipeline, list: ProgramList, text: string): Checked {
	try {
		// `--help` in any command of the pipe shows that program's help and runs nothing, as
		// `seq 3 | grep --help` does in bash: the first command that asks is the one answered.
		const asked = pipeline.commands.find((c) => c.help !== null);
		if (asked !== undefined && asked.help !== null) {
			const entry = entryOf(asked, list);
			const {name} = asked.help;
			if (name === null) return {kind: "help", entry, parts: null};
			const parts = partsNamed(entry, name.name);
			if (parts.length === 0) {
				const {program} = entry;
				const known = [
					...Object.keys(program.flags).map((f) => `--${f}`),
					...Object.keys(program.inputs),
					...Object.keys(program.outputs).map((o) => `>${o}`),
				];
				return no(
					name.at.start,
					`${program.name} has no flag, input or output named ${name.name}`,
					didYouMean(name.name, known),
				);
			}
			return {kind: "help", entry, parts};
		}
		return {kind: "line", line: lineOf(pipeline, list, text, true)};
	} catch (stopped) {
		if (stopped instanceof Stop) return stopped.refusal;
		throw stopped;
	}
}

function entryOf(command: Command, list: ProgramList): Entry {
	const {name, at} = command.program;
	const entry = list.get(name);
	if (entry === undefined)
		return stop(
			no(
				at.start,
				`no program named ${name}`,
				didYouMean(name, [...list.keys(), ...BUILTINS]),
				127,
			),
		);
	return entry;
}

/** `top`: the statement's own pipeline, not one inside a `$( )`, whose last output is taken. */
function lineOf(pipeline: Pipeline, list: ProgramList, text: string, top: boolean): Line {
	const entries = pipeline.commands.map((c) => entryOf(c, list));
	const wires = pipeline.bars.map((bar, i) => {
		const from = pipeline.commands[i];
		const to = pipeline.commands[i + 1];
		const a = entries[i];
		const b = entries[i + 1];
		if (from === undefined || to === undefined || a === undefined || b === undefined)
			return stop(no(bar.start, "a | needs a command on each side"));
		return wireOf(from, a, to, b, bar);
	});
	const stages = pipeline.commands.map((command, i): Stage => {
		const entry = entries[i] as Entry;
		// Only a statement's own pipeline reaches here with one: `check` answers that one first.
		if (command.help !== null)
			stop(
				no(
					command.help.at.start,
					"--help shows a program's help and runs nothing, so it gives no value to a $( )",
				),
			);
		const wire = wires[i] ?? null;
		const fed = i === 0 ? null : (wires[i - 1]?.input ?? null);
		if (command.out !== null && wire === null && top)
			stop(
				no(
					command.out.at.start,
					`>${command.out.name} names the output a pipe or a $( ) takes, and nothing takes it here`,
				),
			);
		if (command.into !== null && fed === null)
			stop(
				no(
					command.into.at.start,
					`<${command.into.name} names the input a pipe feeds, and no pipe feeds this command`,
				),
			);
		return {
			entry,
			flags: flagsOf(command, entry, list, text),
			told: toldOf(command, entry, fed, list, text),
			wire,
			fed,
			text: text.slice(command.at.start, command.at.end),
		};
	});
	const [first, ...rest] = stages;
	if (first === undefined) return stop(no(pipeline.at.start, "expected a program name"));
	return {stages: [first, ...rest], text: text.slice(pipeline.at.start, pipeline.at.end)};
}

/**
 * The inputs of `program` a pipe from a program on `list` can feed: each one an output there
 * fits, the pairs `wireOf` picks from when a line names no `>out` or `<in`. A command a person
 * clicks or types (`close`, `quit`) takes a shape no output sends, and is not one.
 *
 *   fedBy(ticket, [tracker, ticket, runs, trace])   ["ticket"]   (tracker's output ticket fits)
 *   fedBy(tracker, [tracker, ticket, runs, trace])  []           (file, close, quit: no output fits)
 */
export const fedBy = (program: Entry["program"], list: readonly Entry[]): readonly string[] =>
	Object.keys(program.inputs).filter((input) =>
		list.some((from) =>
			Object.keys(from.program.outputs).some(
				(output) => fit(from.program.outputs[output], program.inputs[input]) === "fits",
			),
		),
	);

/** Which output of `a` feeds which input of `b`: named by `>out` / `<in`, or the one pair whose shapes fit. */
function wireOf(from: Command, a: Entry, to: Command, b: Entry, bar: At) {
	const outs = namedOr(from.out, a.program.outputs, a.program.name, "output");
	const ins = namedOr(to.into, b.program.inputs, b.program.name, "input");
	const pairs = outs.flatMap((output) =>
		ins.map((input) => ({
			output,
			input,
			fit: fit(a.program.outputs[output], b.program.inputs[input]),
		})),
	);
	const fitting = pairs.filter((p) => p.fit === "fits");
	const named = from.out !== null && to.into !== null;
	const chosen =
		fitting.length === 1
			? fitting[0]
			: named && pairs[0]?.fit === "cannot_tell"
				? pairs[0]
				: undefined;
	if (chosen !== undefined) return {output: chosen.output, input: chosen.input};
	const show = (program: Entry["program"], kind: "outputs" | "inputs", names: readonly string[]) =>
		names.map((n) => `${n}: ${typeOf(program[kind][n].shape.json)}`).join("; ");
	if (fitting.length > 1)
		return stop(
			no(
				bar.start,
				`more than one way to wire ${a.program.name} into ${b.program.name}: ${fitting.map((p) => `${p.output} → ${p.input}`).join(", ")}. Name one with >output or <input`,
			),
		);
	return stop(
		no(
			bar.start,
			`does not fit: ${a.program.name}'s ${from.out === null ? "outputs" : "output"} (${show(a.program, "outputs", outs)}) fit no ${to.into === null ? "input" : "such input"} of ${b.program.name} (${show(b.program, "inputs", ins)}). Nothing was started`,
		),
	);
}

/** The one name given, checked, or every name declared. */
function namedOr(
	named: {readonly name: string; readonly at: At} | null,
	declared: Readonly<Record<string, unknown>>,
	program: string,
	kind: "output" | "input",
): readonly string[] {
	const all = Object.keys(declared);
	if (named === null) return all;
	if (!all.includes(named.name))
		return stop(
			no(
				named.at.start,
				`${program} has no ${kind} named ${named.name}`,
				didYouMean(named.name, all),
			),
		);
	return [named.name];
}

function flagsOf(command: Command, entry: Entry, list: ProgramList, text: string) {
	const {program} = entry;
	const declared = Object.keys(program.flags);
	const seen = new Set<string>();
	const flags = command.flags.map((given) => {
		const flag: Flag<unknown> | undefined = own(program.flags, given.name);
		if (flag === undefined)
			return stop(
				no(
					given.at.start,
					`${program.name} has no flag --${given.name}`,
					// Every program also takes --help: `--hlep` was meant as that.
					maybeDashes(didYouMean(given.name, [...declared, "help"])),
				),
			);
		if (seen.has(given.name)) return stop(no(given.at.start, `--${given.name} is given twice`));
		seen.add(given.name);
		const source = sourceOf(given, flag.shape, `--${given.name}`, list, text);
		return {name: given.name, source};
	});
	for (const name of declared) {
		if (seen.has(name)) continue;
		const flag: Flag<unknown> = program.flags[name];
		// A flag with a default is filled from it when the run starts.
		if (mustBeGiven(flag))
			stop(no(command.at.end, `${program.name} needs --${name}: ${flag.description}`));
	}
	return flags;
}

const maybeDashes = (name: string | undefined) => (name === undefined ? undefined : `--${name}`);

function toldOf(
	command: Command,
	entry: Entry,
	fed: string | null,
	list: ProgramList,
	text: string,
) {
	const {program} = entry;
	const declared = Object.keys(program.inputs);
	return command.told.map((given) => {
		const into: Declared<"input", unknown> | undefined = own(program.inputs, given.name);
		if (into === undefined) {
			const asFlag = Object.hasOwn(program.flags, given.name) ? ` (--${given.name} is a flag)` : "";
			return stop(
				no(
					given.at.start,
					`${program.name} has no input named ${given.name}${asFlag}`,
					didYouMean(given.name, declared),
				),
			);
		}
		if (given.name === fed)
			return stop(
				no(given.at.start, `${given.name} is fed by the pipe: give it values on one or the other`),
			);
		return {name: given.name, source: sourceOf(given, into.shape, given.name, list, text)};
	});
}

function sourceOf(
	given: Given,
	shape: Shape<unknown>,
	label: string,
	list: ProgramList,
	text: string,
): Source {
	const value: Value = given.value;
	if (value.kind === "text") {
		const read = readValue(shape, value.text);
		if (read.kind === "refused")
			return stop(
				no(
					value.at.start,
					`${label} does not take ${JSON.stringify(value.text)}: ${read.why}`,
					read.didYouMean,
				),
			);
		return {kind: "value", value: read.value};
	}
	const line = lineOf(value.pipeline, list, text, false);
	const last = line.stages[line.stages.length - 1] ?? line.stages[0];
	const command =
		value.pipeline.commands[value.pipeline.commands.length - 1] ?? value.pipeline.commands[0];
	const {program} = last.entry;
	const outs = namedOr(command.out, program.outputs, program.name, "output");
	const target = {shape};
	const fitting = outs.filter((o) => fit(program.outputs[o], target) === "fits");
	const named =
		command.out !== null && fit(program.outputs[command.out.name], target) === "cannot_tell";
	const output = fitting.length === 1 ? fitting[0] : named ? command.out?.name : undefined;
	if (output === undefined)
		return stop(
			no(
				value.at.start,
				fitting.length > 1
					? `more than one output of ${program.name} fits ${label}: ${fitting.join(", ")}. Name one with >output`
					: `does not fit: no output of ${program.name} (${outs.map((o) => `${o}: ${typeOf(program.outputs[o].shape.json)}`).join("; ")}) fits ${label} (${typeOf(shape.json)}). Nothing was started`,
			),
		);
	return {kind: "sub", line, output, at: value.at};
}
