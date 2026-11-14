// T502 S1, next/. Law 5 of docs/plan/ticket-502-alchemy-port.md: a home written by the build
// before a slice opens under the build after it. Outside only: real workerd, started through
// Alchemy in a scope and stopped by closing that scope.
//
// Why it can break: the local runtime keeps an object's storage under the Worker's name and the
// object's class name (@alchemy.run/cloudflare, Workers/LocalWorkerProvider.ts, `uniqueKey`). A
// class or a binding renamed by mistake opens empty storage, and nothing else would say so.
//
// The saved home is `fixtures/next/port-home`: `home/` is the instance's folder as the build
// before the slice left it, and `saved.json` is what that build answered, with the founding values
// the home was started with and the test key it was founded with. The writer makes that key fresh
// for this fixture and saves it whole, so a law can sign in and send an input. It guards nothing.
// Before it saves, the writer sends counter:1 one input, so the home holds a Process checkpoint. To save it again before a later slice, on the commit before
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
// edge: crypto makes the fixture's own test key and signs with it; no person's key is read
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
// edge: Effect SQL has no read-only open of another process's SQLite file, which the T833 law reads
import { DatabaseSync } from "node:sqlite";
// edge: workerd writes a Durable Object's key-value rows with V8's serializer, and only node:v8 reads it
import { deserialize } from "node:v8";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Activity } from "@kampus/libfabrika/processes/Process";
import { Clock, Effect, FileSystem, Layer, Path, Predicate, Schema } from "effect";
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

/** The fixture's own Ed25519 test key, as a JWK. Made fresh by the writer; it guards nothing. */
const TestKey = Schema.Struct({
  note: Schema.String,
  jwk: Schema.Struct({
    kty: Schema.Literal("OKP"),
    crv: Schema.Literal("Ed25519"),
    x: Schema.String,
    d: Schema.String,
  }),
});

/** What the build before the slice answered, with the founding values its home was started with. */
const Saved = Schema.fromJsonString(Schema.Struct({ founding: Founding, key: TestKey, seen: Seen }));

const field = (value: Buffer | string) => {
  const body = Buffer.from(value);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
};

