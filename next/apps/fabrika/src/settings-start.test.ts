// T664, P38 slice 1, next/: L12, L13 and L14 [secrets] of the approved plan, across startup and
// replay. Written before the build.
//
// The shape these tests hold the app and libfabrika to:
// - libfabrika exports `@kampus/libfabrika/node/settings/Load`, `@kampus/libfabrika/settings/Snapshot`
//   and `@kampus/libfabrika/settings/TomlParser` (see `node/settings/Load.test.ts` for `Load.load`).
// - A process start keeps the `Snapshot` it loaded, and saves it encoded by `Snapshot.Snapshot`; a
//   replay reads that saved value back, never the files as they are now.
// - dev.ts takes the port as `--instance.port` (settings.md S5's words), keeps the founding flags
//   it has, listens on that port, and stops naming `instance.port` when the port is taken.
import { generateKeyPairSync } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Load from "@kampus/libfabrika/node/settings/Load";
import * as Snapshot from "@kampus/libfabrika/settings/Snapshot";
import * as StartsTest from "@kampus/libfabrika/settings/StartsTest";
import * as TomlParser from "@kampus/libfabrika/settings/TomlParser";
import { Chain } from "@kampus/libfabrika/telemetry/Trace";
import { Effect, Exit, FileSystem, Layer, Path, Ref, Schema, Stream } from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ChildProcess } from "effect/process";
import * as fc from "fast-check";
import { rolldown } from "rolldown";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";
import { killWorkerd } from "./workerd.test-support.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };
const DEFAULT = 18787;
const PERSON = "~/.fabrika/fabrika.toml";
const REPO = ".fabrika/fabrika.toml";

const services = Layer.mergeAll(NodeServices.layer, TomlParser.layer, Digest.layerWebCrypto);

/** A scoped temp home with the two file places, and a way to write the person's file. */
const home = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t664-start-" });
  const person = path.join(root, "fabrika.toml");
  const repo = path.join(root, "repo-fabrika.toml");
  const write = (port: number | undefined) =>
    port === undefined
      ? fs.remove(person, { force: true })
      : fs.writeFileString(person, `# the person's\n[instance]\nport = ${port}\n`);
  return { places: { person: { path: person, name: PERSON }, repo: { path: repo, name: REPO } }, write };
});

const action = fc.oneof(
  fc.record({
    _tag: fc.constant("change" as const),
    port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
  }),
  fc.record({ _tag: fc.constant("start" as const) }),
  fc.record({ _tag: fc.constant("replay" as const), which: fc.nat() }),
  fc.record({
    _tag: fc.constant("new-process" as const),
    env: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
  }),
);

describe("L13, each process start keeps the exact settings and hash it began with", () => {
  it("a replay after file changes reads the saved snapshot, and a new process reads the files now", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 12 }), async (actions) => {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const h = yield* home;
              let file: number | undefined;
              const processes: Array<{
                readonly port: number;
                readonly held: Snapshot.Snapshot;
                readonly saved: string;
              }> = [];
              const begin = (env: number | undefined) =>
                Effect.gen(function* () {
                  const loaded = yield* Load.load({
                    ...h.places,
                    flags: {},
                    env: env === undefined ? {} : { FABRIKA_INSTANCE_PORT: String(env) },
                    version: "0.0.0",
                  });
                  const port = env ?? file ?? DEFAULT;
                  expect(loaded.values.port).toBe(port);
                  expect(loaded.snapshot.values["instance.port"]).toBe(port);
                  processes.push({
                    port,
                    held: loaded.snapshot,
                    saved: JSON.stringify(Schema.encodeSync(Snapshot.Snapshot)(loaded.snapshot)),
                  });
                });

              for (const a of actions) {
                if (a._tag === "change") {
                  file = a.port;
                  yield* h.write(a.port);
                } else if (a._tag === "start") {
                  yield* begin(undefined);
                } else if (a._tag === "new-process") {
                  yield* begin(a.env);
                } else if (processes.length > 0) {
                  const p = processes[a.which % processes.length]!;
                  const replayed = Schema.decodeUnknownSync(Snapshot.Snapshot)(JSON.parse(p.saved));
                  expect(replayed.values["instance.port"]).toBe(p.port);
                  // The process's own value never moves, though files changed since it began.
                  expect(p.held.values["instance.port"]).toBe(p.port);
                  expect(p.held.hash).toBe(replayed.hash);
                }
              }

              // One hash per value, whatever source and process gave it.
              for (const a of processes) {
                for (const b of processes) {
                  expect(a.held.hash === b.held.hash).toBe(a.port === b.port);
                }
              }
            }),
          ).pipe(Effect.provide(services)),
        );
      }),
      check,
    );
  });
});

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

