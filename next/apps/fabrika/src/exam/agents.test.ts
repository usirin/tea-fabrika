// P8, next/, p63. Port: apps/fabrika/src/host/agents.test.ts at 2c29c13.
// P25 supplies the real SDK client and dev.ts binding. No old host, handshake, tile or tracker.
import {existsSync, readdirSync} from "node:fs";
import {resolve} from "node:path";
import {Input} from "@kampus/libfabrika";
import {Schema} from "effect";
import {describe, expect, it} from "vitest";

const Value = Schema.Struct({note: Schema.String, base: Schema.Int, body: Schema.String});
const declarations: Readonly<Record<string, Input>> = {
	list: Input.cases.read.make({schema: Schema.Null, description: "List notes", answer: () => []}),
	read: Input.cases.read.make({
		schema: Schema.Struct({note: Schema.String}),
		description: "Read a note",
		answer: () => null,
	}),
	save: Input.cases.write.make({schema: Value, description: "Save a note", personOnly: false}),
	approve: Input.cases.write.make({schema: Value, description: "Only a person", personOnly: true}),
};
type Tool = {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: unknown;
	readonly annotations?: {readonly readOnlyHint?: boolean};
};
type Reply = {readonly isError?: boolean; readonly text: string};
type Bridge = {
	readonly tools: (inputs: Readonly<Record<string, Input>>) => readonly Tool[];
	readonly call: (inputs: Readonly<Record<string, Input>>, tool: string, value: unknown) => Reply;
};
const toolsLaw = (b: Bridge) => {
	for (const inputs of [
		declarations,
		{
			...declarations,
			extra: Input.cases.read.make({
				schema: Schema.Null,
				description: "A newly declared read",
				answer: () => 1,
			}),
			hidden: Input.cases.write.make({schema: Value, description: "Hidden", personOnly: true}),
		},
	]) {
		const tools = b.tools(inputs);
		expect(
			tools.map((t) => t.name),
			"tools follow declarations",
		).toEqual([
			"ps",
			...Object.entries(inputs)
				.filter(([, p]) => p._tag === "read" || !p.personOnly)
				.map(([name]) => `notes_${name}`),
		]);
		expect(tools.find((t) => t.name === "ps")?.annotations).toEqual({readOnlyHint: true});
		for (const [name, p] of Object.entries(inputs)) {
			if (p._tag === "write" && p.personOnly) {
				expect(
					b.call(inputs, `notes_${name}`, {}),
					"person-only calls are unknown tools",
				).toMatchObject({isError: true, text: expect.stringMatching(/no tool|unknown tool/i)});
				continue;
			}
			const tool = tools.find((t) => t.name === `notes_${name}`);
			expect(tool?.description).toBe(p.description);
			expect(tool?.annotations?.readOnlyHint).toBe(p._tag === "read" ? true : undefined);
		}
		expect(tools.find((t) => t.name === "notes_save")?.inputSchema).toMatchObject({
			type: "object",
			required: ["value"],
			properties: {value: {type: "object", required: ["note", "base", "body"]}},
		});
		expect(tools.map((t) => t.name).join(" ")).not.toMatch(/grant|approve|remove|chaos|window/);
		expect(b.call(inputs, "notes_save", {note: 3}), "malformed call is explained").toMatchObject({
			isError: true,
			text: expect.stringMatching(/does not fit|bad_input/),
		});
	}
};
type Flow = {
	readonly before: {
		readonly tools: readonly string[];
		readonly reply: Reply;
		readonly letters: readonly unknown[];
	};
	readonly restarted: {readonly waiting: boolean; readonly approvals: number};
	readonly second: {readonly waiting: boolean; readonly rows: readonly string[]};
	readonly after: {
		readonly reply: Reply;
		readonly visible: string;
		readonly letters: readonly {readonly id: string; readonly by: string; readonly for: string}[];
	};
	readonly retry: {
		readonly reply: Reply;
		readonly letters: readonly {readonly id: string; readonly by?: string; readonly for?: string}[];
	};
	readonly stale: {
		readonly reply: Reply;
		readonly windowWhy: string;
		readonly before: readonly unknown[];
		readonly after: readonly unknown[];
	};
	readonly ps: {
		readonly rows: readonly unknown[];
		readonly before: readonly unknown[];
		readonly after: readonly unknown[];
	};
};
const flowLaw = (s: Flow) => {
	expect(s.before.tools).toEqual(["ps", "notes_list", "notes_read", "notes_save"]);
	expect(s.before.reply).toMatchObject({
		isError: true,
		text: expect.stringMatching(/waiting|not_granted/),
	});
	expect(s.before.letters, "waiting writes no letter").toEqual([]);
	expect(s.restarted, "approval persists by agent name across bridge restart").toEqual({
		waiting: false,
		approvals: 1,
	});
	expect(s.second).toEqual({waiting: true, rows: ["exam-a", "exam-b"]});
	expect(s.after.reply.isError).not.toBe(true);
	expect(s.after.visible).toBe("Saved from MCP");
	expect(s.after.letters, "checked agent writer").toEqual([
		{id: "stable-save", by: "SHA256:checked-agent", for: "exam-person"},
	]);
	expect(s.retry.reply.isError).not.toBe(true);
	expect(s.retry.letters, "one stable letter for retries").toEqual(s.after.letters);
	expect(s.stale.reply).toMatchObject({
		isError: true,
		text: expect.stringContaining(s.stale.windowWhy),
	});
	expect(s.stale.windowWhy).toBe("changed_elsewhere");
	expect(s.stale.after).toEqual(s.stale.before);
	expect(s.ps.rows).toEqual([
		{
			process: "process_01jc9q4w7z3m8n5r2t6v0xkb4d",
			name: "notes:1",
			program: "notes",
			build: "p8",
			restarts: 0,
		},
	]);
	expect(s.ps.after, "ps drives nothing").toEqual(s.ps.before);
};
const control: Bridge = {
	tools: (inputs) => [
		{name: "ps", description: "Processes", inputSchema: {}, annotations: {readOnlyHint: true}},
		...Object.entries(inputs).flatMap(([name, p]) =>
			p._tag === "write" && p.personOnly
				? []
				: [
						{
							name: `notes_${name}`,
							description: p.description,
							inputSchema: {
								type: "object",
								required: ["value"],
								properties: {value: {type: "object", required: ["note", "base", "body"]}},
							},
							...(p._tag === "read" ? {annotations: {readOnlyHint: true}} : {}),
						},
					],
		),
	],
	call: (inputs, name) => {
		const p = inputs[name.slice(6)];
		return p === undefined || (p._tag === "write" && p.personOnly)
			? {isError: true, text: `there is no tool ${name}`}
			: {isError: true, text: "value does not fit"};
	},
};
const flow: Flow = {
	before: {
		tools: ["ps", "notes_list", "notes_read", "notes_save"],
		reply: {isError: true, text: "waiting: not_granted"},
		letters: [],
	},
	restarted: {waiting: false, approvals: 1},
	second: {waiting: true, rows: ["exam-a", "exam-b"]},
	after: {
		reply: {text: "saved"},
		visible: "Saved from MCP",
		letters: [{id: "stable-save", by: "SHA256:checked-agent", for: "exam-person"}],
	},
	retry: {
		reply: {text: "saved"},
		letters: [{id: "stable-save", by: "SHA256:checked-agent", for: "exam-person"}],
	},
	stale: {
		reply: {isError: true, text: "changed_elsewhere: now 4"},
		windowWhy: "changed_elsewhere",
		before: [1],
		after: [1],
	},
	ps: {
		rows: [
			{
				process: "process_01jc9q4w7z3m8n5r2t6v0xkb4d",
				name: "notes:1",
				program: "notes",
				build: "p8",
				restarts: 0,
			},
		],
		before: [1],
		after: [1],
	},
};
describe("p63 fixed bridge exam, saved controls and plants only", () => {
	it("tools from P11 read/write declarations, hints, schema and hidden calls", () =>
		toolsLaw(control));
	it("waiting, approval restart, checked saves, stable retry and refusal words", () =>
		flowLaw(flow));
	it("plant: handwritten tool list misses a new declaration", () =>
		expect(() => toolsLaw({...control, tools: () => control.tools(declarations)})).toThrow(
			/tools follow declarations/,
		));
	it("plant: expose a person-only tool", () =>
		expect(() =>
			toolsLaw({
				...control,
				tools: (inputs) => [
					...control.tools(inputs),
					{name: "notes_approve", description: "hidden", inputSchema: {}},
				],
			}),
		).toThrow(/tools follow declarations/));
	it("plant: call a hidden input despite omitting its listing", () =>
		expect(() => toolsLaw({...control, call: () => ({text: "accepted"})})).toThrow(
			/person-only calls/,
		));
	it("plant: admit from the name before approval", () =>
		expect(() =>
			flowLaw({...flow, before: {...flow.before, reply: {text: "saved"}, letters: [1]}}),
		).toThrow());
	it("plant: new letter ID on retry", () =>
		expect(() =>
			flowLaw({
				...flow,
				retry: {reply: {text: "saved"}, letters: [...flow.after.letters, {id: "new-save"}]},
			}),
		).toThrow(/stable letter/));
	it("plant: owner signs the accepted agent save", () =>
		expect(() =>
			flowLaw({
				...flow,
				after: {
					...flow.after,
					letters: [{id: "stable-save", by: "SHA256:owner", for: "exam-person"}],
				},
			}),
		).toThrow(/checked agent writer/));
});
const source = (dir: string): string[] =>
	!existsSync(dir)
		? []
		: readdirSync(dir, {withFileTypes: true}).flatMap((e) =>
				e.isDirectory()
					? source(resolve(dir, e.name))
					: /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)
						? [e.name]
						: [],
			);
it("P25 real SDK and bridge binding", (ctx) => {
	const next = resolve(import.meta.dirname, "../../../..");
	if (
		source(resolve(next, "packages/libfabrika/src/mcp")).length === 0 &&
		!existsSync(resolve(next, "apps/fabrika/mcp.ts"))
	)
		return ctx.skip(
			"not built: P25 MCP bridge, SDK and socket flow; lead must run SDK against dev.ts on its own temp FABRIKA_HOME",
		);
	throw new Error(
		"P25 exists: require the actual SDK, bridge entry and declared dependencies; bind toolsLaw and flowLaw to real replies and committed view/ledger observations",
	);
});
