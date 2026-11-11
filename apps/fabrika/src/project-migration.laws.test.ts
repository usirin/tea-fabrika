import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileStorage } from "@kampus/fabrika-old/storage/node";
import { Effect, FileSystem, PlatformError, Result, Schema } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { deskMachine, savedOf } from "./desk/desk.ts";
import { go, home, options, plant, repo, word } from "./project.test-support.ts";

const saved = fc.record({
  body: word,
  job: fc.integer({ min: 1, max: 9000 }),
  sameRoot: fc.boolean(),
  failAt: fc.nat({ max: 30 }),
});

const snapshot = (folder: string): Record<string, { digest: string; bytes: number; mode: number }> => {
  const found: Record<string, { digest: string; bytes: number; mode: number }> = {};
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const file = join(at, entry.name);

      if (entry.isDirectory()) {
        walk(file);
      } else if (entry.isFile()) {
        found[relative(folder, file)] = {
          digest: createHash("sha256").update(readFileSync(file)).digest("hex"),
          bytes: statSync(file).size,
          mode: statSync(file).mode & 0o777,
        };
      }
    }
  };
  walk(folder);
  return found;
};

const sameFiles = (actual: ReturnType<typeof snapshot>, expected: ReturnType<typeof snapshot>) => {
  for (const [file, facts] of Object.entries(expected)) {
    expect(actual[file], file).toEqual(facts);
  }
};

const fixture = async (body: string, job: number, folders: readonly string[]) => {
  const app = home();
  const old = join(app, "legacy");
  const desk = deskMachine.init(null, undefined)[0];

  if (desk.at !== "open") {
    throw new Error("fixture desk closed");
  }

  const files: Record<string, string> = {
    "desk.json": JSON.stringify(savedOf(desk)),
    "asks.json": JSON.stringify({ seen: ["7/ask"], later: [] }),
    history: `${body}\n`,
    [`storage/jobs/job-${job}.json`]: JSON.stringify({ n: job, id: `job:${body}`, text: "counter" }),
    "records/fixture.jsonl": `${JSON.stringify({ id: body, input: 7, output: 11, cost: 0 })}\n`,
    "ledger.json": JSON.stringify({
      url: "https://fixture.invalid",
      ledger: "fixture",
      login: "fixture",
      key: "fixture-no-key-file",
    }),
    "host/log": "fixture host stopped\n",
    "host/restart.json": JSON.stringify({ by: "user:fixture", why: body, at: 1 }),
  };

  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(old, file)), { recursive: true, mode: 0o700 });
    writeFileSync(join(old, file), text, { mode: 0o600 });
  }

  // The actual Storage writes its checksummed slots and original run IDs.
  const Names = Schema.Struct({
    names: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        agent: Schema.String,
        run: Schema.String,
        model: Schema.Struct({
          typed: Schema.NullOr(Schema.String),
          resolved: Schema.NullOr(Schema.String),
        }),
        effort: Schema.Struct({
          typed: Schema.NullOr(Schema.String),
          set: Schema.NullOr(Schema.String),
        }),
        folder: Schema.String,
        since: Schema.Number,
        by: Schema.String,
      }),
    ),
  });
  const storage = fileStorage(join(old, "storage"));
  const handle = await Effect.runPromise(storage.open("summon", null));
  await handle.store("names", "names", Names).save({
    names: folders.map((folder, i) => ({
      name: `scout-${i}`,
      agent: "fake",
      run: `acp:${body}-${i}`,
      model: { typed: null, resolved: "fake-small" },
      effort: { typed: null, set: null },
      folder,
      since: 1,
      by: "user:fixture",
    })),
  });
  const database = new DatabaseSync(join(old, "ledger.sqlite"));
  database.exec("CREATE TABLE fixture (id TEXT, n INTEGER)");
  database.prepare("INSERT INTO fixture VALUES (?, ?)").run(body, job);
  database.close();
  chmodSync(join(old, "ledger.sqlite"), 0o600);
  return { app, old, before: snapshot(old) };
};

