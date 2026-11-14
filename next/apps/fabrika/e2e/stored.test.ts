// The laws for L17's home scan, `stored` (stored.test-support.ts), which reads the home while the
// instance runs and again after its stop. A running brain writes each file to `<name>.tmp` and
// renames it over `<name>` (`durableWrite` in libfabrika's `node/dev/local-dev.ts`), so a listed
// temp file can be gone before the scan reads it: that turned L17 red on CI run 43562939099. And the
// span queue `brain.records.sqlite` is in WAL mode, so a row deleted once delivered stays on disk in
// its `-wal` file only until the clean stop closes the database. Each race here is certain, not timed.
import { DatabaseSync } from "node:sqlite"; // edge: a real WAL database, as the brain's span queue keeps one
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, Path, PlatformError, Ref } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stored } from "./stored.test-support.ts";

const SEED = 119120;
const NAMES = ["brain.last.json", "brain.pending.jsonl", "records/brain.json"] as const;

/** Some of the brain's files, and which of them a write renames into place under each listing. */
const homes = fc
  .uniqueArray(fc.constantFrom(...NAMES), { minLength: 1 })
  .chain((files) => fc.record({ files: fc.constant(files), renamed: fc.subarray(files) }));

const byLabel = ([a]: readonly [string, string], [b]: readonly [string, string]) => (a < b ? -1 : a > b ? 1 : 0);

