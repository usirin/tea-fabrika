// P8, next/. Port source: apps/fabrika/src/host/agents.test.ts at 13e0c2305beb.
// Mapping: toolsOf/callOf -> schema tools and malformed calls; SDK client -> approval/retry/writer.
// Tracker, quit, desk control, top-bar counts and the old host/stdio handshake are not ported.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import {expect, it} from "@effect/vitest";
import {Id} from "@kampus/libfabrika";
import {senderTest} from "@kampus/libfabrika/testing";
import {Arbitrary, Effect, FileSystem, Schema} from "effect";

const SEED = 119120;
const options = {arbitrary: {seed: SEED, runs: 300, size: 4096, concurrency: 1}, timeout: 60_000};
const text = (min: number, max: number) =>
	Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max));
const int = (min: number, max: number) =>
	Schema.Int.check(Schema.isBetween({minimum: min, maximum: max}));
const json = (depth: number): Schema.Codec<Schema.Json> =>
	depth === 0
		? Schema.Union([Schema.Null, Schema.Boolean, int(-4096, 4096), text(0, 128)])
		: Schema.Union([
				Schema.Null,
				Schema.Boolean,
				int(-4096, 4096),
				text(0, 128),
				Schema.Array(json(depth - 1)).check(Schema.isMinLength(0), Schema.isMaxLength(8)),
				Schema.Record(text(1, 96), json(depth - 1)).check(
					Schema.isMinProperties(0),
					Schema.isMaxProperties(8),
				),
			]);
const AgentCalls = Arbitrary.schema(
	Schema.Struct({
		name: text(1, 96),
		other: text(1, 96),
		body: text(0, 4096),
		input: json(4),
		version: int(0, 64),
	}),
);
type Call = typeof AgentCalls extends Arbitrary.Arbitrary<infer C> ? C : never;
type Tool = {
	readonly name: string;
	readonly inputSchema: unknown;
	readonly annotations?: {readonly readOnlyHint?: boolean};
};
type InputDeclaration = {
	readonly name: string;
	readonly schema: Schema.Codec<unknown>;
	readonly readOnly: boolean;
	readonly personOnly: boolean;
};
const standard: ReadonlyArray<InputDeclaration> = [
	{name: "list", schema: Schema.Struct({}), readOnly: true, personOnly: false},
	{name: "read", schema: Schema.Struct({note: Schema.String}), readOnly: true, personOnly: false},
	{
		name: "save",
		schema: Schema.Struct({note: Schema.String, base: Schema.Number, body: Schema.String}),
		readOnly: false,
		personOnly: false,
	},
	{
		name: "person_input",
		schema: Schema.Struct({body: Schema.String}),
		readOnly: false,
		personOnly: true,
	},
];
const DeclarationCases = Arbitrary.array(
	Arbitrary.schema(
		Schema.Struct({
			field: text(1, 96),
			type: Schema.Literals(["string", "number", "boolean"]),
			readOnly: Schema.Boolean,
			personOnly: Schema.Boolean,
		}),
	),
	{minLength: 0, maxLength: 12},
).pipe(
	Arbitrary.map((inputs) => [
		...standard,
		...inputs.map((input, i) => ({
			name: `extra${i}`,
			schema: Schema.Struct({
				[input.field]:
					input.type === "string"
						? Schema.String
						: input.type === "number"
							? Schema.Number
							: Schema.Boolean,
			}),
			readOnly: input.readOnly,
			personOnly: input.personOnly,
		})),
	]),
);
const inputSchema = (input: InputDeclaration) =>
	Schema.toJsonSchemaDocument(Schema.Struct({value: input.schema})).schema;
