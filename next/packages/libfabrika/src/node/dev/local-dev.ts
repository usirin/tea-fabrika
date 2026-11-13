/**
 * The local brain driver's two helpers on Node: the memory check that replaces a brain that grew
 * too big, and the durable outbox for its lifecycle events.
 *
 * @stability unstable
 */
import { Effect, FileSystem, Path, Result, Schema, Semaphore } from "effect";
import { BrainEvent } from "../../runtime/BrainEvent.ts";

class BrainError extends Schema.TaggedError<BrainError>()("BrainError", {
  reason: Schema.Literals(["storage", "bad_row", "id_reused"]),
  /** The failure this error translates, kept in memory for diagnosis. */
  cause: Schema.optional(Schema.Defect()),
}) {}

// Events have no transforms. Validate without rebuilding them, keeping retry bytes in their saved order.
const PendingEvent = Schema.declare<typeof BrainEvent.Type>((raw): raw is typeof BrainEvent.Type =>
  Result.isSuccess(Schema.decodeUnknownResult(BrainEvent, { onExcessProperty: "error" })(raw)),
);

/**
 * Samples one process's memory and asks for a replacement when it holds 500 MB or more. Below
 * that it does nothing.
 *
 * **Details**
 *
 * `sample` answers the bytes a pid holds. `replace` gets the reason, the pid and the bytes, and is
 * the one that ends the process.
 *
 * @stability unstable
 * @category combinators
 */
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

/**
 * Creates the local brain's durable outbox: lifecycle events saved in `home` until the project has
 * taken them.
 *
 * **Details**
 *
 * `add` checks an event and saves it. Adding the same event again changes nothing, and the same id
 * with other content fails as `id_reused`. `flush` sends the saved events in order and drops each
 * only after `send` succeeded, so an event is delivered at least once. `last` answers the newest
 * start's id, kept in a file of its own so the next run can say which start it follows. One call
 * runs at a time.
 *
 * **Gotchas**
 *
 * Every write goes to a temporary file that is synced and renamed, and then the folder is synced,
 * so a crash leaves the old file or the new one, never half of one.
 *
 * @stability unstable
 * @category constructors
 */
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
  }).pipe(Effect.mapError((cause) => new BrainError({ reason: "bad_row", cause })));
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
    Effect.mapError((cause) => new BrainError({ reason: "storage", cause })),
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
    }).pipe(Effect.mapError((cause) => new BrainError({ reason: "bad_row", cause })));
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
          Effect.mapError((cause) => new BrainError({ reason: "bad_row", cause })),
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
