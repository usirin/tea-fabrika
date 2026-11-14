// P15 slice 1, next/. The real hot-reload path's world for `reload.test.ts`: a fixture copy of the
// counter (the real `next/programs/counter` files are only read), a scoped home with its own key and
// port, the instance built and started as dev.ts does it with the copy selected, the watcher on the
// copy, and P12's browser protocol driver. Every folder, instance, watcher, child and browser is
// acquired in a scope and given back by it (0061).
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite"; // edge: inspect the real instance's persisted span output
import { build } from "@kampus/libfabrika/build";
import { watchPrograms } from "@kampus/libfabrika/node/watch";
import { SpanRow } from "@kampus/libfabrika/telemetry/Trace";
import { Effect, FileSystem, Option, Path, Queue, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { localInstance } from "../src/local-instance.ts";
import { heldPort } from "../src/port.test-support.ts";
import * as RecordWireTest from "../src/record-wire.test-support.ts";
import { programs as selected } from "../src/table.ts";

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
  // Keep shared dependencies beside the fixture. A root in /tmp makes a valid relative importer
  // contain the checkout's full path, which L17 correctly keeps out of its named outputs.
  const home = yield* fs.makeTempDirectoryScoped({ directory: ROOT, prefix: ".p15e." });
  yield* fs.writeFileString(path.join(home, "package.json"), '{"type":"module"}');
  const pkg = path.join(home, "counter");
  yield* fs.makeDirectory(path.join(pkg, "src"), { recursive: true });
  yield* fs.makeDirectory(path.join(home, "node_modules"), { recursive: true });

  for (const name of ["effect", "@effect", "@demlik", "@kampus", "@alchemy.run", "react"]) {
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

/** Start and watch use the same root, entry and counter copy, so unchanged bytes have one hash. The
 *  build's selection is the app's table with the counter swapped for the copy, as `src/build.ts`
 *  swaps a program, so every program the brain boots is built. The watch covers only the copy: it
 *  builds each program on its own, and only the copy is ever saved. */
export const fixtureBuild = Effect.fnUntraced(function* (
  copy: Pick<Effect.Success<typeof fixture>, "home" | "file">,
  out: string,
) {
  const counter = { name: PROGRAM, package: copy.file, export: "program" };
  const watch = { root: copy.home, entry: `${APP}/src/brain.ts`, programs: [counter] };
  const programs = [...selected.filter((p) => p.name !== PROGRAM), counter];
  const built = yield* build({ ...watch, programs, out, files: [], ledger: [], chaos: false });
  return { ...built, watch };
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
    const built = yield* fixtureBuild(copy, `${home}/build`);
    const handle = yield* localInstance(
      built,
      RecordWireTest.startupFixture({
        home,
        name: "p15-reload",
        person: PERSON,
        founder: founder.line,
        window: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        port: port.port,
      }),
    );
    const answers = yield* Queue.unbounded<unknown>();
    // The watcher's paths are relative to the copy's folder, so no fact or line names this machine.
    yield* Effect.forkScoped(
      Stream.runForEach(
        watchPrograms({
          ...built.watch,
          install: handle.install,
          failed: handle.failed,
        }),
        (answer) => Queue.offer(answers, answer),
      ),
    );
    return { home, founder, url: `http://127.0.0.1:${port.port}`, handle, answers };
  });

/** Wait for an answer that belongs to the save, within one deadline, including skipped no-ops. */
export const nextAnswer = (
  answers: Queue.Queue<unknown>,
  ms = 60_000,
  accept: (answer: unknown) => boolean = () => true,
) =>
  Effect.gen(function* () {
    while (true) {
      const answer = yield* Queue.take(answers);

      if (accept(answer)) {
        return answer;
      }
    }
  }).pipe(Effect.timeoutOrElse({ duration: ms, orElse: () => Effect.die("the watcher gave no answer") }));

/** Runs dev.ts's real CLI and printer, with the fixture's build and watch configuration. */
export const cli = Effect.fnUntraced(function* (
  copy: Effect.Success<typeof fixture>,
  fakeBytes: ReadonlyArray<number>,
) {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* fs.makeTempDirectoryScoped({ directory: "/tmp", prefix: "p15cli." });
  const founder = yield* founderKey(home);
  const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const wrapper = `${copy.home}/build.ts`;
  yield* fs.writeFileString(
    wrapper,
    `import { fixtureBuild } from ${JSON.stringify(import.meta.url)};
export const build = (options) => fixtureBuild(${JSON.stringify({ home: copy.home, file: copy.file })}, options.out);
`,
  );
  const original = yield* fs.readFileString(`${APP}/dev.ts`);
  // Inject a made-up bearer through Effect's random service. Never open the control-token file.
  const random = `${copy.home}/random.ts`;
  yield* fs.writeFileString(
    random,
    `
import { Layer } from "effect";
import { SecureRandom as Real } from "effect/crypto";
export { Digest } from "effect/crypto";
const bytes = ${JSON.stringify(fakeBytes)};
export const SecureRandom = { layerWebCrypto: Layer.succeed(Real.SecureRandom,
  Real.make(size => size === 32 ? Uint8Array.from(bytes) : crypto.getRandomValues(new Uint8Array(size)))) };
`,
  );
  const entry = `${copy.home}/dev.ts`;
  yield* fs.writeFileString(
    entry,
    original
      .replace('"effect/crypto"', JSON.stringify(random))
      .replace('"./src/build.ts"', JSON.stringify(wrapper))
      .replace('"./src/local-instance.ts"', JSON.stringify(`${APP}/src/local-instance.ts`))
      .replace('"./src/settings.ts"', JSON.stringify(`${APP}/src/settings.ts`)),
  );
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  const child = yield* ChildProcess.make(
    process.execPath,
    [
      entry,
      "--child",
      `--parent=${process.pid}`,
      "--name=p15-reload",
      `--person=${PERSON}`,
      `--founder=${founder.line}`,
      `--port=${port.port}`,
      "--window=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ],
    {
      cwd: APP,
      env: { ...env, FABRIKA_HOME: home },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      forceKillAfter: "3 seconds",
    },
  );
  const lines = yield* Queue.unbounded<string>();
  const stdout: Array<string> = [];
  const stderr: Array<string> = [];
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.splitLines(Stream.decodeText(child.stdout)), (line) =>
      Effect.sync(() => stdout.push(line)).pipe(Effect.andThen(Queue.offer(lines, line))),
    ),
  );
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.decodeText(child.stderr), (text) => Effect.sync(() => stderr.push(text))),
  );
  const nextLine = (accept: (line: string) => boolean) =>
    Effect.gen(function* () {
      while (true) {
        const line = yield* Queue.take(lines);

        if (accept(line)) {
          return line;
        }
      }
    }).pipe(Effect.timeoutOrElse({ duration: "60 seconds", orElse: () => Effect.die("dev printed no reload answer") }));
  yield* nextLine((line) => line.startsWith('{"ready":'));
  return { home, founder, stdout, stderr, nextLine, url: `http://127.0.0.1:${port.port}` };
});

