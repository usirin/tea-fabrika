import type {Inputs} from "../program/program.ts";
import type {JsonSchema} from "../program/shape.ts";
import type {ProgramList} from "../shell/programs.ts";

// A program list as MCP tools (spec 2026-07-28, "Tools"): one tool per input of each program, made
// from the input's own schema, and one tool that lists what runs. No program has a tool written by
// hand: a new input is a new tool, and a renamed input is a renamed tool.
//
//   toolsOf(programList([listed(tracker, ...)]))
//   // [{name: "runs", ..., annotations: {readOnlyHint: true}},
//   //  {name: "tracker_file", description: "File a new ticket: ...",
//   //   inputSchema: {type: "object", properties: {value: <File's JSON Schema>}, required: ["value"],
//   //                 additionalProperties: false}},
//   //  ...,
//   //  {name: "tracker_query", ..., annotations: {readOnlyHint: true}}, ...]
//   callOf(list, "tracker_file", {value: {title: "Login fails", body: ""}})
//   // {kind: "input", program: "tracker", input: "file", value: {title: "Login fails", body: ""}}
//   callOf(list, "tracker_file", {value: {title: 3}})
//   // {kind: "refused", why: "tracker's file does not fit: ..."}
//   callOf(list, "tracker_answer", {value: {...}})
//   // {kind: "refused", why: "there is no tool tracker_answer"}: an input only a person tells
//
// What an input says of itself is in its declaration (../program/shape.ts, `input`):
// `{writes: false}` gives its tool MCP's `readOnlyHint`, and `{personOnly: true}` gives it no tool
// at all, so a call to it is refused as any unknown tool is. These tools are an agent's.
//
// The name is `<program>_<input>`. A program's name has no `_` (programList holds it to small
// letters, digits and -), so the first `_` splits it, and no tool of an input is ever named
// `runs`. A dot would read better, but the Messages API takes a tool name of letters, digits, `_`
// and `-` only, and Claude Code hands MCP tools to it by their names.
//
// The value goes under `value`, never as the arguments themselves: the spec wants an object
// there, and an input's schema may be a union, a number, a string or null. Its `$defs` move up to
// the top, where the `$ref`s inside it point.
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

/** The tool's name for one input of one program. */
export const toolNameOf = (program: string, input: string): string => `${program}_${input}`;

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

/** The inputs of a program an agent has a tool for, each with its JSON Schema, in declared order. */
const toolInputsOf = (
	inputs: Inputs,
): ReadonlyArray<{
	readonly input: string;
	readonly declared: Inputs[string];
	readonly json: JsonSchema;
}> =>
	Object.entries<Inputs[string]>(inputs).flatMap(([input, declared]) => {
		const json = declared.shape.json;
		return json === undefined || declared.personOnly ? [] : [{input, declared, json}];
	});

/** The names of a program's tools, in the order `toolsOf` lists them. */
export const toolNamesOf = (program: string, inputs: Inputs): readonly string[] =>
	toolInputsOf(inputs).map(({input}) => toolNameOf(program, input));

/** Every tool of a program list: `runs` first, then each program's, in the list's order. */
export const toolsOf = (list: ProgramList): readonly Tool[] => {
	const tools: Tool[] = [RUNS_TOOL];
	for (const [name, entry] of list)
		for (const {input, declared, json} of toolInputsOf(entry.program.inputs))
			tools.push({
				name: toolNameOf(name, input),
				description: `${declared.description} Sent to ${name}'s input ${input}, in your own run of ${name}, started on first use. ${name}: ${entry.program.description}`,
				inputSchema: wrap(json),
				...(declared.writes ? {} : {annotations: {readOnlyHint: true}}),
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
	const input = name.slice(at + 1);
	const entry = at === -1 ? undefined : list.get(program);
	const found =
		entry === undefined
			? undefined
			: toolInputsOf(entry.program.inputs).find((t) => t.input === input);
	if (found === undefined) return {kind: "refused", why: `there is no tool ${name}`};
	if (typeof args !== "object" || args === null || !Object.hasOwn(args, "value"))
		return {kind: "refused", why: `${name} takes {value: ...}`};
	const value: unknown = Reflect.get(args, "value");
	const why = found.declared.shape.problem(value);
	if (why !== undefined)
		return {kind: "refused", why: `${program}'s ${input} does not fit: ${why}`};
	return {kind: "input", program, input, value};
};
