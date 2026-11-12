// next/, P34c slice 4 (ticket 404): the host measurement the plan asks for before quota defaults are pinned.
//
// It starts one real local instance the way worker-supervision.test.ts and worker-usage.test.ts do
// (the app's build, localInstance, a held port, a signed WebSocket client), drives load and recovery,
// and counts from the outside. No product code is changed.
//
//   node experiments/p34cs4-measure/measure.ts                 run, then analyze
//   node experiments/p34cs4-measure/measure.ts --from <dir>    analyze a saved raw.json again
//
// Raw samples go under runs/ (git-ignored) or the folder --out names. Never into git.
//
// How it counts:
// - Ledger entries: read from the Project object's `entries` table at the end. Append-only, each with the
//   referee's `arrivedAt`, so the count is exact.
// - Row changes in the other tables: the script adds a side table `m_log` and AFTER INSERT / UPDATE /
//   DELETE triggers to each object's SQLite file, from outside, before the load starts. An UPDATE that
//   leaves every non-key column equal logs nothing, as the plan's write unit says. workerd refuses a
//   trigger on its own `_cf_KV` table, so the activity marker is counted from the product's own
//   `process.activity` health rows instead: one row per put.
// - Bytes: UTF-8 bytes of every column of a live row, keys included, integers as decimal text. An entry
//   is the UTF-8 of its whole Entry as JSON, in the Entry schema's field order.
// edge: crypto makes an ephemeral identity for the signed hello; no person's key is read
import { createHash, generateKeyPairSync, sign } from "node:crypto";
// edge: Effect SQL has no open of another process's SQLite file, which counting from outside needs
import { DatabaseSync } from "node:sqlite";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Clock, Console, Effect, Fiber, FileSystem, Option, Path, Predicate, Schema, Stream } from "effect";
import { Command, Flag } from "effect/cli";
import { SecureRandom } from "effect/crypto";
import { ChildProcess } from "effect/process";
import { build } from "../../next/apps/fabrika/src/build.ts";
import { localInstance } from "../../next/apps/fabrika/src/local-instance.ts";
import { heldPort } from "../../next/apps/fabrika/src/port.test-support.ts";

const PROJECT = "p34cs4";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-12T00:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const CHECKLIST = "fabrika/checklist";
const POISON = "measure/poison";
const MINUTE = 60_000;

// ---------------------------------------------------------------------------------------------
// Raw shapes

/** One row of the Project object's `entries` table, its body still JSON text. */
const EntryRow = Schema.Struct({
  rev: Schema.Number,
  stream: Schema.String,
  pos: Schema.Number,
  id: Schema.String,
  arrivedAt: Schema.Number,
  by: Schema.String,
  for: Schema.String,
  sentAt: Schema.String,
  seen: Schema.Number,
  parent: Schema.NullOr(Schema.String),
  traceId: Schema.String,
  build: Schema.String,
  _tag: Schema.String,
  body: Schema.String,
});
type EntryRow = typeof EntryRow.Type;
const decodeEntries = Schema.decodeUnknownSync(Schema.Array(EntryRow));

class CallFailed extends Schema.TaggedError<CallFailed>()("CallFailed", { cause: Schema.Defect() }) {}

type Episode = {
  readonly kind: string;
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly note: string;
};

type TableBytes = { readonly tbl: string; readonly rows: number; readonly bytes: number; readonly largest: number };

type Raw = {
  readonly meta: Record<string, unknown>;
  readonly load: { readonly from: number; readonly to: number };
  readonly files: ReadonlyArray<{
    readonly file: string;
    readonly location: "project" | "process";
    readonly name: string | null;
    readonly before: ReadonlyArray<{ readonly tbl: string; readonly rows: number }>;
  }>;
  readonly episodes: ReadonlyArray<Episode>;
  readonly ops: ReadonlyArray<{
    readonly at: number;
    readonly client: string;
    readonly name: string;
    readonly type: string;
    readonly ms: number;
    readonly answer: string;
  }>;
  /** Each time a file's `m_log` grew: the poll's clock and the newest row number it saw. */
  readonly polls: ReadonlyArray<{ readonly at: number; readonly file: string; readonly n: number }>;
  readonly bytes: ReadonlyArray<{
    readonly at: number;
    readonly file: string;
    readonly pages: number;
    readonly tables: ReadonlyArray<TableBytes>;
  }>;
  readonly entries: ReadonlyArray<EntryRow>;
  readonly changes: ReadonlyArray<{
    readonly file: string;
    readonly n: number;
    readonly tbl: string;
    readonly op: string;
    readonly k: string;
  }>;
  readonly calls: ReadonlyArray<{ readonly file: string; readonly piece: string; readonly at: number }>;
  readonly sizes: ReadonlyArray<{ readonly file: string; readonly at: number; readonly bytes: number }>;
  readonly descriptors: ReadonlyArray<{ readonly process: string; readonly bytes: number }>;
};

// ---------------------------------------------------------------------------------------------
// A signed client, as worker-supervision.test.ts builds one

const field = (value: Buffer | string) => {
  const body = Buffer.from(value);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ format: "jwk" }).x ?? "";
  const bytes = Buffer.from(raw, "base64url");
  const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw,
    line: `ssh-ed25519 ${blob.toString("base64")}`,
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
      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, pair.privateKey))])),
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
  params: Schema.optionalKey(Schema.Any),
  result: Schema.optionalKey(Schema.Any),
  error: Schema.optionalKey(Schema.Any),
});
type Frame = typeof Frame.Type;
const decodeFrame = Schema.decodeUnknownSync(Schema.fromJsonString(Frame));

/** One WebSocket client at the door, admitted by a signed hello, closed with the scope. */
const wire = Effect.fnUntraced(function* (url: string, key: ReturnType<typeof identity>, tab: string) {
  const waiting = new Map<number, (frame: Frame) => void>();
  let challenged: ((frame: Frame) => void) | undefined;
  let early: Frame | undefined;
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const made = new WebSocket(`${url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`);
      made.addEventListener("message", (event) => {
        if (event.data === "pong") {
          return;
        }

        const frame = decodeFrame(String(event.data));

        if (frame.method === "challenge") {
          early = frame;
          challenged?.(frame);
        } else if (frame.id !== undefined) {
          waiting.get(frame.id)?.(frame);
          waiting.delete(frame.id);
        }
      });
      return made;
    }),
    (held) => Effect.sync(() => held.close()),
  );
  let serial = 0;
  const call = (method: string, params: unknown, wait = 60) =>
    Effect.callback<Frame>((resume) => {
      const id = ++serial;
      waiting.set(id, (frame) => resume(Effect.succeed(frame)));
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    }).pipe(
      Effect.timeoutOrElse({
        duration: `${wait} seconds`,
        orElse: () => Effect.succeed<Frame>({ error: { data: { reason: "no_answer" } } }),
      }),
    );
  const first = yield* Effect.callback<Frame>((resume) => {
    if (early === undefined) {
      challenged = (frame) => resume(Effect.succeed(frame));
    } else {
      resume(Effect.succeed(early));
    }
  }).pipe(Effect.timeout("30 seconds"), Effect.orDie);
  const nonce: string = first.params.nonce;
  const hello = yield* call("initialize", {
    versions: [1],
    has: ["seal"],
    ping: "30s",
    key: key.raw,
    tab,
    nonce,
    platform: "headless",
    os: "linux",
    sentAt: SENT,
    signed: key.proof(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
  });

  if (hello.error !== undefined) {
    return yield* Effect.die(`the hello on tab ${tab} was refused: ${JSON.stringify(hello.error)}`);
  }

  return { tab, call };
});

type Client = Effect.Success<ReturnType<typeof wire>>;

