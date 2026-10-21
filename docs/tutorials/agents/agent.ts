// The agent: Claude Code through the Agent SDK, one turn, no tools, no settings files.
// Its login is CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in the environment; Claude Code reads it.
import {tmpdir} from "node:os";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {Effect, Schema} from "effect";

export class AgentFailed extends Schema.TaggedError<AgentFailed>()("AgentFailed", {
	why: Schema.String,
}) {}

export interface Written {
	readonly line: string;
	readonly usd: number;
}

const ask = async (guest: string): Promise<Written> => {
	for await (const m of query({
		prompt: `Write one line, at most twelve words, about a glass of tea poured for ${guest}.`,
		options: {
			model: "haiku",
			systemPrompt: "You write one line of verse. Reply with the line only.",
			tools: [],
			mcpServers: {},
			settingSources: [],
			persistSession: false,
			cwd: tmpdir(),
		},
	})) {
		if (m.type !== "result") continue;
		// A missing login comes back as a "success" with `is_error` set.
		if (m.subtype !== "success" || m.is_error) throw new Error(`no line: ${m.subtype}`);
		return {line: m.result.trim(), usd: m.total_cost_usd};
	}
	throw new Error("no result from the agent");
};

/** One line of verse for `guest`, and what it cost. */
export const write = (guest: string) =>
	Effect.tryPromise({
		try: () => ask(guest),
		catch: (cause) => new AgentFailed({why: String(cause)}),
	});
