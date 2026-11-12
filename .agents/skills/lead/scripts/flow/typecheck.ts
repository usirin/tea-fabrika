// typecheck.ts: one host typecheck of a lane's reviewed head, merged with origin/main, before the
// lane opens its pull request. Today's lead tooling (0064). A step's box runs no `pnpm typecheck`,
// so twice on 2026-11-11 (pull requests 887 and 896) a lane ended merge-ready with type errors,
// and only CI found them. chain.ts runs this between review and the pull request:
//
//   green    the typecheck passed: the lane opens its pull request
//   red      it failed: the lane goes back to tests when every error is in an exam path
//            (exam-paths.json, read by step-commit's exam.py), else to build, with the error lines
//   skipped  it could not run (another typecheck never ended, git, the merge, the install, the
//            time limit): the lane goes on, and its last line says it did not run and why
//
// One run, in one scope (0061): a worktree of the main checkout at the head, merged with
// origin/main and not committed, with its own offline install (pnpm refuses a linked
// node_modules), removed when the scope closes. It waits while `pgrep -x tsgo` finds another
// typecheck, and runs under `nice -n 19`, each command within a time limit.

import { Duration, Effect, FileSystem, Option, Path, Schema } from "effect";
import { repoNode } from "../boxnode.ts";
import { commandArgv, exec, type Ran, worktree } from "./host.ts";

/** The result: passed, failed with where the work goes back to, or could not run and why. */
export const Verdict = Schema.TaggedUnion({
  green: {},
  red: { to: Schema.Literals(["tests", "build"]), lines: Schema.Array(Schema.String) },
  skipped: { reason: Schema.String },
});
export type Verdict = typeof Verdict.Type;

/**
 * Minutes the run may wait for another typecheck, and each of its install and check may run.
 * A whole `pnpm typecheck` took 11 s on the laptop on 2026-11-11 (65 s of CPU); twenty minutes,
 * the host step's limit, leaves room for a cold offline install and a long wait behind another,
 * and `CHAIN_TYPECHECK_MINUTES` overrides it.
 */
export const MINUTES = 20;

/** The typecheck did not run, and why. */
const notRun = (reason: string): Verdict => Verdict.cases.skipped.make({ reason });

/** The most error lines a red result carries to the next step. */
export const LINES = 30;

/** The most characters of one line; tsc writes a whole type on one line (PR 887's ran to 400). */
export const WIDTH = 240;

/** One type error: its file's path in the repo, and its text as the next step reads it. */
export type Found = { readonly path: string; readonly text: string };

// `pnpm -r` puts the package's folder before each line of its output.
const PREFIX = /^(\S+) typecheck: (.*)$/;
// tsc's plain format, the one it prints to a pipe: `file(line,col): error TSnnnn: message`.
const ERROR = /^(.+?)\(\d+,\d+\): error TS\d+: /;

/** `file` read from the folder `dir`, both in the repo, as one path with no `.` or `..`. */
const joined = (dir: string, file: string): string => {
  const parts: string[] = [];

  for (const part of `${dir}/${file}`.split("/")) {
    if (part === "..") {
      parts.pop();
    } else if (part !== "" && part !== ".") {
      parts.push(part);
    }
  }

  return parts.join("/");
};

/**
 * The type errors in `pnpm typecheck`'s output, run in the repo at `root`: each with its file's
 * repo path and its text, the message's indented lines included.
 */
export const errorsIn = (output: string, root: string): ReadonlyArray<Found> => {
  const found: Array<{ path: string; text: string }> = [];
  // The error whose message may go on (-1: none), and its package's folder: `pnpm -r` mixes
  // packages' lines.
  let open = -1;
  let from = "";

  for (const raw of output.split("\n")) {
    const prefixed = PREFIX.exec(raw);
    const dir = prefixed?.[1] ?? ".";
    const rest = prefixed?.[2] ?? raw;
    const error = ERROR.exec(rest);
    // A path inside the worktree is written from the repo's root, so no laptop path rides along.
    const text = rest.replaceAll(`${root}/`, "");
    const entry = found[open];

    if (error === null) {
      // tsc indents the lines that go on with the message above it.
      if (entry !== undefined && from === dir && /^\s+\S/.test(text)) {
        entry.text = `${entry.text}\n${text}`;
      } else if (from === dir) {
        open = -1;
      }

      continue;
    }

    const file = error[1] ?? "";
    const outside = file.startsWith("/") ? file : joined(dir, file);
    const path = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : outside;
    found.push({ path, text: `${path}${rest.slice(file.length).replaceAll(`${root}/`, "")}` });
    open = found.length - 1;
    from = dir;
  }

  return found;
};

/**
 * The Check, pure: what one `pnpm typecheck` run means for the lane. Exit 0 is green. A failure
 * with error lines is red, sent to tests when every error's path is in `exam`, else to build, with
 * at most `LINES` lines. A failure with no error line is no answer about the code, so it is
 * skipped with the output's last line.
 */