it("P11: reserve the summons' root or first accepted root; every write failure can retry without losing bytes or IDs", async () => {
  const { Project } = await import("./project.ts");
  const { migrateProject } = await import("./project-migration.ts");
  await fc.assert(
    fc.asyncProperty(saved, async ({ body, job, sameRoot, failAt }) => {
      const roots = home();
      const left = await go(Project.check(repo(roots, "left")));
      const right = await go(Project.check(repo(roots, "right")));
      const folders = sameRoot ? [left.root, left.root] : [left.root, right.root];
      const baseline = await fixture(body, job, folders);
      let count = 0;
      await go(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const disk = FileSystem.FileSystem.of({
            ...fs,
            writeFile: (...args) => {
              count++;
              return fs.writeFile(...args);
            },
            writeFileString: (...args) => {
              count++;
              return fs.writeFileString(...args);
            },
            copyFile: (...args) => {
              count++;
              return fs.copyFile(...args);
            },
            copy: (...args) => {
              count++;
              return fs.copy(...args);
            },
            makeDirectory: (...args) => {
              count++;
              return fs.makeDirectory(...args);
            },
            chmod: (...args) => {
              count++;
              return fs.chmod(...args);
            },
            rename: (...args) => {
              count++;
              return fs.rename(...args);
            },
          });
          return yield* migrateProject({
            home: baseline.app,
            legacy: baseline.old,
            project: right,
            restart: "accepted",
          }).pipe(Effect.provideService(FileSystem.FileSystem, disk));
        }),
      );
      expect(count).toBeGreaterThan(0);

      for (let offset = 0; offset < count; offset++) {
        const f = await fixture(body, job, folders);
        const failure = (failAt + offset) % count;
        let boundary = 0;
        const attempt = await go(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const fault = PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "writeFile",
              description: "fixture interrupted migration",
            });
            const disk = FileSystem.FileSystem.of({
              ...fs,
              writeFile: (...args) => (boundary++ === failure ? Effect.fail(fault) : fs.writeFile(...args)),
              writeFileString: (...args) => (boundary++ === failure ? Effect.fail(fault) : fs.writeFileString(...args)),
              copyFile: (...args) => (boundary++ === failure ? Effect.fail(fault) : fs.copyFile(...args)),
              copy: (...args) => (boundary++ === failure ? Effect.fail(fault) : fs.copy(...args)),
              makeDirectory: (...args) => (boundary++ === failure ? Effect.fail(fault) : fs.makeDirectory(...args)),
              chmod: (...args) => (boundary++ === failure ? Effect.fail(fault) : fs.chmod(...args)),
              rename: (...args) => (boundary++ === failure ? Effect.fail(fault) : fs.rename(...args)),
            });
            return yield* migrateProject({
              home: f.app,
              legacy: f.old,
              project: right,
              restart: "accepted",
            }).pipe(Effect.provideService(FileSystem.FileSystem, disk), Effect.result);
          }),
        );
        sameFiles(snapshot(f.old), f.before);

        if (Result.isFailure(attempt)) {
          // A failed move cannot claim completion or silently become an empty desk.
          const marker = join(f.app, "migration.json");

          if (existsSync(marker)) {
            expect(JSON.parse(readFileSync(marker, "utf8")).phase).not.toBe("complete");
          }
        }

        const recovered = await go(migrateProject({ home: f.app, legacy: f.old, project: right, restart: "accepted" }));
        const target = sameRoot ? left : right;
        expect(recovered.project.key).toBe(target.key);
        expect(recovered.rule).toBe(sameRoot ? "summons" : "first_accepted");
        expect(recovered.phase).toBe("complete");
        sameFiles(snapshot(join(f.app, "projects", target.key)), f.before);
        sameFiles(snapshot(f.old), f.before);
        const again = await go(migrateProject({ home: f.app, legacy: f.old, project: left, restart: "accepted" }));
        expect(again.project.key).toBe(target.key);
        const record = JSON.parse(readFileSync(join(f.app, "migration.json"), "utf8"));

        for (const field of ["format", "project", "rule", "files", "digests", "phase", "at", "result"]) {
          expect(record).toHaveProperty(field);
        }
      }
    }),
    { ...options, numRuns: 5 },
  );
});

plant("P11 mark complete before publication", saved, ({ body }) =>
  sameFiles({}, { history: { digest: body, bytes: body.length, mode: 0o600 } }),
);

it("P12: refusal leaves a live legacy host alone; acceptance precedes copying; failed moves keep their source", async () => {
  const { Project } = await import("./project.ts");
  const { migrateProject } = await import("./project-migration.ts");
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("refused", "accepted", "failed"), { minLength: 1, maxLength: 12 }),
      async (orders) => {
        const root = home();
        const project = await go(Project.check(repo(root, "repo")));
        const f = await fixture("fixture", 71, [project.root]);
        let stopped = false;
        const calls: string[] = [];

        for (const restart of orders) {
          await go(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const disk = FileSystem.FileSystem.of({
                ...fs,
                copy: (...args) => {
                  calls.push("copy");
                  expect(stopped).toBe(true);
                  return restart === "failed"
                    ? Effect.fail(
                        PlatformError.systemError({
                          _tag: "PermissionDenied",
                          module: "FileSystem",
                          method: "copy",
                          description: "fixture migration failed",
                        }),
                      )
                    : fs.copy(...args);
                },
                copyFile: (...args) => {
                  calls.push("copy");
                  expect(stopped).toBe(true);
                  return restart === "failed"
                    ? Effect.fail(
                        PlatformError.systemError({
                          _tag: "PermissionDenied",
                          module: "FileSystem",
                          method: "copyFile",
                          description: "fixture migration failed",
                        }),
                      )
                    : fs.copyFile(...args);
                },
              });
              return yield* migrateProject({
                home: f.app,
                legacy: f.old,
                project,
                restart: restart === "refused" ? "refused" : "accepted",
                live: () => Effect.succeed(!stopped),
                stop: () =>
                  Effect.sync(() => {
                    calls.push("stop");
                    stopped = true;
                  }),
              }).pipe(Effect.provideService(FileSystem.FileSystem, disk), Effect.result);
            }),
          );
          sameFiles(snapshot(f.old), f.before);

          if (!stopped) {
            expect(calls).toEqual([]);
          }
        }

        if (calls.includes("copy")) {
          expect(calls.indexOf("stop")).toBeLessThan(calls.indexOf("copy"));
        }
      },
    ),
    options,
  );
});

plant("P12 copy before stopping or delete the originals", fc.array(word, { minLength: 1 }), () =>
  expect(["copy", "stop"].indexOf("stop")).toBeLessThan(["copy", "stop"].indexOf("copy")),
);
