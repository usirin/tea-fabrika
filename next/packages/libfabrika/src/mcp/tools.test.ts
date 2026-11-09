import {Machine} from "@demlik/tea/effect";
// P25 B, next/. All generated declarations use the real Program.make.
import {expect, it} from "@effect/vitest";
import {Arbitrary, Effect, Result, Schema} from "effect";
import {Input, Program, stepper} from "../app/program.ts";
import {
	Call,
	Declaration,
	Payload,
	Save,
	notesFixture,
	options,
	programFixture,
	Small,
	type AnyProgram,
	type ToolsModule,
} from "./mcp.test-support.ts";

const actual = Effect.promise((): Promise<ToolsModule> => import("./tools.ts"));
const schemaProgram = (schema: Schema.Codec<Schema.Json, unknown>): AnyProgram => {
	const Model = Schema.Struct({body: Schema.String, version: Small});
	const msg = Schema.Struct({type: Schema.Literal("extra"), value: schema});
	const machine = Machine.make({
		model: Model,
		msg,
		cmds: [],
		init: (s) => [s ?? {body: "", version: 0}, []],
		update: {extra: (s) => [s, []]},
	});
	return Program.make({
		name: "generated",
		machine,
		state: {v: 1, upgrades: []},
		view: (m) => m,
		refuse: () => null,
		inputs: {extra: "Generated tree"},
		outputs: {},
		writes: {},
		wake: () => null,
	});
};
const names = (ps: ReadonlyArray<AnyProgram>) => [
	"ps",
	...ps.flatMap((p) =>
		Object.entries(p.inputs)
			.filter(([, port]) => port._tag === "read" || !port.personOnly)
			.map(([name]) => `${p.name}_${name}`),
	),
];
const listed = (api: ToolsModule, programs: ReadonlyArray<AnyProgram>) => {
	const result = api.listTools(programs);
	expect(Result.isSuccess(result), "loaded declaration must project").toBe(true);
	if (Result.isFailure(result)) throw new Error("projection failed");
	return result.success;
};
const orderLaw = (api: ToolsModule, programs: ReadonlyArray<AnyProgram>) => {
	expect(listed(api, programs).map((t) => t.name)).toEqual(names(programs));
	for (const p of programs) expect(api.toolNames(p)).toEqual(names([p]).slice(1));
	for (const p of programs)
		for (const input of Object.keys(p.inputs))
			expect(api.toolName(p.name, input)).toBe(`${p.name}_${input}`);
};
const hintLaw = (api: ToolsModule, programs: ReadonlyArray<AnyProgram>) => {
	const tools = listed(api, programs);
	expect(tools[0]?.annotations).toEqual({readOnlyHint: true});
	for (const p of programs)
		for (const [name, port] of Object.entries(p.inputs)) {
			if (port._tag === "write" && port.personOnly) continue;
			const t = tools.find((t) => t.name === `${p.name}_${name}`);
			expect(t?.description).toBe(port.description);
			expect(t?.annotations?.readOnlyHint).toBe(port._tag === "read" ? true : undefined);
		}
};
const GeneratedDeclaration = Schema.Struct({
	name: Schema.String,
	ports: Schema.Array(
		Schema.Struct({
			word: Schema.Array(Schema.Literals(["a", "b", "c", "x", "y", "z", "0", "1", "_"])).check(
				Schema.isMinLength(1),
				Schema.isMaxLength(20),
			),
			read: Schema.Boolean,
			hidden: Schema.Boolean,
			description: Schema.String,
		}),
	).check(Schema.isMaxLength(24)),
});
const generatedProgram = (spec: typeof GeneratedDeclaration.Type, name: string): AnyProgram => {
	const Model = Schema.Struct({body: Schema.String, version: Small});
	const ports = spec.ports.map((p, i) => ({...p, name: `port_${i}_${p.word.join("")}`}));
	const msg = Schema.Union([
		Schema.Struct({type: Schema.Literal("internal")}),
		...ports
			.filter((p) => !p.read)
			.map((p) =>
				Schema.Struct({type: Schema.Literal(p.name), value: Schema.Struct({body: Schema.String})}),
			),
	]);
	const machine = Machine.make({
		model: Model,
		msg,
		cmds: [],
		init: (s) => [s ?? {body: "", version: 0}, []],
		update: Object.fromEntries(
			["internal", ...ports.filter((p) => !p.read).map((p) => p.name)].map((name) => [
				name,
				(m: typeof Model.Type) => [m, []] as const,
			]),
		),
	});
	const read = (description: string) =>
		Input.cases.read.make({
			schema: Schema.Struct({note: Schema.String}),
			description,
			answer: (view: typeof Model.Type, query) => ({...view, note: query.note}),
		});
	return Program.make({
		name,
		machine,
		state: {v: 1, upgrades: []},
		view: (m) => m,
		refuse: () => null,
		inputs: {
			visible: read("Positive control"),
			...Object.fromEntries(
				ports.map((p) => [
					p.name,
					p.read
						? read(p.description)
						: p.hidden
							? {description: p.description, personOnly: true as const}
							: p.description,
				]),
			),
		},
		outputs: {},
		writes: {},
		wake: () => null,
	});
};
const Programs = Schema.Array(GeneratedDeclaration).check(Schema.isMaxLength(12));
it.prop(
	"fixture control: generated port names and mixed declarations load",
	{spec: GeneratedDeclaration},
	({spec}) => {
		const p = generatedProgram(spec, "fixture");
		expect(Schema.is(Program.schema)(p)).toBe(true);
		orderLaw(control, [p]);
		hintLaw(control, [p]);
	},
	options,
);
it.prop(
	"fixture control: every generated declaration loads through Program.make",
	{spec: Declaration},
	({spec}) => {
		const p = programFixture({...spec, name: "fixture"});
		expect(Schema.is(Program.schema)(p)).toBe(true);
		const loaded = stepper(p);
		expect(Result.isSuccess(loaded)).toBe(true);
		if (Result.isSuccess(loaded)) expect(loaded.success.init(null)._tag).toBe("stepped");
	},
	options,
);
it.effect.prop(
	"L01 p63 tools preserve every permitted declaration and its order",
	{specs: Programs},
	({specs}) =>
		Effect.gen(function* () {
			const programs = specs.map((s, i) =>
				generatedProgram(s, `program_${i}_${s.name.slice(0, 20).replaceAll(/[^a-z0-9]/g, "x")}`),
			);
			const api = yield* actual;
			orderLaw(api, programs);
			hintLaw(api, programs);
		}),
	options,
);
it.effect.prop(
	"L02 read-only hints and descriptions follow port kind",
	{spec: Declaration},
	({spec}) =>
		Effect.gen(function* () {
			hintLaw(yield* actual, [programFixture({...spec, name: "generated"})]);
		}),
	options,
);
const hiddenLaw = (api: Pick<ToolsModule, "readCall">, name: string, value: Schema.Json) => {
	const ps = [notesFixture()];
	expect(api.readCall(ps, "notes_approve", value)._tag).toBe("refused");
	expect(api.readCall(ps, `unknown_${name}`, value)._tag).toBe("refused");
	expect(api.readCall(ps, "notes_read", {value: {note: name}})).toEqual(
		Call.cases.input.make({program: "notes", input: "read", value: {note: name}}),
	);
};
it.effect.prop(
	"L03 hidden and unknown tools cannot be called",
	{name: Schema.String, value: Schema.Json},
	({name, value}) =>
		Effect.gen(function* () {
			hiddenLaw(yield* actual, name, value);
		}),
	options,
);
it.effect.prop(
	"L03 generated hidden inputs stay uncallable while every permitted name decodes",
	{spec: GeneratedDeclaration, raw: Schema.Json, body: Schema.String},
	({spec, raw, body}) =>
		Effect.gen(function* () {
			const api = yield* actual,
				p = generatedProgram(spec, "generated");
			for (const [name, port] of Object.entries(p.inputs)) {
				if (port._tag === "write" && port.personOnly) {
					expect(api.readCall([p], `generated_${name}`, raw)._tag).toBe("refused");
					continue;
				}
				const value = port._tag === "read" ? {note: body} : {body};
				expect(api.readCall([p], `generated_${name}`, {value})).toEqual(
					Call.cases.input.make({
						program: "generated",
						input: name,
						value: port._tag === "read" ? value : {type: name, value},
					}),
				);
			}
			expect(api.readCall([p], `unknown_${spec.name}`, raw)._tag).toBe("refused");
			expect(api.readCall([p], "generated_internal", {})._tag).toBe("refused");
		}),
	options,
);

