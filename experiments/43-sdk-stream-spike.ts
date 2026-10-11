// Spike: Claude Code through the Agent SDK instead of `claude -p`, composed from
// outside through three seams: its message stream as a tea Sub (src/watch.ts),
// its tool checks (canUseTool and a PreToolUse hook), and its session id.
// Findings: experiments/43-agent-sdk-stream.md.
//
//   MODE=observe   a builder-like turn on the duration toy, run through the watch
//                  machine with no stop rule; every message logged with its time.
//                  canUseTool denies git commit/push/checkout and writes outside
//                  duration.js; a PreToolUse hook only logs. Picks the session id.
//   MODE=feedback  resumes observe's conversation with "your draft has problems";
//                  the same checks, now done by the PreToolUse hook.
//   MODE=hook      resumes it again and asks outright for a Write of NOTES.md
//                  and a git commit, both of which the hook refuses.
//   MODE=stop      a fresh toy; the watch may write duration.js only, and is
//                  provoked to write PLAN.md first, so its judge stops the run.
//   MODE=startup   one trivial `claude -p` turn, timed event by event.
//   MODEL=...      default sonnet; startup uses haiku
//
// No Jev. Each mode is one real run and costs money: see the write-up for what each
// cost. Logs land in experiments/results/sdk-stream-<mode>.json, with the toy's
// folder written as <toy>; observe's toy and session are kept in the OS temp
// folder for feedback.

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type CanUseTool,
  type HookCallback,
  type Options,
  type SDKMessage,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { run as runMachine } from "@demlik/tea/effect";
import { Effect, Queue, Stream } from "effect";
import { checkoutToy } from "../src/local.ts";
import { testsFor } from "../src/tests.ts";
import { type AgentSub, type Rules, type Run, type Watch, type WatchMsg, msgsOf, watch } from "../src/watch.ts";

const sh = promisify(execFile);
const MODE = process.env.MODE ?? "observe";
const STATE = join(tmpdir(), "tea-fabrika-sdk-spike.json");
const TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];
const started = Date.now();
const at = () => Date.now() - started;

// ---------------------------------------------------------------- the log

interface Entry {
  readonly t: number;
  readonly what: string;
  readonly detail?: unknown;
}
const entries: Entry[] = [];
let scrub = (s: string) => s;
const note = (what: string, detail?: unknown) => {
  const entry = { t: at(), what, ...(detail === undefined ? {} : { detail }) };
  entries.push(entry);
  console.log(scrub(JSON.stringify(entry)));
};

