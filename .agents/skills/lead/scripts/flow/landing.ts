// landing.ts: the runners that land a branch, each a thin wrapper over the repo's own script.
// Today's lead tooling (0064). Ticket 652 turns these landing parts into exported Effects; when it
// lands, each runner here calls its Effect in place of the script, and the step names stay.
//
//   format      act     pnpm format in the worktree
//   lint        check   pnpm lint: red is stuck
//   governance  gather  governance.sh: the decision files the diff touches, as the reason
//   lead-commit act     stepcommit.sh lead: commits and signs as the lead (a `lead` step)
//   leak-grep   check   leakgrep.sh on each commit not on origin: a hit asks for the lead's hand check
//   bot-push    act     botpush.mjs: the branch and the step notes, as the bot
//   open-pr     act     gh: finds the branch's open pull request, or opens one
//   ci          listen  gh pr checks --watch: waits for CI; red is stuck
//   queue       act     pr/Queue.ts: the leak checks, ci-required green, then one pinned squash that adds
//                       the pull request to GitHub's merge queue; it ends queued, not merged (a `lead` step)
//
// What each exit code means is a pure function below, so a test reads it without running a script.

import { Effect, Layer, Path, Schema, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import * as ChecksGh from "../ci/ChecksGh.ts";
import * as PullRequestsGh from "../pr/PullRequestsGh.ts";
import { LeakGrepRefused } from "../pr/Pushes.ts";
import * as PushesProcess from "../pr/PushesProcess.ts";
import * as Queue from "../pr/Queue.ts";
import * as Outcome from "./Outcome.ts";
import { type Runner, StepFailed } from "./Runners.ts";
import type { Step } from "./Step.ts";

/** One command's end: its exit code, and stdout and stderr as one text. */
export type Ran = { readonly code: number; readonly output: string };

/** The last lines of a command's output, for a reason. */
export const tail = (output: string, n = 5): string => output.trimEnd().split("\n").slice(-n).join(" | ");

const run = Effect.fn("landing.run")(
  function* (dir: string, command: string, args: ReadonlyArray<string>) {
    const handle = yield* ChildProcess.make(command, args, { cwd: dir });
    const [output, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode], {
      concurrency: 2,
    });
    return { code: Number(code), output } satisfies Ran;
  },
  Effect.scoped,
  (effect, dir, command) =>
    Effect.mapError(effect, () => new StepFailed({ reason: `${command} could not start in ${dir}` })),
);

/** A step's args, read by the runner's own schema. */
const readArgs = <A>(schema: Schema.Codec<A>, step: Step) =>
  Schema.decodeUnknownEffect(schema)(step.args).pipe(
    Effect.mapError((e) => new StepFailed({ reason: `${step.name}'s args do not parse: ${e.message}` })),
  );

const Dir = Schema.Struct({ dir: Schema.String });
const Branch = Schema.Struct({ dir: Schema.String, branch: Schema.String.check(Schema.isStartingWith("fabrikalfa/")) });

const Commit = Schema.Struct({
  dir: Schema.String,
  ticket: Schema.String,
  subject: Schema.String,
  paths: Schema.NonEmptyArray(Schema.String),
});

const Pr = Schema.Struct({
  dir: Schema.String,
  branch: Branch.fields.branch,
  title: Schema.String,
  body: Schema.String,
});

// ---------------------------------------------------------------- what each exit code means

/** A command that passes on 0 and is stuck otherwise. */
export const passOrStuck = (command: string, ran: Ran): Outcome.Outcome =>
  ran.code === 0
    ? Outcome.done(`${command} passed`)
    : Outcome.stuck(`${command} exited ${ran.code}: ${tail(ran.output)}`);

/** governance.sh only advises and always exits 0: its list is the reason. */
export const governanceOutcome = (ran: Ran): Outcome.Outcome =>
  ran.code === 0
    ? Outcome.done(`read these decisions against the diff: ${tail(ran.output, 20)}`)
    : Outcome.stuck(`governance.sh exited ${ran.code}: ${tail(ran.output)}`);

/** stepcommit.sh: 5 is a ticket the lead must pick again (an open PR holds it, or PRs cannot be read). */
export const commitOutcome = (ran: Ran): Outcome.Outcome =>
  ran.code === 0
    ? Outcome.done(`committed and signed: ${tail(ran.output, 1)}`)
    : ran.code === 5
      ? Outcome.ask(`stepcommit.sh refused the lead link: ${tail(ran.output)}`)
      : Outcome.stuck(`stepcommit.sh exited ${ran.code}: ${tail(ran.output)}`);

/** leakgrep.sh fails closed: 1 is a hit for the lead's hand check, anything else but 0 is stuck. */
export const leakOutcome = (ran: Ran): Outcome.Outcome =>
  ran.code === 0
    ? Outcome.done("the leak grep is clean on each commit not on origin")
    : ran.code === 1
      ? Outcome.ask(`the leak grep has a hit for the lead's hand check: ${tail(ran.output)}`)
      : Outcome.stuck(`leakgrep.sh could not check (exit ${ran.code}): ${tail(ran.output)}`);

/** A refused add: a leak hit asks for the lead's hand check, as leak-grep does; anything else is stuck. */
export const queueRefused = (e: { readonly reason: string }): Outcome.Outcome =>
  e instanceof LeakGrepRefused
    ? Outcome.ask(`the leak grep refused before the queue: ${e.reason}`)
    : Outcome.stuck(`not added to the merge queue: ${e.reason}`);

