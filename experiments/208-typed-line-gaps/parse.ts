import {Schema, SchemaAST} from "effect";
import type {Declared, Part} from "./register.ts";
import {spellingOf, spells} from "./spelling.ts";

// Experiment 204's run-time reader, with one change: a flag's value is checked against its
// spelling, the same one the compiler reads, before the schema decodes it.
//
// A sketch, next/. The same grammar as ./line.ts, read at run time against the programs the
// desk has. The two give the same answer on every line ./cases.ts and ./generated.ts list.
//
//   read("asks --ask a-approve-8 | ticket", programs)
//   // {_tag: "line", stages: [{program: "asks", flags: {ask: "a-approve-8"}, wire: {output: "ticket", input: "ticket"}}, ...], job: false}
//   read("asks | nope", programs)
//   // {_tag: "refused", why: "no program nope"}

interface Stage {
	readonly program: string;
	readonly flags: Readonly<Record<string, unknown>>;
	/** Into the next stage: this one's output and the next one's input. `null` on the last. */
	readonly wire: {readonly output: string; readonly input: string} | null;
}

type Read =
	| {readonly _tag: "line"; readonly stages: readonly Stage[]; readonly job: boolean}
	| {readonly _tag: "refused"; readonly why: string};

interface Seen {
	readonly program: Declared;
	readonly flags: Record<string, unknown>;
	readonly out: string | null;
	readonly into: string | null;
}

class Refused {
	readonly why: string;
	constructor(why: string) {
		this.why = why;
	}
}
const no = (why: string): never => {
	throw new Refused(why);
};

const own = <T>(table: Readonly<Record<string, T>>, name: string): T | undefined =>
	Object.hasOwn(table, name) ? table[name] : undefined;

const words = (line: string): string[] =>
	line
		.replaceAll("|", " | ")
		.replaceAll("&", " & ")
		.split(" ")
		.filter((w) => w !== "");

/**
 * A flag's value from its text. A spelled value: the text must follow the spelling, the one the
 * compiler reads, and is then the text itself or the number it spells. Anything else: the text
 * itself. A spelled text the schema's own check refuses would be a gap again; the law over the
 * generated lines, `huge` among them, is what shows there is none.
 */
const decodeText = (text: string, part: Part): {readonly value: unknown} | null => {
	const is = Schema.is(part.schema);
	const spelling = spellingOf(part.schema.ast);
	if (spelling !== undefined && !spells(spelling, text)) return null;
	if (is(text)) return {value: text};
	if (spelling !== undefined && is(Number(text))) return {value: Number(text)};
	return null;
};

/** The name the type check prints for a flag's shape: its `identifier`, through `UndefinedOr`, else text. */
const nameOf = (ast: SchemaAST.AST): string =>
	(SchemaAST.isUnion(ast)
		? ast.types.map(SchemaAST.resolveIdentifier).find((n) => n !== undefined)
		: SchemaAST.resolveIdentifier(ast)) ?? "text";