describe("stored", () => {
  it("[secrets] files renamed into place under a listing never fail the scan, and the stopped pass reads each file's last write", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ secret: fc.stringMatching(/^[A-Za-z0-9]{24,40}$/), home: homes }),
        ({ secret, home: { files, renamed } }) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const real = yield* FileSystem.FileSystem,
                  path = yield* Path.Path;
                const dir = yield* real.makeTempDirectoryScoped({ prefix: "stored." });
                const running = yield* Ref.make(true);
                yield* real.makeDirectory(path.join(dir, "records"));
                const write = (name: string, text: string) =>
                  real
                    .writeFileString(path.join(dir, `${name}.tmp`), text)
                    .pipe(Effect.andThen(real.rename(path.join(dir, `${name}.tmp`), path.join(dir, name))));
                const last = (name: string) => JSON.stringify(`stopped_${secret}_${name}`);

                for (const name of files) {
                  yield* write(name, JSON.stringify("start"));
                }

                const fs: FileSystem.FileSystem = {
                  ...real,
                  readDirectory: (folder, options) =>
                    Effect.gen(function* () {
                      if (!(yield* Ref.get(running))) {
                        return yield* real.readDirectory(folder, options);
                      }

                      for (const name of renamed) {
                        yield* real.writeFileString(path.join(dir, `${name}.tmp`), JSON.stringify("listed"));
                      }

                      const names = yield* real.readDirectory(folder, options);

                      for (const name of renamed) {
                        yield* real.rename(path.join(dir, `${name}.tmp`), path.join(dir, name));
                      }

                      return names;
                    }),
                };
                const stop = Effect.forEach(files, (name) => write(name, last(name)), {
                  concurrency: 1,
                  discard: true,
                }).pipe(Effect.andThen(Ref.set(running, false)));
                const disk = yield* stored({ dir, stop }, new Map(), []).pipe(
                  Effect.provideService(FileSystem.FileSystem, fs),
                );

                expect([...disk.running].toSorted()).toEqual(files.map((name) => `/${name}`).toSorted());
                expect(disk.raw.filter(([label]) => !label.startsWith("home (running)")).toSorted(byLabel)).toEqual(
                  files.map((name): readonly [string, string] => [`home /${name}`, last(name)]).toSorted(byLabel),
                );
              }),
            ).pipe(Effect.provide(NodeServices.layer)),
          ),
      ),
      { seed: SEED, numRuns: 20 },
    );
  });

  it("[secrets] a row deleted from a WAL database that the stop folds away is still found, by the running pass", async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[A-Za-z0-9]{24,40}$/), (secret) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem,
                path = yield* Path.Path;
              const dir = yield* fs.makeTempDirectoryScoped({ prefix: "stored." });
              const sentinel = `span_${secret}`;
              const db = yield* Effect.acquireRelease(
                Effect.sync(() => new DatabaseSync(path.join(dir, "brain.records.sqlite"))),
                (db) => Effect.sync(() => (db.isOpen ? db.close() : undefined)),
              );
              // The span queue's own pragmas (dev-recording.ts), and SQLite's default secure_delete.
              db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=0");
              db.exec("CREATE TABLE spans (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
              const insert = db.prepare("INSERT INTO spans (body) VALUES (?)");
              insert.run(sentinel);
              // Delivered, so deleted, as the queue deletes a row after a flush (telemetry/Sink.ts).
              db.exec("DELETE FROM spans");

              for (let n = 0; n < 20; n++) {
                insert.run("x".repeat(sentinel.length));
              }

              const disk = yield* stored({ dir, stop: Effect.sync(() => db.close()) }, new Map(), []);
              const holders = disk.raw.filter(([, text]) => text.includes(sentinel)).map(([label]) => label);

              // The clean stop folds the WAL into the database and deletes it, and the row is gone.
              expect(holders.filter((label) => !label.startsWith("home (running)"))).toEqual([]);
              expect(disk.running).toContain("/brain.records.sqlite-wal");
              expect(holders).toContain("home (running) /brain.records.sqlite-wal");
            }),
          ).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
      { seed: SEED, numRuns: 10 },
    );
  });

  it("[secrets] every file the running pass reads is an output L17 checks, the span queue's WAL with its deleted row included", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          secret: fc.stringMatching(/^[A-Za-z0-9]{24,40}$/),
          files: fc.uniqueArray(fc.constantFrom(...NAMES)),
        }),
        ({ secret, files }) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const fs = yield* FileSystem.FileSystem,
                  path = yield* Path.Path;
                const dir = yield* fs.makeTempDirectoryScoped({ prefix: "stored." });
                const sentinel = `span_${secret}`;
                yield* fs.makeDirectory(path.join(dir, "records"));

                for (const name of files) {
                  yield* fs.writeFileString(path.join(dir, name), JSON.stringify(`${name}_${secret}`));
                }

                const db = yield* Effect.acquireRelease(
                  Effect.sync(() => new DatabaseSync(path.join(dir, "brain.records.sqlite"))),
                  (db) => Effect.sync(() => (db.isOpen ? db.close() : undefined)),
                );
                db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=0");
                db.exec("CREATE TABLE spans (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
                const insert = db.prepare("INSERT INTO spans (body) VALUES (?)");
                insert.run(sentinel);
                db.exec("DELETE FROM spans");

                for (let n = 0; n < 20; n++) {
                  insert.run("x".repeat(sentinel.length));
                }

                const disk = yield* stored({ dir, stop: Effect.sync(() => db.close()) }, new Map(), []);
                const running = disk.raw.filter(([label]) => label.startsWith("home (running)"));
                const labels = new Set(disk.outputs.map(([label]) => label));

                expect(running.length).toBeGreaterThan(0);
                expect(running.map(([label]) => label).filter((label) => !labels.has(label))).toEqual([]);
                expect(
                  disk.outputs.some(
                    ([label, text]) => label === "home (running) /brain.records.sqlite-wal" && text.includes(sentinel),
                  ),
                  "the WAL's deleted row is an output",
                ).toBe(true);
              }),
            ).pipe(Effect.provide(NodeServices.layer)),
          ),
      ),
      { seed: SEED, numRuns: 10 },
    );
  });

  it("[secrets] only a file gone in the running pass is passed over: any other failure, in either pass, fails the scan", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.constantFrom(...NAMES), { minLength: 1 }).chain((files) =>
          fc.record({
            files: fc.constant(files),
            failing: fc.constantFrom(...files),
            method: fc.constantFrom("stat" as const, "readFile" as const),
            pass: fc.constantFrom("running" as const, "stopped" as const),
            reason: fc.constantFrom("NotFound" as const, "PermissionDenied" as const, "Busy" as const),
          }),
        ),
        ({ files, failing, method, pass, reason }) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const real = yield* FileSystem.FileSystem,
                  path = yield* Path.Path;
                const dir = yield* real.makeTempDirectoryScoped({ prefix: "stored." });
                const stopped = yield* Ref.make(false);
                yield* real.makeDirectory(path.join(dir, "records"));

                for (const name of files) {
                  yield* real.writeFileString(path.join(dir, name), JSON.stringify(name));
                }

                const target = path.join(dir, failing);
                // Fails `method` on the one generated file, and only in the generated pass.
                const fault = (file: string, called: "stat" | "readFile") =>
                  Effect.gen(function* () {
                    const now = (yield* Ref.get(stopped)) ? "stopped" : "running";

                    if (file === target && called === method && now === pass) {
                      return yield* PlatformError.systemError({
                        _tag: reason,
                        module: "FileSystem",
                        method,
                        pathOrDescriptor: file,
                      });
                    }
                  });
                const fs: FileSystem.FileSystem = {
                  ...real,
                  stat: (file) => fault(file, "stat").pipe(Effect.andThen(real.stat(file))),
                  readFile: (file) => fault(file, "readFile").pipe(Effect.andThen(real.readFile(file))),
                };
                const exit = yield* stored({ dir, stop: Ref.set(stopped, true) }, new Map(), []).pipe(
                  Effect.provideService(FileSystem.FileSystem, fs),
                  Effect.exit,
                );
                const all = files.map((name) => `/${name}`).toSorted();
                // What the scan did: the files each pass read, or the error it failed with.
                const seen = Exit.match(exit, {
                  onSuccess: (disk) => ({
                    running: [...disk.running].toSorted(),
                    stopped: disk.raw
                      .filter(([label]) => !label.startsWith("home (running)"))
                      .map(([label]) => label.slice("home ".length))
                      .toSorted(),
                  }),
                  onFailure: (cause) => {
                    const error = Cause.squash(cause);
                    return PlatformError.isPlatformError(error)
                      ? {
                          failed: error.reason._tag,
                          method: error.reason.method,
                          path: "pathOrDescriptor" in error.reason ? error.reason.pathOrDescriptor : undefined,
                        }
                      : { failed: String(error) };
                  },
                });

                expect(seen, `${reason} on ${method} in the ${pass} pass`).toEqual(
                  pass === "running" && reason === "NotFound"
                    ? { running: all.filter((file) => file !== `/${failing}`), stopped: all }
                    : { failed: reason, method, path: target },
                );
              }),
            ).pipe(Effect.provide(NodeServices.layer)),
          ),
      ),
      { seed: SEED, numRuns: 40 },
    );
  });
});
