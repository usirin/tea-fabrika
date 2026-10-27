import type {Options, SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {Sub} from "@demlik/tea";
import {Effect, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {claudeResultOf, rawOfUpdate} from "../acp/adapter.ts";
import {type ClaudeAdapterConfig, claudeAdapter, rawOf} from "../claude/adapter.ts";
import {type DraftRun, type Open, openLive} from "../claude/draft.ts";
import {AGENTS_MD} from "../claude/rules.ts";
import {jsonSchema} from "../claude/schema.ts";
import {codexEnvOf, flagsOf, rawOfLine, strictOk} from "../codex/adapter.ts";
import {makeAgents} from "./core.ts";
import {agentRunner} from "./draft.ts";
import {fakeAdapter, saying} from "./fake.ts";
import {under} from "./reap.ts";
import {memorySessions} from "./sessions.ts";
import {type AdapterTurn, NO_LIMITS, noReaper} from "./turn.ts";

// Each adapter's pure part: how what its maker says becomes the interface's
// raw updates, and the containment that can be checked with no agent. No
// test here starts an agent.

/** An SDK message with only the fields `rawOf` reads. */
const sdk = (m: Record<string, unknown>): SDKMessage =>
	// biome-ignore lint/plugin: a fixture holds the few fields rawOf reads; the SDK's full type has dozens more
	m as unknown as SDKMessage;

describe("claude: SDK messages", () => {
	it("reads text, tool calls and their results, then the turn's tokens, dollars and typed answer", () => {
		const assistant = sdk({
			type: "assistant",
			parent_tool_use_id: null,
			message: {
				content: [
					{type: "text", text: "looking"},
					{type: "tool_use", id: "tu1", name: "Read", input: {}},
				],
			},
		});
		expect(rawOf(assistant)).toEqual([
			{_tag: "said", text: "looking"},
			{_tag: "tool", id: "tu1", title: "Read", status: "pending"},
		]);
		const result = sdk({
			type: "result",
			subtype: "success",
			is_error: false,
			total_cost_usd: 0.05,
			num_turns: 3,
			structured_output: {done: true},
			usage: {
				input_tokens: 10,
				output_tokens: 5,
				cache_read_input_tokens: 90,
				cache_creation_input_tokens: 0,
			},
		});
		expect(rawOf(result)).toEqual([
			{_tag: "tokens", tokens: {input: 100, cached: 90, output: 5}, whole: true},
			{_tag: "ended", stop: "end_turn", structured: {done: true}, usd: 0.05, requests: 3},
		]);
	});

	it("names a budget stop as over_budget, and any other error result as broken", () => {
		const of = (subtype: string) =>
			rawOf(
				sdk({
					type: "result",
					subtype,
					is_error: true,
					total_cost_usd: 0.2,
					num_turns: 9,
					usage: {input_tokens: 1, output_tokens: 1},
				}),
			);
		expect(of("error_max_budget_usd")).toContainEqual(
			expect.objectContaining({stop: "over_budget"}),
		);
		expect(of("error_during_execution")).toEqual({broke: "error_during_execution (error)"});
	});
});

describe("claude: where its settings come from", () => {
	const TURN: AdapterTurn = {
		folder: "/work/repo",
		prompt: "p",
		schema: {},
		resume: null,
		session: "s",
		model: null,
		effort: null,
		usd: null,
	};

	/** An opener that keeps the options it is handed and opens an empty query: no agent starts. */
	const keeping = () => {
		const seen: Options[] = [];
		const open: Open = ({options}) => {
			seen.push(options);
			return {
				[Symbol.asyncIterator]: () => ({
					next: () => Promise.resolve({done: true as const, value: undefined}),
				}),
				interrupt: () => Promise.resolve(undefined),
				close: () => undefined,
			};
		};
		return {seen, open};
	};

	it("reads the folder's rule files and none of its settings, as the stages do", async () => {
		const {seen, open} = keeping();
		await Effect.runPromise(Effect.scoped(claudeAdapter({open}).start(TURN)));
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			settingSources: ["project"],
			projectConfigRoot: "/var/empty",
			settings: {disableClaudeAiConnectors: true, pluginConfigs: AGENTS_MD},
			strictMcpConfig: true,
			mcpServers: {},
			permissionMode: "dontAsk",
		});
	});

	it("lets no stage say where settings come from: its type refuses it, and so does the start", async () => {
		const {seen, open} = keeping();
		const configs: readonly ClaudeAdapterConfig[] = [
			// @ts-expect-error a stage's options cannot name the settings sources
			{open, more: () => ({settingSources: ["user", "project"]})},
			// @ts-expect-error nor the folder the project's settings are read from
			{open, more: () => ({projectConfigRoot: "/work/repo"})},
		];
		for (const config of configs) {
			const error = await Effect.runPromise(
				Effect.scoped(Effect.flip(claudeAdapter(config).start(TURN))),
			);
			expect(error).toMatchObject({_tag: "AgentFailed", why: "contain"});
		}
		expect(seen).toHaveLength(0);
	});

	it("fails as not started when the live opener refuses the turn, with its reason", async () => {
		// The live opener, handed options that point the settings elsewhere: it starts nothing.
		const open: Open = (params) =>
			openLive({...params, options: {...params.options, projectConfigRoot: "/work/repo"}});
		const error = await Effect.runPromise(
			Effect.scoped(
				Effect.flip(
					Effect.flatMap(claudeAdapter({open}).start(TURN), (running) =>
						Stream.runDrain(running.updates),
					),
				),
			),
		);
		expect(error).toMatchObject({why: "start", message: expect.stringContaining("not /var/empty")});
	});
});

