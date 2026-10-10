import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import { z } from "zod";
import type { GitHubIssue, IssueRef } from "./github.ts";
import { Comment } from "./tracker.ts";
import { Issue, RawIssue } from "./issue.ts";
import type { Snapshot } from "./review.ts";
import { Jev, Repo, Tracker, Workspace } from "./services.ts";
import { type Command, nodeTests, type TestFlavour } from "./tests.ts";

interface Ran {
  readonly code: number;
  readonly output: string;
}

/** Run a program and keep its exit code. Only a program that never started rejects. */
const exec = (cwd: string, file: string, args: readonly string[]) =>
  new Promise<Ran>((resolve, reject) => {
    execFile(file, args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null && typeof error.code !== "number") reject(error);
      else resolve({ code: error === null ? 0 : (error.code as number), output: stdout + stderr });
    });
  });

/** Commit everything staged in `dir`, if anything is. */
async function commit(dir: string, message: string) {
  const staged = await exec(dir, "git", ["diff", "--cached", "--quiet"]);
  if (staged.code === 0) return;
  await exec(dir, "git", [
    "-c", "user.name=tea-fabrika",
    "-c", "user.email=tea-fabrika@localhost",
    "commit", "-q", "-m", message,
  ]);
}

/**
 * The lines a staged diff touched in `file`, on the new side: each hunk header
 * `@@ -a,b +c,d @@` covers lines c to c+d-1, and a missing `d` means one line.
 */
export const touchedLines = (diff: string): number[] =>
  [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].flatMap((m) => {
    const from = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    return Array.from({ length: count }, (_, i) => from + i);
  });

/** What review needs of each changed file that still exists: its text, and the lines the diff touched. */
async function snapshotOf(dir: string, changed: readonly string[]): Promise<Snapshot> {
  const entries = await Promise.all(
    changed.map(async (file) => {
      const text = await readFile(join(dir, file), "utf8").catch(() => null);
      if (text === null) return [];
      const diff = await exec(dir, "git", ["diff", "--cached", "-U0", "HEAD", "--", file]);
      return [[file, { text, lines: touchedLines(diff.output) }] as const];
    }),
  );
  return Object.fromEntries(entries.flat());
}

export interface LocalWorkspaceOptions {
  /** The command that runs the tests: the repo's own and the issue's. Its report must read with `tests`. */
  readonly test: Command;
  /** How the issue's tests are written, run and read back. A toy's node:test file when left out. */
  readonly tests?: TestFlavour;
  /**
   * Files the builder does not get to change, as git pathspecs. They are put
   * back as they were committed before every test run, so editing a test to
   * make it pass changes nothing.
   */
  readonly protect?: readonly string[];
  /**
   * A folder of tests the builder never sees. Its files are copied in for the
   * test run and taken out again, so they are in neither the folder the
   * builder reads nor the diff the judge reads.
   */
  readonly hidden?: string;
  /**
   * The command that installs what the tests need, run in a fresh copy before
   * its tests, such as `pnpm install --frozen-lockfile`. Installed packages are
   * not in git, so a repo with any needs one. A fresh copy whose install fails
   * could not run: that is more often the network than the change.
   */
  readonly install?: Command;
}

/**
 * A workspace on this machine: the tests run in `dir`, and the diff is
 * everything that changed since the last commit, new files included. The
 * issue's own tests are committed before the builder starts, so they are
 * locked like any protected file and never show in the diff.
 */
