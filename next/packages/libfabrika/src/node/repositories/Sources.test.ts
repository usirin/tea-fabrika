// T878, next/, L7. Resolve through the public Repository handle, using real tree and disk bytes.
// The lead runs this file in the isolated Git container after build.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import { ObjectId, Repositories } from "../../repositories/Repositories.ts";
import * as RepositoryOpenTest from "../settings/RepositoryOpenTest.ts";
import * as RepositoriesGit from "./RepositoriesGit.ts";
import * as Sources from "./Sources.ts";

const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  return yield* (yield* ChildProcessSpawner.ChildProcessSpawner).string(
    ChildProcess.make("git", [...args], {
      cwd,
      extendEnv: true,
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    }),
  );
});

it.effect.prop(
  "L7: injected committed trees keep their base and symlinks while outside disk changes independently",
  {
    tape: Arbitrary.array(Arbitrary.schema(Schema.Struct({ move: Schema.Natural, pick: Schema.Natural })), {
      minLength: 1,
      maxLength: 8,
    }),
  },
  ({ tape }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-source-read-" });
        const repo = path.join(root, "repo"),
          person = path.join(root, "person"),
          outside = path.join(root, "outside space");
        yield* fs.makeDirectory(path.join(repo, ".fabrika"), { recursive: true });
        yield* fs.makeDirectory(path.join(repo, "inside space"));
        yield* fs.makeDirectory(person);
        const commit = Schema.decodeUnknownSync(ObjectId)("a".repeat(40));
        const entries = new Map<string, { mode: string; type: string; id: string }>([
          [".fabrika", { mode: "040000", type: "tree", id: "b".repeat(40) }],
          ["inside space", { mode: "040000", type: "tree", id: "c".repeat(40) }],
          ["inside space/entry.txt", { mode: "100644", type: "blob", id: "e".repeat(40) }],
          ...["local", "outside", "absolute", "cycle"].map(
            (name) => [`.fabrika/${name}`, { mode: "120000", type: "blob", id: "d".repeat(40) }] as const,
          ),
        ]);
        const blobs = new Map([
          [".fabrika/local", "../inside space"],
          [".fabrika/outside", "../../outside space"],
          [".fabrika/absolute", path.join(repo, "inside space")],
          [".fabrika/cycle", "cycle"],
          ["inside space/entry.txt", "committed"],
        ]);
        const resolve = yield* Sources.resolver({
          root: repo,
          person,
          commit,
          entry: (file) => Effect.succeed(entries.get(file) ?? null),
          read: (file) => Effect.succeed(blobs.has(file) ? new TextEncoder().encode(blobs.get(file)!) : null),
        });
        const sources = ["../inside space", "./local", "./absolute", "../../outside space", "./outside"];
        let present = false,
          disk = "";

        for (const [index, cell] of tape.entries()) {
          if (cell.move % 2 === 0) {
            present = true;
            disk = `outside ${index}`;
            yield* fs.makeDirectory(outside, { recursive: true });
            yield* fs.writeFileString(path.join(outside, "entry.txt"), disk);
          } else {
            present = false;
            yield* fs.remove(outside, { recursive: true, force: true });
          }

          yield* fs.writeFileString(path.join(repo, "inside space/entry.txt"), `dirty ${index}`);
          // Dirty link bytes always disagree with the immutable committed link.
          yield* fs.remove(path.join(repo, ".fabrika/local"), { force: true });
          yield* fs.symlink(outside, path.join(repo, ".fabrika/local"));
          const pick = cell.pick % sources.length;
          const source = yield* resolve(sources[pick]!, "repo").pipe(Effect.exit);
          expect(Exit.isSuccess(source)).toBe(pick < 3 || present);

          if (Exit.isSuccess(source)) {
            expect(source.value._tag).toBe(pick < 3 ? "committed" : "disk");
            expect(string(yield* source.value.read("entry.txt"))).toBe(pick < 3 ? "committed" : disk);
            expect(JSON.stringify(source.value)).not.toContain(root);
          } else {
            const fail = source.cause.reasons.find((reason) => reason._tag === "Fail");
            expect(fail?._tag === "Fail" && fail.error.reason._tag).toBe("MissingPath");
          }

          for (const bad of ["./missing", "./cycle"]) {
            expect(Exit.isFailure(yield* resolve(bad, "repo").pipe(Effect.exit))).toBe(true);
          }

          expect(string(yield* (yield* resolve("./local", "repo")).read("entry.txt"))).toBe("committed");
          expect((yield* resolve("../repo/inside space", "person"))._tag).toBe("disk");
        }
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { seed: 119120, runs: 200 } },
);

const string = (bytes: Uint8Array | null) => (bytes === null ? null : new TextDecoder().decode(bytes));

