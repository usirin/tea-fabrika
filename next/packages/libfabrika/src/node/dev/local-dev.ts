import { Effect, FileSystem, Path, Result, Schema, Semaphore } from "effect";
import { BrainEvent } from "../../runtime/BrainEvent.ts";

class BrainError extends Schema.TaggedError<BrainError>()("BrainError", {
  reason: Schema.Literals(["storage", "bad_row", "id_reused"]),
}) {}

// Events have no transforms. Validate without rebuilding them, keeping retry bytes in their saved order.
const PendingEvent = Schema.declare<typeof BrainEvent.Type>((raw): raw is typeof BrainEvent.Type =>
  Result.isSuccess(Schema.decodeUnknownResult(BrainEvent, { onExcessProperty: "error" })(raw)),
);

export const checkMemory = Effect.fn("brain.checkMemory")(function* <E, R>(options: {
  readonly pid: number;
  readonly sample: (pid: number) => Effect.Effect<number, E, R>;
  readonly replace: (reason: { reason: "memory"; pid: number; bytes: number }) => Effect.Effect<void, E, R>;
}) {
  const bytes = yield* options.sample(options.pid);

  if (bytes >= 500_000_000) {
    yield* options.replace({ reason: "memory", pid: options.pid, bytes });
  }
});

export const brainOutbox = Effect.fn("brain.outbox")(function* (home: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const file = path.join(home, "brain.pending.jsonl");
  const lastFile = path.join(home, "brain.last.json");
  const turn = yield* Semaphore.make(1);
  const read = Effect.gen(function* () {
    if (!(yield* fs.exists(file))) {
      return [];
    }

    const text = yield* fs.readFileString(file);
    return yield* Effect.forEach(
      text.split("\n").filter(Boolean),
      (row) => Schema.decodeUnknownEffect(Schema.fromJsonString(PendingEvent))(row),
      { concurrency: 1 },
    );
  }).pipe(Effect.mapError(() => new BrainError({ reason: "bad_row" })));
  const durableWrite = Effect.fnUntraced(
    function* (target: string, text: string) {
      yield* fs.makeDirectory(home, { recursive: true });
      const pending = `${target}.tmp`;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(pending, { flag: "w", mode: 0o600 });
          yield* file.writeAll(new TextEncoder().encode(text));
          yield* file.sync;
        }),
      );
      yield* fs.rename(pending, target);
      // Node's FileSystem provider can open and sync a directory, so no raw fs adapter is needed.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const folder = yield* fs.open(home, { flag: "r" });
          yield* folder.sync;
        }),
      );
    },
    Effect.mapError(() => new BrainError({ reason: "storage" })),
  );
  const write = (rows: ReadonlyArray<typeof BrainEvent.Type>) =>
    durableWrite(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  const last = Effect.fnUntraced(function* () {
    const pending = (yield* read).filter((event) => event._tag === "started").at(-1);

    if (pending !== undefined) {
      return pending.start;
    }

    return yield* Effect.gen(function* () {
      if (!(yield* fs.exists(lastFile))) {
        return null;
      }

      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.NonEmptyString))(
        yield* fs.readFileString(lastFile),
      );
    }).pipe(Effect.mapError(() => new BrainError({ reason: "bad_row" })));
  });
  const saveLast = Effect.fnUntraced(function* () {
    const start = yield* last();

    if (start === null) {
      return;
    }

    yield* durableWrite(lastFile, JSON.stringify(start));
  });
  return {
    last: last().pipe(turn.withPermit),
    pending: read.pipe(turn.withPermit),
    add: Effect.fn("brain.pending")(function* (raw: unknown) {
      yield* Effect.gen(function* () {
        const event = yield* Schema.decodeUnknownEffect(PendingEvent)(raw).pipe(
          Effect.mapError(() => new BrainError({ reason: "bad_row" })),
        );
        const rows = yield* read;
        const old = rows.find((row) => row.id === event.id);

        if (old !== undefined) {
          if (JSON.stringify(old) !== JSON.stringify(event)) {
            return yield* new BrainError({ reason: "id_reused" });
          }

          return;
        }

        yield* write([...rows, event]);

        if (event._tag === "started") {
          yield* saveLast();
        }
      }).pipe(turn.withPermit);
    }),
    flush: Effect.fn("brain.flush")(function* <E, R>(
      send: (event: typeof BrainEvent.Type) => Effect.Effect<unknown, E, R>,
    ) {
      yield* Effect.gen(function* () {
        const rows = [...(yield* read)];
        yield* saveLast();

        for (const row of [...rows]) {
          yield* send(row);
          rows.shift();
          yield* write(rows);
        }
      }).pipe(turn.withPermit);
    }),
  };
});
