// T878, next/, L3/L8/L9. prepare pins/checks before dev builds; open records through RepositoryTrust.
// Public contract for the builder: prepare(path, settings options), then open(prepared, operator options).
import { DatabaseSync } from "node:sqlite"; // edge: synchronous transactions are the ledger's driver contract
import { inspect } from "node:util"; // edge: JSON omits Error's non-enumerable diagnostic fields
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Path,
  Redacted,
  Schema,
  Sink,
  Stream,
  Tracer,
} from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import { vi } from "vitest";
import * as Id from "../../Id.ts";
import { Doorbell, Ledger, LedgerError } from "../../ledger/Ledger.ts";
import * as LedgerSql from "../../ledger/LedgerSql.ts";
import type { Line } from "../../ledger/Log.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import * as RepositoryTrustLedger from "../../packs/RepositoryTrustLedger.ts";
import {
  Repositories,
  RepositoriesError,
  ReadFailed,
  Snapshot as RepoSnapshot,
} from "../../repositories/Repositories.ts";
import * as Declarations from "../../settings/Declarations.ts";
import * as SettingsSnapshot from "../../settings/Snapshot.ts";
import { Toml } from "../../settings/Toml.ts";
import * as RepositoryOpenTest from "../settings/RepositoryOpenTest.ts";
import * as OpenRepository from "./OpenRepository.ts";
import * as RepositoriesGit from "./RepositoriesGit.ts";

const services = Layer.mergeAll(NodeServices.layer, RepositoryOpenTest.toml, Digest.layerWebCrypto);

const generated = <S extends Schema.Top>(schema: S): fc.Arbitrary<S["Type"]> =>
  fc.nat().map((seed) => Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }))[0]!);

const ids = generated(Id.InputId);
const people = generated(Id.make("person"));
const document = ".fabrika/fabrika.toml";
const personName = "~/.fabrika/fabrika.toml";
const cell = fc.record({ move: fc.nat(), pick: fc.nat() });
const tape = fc.array(cell, { minLength: 1, maxLength: 8 });

const repoSnapshot = (text: string | null) =>
  Schema.decodeUnknownSync(RepoSnapshot)({
    key: "a".repeat(64),
    branch: "release",
    commit: "b".repeat(40),
    file: document,
    text,
    hash: "c".repeat(64),
  });

const reader = (text: string | null, touches: Array<string>) =>
  Layer.succeed(Repositories, {
    open: () =>
      Effect.succeed({
        snapshot: repoSnapshot(text),
        read: (path: string) => {
          touches.push(path);
          return Effect.succeed(null);
        },
        resolve: () => {
          touches.push("outside source");
          return Effect.fail(
            new RepositoriesError({ reason: new ReadFailed({ cause: Redacted.make("must not resolve code") }) }),
          );
        },
      }),
  });

