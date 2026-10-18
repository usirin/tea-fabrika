import type {AgentEvent, ToolCall} from "@demlik/tea/agent";
import type {Ended, Seen, Usage} from "./transcript.ts";

// One ACP turn as tea's agent events, for `agentSpans` (src/trace/agent.ts):
// the turn a span, each tool call a span under it. Names and ids only: a
// tool's name, never its input, its output or its title (a title can quote a
// path or a command).
//
// ACP says when a prompt turn starts and stops, and when each tool call
// starts and ends. It does not say when the model is asked again inside a
// turn (a turn with three tool calls is several model calls), so the whole
// prompt turn is one brain span here, its tool calls under it.
//
//   start(at, model)                       BrainStarted
//   seen(tool t1 Read pending)             ToolStarted t1 Read
//   seen(tool_update t1 completed)         ToolSettled t1
//   end({stop: "end_turn", usage})         TurnSettled, RunDone done

const turnUsage = (usage: Usage | null) =>
	usage === null
		? undefined
		: {inputTokens: usage.input, outputTokens: usage.output, cachedInputTokens: usage.cached};

export interface AcpEvents {
	readonly start: (at: number, model: string | null) => AgentEvent<null>[];
	readonly seen: (event: Seen, at: number) => AgentEvent<null>[];
	readonly end: (ended: Ended, at: number) => AgentEvent<null>[];
}

/** The fold over one prompt turn's updates, for the agent run `runId`. */
export const acpEvents = (runId: string): AcpEvents => {
	const calls: ToolCall[] = [];
	const names = new Map<string, string>();
	const open = new Set<string>();
	const head = (at: number) => ({runId, at});

	const settle = (id: string, failed: boolean, at: number): AgentEvent<null>[] => {
		if (!open.has(id)) return [];
		open.delete(id);
		return failed
			? [
					{
						...head(at),
						type: "ToolFailed",
						callId: id,
						name: names.get(id) ?? "unknown",
						failure: {kind: "error", reason: "", _tag: "tool_error"},
					},
				]
			: [{...head(at), type: "ToolSettled", callId: id, result: null}];
	};

	const seen = (event: Seen, at: number): AgentEvent<null>[] => {
		if (event.kind !== "tool" && event.kind !== "tool_update") return [];
		const started: AgentEvent<null>[] = [];
		if (!names.has(event.id)) {
			const name = event.name ?? "unknown";
			names.set(event.id, name);
			open.add(event.id);
			calls.push({callId: event.id, name, args: {}});
			started.push({...head(at), type: "ToolStarted", callId: event.id, name, args: {}});
		}
		const ended =
			event.status === "completed" || event.status === "failed"
				? settle(event.id, event.status === "failed", at)
				: [];
		return [...started, ...ended];
	};

	const end = (ended: Ended, at: number): AgentEvent<null>[] => {
		// A tool the harness never said the end of ends with its turn.
		const left = [...open].flatMap((id) => settle(id, ended.stop === "cancelled", at));
		const usage = turnUsage(ended.usage);
		const settled: AgentEvent<null> = {
			...head(at),
			type: "TurnSettled",
			turn: {content: "", toolCalls: calls},
			...(usage === undefined ? {} : {usage}),
		};
		const status =
			ended.stop === "end_turn"
				? {
						kind: "done" as const,
						output: null,
						usage: usage ?? {inputTokens: 0, outputTokens: 0},
					}
				: ended.stop === "cancelled"
					? {kind: "cancelled" as const, at}
					: {kind: "failed" as const, failure: {reason: "llm" as const, error: ended.stop, at}};
		return [...left, settled, {...head(at), type: "RunDone", status}];
	};

	return {
		start: (at, model) => [
			{...head(at), type: "BrainStarted", turn: 1, purpose: "turn", model, payload: null},
		],
		seen,
		end,
	};
};
