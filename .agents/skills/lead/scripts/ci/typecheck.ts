// typecheck.ts: what CI's `typecheck` job says about a lane's pushed head. Today's lead tooling
// (0064). No push waits on a laptop typecheck: CI runs it (0133), as its own job in check.yaml, so
// its answer comes the moment that one job ends, never after the whole run. chain.ts reads it right
// after the pull request opens, before loosening.sh:
//
//   green    the job passed: the lane goes on to loosening.sh
//   red      it failed with type errors: the lane goes back to tests when every error is in an
//            exam path (exam-paths.json, read by step-commit's exam.py), else to build, with the
//            error lines from the job's log
//   skipped  it could not be read, it failed with no type error, it ended another way (canceled,
//            skipped), or it did not end within the time limit: the lane goes on, and its last
//            line says the typecheck gave no answer and why
//
// The wait polls that one job's check run at the head, every `every` seconds, within `minutes`. A
// red `check` job (lint, build) is not this file's business: ci-required holds the merge for it.

import { Duration, Effect, Option, Path, Ref, Schedule, Schema } from "effect";
import { exec } from "../flow/host.ts";
import { Checks, type Job } from "./Checks.ts";

/** The result: passed, failed with where the work goes back to, or gave no answer and why. */
export const Verdict = Schema.TaggedUnion({
  green: {},
  red: { to: Schema.Literals(["tests", "build"]), lines: Schema.Array(Schema.String) },
  skipped: { reason: Schema.String },
});
export type Verdict = typeof Verdict.Type;

/** The job in check.yaml that runs `pnpm typecheck` alone; workflow-lint.ts holds it there. */
export const JOB = "typecheck";

/**
 * Minutes the lane waits for the job to end, from the push. The job's own limit is 10 minutes; a
 * queue on a busy day adds to it, so twice that. `CHAIN_TYPECHECK_MINUTES` overrides it.
 */
export const MINUTES = 20;

/**
 * Seconds between two polls. A poll that finds the job unchanged is a 304, which GitHub does not
 * count against the 5,000 calls an hour a login gets (./ChecksGh.ts): a wait spends one call per
 * change of the job, about four, where a poll every 10 s spent 6 a minute and 120 on a job that
 * never came. `CHAIN_TYPECHECK_EVERY` overrides it.
 */
export const EVERY = 10;

