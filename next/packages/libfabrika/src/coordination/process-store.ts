// A process's own storage, next/: its saved model, its unfinished turn and its Cmds' dispatch
// state, kept in the process object's SQLite (Tier 1, P11). It also appends the runtime's two
// records to the process's stream, and nothing else. Tables come with the first call.
import {Context, Effect, Layer, Result, Schema} from "effect";
import {Ledger, LedgerError} from "../data/ledger.ts";
import {lineFor, Rev} from "../data/log.ts";
import {type Sql} from "../data/referee.ts";
import {type From} from "./mailbox.ts";

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
export const Placed = Schema.Struct({id: Schema.String, rev: Rev, pos: Rev});
export type Placed = typeof Placed.Type;

/** The only facts the runtime writes to a process's stream: a step it installed, and an upgrade it
 *  ran on saved state. A program never writes either. */
export const RuntimeRecord = Schema.TaggedUnion({
	stepped: {input: Schema.NonEmptyString, pos: Rev, build: Schema.NonEmptyString},
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
	"CREATE TABLE IF NOT EXISTS process_letters (process TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, pos INTEGER NOT NULL, PRIMARY KEY (process, id))",
];
const encodeCheckpoint = Schema.encodeUnknownSync(Schema.fromJsonString(Checkpoint));
const decodeCheckpoint = Schema.decodeUnknownSync(Schema.fromJsonString(Checkpoint));
const decodePlaced = Schema.decodeUnknownSync(Placed);
const decodeRecord = Schema.decodeUnknownResult(RuntimeRecord);
const encodeRecord = Schema.encodeSync(RuntimeRecord);

export class ProcessStore extends Context.Service<
	ProcessStore,
	{
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
		/** Appends one RuntimeRecord to the process's stream. A retry answers its first placing. */
		readonly record: (id: string, fact: unknown, from: From) => Effect.Effect<unknown, LedgerError>;
	}
>()("@kampus/libfabrika/ProcessStore") {
	static readonly layer = (
		sql: Sql,
		who: {readonly process: string},
	): Layer.Layer<ProcessStore, never, Ledger> =>
		Layer.effect(
			ProcessStore,
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				let ready = false;
				const stored = <A>(step: () => A) =>
					Effect.try({
						try: () => {
							if (!ready) for (const query of TABLES) sql.exec(query);
							ready = true;
							return step();
						},
						catch: (error) =>
							new LedgerError({
								why: Schema.isSchemaError(error) ? "bad_row" : "storage",
								message: String(error),
							}),
					});
				return {
					load: stored(() => {
						const [row] = sql.exec(
							"SELECT checkpoint FROM process_state WHERE process=?",
							who.process,
						);
						return row === undefined ? null : decodeCheckpoint(row.checkpoint);
					}),
					save: (value, placed = []) =>
						stored(() => {
							const text = encodeCheckpoint(value);
							sql.transaction(() => {
								sql.exec(
									"INSERT INTO process_state (process, checkpoint) VALUES (?, ?) ON CONFLICT (process) DO UPDATE SET checkpoint = excluded.checkpoint",
									who.process,
									text,
								);
								for (const {id, rev, pos} of placed)
									sql.exec(
										"INSERT OR IGNORE INTO process_letters (process, id, rev, pos) VALUES (?, ?, ?, ?)",
										who.process,
										id,
										rev,
										pos,
									);
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
					record: Effect.fn("process.record")(function* (id: string, fact: unknown, from: From) {
						const decoded = decodeRecord(fact);
						if (Result.isFailure(decoded)) return yield* new LedgerError({why: "refused"});
						const answer = yield* ledger.append(
							who.process,
							id,
							lineFor(from, encodeRecord(decoded.success)),
						);
						if (answer._tag === "refused")
							return yield* new LedgerError({why: "refused", message: answer.why});
						return answer;
					}),
				};
			}),
		);
}
