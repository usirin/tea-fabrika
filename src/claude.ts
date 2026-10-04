import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { z } from "zod";
import { Criterion } from "./issue.ts";
import {
  type BuildRequest,
  Builder,
  type EnrichRequest,
  Enricher,
} from "./services.ts";

export interface ClaudeOptions {
  /** The model to ask for. Left out, the CLI picks its own default. */
  readonly model?: string;
  /** How long one turn may take before it counts as failed. */
  readonly timeoutMs?: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;

/** One turn of Claude Code: what it is asked, in which conversation, with which tools. */
export interface Turn {
  readonly prompt: string;
  /** The conversation to continue, or `null` to start one. */
  readonly session: string | null;
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

/** Run `claude -p` to the end and hand back everything it printed. */
const runClaude = (dir: string, args: readonly string[], signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: dir,
      signal,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}`)),
    );
  });

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
  const printed = await runClaude(
    dir,
    [
      "-p", ask.prompt,
      "--output-format", "json",
      ...(ask.session === null
        ? ["--session-id", randomUUID()]
        : ["--resume", ask.session]),
      "--setting-sources", "project",
      "--strict-mcp-config",
      ...(ask.edits === true ? ["--permission-mode", "acceptEdits"] : []),
      ...(options.model === undefined ? [] : ["--model", options.model]),
      ...(ask.schema === undefined ? [] : ["--json-schema", JSON.stringify(ask.schema)]),
      "--allowedTools", ...ask.tools,
    ],
    AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? FIVE_MINUTES)]),
  );
  return resultOf(printed);
}

/** What the builder is told. A retry is short: the conversation already holds the issue. */
export function promptFor(request: BuildRequest): string {
  if (request.session !== null && request.feedback !== null) {
    return `Your change was sent back.\n\n${request.feedback}\n\nFix it.`;
  }
  const criteria = request.issue.criteria.map((c) => `- ${c.text}`).join("\n");
  return [
    `Implement this issue by editing the files in the current folder.`,
    `# ${request.issue.title}`,
    request.issue.body,
    `Acceptance criteria:\n${criteria}`,
    `You cannot run commands. The tests are run for you after you finish, and editing a test file has no effect.`,
    `Reply with one sentence saying what you changed.`,
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
            },
            signal,
          );
          return { summary: result.text, session: result.session };
        },
        catch: () => ({ _tag: "agent_failed" as const }),
      }),
  });
}

/** What the enricher must end its turn with. */
const Enriched = z.object({
  title: z.string(),
  summary: z.string(),
  details: z.string(),
  criteria: z.tuple([Criterion], Criterion),
});

const enrichedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "details", "criteria"],
  properties: {
    title: { type: "string", description: "A short title that says what is wrong or wanted" },
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
        required: ["id", "text"],
        properties: {
          id: { type: "string", description: "A short kebab-case name" },
          text: { type: "string", description: "One checkable sentence" },
        },
      },
    },
  },
};

/**
 * How a criterion gets used, so the enricher writes ones that survive it. The
 * rules come from real runs (see experiments/README.md): the judge was sure
 * when a criterion made one claim and its test asserted the criterion's own
 * example, and unsure about two claims in one line or a claim with no example.
 * The examples here are from another domain on purpose, so they teach the shape
 * and not the answer.
 */
const JUDGE_BRIEF = [
  `How your criteria will be used: before any code is written, a test-writer turns each criterion into one test. A small classifier then reads one criterion next to its test, and nothing else, and answers whether the test passing would prove the criterion. Write for both:`,
  `- One claim per criterion. A sentence that says two things becomes two criteria.`,
  `- Every criterion carries one worked example: a real input and the exact result, as in \`so "x" becomes "y"\`. The test will assert exactly that example, so it has to be right.`,
  `- Say what the change makes true. Never write a criterion about what stays the same: its test would pass before any code is written, and prove nothing.`,
  `- Each criterion stands on its own, in plain words about behaviour, and none contradicts another.`,
  `- Keep each one short.`,
  `Good: \`Prices are shown with two decimals, so 3.5 is shown as "3.50".\` / \`An empty cart shows a total of 0.\``,
  `Bad: "Prices are formatted correctly." (no example, nothing to assert) / "The existing price tests still pass unchanged." (about what did not change) / "Rounds prices and never shows a trailing zero or a negative total." (three claims) / "Only digits appear in the total", beside a criterion that adds a currency sign (they contradict).`,
].join("\n");

/** What the enricher is told. The rules are fabrika's triage skill, cut to fit a toy. */
export function enrichPromptFor(request: EnrichRequest): string {
  if (request.session !== null && request.note !== null) {
    return `Your rewrite was sent back.\n\n${request.note}\n\nRewrite the issue again.`;
  }
  return [
    `You are triaging one raw issue for the code in the current folder. Turn it into an issue a builder can pick up cold. You write no code.`,
    `# ${request.raw.title}`,
    request.raw.body,
    [
      `Rules:`,
      `- Never work from the title alone. Read the code the issue is about first, and check what the issue claims against it.`,
      `- No invention. Write only what you found or what the issue says. Keep the uncertainty the issue had.`,
      `- The first criterion states the user's job as an outcome someone could observe.`,
      `- Write one criterion for each rule you found, most important first.`,
    ].join("\n"),
    JUDGE_BRIEF,
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
              session: request.session,
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
              // The rewrite goes on top and the original stays beneath it.
              body: [
                `## In plain words\n\n${enriched.summary}`,
                enriched.details,
                `## As filed\n\n${request.raw.body}`,
              ].join("\n\n"),
              criteria: enriched.criteria,
            },
            session: result.session,
          };
        },
        catch: () => ({ _tag: "agent_failed" as const }),
      }),
  });
}
