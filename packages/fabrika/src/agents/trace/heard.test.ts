import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { memoryTracing } from "../../shell/trace/otel.ts";
import { type Heard, NO_LIMITS, type Stop, type Turn } from "../agent/turn.ts";
import { heardTrace } from "./heard.ts";

// One turn on our agent interface, drawn as an agent's spans (./heard.ts): one model call per
// message, one span per tool call, and the run's end with its answer. Each case feeds a made-up
// turn through `heardTrace` with its content kept, and reads the spans it ended.

const Answer = Schema.Struct({ note: Schema.String });
type Answer = typeof Answer.Type;

const turn: Turn<Answer> = {
  provider: "fake",
  session: "plan/7",
  folder: "/nowhere",
  prompt: "Plan ticket 7.",
  system: { _tag: "append", text: "" },
  answer: Answer,
  model: "gpt-6-astra",
  effort: null,
  limits: NO_LIMITS,
};

const tool = (status: "in_progress" | "completed" | "failed", output?: string): Heard<Answer> => ({
  _tag: "tool",
  id: "i1",
  title: "cat a",
  status,
  ...(output === undefined ? {} : { output }),
});

const said = (text: string): Heard<Answer> => ({ _tag: "said", text });

const ended = (stop: Stop, answer: Answer | null): Heard<Answer> => ({
  _tag: "ended",
  stop,
  answer,
  tokens: { input: 5, cached: 0, output: 3 },
  counted: "turn",
  usd: null,
  requests: null,
});

const OUTPUT = "langfuse.observation.output";

/** The agent's spans of one turn, in the order each ended: the step's own span left out. */
const traced = async (heard: readonly Heard<Answer>[]) => {
  const { spans, layer } = memoryTracing({ raw: true });
  await Effect.runPromise(
    Stream.runDrain(heardTrace("plan", turn, Stream.fromIterable(heard), "kept")).pipe(
      Effect.withSpan("lane_step plan"),
      Effect.provide(layer),
    ),
  );
  const kind = (operation: string) =>
    spans
      .filter((s) => s.attributes["gen_ai.operation.name"] === operation)
      .map((s) => ({
        name: s.name,
        status: s.status.code,
        message: s.status.message,
        attributes: s.attributes,
      }));
  return { chats: kind("chat"), tools: kind("execute_tool"), runs: kind("invoke_agent") };
};

describe("a turn heard on our agent interface, as spans", () => {
  it("draws start, a tool in progress then completed, a message and the end as one model call, one tool and one run", async () => {
    const { chats, tools, runs } = await traced([
      tool("in_progress"),
      tool("completed", "1"),
      said("Read a."),
      ended("end_turn", { note: "ok" }),
    ]);
    // Exactly one model call before the first message: the prompt opened it, and the message closed it.
    expect(chats).toHaveLength(1);
    expect(chats[0]?.name).toBe("chat gpt-6-astra");
    expect(chats[0]?.attributes["tea.agent.turn"]).toBe(1);
    expect(chats[0]?.attributes["langfuse.observation.input"]).toBe(JSON.stringify(turn.prompt));
    expect(JSON.parse(String(chats[0]?.attributes[OUTPUT]))).toEqual({
      content: "Read a.",
      toolCalls: [{ callId: "i1", name: "command", args: { title: "cat a" } }],
    });
    // One tool span, not one per update, and it ended ok with what came back.
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("execute_tool command");
    expect(tools[0]?.status).not.toBe(2);
    expect(tools[0]?.attributes[OUTPUT]).toBe(JSON.stringify("1"));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).not.toBe(2);
    expect(JSON.parse(String(runs[0]?.attributes[OUTPUT]))).toEqual({
      content: JSON.stringify({ note: "ok" }),
      toolCalls: [],
    });
  });

  it("keeps one tool span when the maker says completed twice", async () => {
    const { tools } = await traced([
      tool("in_progress"),
      tool("completed", "1"),
      tool("completed", "2"),
      said("Read a."),
      ended("end_turn", { note: "ok" }),
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.attributes[OUTPUT]).toBe(JSON.stringify("1"));
  });

  it("ends a failed tool as failed, with a fixed reason, and what came back only in its output", async () => {
    const { tools } = await traced([
      tool("in_progress"),
      tool("failed", "no such file"),
      said("It is not there."),
      ended("end_turn", { note: "ok" }),
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.status).toBe(2);
    expect(tools[0]?.message).toBe("tool_failed");
    expect(tools[0]?.attributes["error.type"]).toBe("tool_error");
    expect(tools[0]?.attributes["langfuse.observation.status_message"]).toBe("tool_failed");
    // What came back is content: in the output, the one tag a record keeps where a person can delete it.
    expect(JSON.parse(String(tools[0]?.attributes[OUTPUT]))).toMatchObject({
      reason: "tool_failed",
      output: "no such file",
    });
    const { [OUTPUT]: _output, ...rest } = tools[0]?.attributes ?? {};
    expect(JSON.stringify(rest)).not.toContain("no such file");
  });

  it("settles a tool still open at a clean end as ok, with nothing come back", async () => {
    const { tools } = await traced([tool("in_progress"), said("Done."), ended("end_turn", { note: "ok" })]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.status).not.toBe(2);
    expect(tools[0]?.attributes[OUTPUT]).toBe("null");
  });

  it("fails a tool still open, and the run, when the turn stops short", async () => {
    const { chats, tools, runs } = await traced([tool("in_progress"), ended("max_tokens", null)]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.status).toBe(2);
    expect(tools[0]?.attributes["error.type"]).toBe("tool_error");
    // No message came: the model call ends with nothing said.
    expect(chats).toHaveLength(1);
    expect(JSON.parse(String(chats[0]?.attributes[OUTPUT])).content).toBe("");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe(2);
    expect(runs[0]?.attributes["error.type"]).toBe("llm");
    expect(JSON.parse(String(runs[0]?.attributes[OUTPUT]))).toMatchObject({
      reason: "llm",
      error: "max_tokens",
    });
  });

  it("closes the model call at an end with no message, carrying the turn's tokens", async () => {
    const { chats, runs } = await traced([ended("end_turn", { note: "ok" })]);
    expect(chats).toHaveLength(1);
    expect(JSON.parse(String(chats[0]?.attributes[OUTPUT]))).toEqual({ content: "", toolCalls: [] });
    expect(chats[0]?.attributes["gen_ai.usage.input_tokens"]).toBe(5);
    expect(chats[0]?.attributes["gen_ai.usage.output_tokens"]).toBe(3);
    expect(runs).toHaveLength(1);
  });

  it("opens a second model call for a second message", async () => {
    const { chats } = await traced([said("x"), said("y"), ended("end_turn", { note: "ok" })]);
    expect(chats.map((c) => c.attributes["tea.agent.turn"])).toEqual([1, 2]);
    expect(chats.map((c) => JSON.parse(String(c.attributes[OUTPUT])).content)).toEqual(["x", "y"]);
  });

  it("keeps an answer that did not fit as null, not the text `null`", async () => {
    const { runs } = await traced([said("x"), ended("end_turn", null)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.attributes[OUTPUT]).toBe("null");
  });
});