/** A client identity from the test key: its raw key, its fingerprint and an SSH signature of a text. */
const identity = (key: typeof TestKey.Type) => {
  const bytes = Buffer.from(key.jwk.x, "base64url");
  const privateKey = createPrivateKey({ key: { ...key.jwk }, format: "jwk" });
  return {
    raw: key.jwk.x,
    line: `ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(bytes)]).toString("base64")}`,
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
    proof: (text: string) => {
      const payload = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(text).digest()),
      ]);
      const version = Buffer.alloc(4);
      version.writeUInt32BE(1);
      const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, privateKey))])),
      ]);
      return `-----BEGIN SSH SIGNATURE-----\n${packet
        .toString("base64")
        .match(/.{1,70}/g)
        ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

const Frame = Schema.Struct({
  id: Schema.optionalKey(Schema.Number),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
});

const SENT = "2026-11-14T00:00:00Z";

/** Signs in as the test key through the door, sends `pid` one `inc` as `letter`, and answers the
 *  count the process's view shows after it. */
const inc = Effect.fnUntraced(function* (instance: any, key: typeof TestKey.Type, pid: string, letter: string) {
  const id = identity(key);
  const url: string = instance.url;
  const tab = `port-home-${letter}`;
  const frames: Array<typeof Frame.Type> = [];
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const socket = new WebSocket(`${url.replace("http", "ws")}/client/${encodeURIComponent(id.fingerprint)}/${tab}`);
      socket.addEventListener("message", (event) => {
        if (event.data !== "pong") {
          frames.push(Schema.decodeUnknownSync(Schema.fromJsonString(Frame))(String(event.data)));
        }
      });
      return socket;
    }),
    (held) => Effect.sync(() => held.close()),
  );
  const next = Effect.fnUntraced(function* (match: (frame: typeof Frame.Type) => boolean) {
    for (let n = 0; n < 300; n++) {
      const at = frames.findIndex(match);

      if (at >= 0) {
        return frames.splice(at, 1)[0]!;
      }

      if (socket.readyState === WebSocket.CLOSED) {
        return yield* Effect.die("the signed client closed");
      }

      yield* Effect.sleep("100 millis");
    }

    return yield* Effect.die("the signed client received no matching frame within 30 seconds");
  });
  let serial = 0;
  const ask = Effect.fnUntraced(function* (method: string, params: unknown) {
    const n = ++serial;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }));
    return yield* next((frame) => frame.id === n);
  });
  const challenge = yield* next((frame) => frame.method === "challenge");
  const { nonce } = yield* Schema.decodeUnknownEffect(Schema.Struct({ nonce: Schema.String }))(challenge.params);
  const hello = yield* ask("initialize", {
    versions: [1],
    has: ["seal"],
    ping: "30s",
    key: id.raw,
    tab,
    nonce,
    platform: "headless",
    os: "linux",
    sentAt: SENT,
    signed: id.proof(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
  });
  expect(hello.error, "the test key is admitted").toBeUndefined();
  const sent = yield* ask("process.send", { pid, letter, m: { type: "inc" }, sentAt: SENT, seen: 0 });
  expect(sent, "the input is accepted").toMatchObject({ result: { _tag: "accepted" } });
  const opened = yield* ask("view.open", { pid });
  return yield* Schema.decodeUnknownEffect(
    Schema.Struct({ result: Schema.Struct({ view: Schema.Struct({ count: Schema.Number }) }) }),
  )(opened).pipe(Effect.map((answer) => answer.result.view.count));
}, Effect.scoped);

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

/** Starts this build on `home`, with `programs` replacing built-in programs by name when given,
 *  asks it `use` with the build's out folder as given and as its real path and with the build
 *  itself, and stops it by closing the scope. */
const open = Effect.fnUntraced(function* <A, E, R>(
  home: string,
  founding: typeof Founding.Type,
  use: (
    instance: any,
    dists: ReadonlyArray<string>,
    built: Effect.Success<ReturnType<typeof build>>,
  ) => Effect.Effect<A, E, R>,
  programs?: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const out = yield* fs.makeTempDirectoryScoped({ prefix: "t502-b-" });
  const at = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const dist = path.join(out, "dist");
  // A replacing program is a module source; it is written beside the build and resolves the app's packages.
  const modules: Record<string, string> = {};

  if (programs !== undefined) {
    yield* fs.symlink(path.resolve(import.meta.dirname, "../node_modules"), path.join(out, "node_modules"));

    for (const [n, [name, source]] of Object.entries(programs).entries()) {
      modules[name] = path.join(out, `program-${n}.ts`);
      yield* fs.writeFileString(modules[name], source);
    }
  }

  const built = yield* build({ out: dist, ...(programs === undefined ? {} : { programs: modules }) });
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
  return yield* use(instance, dists, built);
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
  // A test key made fresh for this fixture, saved whole so a law can sign in with it. It founds
  // only this saved home and is never read from or written to anyone's machine.
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  const key = yield* Schema.decodeUnknownEffect(TestKey)({
    note: "test key: made fresh for this fixture by its writer in port-home.laws.test.ts; it guards nothing",
    jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d },
  });
  const founding: typeof Founding.Type = {
    person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
    founder: identity(key).line,
    window: key.jwk.x,
  };
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t502-w-" });
  const { seen, dists } = yield* open(home, founding, (instance, dists) =>
    Effect.gen(function* () {
      // One input, so the saved home holds counter:1's checkpoint at its program's state version.
      const rows = yield* call("info", Schema.Array(Row), () => instance.project(NAME).info());
      const pid = rows.find((row) => row.name === "counter:1")!.process;
      expect(yield* inc(instance, key, pid, "port-home-1"), "counter:1 stepped its one input").toBe(1);
      return { seen: yield* observe(instance), dists };
    }),
  );
  // Everything is staged and guarded first: no path below removes or writes FIXTURE before the
  // guard has found nothing.
  const staging = yield* fs.makeTempDirectoryScoped({ prefix: "t502-s-" });
  yield* fs.copy(home, path.join(staging, "home"), { overwrite: true });
  yield* relativeMain(path.join(staging, "home"), dists);
  yield* fs.writeFileString(path.join(staging, "saved.json"), `${JSON.stringify({ founding, key, seen }, null, 2)}\n`);
  const hits = yield* machinePaths(staging, yield* machineRoots);
  expect(hits, "the home to be saved names a machine path, so nothing was saved").toEqual([]);
  yield* fs.remove(FIXTURE, { recursive: true, force: true });
  yield* fs.makeDirectory(path.dirname(FIXTURE), { recursive: true });
  yield* fs.copy(staging, FIXTURE, { overwrite: true });
}).pipe(Effect.scoped);

// T833, P15 slice 1's fix round, next/. H6 of docs/direction/hot-reload.md (0293): a step, a Cmd
// or a job record always says which code made it. The saved home predates the code store, so its
// descriptors name builds whose code it never kept. This build opens it on its own code for each
// program, so every record a process writes from then on names that code. The move is one
// `code.loaded {was: <saved build>, hash: <this build's>, from: "boot"}` on `gateway/code`, appended
// at open before any step can run. `from` stays one of 0293's four values: the move is told apart
// from an ordinary boot accept by `was` being set on the home's first code fact for the program,
// where an ordinary boot accept has `was: null`.
//
// The law builds with `counterAt(1)` in place of the app's counter, so counter:1's saved build is
// code this build does not have, as after any change to a program's code. The records read: each
// process's checkpoint, its saved supervision (the build each `begin`
// names), its activity marker, its lines on its own stream and its job records, after the open
// and after counter:1 steps one real input signed with the fixture's test key.
// Plant: on 004c3c412 the open loads by name but keeps the saved hash, so a job record names it.

/** A counter of the law's own, by state version: the app's counter machine and inputs, at `v`
 *  with one upgrade from v1 when `v` is 2. A law that opens the saved home builds with it in place
 *  of the app's counter, so this build's counter is code the saved home never ran. The saved home
 *  is from the build before the code store (6f04d13ac), whose counter bundle is byte for byte the
 *  one main still builds, so without it no saved hash would be missing. */
const counterAt = (v: 1 | 2) =>
  v === 1
    ? `import { counterMachine } from "@kampus/counter";
import { Program } from "@kampus/libfabrika";
export const program = Program.make({
  name: "fabrika/counter",
  machine: counterMachine,
  state: { v: 1, upgrades: [] },
  view: (model) => ({ count: model.count }),
  refuse: () => null,
  inputs: { inc: "Add one", dec: "Take one away", reset: "Back to zero" },
  outputs: {},
  writes: {},
  wake: () => null,
});
`
    : `import { counterMachine } from "@kampus/counter";
import { Program } from "@kampus/libfabrika";
export const program = Program.make({
  name: "fabrika/counter",
  machine: counterMachine,
  state: { v: 2, upgrades: [{ name: "same", from: 1, run: (model) => model }] },
  view: (model) => ({ count: model.count }),
  refuse: () => null,
  inputs: { inc: "Add one", dec: "Take one away", reset: "Back to zero" },
  outputs: {},
  writes: {},
  wake: () => null,
});
`;

const SavedProcess = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  program: Schema.String,
  build: Schema.String,
});