/** The pull request number in `gh pr list --json number -q .[0].number`'s answer, or `null`. */
export const listedPr = (ran: Ran): number | null => {
  const n = Number(ran.output.trim());
  return ran.code === 0 && Number.isInteger(n) && n > 0 ? n : null;
};

/** The pull request number in `gh pr create`'s answer, or `null`. */
export const createdPr = (ran: Ran): number | null => {
  const n = Number(/\/pull\/(\d+)/.exec(ran.output)?.[1]);
  return ran.code === 0 && Number.isInteger(n) ? n : null;
};

// ---------------------------------------------------------------- the runners

const listPr = (dir: string, branch: string) =>
  run(dir, "gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "-q", ".[0].number"]);

/** The branch's open pull request, which a later step reads again (a resume needs nothing in memory). */
const openPr = Effect.fn("landing.openPr")(function* (dir: string, branch: string) {
  const pr = listedPr(yield* listPr(dir, branch));

  if (pr === null) {
    return yield* new StepFailed({ reason: `${branch} has no open pull request` });
  }

  return pr;
});

/** A script by its path from the lead scripts' folder, the one above this. */
const script = Effect.fn("landing.script")(function* (...parts: ReadonlyArray<string>) {
  const path = yield* Path.Path;
  return path.join(import.meta.dirname, "..", ...parts);
});

type Spawns = ChildProcessSpawner.ChildProcessSpawner | Path.Path;

/** The landing runners, by step name. */
export const runners: Readonly<Record<string, Runner<Spawns>>> = {
  format: Effect.fn("landing.format")(function* (step) {
    const { dir } = yield* readArgs(Dir, step);
    return Outcome.answer(passOrStuck("pnpm format", yield* run(dir, "nice", ["-n", "15", "pnpm", "format"])));
  }),
  lint: Effect.fn("landing.lint")(function* (step) {
    const { dir } = yield* readArgs(Dir, step);
    return Outcome.answer(passOrStuck("pnpm lint", yield* run(dir, "nice", ["-n", "15", "pnpm", "lint"])));
  }),
  governance: Effect.fn("landing.governance")(function* (step) {
    const { dir } = yield* readArgs(Dir, step);
    return Outcome.answer(governanceOutcome(yield* run(dir, "sh", [yield* script("governance.sh")])));
  }),
  "lead-commit": Effect.fn("landing.leadCommit")(function* (step) {
    const { dir, ticket, subject, paths } = yield* readArgs(Commit, step);
    const stepcommit = yield* script("..", "..", "step-commit", "scripts", "stepcommit.sh");
    return Outcome.answer(commitOutcome(yield* run(dir, "sh", [stepcommit, "lead", ticket, subject, ...paths])));
  }),
  "leak-grep": Effect.fn("landing.leakGrep")(function* (step) {
    const { dir } = yield* readArgs(Dir, step);
    const leakgrep = yield* script("leakgrep.sh");
    return Outcome.answer(
      leakOutcome(yield* run(dir, "sh", [leakgrep, "--commits", "HEAD", "--not", "--remotes=origin"])),
    );
  }),
  "bot-push": Effect.fn("landing.botPush")(function* (step) {
    const { dir, branch } = yield* readArgs(Branch, step);
    return Outcome.answer(
      passOrStuck("botpush.mjs", yield* run(dir, "node", [yield* script("botpush.mjs"), dir, branch])),
    );
  }),
  "open-pr": Effect.fn("landing.openPr")(function* (step) {
    const { dir, branch, title, body } = yield* readArgs(Pr, step);
    const open = listedPr(yield* listPr(dir, branch));

    if (open !== null) {
      return Outcome.answer(Outcome.done(`PR ${open} is already open on ${branch}`));
    }

    const made = yield* run(dir, "gh", ["pr", "create", "--head", branch, "--title", title, "--body", body]);
    const pr = createdPr(made);
    return Outcome.answer(
      pr === null ? Outcome.stuck(`gh pr create failed: ${tail(made.output)}`) : Outcome.done(`opened PR ${pr}`),
    );
  }),
  ci: Effect.fn("landing.ci")(function* (step) {
    const { dir, branch } = yield* readArgs(Branch, step);
    const pr = yield* openPr(dir, branch);
    const checks = yield* run(dir, "gh", ["pr", "checks", String(pr), "--watch", "--interval", "30"]);
    return Outcome.answer(passOrStuck(`CI on PR ${pr}`, checks));
  }),
  queue: Effect.fn("landing.queue")(function* (step) {
    const { dir, branch } = yield* readArgs(Branch, step);
    const pr = yield* openPr(dir, branch);
    const repo = PullRequestsGh.repoFromUrl((yield* run(dir, "git", ["remote", "get-url", "origin"])).output);

    if (repo === null) {
      return yield* new StepFailed({ reason: `${dir}'s origin is not a GitHub repo` });
    }

    const services = Layer.mergeAll(
      PullRequestsGh.layer(repo, dir),
      PushesProcess.layer(yield* script()),
      ChecksGh.layer(repo),
    );
    // The `ci` step before this one waited for the checks, so the required one is read once here.
    return Outcome.answer(
      yield* Queue.add({ dir, pr }).pipe(
        Effect.provide(services),
        Effect.match({ onFailure: queueRefused, onSuccess: (added) => Outcome.done(Queue.line(added)) }),
      ),
    );
  }),
};
