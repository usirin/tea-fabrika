import { homedir } from "node:os";
import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { runEnv } from "@kampus/fabrika-old/agents/sandbox";
import { cutKeys } from "@kampus/fabrika-old/agents/trace";
import { Context, Duration, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type Exited, runChild } from "../../child.ts";
import type { Checked } from "../../tickets/ticket.ts";
import { NOT_STARTED, tidyPaths, whyRed } from "../mutation/stryker.ts";
import { failuresOf, Report } from "../test-writer/results.ts";

// Code runs the repository's `[build] checks` itself, at a head, after every build
// (docs/plan/pipeline-self-fix.md, PR 4). The builder's own report decides nothing.
//
//   every command exits 0                      green
//   one exits non-zero                         red: each failing test by name where `{out}` has
//                                              vitest write its JSON report, else its last 40 lines
//   one cannot start, and again on one more    not_run: nothing says whether the head holds, so it
//   try, or runs past `within`                 is never green. A command that hangs is not tried again
//
// Each command runs in the head's own copy (in the lane, a git worktree made for the run), as the
// settings write it (with their own `nice`), with `runEnv`: no login in reach. `{out}` is a file in
// a folder of its own outside the copy, gone after the run, so the copy holds nothing new and a
// second run at the same head sees what the first did. `commands` keeps each as the settings say it,
// `{out}` and all, with its exit code and time. `tail` has the copy's folder as `.`, the home as `~`
// and each key cut: it goes on a public ticket.

type Command = readonly [string, ...string[]];

/** One run of the checks at a head: what the ticket keeps, and `tail`, what a person reads of why. */
export type CheckRun = Checked & { readonly tail: string };

/** Runs `[build] checks` at a head. It never fails: a command that could not run is `not_run`. */
export class CheckRunner extends Context.Service<
  CheckRunner,
  { readonly run: (head: string) => Effect.Effect<CheckRun> }
>()("CheckRunner") {}

export interface CheckSetup {
  /** Where `head` is checked out: its own copy. */
  readonly folder: (head: string) => string;
  readonly commands: readonly Command[];
  /** How long each command may run. Past it, it is stopped with all it started: `not_run`. */
  readonly within: Duration.Duration;
}

/** The last lines a red command with no test named shows, and a test writer's run that could not run (./tools.ts). */
export const TAIL_LINES = 40;

/** How long a stopped command's processes have after SIGTERM before SIGKILL. */
const KILL_AFTER = Duration.seconds(5);

/** What one command did: as `Checked` reads it, with its failing tests and why. */
type Did = {
  readonly result: Checked["result"];
  readonly failed: readonly string[];
  readonly why: string;
  readonly ran: Checked["commands"][number];
};

/** Every command's result as one: any not run is not run, else any red is red. Pure. */
const worst = (did: readonly Did[]): Checked["result"] =>
  did.some((d) => d.result === "not_run") ? "not_run" : did.some((d) => d.result === "red") ? "red" : "green";

/** Text that goes on a public ticket: the copy as `.`, the home as `~`, and no key. Pure. */
export const publicText = (text: string, folders: readonly string[] = []): string =>
  cutKeys(
    tidyPaths(
      folders.reduce((out, folder) => tidyPaths(out, folder, ""), text),
      "",
      homedir(),
    ),
  );

