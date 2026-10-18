import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {ReadableSpan} from "@opentelemetry/sdk-trace-base";
import {Effect, Stream} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {initOf, resultOf, scriptedOpen} from "../draft-scripted.ts";
import {liveReviewer, Reviewer} from "../stages/review/reviewer.ts";
import {briefOf, WHOLE} from "../stages/review/scripted.ts";
import {KEPT_OUT} from "./agent.ts";
import {memoryTracing} from "./otel.ts";
import {sdkEvents} from "./sdk-events.ts";

// The live reviewer's SDK messages, as tea's agent events and then as spans.
// The SDK messages are written by hand, in the SDK's shape, with a secret in
// every place the agent's words go: none of it may reach a span.

const SECRET = "the secret in the pull request";

/** One model turn: some words, and these tool calls, by id. */
const turn = (id: string, ...calls: readonly [string, string][]): SDKMessage =>
	({
		type: "assistant",
		parent_tool_use_id: null,
		message: {
			id,
			model: "claude-opus",
			content: [
				{type: "text", text: SECRET},
				...calls.map(([callId, name]) => ({
					type: "tool_use",
					id: callId,
					name,
					input: {q: SECRET},
				})),
			],
			usage: {input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50},
		},
	}) as never;

/** The tool results the SDK hands back, as the next user message. */
const results = (...done: readonly [string, boolean][]): SDKMessage =>
	({
		type: "user",
		parent_tool_use_id: null,
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

/** What a sub-agent says: not the reviewer's own turn. */
const subAgent: SDKMessage = {
	...(turn("sub", ["s1", "Read"]) as object),
	parent_tool_use_id: "t1",
} as never;

const FORM = {rows: [], findings: [], skipped: []};
const RUN: readonly SDKMessage[] = [
	initOf(["Glob", "Grep", "Read", "StructuredOutput", "mcp__review__file_note"]),
	turn("m1", ["t1", "Read"], ["t2", "Grep"]),
	subAgent,
	results(["t1", false], ["t2", true]),
	turn("m2", ["t3", "Read"]),
	// The same model turn, handed over in a second message: no new turn.
	turn("m2", ["t4", "Glob"]),
	results(["t3", false], ["t4", false]),
	turn("m3"),
	resultOf(FORM),
];

describe("SDK messages as agent events", () => {
	it("makes a turn per model turn, a call per tool, and a done, with no words in them", () => {
		const fold = sdkEvents("run-1");
		const events = RUN.flatMap((m, i) => fold(m, 1000 + i));
		expect(events.map((e) => (e.type === "ToolStarted" ? `${e.type} ${e.name}` : e.type))).toEqual([
			"BrainStarted",
			"TurnSettled",
			"ToolStarted Read",
			"ToolStarted Grep",
			"ToolSettled",
			"ToolFailed",
			"BrainStarted",
			"TurnSettled",
			"ToolStarted Read",
			"ToolStarted Glob",
			"ToolSettled",
			"ToolSettled",
			"BrainStarted",
			"TurnSettled",
			"RunDone",
		]);
		// A model turn runs from when it was asked (the run's start, or the last tool result) to its answer.
		const started = events.filter((e) => e.type === "BrainStarted").map((e) => e.at);
		expect(started).toEqual([1000, 1003, 1006]);
		expect(JSON.stringify(events)).not.toContain(SECRET);
	});
});

describe("the live reviewer, traced", () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
	});

	it("draws its SDK run as an agent span with its turns and tool calls, under the review's span", async () => {
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
		await Effect.runPromise(
			Effect.gen(function* () {
				const reviewer = yield* Reviewer;
				yield* Stream.runDrain(
					reviewer.review(briefOf({...WHOLE, head}), {model: "opus", effort: "medium", budget: 2}),
				).pipe(Effect.withSpan("sub review_run"));
			}).pipe(
				Effect.withSpan("machine review"),
				Effect.provide(liveReviewer({repo, open: query.open})),
				Effect.provide(layer),
			),
		);

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
				"chat claude-opus",
				"chat claude-opus",
				"chat claude-opus",
				"execute_tool Glob",
				"execute_tool Grep",
				"execute_tool Read",
				"execute_tool Read",
			].toSorted(),
		);
		const exported = JSON.stringify(spans.map((s) => [s.attributes, s.events]));
		expect(exported).not.toContain(SECRET);
		expect(exported).toContain(KEPT_OUT);
	});
});