it("L7: each prefix resolves from the winning file's base, pins committed bytes and follows outside targets", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ move: fc.nat(), pick: fc.nat() }), { minLength: 1, maxLength: 8 }),
      async (tape) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem,
                path = yield* Path.Path;
              const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-sources-" });
              yield* RepositoryOpenTest.isolateGit(root);
              const repo = path.join(root, "repo"),
                origin = path.join(root, "origin.git"),
                person = path.join(root, "person");
              const outside = path.join(root, "outside space");
              yield* fs.makeDirectory(person);
              yield* fs.makeDirectory(outside);
              yield* fs.writeFileString(path.join(outside, "entry.txt"), "outside 0");
              yield* git(root, ["init", "--bare", "--initial-branch=stable", origin]);
              yield* git(root, ["clone", origin, repo]);
              yield* fs.makeDirectory(path.join(repo, ".fabrika"));
              yield* fs.makeDirectory(path.join(repo, "inside space"));
              yield* fs.writeFileString(path.join(repo, ".fabrika/fabrika.toml"), "");
              yield* fs.writeFileString(path.join(repo, "inside space/entry.txt"), "commit 0");
              yield* fs.symlink("../inside space", path.join(repo, ".fabrika/local-link"));
              yield* fs.symlink("../../outside space", path.join(repo, ".fabrika/outside-link"));
              yield* fs.symlink(path.join(repo, "inside space"), path.join(repo, ".fabrika/absolute-local"));
              yield* fs.symlink(outside, path.join(repo, ".fabrika/absolute-outside"));
              yield* fs.symlink("cycle-b", path.join(repo, ".fabrika/cycle-a"));
              yield* fs.symlink("cycle-a", path.join(repo, ".fabrika/cycle-b"));
              yield* git(repo, ["add", "."]);
              yield* git(repo, ["commit", "-m", "fixture"]);
              yield* git(repo, ["push", "origin", "stable"]);
              yield* Effect.gen(function* () {
                const selected = yield* (yield* Repositories).open(repo);
                const pinned = selected.snapshot.commit;
                let disk = "outside 0",
                  present = true;
                const sources = [
                  { from: "../inside space", committed: true },
                  { from: "./local-link", committed: true },
                  // Regression: absolute committed links must return to tree reads inside the repo.
                  { from: "./absolute-local", committed: true },
                  { from: "../../outside space", committed: false },
                  { from: "./outside-link", committed: false },
                  { from: "./absolute-outside", committed: false },
                ];

                for (const [index, cell] of tape.entries()) {
                  const move = cell.move % 4;

                  if (move === 0) {
                    yield* fs.writeFileString(path.join(repo, "inside space/entry.txt"), `dirty ${index}`);
                    yield* fs.remove(path.join(repo, ".fabrika/local-link"));
                    yield* fs.symlink("../../outside space", path.join(repo, ".fabrika/local-link"));
                    yield* fs.remove(path.join(repo, ".fabrika/absolute-local"));
                    yield* fs.symlink(outside, path.join(repo, ".fabrika/absolute-local"));
                  } else if (move === 1) {
                    present = true;
                    disk = `outside ${index + 1}`;
                    yield* fs.makeDirectory(outside, { recursive: true });
                    yield* fs.writeFileString(path.join(outside, "entry.txt"), disk);
                  } else if (move === 2) {
                    present = false;
                    yield* fs.remove(outside, { recursive: true, force: true });
                  }

                  const { from, committed } = sources[cell.pick % sources.length]!;
                  const resolved = yield* selected.resolve(from, "repo").pipe(Effect.exit);
                  expect(Exit.isSuccess(resolved)).toBe(committed || present);

                  if (Exit.isSuccess(resolved)) {
                    expect(resolved.value._tag).toBe(committed ? "committed" : "disk");
                    expect(string(yield* resolved.value.read("entry.txt"))).toBe(committed ? "commit 0" : disk);

                    if (resolved.value._tag === "committed") {
                      expect(resolved.value.commit).toBe(pinned);
                    }

                    expect(JSON.stringify(resolved.value)).not.toContain(root);
                  } else {
                    const reason = resolved.cause.reasons.find((r) => r._tag === "Fail");
                    expect(reason?._tag === "Fail" && reason.error.reason._tag).toBe("MissingPath");
                  }

                  // Missing sources and cycles do not invalidate an unrelated committed source or selection.
                  for (const bad of ["./missing", "./cycle-a"]) {
                    expect(Exit.isFailure(yield* selected.resolve(bad, "repo").pipe(Effect.exit))).toBe(true);
                  }

                  const stillGood = yield* selected.resolve("../inside space", "repo");
                  expect(string(yield* stillGood.read("entry.txt"))).toBe("commit 0");
                  const own = yield* selected.resolve("../repo/inside space", "person");
                  expect(own._tag).toBe("disk");
                  expect(selected.snapshot.commit).toBe(pinned);
                }
              }).pipe(Effect.provide(RepositoriesGit.layer({ person })));
            }),
          ).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, Digest.layerWebCrypto))),
        ),
    ),
    { seed: 119120, numRuns: 200 },
  );
});
