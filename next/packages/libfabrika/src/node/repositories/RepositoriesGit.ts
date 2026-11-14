/**
 * `Repositories` on Node, through the `git` command.
 *
 * @stability unstable
 */
import { Effect, Fiber, FileSystem, Layer, Path, Redacted, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  Branch,
  DefaultUnknown,
  Hash,
  ObjectId,
  ReadFailed,
  Repositories,
  RepositoriesError,
  type Repository,
} from "../../repositories/Repositories.ts";
import * as Sources from "./Sources.ts";

const failure = (operation: string, cause: unknown, unknown = false) =>
  new RepositoriesError({
    message: `Selected repository: ${operation} failed.`,
    reason: unknown
      ? new DefaultUnknown({ cause: Redacted.make(cause) })
      : new ReadFailed({ cause: Redacted.make(cause) }),
  });

const safeConfig = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "maintenance.auto=false",
  "-c",
  "gc.auto=0",
  "-c",
  "protocol.ext.allow=never",
];

/**
 * Layer that provides `Repositories` by running `git` as a child process.
 *
 * **Details**
 *
 * `open` asks the selected clone only for local facts: its root, its Git directory, its object
 * format and its origin's address. Every command that reaches the network or reads objects runs
 * in an empty bare Git directory made for the call, which borrows the clone's object store, so the
 * clone's own config never steers a transport. Hooks are off for every command. It fetches the
 * origin's default branch and pins the commit the origin advertised for it, and every later read
 * names that commit. `options.person` is the person's fabrika folder, where a person file's source
 * paths start.
 *
 * **Gotchas**
 *
 * Opening needs the origin to answer: with no `remote.origin.url`, or no way to reach it, it fails
 * as `DefaultUnknown`. A root `fabrika.toml`, or a `.fabrika.jsonc` with no new settings file
 * beside it, fails with a message that says where the file moved.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (options: { readonly person: string }) =>
  Layer.effect(
    Repositories,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const digest = yield* Digest.Digest;
      const hash = (text: string) => digest.digestHex(Digest.sha256, new TextEncoder().encode(text));
      const run = Effect.fn("repositories.git")(function* (cwd: string, args: ReadonlyArray<string>, objects?: string) {
        yield* Effect.annotateCurrentSpan({ operation: args[0] ?? "read" });
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const child = yield* spawner.spawn(
              ChildProcess.make("git", ["--no-replace-objects", "--literal-pathspecs", ...safeConfig, ...args], {
                cwd,
                extendEnv: false,
                env: {
                  PATH: process.env.PATH,
                  HOME: process.env.HOME,
                  GIT_CONFIG_NOSYSTEM: objects === undefined ? "1" : process.env.GIT_CONFIG_NOSYSTEM,
                  GIT_CONFIG_GLOBAL: objects === undefined ? "/dev/null" : process.env.GIT_CONFIG_GLOBAL,
                  GIT_TERMINAL_PROMPT: "0",
                  GIT_ATTR_NOSYSTEM: "1",
                  GIT_ALLOW_PROTOCOL: "file:https:http:ssh:git",
                  GIT_OBJECT_DIRECTORY: objects,
                  SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
                },
              }),
            );
            const errors = yield* child.stderr.pipe(Stream.runCollect, Effect.forkScoped);
            const bytes = yield* child.stdout.pipe(Stream.runCollect);
            const code = yield* child.exitCode;
            const stderr = yield* Fiber.join(errors);
            const size = bytes.reduce((n, part) => n + part.length, 0);
            const output = new Uint8Array(size);
            let offset = 0;

            for (const part of bytes) {
              output.set(part, offset);
              offset += part.length;
            }

            yield* Effect.annotateCurrentSpan({ bytes: size, exitCode: code });

            if (code !== 0) {
              return yield* failure(args[0] ?? "read", { code, stderr });
            }

            return output;
          }),
        ).pipe(
          Effect.mapError((cause) => (cause._tag === "RepositoriesError" ? cause : failure(args[0] ?? "read", cause))),
        );
      });
      const decode = Effect.fnUntraced(function* (bytes: Uint8Array) {
        return yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          catch: (cause: unknown) => failure("decode", cause),
        });
      });
      const text = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
        // Git adds one newline. Other whitespace can belong to a directory or remote path.
        return (yield* decode(yield* run(cwd, args))).replace(/\n$/, "");
      });
      return Repositories.of({
        open: Effect.fn("repositories.open")(
          function* (selected: string): Effect.fn.Return<Repository, RepositoriesError> {
            // Only local metadata commands see the clone. None can invoke a transport or repository code.
            const root = yield* text(selected, ["rev-parse", "--show-toplevel"]).pipe(
              Effect.flatMap((directory) => fs.realPath(directory)),
              Effect.mapError((cause) => failure("location", cause, true)),
            );
            const common = yield* text(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).pipe(
              Effect.flatMap((directory) => fs.realPath(directory)),
              Effect.mapError((cause) => failure("location", cause, true)),
            );
            const format = yield* Schema.decodeUnknownEffect(Schema.Literals(["sha1", "sha256"]))(
              yield* text(root, ["rev-parse", "--show-object-format"]),
            ).pipe(Effect.mapError((cause) => failure("object format", cause)));
            const destination = yield* text(root, [
              "config",
              "--local",
              "--no-includes",
              "--get",
              "remote.origin.url",
            ]).pipe(Effect.mapError((cause) => failure("origin", cause, true)));

            if (destination === "" || destination.startsWith("-") || destination.includes("\n")) {
              return yield* failure("origin", "invalid destination", true);
            }

            const remote =
              path.isAbsolute(destination) ||
              /^[a-z][a-z0-9+.-]*:\/\//i.test(destination) ||
              /^[^/]+:/.test(destination)
                ? destination
                : // Resolving here would collapse symlink/.. before Git follows the actual path.
                  `${root}${path.sep}${destination}`;
            const isolated = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
              return yield* Effect.scoped(
                Effect.gen(function* () {
                  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "fabrika-git-" });
                  yield* fs.makeDirectory(path.join(directory, "objects"));
                  yield* fs.makeDirectory(path.join(directory, "refs"));
                  yield* fs.writeFileString(path.join(directory, "HEAD"), "ref: refs/heads/unused\n");
                  yield* fs.writeFileString(
                    path.join(directory, "config"),
                    format === "sha256"
                      ? "[core]\nrepositoryformatversion = 1\nbare = true\n[extensions]\nobjectformat = sha256\n"
                      : "[core]\nrepositoryformatversion = 0\nbare = true\n",
                  );
                  return yield* run(directory, args, path.join(common, "objects"));
                }),
              ).pipe(
                Effect.mapError((cause) => (cause._tag === "RepositoriesError" ? cause : failure("Git read", cause))),
              );
            });
            const effective = yield* isolated(["ls-remote", "--get-url", "--", remote]).pipe(
              Effect.flatMap(decode),
              Effect.map((value) => value.replace(/\n$/, "")),
              Effect.mapError((cause) => failure("origin", cause, true)),
            );
            // Host URL rewrites apply; credentials are authority, never destination identity.
            const identity = effective
              .replace(/^(https?:\/\/)[^/@]*@/i, "$1")
              .replace(/^(ssh:\/\/)[^/@]*@/i, "$1")
              .replace(/^[^/@:]+@(?=[^/:]+:)/, "");
            const key = yield* hash(JSON.stringify([common, identity])).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Hash)),
              Effect.mapError((cause) => failure("fingerprint", cause)),
            );
            const advertised = yield* isolated(["ls-remote", "--symref", "--", remote, "HEAD"]).pipe(
              Effect.flatMap(decode),
              Effect.mapError((cause) => failure("default branch", cause, true)),
            );
            const lines = advertised.trim().split("\n");
            const symbolic = lines.filter((line) => line.startsWith("ref: ") && line.endsWith("\tHEAD"));

            if (symbolic.length !== 1) {
              return yield* failure("default branch", "missing or ambiguous HEAD", true);
            }

            const ref = (symbolic[0] ?? "").slice(5, -5);

            if (!ref.startsWith("refs/heads/")) {
              return yield* failure("default branch", "not a branch", true);
            }

            const branch = yield* Schema.decodeUnknownEffect(Branch)(ref.slice(11)).pipe(
              Effect.mapError((cause) => failure("default branch", cause, true)),
            );
            const heads = lines.filter((line) => !line.startsWith("ref: ") && line.endsWith("\tHEAD"));

            if (heads.length !== 1) {
              return yield* failure("default branch", "missing HEAD object", true);
            }

            const advertisedCommit = yield* Schema.decodeUnknownEffect(ObjectId)((heads[0] ?? "").slice(0, -5)).pipe(
              Effect.mapError((cause) => failure("default branch", cause, true)),
            );
            // Pin the advertised object. A branch move during fetch is a refusal, never a different selection.
            yield* isolated([
              "fetch",
              "--no-tags",
              "--no-recurse-submodules",
              "--no-write-fetch-head",
              "--",
              remote,
              ref,
            ]).pipe(Effect.mapError((cause) => failure("fetch", cause, true)));
            const commit = yield* isolated(["rev-parse", "--verify", `${advertisedCommit}^{commit}`]).pipe(
              Effect.flatMap(decode),
              Effect.map((value) => value.replace(/\n$/, "")),
              Effect.flatMap(Schema.decodeUnknownEffect(ObjectId)),
              Effect.mapError((cause) => failure("commit", cause, true)),
            );
            const entry = Effect.fnUntraced(function* (file: string) {
              const listed = yield* decode(yield* isolated(["ls-tree", "-z", commit, "--", file]));

              if (listed === "") {
                return null;
              }

              const [record] = yield* Schema.decodeUnknownEffect(
                Schema.Tuple([Schema.NonEmptyString, Schema.Literal("")]),
              )(listed.split("\0")).pipe(Effect.mapError((cause) => failure("tree", cause)));
              const tab = record.indexOf("\t"),
                fields = record.slice(0, tab).split(" ");

              if (record.slice(tab + 1) !== file) {
                return yield* failure("tree", "unexpected path");
              }

              const [mode, type, id] = yield* Schema.decodeUnknownEffect(
                Schema.Tuple([
                  Schema.Literals(["040000", "100644", "100755", "120000", "160000"]),
                  Schema.Literals(["blob", "tree", "commit"]),
                  ObjectId,
                ]),
              )(fields).pipe(Effect.mapError((cause) => failure("tree", cause)));
              return { mode, type, id };
            });
            const read = Effect.fnUntraced(function* (file: string) {
              const found = yield* entry(file);

              if (found === null) {
                return null;
              }

              if (found.type !== "blob") {
                return yield* failure("blob", "not a blob");
              }

              return yield* isolated(["cat-file", "blob", found.id]);
            });
            const file = ".fabrika/fabrika.toml";
            const old = yield* entry("fabrika.toml");

            if (old !== null) {
              return yield* new RepositoriesError({
                reason: new ReadFailed({ cause: Redacted.make("legacy root settings file") }),
                message: "fabrika.toml moved to .fabrika/fabrika.toml: move it there",
              });
            }

            const document = yield* entry(file);

            if (document === null && (yield* entry(".fabrika.jsonc")) !== null) {
              return yield* new RepositoriesError({
                reason: new ReadFailed({ cause: Redacted.make("legacy-only settings file") }),
                message: ".fabrika.jsonc moved to [review] in .fabrika/fabrika.toml: move it there",
              });
            }

            if (document !== null && (document.type !== "blob" || document.mode === "120000")) {
              return yield* failure("settings", "not a regular file");
            }

            const bytes = yield* read(file);
            const body = bytes === null ? null : yield* decode(bytes);
            const documentHash = yield* hash(body === null ? "absent" : body).pipe(
              Effect.mapError((cause) => failure("hash", cause)),
            );
            yield* Effect.annotateCurrentSpan({ commit, branch, bytes: bytes?.length ?? 0, present: bytes !== null });
            return {
              snapshot: { key, branch, commit, file, text: body, hash: documentHash },
              read,
              resolve: yield* Sources.resolver({ root, person: options.person, commit, entry, read }).pipe(
                Effect.provideService(FileSystem.FileSystem, fs),
                Effect.provideService(Path.Path, path),
              ),
            };
          },
          Effect.mapError((cause) => (cause._tag === "RepositoriesError" ? cause : failure("open", cause))),
        ),
      });
    }),
  );
