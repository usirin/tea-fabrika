// T878, next/, L1/L2/L10. Real Git owns the objects; failures are injected at its process edge.
// Lead runs the real-Git laws in the isolated, network-disabled container after build.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Path, Sink, Stream } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import { Repositories } from "../../repositories/Repositories.ts";
import * as RepositoryOpenTest from "../settings/RepositoryOpenTest.ts";
import * as RepositoriesGit from "./RepositoriesGit.ts";

const runs = { seed: 119120, numRuns: 200 };
const text = (bytes: Uint8Array | null) => (bytes === null ? null : new TextDecoder().decode(bytes));
const services = Layer.mergeAll(NodeServices.layer, Digest.layerWebCrypto);

const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return (yield* spawner.string(
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
  )).trim();
});

const fixture = Effect.fnUntraced(function* (format: "sha1" | "sha256", branch: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-git-" });
  yield* RepositoryOpenTest.isolateGit(root);
  const origin = path.join(root, "origin.git"),
    repo = path.join(root, "selected"),
    person = path.join(root, "person");
  yield* fs.makeDirectory(person);
  yield* git(root, ["init", "--bare", `--object-format=${format}`, `--initial-branch=${branch}`, origin]);
  yield* git(root, ["clone", origin, repo]);
  yield* fs.makeDirectory(path.join(repo, ".fabrika"));
  yield* fs.writeFileString(path.join(repo, ".fabrika/fabrika.toml"), 'fabrika-version = "0.0.0"\n');
  yield* fs.writeFileString(path.join(repo, "source.txt"), "committed source");
  yield* git(repo, ["add", "."]);
  yield* git(repo, ["commit", "-m", "fixture"]);
  yield* git(repo, ["push", "origin", branch]);
  const commit = yield* git(repo, ["rev-parse", "HEAD"]);
  return { fs, path, root, origin, repo, person, branch, commit };
});

const withReader = <A, E, R>(person: string, body: Effect.Effect<A, E, R>) =>
  body.pipe(Effect.provide(RepositoriesGit.layer({ person })));