export function localWorkspace(dir: string, options: LocalWorkspaceOptions) {
  const [file, ...args] = options.test;
  const tests = options.tests ?? nodeTests;
  const protect = [...(options.protect ?? []), tests.file];
  return Layer.succeed(Workspace, {
    testCommand: options.test.join(" "),
    // HEAD is where the change started: the builder's work is never committed until it is sealed.
    baseFiles: () =>
      Effect.tryPromise({
        try: async () => {
          const all = (await git(dir, "ls-tree", "-r", "--name-only", "HEAD")).split("\n");
          const locked = new Set((await git(dir, "ls-tree", "-r", "--name-only", "HEAD", "--", ...protect)).split("\n"));
          return all.filter((path) => path !== "" && !locked.has(path));
        },
        catch: () => ({ _tag: "could_not_run" as const }),
      }),
    baseFile: (path) =>
      Effect.tryPromise({
        try: () => git(dir, "show", `HEAD:${path}`),
        catch: () => ({ _tag: "could_not_run" as const }),
      }),
    // The builder's work is the folder itself.
    currentFile: (path) =>
      Effect.tryPromise({
        try: () =>
          readFile(join(dir, path), "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return "";
            throw error;
          }),
        catch: () => ({ _tag: "could_not_run" as const }),
      }),
    prepare: (issue) =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(join(dir, tests.file)), { recursive: true });
          await writeFile(join(dir, tests.file), tests.write(issue));
          await exec(dir, "git", ["add", tests.file]);
          await commit(dir, "the issue's tests");
          const [runner, ...flags] = tests.run;
          const ran = await exec(dir, runner, flags);
          return { ...tests.read(ran.output), output: tests.brief(ran.output) };
        },
        catch: () => ({ _tag: "could_not_run" as const }),
      }),
    check: () =>
      Effect.tryPromise({
        try: async () => {
          const changed = await exec(dir, "git", ["diff", "--name-only", "HEAD", "--", ...protect]);
          const touched = changed.output.split("\n").filter((line) => line !== "");
          await exec(dir, "git", ["checkout", "HEAD", "--", ...protect]);
          const hidden =
            options.hidden === undefined
              ? []
              : await readdir(options.hidden, { recursive: true });
          if (options.hidden !== undefined) {
            await cp(options.hidden, dir, { recursive: true });
          }
          const ran = await exec(dir, file, args);
          for (const path of hidden) {
            await rm(join(dir, path), { recursive: true, force: true });
          }
          await exec(dir, "git", ["add", "-A"]);
          const diff = await exec(dir, "git", ["diff", "--cached", "HEAD"]);
          const names = await exec(dir, "git", ["diff", "--cached", "--name-only", "HEAD"]);
          const files = names.output.split("\n").filter((line) => line !== "");
          return {
            passed: ran.code === 0,
            output: tests.brief(ran.output),
            diff: diff.output,
            passingTests: tests.read(ran.output).passing,
            touched,
            changed: files,
            snapshot: await snapshotOf(dir, files),
          };
        },
        catch: () => ({ _tag: "could_not_run" as const }),
      }),
    freshCheck: () =>
      Effect.tryPromise({
        try: async () => freshRun(dir, await sealIndex(dir, "the change, for a fresh check"), options),
        catch: () => ({ _tag: "could_not_run" as const }),
      }),
  });
}

/** Run git and hand back its output, or throw with it: for the steps where any failure is the step's. */
async function git(dir: string, ...args: string[]): Promise<string> {
  const ran = await exec(dir, "git", ["-c", "user.name=tea-fabrika", "-c", "user.email=tea-fabrika@localhost", ...args]);
  if (ran.code !== 0) throw new Error(ran.output);
  return ran.output.trim();
}

/**
 * The change as git holds it, committed on top of HEAD without moving the
 * branch: review still reads the whole change against where it started.
 */
async function sealIndex(dir: string, message: string): Promise<string> {
  await git(dir, "add", "-A");
  return git(dir, "commit-tree", await git(dir, "write-tree"), "-p", "HEAD", "-m", message);
}

/** Check one commit out into an empty folder, install, add the hidden tests, and run the tests there. */
async function freshRun(dir: string, sha: string, options: LocalWorkspaceOptions) {
  const [file, ...args] = options.test;
  const fresh = await mkdtemp(join(tmpdir(), "tea-fabrika-fresh-"));
  try {
    await git(dir, "worktree", "add", "-q", "--detach", fresh, sha);
    if (options.install !== undefined) {
      const [installer, ...flags] = options.install;
      const installed = await exec(fresh, installer, flags);
      if (installed.code !== 0) throw new Error(installed.output);
    }
    if (options.hidden !== undefined) await cp(options.hidden, fresh, { recursive: true });
    const ran = await exec(fresh, file, args);
    return { passed: ran.code === 0, output: (options.tests ?? nodeTests).brief(ran.output) };
  } finally {
    await exec(dir, "git", ["worktree", "remove", "--force", fresh]);
    await rm(fresh, { recursive: true, force: true });
  }
}

