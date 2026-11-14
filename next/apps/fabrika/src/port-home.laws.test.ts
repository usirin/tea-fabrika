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
import { resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";
import { startupFixture } from "./record-wire.test-support.ts";

const FIXTURE = resolve(import.meta.dirname, "../../../../fixtures/next/port-home");
const NAME = "port-home";
// The two programs every instance starts by itself, so a fresh home already holds their facts.
const STREAMS = ["processes/counter:1", "processes/checklist:1"];

const Founding = Schema.Struct({ person: Schema.String, founder: Schema.String, window: Schema.String });

const Row = Schema.Struct({ name: Schema.String, process: Schema.String });
const Entries = Schema.Array(Schema.Unknown);
const Seen = Schema.Struct({ table: Schema.Array(Row), streams: Schema.Record(Schema.String, Entries) });

/** What the build before the slice answered, with the founding values its home was started with. */
const Saved = Schema.fromJsonString(Schema.Struct({ founding: Founding, seen: Seen }));

class InstanceError extends Schema.TaggedError<InstanceError>()("InstanceError", {
  method: Schema.String,
  cause: Schema.Defect(),
}) {}

const services = Layer.mergeAll(NodeServices.layer, SecureRandom.layerWebCrypto);

/** One call on the live instance, its answer read as `answer`, a rejection kept as an `InstanceError`. */
const call = <S extends Schema.Top>(method: string, answer: S, run: () => Promise<unknown>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new InstanceError({ method, cause }) }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(answer)),
  );

/** Starts this build on `home`, asks it `use`, and stops it by closing the scope. */
const open = Effect.fnUntraced(function* <A, E, R>(
  home: string,
  founding: typeof Founding.Type,
  use: (instance: any) => Effect.Effect<A, E, R>,
) {
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
  return yield* use(instance);
}, Effect.scoped);

/** What the law compares: who runs under which process id, and each program's saved facts. */
const observe = Effect.fnUntraced(function* (instance: any) {
  const project = instance.project(NAME);
  const rows = yield* call("info", Schema.Array(Row), () => project.info());
  const streams: Record<string, ReadonlyArray<unknown>> = {};

  for (const stream of STREAMS) {
    streams[stream] = yield* call("read", Entries, () => project.read(stream, 0, "audit"));
  }

  // Through JSON and back, so a live answer compares as the saved one reads from its file.
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Seen))(
    JSON.stringify({
      table: rows.map((row) => ({ name: row.name, process: row.process })).sort((a, b) => a.name.localeCompare(b.name)),
      streams,
    }),
  );
});

/** Copies the saved home to a folder of its own, opens it under this build and compares. */
const reopened = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  expect(
    yield* fs.exists(path.join(FIXTURE, "saved.json")),
    "no saved home in fixtures/next/port-home: save one with T502_PORT_HOME=write, on the commit before the slice's product code",
  ).toBe(true);
  const saved = yield* Schema.decodeUnknownEffect(Saved)(yield* fs.readFileString(path.join(FIXTURE, "saved.json")));
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t502-h-" });
  yield* fs.copy(path.join(FIXTURE, "home"), home, { overwrite: true });
  const seen = yield* open(home, saved.founding, observe);
  // The same names under the same process ids: a lost Project would start them again as new.
  expect(saved.seen.table.length).toBeGreaterThan(0);
  expect(seen.table).toEqual(saved.seen.table);

  // A ledger only grows, so every saved entry is still there, in its place.
  for (const stream of STREAMS) {
    const entries = saved.seen.streams[stream] ?? [];
    expect(entries.length, `${stream} was saved with its entries`).toBeGreaterThan(0);
    expect(seen.streams[stream]?.slice(0, entries.length), `${stream} keeps its saved entries`).toEqual(entries);
  }
}).pipe(Effect.scoped);

/** Starts a fresh home on this build and saves it, with what it answered, as the fixture. */
const written = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raw = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!;
  const field = (body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, body]);
  };
  const blob = Buffer.concat([field(Buffer.from("ssh-ed25519")), field(Buffer.from(raw, "base64url"))]);
  // Public values only. The private half of the pair is dropped here and saved nowhere.
  const founding: typeof Founding.Type = {
    person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
    founder: `ssh-ed25519 ${blob.toString("base64")}`,
    window: raw,
  };
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t502-w-" });
  const seen = yield* open(home, founding, observe);
  yield* fs.remove(FIXTURE, { recursive: true, force: true });
  yield* fs.makeDirectory(FIXTURE, { recursive: true });
  yield* fs.copy(home, path.join(FIXTURE, "home"), { overwrite: true });
  yield* fs.writeFileString(path.join(FIXTURE, "saved.json"), `${JSON.stringify({ founding, seen }, null, 2)}\n`);
}).pipe(Effect.scoped);

describe("T502 law 5, a saved home opens under this build, next/", () => {
  // vector: one home saved from a real run of the build before the slice, since only an older
  // build can write one (the plan's Laws table, law 5).
  it.live.skipIf(process.env.T502_PORT_HOME === "write")(
    "vector: the home saved before the slice opens with the same process table and the same entries",
    () => reopened.pipe(Effect.provide(services)),
    { timeout: 240_000 },
  );

  // vector: the writer of that saved home, run by hand on the commit before a slice's product
  // code. It then opens what it saved from a copy in another folder, so a home that only opens
  // where it was written fails here and is never committed.
  it.live.runIf(process.env.T502_PORT_HOME === "write")(
    "vector: this build saves a home that opens again from another folder",
    () => written.pipe(Effect.andThen(reopened), Effect.provide(services)),
    { timeout: 480_000 },
  );
});
