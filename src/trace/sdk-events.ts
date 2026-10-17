import type {AgentEvent, AgentTurn} from "@demlik/tea/agent";
import {Option, Schema} from "effect";

// The live reviewer runs on the Claude Agent SDK, not on tea's agent runtime,
// so it has no `AgentEvent`s of its own. This turns the SDK's messages into
// them, for tea's `agentSpans` (./agent.ts) to draw as the same spans a tea
// agent gets: the run, a `chat` span per model turn, an `execute_tool` span
// per tool call.
//
//   assistant message      BrainStarted (when the model was last asked) + TurnSettled,
//                          then ToolStarted for each tool it asks for
//   user message           ToolSettled, or ToolFailed, for each tool result in it
//   result                 RunDone: done, or failed
//
// Only the top conversation counts: a sub-agent's messages are left out.
// Nothing the agent read or wrote is carried: a turn's text is "", a tool
// call's input is {}, a tool's result is null. Names, ids and token counts
// only. A message that does not fit is skipped, never thrown on.

const Usage = Schema.Struct({
	input_tokens: Schema.Number,
	output_tokens: Schema.Number,
	cache_creation_input_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
	cache_read_input_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
});

const ToolUse = Schema.Struct({
	type: Schema.Literal("tool_use"),
	id: Schema.optional(Schema.String),
	name: Schema.String,
});
const ToolResult = Schema.Struct({
	type: Schema.Literal("tool_result"),
	tool_use_id: Schema.String,
	is_error: Schema.optional(Schema.Boolean),
});

const Assistant = Schema.Struct({
	type: Schema.Literal("assistant"),
	parent_tool_use_id: Schema.NullOr(Schema.String),
	message: Schema.Struct({
		id: Schema.optional(Schema.String),
		model: Schema.optional(Schema.String),
		content: Schema.Array(Schema.Unknown),
		usage: Schema.optional(Usage),
	}),
});
const User = Schema.Struct({
	type: Schema.Literal("user"),
	parent_tool_use_id: Schema.NullOr(Schema.String),
	message: Schema.Struct({content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)])}),
});
const Result = Schema.Struct({
	type: Schema.Literal("result"),
	subtype: Schema.String,
	is_error: Schema.Boolean,
	usage: Usage,
});
const Seen = Schema.Union([Assistant, User, Result]);

const seenOf = Schema.decodeUnknownOption(Seen);
const toolUseOf = Schema.decodeUnknownOption(ToolUse);
const toolResultOf = Schema.decodeUnknownOption(ToolResult);

const blocks = <A>(content: unknown, read: (block: unknown) => Option.Option<A>): A[] =>
	Array.isArray(content) ? content.flatMap((block) => Option.toArray(read(block))) : [];

const usageOf = (u: typeof Usage.Type) => ({
	inputTokens:
		u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
	outputTokens: u.output_tokens,
	cachedInputTokens: u.cache_read_input_tokens ?? 0,
});

/**
 * A fold over one SDK run's messages, for the run `runId`: each message, and
 * when it came (epoch milliseconds), in; the events it makes, out.
 */
export const sdkEvents = (runId: string) => {
	let turn = 0;
	let current: string | null = null;
	/** When the model was last asked: the run's start, or the last tool result. */
	let asked: number | null = null;
	const names = new Map<string, string>();
	return (message: unknown, at: number): AgentEvent<null>[] => {
		asked ??= at;
		const seen = seenOf(message);
		if (Option.isNone(seen)) return [];
		const m = seen.value;
		const head = {runId, at};
		if (m.type === "result") {
			const usage = usageOf(m.usage);
			if (m.subtype === "success" && !m.is_error)
				return [{...head, type: "RunDone", status: {kind: "done", output: null, usage}}];
			const failure =
				m.subtype === "error_max_turns"
					? {reason: "turn_limit" as const, at}
					: {reason: "llm" as const, error: m.subtype, at};
			return [{...head, type: "RunDone", status: {kind: "failed", failure}}];
		}
		if (m.parent_tool_use_id !== null) return [];
		if (m.type === "user") {
			asked = at;
			return blocks(m.message.content, toolResultOf).map((r): AgentEvent<null> => {
				const name = names.get(r.tool_use_id) ?? "unknown";
				return r.is_error === true
					? {
							...head,
							type: "ToolFailed",
							callId: r.tool_use_id,
							name,
							failure: {kind: "error", reason: "", _tag: "tool_error"},
						}
					: {...head, type: "ToolSettled", callId: r.tool_use_id, result: null};
			});
		}
		const events: AgentEvent<null>[] = [];
		const uses = blocks(m.message.content, toolUseOf).map((use, i) => ({
			callId: use.id ?? `${turn + 1}.${i}`,
			name: use.name,
			args: {},
		}));
		// The SDK can hand one model turn over in several messages, all with the turn's id.
		const id = m.message.id ?? null;
		if (id === null || id !== current) {
			turn += 1;
			current = id;
			const settled: AgentTurn = {content: "", toolCalls: uses};
			events.push(
				{
					runId,
					at: asked,
					type: "BrainStarted",
					turn,
					purpose: "turn",
					model: m.message.model ?? null,
					payload: null,
				},
				m.message.usage === undefined
					? {...head, type: "TurnSettled", turn: settled}
					: {...head, type: "TurnSettled", turn: settled, usage: usageOf(m.message.usage)},
			);
		}
		for (const use of uses) {
			names.set(use.callId, use.name);
			events.push({...head, type: "ToolStarted", ...use});
		}
		asked = at;
		return events;
	};
};