// Independent JSON Schema reference walk, including definitions. It never asks readCall to
// decide whether its own advertised references are valid.
const refs = (node: Schema.Json, root: Schema.Json): void => {
	// Always assert the root, including a tree with no reference. This helper must check something.
	expect(root).toBeDefined();
	if (node === null || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const child of node) refs(child, root);
		return;
	}
	if ("$ref" in node) {
		const ref = node["$ref"];
		expect(typeof ref).toBe("string");
		if (typeof ref !== "string" || !ref.startsWith("#/"))
			throw new Error("local reference required");
		let resolved: Schema.Json | undefined = root;
		for (const key of ref.slice(2).split("/")) {
			resolved = Schema.is(Schema.JsonObject)(resolved)
				? resolved[key.replaceAll("~1", "/").replaceAll("~0", "~")]
				: undefined;
		}
		expect(resolved, "broken $ref").toBeDefined();
	}
	for (const child of Object.values(node)) refs(child, root);
};
const Field = Schema.Struct({
	kind: Schema.Literals(["string", "int", "boolean", "literal"]),
	nested: Schema.Boolean,
	reference: Schema.Boolean,
});
const Tree = Schema.Struct({
	fields: Schema.Array(Field).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
	union: Schema.Boolean,
});
it.effect.prop(
	"L04 generated schema trees retain nested structs, literal unions and named references",
	{tree: Tree},
	({tree}) =>
		Effect.gen(function* () {
			const fields = Object.fromEntries(
				tree.fields.map((field, i) => {
					const leaf =
						field.kind === "string"
							? Schema.String
							: field.kind === "int"
								? Schema.Int
								: field.kind === "boolean"
									? Schema.Boolean
									: Schema.Literal("fixed");
					const wrapped = field.nested
						? Schema.Struct({item: leaf, items: Schema.Array(leaf)})
						: leaf;
					return [
						`field${i}`,
						field.reference ? wrapped.annotate({identifier: `Ref${i}`}) : wrapped,
					];
				}),
			);
			const struct = Schema.Struct(fields);
			const schema = tree.union
				? Schema.Union([
						Schema.Struct({choice: Schema.Literal("one"), payload: struct}),
						Schema.Struct({choice: Schema.Literal("two"), payload: struct}),
					])
				: struct;
			const p = schemaProgram(schema);
			const api = yield* actual;
			const tool = listed(api, [p]).find((t) => t.name === "generated_extra")!;
			refs(tool.inputSchema, tool.inputSchema);
			const advertised = JSON.stringify(tool.inputSchema);
			for (const [i, field] of tree.fields.entries()) {
				expect(advertised).toContain(`field${i}`);
				if (field.reference) expect(advertised).toContain(`Ref${i}`);
			}
			if (tree.union) expect(advertised).toMatch(/anyOf|oneOf/);
			for (const value of yield* Arbitrary.sampleEffect(Arbitrary.schema(schema), {
				seed: 119120,
				count: 20,
				size: 100,
			})) {
				expect(api.readCall([p], "generated_extra", {value})).toEqual(
					Call.cases.input.make({
						program: "generated",
						input: "extra",
						value: {type: "extra", value},
					}),
				);
				expect(api.readCall([p], "generated_extra", {value: []})._tag).toBe("refused");
			}
		}),
	options,
);
const shapeLaw = (api: ToolsModule, value: typeof Save.Type, extra: typeof Payload.Type) => {
	const p = programFixture({
		name: "notes",
		ports: [
			{name: "save", hidden: false, description: "save"},
			{name: "inc", hidden: false, description: "inc"},
			{name: "extra", hidden: false, description: "extra"},
		],
	});
	const tools = listed(api, [p]);
	for (const t of tools) {
		expect(t.inputSchema.type).toBe("object");
		refs(t.inputSchema, t.inputSchema);
	}
	expect(tools.find((t) => t.name === "notes_save")?.inputSchema).toMatchObject({
		properties: {value: {type: "object"}},
	});
	expect(tools.find((t) => t.name === "notes_inc")?.inputSchema).not.toHaveProperty(
		"properties.value",
	);
	expect(api.readCall([p], "notes_save", {value})).toEqual(
		Call.cases.input.make({program: "notes", input: "save", value: {type: "save", value}}),
	);
	expect(api.readCall([p], "notes_inc", {})).toEqual(
		Call.cases.input.make({program: "notes", input: "inc", value: {type: "inc"}}),
	);
	expect(api.readCall([p], "notes_extra", {value: extra})).toEqual(
		Call.cases.input.make({program: "notes", input: "extra", value: {type: "extra", value: extra}}),
	);
	expect(api.readCall([p], "notes_save", {value: {value}})._tag).toBe("refused");
	expect(api.readCall([p], "notes_save", {type: "inc", value})._tag).toBe("refused");
};
it.effect.prop(
	"L04 schemas preserve references, unions and one value wrapper",
	{save: Save, extra: Payload},
	({save, extra}) =>
		Effect.gen(function* () {
			shapeLaw(yield* actual, save, extra);
		}),
	options,
);
it.effect.prop(
	"L05 malformed SDK arguments return typed refusals, never throw",
	{value: Schema.Json},
	({value}) =>
		Effect.gen(function* () {
			const api = yield* actual;
			expect(() =>
				Schema.decodeUnknownSync(Call)(
					api.readCall([notesFixture()], "notes_save", {value: {bad: value}}),
				),
			).not.toThrow();
			expect(api.readCall([notesFixture()], "notes_read", {value: {note: "valid"}})._tag).toBe(
				"input",
			);
		}),
	options,
);
it.effect.prop(
	"L05 unsupported loaded schemas and duplicate tools fail visibly",
	{description: Schema.String},
	({description}) =>
		Effect.gen(function* () {
			const api = yield* actual;
			const unsupported = schemaProgram(
				Schema.declare((u): u is Schema.Json => typeof u === "string"),
			);
			const bad = api.listTools([unsupported]);
			expect(Result.isFailure(bad)).toBe(true);
			expect(Result.isFailure(bad) ? bad.failure.why : null).toBe("bad_schema");
			const p = programFixture({name: "notes", ports: [{name: "inc", description, hidden: false}]});
			const duplicate = api.listTools([p, p]);
			expect(Result.isFailure(duplicate)).toBe(true);
			expect(Result.isFailure(duplicate) ? duplicate.failure.why : null).toBe("duplicate_tool");
			expect(Result.isSuccess(api.listTools([p]))).toBe(true);
		}),
	options,
);

