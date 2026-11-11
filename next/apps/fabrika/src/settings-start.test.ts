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
import { type ChildProcess, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Load from "@kampus/libfabrika/node/settings/Load";
import * as Snapshot from "@kampus/libfabrika/settings/Snapshot";
import * as TomlParser from "@kampus/libfabrika/settings/TomlParser";
import { Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import { heldPort } from "./port.test-support.ts";

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

describe("L14 [secrets], a start saves and says only declared settings", () => {
  it("secrets in unrelated env fields, founding input and unknown file fields stay out of the saved start", async () => {
    await fc.assert(
      fc.asyncProperty(
        secret,
        fc.constantFrom("FABRIKA_FOUNDER", "FABRIKA_WINDOW", "FABRIKA_PERSON", "FABRIKA_TOKEN", "GITHUB_TOKEN"),
        fc.boolean(),
        fc.integer({ min: 1, max: 65535 }),
        async (word, field, unknownField, port) => {
          const exit = await Effect.runPromiseExit(
            Effect.scoped(
              Effect.gen(function* () {
                const h = yield* home;
                const fs = yield* FileSystem.FileSystem;
                yield* fs.writeFileString(
                  h.places.person.path,
                  unknownField
                    ? `[instance]\nport = ${port}\nfounder = ${JSON.stringify(word)}\n`
                    : `[instance]\nport = ${port}\n`,
                );
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
          expect(Exit.isSuccess(exit)).toBe(!unknownField);
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

// Real processes, as stage-wire.test.ts starts them: workerd, sockets and a fresh FABRIKA_HOME.
const APP = resolve(import.meta.dirname, "..");
const children: Array<ChildProcess> = [];
const homes: Array<string> = [];
const releases: Array<Effect.Effect<void>> = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGTERM");
  }

  for (const folder of homes.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }

  for (const release of releases.splice(0)) {
    await Effect.runPromise(release);
  }
});

const founding = () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const raw = der.subarray(-32);
  const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from("ssh-ed25519"), Buffer.from([0, 0, 0, 32]), raw]);
  return { line: `ssh-ed25519 ${blob.toString("base64")}`, raw: raw.toString("base64url") };
};

const dev = (port: number, extra: NodeJS.ProcessEnv = {}) => {
  const folder = mkdtempSync(join(tmpdir(), "t664-dev-"));
  homes.push(folder);
  const key = founding();
  const env: NodeJS.ProcessEnv = { ...process.env, FABRIKA_HOME: folder, DO_NOT_TRACK: "1", ...extra };
  delete env.TYPESAFE_API_KEY;
  delete env.FABRIKA_FOREGROUND;
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.FABRIKA_INSTANCE_PORT;
  const child = spawn(
    process.execPath,
    [
      join(APP, "dev.ts"),
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
    { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  let output = "";
  child.stdout!.on("data", (b: Buffer) => {
    output += b.toString();
  });
  child.stderr!.on("data", (b: Buffer) => {
    output += b.toString();
  });
  const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  return { child, output: () => output, exited };
};

const pause = () => new Promise((done) => setTimeout(done, 100));

describe("L12, startup uses the selected port, and a taken port stops naming instance.port", () => {
  it("scenario: one instance on an explicit port, then a second on the same port", async () => {
    // scenario: Alchemy's strict port and the kernel's port table are what is under test, so the
    // processes and ports are real ones (plan L12). A secret in an unrelated env field rides along
    // for L14: no printed line may hold it.
    const held = await Effect.runPromise(heldPort());
    releases.push(held.release);
    const word = "sk-T664unrelated/+&secret";
    const first = dev(held.port, { UNRELATED_TOKEN: word });
    const ready = `{"ready":${JSON.stringify(`http://127.0.0.1:${held.port}`)},"build":`;

    for (let n = 0; !first.output().includes(ready); n++) {
      expect(first.child.exitCode, `dev.ts stopped: ${first.output()}`).toBeNull();
      expect(n, `no ready line on port ${held.port}: ${first.output()}`).toBeLessThan(1200);
      await pause();
    }

    expect((await fetch(`http://127.0.0.1:${held.port}`)).ok).toBe(true);

    const second = dev(held.port, { UNRELATED_TOKEN: word });
    const code = await second.exited;
    expect(code).not.toBe(0);
    expect(second.output()).toContain("instance.port");
    // It never takes another port in its place.
    expect(second.output()).not.toContain('{"ready":');

    for (const output of [first.output(), second.output()]) {
      for (const form of forms(word)) {
        expect(output).not.toContain(form);
      }
    }
  });
});