// A program that throws on "throw", counts on "inc" and keeps the text "grow" hands it, so its saved
// checkpoint can be made large. worker-supervision.test.ts's fixture, with `grow` added.
const poisonSource = [
  'import {Machine} from "@demlik/tea/effect";',
  'import {Schema} from "effect";',
  "const Model = Schema.Struct({count: Schema.Int, text: Schema.String});",
  'const Msg = Schema.Union([Schema.Struct({type: Schema.Literal("throw")}), Schema.Struct({type: Schema.Literal("inc")}), Schema.Struct({type: Schema.Literal("grow"), text: Schema.String})]);',
  'const machine = Machine.make({model: Model, msg: Msg, cmds: [], init: (loaded) => [loaded ?? {count: 0, text: ""}, []], update: {throw: () => {throw new TypeError("measured failure");}, inc: (s) => [{...s, count: s.count + 1}, []], grow: (s, m) => [{...s, text: s.text + m.text}, []]}});',
  `export const program = {name: ${JSON.stringify(POISON)}, maxDeliveries: 3, machine, state: {v: 1, schema: Model, upgrades: []}, msg: Msg, view: {data: Schema.Struct({count: Schema.Int, size: Schema.Int}), select: (s) => ({count: s.count, size: s.text.length})}, refuse: () => null, inputs: {throw: {_tag: "write", schema: Msg, description: "Fail", personOnly: false}, inc: {_tag: "write", schema: Msg, description: "Count", personOnly: false}, grow: {_tag: "write", schema: Msg, description: "Grow", personOnly: false}}, outputs: {}, writes: {}, wake: () => null};`,
].join("\n");

// ---------------------------------------------------------------------------------------------
// Reading the objects' SQLite files from outside

/** Tables whose rows are telemetry or the platform's own: never counted as a write. */
const SKIPPED = /^(spans|content|rolled|measurements|aggregated|summary|sizes|sums|archived|unsent|parts|m_log)$/;
const PLATFORM = /^(_cf_|sqlite_)/;

const tablesIn = (db: DatabaseSync) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => String(row.name));

type Found = { readonly file: string; readonly location: "project" | "process" };

/** Every Project and Process object file under the home. */
const objectFiles = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const found: Array<Found> = [];

  for (const location of ["project", "process"] as const) {
    const folder = path.join(home, ".alchemy/local", `${PROJECT}-${location === "project" ? "Project" : "Process"}`);

    if (!(yield* fs.exists(folder))) {
      continue;
    }

    for (const name of yield* fs.readDirectory(folder)) {
      if (/^[0-9a-f]{64}\.sqlite$/.test(name)) {
        found.push({ file: path.join(folder, name), location });
      }
    }
  }

  return found;
});

/**
 * Adds the side table and its triggers to one object file. Run only while nothing writes to that object:
 * the platform's connection is not built to wait for a second writer. Answers the rows each counted
 * table already held, which are the writes that came before the triggers.
 */
const instrument = (file: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => new DatabaseSync(file, { timeout: 5000 })),
    (db) =>
      Effect.sync(() => {
        const counted = tablesIn(db).filter((name) => !SKIPPED.test(name) && !PLATFORM.test(name) && name !== "rings");
        db.exec(
          "CREATE TABLE IF NOT EXISTS m_log (n INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, op TEXT NOT NULL, k TEXT NOT NULL)",
        );
        const before: Array<{ tbl: string; rows: number }> = [];

        for (const name of counted) {
          before.push({ tbl: name, rows: Number(db.prepare(`SELECT count(*) AS n FROM "${name}"`).get()?.n ?? 0) });

          // Entries are append-only and carry their own clock, so the final read counts them exactly.
          if (name === "entries") {
            continue;
          }

          const columns = db.prepare(`PRAGMA table_info("${name}")`).all();
          const keys = columns
            .filter((c) => Number(c.pk) > 0)
            .sort((a, b) => Number(a.pk) - Number(b.pk))
            .map((c) => String(c.name));
          const rest = columns.filter((c) => Number(c.pk) === 0).map((c) => String(c.name));
          const key = (row: string) =>
            keys.length === 0 ? "''" : keys.map((c) => `${row}."${c}"`).join(" || '|' || ");
          const log = (op: string, row: string) =>
            `BEGIN INSERT INTO m_log (tbl, op, k) VALUES ('${name}', '${op}', ${key(row)}); END`;
          db.exec(`CREATE TRIGGER IF NOT EXISTS "m_i_${name}" AFTER INSERT ON "${name}" ${log("i", "NEW")}`);
          db.exec(`CREATE TRIGGER IF NOT EXISTS "m_d_${name}" AFTER DELETE ON "${name}" ${log("d", "OLD")}`);

          if (rest.length > 0) {
            const changed = rest.map((c) => `OLD."${c}" IS NOT NEW."${c}"`).join(" OR ");
            db.exec(
              `CREATE TRIGGER IF NOT EXISTS "m_u_${name}" AFTER UPDATE ON "${name}" WHEN ${changed} ${log("u", "NEW")}`,
            );
          }
        }

        return before;
      }),
    (db) => Effect.sync(() => db.close()),
  );

/** UTF-8 bytes of one column in SQL: text and blobs by length, integers as decimal text. */
const size = (column: string, integer = false) =>
  integer ? `length(CAST("${column}" AS TEXT))` : `length(CAST("${column}" AS BLOB))`;

/** The live rows the plan's recovery account owns, per table, and how to size one row. */
const SIZED: Readonly<Record<string, { readonly row: string; readonly where?: string }>> = {
  process_recovery: { row: `${size("name")} + ${size("value")}` },
  process_receipts: { row: `${size("name")} + ${size("letter")} + ${size("value")}` },
  process_state: { row: `${size("process")} + ${size("checkpoint")}` },
  process_letters: { row: `${size("process")} + ${size("id")} + ${size("rev", true)} + ${size("pos", true)}` },
  process_activity: { row: `${size("process")} + ${size("activity")}` },
  process_replies: { row: `${size("name")} + ${size("id")} + ${size("value")}` },
  _cf_KV: { row: `${size("key")} + ${size("value")}` },
  dev_descriptors: { row: `${size("process")} + ${size("value")} + ${size("pending", true)}` },
  gateway_ended: { row: size("process") },
  gateway_sessions: { row: `${size("parent")} + ${size("saved")}` },
  gateway_bindings: { row: `${size("id")} + coalesce(${size("letter")}, 0) + ${size("value")}` },
  m_log: { row: `${size("n", true)} + ${size("tbl")} + ${size("op")} + ${size("k")}` },
};

const sized = (db: DatabaseSync): ReadonlyArray<TableBytes> => {
  const have = new Set(tablesIn(db));
  return Object.entries(SIZED)
    .filter(([name]) => have.has(name))
    .map(([name, { row }]) => {
      const found = db
        .prepare(
          `SELECT count(*) AS n, coalesce(sum(${row}), 0) AS bytes, coalesce(max(${row}), 0) AS largest FROM "${name}"`,
        )
        .get();
      return {
        tbl: name,
        rows: Number(found?.n ?? 0),
        bytes: Number(found?.bytes ?? 0),
        largest: Number(found?.largest ?? 0),
      };
    });
};

const pages = (db: DatabaseSync) =>
  Number(db.prepare("PRAGMA page_count").get()?.page_count ?? 0) *
  Number(db.prepare("PRAGMA page_size").get()?.page_size ?? 0);

// ---------------------------------------------------------------------------------------------
// The run

type Settings = {
  readonly out: string;
  readonly steady: number;
  readonly gap: number;
  readonly rounds: number;
  readonly burst: number;
  /** A short check of the large-checkpoint part alone. */
  readonly largeOnly: boolean;
  /** Seconds to wait for a restart in the large-checkpoint part. */
  readonly wait: number;
};

