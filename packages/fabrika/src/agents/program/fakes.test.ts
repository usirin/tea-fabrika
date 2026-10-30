import type {SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import {describe, expect, it} from "vitest";
import type {Raw} from "../agent/turn.ts";
import {rawOf} from "../claude/adapter.ts";
import {rawOfLine} from "../codex/adapter.ts";
import {claudeRaws, codexRaws, type Story} from "./fakes.ts";

// The two fake providers (./fakes.ts) are only worth their tests if they say a
// turn the way each real adapter does. Here each is held to its adapter's pure
// part, on the provider's own events, written by hand.

const GOOD = {label: "bug", ticket: "#7"};
const STORY: Story = {tool: {id: "t1", title: "Read"}, said: "Read the ticket.", answer: GOOD};

describe("the fakes say what each real adapter makes of its provider's events", () => {
	it("claude: the SDK's messages, through rawOf", () => {
		const sdk = (m: Record<string, unknown>) =>
			// biome-ignore lint/plugin: a fixture holds the few fields rawOf reads; the SDK's full type has dozens more
			m as unknown as SDKMessage;
		const raws = [
			sdk({
				type: "assistant",
				parent_tool_use_id: null,
				message: {content: [{type: "tool_use", id: "t1", name: "Read", input: {}}]},
			}),
			sdk({
				type: "user",
				parent_tool_use_id: null,
				message: {content: [{type: "tool_result", tool_use_id: "t1"}]},
			}),
			sdk({
				type: "assistant",
				parent_tool_use_id: null,
				message: {content: [{type: "text", text: "Read the ticket."}]},
			}),
			sdk({
				type: "result",
				subtype: "success",
				is_error: false,
				total_cost_usd: 0.012,
				num_turns: 2,
				structured_output: GOOD,
				usage: {
					input_tokens: 300,
					output_tokens: 40,
					cache_read_input_tokens: 900,
					cache_creation_input_tokens: 0,
				},
			}),
		].flatMap((m) => rawOf(m) as Raw[]);
		expect(raws).toEqual(claudeRaws(STORY));
	});

	it("codex: `codex exec --json` lines, through rawOfLine", () => {
		const lines = [
			{type: "item.started", item: {id: "t1", type: "command_execution", command: "Read"}},
			{
				type: "item.completed",
				item: {id: "t1", type: "command_execution", command: "Read", status: "completed"},
			},
			{type: "item.completed", item: {id: "m1", type: "agent_message", text: "Read the ticket."}},
			{type: "item.completed", item: {id: "m2", type: "agent_message", text: JSON.stringify(GOOD)}},
			{
				type: "turn.completed",
				usage: {input_tokens: 1100, cached_input_tokens: 800, output_tokens: 35},
			},
		];
		const raws = lines.flatMap((l) => rawOfLine(JSON.stringify(l)) as Raw[]);
		expect(raws).toEqual(codexRaws(STORY));
	});
});
