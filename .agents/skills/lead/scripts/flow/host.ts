// host.ts: the host step, which runs a lane's Electron laws and retakes its shots on the laptop,
// outside any box. Today's lead tooling (0064). A box has no screen and no network (0045), so a
// ticket that changes a program's window names its host commands in the lane brief:
//
//   ## host
//
//   ```sh
//   cd apps/fabrika && nice -n 15 node build.ts
//   cd apps/fabrika && SHOTS=../../programs/ticket/docs/ask-desk nice -n 15 node e2e.ts --ask-desk
//   ```
//
// Write the commands with a plain `node` and `pnpm`: the step runs each one under the repo's own
// Node (`volta run --node <version>`, the version from the root package.json; `commandArgv`).
//
// chain.ts runs this step between build and review, and the flow runner can run it too
// (`Step.act("host", args)`). It answers in the five verbs:
//
//   skip   no command: the lane brief has no `## host` section
//   done   every command exited 0 at the head; any file they changed is one signed build commit,
//          pushed to the lane's -wip branch, so review sees it at the head it reviews
//   send   to build, with the last lines of the command that failed or ran past its time limit
//   stuck  the worktree, the commit or the push failed
//
// One run, all in one scope (0061): the laptop's Electron lock (drive.ts's `state/electron.lock`,
// one pid in it: a live holder is waited on, a dead one's lock taken over), a worktree of the main
// checkout at the head, a short temp folder for `FABRIKA_HOME` and `TMPDIR` (a socket path has a
// 103-byte limit), and each command's process group, killed when its time limit ends. The window
// rules are the app's own: a start with a `FABRIKA_HOME` and no `FABRIKA_FOREGROUND` is quiet
// (apps/fabrika/src/launch.ts), so this step sets the one and removes the other.

import { Duration, Effect, FileSystem, Option, Path, Schedule, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { wipOf } from "../lane.ts";
import * as Outcome from "./Outcome.ts";
import { type Runner, StepFailed } from "./Runners.ts";

/**
 * Minutes each host command may run, when the brief names none. The hand host runs of lane
 * askdesk7 took 84 s (e2e.ts --ask-desk) and 62 s (the shots' vitest run); twenty minutes leaves
 * room for a whole e2e.ts run and a cold install, and `CHAIN_HOST_MINUTES` overrides it.
 */
export const MINUTES = 20;

/** The install every fresh worktree needs before a command runs, as box.sh does it. */
export const INSTALL = "nice -n 15 pnpm install --frozen-lockfile --silent";

/** Lines of a failed command's output that ride in the reason. */
const TAIL = 20;

/**
 * The commands a lane brief's `## host` section names: each line inside its fenced code blocks,
 * with blank lines and `#` comments left out. Prose outside a fence is never run.
 */
export const hostCommands = (section: string | undefined): ReadonlyArray<string> => {
  const commands: string[] = [];
  let fenced = false;

  for (const raw of (section ?? "").split("\n")) {
    const line = raw.trim();

    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }

    if (fenced && line !== "" && !line.startsWith("#")) {
      commands.push(line);
    }
  }

  return commands;
};

/**
 * What every host command's environment changes: its own home and temp folder, and no foreground
 * window or paid key. Each `undefined` removes that name from the inherited environment.
 */
export const hostEnv = (tmp: string): Readonly<Record<string, string | undefined>> => ({
  FABRIKA_HOME: `${tmp}/home`,
  TMPDIR: tmp,
  FABRIKA_FOREGROUND: undefined,
  TYPESAFE_API_KEY: undefined,
});

/** Git with no hooks and no fsmonitor, as drive.ts runs it on a step's tree. */
const SAFE_GIT = {
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsmonitor",
  GIT_CONFIG_VALUE_1: "false",
};

export const HostArgs = Schema.Struct({
  /** The main checkout: its git data holds the lane's branch, and its signer signs. */
  main: Schema.String,
  boxes: Schema.String,
  lane: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)),
  ticket: Schema.String,
  branch: Schema.String.check(Schema.isStartingWith("fabrikalfa/")),
  /** The lane's approved plan, whose owner rows the step commit checks. */
  plan: Schema.String,
  head: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  round: Schema.Int,
  commands: Schema.Array(Schema.String),
  minutes: Schema.Number.check(Schema.isGreaterThan(0)),
});
export type HostArgs = typeof HostArgs.Type;

