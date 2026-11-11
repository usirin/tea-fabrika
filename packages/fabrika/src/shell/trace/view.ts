import { type Attributes, type HrTime, type SpanContext, type SpanStatus, SpanStatusCode } from "@opentelemetry/api";
import { type Resource, resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, SpanProcessor, TimedEvent } from "@opentelemetry/sdk-trace-base";
import { CONTENT } from "../../host/otlp.ts";
import { ATTR, SERVICE_NAME, traceParentIdOf } from "../../program/trace.ts";

// What a trace viewer is shown: every span as it was made, changed on its way
// out so a person can read the run at a glance. The spans themselves are
// untouched; only what leaves through the exporter is. Four changes:
//
//   service   a span's `service.name` attribute becomes its resource's, so a viewer
//             lists build, review and ship apart, each in its own color
//   status    a span whose `tea.outcome` went wrong, by the host's rule, is an
//             error, with the outcome's name as its message: red
//   root      a line's or a run's made-up parent (../program/trace.ts `traceOf`) is
//             dropped, so the viewer does not look for a span that never comes
//   agent     an agent run's turns and tool calls become events on one span,
//             folded into the span it ran under: `builder · 14 turns`. A run that
//             keeps its content (`tea.agent.content: kept`, a lane's) also shows
//             each of them under that span, so a record keeps what each read and wrote,
//             but only to a job's record, where a person can delete it (`ContentGoes`)
//
// Why fold the agent here and not where its spans are made: the spans stay
// whole for any other reader (an LLM viewer wants every turn as a span), and
// a run of fifty turns is one row instead of fifty in a list of a few dozen.

/** The service a span with none is listed under. */
export const DEFAULT_SERVICE = "tsh";

/**
 * What the host that runs the programs tells the view about its own spans.
 * The view knows no program's words: whoever starts tsh hands them in.
 */
export interface Viewing {
  /** Whether an outcome's name says the run went wrong: its span is drawn red. Left out: none is. */
  readonly wentWrong?: (outcome: string) => boolean;
  /** What a harness writes in place of a value it keeps out of export: an attribute holding it is dropped. */
  readonly keptOut?: string;
  /** The service of a span that names none. `tsh` when left out. */
  readonly fallback?: string;
}

const OP = "gen_ai.operation.name";

/** Milliseconds, from OpenTelemetry's [seconds, nanoseconds]. */
const ms = (t: HrTime): number => t[0] * 1e3 + t[1] / 1e6;

/** A copy of `span` with some of it changed. `parent`: its parent, `undefined` for none. */
const changed = (
  span: ReadableSpan,
  change: Omit<Partial<ReadableSpan>, "parentSpanContext">,
  parent: SpanContext | undefined,
): ReadableSpan => ({
  name: span.name,
  kind: span.kind,
  spanContext: () => span.spanContext(),
  ...(parent === undefined ? {} : { parentSpanContext: parent }),
  startTime: span.startTime,
  endTime: span.endTime,
  status: span.status,
  attributes: span.attributes,
  links: span.links,
  events: span.events,
  duration: span.duration,
  ended: span.ended,
  resource: span.resource,
  instrumentationScope: span.instrumentationScope,
  droppedAttributesCount: span.droppedAttributesCount,
  droppedEventsCount: span.droppedEventsCount,
  droppedLinksCount: span.droppedLinksCount,
  ...change,
});

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** One agent run, folded: its span and what its turns and tool calls add up to. */
interface Folded {
  readonly span: ReadableSpan;
  readonly turns: number;
  readonly tools: ReadonlyMap<string, number>;
  readonly model: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly events: readonly TimedEvent[];
  /** Its turns and tool calls that kept their content: shown too, so a record can keep it. */
  readonly kept: readonly ReadableSpan[];
}