const tools = (
	actual: ReadonlyArray<Tool>,
	declarations: ReadonlyArray<InputDeclaration> = standard,
) => {
	const publicInputs = declarations.filter((d) => !d.personOnly);
	expect(actual.map((t) => t.name)).toEqual(["ps", ...publicInputs.map((d) => `notes_${d.name}`)]);
	expect(actual[0]?.inputSchema).toMatchObject({type: "object"});
	expect(actual[0]?.annotations?.readOnlyHint).toBe(true);
	for (const [i, d] of publicInputs.entries()) {
		const tool = actual[i + 1]!;
		expect(tool.inputSchema).toMatchObject(inputSchema(d));
		if (d.readOnly) expect(tool.annotations?.readOnlyHint).toBe(true);
		else expect(tool.annotations?.readOnlyHint).not.toBe(true);
	}
};
const unknownTool = (actual: {words: string; letters: ReadonlyArray<string>}, name: string) => {
	expect(actual.words).toMatch(/unknown tool|no tool|there is no tool/i);
	expect(actual.words).toContain(name);
	expect(actual.letters).toEqual([]);
};
const letters = (actual: ReadonlyArray<string>) => {
	for (const letter of actual) Schema.decodeUnknownSync(Id.Letter)(letter);
	expect(new Set(actual).size).toBeLessThanOrEqual(1);
};
const visible = (
	a: {readonly saved: string; readonly shown: string; readonly by: string; readonly for: string},
	body: string,
	who: {readonly key: string; readonly for: string},
) => {
	expect(a).toEqual({saved: body, shown: body, by: who.key, for: who.for});
};
type Bridge = {
	readonly tools: (inputs: ReadonlyArray<InputDeclaration>) => Effect.Effect<ReadonlyArray<Tool>>;
	readonly hidden: (
		name: string,
		input: Schema.Json,
		declarations: ReadonlyArray<InputDeclaration>,
	) => Effect.Effect<{readonly words: string; readonly letters: ReadonlyArray<string>}>;
	readonly waiting: (call: Call) => Effect.Effect<{
		readonly words: string;
		readonly letters: ReadonlyArray<string>;
		readonly tools: ReadonlyArray<Tool>;
	}>;
	readonly approved: (call: Call) => Effect.Effect<{
		readonly afterRestart: boolean;
		readonly otherName: boolean;
		readonly drives: number;
	}>;
	readonly save: (call: Call) => Effect.Effect<{
		readonly letters: ReadonlyArray<string>;
		readonly result: Parameters<typeof visible>[0];
		readonly who: {readonly key: string; readonly for: string};
	}>;
	readonly malformed: (
		call: Call,
	) => Effect.Effect<{readonly refused: boolean; readonly letters: ReadonlyArray<string>}>;
	readonly stale: (call: Call) => Effect.Effect<{
		readonly why: string;
		readonly now: number;
		readonly letters: ReadonlyArray<string>;
	}>;
};
const bind = (): Bridge => {
	throw new Error(
		"P25 started: bind real tools, bridge and SDK client; declare their test dependencies before build",
	);
};
const paths = [
	"../../../../packages/libfabrika/src/mcp",
	"../../../../packages/libfabrika/src/mcp.ts",
	"../../mcp.ts",
	"../mcp.ts",
	"../mcp",
];
const presence = (files: ReadonlySet<string>, load: () => Bridge): Bridge | null => {
	if (!paths.some((p) => files.has(p))) return null;
	const b = load();
	for (const name of [
		"tools",
		"hidden",
		"waiting",
		"approved",
		"save",
		"malformed",
		"stale",
	] as const)
		if (typeof b[name] !== "function") throw new Error(`missing bridge export: ${name}`);
	return b;
};
const target = Effect.fnUntraced(function* (ctx: {skip: (reason?: string) => never}) {
	const fs = yield* FileSystem.FileSystem;
	const found = new Set<string>();
	for (const p of paths) if (yield* fs.exists(new URL(p, import.meta.url).pathname)) found.add(p);
	const b = presence(found, bind);
	if (b === null) ctx.skip("not built: P25 agent tools and SDK");
	return b;
});
const platform = NodeFileSystem.layer;
it.effect.prop(
	"not built: P25 / schema-made tools, read-only ps first, no person-only input",
	{declarations: DeclarationCases, input: Arbitrary.schema(json(4))},
	({declarations, input}, ctx) =>
		Effect.gen(function* () {
			const b = yield* target(ctx);
			tools(yield* b.tools(declarations), declarations);
			for (const d of declarations.filter((d) => d.personOnly)) {
				const name = `notes_${d.name}`;
				unknownTool(yield* b.hidden(name, input, declarations), name);
			}
		}).pipe(Effect.provide(platform)),
	options,
);
it.effect.prop(
	"not built: P25 / before approval tools list; calls answer words without letters",
	{c: AgentCalls},
	({c}, ctx) =>
		Effect.gen(function* () {
			const b = yield* target(ctx),
				a = yield* b.waiting(c);
			tools(a.tools);
			expect(a.words.length).toBeGreaterThan(0);
			expect(a.letters).toEqual([]);
		}).pipe(Effect.provide(platform)),
	options,
);
it.effect.prop(
	"not built: P25 / approval persists per name across restart, second name needs own grant, ps drives nothing",
	{c: AgentCalls},
	({c}, ctx) =>
		Effect.gen(function* () {
			const b = yield* target(ctx),
				a = yield* b.approved(c);
			expect(a).toEqual({afterRestart: true, otherName: false, drives: 0});
		}).pipe(Effect.provide(platform)),
	options,
);
it.effect.prop(
	"not built: P25 / SDK save is visible with the real checked writer; repeated saves reuse one TypeID",
	{c: AgentCalls},
	({c}, ctx) =>
		Effect.gen(function* () {
			const b = yield* target(ctx),
				a = yield* b.save(c);
			expect(a.letters.length).toBeGreaterThan(0);
			letters(a.letters);
			visible(a.result, c.body, a.who);
		}).pipe(Effect.provide(platform)),
	options,
);
it.effect.prop(
	"not built: P25 / malformed calls and stale saves write no letters and preserve refusal fields",
	{c: AgentCalls},
	({c}, ctx) =>
		Effect.gen(function* () {
			const b = yield* target(ctx),
				malformed = yield* b.malformed(c),
				stale = yield* b.stale(c);
			expect(malformed).toEqual({refused: true, letters: []});
			expect(stale).toEqual({why: "changed_elsewhere", now: c.version, letters: []});
		}).pipe(Effect.provide(platform)),
	options,
);

