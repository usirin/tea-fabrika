// next/, test support. Kills the one workerd under a parent process, for the real-workerd crash laws
// (instance-wire's cases A and C, worker-supervision's case B), and reads where the kill landed.
// Read through its module, as port.test-support is.
// edge: Effect SQL has no read-only open of another process's SQLite file, which killedMoment needs
import { DatabaseSync } from "node:sqlite";
// edge: workerd writes a Durable Object's key-value rows with V8's serializer, and only node:v8 reads it
import { deserialize } from "node:v8";
import { NodeServices } from "@effect/platform-node";
import { Activity } from "@kampus/libfabrika/processes/Process";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

const processes = Effect.gen(function* () {
  const ps = yield* ChildProcess.make("ps", ["-axo", "pid=,ppid=,command="]);
  return yield* ps.stdout.pipe(Stream.decodeText(), Stream.mkString);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** The pid of the one `workerd` among `parent`'s descendants. More or fewer than one fails the test. */
const workerd = Effect.fn("workerd.find")(function* (parent: number) {
  const rows = (yield* processes).split("\n");
  const found = new Set([parent]);
  let grew = true;

  while (grew) {
    grew = false;

    for (const row of rows) {
      const m = /^\s*(\d+)\s+(\d+)\s+/.exec(row);

      if (m !== null && found.has(Number(m[2])) && !found.has(Number(m[1]))) {
        found.add(Number(m[1]));
        grew = true;
      }
    }
  }

  const pids = rows
    .filter((row) => /\/workerd(?:\s|$)/.test(row))
    .map((row) => Number(row.trim().split(/\s+/)[0]))
    .filter((pid) => found.has(pid));

  const [only] = pids;

  if (pids.length !== 1 || only === undefined) {
    return yield* Effect.die(new Error(`expected one workerd under pid ${parent}, found ${pids.length}`));
  }

  return only;
});

/** SIGKILLs the one workerd under `parent`, which restarts it alone, and answers its old pid. */
export const killWorkerd = Effect.fn("workerd.kill")(function* (parent: number) {
  const pid = yield* workerd(parent);
  // edge: Effect's ChildProcess signals only the processes it spawned, and this one is workerd's, found by `ps`
  yield* Effect.sync(() => process.kill(pid, "SIGKILL"));
  return pid;
});

/** Where a kill landed for one name: inside a step, with its letter, or between steps. */
const Moment = Schema.TaggedUnion({ inside: { letter: Schema.String }, between: {} });

// Only what the wake rule reads from the saved supervision: its name and whether its journal is
// `stepping`, with the attempt it names, or `idle`. Any other case matches the empty struct last.
const Saved = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    journal: Schema.Union([
      Schema.TaggedStruct("stepping", { attempt: Schema.Struct({ process: Schema.String, letter: Schema.String }) }),
      Schema.TaggedStruct("idle", {}),
      Schema.Struct({}),
    ]),
  }),
);

/** One object's two rows, or null when its file holds no `process_recovery` row for `name`. */
const objectRows = (db: DatabaseSync, name: string) => {
  const table = (t: string) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);

  if (!table("process_recovery")) {
    return null;
  }

  const saved = db.prepare("SELECT value FROM process_recovery WHERE name=?").get(name);

  if (saved === undefined) {
    return null;
  }

  // workerd's own key-value table (`_cf_KV`, key TEXT, value BLOB), read for its one `activity` row.
  const kv = table("_cf_KV") ? db.prepare("SELECT value FROM _cf_KV WHERE key='activity'").get() : undefined;
  return {
    journal: Schema.decodeUnknownSync(Saved)(saved.value).journal,
    marker: kv === undefined ? undefined : Schema.decodeUnknownSync(Activity)(deserialize(kv.value as Uint8Array)),
  };
};

/**
 * What a kill left on disk for `name`, read-only, after the reconnect and before any call into the object:
 * the product's own wake rule (Runner.ts, the first runner call after a restart). Inside means the saved
 * journal is `stepping` with an attempt for `pid`, or it is `idle` and the stored `activity` marker is
 * `stepping` for `pid`; between means neither.
 * It reads the home's SQLite files as instance-wire's `savedRows` does, and no row but these two.
 */
export const killedMoment = Effect.fn("workerd.killedMoment")(function* (home: string, name: string, pid: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Walks real folders only: a test home may link `node_modules`, and a link is never followed.
  const files: Array<string> = [];
  const folders = [home];

  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    for (const entry of yield* fs.readDirectoryEntries(folder).pipe(Effect.orDie)) {
      const at = path.join(folder, entry.name);

      if (entry.type === "Directory") {
        folders.push(at);
      } else if (entry.type === "File" && /\.(sqlite|db)$/.test(entry.name)) {
        files.push(at);
      }
    }
  }

  const found: Array<NonNullable<ReturnType<typeof objectRows>>> = [];

  for (const file of files) {
    const rows = yield* Effect.acquireUseRelease(
      Effect.sync(() => new DatabaseSync(file, { readOnly: true })),
      (db) => Effect.sync(() => objectRows(db, name)),
      (db) => Effect.sync(() => db.close()),
    );

    if (rows !== null) {
      found.push(rows);
    }
  }

  const [only] = found;

  if (found.length !== 1 || only === undefined) {
    return yield* Effect.die(new Error(`expected one saved supervision for ${name}, found ${found.length}`));
  }

  // One captured identity, one interruption: the saved attempt wins over the marker, as in Runner.ts.
  const { journal, marker } = only;
  const letter =
    "attempt" in journal && journal.attempt.process === pid
      ? journal.attempt.letter
      : "_tag" in journal && journal._tag === "idle" && marker?._tag === "stepping" && marker.process === pid
        ? marker.letter
        : undefined;
  return letter === undefined ? Moment.cases.between.make({}) : Moment.cases.inside.make({ letter });
}, Effect.provide(NodeServices.layer));
