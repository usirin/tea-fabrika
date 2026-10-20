// The agent the answerer asks, as a service its host gives it. Two of them:
//
//   stub     deterministic arithmetic (./question.ts), after STUB_MS of "thinking": checkable,
//            free, the same every run. What the runs use.
//   claude   Claude Code, headless, through the Agent SDK, the way this repo's experiments run
//            it (84, 86): no tools, no MCP server, no settings files, no saved session, one
//            turn. Its login is CLAUDE_CODE_OAUTH_TOKEN in the container's environment, read by
//            Claude Code itself; nothing here reads, prints or stores it.
import {tmpdir} from "node:os";
import {Context, Duration, Effect, Schema} from "effect";
import {stubAnswer} from "./question.ts";

export interface Thought {
	readonly answer: string;
	/** Dollars, as the SDK reports them; 0 for the stub. */
	readonly usd: number;
}

export class Agent extends Context.Service<
	Agent,
	{readonly name: string; readonly ask: (text: string) => Effect.Effect<Thought>}
>()("exp95/Agent") {}

export const stubAgent = (thinkMs: number): Agent["Service"] => ({
	name: "stub",
	ask: (text) =>
		Effect.sleep(Duration.millis(thinkMs)).pipe(Effect.as({answer: stubAnswer(text), usd: 0})),
});

/** Claude Code failed to give a result: it becomes the answer "no answer: ...", judged wrong. */
class AgentFailed extends Schema.TaggedError<AgentFailed>()("AgentFailed", {
	message: Schema.String,
}) {}

const SYSTEM = "You answer one question. Reply with the answer only, no other words.";

/**
 * Node at the edge: the OS temp folder, as the agent's empty working folder. The SDK is loaded
 * on first use, so a stub host never loads it.
 */
export const claudeAgent = (model: string): Agent["Service"] => ({
	name: `claude:${model}`,
	ask: (text) =>
		Effect.tryPromise({
			try: async () => {
				const {query} = await import("@anthropic-ai/claude-agent-sdk");
				for await (const message of query({
					prompt: text,
					options: {
						model,
						systemPrompt: SYSTEM,
						tools: [],
						skills: [],
						mcpServers: {},
						strictMcpConfig: true,
						maxTurns: 1,
						settingSources: [],
						persistSession: false,
						cwd: tmpdir(),
					},
				})) {
					// A missing login comes back as subtype "success" with `is_error` set and the error
					// as its text ("Not logged in"), so `is_error` decides, not the subtype.
					if (message.type === "result")
						return {
							answer:
								message.subtype === "success" && !message.is_error
									? message.result
									: `no answer: ${message.subtype === "success" ? message.result : message.subtype}`,
							usd: message.total_cost_usd,
						};
				}
				return {answer: "no answer: no result", usd: 0};
			},
			catch: (e) =>
				new AgentFailed({message: e instanceof Error ? e.message.slice(0, 200) : String(e)}),
		}).pipe(
			Effect.catch((e: AgentFailed) => Effect.succeed({answer: `no answer: ${e.message}`, usd: 0})),
		),
});
