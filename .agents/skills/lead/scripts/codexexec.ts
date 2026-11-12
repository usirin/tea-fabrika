// codexexec.ts: the plain way to run a Codex step, the `codex-exec` rows of agents.ts's provider
// table. Today's lead tooling, run on our own laptop; it is not product. It runs the installed
// `codex exec` as a person would from a shell, on the user's own Codex config and home, as an
// adapter of today's agents interface (`Agent.Adapter`), so the session map, the clock, the tool
// count and the stop come from `Agent.makeAgents` unchanged.
//
//   codex exec --json -o <last> -C <folder> -m <model> -c model_reasoning_effort="medium" \
//     -c sandbox_mode="workspace-write" -c allow_login_shell=false -c approval_policy="never" \
//     -c developer_instructions="..." \
//     [resume <thread>] <prompt>
//
// Why next to the ACP rows: on this laptop the ACP adapter's Codex turns ended after about 90
// seconds and 10 tool calls, unfinished, while this call, measured on the same step prompt, ran
// 345 seconds and 32 tools to a done answer. The ACP row runs a bundled Codex in workspace-write
// with approvals `on-request`; this one runs the installed CLI with approvals `never`.
//
// What it gives up next to the ACP row, on purpose (owner, 2026-11-11: make it work first, it only
// runs on his own laptop): no private Codex home, no permission profile of ours, no keep-list of
// the environment, and the user's own config, skills and rules. Its only fence is Codex's own
// sandbox: `workspace-write` (the folder and temp folders, no network) or `read-only`.
//
// A turn is done when Codex wrote a last message (`-o`), as the shell wrapper it copies says. The
// last message file lives in a temp folder the turn's scope gives back.
//
// A command's shell is never a login shell: `-c allow_login_shell=false` (Codex's own key, its
// config reference). Codex's default runs each command as `zsh -lc`, or sources a snapshot of a
// login shell, and a login shell's startup files put Homebrew's or a version manager's folders
// before the pinned Node that `boxEnv` put first, so vitest refused to start on Node 22 and steps
// answered for laws they never ran (field, 2026-11-11). Before each turn, `probeArgs` asks the
// same shell, in Codex's own sandbox (`codex sandbox`) and with the same overrides, which Node it
// finds, and a turn whose shell finds another than the pin fails to start, before any model call.