const until = <A>(label: string, look: Effect.Effect<A>, done: (value: A) => boolean, ms = 30_000) =>
  Effect.gen(function* () {
    const end = (yield* Clock.currentTimeMillis) + ms;

    while (true) {
      const value = yield* look;

      if (done(value)) {
        return value;
      }

      if ((yield* Clock.currentTimeMillis) > end) {
        return yield* Effect.die(`${label}: not seen in ${ms} ms; last ${JSON.stringify(value)?.slice(0, 400)}`);
      }

      yield* Effect.sleep("50 millis");
    }
  });

// Names stay inside the checklist's 80-character wall. No astral characters: a cut may not split one.
const WORDS = [
  "süt 牛奶",
  "ekmek パン",
  "çay чай",
  "peynir τυρί",
  "yumurta 卵",
  "zeytin زيتون",
  "kağıt 紙",
  "şeker 설탕",
];

const long = (seed: string, most: number) => `${seed} ${"ğüşıöç漢字かなκόσμος".repeat(20)}`.slice(0, most);

const run = Effect.fnUntraced(function* (settings: Settings) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // A short home: a socket path has a 103-byte limit.
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "p34m-" });
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = { home: process.env.FABRIKA_HOME, alchemy: process.env.ALCHEMY_HOME };
      process.env.FABRIKA_HOME = home;
      process.env.DO_NOT_TRACK = "1";
      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of [
          ["FABRIKA_HOME", previous.home],
          ["ALCHEMY_HOME", previous.alchemy],
        ] as const) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }),
  );
  const root = path.resolve(import.meta.dirname, "../..");
  const app = path.join(root, "next/apps/fabrika");
  yield* fs.symlink(path.join(app, "node_modules"), path.join(home, "node_modules"));
  yield* fs.writeFileString(path.join(home, "poison.ts"), poisonSource);
  yield* fs.writeFileString(
    path.join(home, "checklist.ts"),
    'export { checklist as program } from "@kampus/checklist";',
  );
  const built = yield* build({
    out: path.join(home, "dist"),
    programs: { [POISON]: path.join(home, "poison.ts"), [CHECKLIST]: path.join(home, "checklist.ts") },
  });
  const hash = (program: string) => built.programs[program]?.hash ?? "missing";
  const key = identity();
  // Held until the scope closes, after the instance that binds it (finalizers run in reverse).
  const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const instance = yield* localInstance(built, {
    home,
    name: PROJECT,
    person: PERSON,
    founder: key.line,
    window: key.raw,
    port: port.port,
  });
  const from = {
    by: key.fingerprint,
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: null,
    traceId: TRACE,
    build: built.build,
  };
  // The private local capability's calls, as the tests reach them. A failed call answers undefined.
  const trusted = (target: object, method: string, ...args: ReadonlyArray<unknown>) =>
    Effect.sync(() => trustedCalls.set(method, (trustedCalls.get(method) ?? 0) + 1)).pipe(
      Effect.andThen(trustedCall(target, method, ...args)),
    );
  /** How many trusted calls this run made, by method. */
  const trustedCalls = new Map<string, number>();
  const trustedCall = (target: object, method: string, ...args: ReadonlyArray<unknown>) =>
    Effect.tryPromise({
      // edge: the local instance's binding calls return Promises; this line is the one bridge
      try: (): Promise<any> => Reflect.get(target, method)(...args),
      catch: (cause) => new CallFailed({ cause }),
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const cause: unknown = error.cause;
          const reason = Predicate.hasProperty(cause, "reason") ? ` reason ${String(cause.reason)}` : "";
          const under = Predicate.hasProperty(cause, "cause") ? cause.cause : undefined;
          const code =
            Predicate.hasProperty(under, "cause") && Predicate.hasProperty(under.cause, "code")
              ? ` code ${String(under.cause.code)}`
              : "";
          const inner = under === undefined ? "" : ` cause ${String(under).slice(0, 300)}${code}`;
          const text = `${method}: ${String(cause).slice(0, 200)}${reason}${inner}`;

          if (!failures.has(text)) {
            console.error(`trusted call failed: ${text}`);
          }

          failures.set(text, (failures.get(text) ?? 0) + 1);
          return undefined;
        }),
      ),
    );
  /** Why a trusted call failed, and how often: kept for the write-up, never retried here. */
  const failures = new Map<string, number>();
  const project = (method: string, ...args: ReadonlyArray<unknown>) =>
    trusted(instance.project(PROJECT), method, ...args);
  const object = (pid: string, method: string, ...args: ReadonlyArray<unknown>) =>
    trusted(instance.process(pid), method, ...args);
  const start = (name: string, program: string) =>
    project("start", { _tag: "first", id: `start-${name}`, name, code: { program, hash: hash(program) } }, from).pipe(
      Effect.flatMap((reply) =>
        typeof reply?.process === "string"
          ? Effect.succeed<string>(reply.process)
          : Effect.die(`start ${name} answered ${JSON.stringify(reply)}`),
      ),
    );

  const a = yield* wire(instance.url, key, "a");
  const b = yield* wire(instance.url, key, "b");
  // A third client only reads. Waiting on a fact polls the public door, as test 646 does, never the
  // trusted calls: the local control door stopped answering in every run that polled it.
  const watch = yield* wire(instance.url, key, "watch");
  const facts = (stream: string) =>
    watch
      .call("ledger.read", { stream, after: 0 })
      .pipe(Effect.map((frame): ReadonlyArray<any> => frame.result?.entries ?? []));
  const restarts = (name: string) =>
    facts(`processes/${name}`).pipe(Effect.map((rows) => rows.filter((row) => row._tag === "restarted")));
  const ops: Array<Raw["ops"][number]> = [];
  let letters = 0;
  const send = Effect.fnUntraced(function* (
    client: Client,
    name: string,
    pid: string,
    m: { readonly type: string },
    letter?: string,
  ) {
    const at = yield* Clock.currentTimeMillis;
    const reply = yield* client.call("process.send", {
      pid,
      letter: letter ?? `${client.tab}-${++letters}`,
      m,
      sentAt: SENT,
      seen: 0,
    });
    const answer: string = reply.result?._tag ?? reply.error?.data?.reason ?? "error";
    ops.push({ at, client: client.tab, name, type: m.type, ms: (yield* Clock.currentTimeMillis) - at, answer });
    return answer;
  });

  // Every name is started and warmed before anything is counted, so each object's tables exist and
  // the triggers go in while nothing writes.
  const names = {
    "checklist:a": CHECKLIST,
    "checklist:b": CHECKLIST,
    "checklist:big": CHECKLIST,
    "checklist:r": CHECKLIST,
    "poison:1": POISON,
    "poison:2": POISON,
    "poison:big": POISON,
  } as const;
  const pids = new Map<string, string>();

  for (const [name, program] of Object.entries(names)) {
    const pid = yield* start(name, program);
    pids.set(name, pid);
    const warm = program === CHECKLIST ? { type: "add", name: "ısınma" } : { type: "inc" };
    const answer = yield* send(a, name, pid, warm);

    if (answer !== "accepted") {
      return yield* Effect.die(`the warm-up letter on ${name} answered ${answer}`);
    }
  }

  // The checklist's first timer letter follows its add; let it land before the triggers go in.
  yield* Effect.sleep("3 seconds");
  const found = yield* objectFiles(home);
  const handles = yield* Effect.acquireRelease(
    Effect.sync(() => new Map<string, DatabaseSync>()),
    (held) =>
      Effect.sync(() => {
        for (const db of held.values()) {
          db.close();
        }
      }),
  );
  const files: Array<Raw["files"][number]> = [];

  for (const { file, location } of found) {
    const db = new DatabaseSync(file, { readOnly: true });
    handles.set(file, db);
    const tables = new Set(tablesIn(db));

    // An object that never ran a program step (the built-in counter's) has no recovery table yet.
    if (location === "process" && !tables.has("process_recovery")) {
      files.push({ file: path.relative(home, file), location, name: null, before: [] });
      continue;
    }

    const name =
      location === "process" ? String(db.prepare("SELECT name FROM process_recovery").get()?.name ?? "") : null;
    files.push({ file: path.relative(home, file), location, name, before: yield* instrument(file) });
  }

  const fileFor = (name: string) => {
    const row = files.find((f) => f.name === name);
    return row === undefined ? undefined : handles.get(path.join(home, row.file));
  };
  const journal = (name: string) =>
    Effect.sync((): { readonly _tag?: string; readonly process?: string } => {
      const value = fileFor(name)?.prepare("SELECT value FROM process_recovery").get()?.value;
      return typeof value === "string" ? (JSON.parse(value).journal ?? {}) : {};
    });

  // The sampler. Every 100 ms: how far each file's change log has grown. Every 500 ms: live bytes.
  const polls: Array<Raw["polls"][number]> = [];
  const bytes: Array<Raw["bytes"][number]> = [];
  const seen = new Map<string, number>();
  let ticks = 0;
  const sample = Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    ticks++;

    for (const row of files) {
      const db = handles.get(path.join(home, row.file));

      if (db === undefined || (row.name === null && row.location === "process")) {
        continue;
      }

      const n = Number(db.prepare("SELECT coalesce(max(n), 0) AS n FROM m_log").get()?.n ?? 0);

      if (n !== (seen.get(row.file) ?? 0)) {
        seen.set(row.file, n);
        polls.push({ at, file: row.file, n });
      }

      if (ticks % 5 === 1) {
        bytes.push({ at, file: row.file, pages: pages(db), tables: sized(db) });
      }
    }
  });
  const sampler = yield* Effect.forkChild(sample.pipe(Effect.andThen(Effect.sleep("100 millis")), Effect.forever));

  /** The pids of every workerd whose parent chain reaches this process: a new pid means it was restarted. */
  const workerds = Effect.gen(function* () {
    const ps = yield* ChildProcess.make("ps", ["-axo", "pid=,ppid=,comm="]);
    const rows = (yield* ps.stdout.pipe(Stream.decodeText(), Stream.mkString))
      .split("\n")
      .map((row) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row))
      .flatMap((m) => (m === null ? [] : [{ pid: Number(m[1]), parent: Number(m[2]), command: m[3] ?? "" }]));
    const mine = new Set([process.pid]);

    for (let grew = true; grew;) {
      grew = false;

      for (const row of rows) {
        if (mine.has(row.parent) && !mine.has(row.pid)) {
          mine.add(row.pid);
          grew = true;
        }
      }
    }

    return rows.filter((row) => mine.has(row.pid) && /\/workerd$/.test(row.command)).map((row) => row.pid);
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed((): ReadonlyArray<number> => []),
  );
  const workerdAtStart = yield* workerds;

  // --- Load -----------------------------------------------------------------------------------
  const loadFrom = yield* Clock.currentTimeMillis;
  const episodes: Array<Episode> = [];
  /** One recovery episode on a name nothing else is writing to: its window, and a note on how it ended. */
  const episode = (kind: string, name: string, work: Effect.Effect<string>) =>
    Effect.gen(function* () {
      const began = yield* Clock.currentTimeMillis;
      const exit = yield* Effect.exit(work);
      // The journal's last save follows the lifecycle facts; wait for it, then for one sampler tick.
      yield* until(`${kind} on ${name}: journal idle`, journal(name), (j) => j._tag === "idle", 20_000).pipe(
        Effect.exit,
      );
      yield* Effect.sleep("400 millis");
      const note = exit._tag === "Success" ? exit.value : `FAILED: ${String(exit.cause).slice(0, 300)}`;
      episodes.push({ kind, name, from: began, to: yield* Clock.currentTimeMillis, note });
      yield* Console.log(`episode ${kind} on ${name}: ${note}`);
    });
  /** Waits for the name's next automatic or asked restart, and answers the successor. */
  const restarted = (name: string, count: number, ms = 30_000) =>
    Effect.gen(function* () {
      const rows = yield* until(`${count} restarts on ${name}`, restarts(name), (found) => found.length >= count, ms);
      const next: string = rows[count - 1].body.process;
      // Live means the name's saved journal is idle on the successor: read from its own file.
      yield* until(`${next} live`, journal(name), (j) => j._tag === "idle" && j.process === next, ms);
      pids.set(name, next);
      return next;
    });
  const pid = (name: string) => pids.get(name) ?? "missing";

  // Steady: two clients, each one checklist input every `gap` ms, alternating two names.
  const steady = (client: Client) =>
    Effect.gen(function* () {
      const end = loadFrom + settings.steady * 1000;
      let n = 0;

      // It stops only at the end of a whole 12-input round, so both lists end empty. An item left in
      // state `new` keeps today's alarm firing without rest (see the finding this run wrote down).
      while ((yield* Clock.currentTimeMillis) < end || n % 12 !== 0) {
        const began = yield* Clock.currentTimeMillis;
        const name = n % 2 === 0 ? "checklist:a" : "checklist:b";
        const round = Math.floor(n / 12);
        const item = `${client.tab}${round} ${WORDS[round % WORDS.length]}`;
        const moved = `${item} ✓`;
        const step = Math.floor(n / 2) % 6;
        const m =
          step === 0
            ? { type: "add", name: item }
            : step === 1
              ? { type: "rename", name: item, to: moved }
              : step === 2
                ? { type: "check", name: moved, note: `tamam, görüldü: ${WORDS[(round + 3) % WORDS.length]}` }
                : step === 3
                  ? { type: "uncheck", name: moved }
                  : step === 4
                    ? { type: "check", name: moved }
                    : { type: "remove", name: moved };
        // Each name gets its own item, so the two names' cycles do not meet.
        yield* send(client, name, pid(name), {
          ...m,
          name: `${m.name} ${name.at(-1)}`,
          ...("to" in m ? { to: `${m.to} ${name.at(-1)}` } : {}),
        });
        n++;
        yield* Effect.sleep(`${Math.max(0, settings.gap - ((yield* Clock.currentTimeMillis) - began))} millis`);
      }
    });

  // Bursts: both clients send `burst` inputs back to back at one name, then rest. The items carry long
  // non-ASCII names and notes and are never removed, so this also grows the large saved checkpoint.
  const bursts = (client: Client) =>
    Effect.gen(function* () {
      yield* Effect.sleep(`${Math.round(settings.steady * 0.55)} seconds`);

      for (let round = 0; round < settings.rounds; round++) {
        for (let n = 0; n < settings.burst; n += 2) {
          const item = long(`${client.tab}${round}-${n}`, 80);
          yield* send(client, "checklist:big", pid("checklist:big"), { type: "add", name: item });
          yield* send(client, "checklist:big", pid("checklist:big"), {
            type: "check",
            name: item,
            note: long("not", 256),
          });
        }

        yield* Effect.sleep("8 seconds");
      }
    });

  const recoveries = Effect.gen(function* () {
    yield* Effect.sleep("15 seconds");

    // A poison letter, from its first throw to the dead letter and a healthy successor.
    let count = 0;

    for (let attempt = 1; attempt <= 5; attempt++) {
      let answer = "";
      yield* episode(
        attempt === 1 ? "fresh throw" : "saved-letter throw",
        "poison:1",
        Effect.gen(function* () {
          const failing = pid("poison:1");
          answer = yield* send(a, "poison:1", failing, { type: "throw" }, "poison-letter");
          const next = yield* restarted("poison:1", ++count);
          const dead = (yield* facts(`${failing}/dead`)).length;
          return `the door answered ${answer}; successor ${next.slice(-6)}; restarts ${count}; dead rows on the failing process ${dead}`;
        }),
      );
      yield* Effect.sleep("7 seconds");

      if (answer === "dead") {
        const last = episodes.pop();

        if (last !== undefined) {
          episodes.push({ ...last, kind: "poison-letter completion: saved-letter throw at the limit" });
        }

        break;
      }
    }

    yield* episode(
      "duplicate: dead letter resent twice",
      "poison:1",
      Effect.gen(function* () {
        const one = yield* send(a, "poison:1", pid("poison:1"), { type: "throw" }, "poison-letter");
        const two = yield* send(b, "poison:1", pid("poison:1"), { type: "throw" }, "poison-letter");
        yield* Effect.sleep("1500 millis");
        return `answers ${one}, ${two}; restarts ${(yield* restarts("poison:1")).length}`;
      }),
    );
    // Outside any episode: the successor takes ordinary work again.
    const healthy = yield* send(a, "poison:1", pid("poison:1"), { type: "inc" }, "after-poison");
    yield* Console.log(`a healthy letter after the poison letter answered ${healthy}`);

    // An interruption: a saved stepping marker, then the platform's abort, as test 402's third case.
    const interrupt = (name: string, program: string, nth: number) =>
      episode(
        "interruption",
        name,
        Effect.gen(function* () {
          const old = pid(name);
          yield* object(old, "activity", {
            _tag: "stepping",
            process: old,
            letter: `cut-${nth}`,
            build: hash(program),
          });
          yield* object(old, "abort");
          yield* a.call("view.open", { pid: old });
          const next = yield* restarted(name, nth);
          return `successor ${next.slice(-6)}; restarts ${nth}`;
        }),
      );
    yield* interrupt("poison:2", POISON, 1);
    yield* episode(
      "duplicate: abort again, no marker",
      "poison:2",
      Effect.gen(function* () {
        yield* object(pid("poison:2"), "abort");
        yield* a.call("view.open", { pid: pid("poison:2") });
        yield* Effect.sleep("1500 millis");
        return `restarts ${(yield* restarts("poison:2")).length}`;
      }),
    );
    yield* Effect.sleep("6 seconds");

    // A person restart of a checklist with saved non-ASCII items, then the same request again.
    for (const [n, word] of WORDS.entries()) {
      yield* send(b, "checklist:r", pid("checklist:r"), { type: "add", name: `${word} ${n}` });
    }

    yield* Effect.sleep("2 seconds");
    const first = pid("checklist:r");
    const request = { id: "restart-r-1", build: hash(CHECKLIST) };
    yield* episode(
      "person restart",
      "checklist:r",
      Effect.gen(function* () {
        yield* object(first, "restart", request);
        const next = yield* restarted("checklist:r", 1);
        return `successor ${next.slice(-6)}; restarts 1`;
      }),
    );
    yield* episode(
      "duplicate: same restart request twice",
      "checklist:r",
      Effect.gen(function* () {
        yield* object(pid("checklist:r"), "restart", request);
        yield* object(first, "restart", request);
        yield* Effect.sleep("1500 millis");
        return `restarts ${(yield* restarts("checklist:r")).length}`;
      }),
    );
    yield* Effect.sleep("6 seconds");
    yield* interrupt("checklist:r", CHECKLIST, 2);

    // Ordinary work again, outside any episode: checking every item leaves none in state `new`.
    for (const [n, word] of WORDS.entries()) {
      yield* send(b, "checklist:r", pid("checklist:r"), { type: "check", name: `${word} ${n}` });
    }

    yield* send(b, "checklist:r", pid("checklist:r"), { type: "check", name: "ısınma" });
  });

  // After the bursts: recovery with a large saved checkpoint, on both programs.
  const large = Effect.gen(function* () {
    for (let n = 0; n < 3; n++) {
      // 100,000 two-byte characters per letter.
      yield* send(a, "poison:big", pid("poison:big"), { type: "grow", text: "ç".repeat(100_000) });
    }

    yield* Effect.sleep("1 seconds");
    yield* episode(
      "fresh throw, large checkpoint",
      "poison:big",
      Effect.gen(function* () {
        const answer = yield* send(a, "poison:big", pid("poison:big"), { type: "throw" }, "big-throw");
        const next = yield* restarted("poison:big", 1, settings.wait * 1000);
        return `the door answered ${answer}; successor ${next.slice(-6)}`;
      }),
    );
    yield* Effect.sleep("6 seconds");
    yield* episode(
      "person restart, large checkpoint",
      "poison:big",
      Effect.gen(function* () {
        yield* object(pid("poison:big"), "restart", { id: "restart-big-1", build: hash(POISON) });
        const next = yield* restarted("poison:big", 2, settings.wait * 1000);
        return `successor ${next.slice(-6)}`;
      }),
    );
    yield* episode(
      "person restart, large checklist",
      "checklist:big",
      Effect.gen(function* () {
        yield* object(pid("checklist:big"), "restart", { id: "restart-list-1", build: hash(CHECKLIST) });
        const next = yield* restarted("checklist:big", 1, settings.wait * 2000);
        return `successor ${next.slice(-6)}`;
      }),
    );
  });

  if (!settings.largeOnly) {
    const fibers = [
      yield* Effect.forkChild(steady(a)),
      yield* Effect.forkChild(Effect.sleep(`${Math.round(settings.gap / 2)} millis`).pipe(Effect.andThen(steady(b)))),
      yield* Effect.forkChild(bursts(a)),
      yield* Effect.forkChild(bursts(b)),
      yield* Effect.forkChild(recoveries),
    ];
    yield* Fiber.joinAll(fibers);
  }

  // Every list is now empty or fully checked, so no alarm loop runs under the large-checkpoint part.
  for (const name of ["checklist:a", "checklist:b", "checklist:big"]) {
    yield* send(a, name, pid(name), { type: "check", name: "ısınma" });
  }

  yield* Effect.sleep("5 seconds");
  const doorBeforeLarge = (yield* project("info")) !== undefined;
  const workerdBeforeLarge = yield* workerds;
  yield* large;
  const workerdAfterLarge = yield* workerds;
  yield* Effect.sleep("4 seconds");
  yield* sample;
  const loadTo = yield* Clock.currentTimeMillis;
  yield* Fiber.interrupt(sampler);

  // --- Collect --------------------------------------------------------------------------------
  const entries: Array<EntryRow> = [];
  const changes: Array<Raw["changes"][number]> = [];
  const calls: Array<Raw["calls"][number]> = [];
  const sizes: Array<Raw["sizes"][number]> = [];
  const descriptors: Array<Raw["descriptors"][number]> = [];

  for (const row of files) {
    const db = handles.get(path.join(home, row.file));

    if (db === undefined) {
      continue;
    }

    const tables = new Set(tablesIn(db));

    if (tables.has("entries")) {
      entries.push(...decodeEntries(db.prepare("SELECT * FROM entries ORDER BY rev").all()));
    }

    if (tables.has("m_log")) {
      for (const c of db.prepare("SELECT n, tbl, op, k FROM m_log ORDER BY n").all()) {
        changes.push({ file: row.file, n: Number(c.n), tbl: String(c.tbl), op: String(c.op), k: String(c.k) });
      }
    }

    if (tables.has("measurements")) {
      for (const c of db
        .prepare(
          "SELECT piece, at FROM measurements WHERE piece LIKE 'process.%' OR piece LIKE 'recovery.%' OR piece LIKE 'replies.%' OR piece LIKE 'runner.%' ORDER BY at",
        )
        .all()) {
        calls.push({ file: row.file, piece: String(c.piece), at: Number(c.at) });
      }
    }

    if (tables.has("sizes")) {
      for (const c of db.prepare("SELECT at, bytes FROM sizes").all()) {
        sizes.push({ file: row.file, at: Number(c.at), bytes: Number(c.bytes) });
      }
    }

    if (tables.has("dev_descriptors")) {
      for (const c of db.prepare(`SELECT process, ${SIZED.dev_descriptors?.row} AS bytes FROM dev_descriptors`).all()) {
        descriptors.push({ process: String(c.process), bytes: Number(c.bytes) });
      }
    }
  }

  const version = (name: string) =>
    // Not path.join: workerd sits beside the runtime package's real folder, reached through its link.
    fs.readFileString(`${app}/node_modules/${name}/package.json`).pipe(
      Effect.map((text): string => JSON.parse(text).version),
      Effect.orElseSucceed(() => "unknown"),
    );
  const git = yield* ChildProcess.make("git", ["-C", root, "rev-parse", "HEAD"]);
  const commit = (yield* git.stdout.pipe(Stream.decodeText(), Stream.mkString)).trim();
  const raw: Raw = {
    meta: {
      commit,
      node: process.version,
      effect: yield* version("effect"),
      tea: yield* version("@demlik/tea"),
      alchemy: yield* version("alchemy"),
      runtime: yield* version("@alchemy.run/cloudflare-runtime"),
      workerd: yield* version("@alchemy.run/cloudflare-runtime/../../workerd"),
      platform: `${process.platform} ${process.arch}`,
      trustedCalls: Object.fromEntries(trustedCalls),
      trustedCallFailures: Object.fromEntries(failures),
      doorAnsweredBeforeLarge: doorBeforeLarge,
      workerdPids: { atStart: workerdAtStart, beforeLarge: workerdBeforeLarge, afterLarge: workerdAfterLarge },
      settings: { ...settings, out: undefined },
      shape: {
        steady: `2 clients, one checklist input every ${settings.gap} ms each, alternating checklist:a and checklist:b, for ${settings.steady} s`,
        bursts: `${settings.rounds} rounds; in each, 2 clients send ${settings.burst} inputs back to back to checklist:big, then rest 8 s`,
        names,
      },
    },
    load: { from: loadFrom, to: loadTo },
    files,
    episodes,
    ops,
    polls,
    bytes,
    entries,
    changes,
    calls,
    sizes,
    descriptors,
  };
  yield* fs.makeDirectory(settings.out, { recursive: true });
  yield* fs.writeFileString(path.join(settings.out, "raw.json"), JSON.stringify(raw));
  return raw;
}, Effect.scoped);