/** What the host step hands back: its outcome, the head after it, and its log. */
export type Hosted = { readonly outcome: Outcome.Outcome; readonly head: string; readonly log: string | null };

/** Another live process holds the lock; the take is tried again on its schedule. */
class Held extends Schema.TaggedError<Held>()("Held", { pid: Schema.Number }) {}

const alive = (pid: number) =>
  Effect.try({ try: () => process.kill(pid, 0), catch: () => "gone" }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

/**
 * One Electron app at a time on the laptop: drive.ts's lock file, holding the owner's pid. While a
 * live process holds it, the take waits and tries again `every`; a dead owner's lock is taken
 * over. The scope gives it back.
 */
export const electronLock = Effect.fn("host.electronLock")(function* (lock: string, every: Duration.Input) {
  const fs = yield* FileSystem.FileSystem;
  const write = fs.writeFileString(lock, String(process.pid), { flag: "wx" }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
  const take = Effect.gen(function* () {
    if (yield* write) {
      return;
    }

    const owner = Number((yield* fs.readFileString(lock).pipe(Effect.orElseSucceed(() => ""))).trim());

    if (Number.isInteger(owner) && owner > 0 && (yield* alive(owner))) {
      return yield* new Held({ pid: owner });
    }

    yield* fs.remove(lock, { force: true }).pipe(Effect.ignore);

    if (!(yield* write)) {
      return yield* new Held({ pid: 0 });
    }
  });
  // `Schedule.spaced` never ends, so a held lock is waited on for as long as it is held, and `Held`
  // never leaves the retry.
  const waited = take.pipe(Effect.retry({ schedule: Schedule.spaced(every) }), Effect.orDie);
  yield* Effect.acquireRelease(waited, () => fs.remove(lock, { force: true }).pipe(Effect.ignore));
});

/** One command's end: its exit code, and stdout and stderr as one text. */
export type Ran = { readonly code: number; readonly output: string };

/** One command in `dir` with safe git, run to its end; ./typecheck.ts runs it too. */
export const exec = Effect.fn("host.exec")(
  function* (
    dir: string,
    command: string,
    args: ReadonlyArray<string>,
    env: Readonly<Record<string, string | undefined>> = {},
  ) {
    const handle = yield* ChildProcess.make(command, args, { cwd: dir, env: { ...SAFE_GIT, ...env }, extendEnv: true });
    const [output, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode], {
      concurrency: 2,
    });
    return { code: Number(code), output } satisfies Ran;
  },
  Effect.scoped,
  (effect, dir, command) =>
    Effect.mapError(effect, () => new StepFailed({ reason: `${command} could not start in ${dir}` })),
);

/**
 * How one host command starts: through `sh -c`, under `volta run --node <node>` when the repo names
 * its Node. Volta takes a folder's Node from its nearest package.json, and `apps/fabrika`'s names
 * none, so a command there ran the laptop's default Node (22 on askdesk7's hand run, where the repo
 * pins 26.13.0). Under `volta run`, every `node` and `pnpm` the line starts is the repo's.
 */
export const commandArgv = (line: string, node: string | null): readonly [string, ...string[]] =>
  node === null ? ["sh", "-c", line] : ["volta", "run", "--node", node, "sh", "-c", line];

/** The repo's Node: the root package.json's `volta.node`, else its `engines.node`; `null` when neither. */
export const repoNode = Effect.fn("host.repoNode")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(`${dir}/package.json`).pipe(Effect.orElseSucceed(() => ""));
  const pinned = Schema.decodeUnknownOption(Schema.fromJsonString(Pins))(text);
  return Option.isNone(pinned) ? null : (pinned.value.volta?.node ?? pinned.value.engines?.node ?? null);
});

/** An exact version, as `pnpm lint` keeps every pin: never a range for `volta run`. */
const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/));

const Pins = Schema.Struct({
  volta: Schema.optional(Schema.Struct({ node: Schema.optional(Version) })),
  engines: Schema.optional(Schema.Struct({ node: Schema.optional(Version) })),
});

