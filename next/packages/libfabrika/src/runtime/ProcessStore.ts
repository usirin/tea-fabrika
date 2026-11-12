// A process's own storage, next/: its saved model, its unfinished turn and its Cmds' dispatch
// state, kept in the process object's SQLite (Tier 1, P11). It also appends the runtime's two
// records to the process's stream, and nothing else. Tables come with the first call.
import { Context, Effect, Layer, Result, Schema } from "effect";
import { Ledger, LedgerError } from "../ledger/Ledger.ts";
import { lineFor } from "../ledger/Log.ts";
import { INPUT_BYTES } from "../processes/Children.ts";
import { type From } from "../processes/Mailbox.ts";
import { Activity } from "../processes/Process.ts";
import { Rev } from "../Rev.ts";
import { type Sql } from "../Sql.ts";

/** What a process saves: its model as the runner keeps it, the turn it was in, and its Cmds. The
 *  runner gives `turn` and `cmds` their shapes; the store keeps them as JSON. */
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
export type Checkpoint = typeof Checkpoint.Type;

/** Where an accepted letter sits in its inbox, kept so a resend finds its first placing. */
export const Placed = Schema.Struct({ id: Schema.String, rev: Rev, pos: Rev });
export type Placed = typeof Placed.Type;

/** The only events the runtime writes to a process's stream: a step it installed, and an upgrade it
 *  ran on saved state. A program never writes either. */
export const RuntimeRecord = Schema.TaggedUnion({
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
  readonly select: (process: string) => Effect.Effect<ProcessStorage>;
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
   * accepted history without copying their rows (P34).
   */
  readonly placedByAny: (id: string) => Effect.Effect<Placed | null, LedgerError>;
  /** Appends one RuntimeRecord to the process's stream. A retry answers its first placing. */
  readonly record: (id: string, event: unknown, from: From) => Effect.Effect<unknown, LedgerError>;
};

export class ProcessStore extends Context.Service<ProcessStore, ProcessStorage>()("@kampus/libfabrika/ProcessStore") {
  static readonly layer = (
    sql: Sql,
    who: {
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
                message: String(error),
              }),
          });
        });
        return {
          select: Effect.fn("process.select")(function* (process: string) {
            return yield* ProcessStore.pipe(
              Effect.provide(ProcessStore.layer(sql, { ...who, process })),
              Effect.provideService(Ledger, ledger),
            );
          }),
          readActivity:
            who.storage?.get !== undefined
              ? who.storage.get("activity").pipe(
                  Effect.flatMap((raw) =>
                    raw === undefined
                      ? Effect.succeed(undefined)
                      : Effect.try({
                          try: () => Schema.decodeUnknownSync(Activity)(raw),
                          catch: () => new LedgerError({ reason: "bad_row" }),
                        }),
                  ),
                )
              : stored(() => {
                  const [row] = sql.exec("SELECT activity FROM process_activity WHERE process=?", who.process);
                  return row === undefined
                    ? undefined
                    : Schema.decodeUnknownSync(Schema.fromJsonString(Activity))(row.activity);
                }),
          activity: Effect.fn("process.activity")(function* (value: typeof Activity.Type) {
            if (who.storage !== undefined) {
              yield* who.storage.put("activity", value);
              yield* who.storage.sync();
            } else {
              // Node's synchronous SQLite commit needs no separate flush.
              yield* stored(() => {
                sql.exec(
                  "INSERT INTO process_activity (process, activity) VALUES (?, ?) ON CONFLICT (process) DO UPDATE SET activity = excluded.activity",
                  who.process,
                  encodeActivity(value),
                );
              });
            }
          }),
          load: stored(() => {
            const [row] = sql.exec("SELECT checkpoint FROM process_state WHERE process=?", who.process);

            if (row === undefined) {
              return null;
            }

            // An empty head names a checkpoint split across rows in the same transaction.
            const text =
              row.checkpoint === ""
                ? sql
                    .exec("SELECT checkpoint FROM process_checkpoint_parts WHERE process=? ORDER BY part", who.process)
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
              const width = Math.floor((INPUT_BYTES - new TextEncoder().encode(who.process).length - 8) / 3);
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
                sql.exec("DELETE FROM process_checkpoint_parts WHERE process=?", who.process);
                sql.exec(
                  "INSERT INTO process_state (process, checkpoint) VALUES (?, ?) ON CONFLICT (process) DO UPDATE SET checkpoint = excluded.checkpoint",
                  who.process,
                  parts.length > 1 ? "" : text,
                );

                if (parts.length > 1) {
                  for (const [part, checkpoint] of parts.entries()) {
                    sql.exec(
                      "INSERT INTO process_checkpoint_parts (process, part, checkpoint) VALUES (?, ?, ?)",
                      who.process,
                      part,
                      checkpoint,
                    );
                  }
                }

                for (const { id, rev, pos } of placed) {
                  sql.exec(
                    "INSERT OR IGNORE INTO process_letters (process, id, rev, pos) VALUES (?, ?, ?, ?)",
                    who.process,
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
                who.process,
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

            const answer = yield* ledger.append(who.process, id, lineFor(from, encodeRecord(decoded.success)));

            if (answer._tag === "refused") {
              return yield* new LedgerError({ reason: "refused", message: answer.reason });
            }

            return answer;
          }),
        };
      }),
    );
}