// ---------------------------------------------------------------------------------------------
// Analysis: pure, over the saved raw file

const encoder = new TextEncoder();
const utf8 = (text: string) => encoder.encode(text).length;

/** The whole committed Entry as JSON, in the Entry schema's field order (ledger/Log.ts). */
const entryBytes = (e: EntryRow) =>
  utf8(
    JSON.stringify({
      id: e.id,
      stream: e.stream,
      pos: e.pos,
      rev: e.rev,
      arrivedAt: e.arrivedAt,
      by: e.by,
      for: e.for,
      sentAt: e.sentAt,
      seen: e.seen,
      parent: e.parent,
      traceId: e.traceId,
      build: e.build,
      _tag: e._tag,
      body: JSON.parse(e.body),
    }),
  );

/** Experiment 276's nearest-rank rule. An empty sample has no percentile. */
const stats = (values: ReadonlyArray<number>) => {
  const sorted = [...values].sort((x, y) => x - y);
  const at = (p: number) => sorted[Math.ceil(p * sorted.length) - 1];
  return sorted.length === 0
    ? { samples: 0, p50: null, p95: null, p99: null, max: null }
    : {
        samples: sorted.length,
        p50: at(0.5) ?? null,
        p95: at(0.95) ?? null,
        p99: at(0.99) ?? null,
        max: sorted.at(-1) ?? null,
      };
};

