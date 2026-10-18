import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {AgentEvent} from "@demlik/tea/agent";
import type {ReadableSpan} from "@opentelemetry/sdk-trace-base";
import {memoryTracing} from "@tea-fabrika/tsh/trace/otel";
import {Effect, Layer, Stream} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {initOf, resultOf, scriptedOpen} from "../draft-scripted.ts";
import {liveReviewer, Reviewer} from "../stages/review/reviewer.ts";
import {briefOf, WHOLE} from "../stages/review/scripted.ts";
import {KEPT_OUT} from "./agent.ts";
import {sdkEvents} from "./sdk-events.ts";

// The live reviewer's SDK messages, as tea's agent events and then as spans.
// The SDK messages are written by hand, in the shape the SDK streams them with
// partial messages on: each model turn is a `message_start`, each content
// block's start, pieces and stop, an assistant message per block, then the
// `message_delta` that says the turn's output tokens. A secret is in every
// place the agent's words go: none of it may reach an event or a span.

const SECRET = "the secret in the pull request";

type Block =
	| {readonly kind: "text"}
	| {readonly kind: "thinking"}
	| {readonly kind: "tool"; readonly id: string; readonly name: string};

const text: Block = {kind: "text"};
const thinking: Block = {kind: "thinking"};
const call = (id: string, name: string): Block => ({kind: "tool", id, name});

/** The SDK's usage on every assistant message of a turn: the count at the turn's start. */
const STALE = {input_tokens: 100, output_tokens: 3, cache_read_input_tokens: 50};

/** One partial message: a piece of the model's stream. */
const streamed = (event: object, parent: string | null): SDKMessage =>
	({type: "stream_event", parent_tool_use_id: parent, uuid: "u", session_id: "s", event}) as never;

const contentOf = (block: Block) =>
	block.kind === "text"
		? {type: "text", text: SECRET}
		: block.kind === "thinking"
			? {type: "thinking", thinking: SECRET, signature: SECRET}
			: {type: "tool_use", id: block.id, name: block.name, input: {q: SECRET}};

const deltaOf = (block: Block) =>
	block.kind === "text"
		? {type: "text_delta", text: SECRET}
		: block.kind === "thinking"
			? {type: "thinking_delta", thinking: SECRET}
			: {type: "input_json_delta", partial_json: `{"q":"${SECRET}"`};

/**
 * One model turn as the SDK streams it: an assistant message per block, all
 * with the turn's id, and the partial messages around them, ending on the
 * `message_delta` that holds `output`, the turn's real output tokens.
 * `early`: what the SDK hands over before that end, as a tool that answered
 * while the model was still writing.
 */
const modelTurn = (
	id: string,
	blocks: readonly Block[],
	output: number,
	{parent = null, early = []}: {parent?: string | null; early?: readonly SDKMessage[]} = {},
): SDKMessage[] => [
	streamed(
		{type: "message_start", message: {id, model: "claude-opus", content: [], usage: STALE}},
		parent,
	),
	...blocks.flatMap((block, index) => [
		streamed(
			{type: "content_block_start", index, content_block: {...contentOf(block), input: {}}},
			parent,
		),
		streamed({type: "content_block_delta", index, delta: deltaOf(block)}, parent),
		streamed({type: "content_block_stop", index}, parent),
		{
			type: "assistant",
			parent_tool_use_id: parent,
			uuid: "u",
			session_id: "s",
			message: {id, model: "claude-opus", content: [contentOf(block)], usage: STALE},
		} as never,
	]),
	...early,
	streamed(
		{type: "message_delta", delta: {stop_reason: "tool_use"}, usage: {output_tokens: output}},
		parent,
	),
	streamed({type: "message_stop"}, parent),
];

/** The tool results the SDK hands back, as the next user message. */
const results = (
	done: readonly (readonly [string, boolean])[],
	parent: string | null = null,
): SDKMessage =>
	({
		type: "user",
		parent_tool_use_id: parent,
		message: {
			role: "user",
			content: done.map(([id, failed]) => ({
				type: "tool_result",
				tool_use_id: id,
				is_error: failed,
				content: SECRET,
			})),
		},
	}) as never;

const FORM = {rows: [], findings: [], skipped: []};
/** The tool calls of each top turn. */
const CALLS = [["Read", "Agent"], ["Grep"], ["Glob", "Read"], ["StructuredOutput"]];
/** What the four top turns wrote, by their `message_delta`s. A sub-agent's turns are not in the run's own usage. */
const OUTPUT = [400, 250, 1200, 90];
const TOOLS = ["Read", "Agent", "Grep", "Glob", "Read", "StructuredOutput"];

