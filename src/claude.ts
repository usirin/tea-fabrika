import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { z } from "zod";
import { Criterion } from "./issue.ts";
import {
  type BuildAnswer,
  type BuildRequest,
  Builder,
  type EnrichRequest,
  Enricher,
  type ReviewRequest,
  Reviewer,
} from "./services.ts";
import { TESTS_FILE } from "./tests.ts";

export interface ClaudeOptions {
  /** The model to ask for. Left out, the CLI picks its own default. */
  readonly model?: string;
  /** How long one turn may take before it counts as failed. */
  readonly timeoutMs?: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * A conversation with a known id. `continues` says whether it should already
 * exist; when the guess is wrong (a build killed before Claude saved anything,
 * or after it had), the turn tries the other way once.
 */
export interface Conversation {
  readonly id: string;
  readonly continues: boolean;
}

/** One turn of Claude Code: what it is asked, in which conversation, with which tools. */
export interface Turn {
  readonly prompt: string;
  /** The conversation to be in, or `null` to start one under a new id. */
  readonly session: Conversation | null;
  readonly tools: readonly string[];
  /** Let it edit files without asking. Left out, it can only read. */
  readonly edits?: boolean;
  /** A JSON Schema the turn's answer must match. */
  readonly schema?: object;
}

export interface TurnResult {
  readonly text: string;
  /** The answer as data, when the turn was given a schema. */
  readonly structured: unknown;
  readonly session: string;
}

/** `claude` exited with an error. `stderr` says why, e.g. a conversation that is not there. */
class ClaudeFailed extends Error {
  readonly stderr: string;

  constructor(code: number | null, stderr: string) {
    super(`claude exited ${code}: ${stderr.trim()}`);
    this.stderr = stderr;
  }
}

/** Run `claude -p` to the end and hand back everything it printed. */
const runClaude = (dir: string, args: readonly string[], signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: dir,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new ClaudeFailed(code, err)),
    );
  });

/** The flags that put a turn in its conversation. */
const conversationArgs = (session: Conversation | null, continues: boolean) =>
  session === null
    ? ["--session-id", randomUUID()]
    : continues
      ? ["--resume", session.id]
      : ["--session-id", session.id];

/** The guess about a conversation was wrong, and the other way will work. */
const wrongGuess = (error: unknown, continues: boolean) =>
  error instanceof ClaudeFailed &&
  (continues
    ? error.stderr.includes("No conversation found")
    : error.stderr.includes("is already in use"));

/** Read the last event of `--output-format json`: the turn's result. */
function resultOf(printed: string): TurnResult {
  const events = JSON.parse(printed) as readonly Record<string, unknown>[];
  const last = events.at(-1);
  if (
    last?.type !== "result" ||
    last.is_error !== false ||
    typeof last.result !== "string" ||
    typeof last.session_id !== "string"
  ) {
    throw new Error("claude did not end with a clean result");
  }
  return {
    text: last.result,
    structured: last.structured_output,
    session: last.session_id,
  };
}

/**
 * One turn in `dir`. Your own Claude Code settings, hooks and plugins are left
 * out, so a turn behaves the same anywhere.
 */
export async function turn(
  dir: string,
  options: ClaudeOptions,
  ask: Turn,
  signal: AbortSignal,
): Promise<TurnResult> {
  const once = (continues: boolean) => runClaude(
    dir,
    [
      "-p", ask.prompt,
      "--output-format", "json",
      ...conversationArgs(ask.session, continues),
      "--setting-sources", "project",
      "--strict-mcp-config",
      ...(ask.edits === true ? ["--permission-mode", "acceptEdits"] : []),
      ...(options.model === undefined ? [] : ["--model", options.model]),
      ...(ask.schema === undefined ? [] : ["--json-schema", JSON.stringify(ask.schema)]),
      // `--tools` is what takes the other tools away. `--allowedTools` alone only
      // pre-approves: with it the agent kept a shell, and used `git show` to dig
      // files out of history that had been removed from its folder.
      "--tools", ...ask.tools,
      "--allowedTools", ...ask.tools,
    ],
    AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? FIVE_MINUTES)]),
  );
  const continues = ask.session?.continues ?? false;
  const printed = await once(continues).catch((error: unknown) =>
    ask.session !== null && wrongGuess(error, continues) ? once(!continues) : Promise.reject(error),
  );
  return resultOf(printed);
}