/** One host command in `dir` (`commandArgv` says how), its output appended to `log`; its exit code. */
const runLine = Effect.fn("host.runLine")(
  function* (
    dir: string,
    line: string,
    env: Readonly<Record<string, string | undefined>>,
    log: string,
    node: string | null,
  ) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(log, `$ ${line}\n`, { flag: "a" });
    const [command, ...args] = commandArgv(line, node);
    // Its own process group (the spawner's default), so the scope's end stops everything it started.
    const handle = yield* ChildProcess.make(command, args, {
      cwd: dir,
      env,
      extendEnv: true,
      forceKillAfter: "10 seconds",
    });
    const [, code] = yield* Effect.all([Stream.run(handle.all, fs.sink(log, { flag: "a" })), handle.exitCode], {
      concurrency: 2,
    });
    return Number(code);
  },
  Effect.scoped,
  (effect, _dir, line) => Effect.mapError(effect, () => new StepFailed({ reason: `\`${line}\` could not start` })),
);

/** The last lines of the log, for a reason. */
const logTail = Effect.fn("host.logTail")(function* (log: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(log).pipe(Effect.orElseSucceed(() => ""));
  return text.trimEnd().split("\n").slice(-TAIL).join("\n");
});

/**
 * Run `lines` in order in `dir`, each within `minutes`. The first that exits non-zero or runs past
 * its limit sends the lane to build with the log's last lines, as a red check would; `null` when
 * every line exited 0.
 */
export const runCommands = Effect.fn("host.runCommands")(function* (
  dir: string,
  lines: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>>,
  log: string,
  minutes: number,
  node: string | null = null,
) {
  for (const line of lines) {
    const ended = yield* runLine(dir, line, env, log, node).pipe(Effect.timeoutOption(Duration.minutes(minutes)));

    if (Option.isNone(ended)) {
      const tail = yield* logTail(log);
      return Outcome.send("build", `host: \`${line}\` ran past its ${minutes}-minute limit and was stopped:\n${tail}`);
    }

    if (ended.value !== 0) {
      const tail = yield* logTail(log);
      return Outcome.send("build", `host: \`${line}\` exited ${ended.value}:\n${tail}`);
    }
  }

  return null;
});

/** A worktree of the main checkout at `head`, detached; the scope removes it. */
export const worktree = Effect.fn("host.worktree")(function* (main: string, dir: string, head: string) {
  const git = (...args: ReadonlyArray<string>) => exec(main, "git", ["-C", main, ...args]);
  // A run killed with SIGKILL ran no finalizer: its worktree goes first.
  yield* git("worktree", "remove", "--force", dir).pipe(Effect.ignore);
  yield* Effect.acquireRelease(
    git("worktree", "add", "-q", "--detach", dir, head).pipe(
      Effect.flatMap((r) =>
        r.code === 0 ? Effect.void : Effect.fail(new StepFailed({ reason: `git worktree add failed: ${r.output}` })),
      ),
    ),
    () => git("worktree", "remove", "--force", dir).pipe(Effect.ignore),
  );
  return dir;
});

/** The files the commands changed, added or removed, one path each (untracked folders listed by file). */
export const changedPaths = (porcelain: string): ReadonlyArray<string> =>
  porcelain
    .split("\0")
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3));

/**
 * The facts stepcommit.sh checks for a box, written for this run's name and removed with the scope,
 * so the step commit checks the plan's owner rows as a box's would. Its `plan-sha256` is box.sh's:
 * the plan's body after its first two lines.
 */
const boxFacts = Effect.fn("host.boxFacts")(function* (a: HostArgs, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const plan = yield* fs
    .readFile(a.plan)
    .pipe(Effect.mapError(() => new StepFailed({ reason: `the plan ${a.plan} cannot be read` })));
  const first = plan.indexOf(10);
  const second = first === -1 ? -1 : plan.indexOf(10, first + 1);
  const body = second === -1 ? new Uint8Array() : plan.subarray(second + 1);
  const digest = yield* Digest.Digest;
  const sha = yield* digest.digestHex(Digest.sha256, body);
  const facts = path.join(a.boxes, "state", `${name}.box`);
  const text = [
    `ticket: ${a.ticket}`,
    `branch: ${a.branch}`,
    `base: ${a.head}`,
    `plan: ${a.plan}`,
    `plan-sha256: ${sha}`,
  ];
  yield* Effect.acquireRelease(
    fs
      .writeFileString(facts, `${text.join("\n")}\n`)
      .pipe(Effect.mapError(() => new StepFailed({ reason: `${facts} cannot be written` }))),
    () => fs.remove(facts, { force: true }).pipe(Effect.ignore),
  );
}, Effect.provide(Digest.layerWebCrypto));