describe("T878 composed repository opening", () => {
  it("L3: every load uses supplied text once, checks scope/version first, and retains exact origins and checked hash", async () => {
    await fc.assert(
      fc.asyncProperty(tape, fc.integer({ min: 1, max: 65535 }), async (cells, port) => {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const parser = yield* Toml;
              let personReads = 0;
              let invalidPerson = false;
              const parsed: Array<string> = [],
                touches: Array<string> = [];
              const fs = FileSystem.layerNoop({
                readFileString: () => {
                  personReads++;
                  return Effect.succeed(
                    `# person\n\n[instance]\nport = ${invalidPerson ? '"invalid"' : personReads === 1 ? port : (port % 65535) + 1}\n`,
                  );
                },
              });
              const counted = Layer.succeed(Toml, {
                parse: (text: string) => {
                  parsed.push(text);
                  return parser.parse(text);
                },
              });
              const options = {
                person: { path: "person-file", name: personName },
                flags: {},
                env: {},
                version: "0.0.0",
              };
              const docs = [
                null,
                "",
                '# repo\n\nfabrika-version = "0.0.0"\n',
                'fabrika-version = "999.0.0"\n',
                "[instance]\nport = 1234\n",
                '[pack.x]\nfrom = "../../outside"\n',
                "[instance\n",
                '[review]\ngoverned = ["src/"]\n',
                'fabrika-version = "bad"\n',
              ];
              const reasons = [null, null, null, "version", "scope", "unknown", "syntax", "unknown", "invalid"];
              const lines = [null, null, 3, 1, 2, 2, 2, 2, 1];
              const keys = [null, null, null, "fabrika-version", "instance.port", null, null, null, "fabrika-version"];

              for (const c of cells) {
                personReads = 0;
                parsed.length = 0;
                const index = c.pick % docs.length;
                invalidPerson = c.move % 2 !== 0 && reasons[index] === null;
                const padding = c.move % 6;
                const body = docs[index] === null ? null : "\n".repeat(padding) + docs[index]!;
                const result = yield* OpenRepository.prepare("selected-repo", options).pipe(
                  Effect.provide([reader(body, touches), fs, counted]),
                  Effect.exit,
                );
                expect(Exit.isSuccess(result)).toBe(reasons[index] === null && !invalidPerson);
                expect(personReads).toBe(index === 3 || index === 6 || index === 8 ? 0 : 1);
                expect(parsed.filter((value) => value === body)).toHaveLength(body === null ? 0 : 1);

                if (Exit.isSuccess(result)) {
                  const saved = result.value.settings;
                  const checked = yield* SettingsSnapshot.read(Declarations.all, saved);
                  expect(checked.values.port).toBe(port);
                  expect(saved.origins["instance.port"]).toEqual({ _tag: "file", file: personName, line: 4 });

                  if (index === 2) {
                    expect(saved.origins["fabrika-version"]).toEqual({
                      _tag: "file",
                      file: document,
                      line: 3 + padding,
                    });
                  }

                  expect(saved.hash).toBe(checked.snapshot.hash);
                  expect(result.value.snapshot.commit).toBe(repoSnapshot(body).commit);
                } else {
                  expect(result.cause.reasons.some((r) => r._tag === "Fail")).toBe(true);
                  const failure = result.cause.reasons.find((r) => r._tag === "Fail");

                  if (failure?._tag === "Fail") {
                    expect(failure.error.reason._tag).toBe("InvalidDocument");
                    // The diagnostic must preserve the source position and known setting key.
                    expect(failure.error.message).toContain(
                      `${invalidPerson ? personName : document}, line ${invalidPerson ? 4 : lines[index]! + padding}`,
                    );

                    const key = invalidPerson ? "instance.port" : keys[index];

                    if (key !== null) {
                      expect(failure.error.message).toContain(key!);
                    }
                  }
                }

                expect(touches).toEqual([]);
              }
            }),
          ).pipe(Effect.provide(services)),
        );
      }),
      { seed: 119120, numRuns: 200 },
    );
  });

  it("L3: a malformed snapshot made upstream is refused rather than defaulted or returned unchecked", async () => {
    // A fault at the saved-data boundary makes bypassing Snapshot.read observable.
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { minLength: 1, maxLength: 4 }), async (cells) => {
        const original = SettingsSnapshot.make;
        const spy = vi.spyOn(SettingsSnapshot, "make");
        await Effect.runPromise(
          Effect.acquireRelease(Effect.void, () => Effect.sync(() => spy.mockRestore())).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                for (const c of cells) {
                  spy.mockImplementation((group, resolved) =>
                    original(group, resolved).pipe(
                      Effect.map((saved) => (c % 2 === 0 ? { ...saved, hash: "wrong" } : { ...saved, values: {} })),
                    ),
                  );
                  const result = yield* OpenRepository.prepare("selected-repo", {
                    person: { path: "person-file", name: personName },
                    flags: {},
                    env: {},
                    version: "0.0.0",
                  }).pipe(
                    Effect.provide([
                      reader("", []),
                      FileSystem.layerNoop({ readFileString: () => Effect.succeed("") }),
                    ]),
                    Effect.exit,
                  );
                  expect(Exit.isFailure(result)).toBe(true);
                }
              }),
            ),
            Effect.scoped,
            Effect.provide(services),
          ),
        );
      }),
      { seed: 119120, numRuns: 200 },
    );
  });
});