const secret = fc
  .tuple(fc.stringMatching(/^[A-Za-z0-9]{6,12}$/), fc.constantFrom('"', "/", " ", "+", "&"))
  .map(([word, mark]) => `sk-${word}${mark}${word.slice(0, 3)}`);

/** Where the files hold the secret: nowhere, at an unknown key, or nested under a declared key. */
const placed = (port: number, word: string) => {
  const s = JSON.stringify(word);
  return fc.constantFrom(
    { person: `[instance]\nport = ${port}\n`, repo: "", refused: false },
    { person: `[instance]\nport = ${port}\nfounder = ${s}\n`, repo: "", refused: true },
    { person: `[instance.port]\nfounder = ${s}\n`, repo: "", refused: true },
    { person: `[instance]\nport = { founder = ${s} }\n`, repo: "", refused: true },
    { person: `[instance]\nport = [${s}]\n`, repo: "", refused: true },
    { person: `[instance]\nport = ${port}\n`, repo: `[fabrika-version]\nfounder = ${s}\n`, refused: true },
    { person: `[instance]\nport = ${port}\n`, repo: `fabrika-version = [${s}]\n`, refused: true },
  );
};

describe("L14 [secrets], a start saves and says only declared settings", () => {
  it("secrets in unrelated env fields, founding input, unknown file fields and under declared keys stay out of the saved start", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(secret, fc.integer({ min: 1, max: 65535 }))
          .chain(([word, port]) => fc.tuple(fc.constant(word), fc.constant(port), placed(port, word))),
        fc.constantFrom("FABRIKA_FOUNDER", "FABRIKA_WINDOW", "FABRIKA_PERSON", "FABRIKA_TOKEN", "GITHUB_TOKEN"),
        async ([word, _port, place], field) => {
          const exit = await Effect.runPromiseExit(
            Effect.scoped(
              Effect.gen(function* () {
                const h = yield* home;
                const fs = yield* FileSystem.FileSystem;
                yield* fs.writeFileString(h.places.person.path, place.person);
                yield* fs.writeFileString(h.places.repo.path, place.repo);
                // The founding facts reach dev.ts as flags; none is a setting, so none is a source.
                const loaded = yield* Load.load({
                  ...h.places,
                  flags: { founder: word, window: word, person: word },
                  env: { [field]: word },
                  version: "0.0.0",
                });
                return JSON.stringify(Schema.encodeSync(Snapshot.Snapshot)(loaded.snapshot));
              }),
            ).pipe(Effect.provide(services)),
          );
          expect(Exit.isSuccess(exit)).toBe(!place.refused);
          const outputs = Exit.isSuccess(exit) ? [exit.value] : [String(exit.cause)];

          for (const output of outputs) {
            for (const form of forms(word)) {
              expect(output).not.toContain(form);
            }
          }
        },
      ),
      check,
    );
  });
});

// Real processes, as instance-wire.test.ts starts them: workerd, sockets and a fresh FABRIKA_HOME.
// Each one, its home and its held port are acquired in the test's scope, which gives them back
// (decision 0061).

const founding = () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const raw = der.subarray(-32);
  const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from("ssh-ed25519"), Buffer.from([0, 0, 0, 32]), raw]);
  return { line: `ssh-ed25519 ${blob.toString("base64")}`, raw: raw.toString("base64url") };
};

/** A port nobody else is given while the scope is open. */
const held = Effect.acquireRelease(heldPort(), (h) => h.release);

