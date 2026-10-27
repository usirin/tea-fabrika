import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {type Options, query, type SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import {Effect, Stream} from "effect";
import {claudeOptions} from "../acp/harness.ts";
import {type Adapter, failed, type Raw, type Tokens} from "../agent/turn.ts";
import {extraTools, type Open} from "./draft.ts";
import {agentEnv} from "./env.ts";
import {fencedEnv, TOOLS, temps} from "./sandbox.ts";
import {guardHook} from "./shell-guard.ts";

// Claude Code through the Agent SDK, as an adapter of the interface
// (../agent/turn.ts). The same containment as the ACP row for Claude
// (`claudeOptions`: no settings files, no MCP server, no connector, the
// builder's tools, the OS sandbox), plus what only the SDK path can carry:
// the shell guard as a PreToolUse hook, and `dontAsk`, so nothing waits on a
// person. Claude keeps `settingSources: []` for now; when experiment 155's
// `ownRules` lands, this adapter moves to it as the stages do.
//
// The system prompt is Claude Code's own (`claude_code`), as on the ACP row.
// Left unnamed, the SDK sends an empty one, and the agent gets none of Claude
// Code's instructions (experiment 158). Its memory section is off: it would
// have the agent keep notes under ~/.claude, outside the copy it is given.
//
// What the SDK holds natively: a dollar cap (`maxBudgetUsd`), a typed answer
// (`outputFormat`), a session id the client picks (`sessionId`, a UUID), the
// turn's tokens and dollars in its result.
//
// Node at the edge: `spawnClaudeCodeProcess` asks for a Node ChildProcess,
// so `claude` is started here with `node:child_process`, to know its pid for
// the stop's reaping.

const tokensOf = (u: {
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly cache_creation_input_tokens?: number | null;
	readonly cache_read_input_tokens?: number | null;
}): Tokens => ({
	input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
	cached: u.cache_read_input_tokens ?? 0,
	output: u.output_tokens,
});

/** What one SDK message says, as the interface's raw updates. Pure. */
export const rawOf = (m: SDKMessage): Raw[] | {readonly broke: string} => {
	if (m.type === "assistant" && m.parent_tool_use_id === null) {
		const blocks = m.message.content;
		const text = blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
		return [
			...(text === "" ? [] : [{_tag: "said", text} as const]),
			...blocks.flatMap((b) =>
				b.type === "tool_use"
					? [{_tag: "tool", id: b.id, title: b.name, status: "pending"} as const]
					: [],
			),
		];
	}
	if (m.type === "user" && m.parent_tool_use_id === null && Array.isArray(m.message.content)) {
		return m.message.content.flatMap((b) =>
			typeof b === "object" && b.type === "tool_result"
				? [
						{
							_tag: "tool",
							id: b.tool_use_id,
							title: "",
							status: b.is_error === true ? "failed" : "completed",
						} as const,
					]
				: [],
		);
	}
	if (m.type !== "result") return [];
	const spent = {usd: m.total_cost_usd, requests: m.num_turns};
	const total: Raw = {_tag: "tokens", tokens: tokensOf(m.usage), whole: true};
	const ended = (
		stop: "end_turn" | "over_budget" | "max_turn_requests",
		structured: unknown,
	): Raw => ({
		_tag: "ended",
		stop,
		structured,
		...spent,
	});
	if (m.subtype === "success" && !m.is_error)
		return [total, ended("end_turn", m.structured_output)];
	if (m.subtype === "error_max_budget_usd") return [total, ended("over_budget", undefined)];
	if (m.subtype === "error_max_turns") return [total, ended("max_turn_requests", undefined)];
	return {broke: `${m.subtype}${m.is_error ? " (error)" : ""}`};
};

/** Claude Code's own system prompt. */
const CLAUDE_CODE = {type: "preset", preset: "claude_code"} as const;

export interface ClaudeAdapterConfig {
	/** How the query is opened: the SDK's `query`, or a scripted one in a test. */
	readonly open?: Open;
	/** More options on top, for a stage's own needs (its hooks, its tools). */
	readonly more?: (folder: string) => Partial<Options>;
}

export const claudeAdapter = (config: ClaudeAdapterConfig = {}): Adapter => ({
	name: "claude",
	holds: {usd: true, schema: true},
	start: (turn) =>
		Effect.gen(function* () {
			const own = turn.resume ?? randomUUID();
			let pid: number | null = null;
			const base = claudeOptions(turn.folder, turn.usd);
			const options: Options = {
				...base,
				// Claude Code's own system prompt, as the CLI and ACP's adapter give it. Named, because
				// with none the SDK sends an empty one (experiment 158).
				systemPrompt: CLAUDE_CODE,
				// The preset asks the agent to keep a memory folder under ~/.claude: a contained run keeps none.
				settings: {...base.settings, autoMemoryEnabled: false},
				cwd: turn.folder,
				env: fencedEnv(agentEnv()),
				permissionMode: "dontAsk",
				allowedTools: [...TOOLS],
				hooks: {
					PreToolUse: [{hooks: [guardHook({tree: turn.folder, alsoWritable: [...temps()]})]}],
				},
				persistSession: true,
				...(turn.model === null ? {} : {model: turn.model}),
				...(turn.effort === null ? {} : {effort: turn.effort as NonNullable<Options["effort"]>}),
				...(turn.resume === null ? {sessionId: own} : {resume: own}),
				outputFormat: {type: "json_schema", schema: turn.schema},
				spawnClaudeCodeProcess: (o) => {
					const child = spawn(o.command, o.args, {
						...(o.cwd === undefined ? {} : {cwd: o.cwd}),
						env: o.env,
						stdio: ["pipe", "pipe", "ignore"],
						signal: o.signal,
					});
					pid = child.pid ?? null;
					return child;
				},
				...config.more?.(turn.folder),
			};
			const q = (config.open ?? query)({prompt: turn.prompt, options});
			const closed = {done: false};
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					closed.done = true;
					q.close();
				}),
			);
			const updates = Stream.fromAsyncIterable(q, (e) => failed("broke", String(e))).pipe(
				Stream.mapEffect((m) => {
					if (m.type === "system" && m.subtype === "init") {
						const extra = extraTools(options.tools, m.tools);
						return extra > 0
							? Effect.fail(failed("contain", `the SDK listed ${extra} tools the run did not name`))
							: Effect.succeed<Raw[]>([]);
					}
					const raws = rawOf(m);
					return Array.isArray(raws)
						? Effect.succeed(raws)
						: Effect.fail(failed("broke", raws.broke));
				}),
				Stream.flattenIterable,
			);
			return {
				updates: Stream.concat(Stream.succeed<Raw>({_tag: "opened", own}), updates),
				get pid() {
					return pid;
				},
				// The maker's own stop: interrupt the turn, then end the process.
				stop: Effect.promise(async () => {
					if (closed.done) return;
					await Promise.race([
						q.interrupt().catch(() => undefined),
						new Promise((r) => setTimeout(r, 3_000)),
					]);
					q.close();
				}),
			};
		}),
});