const Descriptors = Schema.Array(Schema.Struct({ value: Schema.fromJsonString(SavedProcess) }));
const Revs = Schema.Array(Schema.Struct({ rev: Schema.NullOr(Schema.Number) }));

const Checkpoints = Schema.Array(
  Schema.Struct({
    process: Schema.String,
    checkpoint: Schema.fromJsonString(Schema.Struct({ saved: Schema.Struct({ build: Schema.String }) })),
  }),
);

const Supervisions = Schema.Array(
  Schema.Struct({ name: Schema.String, value: Schema.fromJsonString(Schema.Struct({ build: Schema.String })) }),
);

const Markers = Schema.Array(Schema.Struct({ value: Schema.Uint8Array }));

const Lines = Schema.Array(
  Schema.Struct({
    rev: Schema.Number,
    stream: Schema.String,
    _tag: Schema.String,
    build: Schema.String,
    body: Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);

const Jobs = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    startTimeUnixNano: Schema.String,
    attributes: Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);

/** Reads `query` from each SQLite file under `home` that has `table`, read-only, decoded as `rows`. */
const rowsUnder = Effect.fnUntraced(function* <S extends Schema.Top>(
  home: string,
  table: string,
  query: string,
  rows: S,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const found: Array<{ file: string; rows: S["Type"] }> = [];

  for (const file of yield* fs.readDirectory(home, { recursive: true })) {
    if (!file.endsWith(".sqlite")) {
      continue;
    }

    const raw = yield* Effect.acquireUseRelease(
      Effect.sync(() => new DatabaseSync(path.join(home, file), { readOnly: true })),
      (db) =>
        Effect.sync(() =>
          db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) === undefined
            ? null
            : db.prepare(query).all(),
        ),
      (db) => Effect.sync(() => db.close()),
    );

    if (raw !== null) {
      found.push({ file, rows: yield* Schema.decodeUnknownEffect(rows)(raw) });
    }
  }

  return found;
});

