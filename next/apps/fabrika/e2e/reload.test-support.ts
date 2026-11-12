// P15 slice 1, next/. The real hot-reload path's world for `reload.test.ts`: a fixture copy of the
// counter (the real `next/programs/counter` files are only read), a scoped home with its own key and
// port, the instance built and started as dev.ts does it with the copy selected, the watcher on the
// copy, and P12's browser protocol driver. Every folder, instance, watcher, child and browser is
// acquired in a scope and given back by it (0061).
import { execFileSync } from "node:child_process";
import { watchPrograms } from "@kampus/libfabrika/node/watch";
import { Effect, FileSystem, Path, Queue, Stream } from "effect";
import { build } from "../src/build.ts";
import { localInstance } from "../src/local-instance.ts";
import { heldPort } from "../src/port.test-support.ts";

export const APP = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
export const ROOT = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");
export const PROGRAM = "fabrika/counter";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

/** The counter's own source, read from the real package and never written there. */
export const counterSource = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(`${ROOT}/next/programs/counter/src/program.ts`);
});

/** A copy of the counter in its own short folder, given back with the scope. Its `program.ts` is
 *  the one a law edits; it exports the counter as `program` too, as a selected module must. */
export const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ directory: "/tmp", prefix: "p15e." });
  const pkg = path.join(home, "counter");
  yield* fs.makeDirectory(path.join(pkg, "src"), { recursive: true });
  yield* fs.makeDirectory(path.join(home, "node_modules"), { recursive: true });

  for (const name of ["effect", "@demlik", "@kampus", "@alchemy.run"]) {
    yield* fs.symlink(path.join(APP, "node_modules", name), path.join(home, "node_modules", name));
  }

  yield* fs.writeFileString(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "@p15e/counter", type: "module", exports: { ".": "./src/program.ts" } }),
  );
  const file = path.join(pkg, "src/program.ts");
  const write = (text: string) => fs.writeFileString(file, `${text}\nexport { counter as program };\n`);
  yield* write(yield* counterSource);
  return { home, file, write, relative: "counter/src/program.ts" };
});

/** A key pair for the founder, made by ssh-keygen in the scoped home; only its public line is read. */
const founderKey = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const key = `${home}/person`;
    yield* Effect.sync(() => execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]));
    return { key, line: (yield* fs.readFileString(`${key}.pub`)).trim() };
  });

/** The instance, as dev.ts composes it, on the fixture copy: build, start, then watch. Every answer
 *  the watcher gives is put on `answers`. */
export const instance = (copy: Effect.Success<typeof fixture>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ directory: "/tmp", prefix: "p15h." });
    const founder = yield* founderKey(home);
    // The pair stays held until the instance that used its port is gone.
    const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
    const programs = { [PROGRAM]: copy.file };
    const built = yield* build({ out: `${home}/build`, programs });
    const handle = yield* localInstance(built, {
      name: "p15-reload",
      person: PERSON,
      founder: founder.line,
      window: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      port: port.port,
      home,
    });
    const answers = yield* Queue.unbounded<unknown>();
    // The watcher's paths are relative to the copy's folder, so no fact or line names this machine.
    yield* Effect.forkScoped(
      Stream.runForEach(
        watchPrograms({
          root: copy.home,
          entry: `${APP}/src/brain.ts`,
          programs: [{ name: PROGRAM, package: copy.file, export: "program" }],
          install: handle.install,
          failed: handle.failed,
        }),
        (answer) => Queue.offer(answers, answer),
      ),
    );
    return { home, founder, url: `http://127.0.0.1:${port.port}`, handle, answers };
  });

/** The next answer the watcher gave, within `ms`. */
export const nextAnswer = (answers: Queue.Queue<unknown>, ms = 60_000) =>
  Queue.take(answers).pipe(
    Effect.timeoutOrElse({ duration: ms, orElse: () => Effect.die("the watcher gave no answer") }),
  );
