import {ROOT_CONTEXT, type Span, SpanStatusCode, type Tracer, trace} from "@opentelemetry/api";
import {resourceFromAttributes} from "@opentelemetry/resources";
import {
	BasicTracerProvider,
	type ReadableSpan,
	SimpleSpanProcessor,
	type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {describe, expect, it} from "vitest";
import {traceParentIdOf} from "../../program/trace.ts";
import {view} from "./view.ts";

// The view, on spans made by hand with the raw OpenTelemetry tracer: what a
// viewer is sent for each kind of span.

/** What a harness writes for a value it keeps out of export. The host names it; this one is made up. */
const KEPT_OUT = "[kept out]";

/** A host's rule for an outcome that went wrong: here the five verbs' (stuck, ask, sent back to the builder). */
const wentWrong = (outcome: string): boolean => {
	const [verb, who] = outcome.split(":");
	return verb === "stuck" || verb === "ask" || (verb === "send" && who === "builder");
};

/**
 * A tracer whose spans go through the view into `spans`; `shutdown` ends it. `content`: what the
 * store behind the view does with an agent run's content, `kept_out` as a collector's, by default.
 */
const viewed = (content: "kept" | "kept_out" = "kept_out") => {
	const spans: ReadableSpan[] = [];
	const keeping: SpanExporter = {
		export: (batch, done) => {
			spans.push(...batch);
			done({code: 0});
		},
		shutdown: () => Promise.resolve(),
	};
	const provider = new BasicTracerProvider({
		resource: resourceFromAttributes({"service.name": "tsh", "host.arch": "test"}),
		spanProcessors: [
			view(new SimpleSpanProcessor(keeping), {wentWrong, keptOut: KEPT_OUT}, content),
		],
	});
	return {spans, tracer: provider.getTracer("test"), shutdown: () => provider.shutdown()};
};

const under = (parent: Span) => trace.setSpan(ROOT_CONTEXT, parent);

const named = (spans: readonly ReadableSpan[], name: string) => {
	const found = spans.find((s) => s.name === name);

	if (found === undefined) {
		throw new Error(`no ${name} in ${spans.map((s) => s.name).join(", ")}`);
	}

	return found;
};

/** What a kept run's turn read and its tool call gave back: made up. */
const SAID = "the words in the file the agent read";

/**
 * One agent run with a turn and a tool call, under `parent`. `kept`: its turn and tool call keep
 * their content, as a lane's do (`tea.agent.content: kept`). `ends`: the run's own span ends.
 */
const agentRun = (
	tracer: Tracer,
	parent: Span,
	{failed = false, kept = false, ends = true} = {},
) => {
	const content = kept ? {"tea.agent.content": "kept"} : {};
	const agent = tracer.startSpan(
		"invoke_agent builder",
		{
			attributes: {
				"gen_ai.operation.name": "invoke_agent",
				"gen_ai.agent.name": "builder",
				"langfuse.observation.output": KEPT_OUT,
			},
		},
		under(parent),
	);
	const turn = tracer.startSpan(
		"chat claude-opus",
		{
			attributes: {
				"gen_ai.operation.name": "chat",
				"gen_ai.request.model": "claude-opus",
				"tea.agent.turn": 0,
				"langfuse.observation.input": kept ? SAID : KEPT_OUT,
				...content,
			},
		},
		under(agent),
	);
	turn.setAttributes({"gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 20});
	turn.end();
	const tool = tracer.startSpan(
		"execute_tool Bash",
		{
			attributes: {
				"gen_ai.operation.name": "execute_tool",
				"gen_ai.tool.name": "Bash",
				"langfuse.observation.output": kept ? SAID : KEPT_OUT,
				...content,
			},
		},
		under(agent),
	);
	tool.end();

	if (failed) {
		agent.setStatus({code: SpanStatusCode.ERROR, message: "run failed: broke"});
	}

	if (ends) {
		agent.end();
	}
};

describe("the view", () => {
	it("lists each span under its own service, one resource per service, the rest of the resource kept", async () => {
		const {spans, tracer, shutdown} = viewed();

		for (const service of ["build", "review", "build"]) {
			tracer.startSpan(service, {attributes: {"service.name": service}}).end();
		}

		tracer.startSpan("none").end();
		await shutdown();
		expect(spans.map((s) => s.resource.attributes["service.name"])).toEqual([
			"build",
			"review",
			"build",
			"tsh",
		]);
		expect(spans[0]?.resource).toBe(spans[2]?.resource);
		expect(spans[0]?.resource.attributes["host.arch"]).toBe("test");
		expect(spans.filter((s) => s.attributes["service.name"] !== undefined)).toEqual([]);
	});

	it("draws a span red when its outcome went wrong, and only then", async () => {
		const {spans, tracer, shutdown} = viewed();
		const outcomes = [
			"stuck:read_failed",
			"ask:owner:rounds",
			"send:builder:checks_red",
			"send:reviewer:no_review",
			"done",
			"done:part",
			"skip:draft",
		];

		for (const outcome of outcomes) {
			tracer.startSpan(outcome, {attributes: {"tea.outcome": outcome}}).end();
		}

		await shutdown();
		expect(spans.map((s) => [s.name, s.status])).toEqual([
			["stuck:read_failed", {code: SpanStatusCode.ERROR, message: "stuck:read_failed"}],
			["ask:owner:rounds", {code: SpanStatusCode.ERROR, message: "ask:owner:rounds"}],
			["send:builder:checks_red", {code: SpanStatusCode.ERROR, message: "send:builder:checks_red"}],
			["send:reviewer:no_review", {code: SpanStatusCode.UNSET}],
			["done", {code: SpanStatusCode.UNSET}],
			["done:part", {code: SpanStatusCode.UNSET}],
			["skip:draft", {code: SpanStatusCode.UNSET}],
		]);
	});

	it("drops the made-up parent a trace is named by, and keeps every real parent", async () => {
		const {spans, tracer, shutdown} = viewed();
		const madeUp = trace.setSpanContext(ROOT_CONTEXT, {
			traceId: `${"0".repeat(31)}1`,
			spanId: traceParentIdOf("run-1"),
			traceFlags: 1,
			isRemote: true,
		});
		const root = tracer.startSpan("line", {attributes: {"tea.run.id": "run-1"}}, madeUp);
		// Another run's id: its parent is not this one's made-up parent, so it stays.
		const other = tracer.startSpan("other", {attributes: {"tea.run.id": "run-2"}}, madeUp);
		const child = tracer.startSpan("run", {attributes: {"tea.run.id": "run-1"}}, under(root));

		for (const span of [child, other, root]) {
			span.end();
		}

		await shutdown();
		expect(named(spans, "line").parentSpanContext).toBeUndefined();
		expect(named(spans, "other").parentSpanContext?.spanId).toBe(traceParentIdOf("run-1"));
		expect(named(spans, "run").parentSpanContext?.spanId).toBe(root.spanContext().spanId);
	});

	it("folds an agent run into the span it ran under: one row, its turns and tools as events", async () => {
		const {spans, tracer, shutdown} = viewed();
		const sub = tracer.startSpan("builder", {attributes: {"service.name": "build"}});
		agentRun(tracer, sub);
		agentRun(tracer, sub);
		sub.end();
		await shutdown();
		expect(spans.map((s) => s.name)).toEqual(["builder · 2 runs · 2 turns"]);
		const [one] = spans;
		expect(one?.events.map((e) => e.name)).toEqual(["turn 1", "Bash", "turn 1", "Bash"]);
		expect(one?.attributes).toMatchObject({
			"gen_ai.agent.name": "builder",
			"gen_ai.request.model": "claude-opus",
			"gen_ai.usage.input_tokens": 200,
			"gen_ai.usage.output_tokens": 40,
			"tea.agent.runs": 2,
			"tea.agent.turns": 2,
			"tea.agent.tools": "Bash 2",
		});
		expect(one?.resource.attributes["service.name"]).toBe("build");
		expect(JSON.stringify(spans.map((s) => [s.attributes, s.events]))).not.toContain(KEPT_OUT);
	});

	it("draws the span an agent ran under red when the agent failed", async () => {
		const {spans, tracer, shutdown} = viewed();
		const sub = tracer.startSpan("reviewer");
		agentRun(tracer, sub, {failed: true});
		sub.end();
		await shutdown();
		expect(named(spans, "reviewer · 1 turn").status).toEqual({
			code: SpanStatusCode.ERROR,
			message: "the agent run failed",
		});
	});

	// Kept content goes only where a person can delete it: a job's record, never a collector.
	it.each([
		{run: "kept", store: "kept", sent: true},
		{run: "kept", store: "kept_out", sent: false},
		{run: "kept out", store: "kept", sent: false},
		{run: "kept out", store: "kept_out", sent: false},
	] as const)(
		"sends a $run agent run on its own at the end when the span it ran under ended first, its parts sent: $sent ($store store)",
		async ({run, store, sent}) => {
			const {spans, tracer, shutdown} = viewed(store);
			const sub = tracer.startSpan("reviewer");
			sub.end();
			agentRun(tracer, sub, {kept: run === "kept"});
			expect(spans.map((s) => s.name)).toEqual(["reviewer"]);
			await shutdown();
			const alone = named(spans, "invoke_agent builder · 1 turn");
			expect(alone.parentSpanContext?.spanId).toBe(sub.spanContext().spanId);
			expect(alone.attributes["langfuse.observation.output"]).toBeUndefined();

			if (sent) {
				for (const part of ["chat claude-opus", "execute_tool Bash"]) {
					expect(named(spans, part).parentSpanContext?.spanId).toBe(alone.spanContext().spanId);
				}
			} else {
				expect(spans.map((s) => s.name)).toEqual(["reviewer", "invoke_agent builder · 1 turn"]);
				expect(JSON.stringify(spans.map((s) => s.attributes))).not.toContain(SAID);
			}
		},
	);

	it.each([
		{store: "kept", sent: true},
		{store: "kept_out", sent: false},
	] as const)(
		"sends a kept run's parts beside the span it folds into only to a store that keeps content ($store)",
		async ({store, sent}) => {
			const {spans, tracer, shutdown} = viewed(store);
			const sub = tracer.startSpan("builder");
			agentRun(tracer, sub, {kept: true});
			sub.end();
			await shutdown();
			const names = spans.map((s) => s.name);
			expect(names).toEqual(
				sent ? ["builder · 1 turn", "chat claude-opus", "execute_tool Bash"] : ["builder · 1 turn"],
			);
			expect(JSON.stringify(spans.map((s) => s.attributes)).includes(SAID)).toBe(sent);
		},
	);

	it("sends the turns of a kept run that never ended without their content to a collector", async () => {
		const {spans, tracer, shutdown} = viewed("kept_out");
		const sub = tracer.startSpan("builder");
		agentRun(tracer, sub, {kept: true, ends: false});
		sub.end();
		await shutdown();
		expect(spans.map((s) => s.name)).toEqual(["builder", "chat claude-opus", "execute_tool Bash"]);
		expect(JSON.stringify(spans.map((s) => s.attributes))).not.toContain(SAID);
	});
});