const cut = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…(${s.length})` : s);

/** What a tool call asks for, in a line. */
const ask = (input: Record<string, unknown>) =>
  cut(String(input.command ?? input.file_path ?? input.pattern ?? input.path ?? JSON.stringify(input)));

/** One SDK message, cut to what a reader needs. Everything else stays in the raw log. */
function brief(m: SDKMessage): Entry["detail"] {
  switch (m.type) {
    case "system":
      return m.subtype === "init"
        ? { subtype: m.subtype, session: m.session_id, model: m.model, mode: m.permissionMode, tools: m.tools }
        : { subtype: m.subtype };
    case "assistant":
      return m.message.content.map((b) =>
        b.type === "text"
          ? { text: cut(b.text) }
          : b.type === "tool_use"
            ? { tool_use: b.name, id: b.id, ask: ask((b.input ?? {}) as Record<string, unknown>) }
            : { block: b.type },
      );
    case "user": {
      const content = Array.isArray(m.message.content) ? m.message.content : [];
      const structured = m.tool_use_result;
      return {
        results: content.flatMap((b) =>
          b.type === "tool_result"
            ? [{
                id: b.tool_use_id,
                is_error: b.is_error ?? false,
                text: cut(typeof b.content === "string" ? b.content : JSON.stringify(b.content)),
              }]
            : [],
        ),
        // The tool's own output object, beside the text the model reads: what it holds says
        // whether a judge could see diffs and exit codes without parsing text.
        structured_keys:
          structured !== null && typeof structured === "object" ? Object.keys(structured as object) : typeof structured,
        patch:
          structured !== null && typeof structured === "object" && "structuredPatch" in structured
            ? (structured as { structuredPatch: { lines: string[] }[] }).structuredPatch.flatMap((h) => h.lines).slice(0, 12)
            : undefined,
      };
    }
    case "result":
      return {
        subtype: m.subtype,
        is_error: m.is_error,
        cost_usd: m.total_cost_usd,
        turns: m.num_turns,
        duration_ms: m.duration_ms,
        duration_api_ms: m.duration_api_ms,
        usage: m.usage,
        denials: m.permission_denials,
        terminal_reason: m.terminal_reason,
        session: m.session_id,
        ...(m.subtype === "success" ? { result: cut(m.result, 300), structured: m.structured_output } : { errors: m.errors }),
      };
    default:
      return { subtype: "subtype" in m ? m.subtype : undefined };
  }
}

// ---------------------------------------------------------------- the checks

const GIT_WRITE = /\bgit\s+(commit|push|checkout)\b/;

/** Why a call may not run, or null. The same rule for canUseTool and for the hook. */
function refusal(allowed: readonly string[], cwd: string, tool: string, input: Record<string, unknown>): string | null {
  if (tool === "Bash" && typeof input.command === "string" && GIT_WRITE.test(input.command)) {
    return "Committing, pushing and switching branches is done for you after your turn. Leave git alone and carry on.";
  }
  const path = typeof input.file_path === "string" ? input.file_path : null;
  if ((tool === "Write" || tool === "Edit") && path !== null) {
    const file = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
    if (!allowed.includes(file)) return `${file} is outside this issue: change only ${allowed.join(", ")}.`;
  }
  return null;
}

const canUseTool =
  (allowed: readonly string[], cwd: string, deny: boolean): CanUseTool =>
  async (tool, input, options) => {
    const why = refusal(allowed, cwd, tool, input);
    note("can_use_tool", { tool, ask: ask(input), reason: options.decisionReason, denied: deny && why !== null });
    return deny && why !== null ? { behavior: "deny", message: why } : { behavior: "allow", updatedInput: input };
  };

const preToolUse =
  (allowed: readonly string[], cwd: string, deny: boolean): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    const why = refusal(allowed, cwd, input.tool_name, toolInput);
    note("pre_tool_use", { tool: input.tool_name, ask: ask(toolInput), denied: deny && why !== null });
    return deny && why !== null
      ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } }
      : {};
  };

// ---------------------------------------------------------------- the Sub

/**
 * The Sub's runner on the Effect engine: open the query, feed every message to
 * the machine as Msgs, and on close (the machine left `running`) interrupt it.
 * The raw stream is read by a plain loop so the log keeps reading after the
 * machine stops listening: that is how the stop's speed is measured.
 */
const agentRunner = (cwd: string, options: Options, resume: string | null) => (sub: AgentSub) =>
  Stream.callback<WatchMsg>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const q = query({
          prompt: sub.deps.prompt,
          options: { ...options, ...(resume === null ? { sessionId: sub.deps.session } : { resume }) },
        });
        const live = { on: true, result: false };
        note("query_opened", { session: resume ?? sub.deps.session, resume: resume !== null });
        const loop = (async () => {
          try {
            for await (const m of q) {
              note(`sdk:${m.type}${"subtype" in m && m.subtype !== undefined ? `/${m.subtype}` : ""}`, brief(m));
              if (m.type === "result") live.result = true;
              if (live.on) for (const msg of msgsOf(m, cwd)) Queue.offerUnsafe(queue, msg);
            }
            note("stream_ended");
            if (live.on && !live.result) Queue.offerUnsafe(queue, { type: "ended", error: "the stream ended with no result" });
          } catch (error) {
            note("stream_threw", String(error));
            if (live.on) Queue.offerUnsafe(queue, { type: "ended", error: String(error) });
          }
        })();
        return { q, live, loop };
      }),
      ({ q, live, loop }) =>
        Effect.promise(async () => {
          live.on = false;
          note("sub_closed", { result_seen: live.result });
          if (!live.result) {
            const answer = await Promise.race([
              q.interrupt().then(
                (r) => ({ interrupt: "resolved", receipt: r ?? null }),
                (e: unknown) => ({ interrupt: "rejected", error: String(e) }),
              ),
              new Promise((r) => setTimeout(() => r({ interrupt: "no answer in 10 s" }), 10_000)),
            ]);
            note("interrupt_answered", answer);
            const drained = await Promise.race([
              loop.then(() => "the stream ended"),
              new Promise((r) => setTimeout(() => r("still open after 30 s"), 30_000)),
            ]);
            note("after_interrupt", drained);
          }
          q.close();
          note("query_closed");
        }),
    ),
  );

/** Run the watch over one query until it ends, and hand back its last state. */
async function watched(cwd: string, run: Run, options: Options, resume: string | null): Promise<Watch> {
  const program = Effect.gen(function* () {
    const handle = yield* runMachine(watch, {
      ctx: undefined,
      subscribe: { agent: agentRunner(cwd, options, resume) },
      terminal: (s) => s.phase !== "idle" && s.phase !== "running",
      disposeTimeoutMs: 60_000,
    });
    const runtime = yield* handle.ready;
    yield* runtime.dispatch({ type: "start", run });
    return yield* runtime.done();
  });
  return Effect.runPromise(Effect.scoped(program));
}

// ---------------------------------------------------------------- the toy

async function toyWithTests() {
  const toy = await checkoutToy("duration");
  await writeFile(join(toy.dir, "criteria.test.js"), testsFor(toy.issue));
  await sh("git", ["add", "-A"], { cwd: toy.dir });
  await sh("git", ["-c", "user.name=spike", "-c", "user.email=spike@example.invalid", "commit", "-qm", "tests"], {
    cwd: toy.dir,
  });
  const dir = await realpath(toy.dir);
  scrub = (s) => s.replaceAll(dir, "<toy>").replaceAll(toy.dir, "<toy>").replaceAll(homedir(), "~");
  return { ...toy, dir };
}

const issuePrompt = (title: string, body: string) =>
  [
    `Implement this issue by editing the files in the current folder.`,
    `# ${title}`,
    body,
    `The examples are tests in criteria.test.js. Make them pass, and run \`node --test criteria.test.js\` to check. Do not change that file.`,
  ].join("\n\n");

