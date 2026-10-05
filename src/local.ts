import { execFile } from "node:child_process";
import { access, cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { Issue, RawIssue } from "./issue.ts";
import { Jev, Workspace } from "./services.ts";

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

/** The names of the tests that passed, out of a TAP report such as `node --test` prints. */
export const passingTests = (output: string): string[] =>
  [...output.matchAll(/^ok \d+ - (.+)$/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

export interface LocalWorkspaceOptions {
  /** The command that runs the tests. */
  readonly test: readonly [string, ...string[]];
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
}

/**
 * A workspace on this machine: the tests run in `dir`, and the diff is
 * everything that changed since the last commit, new files included.
 */
export function localWorkspace(dir: string, options: LocalWorkspaceOptions) {
  const [file, ...args] = options.test;
  const protect = options.protect ?? [];
  return Layer.succeed(Workspace, {
    check: () =>
      Effect.tryPromise({
        try: async () => {
          if (protect.length > 0) {
            await exec(dir, "git", ["checkout", "HEAD", "--", ...protect]);
          }
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
          return {
            passed: ran.code === 0,
            output: ran.output,
            diff: diff.output,
            passingTests: passingTests(ran.output),
          };
        },
        catch: () => ({ _tag: "could_not_run" as const }),
      }),
  });
}

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
  await exec(dir, "git", ["init", "-q"]);
  await exec(dir, "git", ["add", "-A"]);
  await exec(dir, "git", [
    "-c", "user.name=tea-fabrika",
    "-c", "user.email=tea-fabrika@localhost",
    "commit", "-q", "-m", "base",
  ]);
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
