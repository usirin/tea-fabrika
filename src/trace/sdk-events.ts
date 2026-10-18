import type {AgentEvent, ToolCall} from "@demlik/tea/agent";
import {Option, Predicate, Schema} from "effect";

// The live builder and reviewer run on the Claude Agent SDK, not on tea's
// agent runtime, so they have no `AgentEvent`s of their own. This turns the
// SDK's messages into them, for tea's `agentSpans` (./agent.ts) to draw as the
// same spans a tea agent gets: the run, a `chat` span per model turn, an
// `execute_tool` span per tool call.
//
//   assistant message      on a new model turn, BrainStarted (when the model was last asked);
//                          then ToolStarted for each tool it asks for
//   message_delta          the turn's end: TurnSettled, listing every tool call of the turn
//   user message           ToolSettled, or ToolFailed, for each tool result in it
//   result                 RunDone: done, or failed
//
// Why a turn ends on `message_delta`: the SDK hands every assistant message
// the usage from the start of the model message, so its output tokens are a
// handful, whatever the turn wrote. The streamed `message_delta`, a partial
// message the SDK sends only with `includePartialMessages` on, carries the
// turn's real output tokens. The input and cache counts are known at the
// start, and come from the assistant message. Every other partial message
// (each piece of text, thinking or tool input as it streams) is passed over
// unread.
//
// A tool starts as soon as the model has asked for it, while the model may
// still be writing: its result can come before the turn's `message_delta`.
// So a tool call is started on the assistant message that asks for it, and a
// tool result never ends the turn.
//
// A turn that never gets its `message_delta` (the run did not ask for partial
// messages, or was stopped mid-turn) is settled with what is known when the
// next thing comes: a new turn, the result, or the run's end.
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
type Usage = typeof Usage.Type;

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
/** The partial message that ends a model turn, with the turn's output tokens. */
const Delta = Schema.Struct({
	type: Schema.Literal("stream_event"),
	parent_tool_use_id: Schema.NullOr(Schema.String),
	event: Schema.Struct({
		type: Schema.Literal("message_delta"),
		usage: Schema.Struct({output_tokens: Schema.Number}),
	}),
});
const Result = Schema.Struct({
	type: Schema.Literal("result"),
	subtype: Schema.String,
	is_error: Schema.Boolean,
	usage: Usage,
});
const Seen = Schema.Union([Assistant, User, Delta, Result]);

const seenOf = Schema.decodeUnknownOption(Seen);
const toolUseOf = Schema.decodeUnknownOption(ToolUse);
const toolResultOf = Schema.decodeUnknownOption(ToolResult);

/**
 * A partial message that is not a turn's end. By far the most messages of a
 * run that streams, one per piece, so told apart before anything is decoded.
 */
const streamed = (message: unknown): boolean =>
	Predicate.hasProperty(message, "type") &&
	message.type === "stream_event" &&
	!(
		Predicate.hasProperty(message, "event") &&
		Predicate.hasProperty(message.event, "type") &&
		message.event.type === "message_delta"
	);

const blocks = <A>(content: unknown, read: (block: unknown) => Option.Option<A>): A[] =>
	Array.isArray(content) ? content.flatMap((block) => Option.toArray(read(block))) : [];

const usageOf = (u: Usage) => ({
	inputTokens:
		u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
	outputTokens: u.output_tokens,
	cachedInputTokens: u.cache_read_input_tokens ?? 0,
});

/** A model turn begun and not yet settled: what is known of it so far. */
interface Open {
	readonly calls: ToolCall[];
	/** From its first assistant message: right for input, a start-of-message count for output. */
	readonly usage: Usage | undefined;
}

/** One SDK run's messages, folded into tea's agent events. */
export interface SdkEvents {
	/** The events one message makes, given when it came (epoch milliseconds). */
	readonly seen: (message: unknown, at: number) => AgentEvent<null>[];
	/** What a run stopped before its result still owes: its open turn, settled with what is known. */
	readonly end: (at: number) => AgentEvent<null>[];
}

/** The fold over one SDK run's messages, for the run `runId`. */
export const sdkEvents = (runId: string): SdkEvents => {
	let turn = 0;
	/** The model message the last assistant message was part of. */
	let current: string | null = null;
	let open: Open | null = null;
	/** When the model was last asked: the run's start, the last turn's end, or the last tool result. */
	let asked: number | null = null;
	const names = new Map<string, string>();

	/** The open turn's end. `output`: its output tokens, when its `message_delta` said them. */
	const settle = (at: number, output?: number): AgentEvent<null>[] => {
		if (open === null) return [];
		const {calls, usage} = open;
		open = null;
		const known =
			usage === undefined
				? {}
				: {usage: usageOf(output === undefined ? usage : {...usage, output_tokens: output})};
		return [{runId, at, type: "TurnSettled", turn: {content: "", toolCalls: calls}, ...known}];
	};

	const seen = (message: unknown, at: number): AgentEvent<null>[] => {
		if (streamed(message)) return [];
		asked ??= at;
		const decoded = seenOf(message);
		if (Option.isNone(decoded)) return [];
		const m = decoded.value;
		const head = {runId, at};
		if (m.type === "result") {
			const done = settle(at);
			if (m.subtype === "success" && !m.is_error)
				return [
					...done,
					{...head, type: "RunDone", status: {kind: "done", output: null, usage: usageOf(m.usage)}},
				];
			const failure =
				m.subtype === "error_max_turns"
					? {reason: "turn_limit" as const, at}
					: {reason: "llm" as const, error: m.subtype, at};
			return [...done, {...head, type: "RunDone", status: {kind: "failed", failure}}];
		}
		if (m.parent_tool_use_id !== null) return [];
		if (m.type === "stream_event") {
			asked = at;
			return settle(at, m.event.usage.output_tokens);
		}
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
		// The SDK can hand one model turn over in several messages, all with the turn's id.
		const id = m.message.id ?? null;
		const events: AgentEvent<null>[] = [];
		if (id === null || id !== current) {
			turn += 1;
			events.push(...settle(at), {
				runId,
				at: asked,
				type: "BrainStarted",
				turn,
				purpose: "turn",
				model: m.message.model ?? null,
				payload: null,
			});
			current = id;
			open = {calls: [], usage: m.message.usage};
		}
		const calls: ToolCall[] = blocks(m.message.content, toolUseOf).map((use, i) => ({
			callId: use.id ?? `${turn}.${(open?.calls.length ?? 0) + i}`,
			name: use.name,
			args: {},
		}));
		// A late message of a turn already settled: its calls still start, the turn is already drawn.
		open?.calls.push(...calls);
		for (const call of calls) {
			names.set(call.callId, call.name);
			events.push({...head, type: "ToolStarted", ...call});
		}
		return events;
	};

	return {seen, end: (at) => settle(at)};
};