/** An agent run's span and its turns and tool calls, as one. What it read or wrote comes along only in `kept`. */
const fold = (agent: ReadableSpan, parts: readonly ReadableSpan[]): Folded => {
  const tools = new Map<string, number>();
  const events: TimedEvent[] = [];
  let turns = 0;
  let model: string | null = null;
  let [inputTokens, outputTokens, cachedTokens] = [0, 0, 0];

  // Turns are counted from 1 as they started; tea numbers them from 0.
  for (const part of parts.toSorted((a, b) => ms(a.startTime) - ms(b.startTime))) {
    const took = Math.round(ms(part.endTime) - ms(part.startTime));
    const wrong = part.status.code === SpanStatusCode.ERROR ? { failed: true } : {};

    if (part.attributes[OP] === "chat") {
      turns += 1;
      const model_ = part.attributes["gen_ai.request.model"];

      if (typeof model_ === "string") {
        model = model_;
      }

      const input = num(part.attributes["gen_ai.usage.input_tokens"]);
      const output = num(part.attributes["gen_ai.usage.output_tokens"]);
      inputTokens += input;
      outputTokens += output;
      cachedTokens += num(part.attributes["gen_ai.usage.cache_read.input_tokens"]);
      events.push({
        name: `turn ${turns}`,
        time: part.startTime,
        attributes: { duration_ms: took, input_tokens: input, output_tokens: output, ...wrong },
      });
    } else {
      const tool = String(part.attributes["gen_ai.tool.name"] ?? "tool");
      tools.set(tool, (tools.get(tool) ?? 0) + 1);
      events.push({ name: tool, time: part.startTime, attributes: { duration_ms: took, ...wrong } });
    }
  }

  events.sort((a, b) => ms(a.time) - ms(b.time));
  const kept = parts.filter((part) => part.attributes[ATTR.content] === "kept");
  return { span: agent, turns, tools, model, inputTokens, outputTokens, cachedTokens, events, kept };
};

/** What an agent's span says once folded, without anything kept out or meant for an LLM viewer. */
const agentAttributes = (agents: readonly Folded[]): Attributes => {
  const tools = new Map<string, number>();

  for (const agent of agents) {
    for (const [name, n] of agent.tools) {
      tools.set(name, (tools.get(name) ?? 0) + n);
    }
  }

  const sum = (pick: (a: Folded) => number) => agents.reduce((total, a) => total + pick(a), 0);
  const [first] = agents;
  return {
    "gen_ai.agent.name": String(first?.span.attributes["gen_ai.agent.name"] ?? ""),
    ...(first?.model == null ? {} : { "gen_ai.request.model": first.model }),
    "gen_ai.usage.input_tokens": sum((a) => a.inputTokens),
    "gen_ai.usage.output_tokens": sum((a) => a.outputTokens),
    "gen_ai.usage.cache_read.input_tokens": sum((a) => a.cachedTokens),
    "tea.agent.runs": agents.length,
    "tea.agent.turns": sum((a) => a.turns),
    "tea.agent.tools": [...tools]
      .sort(([, a], [, b]) => b - a)
      .map(([name, n]) => `${name} ${n}`)
      .join(", "),
  };
};

/** `· 14 turns`, or `· 2 runs · 20 turns` when the agent was started again. */
const turnsSaid = (agents: readonly Folded[]): string => {
  const turns = agents.reduce((total, a) => total + a.turns, 0);
  const runs = agents.length > 1 ? ` · ${agents.length} runs` : "";
  return `${runs} · ${turns} ${turns === 1 ? "turn" : "turns"}`;
};

/** The worst of the agents' statuses: an agent that failed makes the span it ran under fail. */
const agentStatus = (status: SpanStatus, agents: readonly Folded[]): SpanStatus =>
  status.code !== SpanStatusCode.ERROR && agents.some((a) => a.span.status.code === SpanStatusCode.ERROR)
    ? { code: SpanStatusCode.ERROR, message: "the agent run failed" }
    : status;

/** Attributes without the ones only an LLM viewer reads, and without any value kept out. */
const plain = (attributes: Attributes, keptOut: string | undefined): Attributes =>
  Object.fromEntries(
    Object.entries(attributes).filter(
      ([key, value]) => !key.startsWith("langfuse.") && key !== OP && (keptOut === undefined || value !== keptOut),
    ),
  );

/**
 * What `next` does with an agent run's content. `kept`: it is a store a person can delete content
 * from, as a job's record is (./otel.ts `recordTracing`), so a run that keeps its content sends its
 * turns and tool calls too. `kept_out`: anywhere else, as a collector, where nothing can be
 * deleted, so no content goes out at all.
 */
export type ContentGoes = "kept" | "kept_out";

/** A span's attributes without an agent's content: what a store that keeps none is sent. */
const noContent = (attributes: Attributes): Attributes =>
  Object.fromEntries(Object.entries(attributes).filter(([key]) => key !== CONTENT.input && key !== CONTENT.output));

/**
 * The processor in front of `next` that changes each span on its way out, as
 * the top of this file says, by what the host tells it (`Viewing`). `content`: what `next` does
 * with an agent run's content.
 */
