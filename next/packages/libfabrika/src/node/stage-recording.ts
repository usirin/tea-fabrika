import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for P37's durable span queue
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Archive, RecordManager, SpanSink } from "../data/index.ts";
import { nodeSql } from "../data/sqlite.ts";

// This is P37's durable span queue, never a second ledger. Delivery makes no spans.
export const stageRecording = Effect.fn("brain.stageRecording")(function* <E>(
  home: string,
  object: string,
  call: (
    target: "record" | "bucket",
    name: string,
    method: string,
    args: ReadonlyArray<unknown>,
  ) => Effect.Effect<unknown, E>,
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  yield* fs.makeDirectory(home, { recursive: true });
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => {
      // FileSystem has no SQLite handle; Node owns this durable span queue's database.
      const db = new DatabaseSync(path.join(home, "brain.records.sqlite"));
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
      return db;
    }),
    (db) => Effect.sync(() => db.close()),
  );
  return yield* Layer.build(
    Layer.mergeAll(
      SpanSink.layer(nodeSql(db), { object }),
      RecordManager.remote((name) => ({
        write: (...args) =>
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the record binding requires a Promise
          Effect.runPromise(call("record", name, "write", args)),
        read: (...args) =>
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the record binding requires a Promise
          Effect.runPromise(call("record", name, "read", args)),
        content: (...args) =>
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the record binding requires a Promise
          Effect.runPromise(call("record", name, "content", args)),
        deleteContent: (...args) =>
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the record binding requires a Promise
          Effect.runPromise(call("record", name, "deleteContent", args)),
      })),
      Archive.bucket({
        put: (key, body, sha256) =>
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the archive binding requires a Promise
          Effect.runPromise(call("bucket", "", "put", [key, [...body], sha256]).pipe(Effect.asVoid)),
        head: (key) =>
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the archive binding requires a Promise
          Effect.runPromise(archiveHead(call("bucket", "", "head", [key]))),
      }),
    ),
  );
});

const archiveHead = Effect.fn(function* <E>(work: Effect.Effect<unknown, E>) {
  return yield* work.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.NullOr(Schema.Struct({ sha256: Schema.String })))),
  );
});
