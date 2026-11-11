// T664, P38 slice 1, next/: L11, the file failures and the source integration of the approved plan,
// for `node/settings/Load.ts`, plus L7's overriding flags. Written before the module.
//
// The shape these tests hold the module to:
// - `Load.load({ person, repo, flags, env, version })` reads the two files through `FileSystem`
//   (`person` and `repo` are `{ path, name }`: where to read, and the name a person reads), parses
//   them with `Toml`, checks them with `Files.validate`, resolves `Declarations.all` and returns
//   `{ values, snapshot }`. A missing file is an empty one; any other read failure is a
//   `SettingsError` with reason `read`, and broken TOML one with reason `syntax`.
// - Its requirements are met by `NodeServices.layer`, `TomlParser.layer` and `Digest.layerWebCrypto`.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, Path, Ref } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import { SettingsError } from "../../settings/Files.ts";
import * as TomlParser from "../../settings/TomlParser.ts";
import * as Load from "./Load.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };
const REPO = ".fabrika/fabrika.toml";
const PERSON = "~/.fabrika/fabrika.toml";
const DEFAULT = 18787;

type File =
  | { readonly _tag: "missing" }
  | { readonly _tag: "text"; readonly text: string }
  | { readonly _tag: "folder" };

/** Lay the two files out in a fresh scoped temp folder, and give `Load.load` their places. */
const lay = (repo: File, person: File) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t664-" });
    const place = (name: string, file: File) =>
      Effect.gen(function* () {
        const at = path.join(root, name, "fabrika.toml");
        yield* fs.makeDirectory(path.dirname(at), { recursive: true });

        if (file._tag === "text") {
          yield* fs.writeFileString(at, file.text);
        }

        // A folder where the file should be: present, and unreadable as a file.
        if (file._tag === "folder") {
          yield* fs.makeDirectory(at);
        }

        return at;
      });
    return {
      repo: { path: yield* place("repo", repo), name: REPO },
      person: { path: yield* place("person", person), name: PERSON },
    };
  });

const services = Layer.mergeAll(NodeServices.layer, TomlParser.layer, Digest.layerWebCrypto);

/** One start: load, then the three effects a start runs only on good settings, each counted. */
const start = (
  repo: File,
  person: File,
  input: { flags?: Record<string, string>; env?: Record<string, string>; version?: string },
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const counts = yield* Ref.make({ build: 0, alchemy: 0, write: 0 });
        const places = yield* lay(repo, person);
        const exit = yield* Load.load({
          ...places,
          flags: input.flags ?? {},
          env: input.env ?? {},
          version: input.version ?? "0.0.0",
        }).pipe(
          Effect.tap(() => Ref.update(counts, (c) => ({ ...c, build: c.build + 1 }))),
          Effect.tap(() => Ref.update(counts, (c) => ({ ...c, alchemy: c.alchemy + 1 }))),
          Effect.tap(() => Ref.update(counts, (c) => ({ ...c, write: c.write + 1 }))),
          Effect.exit,
        );
        return { exit, counts: yield* Ref.get(counts) };
      }),
    ).pipe(Effect.provide(services)),
  );

const reason = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return "none";
  }

  const fail = exit.cause.reasons.find((r) => r._tag === "Fail");
  return fail?._tag === "Fail" && fail.error instanceof SettingsError ? fail.error.reason : "not a SettingsError";
};

const text = (t: string): File => ({ _tag: "text", text: t });
const port = fc.integer({ min: 1, max: 65535 });

