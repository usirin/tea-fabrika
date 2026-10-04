import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { type BuildRequest, type BuildResult, Builder } from "./services.ts";

export interface ClaudeBuilderOptions {
  /** The model to ask for. Left out, the CLI picks its own default. */
  readonly model?: string;
  /** How long one build may take before it counts as failed. */
  readonly timeoutMs?: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;

/** What the agent is told. A retry is short: the conversation already holds the issue. */
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
function resultOf(printed: string): BuildResult {
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
  return { summary: last.result, session: last.session_id };
}

/**
 * Claude Code as the builder, working in `dir`. It may read and edit files and
 * nothing else: running the tests is the machine's job. Your own Claude Code
 * settings, hooks and plugins are left out, so a build behaves the same anywhere.
 */
export function claudeBuilder(dir: string, options: ClaudeBuilderOptions = {}) {
  return Layer.succeed(Builder, {
    build: (request) =>
      Effect.tryPromise({
        try: async (signal) => {
          const conversation =
            request.session === null
              ? ["--session-id", randomUUID()]
              : ["--resume", request.session];
          const printed = await runClaude(
            dir,
            [
              "-p", promptFor(request),
              "--output-format", "json",
              ...conversation,
              "--setting-sources", "project",
              "--strict-mcp-config",
              "--permission-mode", "acceptEdits",
              ...(options.model === undefined ? [] : ["--model", options.model]),
              "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep",
            ],
            AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? FIVE_MINUTES)]),
          );
          return resultOf(printed);
        },
        catch: () => ({ _tag: "agent_failed" as const }),
      }),
  });
}