const short = (sha: string) => sha.slice(0, 8);

/** The host step, start to end in one scope. See the header for what each outcome means. */
export const host = Effect.fn("host.run")(function* (a: HostArgs) {
  if (a.commands.length === 0) {
    return {
      outcome: Outcome.skip("the lane brief has no `## host` section, so no host command ran"),
      head: a.head,
      log: null,
    } satisfies Hosted;
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const name = `${a.lane}-host${a.round}`;
  const log = path.join(a.boxes, `${name}.log`);
  const scripts = path.join(import.meta.dirname, "..");
  yield* fs
    .writeFileString(log, `host ${name} at ${a.head}\n`)
    .pipe(Effect.mapError(() => new StepFailed({ reason: `${log} cannot be written` })));
  yield* electronLock(path.join(a.boxes, "state", "electron.lock"), "20 seconds");
  const dir = yield* worktree(a.main, path.join(a.boxes, name), a.head);
  const tmp = yield* fs
    .makeTempDirectoryScoped({ directory: "/tmp", prefix: "fh" })
    .pipe(Effect.mapError(() => new StepFailed({ reason: "no temp folder in /tmp" })));
  yield* fs.makeDirectory(`${tmp}/home`).pipe(Effect.mapError(() => new StepFailed({ reason: `${tmp}/home` })));
  const node = yield* repoNode(dir);
  yield* fs
    .writeFileString(log, `node: ${node ?? "the laptop's own (the repo names none)"}\n`, { flag: "a" })
    .pipe(Effect.mapError(() => new StepFailed({ reason: `${log} cannot be written` })));
  const failed = yield* runCommands(dir, [INSTALL, ...a.commands], hostEnv(tmp), log, a.minutes, node);
  const ran = `${a.commands.length} host commands`;

  if (failed !== null) {
    return { outcome: failed, head: a.head, log } satisfies Hosted;
  }

  const status = yield* exec(dir, "git", ["status", "--porcelain", "-z", "--untracked-files=all", "--no-renames"]);
  const paths = changedPaths(status.output);

  if (status.code !== 0) {
    return { outcome: Outcome.stuck(`git status failed: ${status.output}`), head: a.head, log } satisfies Hosted;
  }

  if (paths.length === 0) {
    return {
      outcome: Outcome.done(`${ran} passed at ${short(a.head)}; they changed no file`),
      head: a.head,
      log,
    } satisfies Hosted;
  }

  // One build commit, signed with main's own signer, as drive.ts signs a step whose tree a
  // command wrote (the commands ran the branch's code).
  yield* boxFacts(a, name);
  const subject = `T${a.ticket} build: the host run retook ${paths.length} files at ${short(a.head)}`;
  const stepcommit = path.join(scripts, "..", "..", "step-commit", "scripts", "stepcommit.sh");
  const committed = yield* exec(dir, "sh", [stepcommit, "build", a.ticket, subject, ...paths], {
    BOXES: a.boxes,
    STEPCOMMIT_BOX: name,
    STEPCOMMIT_SIGNER: `node ${path.join(a.main, "next/apps/fabrika/src/exam/commits.ts")}`,
  });

  if (committed.code !== 0) {
    return {
      outcome: Outcome.stuck(`stepcommit.sh exited ${committed.code}: ${committed.output.trim()}`),
      head: a.head,
      log,
    } satisfies Hosted;
  }

  const head = (yield* exec(dir, "git", ["rev-parse", "HEAD"])).output.trim();
  // Pushed before the branch moves, so a failed push leaves the lane where review would find it.
  const pushed = yield* exec(a.main, "node", [path.join(scripts, "botpush.mjs"), a.main, wipOf(a.branch), head]);

  if (pushed.code !== 0) {
    return {
      outcome: Outcome.stuck(`botpush.mjs exited ${pushed.code}: ${pushed.output.trim().split("\n").at(-1) ?? ""}`),
      head: a.head,
      log,
    } satisfies Hosted;
  }

  const moved = yield* exec(a.main, "git", ["-C", a.main, "update-ref", `refs/heads/${a.branch}`, head, a.head]);

  if (moved.code !== 0) {
    return { outcome: Outcome.stuck(`git update-ref failed: ${moved.output}`), head: a.head, log } satisfies Hosted;
  }

  return {
    outcome: Outcome.done(
      `${ran} passed at ${short(a.head)}; ${paths.length} changed files are build commit ${short(head)}, pushed`,
    ),
    head,
    log,
  } satisfies Hosted;
}, Effect.scoped);

/**
 * The host step's outcome as drive.ts names a step's in the lane's state file: `verb:to:reason`,
 * so readers of that file need no second shape.
 */
export const outcomeName = (o: Outcome.Outcome): string =>
  o._tag === "done" ? "done" : o._tag === "send" ? `send:${o.to}:host_failed` : `${o._tag}:host`;

/**
 * Write the host step's entry into the lane's state file (`state/<lane>.json`, drive.ts's), as a
 * step's: a done step that committed moves the lane's head, so the next step starts from it.
 */
export const recordInLane = Effect.fn("host.recordInLane")(function* (
  a: Pick<HostArgs, "boxes" | "lane" | "ticket" | "round" | "head">,
  hosted: Hosted,
  ended: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const state = path.join(a.boxes, "state", `${a.lane}.json`);
  const text = yield* fs.readFileString(state).pipe(Effect.orElseSucceed(() => ""));
  const saved: typeof LaneFile.Type = Schema.decodeUnknownOption(Schema.fromJsonString(LaneFile))(text).pipe(
    Option.getOrElse(() => ({ lane: a.lane, steps: [] })),
  );
  const done = hosted.outcome._tag === "done";
  const entry = {
    step: "host",
    box: `${a.lane}-host${a.round}`,
    run: `t${a.ticket}-host${a.round}`,
    from: a.head,
    head: hosted.head,
    outcome: outcomeName(hosted.outcome),
    // oxlint-disable-next-line fabrika/no-why-key -- drive.ts writes this file with today's key, and its readers read one shape
    why: hosted.outcome.reason,
    exit: hosted.outcome._tag === "stuck" ? 30 : 0,
    report: hosted.log,
    kept: false,
    ended,
  };
  const lane = { ...saved, head: done ? hosted.head : saved.head, steps: [...saved.steps, entry] };
  yield* fs.writeFileString(`${state}.tmp`, `${JSON.stringify(lane, null, "\t")}\n`);
  yield* fs.rename(`${state}.tmp`, state);
});

/** A host entry of the lane's state file, as `recordInLane` writes it. */
const HostEntry = Schema.Struct({
  step: Schema.Literal("host"),
  outcome: Schema.String,
  head: Schema.String,
  // oxlint-disable-next-line fabrika/no-why-key -- drive.ts writes this file with today's key, and its readers read one shape
  why: Schema.String,
});

/** The last host entry among the lane's state file's steps, as a review is told it; `null` when none ran. */
export const lastHost = (steps: ReadonlyArray<unknown>): string | null => {
  const last = steps.findLast(Schema.is(HostEntry));
  return last === undefined ? null : `${last.outcome} at ${last.head}: ${last.why}`;
};

/** The lane's state file, read loosely: what drive.ts wrote stays as it is. */
const LaneFile = Schema.StructWithRest(
  Schema.Struct({ lane: Schema.String, head: Schema.optional(Schema.String), steps: Schema.Array(Schema.Unknown) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

type Spawns = ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path;

/** The host runner for the flow runner, by step name: `Step.act("host", args)`. */
export const runners: Readonly<Record<string, Runner<Spawns>>> = {
  host: Effect.fn("host.runner")(function* (step) {
    const args = yield* Schema.decodeUnknownEffect(HostArgs)(step.args).pipe(
      Effect.mapError((e) => new StepFailed({ reason: `${step.name}'s args do not parse: ${e.message}` })),
    );
    return Outcome.answer((yield* host(args)).outcome);
  }),
};