// These are assertion plants, not replacement integrations. Each feeds the same assertion a
// deliberately wrong subject and proves it refuses it even while the product import is red.
const control: ToolsModule = {
	listTools: (programs) =>
		Result.succeed([
			{
				name: "ps",
				description: "Processes",
				inputSchema: {type: "object"},
				annotations: {readOnlyHint: true},
			},
			...programs.flatMap((p) =>
				Object.entries(p.inputs)
					.filter(([, port]) => port._tag === "read" || !port.personOnly)
					.map(([name, port]) => ({
						name: `${p.name}_${name}`,
						description: port.description,
						inputSchema: {
							type: "object" as const,
							properties: name === "inc" ? {} : {value: {type: "object"}},
						},
						...(port._tag === "read" ? {annotations: {readOnlyHint: true as const}} : {}),
					})),
			),
		]),
	toolName: (p, i) => `${p}_${i}`,
	toolNames: (p) => names([p]).slice(1),
	readCall: (ps, name, args) => {
		if (name === "ps") return Call.cases.ps.make({});
		for (const p of ps)
			for (const [input, port] of Object.entries(p.inputs)) {
				if (`${p.name}_${input}` !== name || (port._tag === "write" && port.personOnly)) continue;
				const object = Schema.decodeUnknownResult(Schema.JsonObject)(args);
				if (Result.isFailure(object)) return Call.cases.refused.make({why: "bad_input"});
				if ("type" in object.success) return Call.cases.refused.make({why: "bad_input"});
				const decoded = Schema.decodeUnknownResult(port.schema)(
					port._tag === "read" ? object.success.value : {...object.success, type: input},
				);
				if (Result.isFailure(decoded)) return Call.cases.refused.make({why: "bad_input"});
				const value = Schema.decodeUnknownResult(Schema.Json)(decoded.success);
				if (Result.isFailure(value)) return Call.cases.refused.make({why: "bad_input"});
				return Call.cases.input.make({program: p.name, input, value: value.success});
			}
		return Call.cases.refused.make({why: "unknown tool"});
	},
};
it("plant control: the independent model passes the same tool assertions", () => {
	const ps = [notesFixture()];
	orderLaw(control, ps);
	hintLaw(control, ps);
	hiddenLaw(control, "n", null);
	shapeLaw(control, {note: "n", base: 0, body: "b"}, {shape: "count", count: 1});
});
it("plant L01: handwritten tools omit a newly declared input and sorted order", () => {
	const p = programFixture({
		name: "notes",
		ports: [
			{name: "extra", hidden: false, description: "new"},
			{name: "inc", hidden: false, description: "next"},
		],
	});
	expect(() =>
		orderLaw(
			{
				...control,
				listTools: () =>
					Result.succeed([{name: "ps", description: "", inputSchema: {type: "object"}}]),
			},
			[p],
		),
	).toThrow();
	expect(() =>
		orderLaw(
			{
				...control,
				listTools: (ps) =>
					Result.succeed([...listed(control, ps)].sort((a, b) => a.name.localeCompare(b.name))),
			},
			[p],
		),
	).toThrow();
});
it("plant L02: a write falsely marked read-only", () => {
	expect(() =>
		hintLaw(
			{
				...control,
				listTools: (ps) =>
					Result.succeed(
						listed(control, ps).map((t) => ({...t, annotations: {readOnlyHint: true}})),
					),
			},
			[notesFixture()],
		),
	).toThrow();
});
it("plant L03: hidden input accepts calls", () => {
	expect(() =>
		hiddenLaw({...control, readCall: () => Call.cases.ps.make({})}, "a", null),
	).toThrow();
});
it("plant L04: broken reference, double value and wrong case", () => {
	expect(() => refs({$ref: "#/$defs/missing"}, {})).toThrow(/broken \$ref/);
	for (const bad of [
		{type: "save", value: {value: {note: "n", base: 0, body: "b"}}},
		{type: "inc"},
	])
		expect(() =>
			shapeLaw(
				{
					...control,
					readCall: () => Call.cases.input.make({program: "notes", input: "save", value: bad}),
				},
				{note: "n", base: 0, body: "b"},
				{shape: "count", count: 1},
			),
		).toThrow();
});
it("plant L05: synchronous constructor on malformed outside data", () => {
	const unsafe = () => Schema.decodeUnknownSync(Save)({body: 3});
	expect(() => expect(unsafe).not.toThrow()).toThrow();
});
