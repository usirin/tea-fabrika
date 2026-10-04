import { execFile } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
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

/**
 * A workspace on this machine: `test` runs in `dir`, and the diff is everything
 * that changed since the last commit, new files included.
 */
export function localWorkspace(dir: string, test: readonly [string, ...string[]]) {
  const [file, ...args] = test;
  return Layer.succeed(Workspace, {
    check: () =>
      Effect.tryPromise({
        try: async () => {
          const ran = await exec(dir, file, args);
          await exec(dir, "git", ["add", "-A"]);
          const diff = await exec(dir, "git", ["diff", "--cached", "HEAD"]);
          return { passed: ran.code === 0, output: ran.output, diff: diff.output };
        },
        catch: () => ({ _tag: "could_not_run" as const }),
      }),
  });
}

/** Copy a toy repo out of `fixtures/` into a fresh folder and commit it as the base. */
export async function checkoutToy(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `tea-fabrika-${name}-`));
  await cp(join(import.meta.dirname, "..", "fixtures", name), dir, { recursive: true });
  await exec(dir, "git", ["init", "-q"]);
  await exec(dir, "git", ["add", "-A"]);
  await exec(dir, "git", [
    "-c", "user.name=tea-fabrika",
    "-c", "user.email=tea-fabrika@localhost",
    "commit", "-q", "-m", "base",
  ]);
  return dir;
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
