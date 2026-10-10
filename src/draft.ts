import { type Options, type SDKMessage, query } from "@anthropic-ai/claude-agent-sdk";
import type { DepKeyedSub, Sub } from "@demlik/tea";
import { Effect, Queue, Stream } from "effect";
import { z } from "zod";

// Draft: an agent produces something. Run as a Sub over the Agent SDK's
// message stream, as experiment 43 found it has to be: a Cmd holds the fold
// until it settles, so nothing could be judged, timed or stopped while the
// agent works. The parent says what it wants as data (the prompt, the agent,
// the conversation, picked before the run starts) for as long as it wants it;
// leaving the phase turns the Sub off, and the engine closes the runner, which
// interrupts the agent. The answer is typed by a schema, and an answer that
// does not fit it comes back as `null`, never as text the machine reads.

/** One agent run, as the parent asks for it. Plain data: it is the Sub's deps. */
export interface DraftRun {
  /** The child of the parent this run belongs to. Every Msg carries it back. */
  readonly key: string;
  /** This run, so a late Msg from an earlier one is told apart. */
  readonly id: string;
  readonly prompt: string;
  /** The conversation, named before the run starts. `continues`: one the agent already had. */
  readonly session: { readonly id: string; readonly continues: boolean };
  /** A named agent to run as (its prompt, tools and model), or `null` for a plain session. */
  readonly agent: string | null;
  /** The folder it works in, by the name the host gave it; the runner turns it into a path. `null`: the host's own. */
  readonly folder: string | null;
}

/** What a run cost, from the SDK's result. */
export interface Spend {
  readonly costUsd: number;
  readonly tokens: number;
  readonly turns: number;
  readonly minutes: number;
}

export const noSpend: Spend = { costUsd: 0, tokens: 0, turns: 0, minutes: 0 };

/** The agent asked for a tool. Progress only: a parent may count it, or judge it as watch.ts does. */
export interface DraftTool<N extends string> {
  readonly type: `${N}_tool`;
  readonly key: string;
  readonly id: string;
  readonly tool: string;
}

/** The agent ended on its own. `output` is `null` when its answer did not fit the schema. */
export interface DraftFinished<N extends string, O> {
  readonly type: `${N}_finished`;
  readonly key: string;
  readonly id: string;
  readonly output: O | null;
  readonly session: string;
  readonly spend: Spend;
}

/** The run broke: the stream failed, or it ended with an error result. */
export interface DraftFailed<N extends string> {
  readonly type: `${N}_failed`;
  readonly key: string;
  readonly id: string;
  readonly error: string;
  readonly spend: Spend;
}

export type DraftMsg<N extends string, O> = DraftTool<N> | DraftFinished<N, O> | DraftFailed<N>;

/** Make one kind of Draft: its Sub, its Msgs, and how SDK messages become them. */
export function createDraft<const N extends string, O>(config: { readonly name: N; readonly output: z.ZodType<O> }) {
  const { name, output } = config;
  const types = { tool: `${name}_tool`, finished: `${name}_finished`, failed: `${name}_failed` } as const;
  type Msg = DraftMsg<N, O>;

  /** The Sub entry: on while `deps` names a run. */
  const sub = <S>(deps: (state: S) => DraftRun | null): DepKeyedSub<S, Sub<N, DraftRun>> =>
    ({ type: name, deps }) as DepKeyedSub<S, Sub<N, DraftRun>>;

  const spendOf = (m: Extract<SDKMessage, { type: "result" }>): Spend => ({
    costUsd: m.total_cost_usd,
    tokens:
      m.usage.input_tokens +
      m.usage.output_tokens +
      (m.usage.cache_creation_input_tokens ?? 0) +
      (m.usage.cache_read_input_tokens ?? 0),
    turns: m.num_turns,
    minutes: m.duration_ms / 60_000,
  });

  /** The Msgs one SDK message carries. Only the top conversation's tool calls count as progress. */
  function msgsOf(message: SDKMessage, run: DraftRun): Msg[] {
    const { key, id } = run;
    if (message.type === "assistant" && message.parent_tool_use_id === null) {
      return message.message.content.flatMap((block) =>
        block.type === "tool_use" ? [{ type: types.tool, key, id, tool: block.name } as Msg] : [],
      );
    }
    if (message.type !== "result") return [];
    const spend = spendOf(message);
    if (message.subtype !== "success" || message.is_error) {
      return [{ type: types.failed, key, id, error: `${message.subtype}${message.is_error ? " (error)" : ""}`, spend } as Msg];
    }
    const parsed = output.safeParse(message.structured_output);
    return [
      {
        type: types.finished,
        key,
        id,
        output: parsed.success ? parsed.data : null,
        session: message.session_id,
        spend,
      } as Msg,
    ];
  }

  /** The answer's shape as JSON Schema, for the SDK's `outputFormat`. */
  const schema = z.toJSONSchema(output) as Record<string, unknown>;

  /** Which of the three a Msg is. A template-literal type does not narrow on a generic name, so these do. */
  const is = {
    tool: (m: Msg): m is DraftTool<N> => m.type === types.tool,
    finished: (m: Msg): m is DraftFinished<N, O> => m.type === types.finished,
    failed: (m: Msg): m is DraftFailed<N> => m.type === types.failed,
  };

  return { name, types, is, sub, msgsOf, schema, output };
}

export type Draft<N extends string, O> = ReturnType<typeof createDraft<N, O>>;

/**
 * The live runner, on the Effect engine: open a query for the run, feed every
 * SDK message to the machine as Msgs, and interrupt the query when the Sub
 * closes (the machine left the phase). `options` adds what the use needs: the
 * folder, plugins, tools, budget. A new conversation is opened under the id
 * the parent picked; a continued one is resumed.
 */
export const sdkRunner =
  <N extends string, O>(draft: Draft<N, O>, options: (run: DraftRun) => Options) =>
  (sub: Sub<N, DraftRun>) =>
    Stream.callback<DraftMsg<N, O>>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const run = sub.deps;
          const q = query({
            prompt: run.prompt,
            options: {
              ...options(run),
              ...(run.agent === null ? {} : { agent: run.agent }),
              ...(run.session.continues ? { resume: run.session.id } : { sessionId: run.session.id }),
              outputFormat: { type: "json_schema", schema: draft.schema },
            },
          });
          const live = { on: true, result: false };
          const loop = (async () => {
            try {
              for await (const m of q) {
                if (m.type === "result") live.result = true;
                if (live.on) for (const msg of draft.msgsOf(m, run)) Queue.offerUnsafe(queue, msg);
              }
              if (live.on && !live.result) {
                Queue.offerUnsafe(queue, {
                  type: draft.types.failed,
                  key: run.key,
                  id: run.id,
                  error: "the stream ended with no result",
                  spend: noSpend,
                } as DraftMsg<N, O>);
              }
            } catch (error) {
              // The SDK throws after an error result it already sent; only a throw before one is news.
              if (live.on && !live.result) {
                Queue.offerUnsafe(queue, {
                  type: draft.types.failed,
                  key: run.key,
                  id: run.id,
                  error: String(error),
                  spend: noSpend,
                } as DraftMsg<N, O>);
              }
            }
          })();
          return { q, live, loop };
        }),
        ({ q, live, loop }) =>
          Effect.promise(async () => {
            live.on = false;
            if (!live.result) {
              await Promise.race([q.interrupt().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
              await Promise.race([loop, new Promise((r) => setTimeout(r, 30_000))]);
            }
            q.close();
          }),
      ),
    );