import { Agent } from "@kampus/fabrika-old";
import { rawOfLine } from "@kampus/fabrika-old/agents/codex";
import { Effect, FileSystem, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { holdsPin, NODE_PROBE } from "./boxnode.ts";

/** What a turn may do in its folder: change it, or only read it (a plan, a review). */
export type Access = "write" | "read";

export interface CodexExecConfig {
  readonly access: Access;
  /** The whole environment Codex runs in: the caller's, as `boxEnv` gives it. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * The Node the repo pins (`repoNode`), which the box's shell must find before a turn starts;
   * `null` when the repo pins none, and then nothing is asked.
   */
  readonly pin: string | null;
  /** The program to start; a bare name is found on the env's PATH. */
  readonly codex?: string;
}

/** The words the shell wrapper retries on: Codex's servers were full, never a fault of the step. */
export const CAPACITY = /at capacity|rate limit|503|overloaded/i;

/** A config value as TOML: a JSON string is a TOML basic string, but for DEL, which TOML takes only escaped. */
const tomlText = (text: string) => JSON.stringify(text).replaceAll("\x7f", "\\u007f");

/**
 * How Codex runs a command, the same for a turn and for its probe: the sandbox, and a shell that
 * is never a login shell, so no profile sets the PATH again (see the top).
 */
export const routeArgs = (access: Access): string[] => [
  "-c",
  `sandbox_mode=${tomlText(access === "write" ? "workspace-write" : "read-only")}`,
  "-c",
  "allow_login_shell=false",
];

/** The probe's command line: `NODE_PROBE` in `shell`, in Codex's own sandbox, on `routeArgs`. */
export const probeArgs = (access: Access, shell: string): string[] => [
  "sandbox",
  ...routeArgs(access),
  "--",
  shell,
  "-c",
  NODE_PROBE,
];

export interface ExecAsk {
  readonly access: Access;
  readonly folder: string;
  readonly prompt: string;
  /** Codex's own thread to carry on, or `null` to start one. */
  readonly resume: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  /** Text added after Codex's own instructions (`developer_instructions`); `null` for none. */
  readonly system: string | null;
  /** Where Codex writes its last message. */
  readonly last: string;
}

/**
 * The command line, pure. Every option goes before `resume`, where `codex exec` reads them for
 * both forms: `resume` has no `--sandbox` or `--cd` of its own, so the sandbox is the config key
 * `sandbox_mode`, the same in both. The prompt is the last argument, as the wrapper passes it; a
 * prompt that starts with `-` gets a line end first, so it is never read as a flag.
 */
export const execArgs = (a: ExecAsk): string[] => [
  "exec",
  "--json",
  "-o",
  a.last,
  "-C",
  a.folder,
  ...(a.model === null ? [] : ["-m", a.model]),
  ...(a.effort === null ? [] : ["-c", `model_reasoning_effort=${tomlText(a.effort)}`]),
  ...routeArgs(a.access),
  "-c",
  'approval_policy="never"',
  ...(a.system === null || a.system.trim() === "" ? [] : ["-c", `developer_instructions=${tomlText(a.system)}`]),
  ...(a.resume === null ? [] : ["resume", a.resume]),
  a.prompt.startsWith("-") ? `\n${a.prompt}` : a.prompt,
];

const ErrorEvent = Schema.Struct({ type: Schema.Literal("error"), message: Schema.String });
const readError = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorEvent));

// Today's library's `Raw` is a plain union with no Schema maker, so its two values here are written out.
/** The end of a turn whose last message exists but whose stream said no `turn.completed`. */
// oxlint-disable-next-line fabrika/no-hand-tag -- edge: today's `Agent.Raw` is a plain union, with no maker to call
const ENDED: Agent.Raw = { _tag: "ended", stop: "end_turn", structured: undefined, usd: null, requests: null };

/** The last message file's text, as the turn's last word. */
// oxlint-disable-next-line fabrika/no-hand-tag -- edge: today's `Agent.Raw` is a plain union, with no maker to call
const lastWord = (text: string): Agent.Raw => ({ _tag: "said", text });

/** The tail kept of what Codex said went wrong, for a failure's message and the capacity check. */
const TAIL = 2_000;

/**
 * Asks the box's shell which Node it finds, on the turn's own route, and fails the start unless it
 * is the pin. The shell is the user's (`SHELL`), the one Codex runs commands in.
 */
const probe = (config: CodexExecConfig, folder: string) =>
  Effect.gen(function* () {
    if (config.pin === null) {
      return;
    }

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const args = probeArgs(config.access, config.env.SHELL ?? "/bin/sh");
    const said = yield* spawner
      .string(
        ChildProcess.make(config.codex ?? "codex", args, {
          cwd: folder,
          env: config.env,
          extendEnv: false,
          stdin: "ignore",
        }),
      )
      .pipe(
        Effect.timeout("30 seconds"),
        Effect.orElseSucceed(() => ""),
      );

    if (!holdsPin(said, config.pin)) {
      return yield* Effect.fail(
        Agent.failed(
          "start",
          `the box's shell finds no Node ${config.pin}, so a test run there would be refused: ` +
            `\`${NODE_PROBE}\` printed ${JSON.stringify(said.trim())}`,
        ),
      );
    }
  });

