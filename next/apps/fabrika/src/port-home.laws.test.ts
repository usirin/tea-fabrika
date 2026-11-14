// T502 S1, next/. Law 5 of docs/plan/ticket-502-alchemy-port.md: a home written by the build
// before a slice opens under the build after it. Outside only: real workerd, started through
// Alchemy in a scope and stopped by closing that scope.
//
// Why it can break: the local runtime keeps an object's storage under the Worker's name and the
// object's class name (@alchemy.run/cloudflare, Workers/LocalWorkerProvider.ts, `uniqueKey`). A
// class or a binding renamed by mistake opens empty storage, and nothing else would say so.
//
// The saved home is `fixtures/next/port-home`: `home/` is the instance's folder as the build
// before the slice left it, and `saved.json` is what that build answered, with the public founding
// values the home was started with. To save it again before a later slice, on the commit before
// that slice's product code:
//
//   T502_PORT_HOME=write pnpm exec vitest run next/apps/fabrika/src/port-home.laws.test.ts
//
// Then read `strings` over every saved file before it is committed: a saved home is public.
//
// Not read yet: waits. A parked wait is a row in the Project object, seen only through a test
// method on the Project class, so it joins with the slice that ports Project (S3).
// Plant: bind the Connection class under another class name in the stack.
import { generateKeyPairSync } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { SecureRandom } from "effect/crypto";
import { describe, expect, it } from "vitest";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";
import { startupFixture } from "./record-wire.test-support.ts";

const FIXTURE = resolve(import.meta.dirname, "../../../../fixtures/next/port-home");
const NAME = "port-home";
// The two programs every instance starts by itself, so a fresh home already holds their facts.
const STREAMS = ["processes/counter:1", "processes/checklist:1"];

type Founding = { readonly person: string; readonly founder: string; readonly window: string };

type Seen = {
  readonly table: ReadonlyArray<{ readonly name: string; readonly process: string }>;
  readonly streams: Readonly<Record<string, ReadonlyArray<unknown>>>;
};

/** Starts this build on `home`, asks it `use`, and stops it by closing the scope. */
const open = <A>(home: string, founding: Founding, use: (instance: any) => Promise<A>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const out = yield* fs.makeTempDirectoryScoped({ prefix: "t502-b-" });
      const at = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
      const built = yield* build({ out: path.join(out, "dist") });
      const old = process.env.ALCHEMY_HOME;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (old === undefined) {
            delete process.env.ALCHEMY_HOME;
          } else {
            process.env.ALCHEMY_HOME = old;
          }
        }),
      );
      const instance = yield* localInstance(built, startupFixture({ home, name: NAME, ...founding, port: at.port }));
      return yield* Effect.promise(() => use(instance));
    }).pipe(Effect.scoped, Effect.provide(SecureRandom.layerWebCrypto), Effect.provide(NodeServices.layer)),
  );

/** What the law compares: who runs under which process id, and each program's saved facts. */
const observe = async (instance: any): Promise<Seen> => {
  const project = instance.project(NAME);
  const rows: Array<{ name: string; process: string }> = await project.info();
  const streams: Record<string, ReadonlyArray<unknown>> = {};

  for (const stream of STREAMS) {
    streams[stream] = await project.read(stream, 0, "audit");
  }

  return JSON.parse(
    JSON.stringify({
      table: rows.map((row) => ({ name: row.name, process: row.process })).sort((a, b) => a.name.localeCompare(b.name)),
      streams,
    }),
  );
};

/** Copies the saved home to a folder of its own, opens it under this build and compares. */
const reopened = async () => {
  expect(
    existsSync(join(FIXTURE, "saved.json")),
    "no saved home in fixtures/next/port-home: save one with T502_PORT_HOME=write, on the commit before the slice's product code",
  ).toBe(true);
  const saved: { founding: Founding; seen: Seen } = JSON.parse(readFileSync(join(FIXTURE, "saved.json"), "utf8"));
  const home = mkdtempSync(join(tmpdir(), "t502-h-"));

  try {
    cpSync(join(FIXTURE, "home"), home, { recursive: true });
    const seen = await open(home, saved.founding, observe);
    // The same names under the same process ids: a lost Project would start them again as new.
    expect(saved.seen.table.length).toBeGreaterThan(0);
    expect(seen.table).toEqual(saved.seen.table);

    // A ledger only grows, so every saved entry is still there, in its place.
    for (const stream of STREAMS) {
      const entries = saved.seen.streams[stream] ?? [];
      expect(entries.length, `${stream} was saved with its entries`).toBeGreaterThan(0);
      expect(seen.streams[stream]?.slice(0, entries.length), `${stream} keeps its saved entries`).toEqual(entries);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

describe("T502 law 5, a saved home opens under this build, next/", () => {
  // vector: one home saved from a real run of the build before the slice, since only an older
  // build can write one (the plan's Laws table, law 5).
  it.skipIf(process.env.T502_PORT_HOME === "write")(
    "vector: the home saved before the slice opens with the same process table and the same entries",
    { timeout: 240_000 },
    reopened,
  );

  // vector: the writer of that saved home, run by hand on the commit before a slice's product
  // code. It then opens what it saved from a copy in another folder, so a home that only opens
  // where it was written fails here and is never committed.
  it.runIf(process.env.T502_PORT_HOME === "write")(
    "vector: this build saves a home that opens again from another folder",
    { timeout: 480_000 },
    async () => {
      const raw = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!;
      const field = (body: Buffer) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(body.length);
        return Buffer.concat([length, body]);
      };
      const blob = Buffer.concat([field(Buffer.from("ssh-ed25519")), field(Buffer.from(raw, "base64url"))]);
      // Public values only. The private half of the pair is dropped here and saved nowhere.
      const founding: Founding = {
        person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
        founder: `ssh-ed25519 ${blob.toString("base64")}`,
        window: raw,
      };
      const home = mkdtempSync(join(tmpdir(), "t502-w-"));

      try {
        const seen = await open(home, founding, observe);
        rmSync(FIXTURE, { recursive: true, force: true });
        cpSync(home, join(FIXTURE, "home"), { recursive: true });
        writeFileSync(join(FIXTURE, "saved.json"), `${JSON.stringify({ founding, seen }, null, 2)}\n`);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }

      await reopened();
    },
  );
});
