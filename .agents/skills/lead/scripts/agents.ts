// agents.ts: the one way the lead scripts start an agent. Today's lead tooling, run on our own
// laptop; it is not product. A step's agent and the chain's judgment agent both run through
// today's fabrika agents package, `Agent` (`@kampus/fabrika-old`, experiment 156), on its ACP
// adapter: the same harness rows `summon claude as <name>` starts in the app
// (`packages/fabrika/src/agents/acp/harness.ts`), so a box is the harness's own containment
// (Claude's OS sandbox, Codex's permission profile and its own home), unchanged
// (.decisions/0026-fabrika-never-owns-the-agent-loop.md). The agent holds only its model login;
// commits, signing, pushes and rows stay with the caller
// (.decisions/0028-the-parent-holds-every-right.md).
//
//   const agents = yield* makeStepAgents();            // the provider table, once per process
//   const turned = yield* runTurn(agents, {provider: "codex", folder: box, prompt, answer: Answer, ...});
//   // every update as one JSON line in `events`, the last message in `report`, the typed answer back
//
// The provider table: `codex` writes its folder, `codex-read` only reads it (a plan in the main
// checkout, a review), `claude` is Claude Code through ACP. The adapter labels a Codex turn's tokens
// the last request's (`counted: "last"`), but measured turns grow with each request, so they read
// as the turn's total; the row says both until ticket 485 settles it.

import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { Agent } from "@kampus/fabrika-old";
import { acpAdapter, psReaper } from "@kampus/fabrika-old/agents/acp";
import { Effect, FileSystem, Result, Schema, Stream } from "effect";