/** Where the sealed change is kept, so git never collects it before it lands. */
const SEALED = "refs/tea-fabrika/sealed";

/**
 * The repo on this machine. The builder works on its own branch in `dir`;
 * `base` is the branch the change lands in, and nobody has it checked out, so
 * moving it disturbs no folder.
 */
export function localRepo(dir: string, options: LocalWorkspaceOptions & { readonly base: string }) {
  const base = `refs/heads/${options.base}`;
  const failed = () => ({ _tag: "repo_failed" as const });
  return Layer.succeed(Repo, {
    seal: (message) =>
      Effect.tryPromise({
        try: async () => {
          const head = await sealIndex(dir, message);
          await git(dir, "update-ref", SEALED, head);
          return { head, stat: await git(dir, "diff", "--stat", base, head) };
        },
        catch: failed,
      }),
    land: (head) =>
      Effect.tryPromise({
        try: async () => {
          const tip = await git(dir, "rev-parse", base);
          const holds = await exec(dir, "git", ["merge-base", "--is-ancestor", tip, head]);
          if (holds.code !== 0) return { kind: "behind" as const };
          // Moves the base only if it is still where it was read: a base that moved meanwhile fails, and is read again.
          await git(dir, "update-ref", base, head, tip);
          return { kind: "landed" as const, sha: head };
        },
        catch: failed,
      }),
    catchUp: (head) =>
      Effect.tryPromise({
        try: async () => {
          const merged = await exec(dir, "git", ["merge-tree", "--write-tree", "--name-only", base, head]);
          // Exit 1 is a conflict: the tree, then the conflicted files, then a blank line and git's messages.
          const [tree = "", ...rest] = merged.output.split("\n");
          if (merged.code === 1) {
            const files = rest.slice(0, rest.indexOf("") === -1 ? undefined : rest.indexOf("")).filter((f) => f !== "");
            return { kind: "conflicted" as const, files };
          }
          if (merged.code !== 0) throw new Error(merged.output);
          const merge = await git(dir, "commit-tree", tree.trim(), "-p", head, "-p", base, "-m", `Merge ${options.base}`);
          return { kind: "merged" as const, head: merge };
        },
        catch: failed,
      }),
    retest: (head) =>
      Effect.tryPromise({
        try: () => freshRun(dir, head, options),
        catch: failed,
      }),
  });
}

/** The branch a toy's changes land in. */
export const TOY_BASE = "main";

export interface Toy {
  /** The fresh folder the builder works in. */
  readonly dir: string;
  /** The issue as somebody filed it. Triage starts here. */
  readonly raw: RawIssue;
  /** A hand-written rewrite of it, for runs with no real enricher. */
  readonly issue: Issue;
  /** The toy's hidden tests, if it has any. */
  readonly hidden: string | undefined;
}

/**
 * Check a toy out of `fixtures/<name>/`: `repo/` is copied into a fresh folder
 * and committed as the base, `raw.json` and `issue.json` are the work before
 * and after triage, and `hidden/` holds the tests the builder does not get to read.
 * `without` names files of `repo/` to leave out, for a run nobody may read them in.
 */
export async function checkoutToy(
  name: string,
  options: { readonly without?: readonly string[] } = {},
): Promise<Toy> {
  const fixture = join(import.meta.dirname, "..", "fixtures", name);
  const dir = await mkdtemp(join(tmpdir(), `tea-fabrika-${name}-`));
  await cp(join(fixture, "repo"), dir, { recursive: true });
  // Left out before the first commit, so the files are not in the history either.
  for (const file of options.without ?? []) await rm(join(dir, file), { force: true });
  await exec(dir, "git", ["init", "-q", "-b", TOY_BASE]);
  await exec(dir, "git", ["add", "-A"]);
  await commit(dir, "base");
  // The builder works on a branch of its own; the change lands in the base when it ships.
  await exec(dir, "git", ["checkout", "-q", "-b", "lane"]);
  return openToy(name, dir);
}