/** How the builder ends its turn. Every field is always there; the ones its kind does not use are empty. */
const BuilderReply = z.object({
  kind: z.enum(["done", "contradiction", "blocked", "dispute"]),
  summary: z.string(),
  deviations: z.array(z.object({ file: z.string(), why: z.string() })),
  criterion: z.string(),
  call: z.string(),
  finding: z.string(),
  why: z.string(),
});

const builderSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "summary", "deviations", "criterion", "call", "finding", "why"],
  properties: {
    kind: {
      type: "string",
      enum: ["done", "contradiction", "blocked", "dispute"],
      description:
        "done: the change is made. contradiction: an example breaks its own rule. blocked: you cannot do the work from here. dispute: a review finding you were sent is wrong",
    },
    finding: { type: "string", description: "dispute: the finding's id, as the review gave it. Otherwise empty" },
    summary: { type: "string", description: "done: one sentence saying what you changed. Otherwise empty" },
    deviations: {
      type: "array",
      description: "done: every file you changed that no criterion names, with why. Empty when there is none",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "why"],
        properties: {
          file: { type: "string", description: "The path, relative to the folder" },
          why: { type: "string", description: "Why you changed it, in one sentence" },
        },
      },
    },
    criterion: { type: "string", description: "contradiction: the criterion's id. Otherwise empty" },
    call: { type: "string", description: "contradiction: the example's call, exactly as written. Otherwise empty" },
    why: { type: "string", description: "contradiction, blocked or dispute: why, in one or two sentences. Otherwise empty" },
  },
};

/** The builder's reply as the lane's answer. */
function answerOf(reply: z.infer<typeof BuilderReply>): BuildAnswer {
  switch (reply.kind) {
    case "done":
      return { kind: "done", summary: reply.summary, deviations: reply.deviations };
    case "contradiction":
      return { kind: "contradiction", criterion: reply.criterion, call: reply.call, why: reply.why };
    case "blocked":
      return { kind: "blocked", why: reply.why };
    case "dispute":
      return { kind: "dispute", finding: reply.finding, why: reply.why };
  }
}

/** One criterion as the builder reads it: the rule, and its examples as the tests have them. */
const describeCriterion = (c: Criterion) =>
  c.kind === "example"
    ? [`- ${c.rule} (${c.id})`, ...c.examples.map((e) => `    ${e.call} -> ${e.result}`)].join("\n")
    : `- ${c.rule} (${c.id})`;

/** What the builder is told. A retry is short: the conversation already holds the issue. */
export function promptFor(request: BuildRequest): string {
  if (request.session.continues && request.feedback !== null) {
    return `Your change was sent back.\n\n${request.feedback}\n\nFix it.`;
  }
  return [
    `Implement this issue by editing the files in the current folder.`,
    `# ${request.issue.title}`,
    request.issue.body,
    `The rules, and the examples that show them:\n${request.issue.criteria.map(describeCriterion).join("\n")}`,
    `Every example is a test in ${TESTS_FILE}: make them pass. You cannot change that file, and you cannot run commands; the tests are run for you after you finish.`,
    `If an example breaks its own rule, do not write code to match it: answer contradiction, naming the criterion and the call. If you cannot do the work from here, answer blocked. Otherwise answer done.`,
    `The criteria name the files this issue is about. If you change any other file, list it under deviations with why: a change you do not list is sent back.`,
    `After the tests pass, a reviewer reads the change. If it sends back a finding you think is wrong, answer dispute with the finding's id and why, instead of changing code to suit it.`,
    ...(request.feedback === null ? [] : [`The last attempt was sent back:\n${request.feedback}`]),
  ].join("\n\n");
}

/**
 * Claude Code as the builder, working in `dir`. It may read and edit files and
 * nothing else: running the tests is the machine's job.
 */
export function claudeBuilder(dir: string, options: ClaudeOptions = {}) {
  return Layer.succeed(Builder, {
    build: (request) =>
      Effect.tryPromise({
        try: async (signal) => {
          const result = await turn(
            dir,
            options,
            {
              prompt: promptFor(request),
              session: request.session,
              tools: ["Read", "Edit", "Write", "Glob", "Grep"],
              edits: true,
              schema: builderSchema,
            },
            signal,
          );
          return answerOf(BuilderReply.parse(result.structured));
        },
        catch: () => ({ _tag: "agent_failed" as const }),
      }),
  });
}

/** How the reviewer ends its turn. */
const ReviewerReply = z.object({
  findings: z.array(z.object({ file: z.string(), line: z.number(), quote: z.string(), problem: z.string() })),
  rechecks: z.array(z.object({ id: z.string(), fixed: z.boolean() })),
});

const reviewerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "rechecks"],
  properties: {
    findings: {
      type: "array",
      description: "New problems in the change. Empty when there is none",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line", "quote", "problem"],
        properties: {
          file: { type: "string", description: "The path, relative to the folder" },
          line: { type: "integer", description: "The line number in the file as it is now, starting at 1" },
          quote: { type: "string", description: "The code on that line, copied exactly" },
          problem: { type: "string", description: "What is wrong, in one or two plain sentences" },
        },
      },
    },
    rechecks: {
      type: "array",
      description: "One entry per earlier finding you were given",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "fixed"],
        properties: { id: { type: "string" }, fixed: { type: "boolean" } },
      },
    },
  },
};

/**
 * What the reviewer is told. The things to look for are fabrika's code rubric,
 * cut to what a toy can show; what tests and CI already answer is left out.
 */
export function reviewPromptFor(request: ReviewRequest): string {
  return [
    `You are reviewing a change to the code in the current folder. You find problems; you do not decide whether the change passes, and you change nothing.`,
    `# ${request.issue.title}`,
    request.issue.body,
    `The change, as a diff against where it started:\n\`\`\`diff\n${request.diff}\n\`\`\``,
    [
      `The tests already pass, so do not re-check what an example shows. Look for what tests cannot see:`,
      `- Silent failures: an input the code accepts and quietly gets wrong, or an error swallowed.`,
      `- Behavior claims: a comment or name that says the code does something it does not.`,
      `- Comments that restate the code, narrate obvious steps, or are now stale.`,
      `- Anything the change does beyond what the issue asks.`,
    ].join("\n"),
    `Every finding names one line of a file as it is now, and quotes that line exactly. A finding whose quote is not on that line is thrown away. If you find nothing, return no findings: an empty review is a fine answer.`,
    ...(request.open.length === 0
      ? []
      : [
          `Earlier findings the builder was asked to fix. Say of each whether the code now fixes it:\n${request.open.map((f) => `- [${f.id}] ${f.file}:${f.line} \`${f.quote}\`: ${f.problem}`).join("\n")}`,
        ]),
    ...(request.decided.length === 0
      ? []
      : [
          `A person already decided these points, so do not raise them again, in any words: filed means it is real but not this ticket's, withdrawn means it was judged wrong.\n${request.decided.map((f) => `- [${f.id}, ${f.decision}] ${f.problem}`).join("\n")}`,
        ]),
  ].join("\n\n");
}

/**
 * Claude Code as the reviewer, reading `dir`. It can read and search and
 * nothing else, and every review starts a fresh conversation, so it reads
 * each round cold.
 */
export function claudeReviewer(dir: string, options: ClaudeOptions = {}) {
  return Layer.succeed(Reviewer, {
    review: (request) =>
      Effect.tryPromise({
        try: async (signal) => {
          const result = await turn(
            dir,
            options,
            { prompt: reviewPromptFor(request), session: null, tools: ["Read", "Glob", "Grep"], schema: reviewerSchema },
            signal,
          );
          return ReviewerReply.parse(result.structured);
        },
        catch: () => ({ _tag: "agent_failed" as const }),
      }),
  });
}

/** A criterion as the enricher writes it, before code sorts it into a kind. */
const Written = z.object({
  id: z.string(),
  rule: z.string(),
  file: z.string(),
  name: z.string(),
  examples: z.array(z.object({ call: z.string(), result: z.string() })),
  no_example: z.string().nullable(),
});

/** What the enricher must end its turn with. */
const Enriched = z.object({
  title: z.string(),
  goal: z.string(),
  summary: z.string(),
  details: z.string(),
  criteria: z.tuple([Written], Written),
});

const enrichedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "goal", "summary", "details", "criteria"],
  properties: {
    title: { type: "string", description: "A short title that says what is wrong or wanted" },
    goal: {
      type: "string",
      description:
        "One sentence saying what the code does once this issue is done, as a plain fact about its purpose. Not what is wrong today.",
    },
    summary: {
      type: "string",
      description: "Two or three everyday sentences: what is wrong, who it hurts, what we would do",
    },
    details: {
      type: "string",
      description: "What you found in the code, with real file and function names",
    },
    criteria: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "rule", "file", "name", "examples", "no_example"],
        properties: {
          id: { type: "string", description: "A short kebab-case name" },
          rule: { type: "string", description: "The rule in one plain sentence, one claim" },
          file: { type: "string", description: "The file the calls import from, relative to the folder, e.g. price.js" },
          name: { type: "string", description: "The exported function the calls use, e.g. formatPrice" },
          examples: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["call", "result"],
              properties: {
                call: { type: "string", description: "One JavaScript expression, e.g. formatPrice(3.5)" },
                result: { type: "string", description: 'The exact value as a JavaScript literal, e.g. "3.50"' },
              },
            },
          },
          no_example: {
            type: ["string", "null"],
            description: "null when examples show the rule; otherwise why no call and result can",
          },
        },
      },
    },
  },
};

