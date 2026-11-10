// freshmain.ts <pr> <tip>: the last look at main before catch-up squashes a pull request. Today's
// lead tooling, run on our own laptop; it is not product.
//
// CI tested the head against the main of that moment. Main moves about every 6 minutes, so by the
// merge it is often a newer one (ticket 552: 12 of 20 merges landed behind main, and one put an
// unformatted file on main). Run in the catch-up checkout, which is thrown away when the run ends:
//
//   fetch main            it cannot be fetched: refuse, since nobody knows whether it moved
//   the head holds it     main did not move: nothing more to do, exit 0
//   merge it, no commit   the head conflicts with it: refuse
//   pnpm install, lint    either is red on the merged tree: refuse, and print the check's last lines
//
// A refusal is one line on stderr and exit 1. There is no flag that skips it. The full tests do not
// run here: one test shard takes about 12 minutes, and main would move again before it ended.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Schema, Stream } from "effect";
import { Argument, Command } from "effect/cli";
import { ChildProcess } from "effect/process";

const Check = Schema.Literals(["fetch", "compare", "merge", "install", "lint"]);

class Refused extends Schema.TaggedError<Refused>()("Refused", {
  check: Check,
  reason: Schema.String,
  output: Schema.String,
}) {}

const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

/** One command, run to its end: its exit code, and stdout and stderr as one text. */
const run = Effect.fn("freshmain.run")(
  function* (_check: typeof Check.Type, command: string, ...args: ReadonlyArray<string>) {
    const handle = yield* ChildProcess.make(command, args);
    const [output, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode], {
      concurrency: 2,
    });
    return { code: Number(code), output };
  },
  Effect.scoped,
  (effect, check, command) =>
    Effect.mapError(effect, () => new Refused({ check, reason: `${command} could not run`, output: "" })),
);

const lastLines = (output: string) => output.trimEnd().split("\n").slice(-30).join("\n");

const check = Effect.fn("freshmain.check")(function* (pr: string, tip: string) {
  const fetched = yield* run("fetch", "git", "fetch", "-q", "origin", "main");

  if (fetched.code !== 0) {
    return yield* new Refused({
      check: "fetch",
      reason: "main could not be fetched, so nobody knows whether it moved; run catch-up again",
      output: fetched.output,
    });
  }

  // What this fetch brought, never a remote-tracking ref that an odd refspec left behind.
  const read = yield* run("fetch", "git", "rev-parse", "--verify", "-q", "FETCH_HEAD^{commit}");
  const main = read.output.trim();

  if (read.code !== 0 || !Schema.is(Sha)(main)) {
    return yield* new Refused({ check: "fetch", reason: "the fetched main is not a commit", output: read.output });
  }

  const held = yield* run("compare", "git", "merge-base", "--is-ancestor", main, tip);

  if (held.code === 0) {
    return;
  }

  if (held.code !== 1) {
    return yield* new Refused({
      check: "compare",
      reason: `head ${tip} could not be compared with main ${main}`,
      output: held.output,
    });
  }

  const back = run("merge", "git", "reset", "-q", "--hard", tip).pipe(Effect.ignore);
  const lane = `main moved to ${main.slice(0, 9)} after the checks at ${tip.slice(0, 9)}`;
  const fix = "the lane must merge main and push";

  yield* Effect.gen(function* () {
    const at = yield* run("merge", "git", "checkout", "-q", "--detach", tip);

    if (at.code !== 0) {
      return yield* new Refused({ check: "merge", reason: `head ${tip} could not be checked out`, output: at.output });
    }

    // Nothing is committed, but git asks for a committer before it merges, and a CI machine has none.
    const nobody = ["-c", "user.name=freshmain", "-c", "user.email=freshmain@localhost"];
    const merged = yield* run("merge", "git", ...nobody, "merge", "-q", "--no-commit", "--no-ff", main);

    if (merged.code !== 0) {
      return yield* new Refused({
        check: "merge",
        reason: `${lane}, and the head conflicts with it; ${fix}`,
        output: merged.output,
      });
    }

    const installed = yield* run("install", "nice", "-n", "15", "pnpm", "install", "--frozen-lockfile", "--silent");

    if (installed.code !== 0) {
      return yield* new Refused({
        check: "install",
        reason: `${lane}, and pnpm install --frozen-lockfile fails on the head merged with it; ${fix}`,
        output: installed.output,
      });
    }

    const linted = yield* run("lint", "nice", "-n", "15", "pnpm", "lint");

    if (linted.code !== 0) {
      return yield* new Refused({
        check: "lint",
        reason: `${lane}, and pnpm lint is red on the head merged with it; ${fix}`,
        output: linted.output,
      });
    }

    yield* Console.log(`pr ${pr}: ${lane}; pnpm lint is green on the head merged with it`);
  }).pipe(Effect.ensuring(back));
});

const freshmain = Command.make(
  "freshmain",
  { pr: Argument.String("pr"), tip: Argument.String("tip").pipe(Argument.withSchema(Sha)) },
  ({ pr, tip }) =>
    check(pr, tip).pipe(
      Effect.tapError((refused) =>
        Console.error(
          [lastLines(refused.output), `pr ${pr}: merge refused at the ${refused.check} check: ${refused.reason}`]
            .filter((text) => text !== "")
            .join("\n"),
        ),
      ),
    ),
);

NodeRuntime.runMain(
  Command.runWith(freshmain, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
  { disableErrorReporting: true },
);
