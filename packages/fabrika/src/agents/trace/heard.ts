import type { AgentEvent, ToolCall, ToolFailure } from "@demlik/tea/agent";
import { Clock, Effect, Stream } from "effect";
import type { Heard, Turn } from "../agent/turn.ts";
import { agentTrace, type ContentIs } from "./agent.ts";

// One turn on our agent interface (`Agents.run`, ../agent/turn.ts) as tea's agent events, for
// `agentSpans`: whatever maker ran it, Codex, Claude or an ACP agent. The prompt opens the first
// model call, each whole message the agent says closes one, and each tool call is a span of its
// own, with what came back where the maker says it.
//
//   start(at, "gpt-6-astra", "Plan ticket 7.")   BrainStarted 1, its input the prompt
//   seen({_tag: "tool", id: "i1", title: "cat a", status: "in_progress"})   ToolStarted i1 command
//   seen({_tag: "tool", id: "i1", ..., status: "completed", output: "1"})   ToolSettled i1 "1"
//   seen({_tag: "said", text: "Read a."})        TurnSettled, its output the message
//   seen({_tag: "ended", stop: "end_turn", ...}) RunDone done, its output the answer
//
// The interface does not say when the model is asked again inside a turn, so a model call here is
// the stretch from one message to the next. What the spans keep of the words is the caller's
// choice (`agentTrace`'s `content`).

/** A failed tool's reason: the same word for every failure, so no tool's words reach it. */
const TOOL_FAILED = "tool_failed";

/** A tool's title that reads as a tool's name, as Claude's `Read`; any other is a command line. */
const NAME = /^[A-Za-z_][\w.-]{0,63}$/;

/** The events of one turn, for the agent run `runId`. */
const heardEvents = (runId: string) => {
  const head = (at: number) => ({ runId, at });
  const names = new Map<string, string>();
  const open = new Set<string>();
  let calls: ToolCall[] = [];
  let turn = 1;
  let thinking = true;

  /** A model call open from here, if none is: the stretch to the next message. */
  const think = (at: number): AgentEvent<string | null>[] => {
    if (thinking) {
      return [];
    }

    turn += 1;
    return [{ ...head(at), type: "BrainStarted", turn, purpose: "turn", model: null, payload: null }];
  };

  const settle = (id: string, failed: boolean, output: string | null, at: number): AgentEvent<string | null>[] => {
    if (!open.has(id)) {
      return [];
    }

    open.delete(id);

    if (!failed) {
      return [{ ...head(at), type: "ToolSettled", callId: id, result: output }];
    }

    // tea writes a failure's `reason` as the span's status message, which a record keeps forever
    // on the span. So the reason is a fixed word, and what came back rides beside it, in the output
    // a record keeps apart, where a person can delete it.
    const failure: ToolFailure & { readonly output: string | null } = {
      kind: "error",
      reason: TOOL_FAILED,
      _tag: "tool_error",
      output,
    };
    return [{ ...head(at), type: "ToolFailed", callId: id, name: names.get(id) ?? "tool", failure }];
  };

  const seen = <A>(heard: Heard<A>, at: number): AgentEvent<string | null>[] => {
    switch (heard._tag) {
      case "said": {
        const said: AgentEvent<string | null> = {
          ...head(at),
          type: "TurnSettled",
          turn: { content: heard.text, toolCalls: calls },
        };
        calls = [];
        const before = think(at);
        thinking = false;
        return [...before, said];
      }
      case "tool": {
        const started: AgentEvent<string | null>[] = [];

        if (!names.has(heard.id)) {
          const name = NAME.test(heard.title) ? heard.title : "command";
          const args = { title: heard.title };
          names.set(heard.id, name);
          open.add(heard.id);
          calls.push({ callId: heard.id, name, args });
          started.push({ ...head(at), type: "ToolStarted", callId: heard.id, name, args });
        }

        const done = heard.status === "completed" || heard.status === "failed";
        return [...started, ...(done ? settle(heard.id, heard.status === "failed", heard.output ?? null, at) : [])];
      }
      case "ended": {
        const left = [...open].flatMap((id) => settle(id, heard.stop !== "end_turn", null, at));
        const usage = { inputTokens: heard.tokens.input, outputTokens: heard.tokens.output };
        const last: AgentEvent<string | null>[] = thinking
          ? [{ ...head(at), type: "TurnSettled", turn: { content: "", toolCalls: calls }, usage }]
          : [];
        thinking = false;
        const status =
          heard.stop === "end_turn"
            ? {
                kind: "done" as const,
                // The typed answer, as JSON: what the run handed back, read from its last message.
                output: heard.answer === null ? null : { content: JSON.stringify(heard.answer), toolCalls: [] },
                usage,
              }
            : { kind: "failed" as const, failure: { reason: "llm" as const, error: heard.stop, at } };
        return [...left, ...last, { ...head(at), type: "RunDone", status }];
      }
      default:
        return [];
    }
  };

  return {
    /** The run's first model call, given the prompt. */
    start: (at: number, model: string | null, prompt: string): AgentEvent<string | null>[] => [
      { ...head(at), type: "BrainStarted", turn, purpose: "turn", model, payload: prompt },
    ],
    seen,
  };
};

/**
 * `run`, the stream of one turn, drawn as an agent's spans under the Effect span current here,
 * named `name`: the same stream, its spans a side effect. A turn that stops or breaks before its
 * end has its spans ended where it stopped. Nothing traces: `run` as it was.
 */
export const heardTrace = <A, E, R>(
  name: string,
  turn: Turn<A>,
  run: Stream.Stream<Heard<A>, E, R>,
  content: ContentIs = "kept_out",
): Stream.Stream<Heard<A>, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const spans = yield* agentTrace<string | null>(name, { content });

      if (spans === null) {
        return run;
      }

      const clock = yield* Clock.Clock;
      const fold = heardEvents(turn.session);
      const draw = (events: readonly AgentEvent<string | null>[]) => {
        for (const event of events) {
          spans.onEvent(event);
        }
      };
      draw(fold.start(clock.currentTimeMillisUnsafe(), turn.model, turn.prompt));
      return run.pipe(
        Stream.tap((heard) => Effect.sync(() => draw(fold.seen(heard, clock.currentTimeMillisUnsafe())))),
        Stream.ensuring(Effect.sync(() => spans.end())),
      );
    }),
  );