// Each failure a start must stop on, the file it sits in, and the reason it gives.
const failures = fc.oneof(
  fc.record({
    kind: fc.constant("syntax" as const),
    in: fc.constantFrom("repo", "person"),
    body: fc.constantFrom("[instance\nport = 1\n", 'x = "never closed\n', "port = ]\n"),
  }),
  fc.record({
    kind: fc.constant("version" as const),
    in: fc.constant("repo"),
    body: fc.integer({ min: 1, max: 40 }).map((major) => `fabrika-version = "${major}.0.0"\n[nope]\n`),
  }),
  fc.record({
    kind: fc.constant("scope" as const),
    in: fc.constant("repo"),
    body: port.map((p) => `[instance]\nport = ${p}\n`),
  }),
  fc.record({
    kind: fc.constant("unknown" as const),
    in: fc.constantFrom("repo", "person"),
    body: fc.constantFrom("[nope]\n", "[instance]\nprot = 18800\n", "telemetry = false\n", '[pack.x]\nfrom = "./x"\n'),
  }),
  fc.record({
    kind: fc.constant("invalid" as const),
    in: fc.constant("person"),
    body: fc
      .oneof(fc.integer({ min: 65536, max: 2 ** 30 }), fc.integer({ min: -(2 ** 30), max: 0 }))
      .map((p) => `[instance]\nport = ${p}\n`),
  }),
  fc.record({ kind: fc.constant("read" as const), in: fc.constantFrom("repo", "person"), body: fc.constant("") }),
);

describe("L11, no failed load reaches build, Alchemy startup or the settings-start write", () => {
  it("each failure stops the start with its reason, even when a flag or env sets the same key", async () => {
    await fc.assert(
      fc.asyncProperty(failures, fc.option(port, { nil: undefined }), fc.boolean(), async (failure, over, viaEnv) => {
        const bad: File = failure.kind === "read" ? { _tag: "folder" } : text(failure.body);
        const good = text("");
        // L7: a flag or env value for the port does not excuse the file's own value.
        const override =
          over === undefined
            ? {}
            : viaEnv
              ? { env: { FABRIKA_INSTANCE_PORT: String(over) } }
              : { flags: { "instance.port": String(over) } };
        const { exit, counts } = await start(
          failure.in === "repo" ? bad : good,
          failure.in === "person" ? bad : good,
          override,
        );
        expect(reason(exit), `${failure.in}: ${failure.body}`).toBe(failure.kind);
        expect(counts).toEqual({ build: 0, alchemy: 0, write: 0 });
      }),
      check,
    );
  });

  it("good files start once, missing files are empty ones, and the sources keep their order", async () => {
    const file = fc.oneof(
      fc.constant({ _tag: "missing" as const }),
      fc.constant(text("")),
      port.map((p) => text(`# the person's\n\n[instance]\nport = ${p}\n`)),
    );
    await fc.assert(
      fc.asyncProperty(
        file,
        fc.constantFrom({ _tag: "missing" as const }, text(""), text('fabrika-version = "0.0.0"\n')),
        fc.option(port, { nil: undefined }),
        fc.option(port, { nil: undefined }),
        async (person, repo, flag, env) => {
          const { exit, counts } = await start(repo, person, {
            ...(flag === undefined ? {} : { flags: { "instance.port": String(flag) } }),
            ...(env === undefined ? {} : { env: { FABRIKA_INSTANCE_PORT: String(env) } }),
          });
          expect(counts).toEqual({ build: 1, alchemy: 1, write: 1 });
          expect(Exit.isSuccess(exit)).toBe(true);

          if (Exit.isSuccess(exit)) {
            const fromFile = person._tag === "text" ? /port = (\d+)/.exec(person.text)?.[1] : undefined;
            const want = flag ?? env ?? (fromFile === undefined ? DEFAULT : Number(fromFile));
            expect(exit.value.values.port).toBe(want);
            expect(exit.value.snapshot.values["instance.port"]).toBe(want);
            const origin = exit.value.snapshot.origins["instance.port"];
            const tag =
              flag !== undefined ? "flag" : env !== undefined ? "env" : fromFile !== undefined ? "file" : "default";
            expect(origin?._tag).toBe(tag);

            if (tag === "file") {
              expect(origin).toEqual({ _tag: "file", file: PERSON, line: 4 });
            }
          }
        },
      ),
      check,
    );
  });
});