export const PROVIDERS = ["codex", "codex-read", "claude"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The step's typed answer: the five verbs, as one JSON object at the end of its report. */
export const Answer = Schema.Struct({
  verb: Schema.Literals(["done", "send", "ask", "skip", "stuck"]),
  /** Where a `send` goes; `null` for any other verb. */
  to: Schema.NullOr(Schema.Literals(["tests", "build", "plan"])),
  reason: Schema.String,
  /** A build that needed no commit names the laws it ran green; `null` otherwise. */
  laws: Schema.NullOr(Schema.String),
});
export type Answer = typeof Answer.Type;

/** The judgment agent's answer: send a step again with a note, or park the lane for the lead. */
export const Judgment = Schema.Struct({
  answer: Schema.Literals(["send", "park"]),
  step: Schema.NullOr(Schema.Literals(["tests", "build", "mutation", "review"])),
  note: Schema.String,
});
export type Judgment = typeof Judgment.Type;

/** What one turn spent, for its field row. */
export const Spent = Schema.Struct({
  input: Schema.Number,
  cached: Schema.Number,
  output: Schema.Number,
  /** Where the tokens come from: the maker's turn total, our sum, the last request only, or none. */
  counted: Schema.Literals(["turn", "requests", "last", "none"]),
  /** Dollars where the maker says (Claude's SDK result); `null` elsewhere. */
  usd: Schema.NullOr(Schema.Number),
  requests: Schema.NullOr(Schema.Number),
  /** Tool calls the turn made. */
  tools: Schema.Number,
});
export type Spent = typeof Spent.Type;

export const NO_SPENT: Spent = {
  input: 0,
  cached: 0,
  output: 0,
  counted: "none",
  usd: null,
  requests: null,
  tools: 0,
};

/** A turn the harness could not start, or that broke: its reason, never a thrown error. */
export const Failed = Schema.TaggedStruct("failed", {
  reason: Schema.String,
  message: Schema.String,
  spent: Spent,
});

/** A turn the agent ended, before its typed answer is added. */
export const Ended = Schema.TaggedStruct("ended", {
  stop: Agent.Stop,
  spent: Spent,
  /** The agent's last message: the report. */
  said: Schema.String,
});

/** How one turn ended: the agent's end with its typed answer, or a failure of the harness. */
export type Turned<A> = (typeof Ended.Type & { readonly answer: A | null }) | typeof Failed.Type;

export interface TurnAsk<A> {
  readonly provider: Provider;
  /** Our session id; a second turn under it carries the harness's own session on. */
  readonly session: string;
  readonly folder: string;
  readonly prompt: string;
  /** Appended to the harness's own coding prompt. */
  readonly system: string;
  readonly answer: Agent.Turn<A>["answer"];
  readonly model: string | null;
  readonly effort: string | null;
  readonly minutes: number;
  /** Every update, one JSON line each, with when it arrived. */
  readonly events: string;
  /** The last message, written when the turn ends. */
  readonly report: string;
}

/** The provider table on the ACP rows, the session map and the reaper. One per process. */
export const makeStepAgents = (sessionsDir: string) =>
  Effect.gen(function* () {
    const sessions = yield* Agent.fileSessions(sessionsDir);
    const adapters = {
      codex: yield* acpAdapter({ name: "codex", access: "write" }),
      "codex-read": yield* acpAdapter({ name: "codex", access: "read" }),
      claude: yield* acpAdapter("claude"),
    };
    return Agent.makeAgents({ adapters, sessions, reaper: psReaper });
  }).pipe(Effect.provide(nodeServices));

/** Tokens into a `Spent`, adding this update's tool call when it is one. */
const spending = (spent: Spent, heard: Agent.Heard<unknown>): Spent => {
  switch (heard._tag) {
    case "tool":
      return heard.status === "pending" || heard.status === "in_progress"
        ? { ...spent, tools: spent.tools + 1 }
        : spent;
    case "tokens":
      return { ...spent, ...heard.tokens };
    case "ended":
      return {
        ...spent,
        ...heard.tokens,
        counted: heard.counted,
        usd: heard.usd,
        requests: heard.requests,
      };
    default:
      return spent;
  }
};

/**
 * One turn, run to its end: each update appended to `events` as it arrives, the last message
 * written to `report`, and the typed answer handed back. A harness that will not start or breaks
 * is a `failed` turn, never a thrown error. The clock is the interface's own (`limits.seconds`),
 * so running out ends the turn `over_time` and the agent's commands are reaped with it.
 */
export const runTurn = <A>(agents: typeof Agent.Agents.Service, ask: TurnAsk<A>): Effect.Effect<Turned<A>> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const state = { said: "", spent: NO_SPENT, ended: null as Agent.Ended<A> | null };
    const append = (line: unknown) =>
      fs.writeFileString(ask.events, `${JSON.stringify(line)}\n`, { flag: "a" }).pipe(Effect.ignore);
    const turn: Agent.Turn<A> = {
      provider: ask.provider,
      session: ask.session,
      folder: ask.folder,
      prompt: ask.prompt,
      // The append case: the harness's own coding prompt, then ours.
      system: Agent.SystemPrompt.members[0].make({ text: ask.system }),
      answer: ask.answer,
      model: ask.model,
      effort: ask.effort,
      limits: { usd: null, tools: null, seconds: ask.minutes * 60 },
    };
    const ran = yield* agents.run(turn).pipe(
      Stream.runForEach((heard) =>
        Effect.gen(function* () {
          yield* append({ at: new Date().toISOString(), ...heard });

          if (heard._tag === "said") {
            state.said = heard.text;
          }

          if (heard._tag === "ended") {
            state.ended = heard;
          }

          state.spent = spending(state.spent, heard);
        }),
      ),
      Effect.scoped,
      Effect.result,
    );
    yield* fs.writeFileString(ask.report, state.said).pipe(Effect.ignore);
    const failed = (reason: string, message: string) => Failed.make({ reason, message, spent: state.spent });

    if (Result.isFailure(ran)) {
      const e = ran.failure;
      yield* append({ at: new Date().toISOString(), ...failed(e.why, e.message) });
      return failed(e.why, e.message);
    }

    const ended = state.ended;

    if (ended === null) {
      return failed("broke", "the stream ended with no end");
    }

    return {
      ...Ended.make({ stop: ended.stop, spent: state.spent, said: state.said }),
      answer: ended.answer,
    };
  }).pipe(Effect.provide(nodeServices));

// ---------------------------------------------------------------- the field row

/**
 * Dollars per million tokens (in, cached, out), standard tier, from OpenAI's pricing page
 * (https://developers.openai.com/api/docs/pricing), read 2026-11-09: the same table as
 * `fieldrow.py` and `packages/pipeline/src/stages/price.ts`. A model not here gets no dollars.
 */
const CODEX_LIST: Readonly<Record<string, readonly [number, number, number]>> = {
  "gpt-6.1-sol": [2, 0.1, 10],
  "gpt-6-astra": [10, 1, 50],
};

