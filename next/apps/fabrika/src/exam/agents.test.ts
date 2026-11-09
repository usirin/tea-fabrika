// P8, next/. Port source: apps/fabrika/src/host/agents.test.ts at 13e0c2305beb.
// Mapping: toolsOf/callOf -> schema tools and malformed calls; SDK client -> approval/retry/writer.
// Tracker, quit, desk control, top-bar counts and the old host/stdio handshake are not ported.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import {expect, it} from "@effect/vitest";
import {Id} from "@kampus/libfabrika";
import {senderTest} from "@kampus/libfabrika/testing";
import {Arbitrary, Effect, FileSystem, Schema} from "effect";

const SEED = 119120;
const options = {arbitrary: {seed: SEED, runs: 300, size: 4096, concurrency: 1}};
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
		count: int(0, 16),
	}),
);
type Call = typeof AgentCalls extends Arbitrary.Arbitrary<infer C> ? C : never;
type Tool = {
	readonly name: string;
	readonly inputSchema: unknown;
	readonly annotations?: {readonly readOnlyHint?: boolean};
};
const tools = (actual: ReadonlyArray<Tool>) => {
	expect(actual.map((t) => t.name)).toEqual(["ps", "notes_list", "notes_read", "notes_save"]);
	for (const name of ["ps", "notes_list", "notes_read"])
		expect(actual.find((t) => t.name === name)?.annotations?.readOnlyHint).toBe(true);
	expect(actual.find((t) => t.name === "notes_save")?.annotations?.readOnlyHint).not.toBe(true);
	for (const t of actual) expect(t.inputSchema).toBeTypeOf("object");
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
	readonly tools: (inputs: number) => Effect.Effect<ReadonlyArray<Tool>>;
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
const target = Effect.fnUntraced(function* (ctx: {skip: (reason?: string) => never}) {
	const fs = yield* FileSystem.FileSystem;
	const paths = [
		"../../../../packages/libfabrika/src/mcp",
		"../../../../packages/libfabrika/src/mcp.ts",
		"../mcp.ts",
		"../mcp",
	];
	let started = false;
	for (const p of paths) if (yield* fs.exists(new URL(p, import.meta.url).pathname)) started = true;
	if (!started) ctx.skip("not built: P25 agent tools and SDK");
	return bind();
});
const platform = NodeFileSystem.layer;
it.effect.prop(
	"not built: P25 / schema-made tools, read-only ps first, no person-only input",
	{c: AgentCalls},
	({c}, ctx) =>
		Effect.gen(function* () {
			const b = yield* target(ctx);
			tools(yield* b.tools(c.count));
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

const cleanTools = (): ReadonlyArray<Tool> =>
	["ps", "notes_list", "notes_read", "notes_save"].map((name) => ({
		name,
		inputSchema: {type: "object"},
		annotations: {readOnlyHint: name !== "notes_save"},
	}));
it.prop(
	"checker clean control: tool contract and checked-writer senderTest",
	{c: AgentCalls},
	({c}) => {
		tools(cleanTools());
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
	{c: AgentCalls},
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
	"presence checker controls: no source is pending; partial/failed imports fail",
	{c: AgentCalls},
	({c}) => {
		const check = (files: ReadonlyArray<string>, load: () => unknown) => {
			if (files.length === 0) return "pending";
			if (!files.includes("mcp.ts") || !files.includes("tools.ts")) throw new Error("partial P25");
			Schema.decodeUnknownSync(
				Schema.Struct({tools: Schema.Array(Schema.Struct({name: Schema.String}))}),
			)(load());
			return "bound";
		};
		expect(check([], () => null)).toBe("pending");
		expect(() => check([c.name], () => null)).toThrow();
		expect(() =>
			check(["mcp.ts", "tools.ts"], () => {
				throw new Error("failed import");
			}),
		).toThrow("failed import");
		expect(() => check(["mcp.ts", "tools.ts"], () => ({}))).toThrow();
		expect(check(["mcp.ts", "tools.ts"], () => ({tools: cleanTools()}))).toBe("bound");
	},
	options,
);