describe("codex: exec's JSON lines", () => {
	it("reads the thread, commands, the last message and the turn's tokens", () => {
		const lines = [
			'{"type":"thread.started","thread_id":"019a"}',
			'{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"cat a"}}',
			'{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"cat a","status":"completed"}}',
			'{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"{\\"done\\":true}"}}',
			'{"type":"turn.completed","usage":{"input_tokens":500,"cached_input_tokens":300,"output_tokens":40}}',
		];
		expect(lines.flatMap((l) => rawOfLine(l) as never[])).toEqual([
			{_tag: "opened", own: "019a"},
			{_tag: "tool", id: "i1", title: "cat a", status: "in_progress"},
			{_tag: "tool", id: "i1", title: "cat a", status: "completed"},
			{_tag: "said", text: '{"done":true}'},
			{_tag: "tokens", tokens: {input: 500, cached: 300, output: 40}, whole: true},
			{_tag: "ended", stop: "end_turn", structured: undefined, usd: null, requests: null},
		]);
		expect(rawOfLine('{"type":"turn.failed","error":{"message":"x"}}')).toHaveProperty("broke");
		expect(rawOfLine("not json")).toEqual([]);
	});

	it("turns the config into -c flags, a table of paths kept whole", () => {
		expect(
			flagsOf({
				allow_login_shell: false,
				permissions: {fenced: {extends: ":workspace", filesystem: {"/home/x": "deny"}}},
			}),
		).toEqual([
			"-c",
			"allow_login_shell=false",
			"-c",
			'permissions.fenced.extends=":workspace"',
			"-c",
			'permissions.fenced.filesystem={"/home/x"="deny"}',
		]);
	});

	it("knows which schemas strict mode refuses: an optional field", () => {
		const Fits = Schema.Struct({
			done: Schema.Boolean,
			ran: Schema.Array(Schema.Struct({call: Schema.String})),
		});
		const Loose = Schema.Struct({done: Schema.Boolean, note: Schema.optional(Schema.String)});
		expect(strictOk(jsonSchema(Fits))).toBe(true);
		expect(strictOk(jsonSchema(Loose))).toBe(false);
	});

	it("hands Codex no key, whatever the parent holds (planted)", () => {
		const env = codexEnvOf(
			{
				PATH: "/bin",
				HOME: "/home/x",
				USER: "x",
				OPENAI_API_KEY: "planted",
				CODEX_API_KEY: "planted",
				TYPESAFE_API_KEY: "planted",
				ANTHROPIC_API_KEY: "planted",
			},
			"/home/x/.cache/codex-home",
		);
		expect(Object.values(env)).not.toContain("planted");
		expect(env).toMatchObject({
			HOME: "/home/x/.cache/codex-home",
			CODEX_HOME: "/home/x/.cache/codex-home",
		});
	});
});

describe("acp: session updates", () => {
	it("reads tool calls by id, and an update only when it has a status", () => {
		expect(
			rawOfUpdate({
				sessionUpdate: "tool_call",
				toolCallId: "c1",
				title: "Read a",
				status: "pending",
			}),
		).toEqual([{_tag: "tool", id: "c1", title: "Read a", status: "pending"}]);
		expect(rawOfUpdate({sessionUpdate: "tool_call_update", toolCallId: "c1"})).toEqual([]);
	});

	it("reads Claude's forwarded result for the turn's tokens and dollars", () => {
		expect(
			claudeResultOf({
				message: {
					type: "result",
					subtype: "success",
					total_cost_usd: 0.1,
					num_turns: 4,
					usage: {input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 95},
				},
			}),
		).toEqual({tokens: {input: 100, cached: 95, output: 7}, usd: 0.1, requests: 4, over: false});
		expect(claudeResultOf({message: {type: "assistant"}})).toBeNull();
	});
});

describe("the reaper", () => {
	it("finds every process under a root, at any depth, and nothing else", () => {
		const map = new Map([
			[10, 1],
			[11, 10],
			[12, 11],
			[13, 1],
		]);
		expect(under(10, map).sort()).toEqual([11, 12]);
	});
});

describe("a Draft on the interface", () => {
	it("hears the same three Msgs a Draft hears today", async () => {
		const Note = Schema.Struct({text: Schema.String});
		const fake = fakeAdapter(() => ({
			raws: [
				{_tag: "tool", id: "t1", title: "Read", status: "pending"},
				{_tag: "tool", id: "t1", title: "Read", status: "completed"},
				...saying('{"text":"done"}').raws,
			],
		}));
		const agents = makeAgents({adapters: {fake}, sessions: memorySessions(), reaper: noReaper});
		const runner = agentRunner("note", agents, (run: DraftRun) => ({
			provider: "fake",
			session: run.session.id,
			folder: "/nowhere",
			prompt: run.prompt,
			answer: Note,
			model: null,
			effort: null,
			limits: NO_LIMITS,
		}));
		const run: DraftRun = {
			key: "k",
			id: "k/1",
			prompt: "p",
			session: {id: "s", continues: false},
			agent: null,
			folder: null,
		};
		const msgs = await Effect.runPromise(
			Stream.runCollect(runner({id: "note", type: "note", deps: run} as Sub<"note", DraftRun>)),
		);
		expect([...msgs]).toMatchObject([
			{type: "note_tool", key: "k", id: "k/1", tool: "Read"},
			{type: "note_finished", key: "k", id: "k/1", output: {text: "done"}, session: "s"},
		]);
	});
});
