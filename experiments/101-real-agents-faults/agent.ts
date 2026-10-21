// The real agent of experiment 101: Claude Code through the Agent SDK, two turns in one session.
//
//   turn 1   the question ("What is 40 + 75?")             the work
//   turn 2   "Check that answer once more. ..."            needs turn 1's context: the session
//
// A second turn is what gives a resume something to save: a run killed after turn 1 can go on
// from turn 2 if its transcript is reachable, or must start over if it is not.
//
// Experiment 95's agent (../95-agents-across-hosts/agent.ts) with three changes:
//   - the session id is chosen here (`session`, a UUID), so the caller can record it in the
//     ledger before the run starts, as ACP's `session/new` hands one back before `session/prompt`;
//   - the transcript is mirrored, entry by entry, to a `SessionStore` the caller gives (the SDK's
//     own adapter for keeping a transcript somewhere other than the local disk);
//   - `from`: resume a recorded session from that store, forked into the new `session`, and send
//     only the turns still to do.
//
// No tools, no MCP server, no settings files, the OS temp folder as the working folder. Its login
// is CLAUDE_CODE_OAUTH_TOKEN in the container's environment, read by Claude Code itself; nothing
// here reads, prints or stores it.
import {tmpdir} from "node:os";
import type {SDKUserMessage, SessionStore} from "@anthropic-ai/claude-agent-sdk";
import {Effect} from "effect";

export const SYSTEM = "You answer one question. Reply with the answer only, no other words.";
export const CHECK = "Check that answer once more. Reply with the final number only.";

/** One turn's result, as Claude Code reported it. */
export interface TurnResult {
	readonly turn: number;
	readonly ok: boolean;
	readonly text: string;
	/** The running total for this query() call: a resumed session starts from its transcript's total. */
	readonly totalUsd: number;
	readonly ms: number;
	readonly inputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly outputTokens: number;
}

export interface Thought {
	/** The last turn's text, or "no answer: ..." when a turn failed. */
	readonly answer: string;
	readonly ok: boolean;
	readonly turns: readonly TurnResult[];
	/** The last reported running total. */
	readonly totalUsd: number;
	readonly session: string;
}

export interface RunSpec {
	readonly model: string;
	/** This run's session id: a fresh UUID, recorded before the run starts. */
	readonly session: string;
	/** A recorded session to resume from (forked into `session`), or null for a fresh run. */
	readonly from: string | null;
	/** The turns to send, in order. A resumed run sends only those still to do. */
	readonly prompts: readonly string[];
	/**
	 * Called as each turn's result comes back; the next turn is sent once it settles, so a caller
	 * can put the turn on record first (a checkpoint). A rejection ends the run.
	 */
	readonly onTurn: (r: TurnResult) => void | Promise<void>;
	/** null: no transcript is kept anywhere (`persistSession: false`). */
	readonly store: SessionStore | null;
	/** Extra environment for the Claude Code process, on top of this one's. */
	readonly env?: Readonly<Record<string, string>>;
}

const message = (text: string): SDKUserMessage => ({
	type: "user",
	message: {role: "user", content: text},
	parent_tool_use_id: null,
});

/**
 * Node at the edge: the SDK is a Promise API over a child process. The input is an async generator
 * that sends turn i+1 only once turn i's result is in (streaming input: one process, one session).
 * An interrupt aborts the child.
 */
export const runTurns = (spec: RunSpec): Effect.Effect<Thought> =>
	Effect.tryPromise({
		try: async (signal) => {
			const {query} = await import("@anthropic-ai/claude-agent-sdk");
			const abortController = new AbortController();
			signal.addEventListener("abort", () => abortController.abort());
			const waits = spec.prompts.map(() => {
				let resolve = () => {};
				const promise = new Promise<void>((r) => {
					resolve = r;
				});
				return {promise, resolve};
			});
			async function* input() {
				for (const [i, text] of spec.prompts.entries()) {
					if (i > 0) await waits[i - 1]?.promise;
					yield message(text);
				}
				await waits.at(-1)?.promise;
			}
			const turns: TurnResult[] = [];
			let began = Date.now();
			for await (const m of query({
				prompt: input(),
				options: {
					model: spec.model,
					systemPrompt: SYSTEM,
					tools: [],
					skills: [],
					mcpServers: {},
					strictMcpConfig: true,
					settingSources: [],
					cwd: tmpdir(),
					abortController,
					...(spec.store === null
						? {persistSession: false}
						: {sessionStore: spec.store, sessionStoreFlush: "eager" as const}),
					...(spec.from === null
						? {sessionId: spec.session}
						: {resume: spec.from, forkSession: true, sessionId: spec.session}),
					...(spec.env === undefined ? {} : {env: {...process.env, ...spec.env}}),
				},
			})) {
				if (m.type !== "result") continue;
				// A missing login comes back as subtype "success" with `is_error` set (experiment 95).
				const ok = m.subtype === "success" && !m.is_error;
				const r: TurnResult = {
					turn: turns.length + 1,
					ok,
					text: m.subtype === "success" ? m.result : m.subtype,
					totalUsd: m.total_cost_usd,
					ms: Date.now() - began,
					inputTokens: m.usage.input_tokens,
					cacheReadTokens: m.usage.cache_read_input_tokens,
					cacheWriteTokens: m.usage.cache_creation_input_tokens,
					outputTokens: m.usage.output_tokens,
				};
				turns.push(r);
				await spec.onTurn(r);
				began = Date.now();
				waits[turns.length - 1]?.resolve();
				if (!ok || turns.length === spec.prompts.length) break;
			}
			for (const w of waits) w.resolve();
			const last = turns.at(-1);
			const whole = turns.length === spec.prompts.length && turns.every((t) => t.ok);
			return {
				answer: whole ? (last?.text ?? "") : `no answer: ${last?.text ?? "no result"}`,
				ok: whole,
				turns,
				totalUsd: last?.totalUsd ?? 0,
				session: spec.session,
			};
		},
		catch: (e) => (e instanceof Error ? e.message.slice(0, 200) : String(e)),
	}).pipe(
		Effect.catch((why: string) =>
			Effect.succeed({
				answer: `no answer: ${why}`,
				ok: false,
				turns: [],
				totalUsd: 0,
				session: spec.session,
			}),
		),
	);