/** A rule with examples becomes an example criterion; one without is unchecked, with the reason given. */
function kindOf(written: z.infer<typeof Written>): Criterion {
  const [first, ...rest] = written.examples;
  return written.no_example === null && first !== undefined
    ? { kind: "example", id: written.id, rule: written.rule, file: written.file, name: written.name, examples: [first, ...rest] }
    : { kind: "unchecked", id: written.id, rule: written.rule, why: written.no_example ?? "no example was given" };
}

/**
 * How a criterion gets used, so the enricher writes ones that survive it. It is
 * the brief experiment 19 measured (see experiments/README.md), with the file
 * and the function named so code can write the import.
 */
const DATA_BRIEF = [
  `How your criteria will be used: each criterion is data, a rule and the examples that prove it. An example is one JavaScript call and the exact value it returns, such as call \`formatPrice(3.5)\` and result \`"3.50"\`. Code turns every example into \`assert.deepStrictEqual(<call>, <result>)\`, imports the function by name from the file you give, and runs it against the finished code, with no person or model in between. So the call must run exactly as written, and the result must be exactly right.`,
  `- One claim per rule. A sentence that says two things becomes two criteria.`,
  `- Give each rule one example, or more only when one cannot show it. Pick an input that the rule decides: a test of "upper case becomes lower case" needs an upper-case letter in it.`,
  `- Say what the finished code does. A rule it has to follow gets a criterion even when the starting code happens to follow it already. Leave out only what the issue does not touch.`,
  `- If a rule cannot be shown by a call and its result (it is about types, timing, files, docs or side effects), leave examples empty and say why in no_example. Do not force it.`,
].join("\n");

/** What the enricher is told. The rules are fabrika's triage skill, cut to fit a toy. */
export function enrichPromptFor(request: EnrichRequest): string {
  if (request.session !== null && request.note !== null) {
    return `Your rewrite was sent back.\n\n${request.note}\n\nRewrite the issue again.`;
  }
  return [
    `You are triaging one raw issue for the code in the current folder. Turn it into an issue a builder can pick up cold. You write no code, and you cannot run anything.`,
    `# ${request.raw.title}`,
    request.raw.body,
    [
      `Rules:`,
      `- Never work from the title alone. Read the code the issue is about first, and check what the issue claims against it.`,
      `- No invention. Write only what you found or what the issue says. Keep the uncertainty the issue had.`,
      `- The first criterion states the user's job as an outcome someone could observe.`,
      `- Write one criterion for each rule you found, most important first.`,
    ].join("\n"),
    DATA_BRIEF,
    ...(request.note === null ? [] : [`An earlier rewrite was sent back:\n${request.note}`]),
  ].join("\n\n");
}

/**
 * Claude Code as the enricher, reading `dir`. It can read and search and
 * nothing else, and its turn must end in the typed rewrite.
 */
export function claudeEnricher(dir: string, options: ClaudeOptions = {}) {
  return Layer.succeed(Enricher, {
    enrich: (request) =>
      Effect.tryPromise({
        try: async (signal) => {
          const result = await turn(
            dir,
            options,
            {
              prompt: enrichPromptFor(request),
              session: request.session === null ? null : { id: request.session, continues: true },
              tools: ["Read", "Glob", "Grep"],
              schema: enrichedSchema,
            },
            signal,
          );
          const enriched = Enriched.parse(result.structured);
          return {
            issue: {
              id: request.raw.id,
              title: enriched.title,
              goal: enriched.goal,
              // The rewrite goes on top and the original stays beneath it.
              body: [
                `## In plain words\n\n${enriched.summary}`,
                enriched.details,
                `## As filed\n\n${request.raw.body}`,
              ].join("\n\n"),
              criteria: [kindOf(enriched.criteria[0]), ...enriched.criteria.slice(1).map(kindOf)],
            },
            session: result.session,
          };
        },
        catch: () => ({ _tag: "agent_failed" as const }),
      }),
  });
}