export const view = (next: SpanProcessor, viewing: Viewing = {}, content: ContentGoes = "kept_out"): SpanProcessor => {
  const { wentWrong = () => false, keptOut, fallback = DEFAULT_SERVICE } = viewing;
  const resources = new Map<string, Resource>();
  /** An agent run's turns and tool calls, by its span id, until it ends. */
  const parts = new Map<string, ReadableSpan[]>();
  /** Agent runs that ended, by the span they ran under, until that one ends. */
  const agents = new Map<string, Folded[]>();

  const resourceOf = (base: Resource, service: string): Resource => {
    const found = resources.get(service);

    if (found !== undefined) {
      return found;
    }

    const made = base.merge(resourceFromAttributes({ [SERVICE_NAME]: service }));
    resources.set(service, made);
    return made;
  };

  const shown = (span: ReadableSpan, extra: readonly Folded[] = []): ReadableSpan => {
    const { [SERVICE_NAME]: service, ...rest } = span.attributes;
    const outcome = rest[ATTR.outcome];
    const run = rest[ATTR.run];
    const parent = span.parentSpanContext;
    const madeUp = parent !== undefined && typeof run === "string" && parent.spanId === traceParentIdOf(run);
    const status =
      typeof outcome === "string" && wentWrong(outcome)
        ? { code: SpanStatusCode.ERROR, message: outcome }
        : span.status;
    const own = typeof service === "string" ? service : fallback;
    return changed(
      span,
      {
        resource: resourceOf(span.resource, own),
        status: agentStatus(status, extra),
        ...(extra.length === 0
          ? { attributes: rest }
          : {
              name: `${span.name}${turnsSaid(extra)}`,
              attributes: { ...rest, ...agentAttributes(extra) },
              events: [...span.events, ...extra.flatMap((a) => a.events)].sort((a, b) => ms(a.time) - ms(b.time)),
            }),
      },
      madeUp ? undefined : parent,
    );
  };

  /** An agent run that had nothing left to fold into: shown on its own. */
  const alone = (agent: Folded): ReadableSpan =>
    shown(changed(agent.span, { attributes: plain(agent.span.attributes, keptOut) }, agent.span.parentSpanContext), [
      agent,
    ]);

  /**
   * The turns and tool calls of `agents` that kept their content, each under `under`, the span
   * they were folded into, in its service: a record keeps what they read and wrote by their ids.
   * Only to a store that keeps content: anywhere else, the folded span says all that goes.
   */
  const keptUnder = (under: ReadableSpan, agents: readonly Folded[]) => {
    if (content === "kept_out") {
      return;
    }

    for (const agent of agents) {
      for (const part of agent.kept) {
        next.onEnd(changed(part, { resource: under.resource }, under.spanContext()));
      }
    }
  };

  /** A turn or tool call of a run that never ended, as it was made: its content only if kept. */
  const unfolded = (part: ReadableSpan): ReadableSpan =>
    shown(
      content === "kept" ? part : changed(part, { attributes: noContent(part.attributes) }, part.parentSpanContext),
    );

  return {
    onStart: (span, context) => next.onStart(span, context),
    onEnd: (span) => {
      const id = span.spanContext().spanId;
      const parent = span.parentSpanContext?.spanId;
      const op = span.attributes[OP];

      if ((op === "chat" || op === "execute_tool") && parent !== undefined) {
        parts.set(parent, [...(parts.get(parent) ?? []), span]);
        return;
      }

      if (op === "invoke_agent" && parent !== undefined) {
        const folded = fold(span, parts.get(id) ?? []);
        parts.delete(id);
        agents.set(parent, [...(agents.get(parent) ?? []), folded]);
        return;
      }

      const under = agents.get(id) ?? [];
      agents.delete(id);
      const out = shown(span, under);
      next.onEnd(out);
      keptUnder(out, under);
    },
    forceFlush: () => next.forceFlush(),
    shutdown: () => {
      // What never found the span it would fold into: each agent run on its own, and
      // the turns of a run that never ended as they were made.
      for (const held of agents.values()) {
        for (const agent of held) {
          const out = alone(agent);
          next.onEnd(out);
          keptUnder(out, [agent]);
        }
      }

      for (const held of parts.values()) {
        for (const part of held) {
          next.onEnd(unfolded(part));
        }
      }

      agents.clear();
      parts.clear();
      return next.shutdown();
    },
  };
};