/** Each record the process `saved` wrote after rev `after` and, for a job record, from `since`
 *  (Unix nanoseconds) on, with the build it names. The saved home's own records are older. */
const writtenBy = Effect.fnUntraced(function* (
  home: string,
  saved: typeof SavedProcess.Type,
  after: number,
  since: bigint,
) {
  const named: Array<{ record: string; build: string }> = [];
  const checkpoints = yield* rowsUnder(
    home,
    "process_state",
    "SELECT process, checkpoint FROM process_state",
    Checkpoints,
  );

  for (const { file, rows } of checkpoints) {
    for (const row of rows.filter((r) => r.process === saved.id)) {
      named.push({ record: "checkpoint", build: row.checkpoint.saved.build });

      // The activity marker lives in the same object's key-value rows.
      for (const marker of yield* rowsUnder(home, "_cf_KV", "SELECT value FROM _cf_KV WHERE key='activity'", Markers)) {
        if (marker.file !== file) {
          continue;
        }

        for (const { value } of marker.rows) {
          const activity = yield* Schema.decodeUnknownEffect(Activity)(deserialize(value));

          if (activity._tag === "stepping" && activity.process === saved.id) {
            named.push({ record: "activity", build: activity.build });
          }
        }
      }
    }
  }

  for (const { rows } of yield* rowsUnder(
    home,
    "process_recovery",
    "SELECT name, value FROM process_recovery",
    Supervisions,
  )) {
    for (const row of rows.filter((r) => r.name === saved.name)) {
      named.push({ record: "supervision", build: row.value.build });
    }
  }

  const lines = yield* rowsUnder(
    home,
    "entries",
    `SELECT rev, stream, _tag, build, body FROM entries WHERE rev > ${after} ORDER BY rev`,
    Lines,
  );

  for (const line of lines.flatMap((found) => found.rows).filter((l) => l.stream === saved.id)) {
    named.push({ record: `line ${line._tag}`, build: line.build });
  }

  for (const { rows } of yield* rowsUnder(
    home,
    "spans",
    "SELECT name, startTimeUnixNano, attributes FROM spans",
    Jobs,
  )) {
    for (const job of rows.filter((row) => BigInt(row.startTimeUnixNano) >= since)) {
      const a = job.attributes;

      if ((a["process"] === saved.id || a["fab.process"] === saved.id) && typeof a["build"] === "string") {
        named.push({ record: `job ${job.name}`, build: a["build"] });
      }
    }
  }

  return named;
});