it.live("scenario: T753 L13 real Worker retries the same HTTP owner, shares warm gates and reopens", () =>
  // scenario: Alchemy, workerd's object bridge and isolate lifetime require one real local instance.
  // Run only in the lead's isolated container. No socket or Docker allowance is requested by this law.
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t753-worker-" });
    const port = yield* held;
    const key = founding();
    const built = yield* build({ out: path.join(home, "dist") });
    const input = {
      ...(yield* StartsTest.input({
        port: port.port,
        start: "instance-start-scenario",
        build: built.build,
        revision: null,
        origin: "flag",
      })),
      founding: { person: "person_01m6v5270hf3c8x2q7w9z4k5mn", founder: key.line, window: key.raw },
    };
    const original = path.join(home, "original.mjs");
    yield* fs.copyFile(built.brain, original);
    const entry = path.join(home, "entry.mjs");
    // The test changes platform answers and SQL failure cuts. All settings and consumer code is the real bundle.
    yield* fs.writeFileString(
      entry,
      `
      import worker, { Project as OriginalProject, Process, Connection, RecordPart, Control } from "./original.mjs";
      export { Process, Connection, RecordPart, Control };
      export class Project extends OriginalProject {
        constructor(ctx, env) {
          let fail = false;
          const counts = { reads: 0, appends: 0 };
          const sql = new Proxy(ctx.storage.sql, { get(target, key) {
            if (key !== "exec") return Reflect.get(target, key);
            return (query, ...args) => {
              if (/SELECT \\* FROM entries WHERE stream = \\? AND rev > \\?/i.test(query)) counts.reads++;
              if (/INSERT INTO entries/i.test(query)) {
                counts.appends++;
                if (fail) throw new Error("injected settings storage failure");
              }
              if (fail && /SELECT \\* FROM entries WHERE stream/i.test(query)) throw new Error("injected settings storage failure");
              return target.exec(query, ...args);
            };
          } });
          const storage = new Proxy(ctx.storage, { get(target, key) {
            if (key === "sql") return sql;
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          } });
          const state = new Proxy(ctx, { get(target, key) {
            if (key === "storage") return storage;
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          } });
          super(state, env);
          this.testStorage = ctx.storage;
          this.testCounts = counts;
          this.testFault = value => { fail = value; };
        }
        async settingsStart(input) {
          if (!await this.testStorage.get("test-settings-armed")) return super.settingsStart(input);
          const phase = await this.testStorage.get("test-settings-phase") ?? 0;
          await this.testStorage.put("test-settings-phase", phase + 1);
          if (phase === 0) return { _tag: "Refused" };
          this.testFault(phase === 1);
          try { return await super.settingsStart(input); }
          finally { this.testFault(false); }
        }
        async settingsProbe() {
          const exists = this.testStorage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='entries'").toArray().length > 0;
          const rows = exists ? this.testStorage.sql.exec("SELECT * FROM entries").toArray().filter(row => {
            const body = JSON.parse(row.body);
            return body.settings?.hash === ${JSON.stringify(input.settings.hash)} && body.build === ${JSON.stringify(built.build)};
          }) : [];
          return { calls: await this.testStorage.get("test-settings-phase") ?? 0, ...this.testCounts, rows };
        }
        async settingsArm() { await this.testStorage.put("test-settings-armed", true); return true; }
      }
      export default { fetch(request, env, ctx) {
        if (new URL(request.url).pathname === "/__settings_arm") return env.PROJECT.getByName("settings-law").settingsArm().then(value => Response.json(value));
        if (new URL(request.url).pathname === "/__settings_probe") return env.PROJECT.getByName("settings-law").settingsProbe().then(value => Response.json(value));
        return worker.fetch(request, env, ctx);
      } };
    `,
    );
    const bundle = yield* Effect.acquireRelease(
      Effect.promise(() => rolldown({ input: entry, external: [/^cloudflare:/], platform: "neutral" })),

      (owned) => Effect.promise(() => owned.close()),
    );
    const brain = path.join(home, "instrumented.mjs");

    yield* Effect.promise(() => bundle.write({ file: brain, format: "esm" }));
    const instance = yield* localInstance({ ...built, brain }, { ...input, home });
    yield* HttpClient.get(`${instance.url}/__settings_arm`);
    const probe = Effect.gen(function* () {
      const response = yield* HttpClient.get(`${instance.url}/__settings_probe`);
      return yield* response.json.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Struct({
              calls: Schema.Int,
              reads: Schema.Int,
              appends: Schema.Int,
              rows: Schema.Array(
                Schema.Struct({
                  id: Schema.String,
                  body: Schema.String,
                  sentAt: Schema.String,
                  traceId: Schema.String,
                }),
              ),
            }),
          ),
        ),
      );
    });
    const request = HttpClient.get(`${instance.url}/`);
    expect((yield* request).status).toBeGreaterThanOrEqual(500);
    expect((yield* probe).calls).toBe(1);
    expect((yield* request).status).toBeGreaterThanOrEqual(500);
    expect((yield* probe).calls).toBe(2);
    expect((yield* request).status).toBe(200);
    const cold = yield* probe;
    expect(cold.calls).toBe(3);
    expect(cold.rows).toHaveLength(1);
    const saved = cold.rows[0];
    expect(saved).toBeDefined();

    for (let n = 0; n < 4; n++) {
      expect((yield* request).status).toBe(200);
    }

    expect(yield* probe).toEqual(cold);
    // Every RecordPart method shares one successful activation context.
    const part = instance.record("settings-law", "spans/57");
    const record = Effect.fnUntraced(function* (method: "write" | "read" | "content" | "deleteContent") {
      const chain = Chain.cases.spans.make({});

      return yield* Effect.promise(() =>
        method === "write"
          ? part.write(chain, 57, [])
          : method === "read"
            ? part.read(chain, 57, 0)
            : method === "content"
              ? part.content(chain, 57, "absent")
              : part.deleteContent(chain, 57, "absent", { by: "test-person", at: 0, reason: "requested" }),
      );
    });

    for (const method of ["write", "read", "content", "deleteContent"] as const) {
      yield* record(method);
    }

    const recordCold = yield* probe;
    expect(recordCold.calls - cold.calls).toBe(1);
    expect(recordCold.reads - cold.reads).toBe(1);
    expect(recordCold.appends - cold.appends).toBe(0);

    for (const method of ["write", "read", "content", "deleteContent"] as const) {
      yield* record(method);
    }

    expect(yield* probe).toEqual(recordCold);
    yield* killWorkerd(process.pid);
    yield* request.pipe(Effect.retry({ times: 100 }));
    expect((yield* request).status).toBe(200);
    const reopened = yield* probe;
    expect(reopened.rows).toEqual(cold.rows);
    expect(reopened.calls).toBeGreaterThan(recordCold.calls);
  }).pipe(
    Effect.provide([NodeServices.layer, Digest.layerWebCrypto, SecureRandom.layerWebCrypto, FetchHttpClient.layer]),
  ),
);

