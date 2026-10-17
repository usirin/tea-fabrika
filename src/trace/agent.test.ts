import {defineAgent, tool} from "@demlik/tea/agent";
import type {ReadableSpan} from "@opentelemetry/sdk-trace-base";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {z} from "zod";
import {agentTrace, KEPT_OUT} from "./agent.ts";
import {memoryTracing} from "./otel.ts";

// The open risk of tracing here: Effect's spans and tea's agent spans, which
// tea writes with the raw OpenTelemetry tracer, in one trace, the agent's
// under the Effect span that ran it. Proved on tea's own agent runtime, with a
// scripted model: one turn that calls a tool, then an answer.

const lookUp = tool(
	"look_up",
	{
		description: "Look a word up.",
		input: z.object({word: z.string()}),
		ok: z.object({meaning: z.string()}),
		err: [],
	},
	async ({word}, _ctx, {ok}) => ok({meaning: `the meaning of ${word}`}),
);

/** A model that asks for the tool once, then answers. */
const scripted = () => {
	let turn = 0;
	return async () => {
		turn += 1;
		return turn === 1
			? {content: "Let me look.", toolCalls: [{callId: "c1", name: "look_up", args: {word: "tea"}}]}
			: {content: "A secret answer.", toolCalls: []};
	};
};

const parentOf = (span: ReadableSpan) => span.parentSpanContext?.spanId;

describe("the agent bridge", () => {
	it("puts tea's agent spans under the Effect span that ran the agent, in its trace", async () => {
		const {spans, layer} = memoryTracing();
		await Effect.runPromise(
			Effect.gen(function* () {
				const trace = yield* agentTrace("reviewer");
				if (trace === null) return yield* Effect.die("no agent trace with tracing on");
				const agent = defineAgent({model: scripted(), tools: [lookUp], instructions: "Answer."});
				yield* Effect.tryPromise({
					try: () => agent.run("a secret question", {onEvent: trace.onEvent}),
					catch: () => ({_tag: "agent_failed" as const}),
				});
				trace.end();
			}).pipe(
				Effect.withSpan("sub review_run"),
				Effect.withSpan("machine review"),
				Effect.provide(layer),
			),
		);
		const byName = (name: string) => spans.filter((s) => s.name === name);
		const [sub] = byName("sub review_run");
		const [machine] = byName("machine review");
		const [agent] = byName("invoke_agent reviewer");
		const chats = byName("chat");
		const [tool] = byName("execute_tool look_up");
		if (sub === undefined || machine === undefined || agent === undefined || tool === undefined)
			throw new Error(`missing spans: ${spans.map((s) => s.name).join(", ")}`);

		// One trace, and the tree: machine > sub > agent > (chat, tool, chat).
		expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);
		expect(parentOf(sub)).toBe(machine.spanContext().spanId);
		expect(parentOf(agent)).toBe(sub.spanContext().spanId);
		expect(chats).toHaveLength(2);
		for (const child of [...chats, tool]) expect(parentOf(child)).toBe(agent.spanContext().spanId);
		expect(tool.attributes["gen_ai.tool.name"]).toBe("look_up");

		// Nothing the agent read or wrote is exported: the masks replace it.
		const everything = JSON.stringify(spans.map((s) => s.attributes));
		expect(everything).not.toContain("secret");
		expect(everything).not.toContain("the meaning of");
		expect(agent.attributes["langfuse.observation.output"]).toBe(KEPT_OUT);
	});

	it("is null when nothing traces: no tracer, nothing built", async () => {
		const trace = await Effect.runPromise(agentTrace("reviewer").pipe(Effect.withSpan("machine")));
		expect(trace).toBeNull();
	});
});