describe("T878 pinned repository reads", () => {
  it("L1: every prefix keeps the pinned tree after checkout edits, branch switches and origin moves", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("sha1" as const, "sha256" as const),
        fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/).map((word) => `trunk-${word}`),
        fc.array(fc.nat(), { minLength: 1, maxLength: 4 }),
        async (format, branch, tape) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const f = yield* fixture(format, branch);
                yield* withReader(
                  f.person,
                  Effect.gen(function* () {
                    const service = yield* Repositories;
                    const pinned = yield* service.open(f.repo);
                    expect(pinned.snapshot).toMatchObject({
                      branch,
                      commit: f.commit,
                      text: 'fabrika-version = "0.0.0"\n',
                    });
                    expect(pinned.snapshot.commit).toHaveLength(format === "sha1" ? 40 : 64);
                    const hash = pinned.snapshot.hash;

                    for (const cell of tape) {
                      const move = cell % 4;

                      if (move === 0) {
                        yield* f.fs.writeFileString(f.path.join(f.repo, ".fabrika/fabrika.toml"), "dirty = true\n");
                        yield* f.fs.writeFileString(f.path.join(f.repo, "source.txt"), `dirty ${cell}`);
                        yield* f.fs.writeFileString(f.path.join(f.repo, "fabrika.toml"), "checkout-only legacy file");
                      } else if (move === 1) {
                        yield* git(f.repo, ["checkout", "--force", "--detach", f.commit]);
                      } else if (move === 2) {
                        yield* git(f.repo, ["checkout", "--force", "-B", branch]);
                        yield* f.fs.writeFileString(f.path.join(f.repo, "source.txt"), `new ${cell}`);
                        yield* git(f.repo, ["add", "-u"]);
                        yield* git(f.repo, ["commit", "--allow-empty", "-m", "move"]);
                        yield* git(f.repo, ["push", "--force", "origin", branch]);
                      } else {
                        yield* f.fs.remove(f.path.join(f.repo, ".fabrika/fabrika.toml"), { force: true });
                      }

                      expect(text(yield* pinned.read("source.txt"))).toBe("committed source");
                      expect(pinned.snapshot.hash).toBe(hash);
                      expect(pinned.snapshot.commit).toBe(f.commit);
                    }

                    // A linked worktree is an alias for this clone, even when detached.
                    const linked = f.path.join(f.root, "linked");
                    yield* git(f.repo, ["worktree", "add", "--detach", linked, f.commit]);
                    const alias = yield* service.open(linked);
                    expect(alias.snapshot.key).toBe(pinned.snapshot.key);
                  }),
                );
              }),
            ).pipe(Effect.provide(services)),
          ),
      ),
      runs,
    );
  });

  it("L5: real clone/common-directory identity separates same basenames and destinations but keeps aliases and credential changes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z][a-z0-9]{5,15}$/),
        fc.array(fc.nat(), { minLength: 1, maxLength: 4 }),
        async (credential, tape) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const f = yield* fixture("sha1", "release");
                const otherRoot = f.path.join(f.root, "other");
                yield* f.fs.makeDirectory(otherRoot);
                const clone = f.path.join(otherRoot, "selected");
                yield* git(otherRoot, ["clone", f.origin, clone]);
                const alias = f.path.join(f.root, "alias");
                yield* git(f.repo, ["worktree", "add", "--detach", alias, f.commit]);
                const real = yield* ChildProcessSpawner.ChildProcessSpawner;
                const key = (location: string, destination: string) => {
                  const spawner = ChildProcessSpawner.make((command) => {
                    if (command._tag !== "StandardCommand" || !command.args.includes("--get-url")) {
                      return real.spawn(command);
                    }

                    // Model a host URL rewrite while keeping every transport on the local bare origin.
                    const bytes = new TextEncoder().encode(destination);
                    return Effect.succeed(
                      ChildProcessSpawner.makeHandle({
                        pid: ChildProcessSpawner.ProcessId(1),
                        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
                        isRunning: Effect.succeed(false),
                        kill: () => Effect.void,
                        stdin: Sink.drain,
                        stdout: Stream.make(bytes),
                        stderr: Stream.empty,
                        all: Stream.make(bytes),
                        getInputFd: () => Sink.drain,
                        getOutputFd: () => Stream.empty,
                        unref: Effect.succeed(Effect.void),
                      }),
                    );
                  });
                  return withReader(
                    f.person,
                    Repositories.use((service) => service.open(location)),
                  ).pipe(
                    Effect.map((handle) => handle.snapshot.key),
                    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                  );
                };
                const destination = "https://example.invalid/repo.git";
                const initial = yield* key(f.repo, destination);

                for (const cell of tape) {
                  const authorized = `https://fixture:${credential}${cell}@example.invalid/repo.git`;
                  expect(yield* key(f.repo, authorized)).toBe(initial);
                  expect(yield* key(alias, authorized)).toBe(initial);
                  expect(yield* key(clone, authorized)).not.toBe(initial);
                  expect(yield* key(f.repo, `${destination}-${cell}`)).not.toBe(initial);
                }
              }),
            ).pipe(Effect.provide(services)),
          ),
      ),
      { seed: 119120, numRuns: 300 },
    );
  });

  it("L2: only an absent tree entry is an empty document; every requested Git failure refuses", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { minLength: 1, maxLength: 4 }), async (tape) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const f = yield* fixture("sha1", "release");
              yield* git(f.repo, ["rm", ".fabrika/fabrika.toml"]);
              yield* git(f.repo, ["commit", "-m", "absent"]);
              yield* git(f.repo, ["push", "origin", f.branch]);
              const absent = yield* withReader(
                f.person,
                Effect.gen(function* () {
                  return yield* (yield* Repositories).open(f.repo);
                }),
              );
              expect(absent.snapshot.text).toBeNull();
              // Restore the committed document for blob/type failures, without touching this checkout's git.
              yield* git(f.repo, ["revert", "--no-edit", "HEAD"]);
              yield* git(f.repo, ["push", "origin", f.branch]);
              const real = yield* ChildProcessSpawner.ChildProcessSpawner;
              const object = "a".repeat(40);
              const validHead = `ref: refs/heads/release\tHEAD\n${object}\tHEAD\n`;
              const faults = [
                { operation: "fetch", flag: "--no-tags", output: "", code: 1 },
                { operation: "ls-tree", flag: ".fabrika/fabrika.toml", output: "", code: 1 },
                { operation: "cat-file", flag: "blob", output: "", code: 1 },
                { operation: "ls-remote", flag: "--symref", output: "", code: 1 },
                { operation: "rev-parse", flag: "--verify", output: "", code: 1 },
                { operation: "rev-parse", flag: "--verify", output: "not-an-object", code: 0 },
                { operation: "rev-parse", flag: "--show-object-format", output: "sha999", code: 0 },
                { operation: "ls-remote", flag: "--symref", output: `${object}\tHEAD\n`, code: 0 },
                { operation: "ls-remote", flag: "--symref", output: validHead + validHead, code: 0 },
                { operation: "ls-remote", flag: "--symref", output: "ref: refs/heads/release\tHEAD\n", code: 0 },
                { operation: "ls-remote", flag: "--symref", output: validHead.replace(object, "invalid"), code: 0 },
                {
                  operation: "ls-tree",
                  flag: ".fabrika/fabrika.toml",
                  output: `040000 tree ${object}\t.fabrika/fabrika.toml\0`,
                  code: 0,
                },
                {
                  operation: "ls-tree",
                  flag: ".fabrika/fabrika.toml",
                  output: `160000 commit ${object}\t.fabrika/fabrika.toml\0`,
                  code: 0,
                },
                {
                  operation: "ls-tree",
                  flag: ".fabrika/fabrika.toml",
                  output: `120000 blob ${object}\t.fabrika/fabrika.toml\0`,
                  code: 0,
                },
                {
                  operation: "ls-tree",
                  flag: ".fabrika/fabrika.toml",
                  output: `100644 blob ${object}\twrong-path\0`,
                  code: 0,
                },
                {
                  operation: "ls-tree",
                  flag: ".fabrika/fabrika.toml",
                  output: `100644 blob ${object}\t.fabrika/fabrika.toml`,
                  code: 0,
                },
                { operation: "cat-file", flag: "blob", output: new Uint8Array([0xc3, 0x28]), code: 0 },
              ];

              for (const cell of tape) {
                const fault = faults[cell % faults.length]!;
                let hits = 0;
                const injected = ChildProcessSpawner.make((command) => {
                  if (
                    command._tag === "StandardCommand" &&
                    command.args.includes(fault.operation) &&
                    command.args.includes(fault.flag)
                  ) {
                    hits++;
                    const bytes =
                      typeof fault.output === "string" ? new TextEncoder().encode(fault.output) : fault.output;
                    return Effect.succeed(
                      ChildProcessSpawner.makeHandle({
                        pid: ChildProcessSpawner.ProcessId(1),
                        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(fault.code)),
                        isRunning: Effect.succeed(false),
                        kill: () => Effect.void,
                        stdin: Sink.drain,
                        stdout: Stream.make(bytes),
                        stderr: Stream.empty,
                        all: Stream.make(bytes),
                        getInputFd: () => Sink.drain,
                        getOutputFd: () => Stream.empty,
                        unref: Effect.succeed(Effect.void),
                      }),
                    );
                  }

                  return real.spawn(command);
                });
                const exit = yield* withReader(
                  f.person,
                  Effect.gen(function* () {
                    return yield* (yield* Repositories).open(f.repo);
                  }),
                ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, injected), Effect.exit);
                expect(hits).toBeGreaterThan(0);
                expect(Exit.isFailure(exit)).toBe(true);

                if (Exit.isFailure(exit)) {
                  const fail = exit.cause.reasons.find((r) => r._tag === "Fail");
                  expect(fail?._tag === "Fail" && fail.error._tag).toBe("RepositoriesError");
                }
              }

              // Named replacement for Load's former repo disk-failure law.
              const missingOrigin = yield* git(f.repo, ["remote", "remove", "origin"]);
              void missingOrigin;
              const refused = yield* withReader(
                f.person,
                Effect.gen(function* () {
                  return yield* (yield* Repositories).open(f.repo);
                }),
              ).pipe(Effect.exit);
              expect(Exit.isFailure(refused)).toBe(true);
            }),
          ).pipe(Effect.provide(services)),
        ),
      ),
      runs,
    );
  });

  it("L2: each committed legacy-file combination keeps its refusal rule despite opposite checkout files", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { minLength: 1, maxLength: 4 }), async (tape) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const f = yield* fixture("sha1", "release");
              const names = ["fabrika.toml", ".fabrika.jsonc", ".fabrika/fabrika.toml"];

              for (const cell of tape) {
                const world = cell % 4;

                for (const name of names) {
                  yield* f.fs.remove(f.path.join(f.repo, name), { force: true });
                }

                yield* f.fs.writeFileString(
                  f.path.join(f.repo, world < 2 ? "fabrika.toml" : ".fabrika.jsonc"),
                  world < 2 ? "" : "{}",
                );

                if (world % 2 === 1) {
                  yield* f.fs.writeFileString(f.path.join(f.repo, ".fabrika/fabrika.toml"), "");
                }

                yield* git(f.repo, ["add", "-A"]);
                yield* git(f.repo, ["commit", "--allow-empty", "-m", "legacy combination"]);
                yield* git(f.repo, ["push", "origin", f.branch]);

                // The checkout claims the opposite of the committed refusal or allowance.
                for (const name of names) {
                  yield* f.fs.remove(f.path.join(f.repo, name), { force: true });
                }

                if (world === 3) {
                  yield* f.fs.writeFileString(f.path.join(f.repo, "fabrika.toml"), "");
                } else {
                  yield* f.fs.writeFileString(f.path.join(f.repo, ".fabrika/fabrika.toml"), "");
                }

                const result = yield* withReader(
                  f.person,
                  Effect.gen(function* () {
                    return yield* (yield* Repositories).open(f.repo);
                  }),
                ).pipe(Effect.exit);
                expect(Exit.isSuccess(result)).toBe(world === 3);

                if (Exit.isSuccess(result)) {
                  expect(result.value.snapshot.text).toBe("");
                }
              }
            }),
          ).pipe(Effect.provide(services)),
        ),
      ),
      runs,
    );
  });

  it("L10: success, refusal and interruption release every acquired Git child and temporary directory", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { minLength: 1, maxLength: 4 }), async (tape) => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            let directory = "";
            yield* Effect.scoped(
              Effect.gen(function* () {
                const f = yield* fixture("sha1", "stable");
                directory = f.root;
                const real = yield* ChildProcessSpawner.ChildProcessSpawner;

                for (const cell of tape) {
                  let held = 0;
                  const children: Array<ChildProcessSpawner.ChildProcessHandle> = [];
                  const directories: Array<string> = [];
                  const entered = yield* Deferred.make<void>();
                  const trackedFs: FileSystem.FileSystem = {
                    ...f.fs,
                    makeTempDirectoryScoped: (options) =>
                      f.fs
                        .makeTempDirectoryScoped(options)
                        .pipe(Effect.tap((directory) => Effect.sync(() => directories.push(directory)))),
                  };
                  const tracked = ChildProcessSpawner.make((command) =>
                    Effect.gen(function* () {
                      yield* Effect.acquireRelease(
                        Effect.sync(() => {
                          held++;
                        }),
                        () =>
                          Effect.sync(() => {
                            held--;
                          }),
                      );
                      const child = yield* real.spawn(
                        cell % 3 === 2
                          ? ChildProcess.make(process.execPath, ["-e", "setInterval(() => {}, 1000)"])
                          : command,
                      );
                      children.push(child);
                      yield* Deferred.succeed(entered, undefined);
                      return child;
                    }),
                  );

                  if (cell % 3 === 1) {
                    yield* git(f.repo, ["remote", "set-url", "origin", f.path.join(f.root, "missing.git")]);
                  }

                  const operation = Effect.scoped(
                    withReader(
                      f.person,
                      Effect.gen(function* () {
                        return yield* (yield* Repositories).open(f.repo);
                      }),
                    ),
                  ).pipe(
                    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, tracked),
                    Effect.provideService(FileSystem.FileSystem, trackedFs),
                    Effect.exit,
                  );
                  const fiber = yield* operation.pipe(Effect.forkScoped);
                  yield* Deferred.await(entered);

                  if (cell % 3 === 2) {
                    yield* Fiber.interrupt(fiber);
                  } else {
                    yield* Fiber.join(fiber);
                  }

                  expect(held).toBe(0);
                  expect(children.length).toBeGreaterThan(0);

                  for (const child of children) {
                    expect(yield* child.isRunning).toBe(false);
                  }

                  for (const directory of directories) {
                    expect(yield* f.fs.exists(directory)).toBe(false);
                  }

                  yield* git(f.repo, ["remote", "set-url", "origin", f.origin]);
                }
              }),
            );
            expect(yield* fs.exists(directory)).toBe(false);
          }).pipe(Effect.scoped, Effect.provide(services)),
        );
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
});
