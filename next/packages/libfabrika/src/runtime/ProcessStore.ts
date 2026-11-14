/**
 * A process's own storage: its saved model, its unfinished turn and its Cmds' dispatch state, kept
 * in the process object's SQLite. It also appends the runtime's own records to the process's
 * stream, and nothing else. Tables come with the first call.
 *
 * @stability unstable
 */
import { Context, Effect, Layer, Result, Schema } from "effect";
import { Ledger, LedgerError } from "../ledger/Ledger.ts";
import { lineFor } from "../ledger/Log.ts";
import { INPUT_BYTES } from "../processes/Children.ts";
import { type From } from "../processes/Mailbox.ts";
import { Activity } from "../processes/Process.ts";
import { Rev } from "../Rev.ts";
import { type Sql } from "../Sql.ts";

/**
 * Schema for what a process saves: its model as the runner keeps it, the turn it was in, and its
 * Cmds. The runner gives `turn` and `cmds` their shapes; the store keeps them as JSON.
 *
 * @stability unstable
 * @category schemas
 */
export const Checkpoint = Schema.Struct({
  saved: Schema.Struct({
    v: Schema.Int,
    build: Schema.String,
    model: Schema.Json,
    after: Rev,
  }),
  turn: Schema.NullOr(Schema.Json),
  cmds: Schema.Array(Schema.Json),
});
/**
 * What a process saves between turns, as `Checkpoint` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Checkpoint = typeof Checkpoint.Type;

/**
 * Schema for where an accepted letter sits in its inbox, kept so a resend finds its first placing.
 *
 * @stability unstable
 * @category schemas
 */
export const Placed = Schema.Struct({ id: Schema.String, rev: Rev, pos: Rev });
/**
 * Where an accepted letter sits in its inbox, as `Placed` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Placed = typeof Placed.Type;

/**
 * Schema for the only events the runtime writes to a process's stream: a step it installed, a
 * Cmd's answer it saved there, an upgrade it ran on saved state, and a code change it made or
 * refused. A program never writes any of them.
 *
 * @stability unstable
 * @category schemas
 */
export const RuntimeRecord = Schema.TaggedUnion({
  "code.swapped": { program: Schema.NonEmptyString, hash: Schema.NonEmptyString, was: Schema.NonEmptyString },
  "code.refused": {
    program: Schema.NonEmptyString,
    hash: Schema.NonEmptyString,
    was: Schema.NonEmptyString,
    reason: Schema.Literals(["shape", "newer", "load"]),
  },
  "cmd.answered": { m: Schema.Json, cmd: Schema.NonEmptyString, build: Schema.NonEmptyString },
  stepped: { input: Schema.NonEmptyString, pos: Rev, build: Schema.NonEmptyString },
  "state.upgraded": {
    program: Schema.NonEmptyString,
    from: Schema.Int,
    to: Schema.Int,
    ran: Schema.Array(Schema.String),
    build: Schema.NonEmptyString,
  },
});
/**
 * One event the runtime wrote to a process's stream, as `RuntimeRecord` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type RuntimeRecord = typeof RuntimeRecord.Type;

const TABLES = [
  "CREATE TABLE IF NOT EXISTS process_state (process TEXT PRIMARY KEY, checkpoint TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS process_checkpoint_parts (process TEXT NOT NULL, part INTEGER NOT NULL, checkpoint TEXT NOT NULL, PRIMARY KEY (process, part))",
  "CREATE TABLE IF NOT EXISTS process_letters (process TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, pos INTEGER NOT NULL, PRIMARY KEY (process, id))",
  "CREATE INDEX IF NOT EXISTS process_letters_id ON process_letters (id, rev)",
  "CREATE TABLE IF NOT EXISTS process_activity (process TEXT PRIMARY KEY, activity TEXT NOT NULL)",
];

const encodeActivity = Schema.encodeSync(Schema.fromJsonString(Activity));
const encodeCheckpoint = Schema.encodeUnknownSync(Schema.fromJsonString(Checkpoint));
const decodeCheckpoint = Schema.decodeUnknownSync(Schema.fromJsonString(Checkpoint));
const decodePlaced = Schema.decodeUnknownSync(Placed);
const decodeRecord = Schema.decodeUnknownResult(RuntimeRecord);
const encodeRecord = Schema.encodeSync(RuntimeRecord);

type ProcessStorage = {
  /** The same store for another process id, over the same SQL and ledger. */
  readonly select: (process: string) => Effect.Effect<ProcessStorage>;
  /** The saved activity marker, or undefined when none was written. */
  readonly readActivity: Effect.Effect<typeof Activity.Type | undefined, LedgerError>;
  /** Makes the activity marker durable before the runner starts or finishes a step. */
  readonly activity: (value: typeof Activity.Type) => Effect.Effect<void, LedgerError>;
  /** The saved checkpoint, or null before the first save. */
  readonly load: Effect.Effect<Checkpoint | null, LedgerError>;
  /** Replaces the checkpoint and adds `placed` to the letter index, in one transaction. */
  readonly save: (
    value: {
      readonly saved: unknown;
      readonly turn: unknown;
      readonly cmds: ReadonlyArray<unknown>;
    },
    placed?: ReadonlyArray<Placed>,
  ) => Effect.Effect<void, LedgerError>;
  /** An accepted letter's first placing, or null when this process never accepted it. */
  readonly placed: (id: string) => Effect.Effect<Placed | null, LedgerError>;
  /**
   * A letter's first placing by any life in this store, or null. One object's store holds one
   * registered name, so this is every life of that name: a successor keeps its predecessors'
   * accepted history without copying their rows.
   */
  readonly placedByAny: (id: string) => Effect.Effect<Placed | null, LedgerError>;
  /** Appends one RuntimeRecord to the process's stream. A retry answers its first placing. */
  readonly record: (id: string, event: unknown, from: From) => Effect.Effect<unknown, LedgerError>;
};