const checksAt = (setup: CheckSetup, head: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const ran = (did: readonly Did[]): CheckRun => ({
      head,
      commands: did.map((d) => d.ran),
      result: did.length === 0 ? "not_run" : worst(did),
      failed: did.flatMap((d) => d.failed),
      tail: did
        .map((d) => d.why)
        .filter((why) => why !== "")
        .join("\n"),
    });

    if (setup.commands.length === 0) {
      return {
        ...ran([]),
        tail: "[build] checks names no command, so nothing says whether this head holds.",
      };
    }

    const asked = setup.folder(head);
    // The real path: vitest names a test file by it, and a temp folder is a link on macOS.
    const real = yield* Effect.result(fs.realPath(asked));

    if (real._tag === "Failure") {
      return {
        ...ran([]),
        tail: `The copy of ${head} could not be read, so no check ran there.`,
      };
    }

    const folder = real.success;
    /** One try, stopped with all it started past `within`. `None`: it ran past. */
    const once = ([file, ...args]: readonly string[]): Effect.Effect<Option.Option<Exited>> =>
      Effect.provideService(
        runChild(file ?? "", args, { cwd: folder, env: runEnv(), forceKillAfter: KILL_AFTER }),
        ChildProcessSpawner.ChildProcessSpawner,
        spawner,
      ).pipe(Effect.timeoutOption(setup.within));
    /** One command, and once more if it could not start (`once`, a guess: docs/direction/jidoka-and-andon.md#bounds). */
    const one = (command: Command) =>
      Effect.gen(function* () {
        const said = command.join(" ");
        const reports = yield* Effect.result(fs.makeTempDirectoryScoped({ prefix: "checks-report-" }));

        if (reports._tag === "Failure") {
          return {
            result: "not_run",
            failed: [],
            why: `\`${said}\` did not run: no folder could be made for its report.`,
            ran: { command: said, code: null, ms: 0 },
          } satisfies Did;
        }

        const out = path.join(reports.success, "report.json");
        const words = command.map((word) => word.replaceAll("{out}", out));
        const [took, exited] = yield* Effect.timed(
          Effect.gen(function* () {
            const first = yield* once(words);
            return Option.isSome(first) && NOT_STARTED.has(first.value.code) ? yield* once(words) : first;
          }),
        );
        const ms = Math.round(Duration.toMillis(took));

        if (Option.isNone(exited)) {
          return {
            result: "not_run",
            failed: [],
            why: `\`${said}\` timed out: it ran past ${Duration.format(setup.within)}, and was stopped with all it started.`,
            ran: { command: said, code: null, ms },
          } satisfies Did;
        }

        const { code } = exited.value;
        const output = `${exited.value.out}${exited.value.err}`.replaceAll(out, "{out}");

        if (NOT_STARTED.has(code)) {
          return {
            result: "not_run",
            failed: [],
            why: `\`${said}\` could not start: ${output.trim().slice(0, 300)}`,
            ran: { command: said, code: null, ms },
          } satisfies Did;
        }

        if (code === 0) {
          return {
            result: "green",
            failed: [],
            why: "",
            ran: { command: said, code, ms },
          } satisfies Did;
        }

        // A report that is missing or does not read names none: it never turns red into green.
        const failures = command.some((word) => word.includes("{out}"))
          ? yield* fs.readFileString(out).pipe(
              Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Report))),
              Effect.map((report) => failuresOf(report, folder)),
              Effect.orElseSucceed(() => []),
            )
          : [];
        return {
          result: "red",
          failed: failures.map((f) => f.name),
          why: whyRed(failures, output, TAIL_LINES),
          ran: { command: said, code, ms },
        } satisfies Did;
      }).pipe(Effect.scoped);
    // One at a time, in the order written: each runs the whole suite in the same copy.
    const did = yield* Effect.forEach(setup.commands, one, { concurrency: 1 });
    const checked = ran(did);
    // The real folder and the one asked for: a temp folder is a link on macOS.
    return { ...checked, tail: publicText(checked.tail, [folder, asked]) };
  });

/** `CheckRunner` on this machine, with Effect's platform services as `@effect/platform-node` gives them. */
export const checkRunner = (setup: CheckSetup) =>
  Layer.effect(
    CheckRunner,
    Effect.gen(function* () {
      const services = yield* Effect.context<
        FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
      >();
      return { run: (head: string) => checksAt(setup, head).pipe(Effect.provide(services)) };
    }),
  ).pipe(Layer.provide(nodeServices));
