import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Deferred, Effect, Exit } from "effect";
import { expect, it } from "vitest";

const HOST = fileURLToPath(new URL("../../../../../fixtures/summon-tsh/tsh.ts", import.meta.url));

interface Life {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly exited: Effect.Effect<number | null>;
}

const kill = (life: Life) => Effect.sync(() => life.child.kill("SIGKILL")).pipe(Effect.andThen(life.exited));

const life = (home: string, folder: string, line: string) =>
  Effect.acquireRelease(
    Effect.sync((): Life => {
      const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", HOST, home, folder, line], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout!.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr!.on("data", (chunk) => {
        output += String(chunk);
      });
      const exited = Deferred.makeUnsafe<number | null>();
      child.on("exit", (code) => Deferred.doneUnsafe(exited, Exit.succeed(code)));
      return { child, output: () => output, exited: Deferred.await(exited) };
    }),
    kill,
  );

// Plan: "Who holds what", "One press traced" step 6, and the turn program's kept {name, run, turn}.
it("T237-4: attach after a host crash recovers the turn's answer without typing its prompt again", async () => {
  const seen = await Effect.runPromise(
    Effect.gen(function* () {
      const folder = yield* Effect.acquireRelease(
        Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "summon-restart-")))),
        (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
      );
      execFileSync("git", ["init", "-q"], { cwd: folder });
      writeFileSync(join(folder, "a.txt"), "The river is called Kura.\n");
      const home = join(folder, "kept");
      const first = yield* life(home, folder, "summon fake as scout\n@scout slowly read a.txt");
      yield* Effect.gen(function* () {
        const log = join(folder, ".fake-acp", "log");

        while (
          !first.output().includes('told {"name":"scout","turn":1}') ||
          !existsSync(log) ||
          !readFileSync(log, "utf8").includes(" 1 slowly")
        ) {
          yield* Effect.sleep("10 millis");
        }
      }).pipe(Effect.timeout("15 seconds"));
      yield* kill(first);
      const second = yield* life(home, folder, "attach %1");
      const status = yield* second.exited.pipe(Effect.timeout("15 seconds"));
      return {
        status,
        output: second.output(),
        log: readFileSync(join(folder, ".fake-acp", "log"), "utf8"),
      };
    }).pipe(Effect.scoped),
  );
  expect(seen.status).toBe(0);
  expect(seen.output).toContain("a.txt: The river is called Kura.");
  expect(seen.output.match(/said \{/g)).toHaveLength(1);
  expect(
    new Set(
      seen.log
        .split("\n")
        .filter((l) => l.startsWith("prompt "))
        .map((l) => l.split(" ")[1]),
    ).size,
  ).toBe(1);
});
