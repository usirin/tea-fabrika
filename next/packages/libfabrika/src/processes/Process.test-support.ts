// P33 uses layer(caller, nextId). Caller is trusted wiring, never From.
// The plan leaves Caller's fields unnamed; tests use {owner, recipient}, plus `by`, the brain's
// own writer key, which `manager()` adds to every caller.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import * as fc from "fast-check";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { type Entry, Row } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import type { Sql } from "../Sql.ts";
import { type From, Mailbox } from "./Mailbox.ts";
import { Owner, Recipient, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

// Independently encoded and decoded UUIDv7s: 00000000-0000-7000-8000-000000000000 through ...003.
export const A = "process_0000000000e008000000000000";
export const B = "process_0000000000e008000000000001";
export const W = "process_0000000000e008000000000002";
export const X = "process_0000000000e008000000000003";

/** A, B, W, X, then 36 more: enough for a world that restarts past the brake or a 32-try limit. */
export const PIDS: ReadonlyArray<string> = [
  A,
  B,
  W,
  X,
  ...Array.from({ length: 36 }, (_, n) => `process_0000000000e00800${String(n + 4).padStart(10, "0")}`),
];

export const CODE = { program: "counter", hash: "build-a" };
/** The brain's own writer key: the `by` on every process event, and the only one the fold trusts. */
export const BRAIN = "SHA256:brain";
/** A client's own key: what it asks with, never an event the fold trusts. */
export const CLIENT = "SHA256:window-a";

export const from = (over: Partial<From> = {}): From => ({
  by: BRAIN,
  for: "person_01m6v5270hf3c8x2q7w9z4k5mn",
  sentAt: "2026-11-07T21:10:01.204Z",
  seen: 0,
  parent: `in-${A}-41`,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "writer-build",
  ...over,
});

type Caller = { readonly owner: typeof Owner.Type; readonly recipient: typeof Recipient.Type };

/** The brain caller always answers to a client, never to a process. */
export const brain = (): Caller & {
  readonly recipient: typeof Recipient.cases.client.Type;
  readonly by: string;
} => ({
  owner: Owner.cases.brain.make({}),
  recipient: Recipient.cases.client.make({ client: "window-a", session: X }),
  by: BRAIN,
});

export const watcher = (process: string): Caller => ({
  owner: Owner.cases.process.make({ process }),
  recipient: Recipient.cases.process.make({ process }),
});

/**
 * The fixture's own copy of the exit reason schema, so a law never checks the product against itself.
 * An error class keeps the 256-character text bound.
 */
export const ERROR_CLASS_MAX = 256;
const ErrorClass = Schema.NonEmptyString.check(Schema.isMaxLength(ERROR_CLASS_MAX));
export const PHASES = ["step", "saved_letter", "interrupted"] as const;

export const ExitReason = Schema.TaggedUnion({
  normal: {},
  shutdown: {},
  kill: {},
  crashed: { phase: Schema.Literals(PHASES), error: Schema.optionalKey(ErrorClass) },
});
export type ExitReason = typeof ExitReason.Type;
/** What a DOWN carries: an exit reason, or `noproc` when the target was never live. */
const NoProc = Schema.TaggedStruct("noproc", {});
export const DownReason = Schema.Union([ExitReason, NoProc]);

export const NORMAL = ExitReason.cases.normal.make({});
export const SHUTDOWN = ExitReason.cases.shutdown.make({});
export const KILL = ExitReason.cases.kill.make({});
export const CRASHED = ExitReason.cases.crashed.make({ phase: "step", error: "Error" });
export const INTERRUPTED = ExitReason.cases.crashed.make({ phase: "interrupted" });
export const NOPROC = NoProc.make({});

/** An error class as a program could throw it: an identifier, from one character to the bound. */
export const fcErrorClass = fc.stringMatching(new RegExp(`^[A-Za-z_$][A-Za-z0-9_$]{0,${ERROR_CLASS_MAX - 1}}$`));

/** Every schema-valid exit reason, the class lengths pushed to both edges of the bound. */
export const fcExitReason: fc.Arbitrary<ExitReason> = fc.oneof(
  fc.constant(NORMAL),
  fc.constant(SHUTDOWN),
  fc.constant(KILL),
  fc
    .record(
      {
        phase: fc.constantFrom(...PHASES),
        error: fc.oneof(
          fcErrorClass,
          fc.integer({ min: 1, max: ERROR_CLASS_MAX }).map((n) => "E".repeat(n)),
        ),
      },
      { requiredKeys: ["phase"] },
    )
    .map((fields) => ExitReason.cases.crashed.make(fields)),
);

/** A fresh, structurally equal copy of a reason, as JSON serialization or a reopened store gives it. */
export const copied = <A>(value: A): A => JSON.parse(JSON.stringify(value));

/**
 * One invalid exit input, made from a valid reason: text, an unknown tag or phase, a missing phase,
 * an empty or overlong class, a class of the wrong type, or a stray tag.
 */
export const fcBadReason = (reason: ExitReason): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.constant(reason._tag),
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.constant(null),
    fc.constant({}),
    fc.constant(raw("noproc", reason)),
    fc
      .stringMatching(/^[a-z_]{1,20}$/)
      .filter((tag) => !Object.hasOwn(ExitReason.cases, tag))
      .map((tag) => raw(tag, reason)),
    fc.constant(raw("crashed")),
    fc.constant(raw("crashed", { error: "Error" })),
    fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((phase) => !(PHASES as ReadonlyArray<string>).includes(phase))
      .map((phase) => raw("crashed", { phase })),
    fc.constantFrom(...PHASES).map((phase) => raw("crashed", { phase, error: "" })),
    fc
      .integer({ min: ERROR_CLASS_MAX + 1, max: ERROR_CLASS_MAX + 64 })
      .chain((n) => fc.constantFrom(...PHASES).map((phase) => raw("crashed", { phase, error: "E".repeat(n) }))),
    fc.constantFrom(...PHASES).map((phase) => raw("crashed", { phase, error: 42 })),
  );