const cleanTools = (
	declarations: ReadonlyArray<InputDeclaration> = standard,
): ReadonlyArray<Tool> => [
	{name: "ps", inputSchema: {type: "object"}, annotations: {readOnlyHint: true}},
	...declarations
		.filter((d) => !d.personOnly)
		.map((d) => ({
			name: `notes_${d.name}`,
			inputSchema: inputSchema(d),
			annotations: {readOnlyHint: d.readOnly},
		})),
];
it.prop(
	"checker clean control: tool contract and checked-writer senderTest",
	{
		c: Arbitrary.schema(Schema.Struct({name: text(1, 96), body: text(0, 4096)})),
		declarations: DeclarationCases,
	},
	({c, declarations}) => {
		tools(cleanTools(declarations), declarations);
		unknownTool({words: "unknown tool notes_person_input", letters: []}, "notes_person_input");
		const id = "letter_0000000000e008000000000001",
			parent = "input_0000000000e008000000000001";
		const who = {key: `SHA256:agent-${c.name}`, for: "person_0000000000e008000000000001"};
		letters([id, id]);
		visible({saved: c.body, shown: c.body, by: who.key, for: who.for}, c.body, who);
		senderTest({
			inputs: [{parent, by: who}],
			expected: [{id, by: who}],
			writes: [{id, parent, by: who}],
			owner: {key: "SHA256:owner", for: who.for},
			seed: SEED,
		});
	},
	options,
);
it.prop(
	"checker plants: hidden tools, trusted params, new retry ID and forged writer fail",
	{c: Arbitrary.schema(Schema.Struct({body: text(0, 4096)}))},
	({c}) => {
		for (const name of ["notes_approve", "notes_remove", "grant", "chaos_fire", "notes_hidden"])
			expect(() => tools([...cleanTools(), {name, inputSchema: {}}])).toThrow();
		expect(() =>
			tools(cleanTools().map((t) => ({...t, annotations: {readOnlyHint: false}}))),
		).toThrow();
		expect(() =>
			letters(["letter_0000000000e008000000000001", "letter_0000000000e008000000000002"]),
		).toThrow();
		expect(() => letters(["p8-01"])).toThrow();
		const who = {key: "SHA256:checked-agent", for: "person_0000000000e008000000000001"};
		expect(() =>
			visible({saved: c.body, shown: `${c.body}!`, by: who.key, for: who.for}, c.body, who),
		).toThrow();
		expect(() =>
			visible({saved: c.body, shown: c.body, by: "params.person", for: who.for}, c.body, who),
		).toThrow();
		expect(() =>
			senderTest({
				inputs: [{parent: "input", by: who}],
				expected: [{id: "letter", by: who}],
				writes: [{id: "letter", parent: "input", by: {key: "SHA256:owner", for: who.for}}],
				owner: who,
				seed: SEED,
			}),
		).toThrow();
	},
	options,
);
it.prop(
	"checker plants: empty schemas, missing fields, changed types and callable hidden inputs fail",
	{declarations: DeclarationCases},
	({declarations}) => {
		const clean = cleanTools(declarations);
		tools(clean, declarations);
		for (const [i, tool] of clean.entries()) {
			expect(() =>
				tools(
					clean.map((t, n) => (n === i ? {...t, inputSchema: {}} : t)),
					declarations,
				),
			).toThrow();
			if (i === 0) continue;
			const d = declarations.filter((d) => !d.personOnly)[i - 1]!;
			const shape = Schema.decodeUnknownSync(
				Schema.Struct({properties: Schema.Record(Schema.String, Schema.Unknown)}),
			)(inputSchema(d));
			const bad = {...shape.properties, value: {type: "object", properties: {}}};
			expect(() =>
				tools(
					clean.map((t) =>
						t === tool ? {...t, inputSchema: {...inputSchema(d), properties: bad}} : t,
					),
					declarations,
				),
			).toThrow();
			expect(() =>
				tools(
					clean.map((t) =>
						t === tool
							? {...t, inputSchema: {...inputSchema(d), properties: {value: {type: "number"}}}}
							: t,
					),
					declarations,
				),
			).toThrow();
		}
		expect(() =>
			unknownTool({words: "saved notes_person_input", letters: []}, "notes_person_input"),
		).toThrow();
	},
	options,
);
it.prop(
	"presence checker controls: no source is pending; partial/failed imports fail",
	{message: Arbitrary.schema(text(0, 128))},
	({message}) => {
		const failed = (): Bridge => {
			throw new Error(`failed import: ${message}`);
		};
		expect(presence(new Set(), failed)).toBeNull();
		for (const p of [
			"../../mcp.ts",
			"../mcp.ts",
			"../mcp",
			"../../../../packages/libfabrika/src/mcp",
			"../../../../packages/libfabrika/src/mcp.ts",
		])
			expect(() => presence(new Set([p]), failed)).toThrow("failed import");
		const clean: Bridge = {
			tools: () => Effect.succeed(cleanTools()),
			hidden: () => Effect.succeed({words: "unknown tool", letters: []}),
			waiting: () => Effect.die("control only"),
			approved: () => Effect.die("control only"),
			save: () => Effect.die("control only"),
			malformed: () => Effect.die("control only"),
			stale: () => Effect.die("control only"),
		};
		expect(presence(new Set(paths), () => clean)).toBe(clean);
		expect(() => presence(new Set(paths), () => ({...clean, hidden: undefined!}))).toThrow(
			"missing bridge export",
		);
	},
	options,
);