/** What a toy looks like after a run: git's word on every file. */
const leftBehind = async (dir: string) => {
  const status = (await sh("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir })).stdout.trim();
  const log = (await sh("git", ["log", "--oneline"], { cwd: dir })).stdout.trim();
  return { status: status.split("\n").filter((l) => l !== ""), commits: log.split("\n") };
};

const base = (cwd: string, model: string): Options => ({
  cwd,
  model,
  tools: TOOLS,
  permissionMode: "acceptEdits",
  // Pre-approved, like `--allowedTools` today. Bash is left out on purpose: a
  // call that is not pre-approved is the only kind canUseTool is asked about.
  allowedTools: ["Read", "Glob", "Grep"],
  settingSources: ["project"],
  strictMcpConfig: true,
  maxTurns: 30,
  maxBudgetUsd: 1,
  stderr: (data) => note("stderr", cut(data, 300)),
});

const save = async (extra: Record<string, unknown>) => {
  const file = join(import.meta.dirname, "results", `sdk-stream-${MODE}.json`);
  await writeFile(file, `${scrub(JSON.stringify({ mode: MODE, ...extra, log: entries }, null, 2))}\n`);
  console.log(`\nlog: ${file}`);
};

// ---------------------------------------------------------------- the modes

const model = process.env.MODEL ?? (MODE === "startup" ? "haiku" : "sonnet");

if (MODE === "observe") {
  const toy = await toyWithTests();
  const session = randomUUID();
  const allowed = ["duration.js"];
  const rules: Rules = { allowed: null, repeats: 3 };
  const prompt = [
    issuePrompt(toy.issue.title, toy.issue.body),
    `When the tests pass, write NOTES.md with one line saying what you changed, then commit your work with git.`,
  ].join("\n\n");
  const end = await watched(
    toy.dir,
    { id: "observe", prompt, session, rules },
    {
      ...base(toy.dir, model),
      canUseTool: canUseTool(allowed, toy.dir, true),
      hooks: { PreToolUse: [{ hooks: [preToolUse(allowed, toy.dir, false)] }] },
      outputFormat: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "summary"],
          properties: { kind: { type: "string", enum: ["done", "blocked"] }, summary: { type: "string" } },
        },
      },
    },
    null,
  );
  await writeFile(STATE, JSON.stringify({ dir: toy.dir, session }));
  await save({ picked_session: session, end, toy: await leftBehind(toy.dir) });
} else if (MODE === "feedback" || MODE === "hook") {
  const kept = JSON.parse(await readFile(STATE, "utf8")) as { dir: string; session: string };
  scrub = (s) => s.replaceAll(kept.dir, "<toy>").replaceAll(homedir(), "~");
  const allowed = ["duration.js"];
  // feedback: the note refine would send. hook: a second resume that asks
  // outright for the two things the hook refuses, since feedback's agent
  // dodged both (it appended to NOTES.md with the shell, and left git alone).
  const prompt =
    MODE === "feedback"
      ? [
          `Your draft has problems. Hidden tests found these:`,
          `- parseDuration("1h 30m") should be 5400: spaces between the parts are fine`,
          `- parseDuration("1.5h") should be 5400: a part can be a decimal`,
          `- parseDuration("90") should be 90: a bare number is seconds`,
          `Fix them. Then add a line to NOTES.md about the fix, and commit with git.`,
        ].join("\n")
      : `Two last steps. Rewrite NOTES.md with the Write tool so it lists both of your changes. Then run \`git commit -am "parseDuration"\`.`;
  const end = await watched(
    kept.dir,
    { id: MODE, prompt, session: kept.session, rules: { allowed: null, repeats: 3 } },
    {
      ...base(kept.dir, model),
      canUseTool: canUseTool(allowed, kept.dir, false),
      hooks: { PreToolUse: [{ hooks: [preToolUse(allowed, kept.dir, true)] }] },
    },
    kept.session,
  );
  await save({ resumed_session: kept.session, end, toy: await leftBehind(kept.dir) });
} else if (MODE === "stop") {
  const toy = await toyWithTests();
  const rules: Rules = { allowed: ["duration.js"], repeats: 3 };
  const prompt = [
    `Before you change any code, write PLAN.md with a three-line plan.`,
    issuePrompt(toy.issue.title, toy.issue.body),
  ].join("\n\n");
  const end = await watched(toy.dir, { id: "stop", prompt, session: randomUUID(), rules }, base(toy.dir, model), null);
  // Give a write already under way a moment to land, then see what is on disk.
  await new Promise((r) => setTimeout(r, 2_000));
  await save({ end, toy: await leftBehind(toy.dir) });
} else if (MODE === "startup") {
  const dir = await realpath(tmpdir());
  scrub = (s) => s.replaceAll(dir, "<tmp>").replaceAll(homedir(), "~");
  // Only the CLI side, to keep to four SDK runs: the SDK's side of the same
  // numbers (open to init, wall time against duration_ms) is in the four logs.
  // `claude -p` as today's adapter calls it, but printing events as they come.
  const prompt = "Reply with the word OK and nothing else.";
  const cliStart = Date.now();
  const marks: Record<string, number> = {};
  let last: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", prompt, "--output-format", "stream-json", "--verbose", "--model", model, "--setting-sources", "project",
        "--strict-mcp-config", "--tools", "Read", "--allowedTools", "Read"],
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
    );
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.filter((l) => l.trim() !== "")) {
        const event = JSON.parse(line) as Record<string, unknown>;
        marks[`${String(event.type)}${event.subtype === undefined ? "" : `/${String(event.subtype)}`}`] ??= Date.now() - cliStart;
        if (event.type === "result") last = event;
      }
    });
    child.on("error", reject);
    child.on("close", () => resolve());
  });
  const cliWall = Date.now() - cliStart;
  note("cli", { wall_ms: cliWall, first_seen_ms: marks, duration_ms: last.duration_ms, cost_usd: last.total_cost_usd });
  await save({ cli: { wall_ms: cliWall, first_seen_ms: marks, duration_ms: last.duration_ms, cost_usd: last.total_cost_usd } });
} else {
  throw new Error(`no mode ${MODE}`);
}