/**
 * Four model turns, one of them handed over in three messages, a sub-agent's
 * turn among them, and a last turn whose tool answered before the turn ended,
 * as the SDK's own answer tool does in a live run.
 */
const RUN: readonly SDKMessage[] = [
	// The reviewer's own list: a run whose list holds more is ended at its start (src/draft.ts).
	initOf(["Glob", "Grep", "Read", "StructuredOutput", "mcp__review__file_note"]),
	...modelTurn("m1", [thinking, call("t1", "Read"), call("t2", "Agent")], 400),
	// The sub-agent that `t2` started: its own turn, tool call and result.
	...modelTurn("sub", [text, call("s1", "Read")], 999, {parent: "t2"}),
	results([["s1", false]], "t2"),
	results([
		["t1", false],
		["t2", false],
	]),
	...modelTurn("m2", [text, call("t3", "Grep")], 250),
	results([["t3", true]]),
	...modelTurn("m3", [call("t4", "Glob"), call("t5", "Read")], 1200),
	results([
		["t4", false],
		["t5", false],
	]),
	...modelTurn("m4", [thinking, call("t6", "StructuredOutput")], 90, {
		early: [results([["t6", false]])],
	}),
	{
		...(resultOf(FORM) as object),
		usage: {input_tokens: 600, output_tokens: 1940, cache_read_input_tokens: 200},
	} as never,
];

const fold = (messages: readonly SDKMessage[]) => {
	const f = sdkEvents("run-1");
	return {events: messages.flatMap((m, i) => f.seen(m, 1000 + i)), end: f.end};
};

const settled = (events: readonly AgentEvent<null>[]) =>
	events.flatMap((e) => (e.type === "TurnSettled" ? [e] : []));

const label = (e: AgentEvent<null>) => (e.type === "ToolStarted" ? `${e.type} ${e.name}` : e.type);

describe("SDK messages as agent events", () => {
	it("gives each turn the output tokens its message_delta said, which add up to the run's", () => {
		const {events} = fold(RUN);
		const turns = settled(events);
		expect(turns.map((t) => t.usage?.outputTokens)).toEqual(OUTPUT);
		expect(turns.reduce((sum, t) => sum + (t.usage?.outputTokens ?? 0), 0)).toBe(1940);
		// Input is known at a turn's start: the assistant message's count, cache included.
		expect(turns.map((t) => t.usage?.inputTokens)).toEqual([150, 150, 150, 150]);
		// Every tool call, even of a turn handed over in three messages; none of the sub-agent's.
		expect(turns.map((t) => t.turn.toolCalls.map((c) => c.name))).toEqual(CALLS);
		expect(events.flatMap((e) => (e.type === "ToolStarted" ? [e.name] : []))).toEqual(TOOLS);
		expect(JSON.stringify(events)).not.toContain(SECRET);
	});

	it("starts a tool when the model asks for it, and ends the turn on its message_delta", () => {
		const {events} = fold(RUN);
		expect(events.map(label)).toEqual([
			"BrainStarted",
			"ToolStarted Read",
			"ToolStarted Agent",
			"TurnSettled",
			"ToolSettled",
			"ToolSettled",
			"BrainStarted",
			"ToolStarted Grep",
			"TurnSettled",
			"ToolFailed",
			"BrainStarted",
			"ToolStarted Glob",
			"ToolStarted Read",
			"TurnSettled",
			"ToolSettled",
			"ToolSettled",
			"BrainStarted",
			"ToolStarted StructuredOutput",
			// The answer tool answered while the model was still writing: the turn ends after it.
			"ToolSettled",
			"TurnSettled",
			"RunDone",
		]);
		// A turn runs from when it was asked (the run's start, or the last tool result) to its message_delta.
		const at = (m: SDKMessage) => 1000 + RUN.indexOf(m);
		const deltas = RUN.filter(
			(m) => m.type === "stream_event" && m.event.type === "message_delta" && !m.parent_tool_use_id,
		);
		const asked = RUN.filter((m) => m.type === "user" && m.parent_tool_use_id === null).slice(0, 3);
		expect(events.filter((e) => e.type === "BrainStarted").map((e) => e.at)).toEqual([
			1000,
			...asked.map(at),
		]);
		expect(settled(events).map((e) => e.at)).toEqual(deltas.map(at));
	});

	it("settles a turn stopped before its message_delta with what is known, at the run's end", () => {
		const cut = RUN.findIndex(
			(m) => m.type === "assistant" && m.message.content[0]?.type === "tool_use",
		);
		const {events, end} = fold(RUN.slice(0, cut + 1));
		expect(events.map(label)).toEqual(["BrainStarted", "ToolStarted Read"]);
		const owed = end(5000);
		expect(owed.map(label)).toEqual(["TurnSettled"]);
		expect(settled(owed)[0]?.usage?.outputTokens).toBe(STALE.output_tokens);
		expect(settled(owed)[0]?.turn.toolCalls.map((c) => c.name)).toEqual(["Read"]);
		expect(end(6000)).toEqual([]);
	});

	it("settles a turn on what comes next when the run streams no partial messages", () => {
		const whole = RUN.filter((m) => m.type !== "stream_event");
		const {events} = fold(whole);
		expect(settled(events).map((t) => t.turn.toolCalls.map((c) => c.name))).toEqual(CALLS);
		expect(events.flatMap((e) => (e.type === "ToolStarted" ? [e.name] : []))).toEqual(TOOLS);
		expect(events.at(-1)?.type).toBe("RunDone");
	});
});

