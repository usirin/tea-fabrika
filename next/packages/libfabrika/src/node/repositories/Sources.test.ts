// T878, next/, L7. Resolve through the public Repository handle, using real tree and disk bytes.
// The lead runs this file in the isolated Git container after build.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import { ObjectId, Repositories, SourceMetadata } from "../../repositories/Repositories.ts";
import type { Repository } from "../../repositories/Repositories.ts";
import * as RepositoryOpenTest from "../settings/RepositoryOpenTest.ts";
import * as RepositoriesGit from "./RepositoriesGit.ts";
import * as Sources from "./Sources.ts";

const SourceRead = Schema.Union([
  SourceMetadata.cases.committed.mapFields((fields) => ({ ...fields, bytes: Schema.Uint8Array })),
  SourceMetadata.cases.disk.mapFields((fields) => ({ ...fields, bytes: Schema.Uint8Array })),
]);

const checkRead = (value: unknown, committed: boolean, commit: string, text: string, privateRoot: string) => {
  const read = Schema.decodeUnknownSync(SourceRead)(value);
  expect(read._tag).toBe(committed ? "committed" : "disk");
  expect(new TextDecoder().decode(read.bytes)).toBe(text);

  if (read._tag === "committed") {
    expect(read.commit).toBe(commit);
  } else {
    expect(Object.hasOwn(read, "commit")).toBe(false);
  }

  expect(JSON.stringify(value)).not.toContain(privateRoot);
};

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

const personBases = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = path.join(root, "person-target"),
    settings = path.join(home, ".fabrika"),
    linked = path.join(root, "person-link"),
    missing = path.join(root, "missing-person");
  yield* fs.makeDirectory(settings, { recursive: true });
  yield* fs.symlink("person-target/.fabrika", linked);
  // A lexical parent is readable too, so selecting it cannot pass by accident.
  yield* fs.writeFileString(path.join(root, "entry.txt"), "wrong parent");

  return {
    linked,
    missing,
    check: Effect.fnUntraced(function* (resolve: Repository["resolve"], absent: boolean, revision: number) {
      const own = `settings ${revision}`,
        parent = `person parent ${revision}`;
      yield* fs.writeFileString(path.join(settings, "entry.txt"), own);
      yield* fs.writeFileString(path.join(home, "entry.txt"), parent);
      const actual = [],
        expected = [];

      for (const from of [".", "./", "./.", "..", "../", "./.."]) {
        const reads: ReadonlyArray<readonly [string, string]> = from.includes("..")
          ? [
              ["entry.txt", parent],
              ["./.fabrika/entry.txt", own],
            ]
          : [
              ["entry.txt", own],
              ["../entry.txt", parent],
            ];
        const result = yield* resolve(from, "person").pipe(
          Effect.flatMap((source) =>
            Effect.gen(function* () {
              expect(JSON.stringify(source)).not.toContain(root);
              const values = [];

              for (const [file] of reads) {
                const value = yield* source.read(file);
                const read = Schema.decodeUnknownSync(Schema.NullOr(SourceRead))(value);
                expect(JSON.stringify(value)).not.toContain(root);
                values.push(read === null ? null : { tag: read._tag, text: new TextDecoder().decode(read.bytes) });
              }

              return { tag: source._tag, values };
            }),
          ),
          Effect.match({
            onFailure: (error) => ({ reason: error.reason._tag }),
            onSuccess: (value) => value,
          }),
        );
        actual.push({ from, result });
        expected.push({
          from,
          result: absent
            ? { reason: "MissingPath" }
            : { tag: "disk", values: reads.map(([, text]) => ({ tag: "disk", text })) },
        });
      }

      return { actual, expected };
    }),
  };
});

const directorySuffixes = ["/.", "/..", "/child", "/", "/./entry.txt", "/../entry.txt"] as const;