/** Span rows and error content only. No key file, control socket file or built source is read. */
export const spanOutputs = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const files = yield* fs.glob("**/*.sqlite", { root: home, dot: true });
  const outputs: Array<unknown> = [];

  for (const file of files) {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.sync(() => new DatabaseSync(`${home}/${file}`, { readOnly: true })),
          (db) => Effect.sync(() => db.close()),
        );
        const tables = new Set(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all()
            .map((row) => row.name),
        );

        for (const table of ["spans", "content", "unsent", "measurements"]) {
          if (tables.has(table)) {
            outputs.push(...db.prepare(`SELECT * FROM ${table}`).all());
          }
        }
      }),
    );
  }

  return outputs;
});

/** Decode both the node queue and delivered record rows, deduplicated by span id. */
export const rebuildSpans = (outputs: ReadonlyArray<unknown>) => {
  const pending = Schema.Struct({ row: Schema.fromJsonString(SpanRow) });
  const delivered = Schema.Struct({
    spanId: SpanRow.fields.spanId,
    name: SpanRow.fields.name,
    attributes: Schema.fromJsonString(SpanRow.fields.attributes),
  });
  const found = new Map<string, typeof delivered.Type>();

  for (const output of outputs) {
    const queued = Schema.decodeUnknownOption(pending)(output);
    const row = Option.isSome(queued) ? Option.some(queued.value.row) : Schema.decodeUnknownOption(delivered)(output);

    if (Option.isSome(row) && row.value.name === "watch.rebuild") {
      found.set(row.value.spanId, row.value);
    }
  }

  return [...found.values()];
};
