import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect, Layer, Schedule, Stream } from "effect";
import { type Reply, Thread } from "./combos.ts";
import { Worktrees } from "./fabrika.ts";

// The live Layers that are not fabrika: working copies on git, and the thread
// a person answers on, as an issue's comments through `gh`. Neither keeps a
// list of what it wrote. Each asks the world first: a tree that stands is not
// made again, and a question whose mark is already on the issue is not posted
// again. That is how an Act stays safe to repeat where the world has no key.

const run = promisify(execFile);

/** One command, its stdout. Any failure is "could not read or write at all". */
export const sh =(file: string, args: readonly string[], cwd?: string) =>
  Effect.tryPromise({
    try: () => run(file, [...args], { cwd, maxBuffer: 32 * 1024 * 1024 }).then((r) => r.stdout),
    catch: () => ({ _tag: "unknown" as const }),
  });

/**
 * Working copies as git worktrees of `repo`, kept side by side in `trees`.
 * A new one is the default branch as the remote has it now, detached: the
 * shell that works in it names its own branch. `install`, when given, runs
 * in the new tree, so a shell finds the repo's tools there.
 */
export const gitWorktrees = (config: {
  readonly repo: string;
  readonly trees: string;
  readonly install: readonly [string, ...string[]] | null;
}) =>
  Layer.succeed(Worktrees, {
    make: ({ name }) =>
      Effect.gen(function* () {
        const path = join(config.trees, name);
        if (existsSync(join(path, ".git"))) return;
        yield* sh("git", ["-C", config.repo, "fetch", "origin", "main"]);
        yield* sh("git", ["-C", config.repo, "worktree", "add", "--detach", path, "origin/main"]);
        if (config.install !== null) yield* sh(config.install[0], config.install.slice(1), path);
      }),
    remove: ({ name }) =>
      Effect.gen(function* () {
        // Only its own tree: no `git worktree prune`, which would drop other drivers' entries too.
        const path = join(config.trees, name);
        if (existsSync(path)) yield* sh("git", ["-C", config.repo, "worktree", "remove", "--force", path]);
      }),
  });

/** `owner/name` and the number, from an issue's URL. */
function issueOf(url: string): { readonly repo: string; readonly number: string } {
  const m = /github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(url);
  if (m === null) throw new Error(`not an issue URL: ${url}`);
  return { repo: m[1] as string, number: m[2] as string };
}

/** The line that marks a comment as this machine's, and names the write it was. Hidden when the comment renders. */
const mark = (intent: string) => `<!-- tea-fabrika ${intent} -->`;
/**
 * Any hidden mark at all. Fabrika's own verbs and shells comment under the
 * same account a person replies from; a comment with a mark is a machine's,
 * whoever's name is on it.
 */
const MARKED = /<!--[\s\S]*?-->/;
/**
 * Fabrika 0.9.0's records on an issue that carry no hidden mark: each opens
 * with its keyword and a colon. A lane's claim is one, and every run posts
 * its own when it starts, after an earlier run's question: read as a reply,
 * it would go to the Judge as the owner's answer.
 */
const FABRIKA_RECORD = /^\s*(?:lane-(?:claim|adopt|record)|build-(?:claim|claim-override|adopt|deviations)|decision-ruling):/;
/** Whether a comment is a machine's, and so nobody's reply. */
export const isMachines = (body: string): boolean => MARKED.test(body) || FABRIKA_RECORD.test(body);

interface Comment {
  readonly id: number;
  readonly html_url: string;
  readonly created_at: string;
  readonly body: string;
  readonly user: { readonly login: string };
}

/**
 * The thread as an issue's comments. A question is one comment, with a
 * hidden mark naming its intent; a reply is any later comment that is not a
 * machine's ({@link isMachines}). Comments are read every `pollMs`. `gh`: the
 * GitHub CLI to run, for a test that stands one in. `posted` hears of each
 * question for a log: its link, and whether it was `found` on the issue,
 * asked by an earlier run, or posted now.
 */
export const issueThread = (config: {
  readonly pollMs: number;
  readonly gh?: string;
  readonly posted?: (link: string, found: boolean) => void;
}) => {
  const gh = config.gh ?? "gh";
  const comments = (url: string) => {
    const { repo, number } = issueOf(url);
    return sh(gh, ["api", "--paginate", "--slurp", `repos/${repo}/issues/${number}/comments?per_page=100`]).pipe(
      Effect.map((out) => (JSON.parse(out) as Comment[][]).flat()),
    );
  };
  return Layer.succeed(Thread, {
    post: ({ where, text, intent }) =>
      Effect.gen(function* () {
        const posted = (yield* comments(where)).find((c) => c.body.includes(mark(intent)));
        if (posted !== undefined) {
          config.posted?.(posted.html_url, true);
          return { thread: where, at: Date.parse(posted.created_at) };
        }
        yield* sh(gh, ["issue", "comment", where, "--body", `${text}\n\n${mark(intent)}`]);
        const mine = (yield* comments(where)).find((c) => c.body.includes(mark(intent)));
        config.posted?.(mine?.html_url ?? where, false);
        return { thread: where, at: mine === undefined ? Date.now() : Date.parse(mine.created_at) };
      }).pipe(Effect.mapError(() => ({ _tag: "post_failed" as const }))),
    replies: (thread, after) => {
      const seen = new Set<number>();
      return Stream.fromEffectSchedule(
        comments(thread).pipe(Effect.match({ onSuccess: (all) => all, onFailure: (): Comment[] => [] })),
        Schedule.spaced(config.pollMs),
      ).pipe(
        Stream.flatMap((all) =>
          Stream.fromIterable(
            all
              .filter((c) => !seen.has(c.id) && Date.parse(c.created_at) > after && !isMachines(c.body))
              .map((c): Reply => {
                seen.add(c.id);
                return { id: String(c.id), author: c.user.login, body: c.body, at: Date.parse(c.created_at) };
              }),
          ),
        ),
      );
    },
  });
};