const Traversal = Schema.Struct({
  suffix: Schema.Literals(directorySuffixes),
  inTarget: Schema.Boolean,
});

const regularFileLinks = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const blobs = new Map<string, string>([["traversal/entry.txt", "regular file"]]);
  const entries = new Map<string, { mode: string; type: string; id: string }>([
    ["traversal", { mode: "040000", type: "tree", id: "b".repeat(40) }],
    ["traversal/entry.txt", { mode: "100644", type: "blob", id: "c".repeat(40) }],
  ]);
  const links = [
    { name: "file-link", target: "entry.txt" },
    ...directorySuffixes.map((suffix, index) => ({ name: `target-${index}`, target: `entry.txt${suffix}` })),
  ];

  for (const folder of [path.join(root, "repo/traversal"), path.join(root, "disk traversal")]) {
    yield* fs.makeDirectory(folder, { recursive: true });
    yield* fs.writeFileString(path.join(folder, "entry.txt"), "regular file");

    for (const link of links) {
      yield* fs.symlink(link.target, path.join(folder, link.name));
      blobs.set(`traversal/${link.name}`, link.target);
      entries.set(`traversal/${link.name}`, { mode: "120000", type: "blob", id: "d".repeat(40) });
    }
  }

  return {
    blobs,
    entries,
    check: Effect.fnUntraced(function* (resolve: Repository["resolve"], traversal: typeof Traversal.Type) {
      const file = traversal.inTarget
        ? `target-${directorySuffixes.indexOf(traversal.suffix)}`
        : `file-link${traversal.suffix}`;
      const actual = [],
        expected = [];

      for (const document of ["repo", "person"] as const) {
        const from = document === "repo" ? "../traversal" : "../disk traversal";
        const source = yield* resolve(from, document);
        // A plain file link remains readable. Only directory traversal must fail.
        expect(string(yield* source.read("file-link"))).toBe("regular file");

        for (const operation of ["resolve", "read"] as const) {
          const result = yield* (
            operation === "resolve" ? resolve(`${from}/${file}`, document) : source.read(file)
          ).pipe(
            Effect.match({
              onFailure: (error) => error.reason._tag,
              onSuccess: (value) => (value === null ? "missing" : "success"),
            }),
          );
          actual.push({ document, operation, file, result });
          expected.push({ document, operation, file, result: "ReadFailed" });
        }

        // A refused source must leave the valid source usable.
        expect(string(yield* source.read("entry.txt"))).toBe("regular file");
      }

      expect(actual, JSON.stringify(actual)).toEqual(expected);
    }),
  };
});