/**
 * Service that keeps one process's own state in its object's SQLite: its checkpoint, the index of
 * the letters it accepted, and its activity marker.
 *
 * **Details**
 *
 * A checkpoint and the letters placed with it are saved in one transaction, so a crash keeps both
 * or neither. `record` appends one `RuntimeRecord` to the process's stream, and refuses anything
 * else. Every failure is a `LedgerError`: `bad_row` for a row that does not decode, `refused` for
 * a record the ledger or the schema turns down, `storage` for the rest.
 *
 * @stability unstable
 * @category services
 */
export class ProcessStore extends Context.Service<ProcessStore, ProcessStorage>()(
  "@kampus/libfabrika/runtime/ProcessStore",
) {
  static readonly layer = (
    sql: Sql,
    options: {
      readonly process: string;
      /** The object's storage calls, wrapped in Effect by its platform edge. Node uses SQL. */
      readonly storage?:
        | {
            readonly put: (key: string, value: unknown) => Effect.Effect<void, LedgerError>;
            readonly sync: () => Effect.Effect<void, LedgerError>;
            readonly get?: (key: string) => Effect.Effect<unknown, LedgerError>;
          }
        | undefined;
    },
  ): Layer.Layer<ProcessStore, never, Ledger> =>
    Layer.effect(
      ProcessStore,
      Effect.gen(function* () {
        const ledger = yield* Ledger;
        let ready = false;
        const stored = Effect.fnUntraced(function* <A>(step: () => A) {
          return yield* Effect.try({
            try: () => {
              if (!ready) {
                for (const query of TABLES) {
                  sql.exec(query);
                }
              }

              ready = true;
              return step();
            },
            catch: (error) =>
              new LedgerError({
                reason: Schema.isSchemaError(error) ? "bad_row" : "storage",
                cause: error,
              }),
          });
        });
        return {
          select: Effect.fn("process.select")(function* (process: string) {
            return yield* ProcessStore.pipe(
              Effect.provide(ProcessStore.layer(sql, { ...options, process })),
              Effect.provideService(Ledger, ledger),
            );
          }),
          readActivity:
            options.storage?.get !== undefined
              ? options.storage.get("activity").pipe(
                  Effect.flatMap((raw) =>
                    raw === undefined
                      ? Effect.succeed(undefined)
                      : Effect.try({
                          try: () => Schema.decodeUnknownSync(Activity)(raw),
                          catch: (cause) => new LedgerError({ reason: "bad_row", cause }),
                        }),
                  ),
                )
              : stored(() => {
                  const [row] = sql.exec("SELECT activity FROM process_activity WHERE process=?", options.process);
                  return row === undefined
                    ? undefined
                    : Schema.decodeUnknownSync(Schema.fromJsonString(Activity))(row.activity);
                }),
          activity: Effect.fn("process.activity")(function* (value: typeof Activity.Type) {
            if (options.storage !== undefined) {
              yield* options.storage.put("activity", value);
              yield* options.storage.sync();
            } else {
              // Node's synchronous SQLite commit needs no separate flush.
              yield* stored(() => {
                sql.exec(
                  "INSERT INTO process_activity (process, activity) VALUES (?, ?) ON CONFLICT (process) DO UPDATE SET activity = excluded.activity",
                  options.process,
                  encodeActivity(value),
                );
              });
            }
          }),
          load: stored(() => {
            const [row] = sql.exec("SELECT checkpoint FROM process_state WHERE process=?", options.process);

            if (row === undefined) {
              return null;
            }

            // An empty head names a checkpoint split across rows in the same transaction.
            const text =
              row.checkpoint === ""
                ? sql
                    .exec(
                      "SELECT checkpoint FROM process_checkpoint_parts WHERE process=? ORDER BY part",
                      options.process,
                    )
                    .map((part) => part.checkpoint)
                    .join("")
                : row.checkpoint;
            return decodeCheckpoint(text);
          }),
          save: (value, placed = []) =>
            stored(() => {
              const text = encodeCheckpoint(value);
              // UTF-8 takes at most three bytes per UTF-16 unit. Leave room for the row's keys,
              // and keep surrogate pairs together when a checkpoint crosses a row boundary.
              const width = Math.floor((INPUT_BYTES - new TextEncoder().encode(options.process).length - 8) / 3);
              const parts: Array<string> = [];

              for (let offset = 0; offset < text.length;) {
                let end = Math.min(offset + width, text.length);

                if (end < text.length && /[\uD800-\uDBFF]/.test(text.slice(end - 1, end))) {
                  end--;
                }

                parts.push(text.slice(offset, end));
                offset = end;
              }

              sql.transaction(() => {
                sql.exec("DELETE FROM process_checkpoint_parts WHERE process=?", options.process);
                sql.exec(
                  "INSERT INTO process_state (process, checkpoint) VALUES (?, ?) ON CONFLICT (process) DO UPDATE SET checkpoint = excluded.checkpoint",
                  options.process,
                  parts.length > 1 ? "" : text,
                );

                if (parts.length > 1) {
                  for (const [part, checkpoint] of parts.entries()) {
                    sql.exec(
                      "INSERT INTO process_checkpoint_parts (process, part, checkpoint) VALUES (?, ?, ?)",
                      options.process,
                      part,
                      checkpoint,
                    );
                  }
                }

                for (const { id, rev, pos } of placed) {
                  sql.exec(
                    "INSERT OR IGNORE INTO process_letters (process, id, rev, pos) VALUES (?, ?, ?, ?)",
                    options.process,
                    id,
                    rev,
                    pos,
                  );
                }
              });
            }),
          placed: (id) =>
            stored(() => {
              const [row] = sql.exec(
                "SELECT id, rev, pos FROM process_letters WHERE process=? AND id=?",
                options.process,
                id,
              );
              return row === undefined ? null : decodePlaced(row);
            }),
          placedByAny: (id) =>
            stored(() => {
              const [row] = sql.exec("SELECT id, rev, pos FROM process_letters WHERE id=? ORDER BY rev LIMIT 1", id);
              return row === undefined ? null : decodePlaced(row);
            }),
          record: Effect.fn("process.record")(function* (id: string, event: unknown, from: From) {
            const decoded = decodeRecord(event);

            if (Result.isFailure(decoded)) {
              return yield* new LedgerError({ reason: "refused" });
            }

            const answer = yield* ledger.append(options.process, id, lineFor(from, encodeRecord(decoded.success)));

            if (answer._tag === "refused") {
              return yield* new LedgerError({ reason: "refused", message: answer.reason });
            }

            return answer;
          }),
        };
      }),
    );
}