export interface RowAsk {
  readonly run: string;
  readonly ticket: string;
  readonly step: string;
  readonly provider: Provider;
  readonly model: string;
  readonly effort: string | null;
  /** The field row's outcome word: pass, fail, parked, skip, stopped. */
  readonly outcome: string;
  readonly reason: string;
  readonly started: Date;
  readonly ended: Date;
  readonly spent: Spent;
  /** Lines `redact.sh` scrubbed from the saved files, when it ran. */
  readonly redacted: number | null;
}

/** The turn's list-price dollars: Claude's SDK says its own; a Codex row is priced by the table. */
export const listUsd = (provider: Provider, model: string, spent: Spent): number | null => {
  if (provider === "claude") {
    return spent.usd;
  }

  const rate = CODEX_LIST[model];

  if (rate === undefined || spent.counted === "none") {
    return null;
  }

  const [input, cached, output] = rate;
  return (
    Math.round((((spent.input - spent.cached) * input + spent.cached * cached + spent.output * output) / 1e6) * 1e4) /
    1e4
  );
};

/**
 * A step's row as `field/runs.jsonl` saves it (field/README.md). The saved key for the reason is
 * `why`: the field rows are today's shape, so the name changes only where the row is written.
 */
const FieldRow = Schema.Struct({
  date: Schema.String,
  run: Schema.String,
  ticket: Schema.String,
  pr: Schema.Null,
  started: Schema.String,
  ended: Schema.String,
  parent: Schema.Null,
  active: Schema.Null,
  role: Schema.Literal("hand"),
  model: Schema.String,
  effort: Schema.NullOr(Schema.String),
  outcome: Schema.String,
  reason: Schema.String,
  tokens: Schema.Null,
  tools: Schema.Number,
  minutes: Schema.Number,
  note: Schema.Null,
  costUsd: Schema.Null,
  listUsd: Schema.NullOr(Schema.Number),
  billed: Schema.NullOr(Schema.Number),
  inputTokens: Schema.NullOr(Schema.Number),
  cachedTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  step: Schema.String,
  billing: Schema.optionalKey(Schema.Literal("subscription")),
  redacted: Schema.optionalKey(Schema.Number),
}).pipe(Schema.encodeKeys({ reason: "why" }));

const encodeRow = Schema.encodeSync(Schema.fromJsonString(FieldRow));

/** One `field/runs.jsonl` row for a turn, in the shape `fieldrow.py` and `clauderow.py` write. */
export const stepRow = (r: RowAsk): string => {
  const local = (d: Date) => {
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
    const shifted = new Date(d.getTime() + offset * 60_000).toISOString().slice(0, 19);
    return `${shifted}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  };
  const usd = listUsd(r.provider, r.model, r.spent);
  const priced =
    r.provider === "claude"
      ? " Dollars are the Agent SDK's own total_cost_usd for the turn, at Anthropic's list price; the subscription bills no call."
      : usd === null
        ? ""
        : ` Dollars are ${r.model}'s standard list price (fieldrow.py's table); the plan bills no call.`;
  const counted =
    r.spent.counted === "last"
      ? " Tokens are what ACP's PromptResponse.usage gave. The adapter labels them the last request's, but five measured turns grew 25,000 to 28,000 a request, so they read as the turn's total (ticket 485)."
      : "";
  const measured = r.spent.counted !== "none";
  return `${encodeRow({
    date: local(r.started).slice(0, 10),
    run: r.run,
    ticket: r.ticket,
    pr: null,
    started: local(r.started),
    ended: local(r.ended),
    parent: null,
    active: null,
    role: "hand",
    model: r.model,
    effort: r.effort,
    outcome: r.outcome,
    reason: `${r.reason}${priced}${counted}`,
    tokens: null,
    tools: r.spent.tools,
    minutes: Math.round(((r.ended.getTime() - r.started.getTime()) / 60_000) * 10) / 10,
    note: null,
    costUsd: null,
    listUsd: usd,
    billed: measured ? r.spent.input + r.spent.output : null,
    inputTokens: measured ? r.spent.input : null,
    cachedTokens: measured ? r.spent.cached : null,
    outputTokens: measured ? r.spent.output : null,
    step: r.step,
    ...(r.provider === "claude" ? {} : { billing: "subscription" as const }),
    ...(r.redacted === null ? {} : { redacted: r.redacted }),
  })}\n`;
};

/** The service a step's turn runs on, as `makeStepAgents` gives it. */
export type Agents = typeof Agent.Agents.Service;