it.effect.prop(
  "L7: injected committed trees keep their base and symlinks while outside disk changes independently",
  {
    tape: Arbitrary.array(
      Arbitrary.schema(Schema.Struct({ move: Schema.Natural, pick: Schema.Natural, traversal: Traversal })),
      {
        minLength: 1,
        maxLength: 8,
      },
    ),
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
          ...["local-file", "outside-file", "absolute-local", "absolute-outside"].map(
            (name) => [`inside space/${name}`, { mode: "120000", type: "blob", id: "d".repeat(40) }] as const,
          ),
        ]);
        const blobs = new Map([
          [".fabrika/local", "../inside space"],
          [".fabrika/outside", "../../outside space"],
          [".fabrika/absolute", path.join(repo, "inside space")],
          [".fabrika/cycle", "cycle"],
          ["inside space/entry.txt", "committed"],
          ["inside space/local-file", "entry.txt"],
          ["inside space/outside-file", "../../outside space/entry.txt"],
          ["inside space/absolute-local", path.join(repo, "inside space/entry.txt")],
          ["inside space/absolute-outside", path.join(outside, "entry.txt")],
        ]);
        const traversal = yield* regularFileLinks(root);

        for (const [file, entry] of traversal.entries) {
          entries.set(file, entry);
        }

        for (const [file, text] of traversal.blobs) {
          blobs.set(file, text);
        }

        const resolve = yield* Sources.resolver({
          root: repo,
          person,
          commit,
          entry: (file) => Effect.succeed(entries.get(file) ?? null),
          read: (file) => Effect.succeed(blobs.has(file) ? new TextEncoder().encode(blobs.get(file)!) : null),
        });
        const bases = yield* personBases(root);
        const personResolvers = yield* Effect.forEach(
          [bases.linked, bases.missing],
          (base) =>
            Sources.resolver({
              root: repo,
              person: base,
              commit,
              entry: (file) => Effect.succeed(entries.get(file) ?? null),
              read: (file) => Effect.succeed(blobs.has(file) ? new TextEncoder().encode(blobs.get(file)!) : null),
            }),
          { concurrency: 1 },
        );
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

          for (const name of ["local-file", "outside-file", "absolute-local", "absolute-outside"]) {
            yield* fs.remove(path.join(repo, "inside space", name), { force: true });
            yield* fs.symlink("entry.txt", path.join(repo, "inside space", name));
          }

          const pick = cell.pick % sources.length;
          const source = yield* resolve(sources[pick]!, "repo").pipe(Effect.exit);
          expect(Exit.isSuccess(source)).toBe(pick < 3 || present);

          if (Exit.isSuccess(source)) {
            expect(source.value._tag).toBe(pick < 3 ? "committed" : "disk");
            expect(string(yield* source.value.read("entry.txt"))).toBe(pick < 3 ? "committed" : disk);
            checkRead(yield* source.value.read("entry.txt"), pick < 3, commit, pick < 3 ? "committed" : disk, root);
            expect(JSON.stringify(source.value)).not.toContain(root);
          } else {
            const fail = source.cause.reasons.find((reason) => reason._tag === "Fail");
            expect(fail?._tag === "Fail" && fail.error.reason._tag).toBe("MissingPath");
          }

          for (const bad of ["./missing", "./cycle"]) {
            expect(Exit.isFailure(yield* resolve(bad, "repo").pipe(Effect.exit))).toBe(true);
          }

          expect(string(yield* (yield* resolve("./local", "repo")).read("entry.txt"))).toBe("committed");
          const local = yield* resolve("./local", "repo");

          for (const file of ["entry.txt", "local-file", "absolute-local", "../inside space/entry.txt"]) {
            checkRead(yield* local.read(file), true, commit, "committed", root);
          }

          for (const file of ["outside-file", "absolute-outside", "../../outside space/entry.txt"]) {
            if (present) {
              checkRead(yield* local.read(file), false, commit, disk, root);
            } else {
              expect(yield* local.read(file)).toBeNull();
            }
          }

          const own = yield* resolve("../repo/inside space", "person");
          expect(own._tag).toBe("disk");
          checkRead(yield* own.read("entry.txt"), false, commit, `dirty ${index}`, root);

          const baseReads = yield* Effect.forEach(
            personResolvers,
            (personResolve, base) => bases.check(personResolve, base === 1, index),
            { concurrency: 1 },
          );
          expect(baseReads.map((read) => read.actual)).toEqual(baseReads.map((read) => read.expected));
          checkRead(yield* (yield* resolve("./local", "repo")).read("entry.txt"), true, commit, "committed", root);
          yield* traversal.check(resolve, cell.traversal);
        }
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { seed: 119120, runs: 200 } },
);

const string = (value: unknown) => {
  const read = Schema.decodeUnknownSync(Schema.NullOr(SourceRead))(value);
  return read === null ? null : new TextDecoder().decode(read.bytes);
};