/** `codex exec` as an adapter of the agents interface. */
export const codexExecAdapter = (
  config: CodexExecConfig,
): Effect.Effect<Agent.Adapter, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fs = yield* FileSystem.FileSystem;
    return {
      name: "codex-exec",
      // No dollar cap on a plan. No `--output-schema`: it would make the last message the answer
      // alone, and the step's report is the words before it. The interface adds the schema to the
      // prompt instead, and reads the answer from the last message.
      holds: { usd: false, schema: false },
      start: (turn) =>
        Effect.gen(function* () {
          if (turn.system._tag === "replace") {
            return yield* Effect.fail(Agent.failed("start", "codex-exec takes only an append system prompt"));
          }

          yield* probe(config, turn.folder).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          );

          const dir = yield* fs
            .makeTempDirectoryScoped({ prefix: "codex-exec-" })
            .pipe(Effect.mapError((e) => Agent.failed("start", String(e))));
          const last = `${dir}/last.md`;
          const args = execArgs({
            access: config.access,
            folder: turn.folder,
            prompt: turn.prompt,
            resume: turn.resume,
            model: turn.model,
            effort: turn.effort,
            system: turn.system.text,
            last,
          });
          const handle = yield* spawner
            .spawn(
              ChildProcess.make(config.codex ?? "codex", args, {
                cwd: turn.folder,
                env: config.env,
                extendEnv: false,
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              }),
            )
            .pipe(
              Effect.mapError((e) => Agent.failed("start", String(e))),
              // A refusal Node throws (E2BIG, a prompt past what one command may carry) is a turn
              // that could not start, never a defect that ends the run that asked.
              Effect.catchDefect((defect) => Effect.fail(Agent.failed("start", String(defect)))),
            );
          // What went wrong, from both sides: Codex's `error` events (it says capacity there) and its stderr.
          const said = { errors: "", stderr: "", ended: null as Agent.Raw | null };
          const trouble = () => `${said.errors}\n${said.stderr}`.trim().slice(-TAIL);
          yield* handle.stderr.pipe(
            Stream.decodeText(),
            Stream.runForEach((text) =>
              Effect.sync(() => {
                said.stderr = (said.stderr + text).slice(-TAIL);
              }),
            ),
            Effect.ignore,
            Effect.forkScoped,
          );
          const updates = handle.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.mapError((e) => Agent.failed("broke", String(e))),
            Stream.mapEffect((line) => {
              const error = readError(line);

              if (Option.isSome(error)) {
                said.errors = `${said.errors}\n${error.value.message}`.slice(-TAIL);
              }

              const raws = rawOfLine(line);

              if (!Array.isArray(raws)) {
                return Effect.fail(Agent.failed("broke", `${raws.broke}; ${trouble()}`));
              }

              // The end waits for the last message file, which Codex writes on its way out.
              said.ended = raws.find((r) => r._tag === "ended") ?? said.ended;
              return Effect.succeed(raws.filter((r) => r._tag !== "ended"));
            }),
            Stream.flattenIterable,
          );
          // Done means a last message exists. Its text is the turn's last word, then the end.
          const finish = Effect.gen(function* () {
            const code = yield* handle.exitCode.pipe(Effect.orElseSucceed(() => -1));
            const text = yield* fs.readFileString(last).pipe(Effect.orElseSucceed(() => ""));

            if (text.trim() === "") {
              return yield* Effect.fail(
                Agent.failed("broke", `codex exited (${code}) with no last message: ${trouble()}`),
              );
            }

            return [lastWord(text), said.ended ?? ENDED];
          });
          return {
            updates: Stream.concat(updates, Stream.fromEffect(finish).pipe(Stream.flattenIterable)),
            pid: handle.pid,
            // SIGINT, never SIGTERM: on SIGTERM Codex dies and leaves its command running (experiment 152).
            stop: handle
              .kill({ killSignal: "SIGINT" })
              .pipe(Effect.andThen(handle.exitCode), Effect.timeout("3 seconds"), Effect.ignore),
          } satisfies Agent.Running;
        }),
    } satisfies Agent.Adapter;
  });