/** The typecheck gave no answer about the code, and why. */
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
// What GitHub puts before each line of a job's log: the runner's time, then a `##[error]` mark on
// a line the runner flagged.
const STAMP = /^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z (?:##\[error\])?/;
// oxlint-disable-next-line no-control-regex -- the escape that starts a terminal color code
const COLOR = /\u001B\[[0-9;]*m/g;

/** A job's log as the command printed it: no time, no `##[error]` mark, no color. */
export const logText = (log: string): string =>
  log
    .split("\n")
    .map((line) => line.replace(/\r$/, "").replace(STAMP, "").replaceAll(COLOR, ""))
    .join("\n");

// The checkout's own folder in a line: an absolute path that ends `work/<name>/<name>/`, the way an
// Actions runner lays out a repo's workspace. Read from the line itself, so no runner's home is
// written here, and a path that does not end that way stays as it is.
const CHECKOUT = String.raw`(?:/[^\s/"'()]+)*/work/([^\s/"'()]+)/\1/`;
const ROOTED = new RegExp(`^${CHECKOUT}`);
const ANYWHERE = new RegExp(CHECKOUT, "g");

/** `text` with every checkout folder taken off, so each path in it is a repo path. */
const fromRepo = (text: string): string => text.replaceAll(ANYWHERE, "");

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
 * The type errors in `pnpm typecheck`'s output on a runner: each with its file's repo path and its
 * text, the message's indented lines included.
 */
export const errorsIn = (output: string): ReadonlyArray<Found> => {
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
    // A path inside the checkout is written from the repo's root, so no runner path rides along.
    const text = fromRepo(rest);
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
    const path = ROOTED.test(file) ? file.replace(ROOTED, "") : outside;
    found.push({ path, text: `${path}${fromRepo(rest.slice(file.length))}` });
    open = found.length - 1;
    from = dir;
  }

  return found;
};

/** How the job ended: GitHub's conclusion, and its log as the command printed it. */
export type Ended = { readonly conclusion: string | null; readonly output: string };

/**
 * The Check, pure: what the ended job means for the lane. `success` is green. A `failure` with
 * error lines is red, sent to tests when every error's path is in `exam`, else to build, with at
 * most `LINES` lines. A failure with no error line is no answer about the code, so it is skipped
 * with the log's last line; so is any other ending, with its name.
 */
export const verdict = (ended: Ended, errors: ReadonlyArray<Found>, exam: ReadonlySet<string>): Verdict => {
  if (ended.conclusion === "success") {
    return Verdict.cases.green.make({});
  }

  if (ended.conclusion !== "failure") {
    return notRun(`CI's ${JOB} job ended ${ended.conclusion ?? "with no conclusion"}`);
  }

  if (errors.length === 0) {
    const last = ended.output.trim().split("\n").at(-1) ?? "";
    return notRun(`CI's ${JOB} job failed with no error line: ${last}`);
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
  v._tag === "green" ? "green" : v._tag === "red" ? `red, to ${v.to}: ${v.lines[0] ?? ""}` : `no answer: ${v.reason}`;

/** What one wait needs: the main checkout (for exam-paths.json), the head, the limits. */
export type Args = {
  readonly main: string;
  readonly head: string;
  readonly minutes: number;
  readonly every: number;
};

/** The exam paths among `paths`, by step-commit's exam.py and the main checkout's exam-paths.json. */
const examIn = Effect.fn("typecheck.examIn")(function* (main: string, paths: ReadonlyArray<string>) {
  const path = yield* Path.Path;
  const skills = path.join(import.meta.dirname, "..", "..", "..");
  const script = path.join(skills, "step-commit", "scripts", "exam.py");
  const list = path.join(main, "exam-paths.json");
  const ran = yield* exec(main, "python3", ["-I", script, list, ...paths]);
  // 0 is no exam path and 1 lists them; anything else read no list, so no error counts as exam.
  const listed = ran.code === 1 ? ran.output.split("\n").filter(Boolean) : [];
  return new Set(listed.map((l) => l.split("\t")[0] ?? l));
});

/** The job has not ended, or GitHub did not answer: the poll tries again. */
class Pending extends Schema.TaggedError<Pending>()("Pending", { reason: Schema.String }) {}

/** Wait for the job at `head` to end, then read it; never fails. */
export const wait = Effect.fn("typecheck.wait")(
  function* (a: Args) {
    if (!/^[0-9a-f]{40}$/.test(a.head)) {
      return notRun(`the lane has no head to read CI at (${a.head || "none"})`);
    }

    const checks = yield* Checks;
    const last = yield* Ref.make(`no ${JOB} job yet`);
    const poll = checks.job(a.head, JOB).pipe(
      Effect.flatMap((found) =>
        Option.isSome(found) && found.value.status === "completed"
          ? Effect.succeed(found.value)
          : Effect.fail(
              new Pending({
                reason: Option.isSome(found) ? `the ${JOB} job was ${found.value.status}` : `no ${JOB} job yet`,
              }),
            ),
      ),
      Effect.tapError((e) => Ref.set(last, e.reason)),
    );
    const ended: Option.Option<Job> = yield* poll.pipe(
      Effect.retry({ schedule: Schedule.spaced(Duration.seconds(a.every)) }),
      Effect.timeoutOption(Duration.minutes(a.minutes)),
    );

    if (Option.isNone(ended)) {
      const said = yield* Ref.get(last);
      return notRun(`CI's ${JOB} job at ${a.head.slice(0, 8)} did not end within ${a.minutes} minutes (${said})`);
    }

    const job = ended.value;
    const output = job.conclusion === "failure" ? logText(yield* checks.log(job.id)) : "";
    const errors = errorsIn(output);
    const paths = [...new Set(errors.map((e) => e.path))];
    const exam = paths.length === 0 ? new Set<string>() : yield* examIn(a.main, paths);
    return verdict({ conclusion: job.conclusion, output }, errors, exam);
  },
  // The poll retries Pending and ChecksError until the limit; only the log's read reaches here.
  Effect.catchTag(["Pending", "ChecksError", "StepFailed"], ({ reason }) => Effect.succeed(notRun(reason))),
);