/** Counts in `(end - 60,000, end]` for each whole-minute window ending inside `[from, to]`, one a second. */
const rolling = (times: ReadonlyArray<number>, from: number, to: number) => {
  const sorted = [...times].sort((x, y) => x - y);
  const counts: Array<number> = [];
  let low = 0;
  let high = 0;

  for (let end = from + MINUTE; end <= to; end += 1000) {
    while (high < sorted.length && (sorted[high] ?? 0) <= end) {
      high++;
    }

    while (low < sorted.length && (sorted[low] ?? 0) <= end - MINUTE) {
      low++;
    }

    counts.push(high - low);
  }

  return counts;
};

type Class = "program" | "recovery" | "admin" | "door";

const analyze = (raw: Raw) => {
  const program = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const firstStart = new Set<number>();
  const startedOn = new Set<string>();

  for (const e of raw.entries) {
    const body = JSON.parse(e.body);

    if (e._tag === "registered" && e.stream === "processes") {
      program.set(body.name, body.program);
    }

    if (e._tag === "started" && e.stream.startsWith("processes/")) {
      nameOf.set(body.process, body.name);

      if (!startedOn.has(e.stream)) {
        startedOn.add(e.stream);
        firstStart.add(e.rev);
      }
    }
  }

  /** Whose entry it is and which account the plan's table puts it on. */
  const place = (e: EntryRow): { readonly cls: Class; readonly name: string | null; readonly kind: string } => {
    const inbox = /^(.*)\/inbox$/.exec(e.stream);

    if (inbox !== null) {
      const name = inbox[1] ?? null;
      const m = JSON.parse(e.body).m;
      const timer = /^process_[^/]+\/due\//.test(e.id);
      const down = m !== null && typeof m === "object" && m._tag === "DOWN";
      return timer
        ? { cls: "recovery", name, kind: "inbox: runner's timer letter" }
        : down
          ? { cls: "recovery", name, kind: "inbox: DOWN letter" }
          : { cls: "program", name, kind: "inbox: a person's input" };
    }

    const life = /^processes\/(.*)$/.exec(e.stream);

    if (life !== null) {
      const name = life[1] ?? null;
      return firstStart.has(e.rev)
        ? { cls: "admin", name, kind: "lifecycle: first started" }
        : { cls: "recovery", name, kind: `lifecycle: ${e._tag}` };
    }

    if (e.stream === "processes") {
      return { cls: "admin", name: JSON.parse(e.body).name ?? null, kind: `processes: ${e._tag}` };
    }

    const own = /^(process_[^/]+)(\/dead)?$/.exec(e.stream);

    if (own !== null) {
      return {
        cls: "recovery",
        name: nameOf.get(own[1] ?? "") ?? null,
        kind: own[2] ? "dead letter" : `record: ${e._tag}`,
      };
    }

    if (e.stream === "gateway/inputs") {
      return { cls: "door", name: nameOf.get(JSON.parse(e.body).target) ?? null, kind: "door: input envelope" };
    }

    return { cls: "door", name: null, kind: `door: ${e.stream} ${e._tag}` };
  };

  const placed = raw.entries.map((e) => ({ e, bytes: entryBytes(e), ...place(e) }));
  const { from, to } = raw.load;
  const inLoad = placed.filter((p) => p.e.arrivedAt >= from && p.e.arrivedAt <= to);
  const kinds = new Map<string, { count: number; bytes: number; cls: Class }>();

  for (const p of inLoad) {
    const row = kinds.get(p.kind) ?? { count: 0, bytes: 0, cls: p.cls };
    row.count++;
    row.bytes += p.bytes;
    kinds.set(p.kind, row);
  }

  // --- Program writes per rolling minute, per program ---
  const programs = [...new Set(program.values())];
  const perProgram = (wide: boolean) =>
    programs.flatMap((name) => {
      const times = inLoad
        .filter(
          (p) =>
            p.name !== null &&
            program.get(p.name) === name &&
            (p.cls === "program" || (wide && p.kind === "door: input envelope")),
        )
        .map((p) => p.e.arrivedAt);
      return times.length === 0 ? [] : [{ program: name, total: times.length, windows: rolling(times, from, to) }];
    });
  const programWrites = (wide: boolean) => {
    const each = perProgram(wide);
    return {
      pooled: stats(each.flatMap((p) => p.windows)),
      programs: each.map((p) => ({ program: p.program, total: p.total, ...stats(p.windows) })),
    };
  };

  // --- Recovery writes, by storage location and registered name ---
  const fileName = new Map(raw.files.map((f) => [f.file, f]));
  // A change-log row's clock is the first poll that saw it: at most one sampler tick late.
  const pollsBy = new Map<string, Array<{ at: number; n: number }>>();

  for (const p of raw.polls) {
    pollsBy.set(p.file, [...(pollsBy.get(p.file) ?? []), { at: p.at, n: p.n }]);
  }

  const seenAt = (file: string, n: number) => (pollsBy.get(file) ?? []).find((p) => p.n >= n)?.at ?? to;
  type Write = { readonly at: number; readonly name: string; readonly kind: string };
  const processWrites: Array<Write> = [];
  const projectWrites: Array<Write> = [];
  const doorRows = new Map<string, number>();
  const firstPid = new Map<string, string>();

  for (const e of raw.entries) {
    if (firstStart.has(e.rev)) {
      const body = JSON.parse(e.body);
      firstPid.set(body.name, body.process);
    }
  }

  for (const c of raw.changes) {
    const file = fileName.get(c.file);
    const at = seenAt(c.file, c.n);

    if (file?.location === "process" && file.name !== null) {
      processWrites.push({ at, name: file.name, kind: `${c.tbl} ${c.op}` });
    } else if (c.tbl === "dev_descriptors" || c.tbl === "gateway_ended") {
      const name = nameOf.get(c.k);

      // A first process's descriptor is the start's own write; a successor's is recovery's.
      if (name !== undefined && !(c.tbl === "dev_descriptors" && firstPid.get(name) === c.k)) {
        projectWrites.push({ at, name, kind: `${c.tbl} ${c.op}` });
      }
    } else {
      doorRows.set(`${c.tbl} ${c.op}`, (doorRows.get(`${c.tbl} ${c.op}`) ?? 0) + 1);
    }
  }

  for (const c of raw.calls) {
    const file = fileName.get(c.file);

    if (c.piece === "process.activity" && file?.location === "process" && file.name !== null && c.at >= from) {
      processWrites.push({ at: c.at, name: file.name, kind: "activity marker put (_cf_KV)" });
    }
  }

  for (const p of inLoad) {
    if (p.cls === "recovery" && p.name !== null) {
      projectWrites.push({ at: p.e.arrivedAt, name: p.name, kind: `entry, ${p.kind}` });
    }
  }

  const names = [...program.keys()];
  const perMinute = (writes: ReadonlyArray<Write>) => {
    const each = names.flatMap((name) => {
      const times = writes.filter((w) => w.name === name && w.at >= from && w.at <= to).map((w) => w.at);
      return times.length === 0 ? [] : [{ name, total: times.length, windows: rolling(times, from, to) }];
    });
    return {
      pooled: stats(each.flatMap((n) => n.windows)),
      names: each.map((n) => ({ name: n.name, total: n.total, ...stats(n.windows) })),
    };
  };
  const byKind = (writes: ReadonlyArray<Write>) => {
    const counts = new Map<string, number>();

    for (const w of writes) {
      counts.set(w.kind, (counts.get(w.kind) ?? 0) + 1);
    }

    return Object.fromEntries([...counts].sort((x, y) => y[1] - x[1]));
  };

  // --- Live recovery bytes ---
  // Process: every sampled moment's live rows in the name's own object.
  const RECOVERY_TABLES = new Set([
    "process_recovery",
    "process_receipts",
    "process_state",
    "process_letters",
    "process_activity",
    "process_replies",
    "_cf_KV",
  ]);
  const processLive = raw.bytes.flatMap((sample) => {
    const file = fileName.get(sample.file);
    return file?.location === "process" && file.name !== null
      ? [
          {
            at: sample.at,
            name: file.name,
            bytes: sample.tables.filter((t) => RECOVERY_TABLES.has(t.tbl)).reduce((n, t) => n + t.bytes, 0),
            largest: Math.max(0, ...sample.tables.filter((t) => RECOVERY_TABLES.has(t.tbl)).map((t) => t.largest)),
            pages: sample.pages,
            log: sample.tables.find((t) => t.tbl === "m_log")?.bytes ?? 0,
          },
        ]
      : [];
  });
  // Project: the name's recovery entries so far, plus its successors' descriptors and ended rows.
  const descriptorBytes = new Map(raw.descriptors.map((d) => [d.process, d.bytes]));
  const projectGrowth = [
    ...placed
      .filter((p) => p.cls === "recovery" && p.name !== null)
      .map((p) => ({ at: p.e.arrivedAt, name: p.name ?? "", bytes: p.bytes })),
    ...raw.changes.flatMap((c) => {
      const name = nameOf.get(c.k);
      const file = fileName.get(c.file);

      if (file?.location !== "project" || name === undefined || c.op !== "i") {
        return [];
      }

      return c.tbl === "gateway_ended"
        ? [{ at: seenAt(c.file, c.n), name, bytes: utf8(c.k) }]
        : c.tbl === "dev_descriptors" && firstPid.get(name) !== c.k
          ? [{ at: seenAt(c.file, c.n), name, bytes: descriptorBytes.get(c.k) ?? 0 }]
          : [];
    }),
  ];
  const projectAt = (name: string, at: number) =>
    projectGrowth.filter((g) => g.name === name && g.at <= at).reduce((n, g) => n + g.bytes, 0);
  const sampleTimes = [...new Set(raw.bytes.map((s) => s.at))].sort((x, y) => x - y);
  const projectLive = names.flatMap((name) =>
    sampleTimes.map((at) => ({ at, name, bytes: projectAt(name, at) })).filter((s) => s.bytes > 0),
  );

  // --- Episodes ---
  // An episode's window already ends 400 ms after its journal went idle, four sampler ticks, so no pad:
  // ordinary work may follow at once.
  const PAD = 0;
  const windowed = (list: ReadonlyArray<Episode>, kind: string): Episode | undefined => {
    const [first] = list;
    const last = list.at(-1);
    return first === undefined || last === undefined
      ? undefined
      : { kind, name: first.name, from: first.from, to: last.to, note: `${list.length} episodes as one` };
  };
  const chain = windowed(
    raw.episodes.filter((e) => e.name === "poison:1" && !e.kind.startsWith("duplicate")),
    "poison letter, first throw to dead letter and successor",
  );
  const episodes = [...raw.episodes, ...(chain === undefined ? [] : [chain])].map((e) => {
    const inside = (w: Write) => w.name === e.name && w.at >= e.from && w.at <= e.to + PAD;
    const processIn = processWrites.filter(inside);
    const projectIn = projectWrites.filter(inside);
    const live = processLive.filter((s) => s.name === e.name && s.at >= e.from - 600 && s.at <= e.to + 600);
    const before = processLive.filter((s) => s.name === e.name && s.at < e.from).at(-1)?.bytes ?? 0;
    return {
      kind: e.kind,
      name: e.name,
      ms: e.to - e.from,
      note: e.note,
      failed: e.note.startsWith("FAILED"),
      duplicate: e.kind.startsWith("duplicate"),
      process: {
        writes: processIn.length,
        kinds: byKind(processIn),
        liveBytes: Math.max(0, ...live.map((s) => s.bytes)),
        liveBefore: before,
        largestRow: Math.max(0, ...live.map((s) => s.largest)),
      },
      project: {
        writes: projectIn.length,
        kinds: byKind(projectIn),
        liveBytes: projectAt(e.name, e.to + PAD),
        liveBefore: projectAt(e.name, e.from - 1),
      },
    };
  });
  const complete = episodes.filter((e) => !e.failed && !e.duplicate);
  const most = (values: ReadonlyArray<number>) => (values.length === 0 ? null : Math.max(...values));
  const largest = {
    process: {
      writes: most(complete.map((e) => e.process.writes)),
      bytes: most(complete.map((e) => e.process.liveBytes)),
    },
    project: {
      writes: most(complete.map((e) => e.project.writes)),
      bytes: most(complete.map((e) => e.project.liveBytes)),
    },
  };

  // --- Whole-object size ---
  const lastSample = new Map<string, Raw["bytes"][number]>();

  for (const s of raw.bytes) {
    lastSample.set(s.file, s);
  }

  const objects = [...lastSample.values()].map((s) => ({
    location: fileName.get(s.file)?.location,
    name: fileName.get(s.file)?.name ?? null,
    pagesBytes: s.pages,
    measurementLogBytes: s.tables.find((t) => t.tbl === "m_log")?.bytes ?? 0,
    productSizeRows: raw.sizes.filter((z) => z.file === s.file).map((z) => z.bytes),
  }));

  // --- The alarm loop: calls the Project object answered while a checklist item stayed `new` ---
  const lastOp = Math.max(from, ...raw.ops.map((o) => o.at + o.ms));
  const piece = (name: string, after = from, before = to) =>
    raw.calls.filter((c) => c.piece === name && c.at >= after && c.at <= before).length;
  const alarmLoop = {
    adds: raw.ops.filter((o) => o.type === "add").length,
    timerLetters: placed.filter((p) => p.kind === "inbox: runner's timer letter").length,
    dueCalls: piece("runner.due"),
    statusCalls: piece("process.status"),
    isLiveCalls: piece("process.isLive"),
    statusCallsPerMinute: stats(
      rolling(
        raw.calls.filter((c) => c.piece === "process.status").map((c) => c.at),
        from,
        to,
      ),
    ),
    afterTheLastInput: {
      seconds: Math.round((to - lastOp) / 1000),
      dueCalls: piece("runner.due", lastOp),
      statusCalls: piece("process.status", lastOp),
    },
  };

  // --- The plan's formulas ---
  const ten = (value: number | null) => (value === null ? null : Math.ceil(10 * value));
  const greater = (x: number | null, y: number | null) => (x === null || y === null ? null : Math.max(x, y));
  const strict = programWrites(false);
  const wide = programWrites(true);
  const processMinute = perMinute(processWrites);
  const projectMinute = perMinute(projectWrites);
  const processBytes = stats(processLive.map((s) => s.bytes));
  const projectBytes = stats(projectLive.map((s) => s.bytes));
  const entryStats = (cls: Class) => stats(inLoad.filter((p) => p.cls === cls).map((p) => p.bytes));

  return {
    meta: raw.meta,
    load: {
      ...raw.load,
      seconds: Math.round((to - from) / 1000),
      wholeMinuteWindowsPerSeries: Math.max(0, Math.floor((to - from - MINUTE) / 1000) + 1),
    },
    ops: {
      total: raw.ops.length,
      answers: Object.fromEntries(
        [...new Set(raw.ops.map((o) => o.answer))].map((x) => [x, raw.ops.filter((o) => o.answer === x).length]),
      ),
      perName: Object.fromEntries(
        [...new Set(raw.ops.map((o) => o.name))].map((n) => [n, raw.ops.filter((o) => o.name === n).length]),
      ),
      latencyMs: stats(raw.ops.map((o) => o.ms)),
    },
    entries: {
      total: raw.entries.length,
      inLoad: inLoad.length,
      kinds: Object.fromEntries([...kinds].sort((x, y) => y[1].count - x[1].count)),
      canonicalBytes: { program: entryStats("program"), recovery: entryStats("recovery"), door: entryStats("door") },
    },
    programWritesPerMinute: { strict, wide },
    recoveryWritesPerMinute: {
      process: { ...processMinute, kinds: byKind(processWrites.filter((w) => w.at >= from && w.at <= to)) },
      project: { ...projectMinute, kinds: byKind(projectWrites.filter((w) => w.at >= from && w.at <= to)) },
    },
    doorRowChangesNotCounted: Object.fromEntries(doorRows),
    alarmLoop,
    liveRecoveryBytes: { process: processBytes, project: projectBytes },
    episodes,
    largestEpisode: largest,
    objects,
    defaults: {
      "limits.writes, inbox entries only": { p99: strict.pooled.p99, value: ten(strict.pooled.p99) },
      "limits.writes, inbox entries plus the door's input envelope": {
        p99: wide.pooled.p99,
        value: ten(wide.pooled.p99),
      },
      "recovery writes, process": {
        p99: processMinute.pooled.p99,
        episode: largest.process.writes,
        value: ten(greater(processMinute.pooled.p99, largest.process.writes)),
      },
      "recovery writes, project": {
        p99: projectMinute.pooled.p99,
        episode: largest.project.writes,
        value: ten(greater(projectMinute.pooled.p99, largest.project.writes)),
      },
      "recovery bytes, process": {
        p99: processBytes.p99,
        episode: largest.process.bytes,
        value: ten(greater(processBytes.p99, largest.process.bytes)),
      },
      "recovery bytes, project": {
        p99: projectBytes.p99,
        episode: largest.project.bytes,
        value: ten(greater(projectBytes.p99, largest.project.bytes)),
      },
    },
    before: raw.files.map((f) => ({
      location: f.location,
      name: f.name,
      rowsBeforeTheTriggers: Object.fromEntries(f.before.map((b) => [b.tbl, b.rows])),
    })),
  };
};

