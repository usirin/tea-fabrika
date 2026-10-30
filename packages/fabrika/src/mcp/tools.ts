import type {Inputs} from "../program/program.ts";
import type {JsonSchema} from "../program/shape.ts";
import type {ProgramList} from "../shell/programs.ts";

// A program list as MCP tools (spec 2026-07-28, "Tools"): one tool per input of each program, or
// one per case of an input that is a tagged union, made from the input's own schema, and one tool
// that lists what runs. No program has a tool written by hand: a new input or case is a new tool,
// and a renamed one is a renamed tool.
//
//   toolsOf(programList([listed(tracker, ...)]))
//   // [{name: "runs", ..., annotations: {readOnlyHint: true}},
//   //  {name: "tracker_file", description: "File a new ticket: ...",
//   //   inputSchema: {type: "object", properties: {value: <file's fields, as JSON Schema>},
//   //                 required: ["value"], additionalProperties: false}},
//   //  ...,
//   //  {name: "tracker_query", ..., annotations: {readOnlyHint: true}}, ...]
//   callOf(list, "tracker_file", {value: {title: "Login fails", body: ""}})
//   // {kind: "input", program: "tracker", input: "do", value: {kind: "file", title: "Login fails", body: ""}}
//   callOf(list, "tracker_file", {value: {title: 3}})
//   // {kind: "refused", why: "tracker's file does not fit: ..."}
//   callOf(list, "tracker_answer", {value: {...}})
//   // {kind: "refused", why: "there is no tool tracker_answer"}: a case only a person sends
//
// An Elm program's message is one union. So a program whose messages are many kinds may take them
// on one input, as one tagged union, and its run's one mailbox reads them in the order told. An
// agent still sees one tool per kind: the split is made here, never in the program.
// Each case's tool takes the case's fields, the tag left out, with the case's own description; a
// call puts the tag back and tells the one input.
//
// What a case says of itself is in its schema's annotations (../program/shape.ts, `Case`):
// `{writes: false}` gives its tool MCP's `readOnlyHint`, and `{personOnly: true}` gives it no tool
// at all, so a call to it is refused as any unknown tool is. These tools are an agent's.
//
// The name is `<program>_<input>`, or `<program>_<case>`. A program's name has no `_`
// (programList holds it to small letters, digits and -), so the first `_` splits it, and no tool of
// an input is ever named `runs`. A dot would read better, but the Messages API takes a tool name of
// letters, digits, `_` and `-` only, and Claude Code hands MCP tools to it by their names. Two of a
// program's tools with one name is a mistake in the program, and is refused when its tools are made.
//
// The value goes under `value`, never as the arguments themselves: the spec wants an object
// there, and an input's schema may be a union, a number or a string. A case's fields may be a union
// too (`tracker_query`: `{ticket}` or `{status, find?}`). Its `$defs` move up to the top, where the
// `$ref`s inside it point.
//
// An input whose schema gives no JSON Schema (a Standard Schema from outside Effect) has no tool:
// an agent could not be told what it takes.

/** One tool, in the spec's words. */
export interface Tool {
	readonly name: string;
	readonly description: string;
	/** Always an object, as the spec wants: an input's own schema is under `value`. */
	readonly inputSchema: JsonSchema & {readonly type: "object"};
	/** The spec's hints about what a call does. Here only `readOnlyHint`, on a tool that writes nothing. */
	readonly annotations?: {readonly readOnlyHint: true};
}

/** The tool that says what runs and what can be started. */
export const RUNS = "runs";

const RUNS_TOOL: Tool = {
	name: RUNS,
	description:
		"What runs now and what can be started: each program you can drive, with its tools; your own runs, with what each window shows; and the runs in the person's tiles, which you can see but not drive. Your writes show in the person's tiles through the ledger.",
	inputSchema: {type: "object", additionalProperties: false},
	annotations: {readOnlyHint: true},
};

/** The tool's name for one input, or one case, of one program. */
export const toolNameOf = (program: string, part: string): string => `${program}_${part}`;