/** One dev.ts in its own scoped home, its output collected as it comes. Scope close kills it. */
const dev = Effect.fnUntraced(function* (port: number, extra: Readonly<Record<string, string>>) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "t664-dev-" });
  const app = path.resolve(import.meta.dirname, "..");
  const key = founding();
  const child = yield* ChildProcess.make(
    process.execPath,
    [
      path.join(app, "dev.ts"),
      "--instance.port",
      String(port),
      "--name",
      "t664-start",
      "--person",
      "person_01m6v5270hf3c8x2q7w9z4k5mn",
      "--founder",
      key.line,
      "--window",
      key.raw,
    ],
    {
      cwd: app,
      extendEnv: true,
      env: {
        FABRIKA_HOME: folder,
        DO_NOT_TRACK: "1",
        TYPESAFE_API_KEY: undefined,
        FABRIKA_FOREGROUND: undefined,
        CLOUDFLARE_API_TOKEN: undefined,
        FABRIKA_INSTANCE_PORT: undefined,
        ...extra,
      },
      forceKillAfter: "3 seconds",
    },
  );
  const output = yield* Ref.make("");
  yield* child.all.pipe(
    Stream.decodeText(),
    Stream.runForEach((text) => Ref.update(output, (o) => o + text)),
    Effect.forkScoped,
  );
  return { child, output: Ref.get(output) };
});

describe("L12, startup uses the selected port, and a taken port stops naming instance.port", () => {
  it.live("scenario: one instance on an explicit port, then a second on the same port", () =>
    // scenario: Alchemy's strict port and the kernel's port table are what is under test, so the
    // processes and ports are real ones (plan L12). A secret in an unrelated env field rides along
    // for L14: no printed line may hold it.
    Effect.gen(function* () {
      const { port } = yield* held;
      const word = "sk-T664unrelated/+&secret";
      const first = yield* dev(port, { UNRELATED_TOKEN: word });
      const ready = `{"ready":${JSON.stringify(`http://127.0.0.1:${port}`)},"build":`;

      for (let n = 0; !(yield* first.output).includes(ready); n++) {
        expect(yield* first.child.isRunning, `dev.ts stopped: ${yield* first.output}`).toBe(true);
        expect(n, `no ready line on port ${port}: ${yield* first.output}`).toBeLessThan(1200);
        yield* Effect.sleep("100 millis");
      }

      const answer = yield* HttpClient.get(`http://127.0.0.1:${port}`);
      expect(answer.status).toBe(200);

      const second = yield* dev(port, { UNRELATED_TOKEN: word });
      expect(yield* second.child.exitCode).not.toBe(0);
      // The output stream may still be draining after the exit.
      yield* Effect.sleep("200 millis");
      const said = yield* second.output;
      expect(said).toContain("instance.port");
      // It never takes another port in its place.
      expect(said).not.toContain('{"ready":');

      for (const output of [yield* first.output, said]) {
        for (const form of forms(word)) {
          expect(output).not.toContain(form);
        }
      }
    }).pipe(Effect.provide([NodeServices.layer, FetchHttpClient.layer])),
  );
});