export const verdict = (ran: Ran, errors: ReadonlyArray<Found>, exam: ReadonlySet<string>): Verdict => {
  if (ran.code === 0) {
    return Verdict.cases.green.make({});
  }

  if (errors.length === 0) {
    const last = ran.output.trim().split("\n").at(-1) ?? "";
    return notRun(`pnpm typecheck exited ${ran.code} with no error line: ${last}`);
  }

  const to = errors.every((e) => exam.has(e.path)) ? "tests" : "build";
  const cut = (line: string) => (line.length > WIDTH ? `${line.slice(0, WIDTH - 3)}...` : line);
  const all = errors.flatMap((e) => e.text.split("\n")).map(cut);
  const more = `... and ${all.length - LINES + 1} more lines`;
  const lines = all.length > LINES ? [...all.slice(0, LINES - 1), more] : all;
  return Verdict.cases.red.make({ to, lines });
};

/** One line for the lane's log: green, red with where it goes and its first line, or why not. */
export const summary = (v: Verdict): string =>
  v._tag === "green" ? "green" : v._tag === "red" ? `red, to ${v.to}: ${v.lines[0] ?? ""}` : `did not run: ${v.reason}`;

/** What one typecheck run needs: the main checkout, the boxes folder, the lane and its head. */
export type Args = {
  readonly main: string;
  readonly boxes: string;
  readonly lane: string;
  readonly head: string;
  readonly minutes: number;
};

/** What every command here runs without: no paid key (AGENTS.md, Checks). */
const ENV = { TYPESAFE_API_KEY: undefined };

/** Wait while another typecheck runs: `pgrep -x tsgo`, never `-f`, which finds its own shell. */
const another = Effect.fn("typecheck.another")(function* (main: string) {
  while ((yield* exec(main, "pgrep", ["-x", "tsgo"])).code === 0) {
    yield* Effect.sleep("20 seconds");
  }
});

/** `line` in `dir` under the repo's Node, within `minutes`; `None` when it ran past them. */
const within = (dir: string, line: string, node: string | null, minutes: number) => {
  const [command, ...args] = commandArgv(line, node);
  return exec(dir, command, args, ENV).pipe(Effect.timeoutOption(Duration.minutes(minutes)));
};

/** The exam paths among `paths`, by step-commit's exam.py and the tree's own exam-paths.json. */
const examIn = Effect.fn("typecheck.examIn")(function* (dir: string, paths: ReadonlyArray<string>) {
  const path = yield* Path.Path;
  const skills = path.join(import.meta.dirname, "..", "..", "..");
  const script = path.join(skills, "step-commit", "scripts", "exam.py");
  const list = path.join(dir, "exam-paths.json");
  const ran = yield* exec(dir, "python3", ["-I", script, list, ...paths]);
  // 0 is no exam path and 1 lists them; anything else read no list, so no error counts as exam.
  const listed = ran.code === 1 ? ran.output.split("\n").filter(Boolean) : [];
  return new Set(listed.map((l) => l.split("\t")[0] ?? l));
});

const tail = (output: string) => output.trim().split("\n").slice(-3).join(" | ");

/** One typecheck of `head` merged with origin/main, start to end in one scope; never fails. */
export const run = Effect.fn("typecheck.run")(
  function* (a: Args) {
    if (!/^[0-9a-f]{40}$/.test(a.head)) {
      return notRun(`the lane has no head to check (${a.head || "none"})`);
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const waited = yield* another(a.main).pipe(Effect.timeoutOption(Duration.minutes(a.minutes)));

    if (Option.isNone(waited)) {
      return notRun(`another typecheck (tsgo) still ran after ${a.minutes} minutes`);
    }

    const fetched = yield* exec(a.main, "git", ["-C", a.main, "fetch", "-q", "origin", "main"]);

    if (fetched.code !== 0) {
      return notRun(`git fetch origin main failed: ${tail(fetched.output)}`);
    }

    const dir = yield* worktree(a.main, path.join(a.boxes, `${a.lane}-typecheck`), a.head);
    // Not committed, so no name or signer is needed: the tree is what a merge would hold.
    const merge = ["merge", "-q", "--no-commit", "--no-ff", "origin/main"];
    const merged = yield* exec(dir, "git", merge);

    if (merged.code !== 0) {
      const at = a.head.slice(0, 8);
      return notRun(`merging origin/main into ${at} failed: ${tail(merged.output)}`);
    }

    const node = yield* repoNode(dir);
    const install = "nice -n 19 pnpm install --offline --frozen-lockfile --silent";
    const installed = yield* within(dir, install, node, a.minutes);

    if (Option.isNone(installed) || installed.value.code !== 0) {
      const late = `ran past ${a.minutes} minutes`;
      const why = Option.isNone(installed) ? late : tail(installed.value.output);
      return notRun(`\`${install}\` failed: ${why}`);
    }

    const checked = yield* within(dir, "nice -n 19 pnpm typecheck", node, a.minutes);

    if (Option.isNone(checked)) {
      return notRun(`pnpm typecheck ran past its ${a.minutes}-minute limit and was stopped`);
    }

    const log = path.join(a.boxes, `${a.lane}-typecheck.log`);
    yield* fs.writeFileString(log, checked.value.output).pipe(Effect.ignore);
    const errors = errorsIn(checked.value.output, dir);
    const paths = [...new Set(errors.map((e) => e.path))];
    const exam = paths.length === 0 ? new Set<string>() : yield* examIn(dir, paths);
    return verdict(checked.value, errors, exam);
  },
  Effect.scoped,
  Effect.catchTag("StepFailed", ({ reason }) => Effect.succeed(notRun(reason))),
);