describe("the live reviewer, traced", () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
	});

	/** The reviewer run on `RUN`, with tracing on or off: its spans, the options it was opened with, what its `seen` was shown. */
	const reviewOn = async (traced: boolean) => {
		const repo = mkdtempSync(join(tmpdir(), "reviewer-trace-"));
		dirs.push(repo);
		const git = (...args: string[]) =>
			execFileSync(
				"git",
				["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
				{cwd: repo, encoding: "utf8"},
			).trim();
		git("init", "-q");
		writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
		git("add", "-A");
		git("commit", "-q", "-m", "one");
		const head = git("rev-parse", "HEAD");

		// As made: the view's fold is proved in ./agent.test.ts and ./view.test.ts.
		const {spans, layer} = memoryTracing({raw: true});
		const query = scriptedOpen(RUN);
		const shown: SDKMessage[] = [];
		await Effect.runPromise(
			Effect.gen(function* () {
				const reviewer = yield* Reviewer;
				yield* Stream.runDrain(
					reviewer.review(
						briefOf({...WHOLE, head}),
						{model: "opus", effort: "medium", budget: 2},
						null,
					),
				).pipe(Effect.withSpan("sub review_run"));
			}).pipe(
				Effect.withSpan("machine review"),
				Effect.provide(liveReviewer({repo, open: query.open, seen: (m) => shown.push(m)})),
				Effect.provide(traced ? layer : Layer.empty),
			),
		);
		return {spans, options: query.asked[0], shown};
	};

	it("draws its SDK run as an agent span with its turns and tool calls, under the review's span", async () => {
		const {spans} = await reviewOn(true);
		const named = (name: string) => spans.filter((s) => s.name === name);
		const id = (s: ReadableSpan) => s.spanContext().spanId;
		const parent = (s: ReadableSpan) => s.parentSpanContext?.spanId;
		const [sub] = named("sub review_run");
		const [agent] = named("invoke_agent reviewer");
		if (sub === undefined || agent === undefined)
			throw new Error(`missing: ${spans.map((s) => s.name).join(", ")}`);

		expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);
		expect(parent(agent)).toBe(id(sub));
		const under = spans.filter((s) => parent(s) === id(agent));
		expect(under.map((s) => s.name).toSorted()).toEqual(
			[
				...OUTPUT.map(() => "chat claude-opus"),
				...TOOLS.map((t) => `execute_tool ${t}`),
			].toSorted(),
		);
		// What a viewer sums for the run: each chat span's output tokens, adding up to the SDK's result.
		const chats = under.filter((s) => s.name.startsWith("chat"));
		const output = chats.map((s) => s.attributes["gen_ai.usage.output_tokens"]);
		expect(output.toSorted((a, b) => Number(a) - Number(b))).toEqual(
			OUTPUT.toSorted((a, b) => a - b),
		);
		expect(output.reduce((sum: number, n) => sum + Number(n), 0)).toBe(1940);

		const exported = JSON.stringify(spans.map((s) => [s.attributes, s.events]));
		expect(exported).not.toContain(SECRET);
		expect(exported).toContain(KEPT_OUT);
	});

	it("asks the SDK for partial messages only when traced, and never shows them to the run's own seen", async () => {
		const traced = await reviewOn(true);
		expect(traced.options?.includePartialMessages).toBe(true);
		expect(traced.shown.some((m) => m.type === "stream_event")).toBe(false);
		expect(traced.shown).toHaveLength(RUN.filter((m) => m.type !== "stream_event").length);

		const plain = await reviewOn(false);
		expect(plain.options).toBeDefined();
		expect(plain.options?.includePartialMessages).toBeUndefined();
		expect(plain.spans).toEqual([]);
	});
});