const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  return (yield* (yield* ChildProcessSpawner.ChildProcessSpawner).string(
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

it("L8: refusal, consent and retries never evaluate, bundle or start repository code or Git-configured commands", async () => {
  await fc.assert(
    fc.asyncProperty(tape, ids, ids, people, async (cells, selection, request, actor) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem,
              path = yield* Path.Path;
            const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-code-" });
            yield* RepositoryOpenTest.isolateGit(root);
            const origin = path.join(root, "origin.git"),
              repo = path.join(root, "repo"),
              person = path.join(root, "person");
            const marker = path.join(root, "executed");
            yield* fs.makeDirectory(person);
            yield* git(root, ["init", "--bare", "--initial-branch=stable", origin]);
            yield* git(root, ["clone", origin, repo]);
            yield* fs.makeDirectory(path.join(repo, ".fabrika/packs/trap"), { recursive: true });
            yield* fs.writeFileString(path.join(repo, document), 'fabrika-version = "0.0.0"\n');
            const tripwire = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); throw new Error('outside code ran');`;

            for (const file of ["settings.mjs", ".fabrika/packs/trap/index.mjs", ".fabrika/packs/trap/program.mjs"]) {
              yield* fs.writeFileString(path.join(repo, file), tripwire);
            }

            yield* fs.writeFileString(
              path.join(repo, "package.json"),
              JSON.stringify({ type: "module", scripts: { build: "node settings.mjs", start: "node settings.mjs" } }),
            );
            yield* git(repo, ["add", "."]);
            yield* git(repo, ["commit", "-m", "fixture"]);
            yield* git(repo, ["push", "origin", "stable"]);
            const trap = path.join(root, "git-trap");
            yield* fs.writeFileString(trap, `#!${process.execPath}\n${tripwire}\n`);
            yield* fs.chmod(trap, 0o700);
            const hooks = path.join(root, "hooks");
            yield* fs.makeDirectory(hooks);
            yield* fs.writeFileString(
              path.join(hooks, "reference-transaction"),
              `#!${process.execPath}\n${tripwire}\n`,
            );
            yield* fs.chmod(path.join(hooks, "reference-transaction"), 0o700);
            yield* git(repo, ["config", "core.hooksPath", hooks]);
            yield* git(repo, ["config", "core.fsmonitor", trap]);
            yield* git(repo, ["config", "core.sshCommand", trap]);
            yield* git(repo, ["config", "remote.origin.uploadpack", trap]);
            yield* git(repo, ["config", "maintenance.auto", "true"]);
            const db = yield* Effect.acquireRelease(
              Effect.sync(() => new DatabaseSync(":memory:")),
              (value) => Effect.sync(() => value.close()),
            );
            const trust = RepositoryTrustLedger.layer.pipe(
              Layer.provide(LedgerSql.layer(nodeSql(db), { reader: "brain" })),
              Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
            );

            for (const c of cells) {
              const prepared = yield* OpenRepository.prepare(repo, {
                person: { path: path.join(person, "fabrika.toml"), name: personName },
                flags: {},
                env: {},
                version: "0.0.0",
              }).pipe(Effect.provide(RepositoriesGit.layer({ person })));
              const result = yield* OpenRepository.open(prepared, {
                selection,
                request,
                actor,
                by: "brain",
                build: "fixture",
                interactive: c.move % 3 !== 0,
                confirm: () => Effect.succeed(c.move % 2 === 0),
              }).pipe(Effect.provide(trust), Effect.exit);
              expect(Exit.isSuccess(result)).toBe(true);
              expect(yield* fs.exists(marker)).toBe(false);
            }
          }),
        ).pipe(Effect.provide(services)),
      );
    }),
    { seed: 119120, numRuns: 200 },
  );
});

const forms = (word: string) => [
  word,
  encodeURIComponent(word),
  JSON.stringify(word).slice(1, -1),
  Buffer.from(word).toString("base64"),
  Buffer.from(word).toString("base64url"),
];

