// Experiment 163, part 5: the one live call, a small Claude model asked whether an earlier ruling
// decides a ticket. Through the Agent SDK with no tools, no settings and no skills, as part 2's opus.
// Its dollars are the SDK's own `total_cost_usd`, which is list price.
import {query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika/agents/claude";
import {agentEnv} from "@kampus/fabrika/agents/sandbox";
import {Option, type Schema} from "effect";

export interface Heard<A> {
	readonly answer: A | null;
	readonly modelId: string;
	readonly usd: number | null;
	readonly ms: number;
	readonly tokens: {readonly input: number; readonly cached: number; readonly output: number};
	readonly error: string | null;
}

/** One call: `system` is the brief, `prompt` the case, `schema` the answer's shape. */
export async function claudeOnce<A>(
	model: "haiku" | "sonnet",
	system: string,
	prompt: string,
	schema: Schema.Codec<A, unknown>,
	cwd: string,
): Promise<Heard<A>> {
	const read = reader(schema);
	const started = Date.now();
	let seen = "";
	for await (const message of query({
		prompt,
		options: {
			model,
			systemPrompt: system,
			tools: [],
			maxTurns: 3,
			cwd,
			skills: [],
			mcpServers: {},
			strictMcpConfig: true,
			settingSources: [],
			persistSession: false,
			env: agentEnv(),
			outputFormat: {type: "json_schema", schema: jsonSchema(schema)},
		},
	})) {
		if (message.type === "system" && message.subtype === "init") seen = message.model;
		if (message.type === "result") {
			const u = message.usage;
			const answer =
				message.subtype === "success" ? read(message.structured_output) : Option.none();
			return {
				answer: Option.getOrNull(answer),
				modelId: seen,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				tokens: {
					input:
						u.input_tokens +
						(u.cache_creation_input_tokens ?? 0) +
						(u.cache_read_input_tokens ?? 0),
					cached: u.cache_read_input_tokens ?? 0,
					output: u.output_tokens,
				},
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
			};
		}
	}
	return {
		answer: null,
		modelId: seen,
		usd: null,
		ms: Date.now() - started,
		tokens: {input: 0, cached: 0, output: 0},
		error: "no result",
	};
}
