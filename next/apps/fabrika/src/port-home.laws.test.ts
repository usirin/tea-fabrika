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
// A saved home is public, so the writer never saves one that names a machine path. It copies the
// run's home into a staging folder, makes each Alchemy resource's `props.main` relative to the
// build's out folder, writes `saved.json` there, and runs the guard in port-home.test-support.ts
// over all of it, SQLite cells included, for the person's home folder, the temp folder (and its
// real path) and the repo root. On any hit it fails with the hit list, and the fixture is left as
// it was. Only then does the staging copy replace the fixture. Read the diff before it is committed.
//
// Not read yet: waits. A parked wait is a row in the Project object, seen only through a test
// method on the Project class, so it joins with the slice that ports Project (S3).
// Plant: bind the Connection class under another class name in the stack.
import { generateKeyPairSync } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Predicate, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { machinePaths } from "./port-home.test-support.ts";
import { heldPort } from "./port.test-support.ts";
import { startupFixture } from "./record-wire.test-support.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const FIXTURE = resolve(ROOT, "fixtures/next/port-home");
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

/** Starts this build on `home`, asks it `use` with the build's out folder as given and as its real
 *  path, and stops it by closing the scope. */
const open = Effect.fnUntraced(function* <A, E, R>(
  home: string,
  founding: typeof Founding.Type,
  use: (instance: any, dists: ReadonlyArray<string>) => Effect.Effect<A, E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const out = yield* fs.makeTempDirectoryScoped({ prefix: "t502-b-" });
  const at = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const dist = path.join(out, "dist");
  const built = yield* build({ out: dist });
  const dists = [dist, yield* fs.realPath(dist)];
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
  return yield* use(instance, dists);
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

/** One Alchemy resource file, read whole so writing it back keeps every field in its place. */
const Resource = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

/** Makes `props.main` in each Alchemy resource file under `home`'s `.alchemy/state/` relative to
 *  the build's out folder, given as `dists` (as passed and as its real path), and changes no other
 *  byte. */
const relativeMain = Effect.fnUntraced(function* (home: string, dists: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const state = path.join(home, ".alchemy", "state");

  if (!(yield* fs.exists(state))) {
    return;
  }

  for (const file of yield* fs.readDirectory(state, { recursive: true })) {
    const full = path.join(state, file);

    if (!file.endsWith(".json") || (yield* fs.stat(full)).type !== "File") {
      continue;
    }

    const text = yield* fs.readFileString(full);
    const resource = yield* Schema.decodeUnknownEffect(Resource)(text);
    const props = resource["props"];
    const main = Predicate.isObject(props) && "main" in props ? props.main : undefined;

    if (!Predicate.isObject(props) || typeof main !== "string") {
      continue;
    }

    // Alchemy writes a resource as `JSON.stringify(state, null, 2)` (`alchemy@2.0.0-beta.85`,
    // `src/State/LocalState.ts`). Writing it back the same way changes only `props.main`; a file
    // in any other shape fails here rather than be rewritten.
    expect(JSON.stringify(resource, null, 2), `${file} is not in Alchemy's own shape`).toBe(text);
    const relative = dists.map((dist) => path.relative(dist, main)).find((one) => !one.startsWith(".."));
    expect(relative, `${file}: props.main is outside the build's out folder`).toBeDefined();
    // Why a relative path is safe: Alchemy's local provider diff reads only the new props and the
    // saved attributes (`alchemy@2.0.0-beta.85`, `src/Local/LocalProvider.ts`, `diff`), and the
    // engine's fallback compares the old props only to pick update or noop (`src/Plan.ts`, at the
    // second `provider?.diff?.(` call). Each run builds into a new temp folder, so the old path and
    // the relative one give the same answer. Removing `.alchemy/state` instead would lose the saved
    // attributes, the Measurements bucket's `dev:` name among them, so the next open would make a
    // new bucket and the home would no longer be what the run wrote.
    yield* fs.writeFileString(
      full,
      JSON.stringify({ ...resource, props: { ...props, main: relative ?? main } }, null, 2),
    );
  }
});

/** Every folder a saved file must not name: the person's home folder, the temp folder and its real
 *  path (on macOS `/var` is `/private/var`), and the repo root. */
const machineRoots = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return [...new Set([homedir(), tmpdir(), yield* fs.realPath(tmpdir()), ROOT])];
});

/** Starts a fresh home on this build and saves it, with what it answered, as the fixture, once the
 *  guard finds no machine path in what would be saved. */
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
  const { seen, dists } = yield* open(home, founding, (instance, dists) =>
    observe(instance).pipe(Effect.map((seen) => ({ seen, dists }))),
  );
  // Everything is staged and guarded first: no path below removes or writes FIXTURE before the
  // guard has found nothing.
  const staging = yield* fs.makeTempDirectoryScoped({ prefix: "t502-s-" });
  yield* fs.copy(home, path.join(staging, "home"), { overwrite: true });
  yield* relativeMain(path.join(staging, "home"), dists);
  yield* fs.writeFileString(path.join(staging, "saved.json"), `${JSON.stringify({ founding, seen }, null, 2)}\n`);
  const hits = yield* machinePaths(staging, yield* machineRoots);
  expect(hits, "the home to be saved names a machine path, so nothing was saved").toEqual([]);
  yield* fs.remove(FIXTURE, { recursive: true, force: true });
  yield* fs.makeDirectory(path.dirname(FIXTURE), { recursive: true });
  yield* fs.copy(staging, FIXTURE, { overwrite: true });
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