/** Opens a copy of the saved home under this build and checks what each saved process wrote. */
const reopenedOnItsCode = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const saved = yield* Schema.decodeUnknownEffect(Saved)(yield* fs.readFileString(path.join(FIXTURE, "saved.json")));
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t833-h-" });
  yield* fs.copy(path.join(FIXTURE, "home"), home, { overwrite: true });
  // Read from the copy, never the fixture: even a read-only open is the copy's to make.
  const descriptors = (yield* rowsUnder(home, "dev_descriptors", "SELECT value FROM dev_descriptors", Descriptors))
    .flatMap((found) => found.rows)
    .map((row) => row.value);
  const [last] = (yield* rowsUnder(home, "entries", "SELECT max(rev) AS rev FROM entries", Revs)).flatMap(
    (f) => f.rows,
  );
  const after = last?.rev ?? 0;
  expect(descriptors.length, "the saved home has its processes' descriptors").toBeGreaterThan(0);
  const counter = descriptors.find((d) => d.name === "counter:1")!;
  const since = BigInt(yield* Clock.currentTimeMillis) * 1_000_000n;
  const code = yield* open(
    home,
    saved.founding,
    (instance, _dists, built) =>
      Effect.gen(function* () {
        // The fixture's checkpoint holds count 1, so one more input shows 2.
        expect(yield* inc(instance, saved.key, counter.id, "t833-one"), "counter:1 stepped one real input").toBe(2);
        return Object.fromEntries(Object.entries(built.programs).map(([name, program]) => [name, program.hash]));
      }),
    { "fabrika/counter": counterAt(1) },
  );
  const added = (yield* rowsUnder(
    home,
    "entries",
    `SELECT rev, stream, _tag, build, body FROM entries WHERE rev > ${after} ORDER BY rev`,
    Lines,
  )).flatMap((found) => found.rows);

  for (const descriptor of descriptors) {
    const hash = code[descriptor.program];
    expect(hash, `this build has ${descriptor.program}`).toBeDefined();
    const moves = added.filter(
      (line) =>
        line.stream === "gateway/code" &&
        line._tag === "code.loaded" &&
        line.body["program"] === descriptor.program &&
        line.body["was"] === descriptor.build,
    );
    // Soft, so one run reports every record that names other code, not only the first.
    // One fact records the move from the saved build to this build's code; none when they match.
    expect
      .soft(
        moves.map((line) => line.body),
        `${descriptor.name}: one code.loaded from "boot", with was set, records its move to this build's code`,
      )
      .toEqual(
        hash === descriptor.build ? [] : [{ program: descriptor.program, hash, was: descriptor.build, from: "boot" }],
      );
    const records = yield* writtenBy(home, descriptor, after, since);

    // A process that moved wrote records; one this build's code already matches may write none.
    if (hash !== descriptor.build) {
      expect(records.length, `${descriptor.name} wrote its records`).toBeGreaterThan(0);
    }

    expect
      .soft(
        records.filter((r) => r.build !== hash),
        `${descriptor.name}: every record it writes names this build's code`,
      )
      .toEqual([]);

    // Its own lines come after the fact that moved it, and no other new record names the saved build.
    for (const line of added.filter((l) => l.stream === descriptor.id)) {
      expect
        .soft(line.rev, `${descriptor.name}'s ${line._tag} is after its code.loaded`)
        .toBeGreaterThan(moves[0]?.rev ?? 0);
    }

    // Saved code this build still has is this build's own code, so only a move is checked here.
    if (hash !== descriptor.build) {
      expect
        .soft(
          added
            .filter((line) => !moves.includes(line))
            .filter((line) => JSON.stringify([line.build, line.body]).includes(descriptor.build))
            .map((line) => [line.stream, line._tag, line.body]),
          `${descriptor.name}: only its code.loaded names the saved build ${descriptor.build}`,
        )
        .toEqual([]);
    }
  }
}).pipe(Effect.scoped);

// T833, the fix round's upgrade case, next/. The saved home holds counter:1's checkpoint at state
// v1, written by the build before the code store. This build replaces the counter with the same
// machine at v2 and one upgrade from v1 (`counterAt(2)`), so the first load climbs the checkpoint
// and records `state.upgraded` (Runner.ts, the load). That fact and every line after it name this
// build's counter hash, never the saved build. The app's counter is at v1 with no upgrades, so only
// a newer counter can make a v1 checkpoint lower.
// Plant: on 004c3c412 `state.upgraded` carries the descriptor's saved build.

