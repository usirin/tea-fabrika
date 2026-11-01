import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import type {Options, SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import {Effect, Stream} from "effect";
import {claudeOptions, claudeSystem} from "../acp/harness.ts";
import {type Adapter, asksNothing, failed, type Raw, type Tokens} from "../agent/turn.ts";
import {extraTools, NotStarted, type Open, openLive} from "./draft.ts";
import {agentEnv} from "./env.ts";
import {ownRules, settingsRefusal} from "./rules.ts";
import {fencedEnv, TOOLS, temps} from "./sandbox.ts";
import {guardHook} from "./shell-guard.ts";

// Claude Code through the Agent SDK, as an adapter of the interface
// (../agent/turn.ts). The same containment as the ACP row for Claude
// (`claudeOptions`: no MCP server, no connector, the builder's tools, the OS
// sandbox), plus what only the SDK path can carry: the shell guard as a
// PreToolUse hook, `dontAsk`, so nothing waits on a person, and the working
// folder's own rule files, read by Claude Code with none of the folder's
// settings (`ownRules`, ./rules.ts, experiment 155), as the stages read them.
// The ACP row stays on `settingSources: []`: its adapter pins an older SDK
// that experiment 155 did not test.
//
// A stage's `more` names only the options of an allow-list (`EXTRA_OPTIONS`): its
// type shuts out the rest, and a `more` that names another is refused before
// anything starts. Where settings come from is said by `ownRules` alone, and
// options that would load more are refused too (`settingsRefusal`). A live turn also checks the
// empty folder those settings are read from (`openLive`).
//
// The system prompt is the turn's, always named (`claudeSystem`): Claude
// Code's own (`claude_code`) with the stage's line appended, or the stage's
// text alone. Left unnamed, the SDK sends an empty one, and the agent gets
// none of Claude Code's instructions (experiment 158). A stage's `more`
// cannot name another, and it is set after `more` all the same. It is never
// recorded (`snapshot: false`), so a resumed turn gets its own prompt, not
// the session's first.
// The preset's memory section is off: it would have the agent keep notes
// under ~/.claude, outside the copy it is given.
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

export interface ClaudeAdapterConfig {
	/** How the query is opened: `openLive` unless named, a scripted one in a test. */
	readonly open?: Open;
	/** More options on top, for a stage's own needs: only those `EXTRA_OPTIONS` names. */
	readonly more?: (folder: string) => ExtraOptions;
}

/**
 * The options a stage may add, and no other: an allow-list, so an option the
 * SDK adds later is shut out until it is named here. No stage in the
 * workspace adds any today. `disallowedTools` is the one an experiment used
 * (158) that can only take away. Left out on purpose: `agent`, `agents` and
 * `extraArgs`, which can swap the turn's system prompt (`agent` "applies the
 * agent's system prompt" to the main thread); `hooks`, `env`,
 * `permissionMode` and `canUseTool`, which would loosen the containment; and
 * where settings come from, which `ownRules` alone says.
 */
export const EXTRA_OPTIONS = ["disallowedTools"] as const satisfies readonly (keyof Options)[];

/** `EXTRA_OPTIONS`'s options; every other option of the SDK is `never`. */
export type ExtraOptions = {
	readonly [K in keyof Options]?: K extends (typeof EXTRA_OPTIONS)[number] ? Options[K] : never;
};

/** A `more` that got past its type (a cast, or JavaScript), by the first option it names outside `EXTRA_OPTIONS`. */
const outsideExtra = (more: object): string | null =>
	Object.keys(more).find((k) => !(EXTRA_OPTIONS as readonly string[]).includes(k)) ?? null;

export const claudeAdapter = (config: ClaudeAdapterConfig = {}): Adapter => ({
	name: "claude",
	holds: {usd: true, schema: true},
	start: (turn) =>
		Effect.gen(function* () {
			const more = config.more?.(turn.folder) ?? {};
			const outside = outsideExtra(more);
			if (outside !== null)
				return yield* Effect.fail(
					failed(
						"contain",
						`a stage's options may not name ${outside}; only ${EXTRA_OPTIONS.join(", ")}`,
					),
				);
			const own = turn.resume ?? randomUUID();
			let pid: number | null = null;
			const {settingSources: _none, settings, ...base} = claudeOptions(turn.folder, turn.usd);
			const options: Options = {
				...base,
				// The folder's own rule files, none of its settings (./rules.ts, experiment 155). The
				// preset asks the agent to keep a memory folder under ~/.claude: a contained run keeps none.
				...ownRules({...settings, autoMemoryEnabled: false}),
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
				...(asksNothing(turn.schema)
					? {}
					: {outputFormat: {type: "json_schema" as const, schema: turn.schema}}),
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
				...more,
				// The turn's own system prompt, after `more`: no stage option can drop or swap it.
				systemPrompt: claudeSystem(turn.system),
			};
			// Where settings come from, said by `ownRules` alone, checked on the whole before any process.
			const refused = settingsRefusal(options);
			if (refused !== null) return yield* Effect.fail(failed("contain", refused));
			const q = (config.open ?? openLive)({prompt: turn.prompt, options});
			const closed = {done: false};
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					closed.done = true;
					q.close();
				}),
			);
			const updates = Stream.fromAsyncIterable(q, (e) =>
				e instanceof NotStarted ? failed("start", e.message) : failed("broke", String(e)),
			).pipe(
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
