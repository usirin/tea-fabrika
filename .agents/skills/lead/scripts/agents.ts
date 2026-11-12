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
//   const agents = yield* makeStepAgents(sessions, main); // the provider table, once per process
//   const turned = yield* runTurn(agents, {provider: "codex", folder: box, prompt, answer: Answer, ...});
//   // every update as one JSON line in `events`, the last message in `report`, the typed answer back
//
// The provider table: `codex` writes its folder, `codex-read` only reads it (a plan in the main
// checkout, a review), `claude` is Claude Code through ACP. The adapter labels a Codex turn's tokens
// the last request's (`counted: "last"`), but measured turns grow with each request, so they read
// as the turn's total; the row says both until ticket 485 settles it. `codex-exec` and
// `codex-exec-read` run the installed `codex exec` plainly, on the user's own Codex config
// (./codexexec.ts): a turn there retries on a capacity error and asks once more for a missing answer.

import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { Agent } from "@kampus/fabrika-old";
import { ADAPTERS, acpAdapter, psReaper } from "@kampus/fabrika-old/agents/acp";
import { Clock, Context, Effect, FileSystem, Result, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { boxEnv, repoNode } from "./boxnode.ts";
import { CAPACITY, codexExecAdapter } from "./codexexec.ts";

export const PROVIDERS = ["codex", "codex-read", "codex-exec", "codex-exec-read", "claude"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The rows that run plain `codex exec` (./codexexec.ts). */
export const EXEC_PROVIDERS: ReadonlySet<Provider> = new Set(["codex-exec", "codex-exec-read"]);

/**
 * One break a step planted once and undid (.decisions/0093): the law, what it broke (file:line and
 * how), and `red` when the law failed on it, `green` when the law did not catch it.
 */
export const Plant = Schema.Struct({
  law: Schema.String,
  plant: Schema.String,
  result: Schema.Literals(["red", "green"]),
});
export type Plant = typeof Plant.Type;

/** The step's typed answer: the five verbs, as one JSON object at the end of its report. */
export const Answer = Schema.Struct({
  verb: Schema.Literals(["done", "send", "ask", "skip", "stuck"]),
  /** Where a `send` goes; `null` for any other verb. */
  to: Schema.NullOr(Schema.Literals(["tests", "build", "plan"])),
  reason: Schema.String,
  /** A build that needed no commit names the laws it ran green; `null` otherwise. */
  laws: Schema.NullOr(Schema.String),
  /** Each plant the step ran once, for its field row (0093): the tests step names one per new law. */
  plants: Schema.optionalKey(Schema.Array(Plant)),
});
export type Answer = typeof Answer.Type;

/** Where a step may send the lane: any step but itself. A step that needs another round of itself
 * is not done yet, and a send to itself only loops (2026-11-11, a tests step on Codex). */
export const sendsFrom = (step: string) => (["tests", "build", "plan"] as const).filter((to) => to !== step);

/** The typed answer one step is offered: `Answer`, with `to` naming only `sendsFrom(step)`. */
export const answerFor = (step: string) =>
  Schema.Struct({ ...Answer.fields, to: Schema.NullOr(Schema.Literals(sendsFrom(step))) });

/**
 * The judgment agent's answer: send a lane step again with a note, or park the lane for the lead.
 * A lane has no mutation step (.decisions/0066), so the answer cannot name one.
 */
export const Judgment = Schema.Struct({
  answer: Schema.Literals(["send", "park"]),
  step: Schema.NullOr(Schema.Literals(["tests", "build", "review"])),
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

/** The adapter scripts the provider table starts, under `ADAPTERS` (harness.ts). */
export const ADAPTER_SCRIPTS = [
  "@agentclientprotocol/codex-acp/dist/index.js",
  "@agentclientprotocol/claude-agent-acp/dist/index.js",
] as const;

/** The pinned adapters could not be installed: the step's agent cannot start. */
export class AdaptersMissing extends Schema.TaggedError<AdaptersMissing>()("AdaptersMissing", {
  missing: Schema.Array(Schema.String),
  said: Schema.String,
}) {}

/** How the install ran: its exit code and its last lines. */
export type Install = (folder: string) => Effect.Effect<{ readonly code: number; readonly said: string }>;

/** The documented install (adapters/package.json): pinned, apart from the workspace, from its lockfile. */
const pnpmInstall: Install = (folder) =>
  Effect.gen(function* () {
    const ran = yield* ChildProcess.make(
      "pnpm",
      ["--dir", folder, "install", "--ignore-workspace", "--frozen-lockfile", "--silent"],
      { extendEnv: true, stdin: "ignore" },
    );
    const [out, err, code] = yield* Effect.all(
      [
        ran.stdout.pipe(Stream.decodeText(), Stream.mkString),
        ran.stderr.pipe(Stream.decodeText(), Stream.mkString),
        ran.exitCode,
      ],
      { concurrency: 3 },
    );
    return { code: Number(code), said: `${out}${err}`.trim().split("\n").slice(-5).join(" | ") };
  }).pipe(
    Effect.scoped,
    Effect.catch(() => Effect.succeed({ code: 127, said: "pnpm could not start" })),
    Effect.provide(nodeServices),
  );

/**
 * The adapters the agents start, installed when the checkout this runs from has none. A fresh
 * worktree's `pnpm install` leaves them out (they sit apart from the workspace), and a step started
 * there ended `ACP connection closed ... Cannot find module` once its box was made (layout-tests3-p16
 * and t411-mutation3, 2026-11-10; ticket 565). Installed once, then checked again: still missing is
 * `AdaptersMissing` with the install's own words, before any box exists.
 */
export const adaptersReady = (modules: string = ADAPTERS, install: Install = pnpmInstall) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = modules.replace(/\/$/, "");
    const missing = Effect.filter(ADAPTER_SCRIPTS, (s) =>
      fs.exists(`${root}/${s}`).pipe(
        Effect.map((here) => !here),
        Effect.orElseSucceed(() => true),
      ),
    );

    if ((yield* missing).length === 0) {
      return;
    }

    const ran = yield* install(root.replace(/\/node_modules$/, ""));
    const still = yield* missing;

    if (still.length > 0) {
      return yield* new AdaptersMissing({ missing: still, said: `install exit ${ran.code}: ${ran.said}` });
    }
  }).pipe(Effect.provide(nodeServices));

/**
 * The provider table on the ACP rows, the session map and the reaper. One per process. Every row
 * starts from the env `boxEnv` gives, so a box finds the Node the checkout at `main` pins first,
 * and a `codex-exec` turn starts only once the box's shell finds that pin (codexexec.ts).
 */
export const makeStepAgents = (sessionsDir: string, main: string) =>
  Effect.gen(function* () {
    yield* adaptersReady();
    const sessions = yield* Agent.fileSessions(sessionsDir);
    const env = yield* boxEnv(main, process.env);
    const pin = yield* repoNode(main);
    const adapters = {
      codex: yield* acpAdapter({ name: "codex", access: "write" }, env),
      "codex-read": yield* acpAdapter({ name: "codex", access: "read" }, env),
      "codex-exec": yield* codexExecAdapter({ access: "write", env, pin }),
      "codex-exec-read": yield* codexExecAdapter({ access: "read", env, pin }),
      claude: yield* acpAdapter("claude", env),
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

/** Appends one event line to the turn's `events` file, with when it arrived. */
const appendTo = (events: string, line: object) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .writeFileString(events, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`, { flag: "a" })
      .pipe(Effect.ignore);
  });

/**
 * One turn, run to its end: each update appended to `events` as it arrives, the last message
 * written to `report`, and the typed answer handed back. A harness that will not start or breaks
 * is a `failed` turn, never a thrown error. The clock is the interface's own (`limits.seconds`),
 * so running out ends the turn `over_time` and the agent's commands are reaped with it. A
 * `codex-exec` row adds its retries and its one ask for a missing answer (`execTurn`).
 */
export const runTurn = <A>(agents: typeof Agent.Agents.Service, ask: TurnAsk<A>): Effect.Effect<Turned<A>> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (EXEC_PROVIDERS.has(ask.provider)) {
      return yield* execTurn(agents, ask);
    }

    const { turned, said } = yield* turnOnce(agents, ask, ask.prompt, ask.minutes * 60);
    yield* fs.writeFileString(ask.report, said).pipe(Effect.ignore);
    return turned;
  }).pipe(Effect.provide(nodeServices));

/** One turn through the agents service, on `prompt` and `seconds`, with what its last message said. */
const turnOnce = <A>(agents: Agents, ask: TurnAsk<A>, prompt: string, seconds: number) =>
  Effect.gen(function* () {
    const state = { said: "", spent: NO_SPENT, ended: null as Agent.Ended<A> | null };
    const append = (line: object) => appendTo(ask.events, line);
    const turn: Agent.Turn<A> = {
      provider: ask.provider,
      session: ask.session,
      folder: ask.folder,
      prompt,
      // The append case: the harness's own coding prompt, then ours.
      system: Agent.SystemPrompt.members[0].make({ text: ask.system }),
      answer: ask.answer,
      model: ask.model,
      effort: ask.effort,
      limits: { usd: null, tools: null, seconds },
    };
    const ran = yield* agents.run(turn).pipe(
      Stream.runForEach((heard) =>
        Effect.gen(function* () {
          yield* append(heard);

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
    const failed = (reason: string, message: string) => Failed.make({ reason, message, spent: state.spent });
    const done = (turned: Turned<A>) => ({ turned, said: state.said });

    if (Result.isFailure(ran)) {
      const e = ran.failure;
      yield* append(failed(e.why, e.message));
      return done(failed(e.why, e.message));
    }

    const ended = state.ended;

    if (ended === null) {
      return done(failed("broke", "the stream ended with no end"));
    }

    return done({
      ...Ended.make({ stop: ended.stop, spent: state.spent, said: state.said }),
      answer: ended.answer,
    });
  });

// ---------------------------------------------------------------- the codex-exec turn

/**
 * How a `codex-exec` turn retries a capacity error: the shell wrapper's 6 tries, 60 seconds apart.
 * A reference with that default, so a test sets the wait to nothing.
 */
export const CapacityRetry = Context.Reference<{ readonly tries: number; readonly waitSeconds: number }>(
  "lead/agents/CapacityRetry",
  { defaultValue: () => ({ tries: 6, waitSeconds: 60 }) },
);

/** What a `codex-exec` turn adds to its `events` file between Codex's own updates. */
const ExecNote = Schema.TaggedUnion({
  /** A try failed on capacity words; the next starts after the wait. */
  capacity: { attempt: Schema.Number, waitSeconds: Schema.Number },
  /** The report held no answer, so one more turn asks for it. */
  answer_ask: { reason: Schema.String },
});

/** The one extra ask, when the report holds no answer: the answer object alone (the schema follows it). */
export const ANSWER_PROMPT =
  "Your report is written. Do no more work. Reply now with only the one JSON object your step asked for at the end of its report, nothing before or after it.";

/**
 * Two spends joined: one turn's tries and its answer ask make one field row. Tool calls add up.
 * Tokens do not: every try after the first that spent any resumes the same Codex thread, and a
 * resumed `codex exec` turn's `turn.completed` gave the thread's running total, not the turn's
 * (2026-11-11, 0.167.0: a one-line resume after a 1,012-output turn said 1,062 out). So the
 * later, larger count is the whole, and each count is the larger of the two.
 */
const plus = (a: Spent, b: Spent): Spent => ({
  input: Math.max(a.input, b.input),
  cached: Math.max(a.cached, b.cached),
  output: Math.max(a.output, b.output),
  counted: a.counted === "none" ? b.counted : a.counted,
  usd: a.usd === null && b.usd === null ? null : Math.max(a.usd ?? 0, b.usd ?? 0),
  requests: a.requests === null && b.requests === null ? null : Math.max(a.requests ?? 0, b.requests ?? 0),
  tools: a.tools + b.tools,
});

const withSpent = <A>(t: Turned<A>, spent: Spent): Turned<A> => ({ ...t, spent });

/**
 * One prompt on a `codex-exec` row, tried again only while it failed on capacity words, up to
 * `CapacityRetry.tries`, waiting between tries, and never past the turn's minutes. A try after the
 * first carries on the Codex thread the first opened, when it opened one (the session map), so the
 * work done before the error is not done again.
 */
const triedOnCapacity = <A>(agents: Agents, ask: TurnAsk<A>, prompt: string, until: number) =>
  Effect.gen(function* () {
    const retry = yield* CapacityRetry;
    let spent = NO_SPENT;

    for (let attempt = 1; ; attempt++) {
      const left = (until - (yield* Clock.currentTimeMillis)) / 1000;
      const { turned, said } = yield* turnOnce(agents, ask, prompt, Math.max(1, left));
      spent = plus(spent, turned.spent);
      const again =
        turned._tag === "failed" &&
        CAPACITY.test(turned.message) &&
        attempt < retry.tries &&
        left - retry.waitSeconds > 1;

      if (!again) {
        return { turned: withSpent(turned, spent), said };
      }

      yield* appendTo(ask.events, ExecNote.cases.capacity.make({ attempt, waitSeconds: retry.waitSeconds }));
      yield* Effect.sleep(`${retry.waitSeconds} seconds`);
    }
  });

/**
 * A `codex-exec` turn: the prompt, tried on capacity; then, when Codex ended with a report that
 * holds no answer the schema reads, ONE more turn on the same Codex thread asking for the answer
 * alone. Still none is a failed turn, `no_answer`: an answer is never made up. The report is the
 * step's own last message, with the answer turn's message after it when there was one.
 */
const execTurn = <A>(agents: Agents, ask: TurnAsk<A>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const until = (yield* Clock.currentTimeMillis) + ask.minutes * 60_000;
    const first = yield* triedOnCapacity(agents, ask, ask.prompt, until);
    const t = first.turned;
    const asks = t._tag === "ended" && t.stop === "end_turn" && t.answer === null && first.said.trim() !== "";

    if (!asks) {
      yield* fs.writeFileString(ask.report, first.said).pipe(Effect.ignore);
      return t;
    }

    yield* appendTo(
      ask.events,
      ExecNote.cases.answer_ask.make({ reason: "the report holds no answer the schema reads" }),
    );
    const second = yield* triedOnCapacity(agents, ask, ANSWER_PROMPT, until);
    const spent = plus(t.spent, second.turned.spent);
    const report = second.said.trim() === "" ? first.said : `${first.said}\n\n${second.said}`;
    yield* fs.writeFileString(ask.report, report).pipe(Effect.ignore);
    const s = second.turned;

    if (s._tag === "ended" && s.answer !== null) {
      return { ...s, spent, said: report };
    }

    const detail = s._tag === "failed" ? `${s.reason}: ${s.message}` : `it stopped ${s.stop} with none`;
    return Failed.make({
      reason: "no_answer",
      message: `the report held no answer the schema reads, and the one turn that asked for it gave none (${detail})`,
      spent,
    });
  });

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
  /** The plants the step's answer named (0093); left off the row when it named none. */
  readonly plants?: ReadonlyArray<Plant> | undefined;
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
  plants: Schema.optionalKey(Schema.Array(Plant)),
}).pipe(Schema.encodeKeys({ reason: "why" }));

const encodeRow = Schema.encodeSync(Schema.fromJsonString(FieldRow));

/** One `field/runs.jsonl` row for a turn, in the shape `fieldrow.py` and `clauderow.ts` write. */
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
    ...(r.plants === undefined ? {} : { plants: r.plants }),
  })}\n`;
};

/** The service a step's turn runs on, as `makeStepAgents` gives it. */
export type Agents = typeof Agent.Agents.Service;