/** The tool's input schema around an input's own: the value under `value`, its `$defs` at the top. */
const wrap = (json: JsonSchema): Tool["inputSchema"] => {
	const {$defs, ...value} = json;
	return {
		type: "object",
		properties: {value},
		required: ["value"],
		additionalProperties: false,
		...($defs === undefined ? {} : {$defs}),
	};
};

/** One tool of a program, before it is named: a whole input, or one case of it. */
interface Part {
	/** What follows `<program>_`: the input's name, or the case's tag. */
	readonly part: string;
	readonly input: string;
	readonly description: string;
	readonly json: JsonSchema;
	readonly writes: boolean;
	readonly problem: (value: unknown) => string | undefined;
	/** What the input is told for a call's value: the value itself, or the case's tag put back. */
	readonly told: (value: unknown) => unknown;
}

/** The tools of a program's inputs, as an agent has them. Two with one name are refused here. */
const partsOf = (program: string, inputs: Inputs): readonly Part[] => {
	const parts = Object.entries<Inputs[string]>(inputs).flatMap(([input, declared]): Part[] => {
		const {json, cases, problem} = declared.shape;
		if (json === undefined) return [];
		if (cases === undefined)
			return [
				{
					part: input,
					input,
					description: declared.description,
					json,
					writes: true,
					problem,
					told: (value) => value,
				},
			];
		return cases
			.filter((c) => !c.personOnly)
			.map((c) => ({
				part: c.tag,
				input,
				description: c.description ?? declared.description,
				json: c.json,
				writes: c.writes,
				problem: c.problem,
				told: (value) => ({[c.key]: c.tag, ...Object(value)}),
			}));
	});
	const seen = new Set<string>();
	for (const {part} of parts) {
		if (seen.has(part))
			throw new Error(`${program} has two tools named ${toolNameOf(program, part)}`);
		seen.add(part);
	}
	return parts;
};

/** The names of a program's tools, in the order `toolsOf` lists them. */
export const toolNamesOf = (program: string, inputs: Inputs): readonly string[] =>
	partsOf(program, inputs).map((p) => toolNameOf(program, p.part));

/** Every tool of a program list: `runs` first, then each program's, in the list's order. */
export const toolsOf = (list: ProgramList): readonly Tool[] => {
	const tools: Tool[] = [RUNS_TOOL];
	for (const [name, entry] of list)
		for (const p of partsOf(name, entry.program.inputs))
			tools.push({
				name: toolNameOf(name, p.part),
				description: `${p.description} Sent to ${name}'s input ${p.input}, in your own run of ${name}, started on first use. ${name}: ${entry.program.description}`,
				inputSchema: wrap(p.json),
				...(p.writes ? {} : {annotations: {readOnlyHint: true}}),
			});
	return tools;
};

/** A tool call, read: `runs`, one input's value that fits it, or why not. */
export type Call =
	| {readonly kind: "runs"}
	| {
			readonly kind: "input";
			readonly program: string;
			readonly input: string;
			readonly value: unknown;
	  }
	| {readonly kind: "refused"; readonly why: string};

/** Read a call by the list's own schemas: the tool must be one of `toolsOf(list)`, its value must fit. */
export const callOf = (list: ProgramList, name: string, args: unknown): Call => {
	if (name === RUNS) return {kind: "runs"};
	const at = name.indexOf("_");
	const program = name.slice(0, at);
	const part = name.slice(at + 1);
	const entry = at === -1 ? undefined : list.get(program);
	const found =
		entry === undefined
			? undefined
			: partsOf(program, entry.program.inputs).find((p) => p.part === part);
	if (found === undefined) return {kind: "refused", why: `there is no tool ${name}`};
	if (typeof args !== "object" || args === null || !Object.hasOwn(args, "value"))
		return {kind: "refused", why: `${name} takes {value: ...}`};
	const value: unknown = Reflect.get(args, "value");
	const why = found.problem(value);
	if (why !== undefined) return {kind: "refused", why: `${program}'s ${part} does not fit: ${why}`};
	return {kind: "input", program, input: found.input, value: found.told(value)};
};