it.effect.prop(
  "L8: injected opening traces leave import, build and start tripwires untouched",
  {
    cells: Arbitrary.array(Arbitrary.schema(Schema.Struct({ move: Schema.Natural, pick: Schema.Natural })), {
      minLength: 1,
      maxLength: 8,
    }),
    selection: Id.InputId,
    request: Id.InputId,
    actor: Id.Person,
  },
  ({ cells, selection, request, actor }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-open-code-" });
        const marker = path.join(root, "executed");
        const touches: Array<string> = [];
        const tripwire = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`;

        for (const name of ["settings.mjs", "program.mjs", "build.mjs", "start.mjs"]) {
          yield* fs.writeFileString(path.join(root, name), tripwire);
        }

        yield* fs.writeFileString(
          path.join(root, "package.json"),
          JSON.stringify({
            type: "module",
            scripts: { build: "node build.mjs", start: "node start.mjs" },
          }),
        );
        const db = yield* Effect.acquireRelease(
          Effect.sync(() => new DatabaseSync(":memory:")),
          (value) => Effect.sync(() => value.close()),
        );
        const trust = RepositoryTrustLedger.layer.pipe(
          Layer.provide(LedgerSql.layer(nodeSql(db), { reader: "brain" })),
          Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
        );

        for (const cell of cells) {
          const prepared = yield* OpenRepository.prepare(root, {
            person: { path: path.join(root, "person.toml"), name: personName },
            flags: {},
            env: {},
            version: "0.0.0",
          }).pipe(Effect.provide(reader('fabrika-version = "0.0.0"\n', touches)));
          const result = yield* OpenRepository.open(prepared, {
            selection,
            request,
            actor,
            by: "brain",
            build: "fixture",
            interactive: cell.move % 3 !== 0,
            confirm: () => Effect.succeed(cell.move % 2 === 0),
          }).pipe(Effect.provide(trust), Effect.exit);
          expect(Exit.isSuccess(result)).toBe(true);
          expect(touches).toEqual([]);
          expect(yield* fs.exists(marker)).toBe(false);
        }
      }),
    ).pipe(Effect.provide(services)),
  { arbitrary: { seed: 119120, runs: 200 } },
);

it("L9 [secrets]: generated opening flows redact every report, pending state, error, span, ledger envelope and snapshot", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{11,23}$/),
      tape,
      fc.uniqueArray(ids, { minLength: 32, maxLength: 32 }),
      people,
      async (word, cells, requests, actor) => {
        const secret = `sentinel-${word}/+ &"`;
        const folder = `/private/fixture-${word}`;
        const url = `https://fixture:${encodeURIComponent(secret)}@example.invalid/repo.git`;
        const outputs: Record<string, Array<unknown>> = {
          report: [],
          pending: [],
          error: [],
          errorJson: [],
          spans: [],
          ledger: [],
          settings: [],
          state: [],
        };
        const spans: Array<Tracer.NativeSpan> = [];
        const tracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        });
        const logger = Logger.layer([
          Logger.make((options) => {
            outputs.report.push(options.message);
          }),
        ]);
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const db = yield* Effect.acquireRelease(
                Effect.sync(() => new DatabaseSync(":memory:")),
                (value) => Effect.sync(() => value.close()),
              );
              const real = yield* Ledger.pipe(
                Effect.provide(LedgerSql.layer(nodeSql(db), { reader: "brain" })),
                Effect.provideService(Doorbell, { ring: () => Effect.void }),
              );
              const captured = {
                ...real,
                append: (stream: string, id: string, line: Line) => {
                  outputs.ledger.push({ stream, id, line });
                  return real.append(stream, id, line);
                },
              };
              const path = yield* Path.Path;
              const digest = yield* Digest.Digest;
              // Require pending, acknowledged consent, document refusal, storage and prompt failures in every flow.
              const flow = [
                ...cells,
                { pick: 1, move: 0 },
                { pick: 1, move: 2 },
                { pick: 0, move: 0 },
                { pick: 2, move: 2 },
                { pick: 7, move: 2 },
                { pick: 8, move: 2 },
              ];

              for (const [index, c] of flow.entries()) {
                const selection = requests[index * 2]!;
                const request = requests[index * 2 + 1]!;
                const source = c.pick % 9;
                const body =
                  source === 0
                    ? `fabrika-version = "0.0.0"\n[unknown]\nvalue = ${JSON.stringify(secret)}\n`
                    : source === 3
                      ? `fabrika-version = ${JSON.stringify(secret)}\n`
                      : source === 4
                        ? `[${JSON.stringify(secret)}]\nvalue = true\n`
                        : source === 5
                          ? `fabrika-version = ${JSON.stringify(secret)} [\n`
                          : 'fabrika-version = "0.0.0"\n';
                const fs = FileSystem.layerNoop({
                  realPath: (location) => Effect.succeed(location),
                  makeTempDirectoryScoped: () => Effect.succeed(`${folder}/temporary`),
                  makeDirectory: () => Effect.void,
                  writeFileString: () => Effect.void,
                  readFileString: () =>
                    Effect.succeed(source === 6 ? `[instance]\nport = ${JSON.stringify(secret)}\n` : ""),
                });
                const spawner = ChildProcessSpawner.make((command) => {
                  if (command._tag !== "StandardCommand") {
                    return Effect.die("unexpected pipeline");
                  }

                  const args = command.args;
                  const commit = "b".repeat(40);
                  const blob = "d".repeat(40);
                  let output = "";

                  if (args.includes("--show-toplevel")) {
                    output = folder;
                  } else if (args.includes("--git-common-dir")) {
                    output = `${folder}/.git`;
                  } else if (args.includes("--show-object-format")) {
                    output = "sha1";
                  } else if (args.includes("config") || args.includes("--get-url")) {
                    output = `${url}/${index}`;
                  } else if (args.includes("--symref")) {
                    output = `ref: refs/heads/release\tHEAD\n${commit}\tHEAD\n`;
                  } else if (args.includes("--verify")) {
                    output = commit;
                  } else if (args.includes("ls-tree") && args.at(-1) === document) {
                    output = `100644 blob ${blob}\t${document}\0`;
                  } else if (args.includes("cat-file")) {
                    output = body;
                  }

                  const failed = source === 2 && args.includes(["fetch", "ls-tree", "cat-file"][c.move % 3]!);
                  const bytes = new TextEncoder().encode(output);
                  const errors = new TextEncoder().encode(`${url} ${folder} ${secret}`);
                  return Effect.succeed(
                    ChildProcessSpawner.makeHandle({
                      pid: ChildProcessSpawner.ProcessId(1),
                      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(failed ? 1 : 0)),
                      isRunning: Effect.succeed(false),
                      kill: () => Effect.void,
                      stdin: Sink.drain,
                      stdout: Stream.make(bytes),
                      stderr: Stream.make(errors),
                      all: Stream.make(bytes, errors),
                      getInputFd: () => Sink.drain,
                      getOutputFd: () => Stream.empty,
                      unref: Effect.succeed(Effect.void),
                    }),
                  );
                });
                const selected = RepositoriesGit.layer({ person: folder }).pipe(
                  Layer.provide(
                    Layer.mergeAll(
                      fs,
                      Layer.succeed(Path.Path, path),
                      Layer.succeed(Digest.Digest, digest),
                      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
                    ),
                  ),
                );
                const checked = yield* OpenRepository.prepare(folder, {
                  person: { path: `${folder}/person.toml`, name: personName },
                  flags: {},
                  env: { UNRELATED_TOKEN: secret },
                  version: "0.0.0",
                }).pipe(Effect.provide([selected, fs]), Effect.exit);
                expect(Exit.isSuccess(checked)).toBe(source === 1 || source === 7 || source === 8);

                if (Exit.isFailure(checked)) {
                  outputs.error.push(String(checked.cause), checked.cause);
                  outputs.errorJson.push(JSON.stringify(checked.cause));
                } else {
                  outputs.settings.push(checked.value.settings);
                  const opened = yield* OpenRepository.open(checked.value, {
                    selection,
                    request,
                    actor,
                    by: "brain",
                    build: "fixture",
                    interactive: c.move % 3 !== 0,
                    confirm: (snapshot) => {
                      outputs.pending.push(snapshot);
                      return source === 8
                        ? Effect.fail(new Error(`${url} ${folder} ${secret}`))
                        : Effect.succeed(c.move % 2 === 0);
                    },
                  }).pipe(
                    Effect.provide(RepositoryTrustLedger.layer),
                    Effect.provideService(
                      Ledger,
                      source === 7
                        ? {
                            ...captured,
                            append: () => Effect.fail(new LedgerError({ reason: `${url} ${folder} ${secret}` })),
                          }
                        : captured,
                    ),
                    Effect.exit,
                  );

                  expect(Exit.isSuccess(opened)).toBe(source !== 7 && (source !== 8 || c.move % 3 === 0));

                  if (Exit.isSuccess(opened)) {
                    expect(opened.value._tag).toBe(
                      c.move % 3 === 0 ? "awaiting_trust" : c.move % 2 === 0 ? "ready" : "refused",
                    );
                    outputs.state.push(opened.value);

                    if (opened.value._tag === "awaiting_trust") {
                      outputs.pending.push(opened.value);
                    }

                    outputs.report.push(JSON.stringify(opened.value));
                  } else {
                    outputs.error.push(String(opened.cause), opened.cause);
                    outputs.errorJson.push(JSON.stringify(opened.cause));
                  }
                }
              }
            }),
          ).pipe(Effect.provide([services, logger]), Effect.withTracer(tracer)),
        );
        outputs.spans.push(
          ...spans.map((span) => ({
            name: span.name,
            attributes: [...span.attributes],
            events: span.events,
            status: span.status,
          })),
        );

        for (const [name, values] of Object.entries(outputs)) {
          expect(values.length, `${name} must be observed`).toBeGreaterThan(0);
          const output =
            JSON.stringify(values, (_key: string, value: unknown) =>
              typeof value === "bigint" ? value.toString() : value,
            ) + inspect(values, { depth: null });

          for (const spelling of [secret, folder, url].flatMap(forms)) {
            expect(output, name).not.toContain(spelling);
          }
        }
      },
    ),
    { seed: 119120, numRuns: 200 },
  );
});
