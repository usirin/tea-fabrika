// P8, next/, p63. Port: apps/fabrika/src/host/agents.test.ts at 2c29c13.
// P25 supplies the real SDK client and dev.ts binding. No old host, handshake, tile or tracker.
import {Machine} from "@demlik/tea/effect";
import {Input, Program} from "@kampus/libfabrika";
import {Effect, Result} from "effect";
import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {startMcpStage} from "../mcp.test-support.ts";

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

it("P25 real Program.make tool binding", async () => {
	const {listTools, readCall} = await import("@kampus/libfabrika/mcp");
	const declaration = (inputs: Readonly<Record<string, Input>>) => {
		const msg = Schema.Union(
			Object.entries(inputs)
				.filter(([, p]) => p._tag === "write")
				.map(([name, p]) => Schema.Struct({type: Schema.Literal(name), value: p.schema})),
		);
		const machine = Machine.make({
			model: Schema.Struct({}),
			msg,
			cmds: [],
			init: (s) => [s ?? {}, []],
			update: Object.fromEntries(
				Object.keys(inputs).map((name) => [name, (s: object) => [s, []] as const]),
			),
		});
		return Program.make({
			name: "notes",
			machine,
			state: {v: 1, upgrades: []},
			view: () => ({}),
			refuse: () => null,
			inputs: Object.fromEntries(
				Object.entries(inputs).map(([name, p]) => [
					name,
					p._tag === "read"
						? p
						: p.personOnly
							? {description: p.description, personOnly: true}
							: p.description,
				]),
			),
			outputs: {},
			writes: {},
			wake: () => null,
		});
	};
	toolsLaw({
		tools: (inputs) => {
			const result = listTools([declaration(inputs)]);
			if (Result.isFailure(result)) throw result.failure;
			return result.success;
		},
		call: (inputs, name, value) => {
			const result = readCall([declaration(inputs)], name, value);
			return result._tag === "refused"
				? {isError: true, text: result.why}
				: {text: JSON.stringify(result)};
		},
	});
});
it("scenario: P25 fixed flow assertions bind real SDK and stage replies", async () => {
	// Normalize unpredictable IDs only after comparing the raw retry entries and signed writer.
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const s = yield* startMcpStage();
				const c = yield* s.connect("exam-a");
				const tools = yield* Effect.promise(() => c.listTools());
				const save = {
					name: "notes_save",
					arguments: {
						value: {note: "note_0000000000e008000000000000", base: 0, body: "Saved from MCP"},
					},
				};
				const beforeReply = yield* Effect.promise(() => c.callTool(save));
				const beforeLetters = yield* s.entries;
				const firstRows = yield* s.rows();
				const agentRow = firstRows.find((r: {readonly label: string}) => r.label === "exam-a")!;
				yield* s.approve("exam-a");
				const afterReply = yield* Effect.promise(() => c.callTool(save));
				const afterLetters = yield* s.entries;
				expect(afterLetters).toHaveLength(1);
				const {createHash} = yield* Effect.promise(() => import("node:crypto"));
				const checked = `SHA256:${createHash("sha256")
					.update(Buffer.from(agentRow.key, "base64url"))
					.digest("base64")
					.replace(/=+$/, "")}`;
				expect(afterLetters[0]?.by).toBe(checked);
				expect(afterLetters[0]?.for).toBe(s.person);
				const visible = yield* Effect.promise(() =>
					c.callTool({name: "notes_read", arguments: {value: {note: save.arguments.value.note}}}),
				);
				const restarted = yield* s.restartBridge("exam-a");
				const restartedReply = yield* Effect.promise(() =>
					restarted.callTool({name: "ps", arguments: {}}),
				);
				const retryReply = yield* Effect.promise(() => restarted.callTool(save));
				const retryLetters = yield* s.entries;
				expect(retryLetters).toEqual(afterLetters);
				yield* s.connect("exam-b");
				const secondRows = yield* s.rows();
				const staleBefore = yield* s.entries;
				const staleReply = yield* Effect.promise(() =>
					restarted.callTool({
						...save,
						arguments: {value: {...save.arguments.value, body: "stale"}},
					}),
				);
				const staleAfter = yield* s.entries;
				const psBefore = yield* s.entries;
				const psReply = yield* Effect.promise(() =>
					restarted.callTool({name: "ps", arguments: {}}),
				);
				const psAfter = yield* s.entries;
				const reply = (r: unknown): Reply => {
					const value = Schema.decodeUnknownSync(
						Schema.Struct({
							isError: Schema.optionalKey(Schema.Boolean),
							content: Schema.Array(Schema.Struct({text: Schema.String})),
						}),
					)(r);
					return {...value, text: value.content.map((x) => x.text).join("\n")};
				};
				const normalize = (rows: ReadonlyArray<(typeof afterLetters)[number]>) =>
					rows.map((r) => ({
						id: r.id === afterLetters[0]!.id ? "stable-save" : r.id,
						by: r.by === checked ? "SHA256:checked-agent" : r.by,
						for: r.for === s.person ? "exam-person" : r.for,
					}));
				expect(reply(psReply).text).toContain("notes");
				expect(JSON.parse(reply(psReply).text)).toEqual(yield* s.ps);
				flowLaw({
					before: {
						tools: tools.tools
							.map((t) => t.name)
							.sort(
								(a, b) =>
									["ps", "notes_list", "notes_read", "notes_save"].indexOf(a) -
									["ps", "notes_list", "notes_read", "notes_save"].indexOf(b),
							),
						reply: reply(beforeReply),
						letters: beforeLetters,
					},
					restarted: {
						waiting: reply(restartedReply).isError === true,
						approvals: (yield* s.membership).filter((r) => r._tag === "granted").length,
					},
					second: {
						waiting: secondRows.some((r: {readonly label: string}) => r.label === "exam-b"),
						rows: [
							...firstRows.map((r: {readonly label: string}) => r.label),
							...secondRows.map((r: {readonly label: string}) => r.label),
						]
							.filter((r, i, a) => a.indexOf(r) === i)
							.sort(),
					},
					after: {
						reply: reply(afterReply),
						visible: reply(visible).text.includes("Saved from MCP") ? "Saved from MCP" : "missing",
						letters: normalize(afterLetters),
					},
					retry: {reply: reply(retryReply), letters: normalize(retryLetters)},
					stale: {
						reply: reply(staleReply),
						windowWhy: "changed_elsewhere",
						before: staleBefore,
						after: staleAfter,
					},
					ps: {
						rows: JSON.parse(reply(psReply).text)
							.filter((r: {readonly program: string}) => r.program === "notes")
							.map((r: object) => ({
								...r,
								process: "process_01jc9q4w7z3m8n5r2t6v0xkb4d",
								build: "p8",
							})),
						before: psBefore,
						after: psAfter,
					},
				});
			}),
		),
	);
});