const command = (parts: readonly string[], programs: Readonly<Record<string, Declared>>): Seen => {
	const [name, ...rest] = parts;
	if (name === undefined) return no("a | needs a command on each side");
	if (/^[-<>]/.test(name) || name === "&") return no(`expected a program name, not ${name}`);
	const program = own(programs, name);
	if (program === undefined) return no(`no program ${name}`);
	const seen: Seen = {program, flags: {}, out: null, into: null};
	for (let i = 0; i < rest.length; i += 1) {
		const word = rest[i] ?? "";
		if (word.startsWith("--")) {
			const eq = word.indexOf("=");
			const flag = eq === -1 ? word.slice(2) : word.slice(2, eq);
			let text: string;
			if (eq !== -1) text = word.slice(eq + 1);
			else {
				const next = rest[i + 1];
				if (next === undefined) return no(`${name} --${flag} needs a value`);
				text = next;
				i += 1;
			}
			const part = own(program.flags, flag);
			if (part === undefined) return no(`${name} has no flag --${flag}`);
			if (Object.hasOwn(seen.flags, flag)) return no(`${name} --${flag} is given twice`);
			const read = decodeText(text, part);
			if (read === null)
				return no(`${name} --${flag}: ${text} does not fit ${nameOf(part.schema.ast)}`);
			seen.flags[flag] = read.value;
		} else if (word.startsWith(">")) {
			const out = word.slice(1);
			if (own(program.outputs, out) === undefined) return no(`${name} has no output >${out}`);
			if (seen.out !== null) return no(`${name} names an output twice`);
			Object.assign(seen, {out});
		} else if (word.startsWith("<")) {
			const into = word.slice(1);
			if (own(program.inputs, into) === undefined) return no(`${name} has no input <${into}`);
			if (seen.into !== null) return no(`${name} names an input twice`);
			Object.assign(seen, {into});
		} else return no(`${name} does not take ${word}: a flag is --name value`);
	}
	return seen;
};

/** A JSON Schema document as one string, so two shapes compare by text. */
const docOf = (part: Part): string => JSON.stringify(Schema.toJsonSchemaDocument(part.schema));

/** As today's fit check: the same JSON Schema, or the same as one member of a union. */
const fits = (from: Part, into: Part): boolean => {
	const sent = Schema.toJsonSchemaDocument(from.schema);
	const taken = Schema.toJsonSchemaDocument(into.schema);
	if (docOf(from) === docOf(into)) return true;
	const members: unknown = taken.schema.anyOf;
	if (!Array.isArray(members)) return false;
	return members.some(
		(m) =>
			JSON.stringify(m) === JSON.stringify(sent.schema) &&
			Object.keys(sent.definitions).every((k) => Object.hasOwn(taken.definitions, k)),
	);
};

const label = (seen: Seen, mark: string, named: string | null): string =>
	named === null ? seen.program.name : `${seen.program.name} ${mark}${named}`;

const wire = (left: Seen, right: Seen): {output: string; input: string} => {
	const outs = left.out === null ? Object.keys(left.program.outputs) : [left.out];
	const ins = right.into === null ? Object.keys(right.program.inputs) : [right.into];
	const pairs = outs.flatMap((output) =>
		ins
			.filter((input) => {
				const from = own(left.program.outputs, output);
				const into = own(right.program.inputs, input);
				return from !== undefined && into !== undefined && fits(from, into);
			})
			.map((input) => ({output, input})),
	);
	const where = `${label(left, ">", left.out)} | ${label(right, "<", right.into)}`;
	if (pairs.length === 0) return no(`${where}: no output fits an input`);
	if (pairs.length > 1)
		return no(`${where}: more than one way fits, name one with >output or <input`);
	const [only] = pairs;
	return only ?? no(`${where}: no output fits an input`);
};

/** Read one line against the desk's programs. */
export function read(line: string, programs: Readonly<Record<string, Declared>>): Read {
	try {
		let all = words(line);
		if (all.length === 0) return no("a line needs a program");
		const job = all.at(-1) === "&";
		if (job) all = all.slice(0, -1);
		if (all.includes("&")) return no("& goes only at the end of a line");
		const groups: string[][] = [[]];
		for (const word of all) {
			if (word === "|") groups.push([]);
			else groups.at(-1)?.push(word);
		}
		const seen: Seen[] = [];
		const stages: Stage[] = [];
		for (const group of groups) {
			const now = command(group, programs);
			const before = seen.at(-1);
			if (before !== undefined) {
				const last = stages.pop();
				if (last !== undefined) stages.push({...last, wire: wire(before, now)});
			}
			seen.push(now);
			stages.push({program: now.program.name, flags: now.flags, wire: null});
		}
		return {_tag: "line", stages, job};
	} catch (stop) {
		if (stop instanceof Refused) return {_tag: "refused", why: stop.why};
		throw stop;
	}
}