/** A raw client value under `tag`, never made by a schema, so it can hold a shape its schema refuses. */
const raw = (tag: string, fields: object = {}): unknown =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- invalid on purpose: no schema maker writes a shape its schema refuses
  ({ ...fields, _tag: tag });

export const first = (id = "start:counter:1", name = "counter:1", code = CODE) =>
  Start.cases.first.make({ id, name, code });

export const again = (after: string, id = `restart:${after}`, code = CODE) =>
  Start.cases.again.make({ id, name: "counter:1", after, reason: "crashed", code });

const folder = mkdtempSync(join(tmpdir(), "p33-"));
const opened: Array<DatabaseSync> = [];
let files = 0;

afterAll(() => {
  for (const db of opened) {
    if (db.isOpen) {
      db.close();
    }
  }

  rmSync(folder, { recursive: true, force: true });
});

// A real SQLite file, reopened without manager memory. Faults interrupt real INSERTs.
export const storage = () => {
  const path = join(folder, `${++files}.db`);
  const open = () => {
    const db = new DatabaseSync(path);
    // A test process never loses power, so it skips the sync and keeps the rollback journal in memory.
    // Every byte a law reads stays in the file and survives reopen (ticket 585, decision 0052).
    db.exec("PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF");
    opened.push(db);
    return db;
  };
  let db = open();
  let backend = nodeSql(db);
  const fault: { after: number | null; writes: number; error: Error | null } = {
    after: null,
    writes: 0,
    error: null,
  };
  const sql: Sql = {
    exec: (query, ...params) => {
      if (/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+entries\b/i.test(query)) {
        if (fault.after === 0) {
          throw fault.error ?? new Error("SQLITE_FULL planted after an earlier write");
        }

        if (fault.after !== null) {
          fault.after--;
        }

        const answer = backend.exec(query, ...params);
        fault.writes++;
        return answer;
      }

      return backend.exec(query, ...params);
    },
    transaction: (step) => backend.transaction(step),
    size: () => backend.size(),
  };
  const rows = (): ReadonlyArray<Entry> => {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE name='entries'").get()) {
      return [];
    }

    return db
      .prepare("SELECT * FROM entries ORDER BY rev")
      .all()
      .map((row) => Schema.decodeUnknownSync(Row)(row));
  };
  return {
    sql,
    fault,
    rows,
    db: () => db,
    reopen: () => {
      db.close();
      db = open();
      backend = nodeSql(db);
    },
  };
};

export type Storage = ReturnType<typeof storage>;
const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

export const data = (sql: Sql, bell = quiet) =>
  Layer.mergeAll(LedgerSql.layer(sql, { reader: "connection:test" }), LedgerTransactionSql.layer(sql)).pipe(
    Layer.provide(bell),
  );

export const ids = (...values: ReadonlyArray<string>) => {
  let calls = 0;
  return {
    next: Effect.sync(() => {
      const value = values[calls++];

      if (value === undefined) {
        throw new Error("test exhausted its process IDs");
      }

      return value;
    }),
    calls: () => calls,
  };
};

export const manager = (store: Storage, caller: Caller = brain(), next = ids(A, B, W, X).next, bell = quiet) =>
  ProcessManager.layer({ ...caller, by: BRAIN }, next).pipe(
    Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data(store.sql, bell)))),
  );

export const read = (stream: string) => Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0)));

/** A registered name's lifecycle events, on the stream only the brain may write. */
export const events = (name: string) => read(`processes/${name}`);

export const receive = (process: string, after = 0) =>
  ProcessManager.use((processes) => Stream.runCollect(processes.receive(process, after)));