const upgradedOnItsCode = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const saved = yield* Schema.decodeUnknownEffect(Saved)(yield* fs.readFileString(path.join(FIXTURE, "saved.json")));
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t833-u-" });
  yield* fs.copy(path.join(FIXTURE, "home"), home, { overwrite: true });
  const counter = (yield* rowsUnder(home, "dev_descriptors", "SELECT value FROM dev_descriptors", Descriptors))
    .flatMap((found) => found.rows)
    .map((row) => row.value)
    .find((d) => d.name === "counter:1")!;
  const checkpoint = (yield* rowsUnder(
    home,
    "process_state",
    "SELECT process, checkpoint FROM process_state",
    Checkpoints,
  ))
    .flatMap((found) => found.rows)
    .find((row) => row.process === counter.id);
  expect(checkpoint, "the saved home holds counter:1's checkpoint").toBeDefined();
  const [last] = (yield* rowsUnder(home, "entries", "SELECT max(rev) AS rev FROM entries", Revs)).flatMap(
    (f) => f.rows,
  );
  const after = last?.rev ?? 0;
  const hash = yield* open(
    home,
    saved.founding,
    (instance, _dists, built) =>
      Effect.gen(function* () {
        // The upgrade keeps the model, so the saved count 1 becomes 2.
        expect(yield* inc(instance, saved.key, counter.id, "t833-upgrade"), "the upgraded counter kept its count").toBe(
          2,
        );
        return built.programs["fabrika/counter"]!.hash;
      }),
    { "fabrika/counter": counterAt(2) },
  );
  const lines = (yield* rowsUnder(
    home,
    "entries",
    `SELECT rev, stream, _tag, build, body FROM entries WHERE rev > ${after} ORDER BY rev`,
    Lines,
  ))
    .flatMap((found) => found.rows)
    .filter((line) => line.stream === counter.id);
  const upgraded = lines.filter((line) => line._tag === "state.upgraded");
  expect(
    upgraded.map((line) => [line.build, line.body]),
    "one state.upgraded from v1 to v2, written by and naming this build's counter",
  ).toEqual([[hash, { program: "fabrika/counter", from: 1, to: 2, ran: ["same"], build: hash }]]);
  expect(
    lines
      .filter((line) => line.rev >= upgraded[0]!.rev)
      .filter((line) => line.build !== hash || JSON.stringify(line.body).includes(counter.build))
      .map((line) => [line._tag, line.build, line.body]),
    `every line from the upgrade on names this build's counter, never the saved build ${counter.build}`,
  ).toEqual([]);
}).pipe(Effect.scoped);

describe("T502 law 5, a saved home opens under this build, next/", () => {
  // vector: one home saved from a real run of the build before the slice, since only an older
  // build can write one (the plan's Laws table, law 5).
  it.live.skipIf(process.env.T502_PORT_HOME === "write")(
    "vector: the home saved before the slice opens with the same process table and the same entries",
    () => reopened.pipe(Effect.provide(services)),
    { timeout: 240_000 },
  );

  // vector: one home saved by a build before the code store, since only such a build can write a
  // home whose descriptors name code it never kept (T833, the fix round's law 1; 0093's label).
  it.live.skipIf(process.env.T502_PORT_HOME === "write")(
    "vector: a home saved before the code store opens each process on this build's code, with one code.loaded from boot with was set, and every record it writes names that code",
    () => reopenedOnItsCode.pipe(Effect.provide(services)),
    { timeout: 240_000 },
  );

  // vector: one checkpoint saved by a build before the code store, at a lower state version than
  // this law's counter, since only an older build can write it (T833's upgrade case; 0093's label).
  it.live.skipIf(process.env.T502_PORT_HOME === "write")(
    "vector: a checkpoint saved before the code store upgrades on this build's code, and state.upgraded and every line after it name that code",
    () => upgradedOnItsCode.pipe(Effect.provide(services)),
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
