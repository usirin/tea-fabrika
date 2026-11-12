// T878, next/, L11. Lead runs this scenario on the host: it needs workerd, sockets and a PTY.
// No substitute for the real dev subprocess or private append transport is used.
import { generateKeyPairSync } from "node:crypto"; // edge: the founder uses SSH's public-key packet format
import { DatabaseSync } from "node:sqlite"; // edge: inspect the real object's durable rows after dev exits
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Row } from "@kampus/libfabrika/ledger/Log";
import type { Entry } from "@kampus/libfabrika/ledger/Log";
import { Effect, FileSystem, Path, Queue, Ref, Result, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { heldPort } from "./port.test-support.ts";

const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  return (yield* (yield* ChildProcessSpawner.ChildProcessSpawner).string(
    ChildProcess.make("git", [...args], {
      cwd,
      extendEnv: false,
      env: {
        PATH: process.env.PATH,
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

const entries = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const rows: Array<Entry> = [];

  for (const file of yield* fs.readDirectory(home, { recursive: true })) {
    if (!file.endsWith(".sqlite")) {
      continue;
    }

    yield* Effect.scoped(
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.sync(() => new DatabaseSync(path.join(home, file), { readOnly: true })),
          (value) => Effect.sync(() => value.close()),
        );

        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entries'").get() !== undefined) {
          for (const row of db.prepare("SELECT * FROM entries ORDER BY rev").all()) {
            rows.push(Schema.decodeUnknownSync(Row)(row));
          }
        }
      }),
    );
  }

  return rows;
});

const jsonLines = (text: string) =>
  text.split(/\r?\n/).flatMap((line) => {
    const result = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(line);
    return Result.isSuccess(result) ? [result.success] : [];
  });

const reports = (text: string, commit: string, result: "ready" | "awaiting_trust") =>
  jsonLines(text).filter((line) => {
    const fields = Schema.decodeUnknownResult(Schema.Record(Schema.String, Schema.Unknown))(line);
    return (
      Result.isSuccess(fields) &&
      Object.values(fields.success).includes(result) &&
      JSON.stringify(line).includes(commit)
    );
  });

const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

it.live("scenario: L11 actual dev selects the default commit, saves trust, and reopens without repo execution", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-dev-" });
      const home = path.join(root, "home"),
        repo = path.join(root, "repo"),
        origin = path.join(root, "origin.git");
      const marker = path.join(root, "outside-executed");
      yield* fs.makeDirectory(home);
      yield* git(root, ["init", "--bare", "--initial-branch=release", origin]);
      yield* git(root, ["clone", origin, repo]);
      yield* fs.makeDirectory(path.join(repo, ".fabrika/packs/trap"), { recursive: true });
      yield* fs.writeFileString(path.join(repo, ".fabrika/fabrika.toml"), 'fabrika-version = "0.0.0"\n');
      const code = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran'); throw new Error('outside program ran');`;
      yield* fs.writeFileString(path.join(repo, ".fabrika/packs/trap/index.mjs"), code);
      yield* git(repo, ["add", "."]);
      yield* git(repo, ["commit", "-m", "fixture"]);
      yield* git(repo, ["push", "origin", "release"]);
      const commit = yield* git(repo, ["rev-parse", "HEAD"]);
      yield* git(repo, ["checkout", "-b", "feature"]);
      yield* fs.writeFileString(path.join(repo, ".fabrika/fabrika.toml"), '[pack.trap]\nfrom = "./packs/trap"\n');
      const { publicKey } = generateKeyPairSync("ed25519");
      const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
      const blob = Buffer.concat([
        Buffer.from([0, 0, 0, 11]),
        Buffer.from("ssh-ed25519"),
        Buffer.from([0, 0, 0, 32]),
        raw,
      ]);
      const operator = "person_01m6v5270hf3c8x2q7w9z4k5mn";
      const selected = Effect.fnUntraced(function* (interactive: boolean, outcome: "ready" | "awaiting_trust") {
        const { port } = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
        const app = path.resolve(import.meta.dirname, "..");
        const argv = [
          path.join(app, "dev.ts"),
          "--repo",
          repo,
          "--instance.port",
          String(port),
          "--name",
          "repo-open-fixture",
          "--person",
          operator,
          "--founder",
          `ssh-ed25519 ${blob.toString("base64")}`,
          "--window",
          raw.toString("base64url"),
        ];
        const input = yield* Queue.unbounded<Uint8Array>();
        const scriptArgs =
          process.platform === "darwin"
            ? ["-q", "/dev/null", process.execPath, ...argv]
            : ["-q", "-e", "-c", [process.execPath, ...argv].map(quote).join(" "), "/dev/null"];
        const child = yield* ChildProcess.make(
          interactive ? "script" : process.execPath,
          interactive ? scriptArgs : argv,
          {
            cwd: repo,
            stdin: interactive ? Stream.fromQueue(input) : "ignore",
            extendEnv: false,
            env: {
              PATH: process.env.PATH,
              HOME: root,
              FABRIKA_HOME: home,
              DO_NOT_TRACK: "1",
              TERM: "xterm",
              TYPESAFE_API_KEY: undefined,
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_TERMINAL_PROMPT: "0",
            },
            forceKillAfter: "3 seconds",
          },
        );
        const output = yield* Ref.make("");
        yield* child.all.pipe(
          Stream.decodeText(),
          Stream.runForEach((part) => Ref.update(output, (old) => old + part)),
          Effect.forkScoped,
        );
        let answered = false;

        for (let n = 0; ; n++) {
          const said = yield* Ref.get(output);

          if (reports(said, commit, outcome).length > 0) {
            return said;
          }

          if (interactive && !answered && said.includes(commit)) {
            yield* Queue.offer(input, new TextEncoder().encode("y\n"));
            answered = true;
          }

          expect(yield* child.isRunning, "dev stopped before reporting selected repository state").toBe(true);
          expect(n, "no selected repository result").toBeLessThan(1200);
          yield* Effect.sleep("25 millis");
        }
      });
      const pending = yield* Effect.scoped(selected(false, "awaiting_trust"));
      expect(reports(pending, commit, "ready")).toEqual([]);
      expect((yield* entries(home)).filter((row) => row._tag === "decision")).toEqual([]);
      yield* Effect.scoped(selected(true, "ready"));
      const saved = yield* entries(home);
      const decisions = saved.filter((row) => row._tag === "decision");
      expect(decisions).toHaveLength(1);
      expect(JSON.stringify(decisions[0]?.body)).toContain(commit);
      const opening = saved.filter((row) => row._tag === "opened");
      expect(opening).toHaveLength(1);
      expect(opening[0]?.parent).not.toBeNull();
      const reopened = yield* Effect.scoped(selected(false, "ready"));
      expect(reports(reopened, commit, "awaiting_trust")).toEqual([]);
      expect((yield* entries(home)).filter((row) => row._tag === "decision")).toHaveLength(1);
      expect(yield* fs.exists(marker)).toBe(false);

      for (const output of [pending, reopened]) {
        expect(output).not.toContain(root);
        expect(output).not.toContain("[pack.trap]");
      }
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
