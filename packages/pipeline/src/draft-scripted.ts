import type {Options, SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {Open} from "@kampus/fabrika/agents/claude";

// An Agent SDK query that answers from a script, for tests of the runner
// (`sdkRunner`, src/draft.ts) and of what stands on it. No agent is started.
// The messages are written by hand, with only the fields the runner reads.

/** The SDK's first message: the tools the agent has. */
export const initOf = (tools: readonly string[]): SDKMessage =>
	({type: "system", subtype: "init", tools: [...tools]}) as never;

/** One turn of the agent that asks for these tools. */
export const turnOf = (...tools: readonly string[]): SDKMessage =>
	({
		type: "assistant",
		parent_tool_use_id: null,
		message: {
			content: tools.map((name) => ({type: "tool_use", name})),
			usage: {input_tokens: 10, output_tokens: 5},
		},
	}) as never;

/** The SDK's last message of a run that ended well, with its typed answer. */
export const resultOf = (answer: unknown): SDKMessage =>
	({
		type: "result",
		subtype: "success",
		is_error: false,
		total_cost_usd: 0.25,
		num_turns: 2,
		duration_ms: 60_000,
		session_id: "s",
		usage: {input_tokens: 10, output_tokens: 5},
		structured_output: answer,
		result: "",
	}) as never;

/**
 * A query that hands out `messages` in order, one each time it is asked.
 * `read` is how many it handed out, so a test can see where a run stopped
 * reading. `closed`: how many times the query was closed. `asked`: the
 * options each query was opened with, as the SDK would have been handed them.
 */
export function scriptedOpen(messages: readonly SDKMessage[]) {
	const seen = {opened: 0, read: 0, closed: 0};
	const asked: Options[] = [];
	async function* each() {
		for (const message of messages) {
			seen.read += 1;
			yield message;
		}
	}
	const open: Open = ({options}) => {
		seen.opened += 1;
		asked.push(options);
		return Object.assign(each(), {
			interrupt: () => Promise.resolve(undefined),
			close: () => {
				seen.closed += 1;
			},
		});
	};
	return {open, seen, asked};
}