it("L7: each prefix resolves from the winning file's base, pins committed bytes and follows outside targets", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          move: fc.nat(),
          pick: fc.nat(),
          traversal: fc.record({ suffix: fc.constantFrom(...directorySuffixes), inTarget: fc.boolean() }),
        }),
        { minLength: 1, maxLength: 8 },
      ),
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
              yield* fs.symlink("entry.txt", path.join(repo, "inside space/local-file"));
              yield* fs.symlink("../../outside space/entry.txt", path.join(repo, "inside space/outside-file"));
              yield* fs.symlink(
                path.join(repo, "inside space/entry.txt"),
                path.join(repo, "inside space/absolute-local"),
              );
              yield* fs.symlink(path.join(outside, "entry.txt"), path.join(repo, "inside space/absolute-outside"));
              yield* fs.symlink("cycle-b", path.join(repo, ".fabrika/cycle-a"));
              yield* fs.symlink("cycle-a", path.join(repo, ".fabrika/cycle-b"));
              const traversal = yield* regularFileLinks(root);
              yield* git(repo, ["add", "."]);
              yield* git(repo, ["commit", "-m", "fixture"]);
              yield* git(repo, ["push", "origin", "stable"]);
              const bases = yield* personBases(root);
              const personSelections = yield* Effect.forEach(
                [bases.linked, bases.missing],
                (base) =>
                  Effect.gen(function* () {
                    return yield* (yield* Repositories).open(repo);
                  }).pipe(Effect.provide(RepositoriesGit.layer({ person: base }))),
                { concurrency: 1 },
              );
              yield* Effect.gen(function* () {
                const selected = yield* (yield* Repositories).open(repo);
                const pinned = selected.snapshot.commit;
                let disk = "outside 0",
                  present = true,
                  checkout = "commit 0";
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
                    checkout = `dirty ${index}`;
                    yield* fs.writeFileString(path.join(repo, "inside space/entry.txt"), checkout);
                    yield* fs.remove(path.join(repo, ".fabrika/local-link"));
                    yield* fs.symlink("../../outside space", path.join(repo, ".fabrika/local-link"));
                    yield* fs.remove(path.join(repo, ".fabrika/absolute-local"));
                    yield* fs.symlink(outside, path.join(repo, ".fabrika/absolute-local"));

                    for (const name of ["local-file", "outside-file", "absolute-local", "absolute-outside"]) {
                      yield* fs.remove(path.join(repo, "inside space", name));
                      yield* fs.symlink("entry.txt", path.join(repo, "inside space", name));
                    }
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
                    checkRead(
                      yield* resolved.value.read("entry.txt"),
                      committed,
                      pinned,
                      committed ? "commit 0" : disk,
                      root,
                    );

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

                  for (const file of ["entry.txt", "local-file", "absolute-local", "../inside space/entry.txt"]) {
                    checkRead(yield* stillGood.read(file), true, pinned, "commit 0", root);
                  }

                  for (const file of ["outside-file", "absolute-outside", "../../outside space/entry.txt"]) {
                    if (present) {
                      checkRead(yield* stillGood.read(file), false, pinned, disk, root);
                    } else {
                      expect(yield* stillGood.read(file)).toBeNull();
                    }
                  }

                  const own = yield* selected.resolve("../repo/inside space", "person");
                  expect(own._tag).toBe("disk");
                  checkRead(yield* own.read("entry.txt"), false, pinned, checkout, root);

                  const baseReads = yield* Effect.forEach(
                    personSelections,
                    (personSelection, base) => bases.check(personSelection.resolve, base === 1, index),
                    { concurrency: 1 },
                  );
                  expect(baseReads.map((read) => read.actual)).toEqual(baseReads.map((read) => read.expected));
                  checkRead(yield* stillGood.read("entry.txt"), true, pinned, "commit 0", root);
                  expect(selected.snapshot.commit).toBe(pinned);
                  yield* traversal.check(selected.resolve, cell.traversal);
                }
              }).pipe(Effect.provide(RepositoriesGit.layer({ person })));
            }),
          ).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, Digest.layerWebCrypto))),
        ),
    ),
    { seed: 119120, numRuns: 200 },
  );
});