/** A toy already checked out in `dir`, as a run that was stopped finds it again. */
export async function openToy(name: string, dir: string): Promise<Toy> {
  const fixture = join(import.meta.dirname, "..", "fixtures", name);
  const read = async (file: string) =>
    JSON.parse(await readFile(join(fixture, file), "utf8")) as unknown;
  const hidden = await access(join(fixture, "hidden")).then(
    () => join(fixture, "hidden"),
    () => undefined,
  );
  return {
    dir,
    raw: RawIssue.parse(await read("raw.json")),
    issue: Issue.parse(await read("issue.json")),
    hidden,
  };
}

/** One ticket as a file tracker keeps it: what was filed, and the comments under it. */
export const TicketFile = RawIssue.omit({ id: true }).extend({ comments: z.array(Comment).default([]) });
export type TicketFile = z.input<typeof TicketFile>;

/**
 * A tracker kept in a folder: one `<issue id>.json` per ticket, holding the
 * ticket and its comments, the way an issue holds both on GitHub. A person
 * edits the file to comment. A missing or unreadable file is a failure, never
 * "no comments": the lane must not finish on a misread.
 */
export function fileTracker(dir: string) {
  const read = (issue: string) =>
    Effect.tryPromise({
      try: async () => TicketFile.parse(JSON.parse(await readFile(join(dir, `${issue}.json`), "utf8"))),
      catch: () => ({ _tag: "tracker_failed" as const }),
    });
  return Layer.succeed(Tracker, {
    ticket: (issue) =>
      read(issue).pipe(Effect.map(({ title, body, filedBy }) => ({ id: issue, title, body, filedBy }))),
    comments: (issue) => read(issue).pipe(Effect.map((ticket) => ticket.comments)),
  });
}

/** Put a ticket into a file tracker's folder, unless it is there already: a kept run keeps its comments. */
export async function seedTicket(dir: string, raw: RawIssue): Promise<void> {
  await mkdir(dir, { recursive: true });
  const { id, ...filed } = raw;
  const ticket: TicketFile = { ...filed, comments: [] };
  await writeFile(join(dir, `${id}.json`), `${JSON.stringify(ticket, null, 2)}\n`, { flag: "wx" }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    },
  );
}

/** One GitHub issue, read with `gh`. Read-only: nothing is ever written back. */
export async function githubIssue(ref: IssueRef): Promise<GitHubIssue> {
  const ran = await exec(".", "gh", ["issue", "view", String(ref.number), "-R", ref.repo, "--json", "title,body,author"]);
  if (ran.code !== 0) throw new Error(`gh could not read ${ref.repo}#${ref.number}: ${ran.output}`);
  return JSON.parse(ran.output) as GitHubIssue;
}

/**
 * A branch a change can land in: it exists, and no folder has it checked out,
 * so moving it disturbs nobody's files. Throws with why otherwise.
 */
export async function checkBase(dir: string, base: string): Promise<void> {
  await git(dir, "rev-parse", "--verify", "--quiet", `refs/heads/${base}`).catch(() => {
    throw new Error(`there is no branch ${base} in ${dir}`);
  });
  const worktrees = await git(dir, "worktree", "list", "--porcelain");
  if (worktrees.split("\n").includes(`branch refs/heads/${base}`)) {
    throw new Error(`${base} is checked out in a folder; the base must be a branch nobody has checked out`);
  }
}

/** Whether `dir` has nothing uncommitted: a run starts from a clean folder, so the diff is only the builder's. */
export async function isClean(dir: string): Promise<boolean> {
  return (await git(dir, "status", "--porcelain")) === "";
}

/** Jev over HTTP. The key stays in this Layer and never reaches the machine. */
export function liveJev(key: string, endpoint: string) {
  return Layer.succeed(Jev, {
    call: (request) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(request),
          });
          return {
            status: response.status,
            body: await response.json().catch(() => ({})),
          };
        },
        catch: (cause) => ({ _tag: "jev_call_failed" as const, cause }),
      }),
  });
}