// ---------------------------------------------------------------------------------------------
// The command

const stamp = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString().replace(/[:.]/g, "-"));

const measure = Command.make(
  "measure",
  {
    out: Flag.String("out").pipe(Flag.withDescription("Folder for raw.json and summary.json"), Flag.optional),
    from: Flag.String("from").pipe(
      Flag.withDescription("Analyze this folder's raw.json; start nothing"),
      Flag.optional,
    ),
    steady: Flag.Int("steady").pipe(Flag.withDescription("Seconds of steady load"), Flag.withDefault(240)),
    gap: Flag.Int("gap").pipe(
      Flag.withDescription("Milliseconds between one client's steady inputs"),
      Flag.withDefault(500),
    ),
    rounds: Flag.Int("rounds").pipe(Flag.withDescription("Burst rounds"), Flag.withDefault(5)),
    burst: Flag.Int("burst").pipe(Flag.withDescription("Inputs per client in one burst"), Flag.withDefault(60)),
    wait: Flag.Int("wait").pipe(
      Flag.withDescription("Seconds to wait for a restart in the large-checkpoint part"),
      Flag.withDefault(60),
    ),
    largeOnly: Flag.Boolean("large-only").pipe(
      Flag.withDescription("Run only the large-checkpoint part"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (flags) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const out = Option.isSome(flags.from)
      ? path.resolve(flags.from.value)
      : Option.isSome(flags.out)
        ? path.resolve(flags.out.value)
        : path.join(root, "runs/p34cs4-measure", yield* stamp);
    const raw: Raw = Option.isSome(flags.from)
      ? JSON.parse(yield* fs.readFileString(path.join(out, "raw.json")))
      : yield* run({
          out,
          steady: flags.steady,
          gap: flags.gap,
          rounds: flags.rounds,
          burst: flags.burst,
          largeOnly: flags.largeOnly,
          wait: flags.wait,
        });
    const summary = analyze(raw);
    yield* fs.writeFileString(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
    yield* Console.log(JSON.stringify({ ...summary, before: undefined, objects: undefined }, null, 1));
    yield* Console.log(`raw samples and summary: ${path.relative(root, out)}`);
  }),
);

measure.pipe(
  Command.run({ version: "0.0.0" }),
  Effect.provide(SecureRandom.layerWebCrypto),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
