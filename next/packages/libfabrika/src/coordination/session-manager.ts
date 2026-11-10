import { Context, Effect, Layer, Result, Schema } from "effect";
import { LedgerError } from "../data/ledger.ts";
import { type InputId } from "../data/log.ts";
import { ProcessId } from "../ProcessId.ts";
import { ParentText } from "../Rev.ts";
import { type Sql } from "../Sql.ts";
import { inRunnerSpace, inSignalSpace } from "./process.ts";

export const Writer = Schema.TaggedUnion({
  person: { key: Schema.String, for: Schema.String },
  agent: { key: Schema.String, for: Schema.String },
});
export type Writer = typeof Writer.Type;

export interface Envelope<A> {
  readonly id: InputId;
  readonly by: Writer;
  readonly arrivedAt: number;
  readonly input: A;
}

const Span = Schema.Struct({ traceId: Schema.String, spanId: Schema.String });

export const Session = Schema.Struct({
  by: Writer,
  parent: ParentText,
  traceId: Schema.String,
  span: Span,
});
export type Session = typeof Session.Type;

export class SigningRefused extends Schema.TaggedError<SigningRefused>()("SigningRefused", {
  reason: Schema.Literals(["not_delivered", "spent", "person_only", "ended", "signal"]),
}) {}

export class NotGranted extends Schema.TaggedError<NotGranted>()("NotGranted", {}) {}

export class SignRequest extends Context.Service<SignRequest, { readonly id: string }>()(
  "@kampus/libfabrika/SignRequest",
) {}

const InputRecord = Schema.Struct({
  id: ParentText,
  by: Writer,
  client: Schema.String,
  process: ProcessId,
  name: Schema.String,
  personOnly: Schema.Boolean,
  digest: Schema.String,
  traceId: Schema.String,
  span: Span,
  arrivedAt: Schema.Number,
});
type InputRecord = typeof InputRecord.Type;
const State = Schema.TaggedUnion({ recorded: {}, delivered: {} });

export class SavedInput extends Schema.Opaque<SavedInput>()(
  Schema.Struct({
    input: InputRecord,
    state: State,
  }),
) {
  static sign(saved: SavedInput, process: string, personOnly: boolean): Result.Result<Session, SigningRefused> {
    const a = saved.input;

    if (saved.state._tag !== "delivered" || a.process !== process) {
      return Result.fail(new SigningRefused({ reason: "not_delivered" }));
    }

    if (personOnly && (!a.personOnly || a.by._tag !== "person")) {
      return Result.fail(new SigningRefused({ reason: "person_only" }));
    }

    return Result.succeed(Session.make({ by: a.by, parent: a.id, traceId: a.traceId, span: a.span }));
  }
}

const encode = Schema.encodeSync(Schema.fromJsonString(SavedInput));
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(SavedInput));
const encodeSession = Schema.encodeSync(Schema.fromJsonString(Session));
const decodeSession = Schema.decodeUnknownSync(Schema.fromJsonString(Session));

export class SessionManager extends Context.Service<
  SessionManager,
  {
    readonly record: (input: InputRecord) => Effect.Effect<void, LedgerError | SigningRefused>;
    readonly delivered: (parent: string, process: string) => Effect.Effect<void, LedgerError | SigningRefused>;
    readonly end: (process: string) => Effect.Effect<void, LedgerError>;
    readonly signer: (
      parent: string,
      process: string,
      kind: string,
    ) => Effect.Effect<Session, SigningRefused | NotGranted | LedgerError, SignRequest>;
    readonly receipt: (
      id: string,
      parent: string,
      process: string,
      kind: string,
    ) => Effect.Effect<Session, SigningRefused | NotGranted | LedgerError>;
  }
>()("@kampus/libfabrika/SessionManager") {
  static readonly layer = <R>(
    sql: Sql,
    membership: (key: string) => Effect.Effect<Writer, NotGranted | LedgerError, R>,
    policy: { readonly input: (name: string) => boolean; readonly event: (kind: string) => boolean },
  ): Layer.Layer<SessionManager, never, R> =>
    Layer.effect(
      SessionManager,
      Effect.gen(function* () {
        const context = yield* Effect.context<R>();
        const ensure = () => {
          sql.exec("CREATE TABLE IF NOT EXISTS door_sessions (parent TEXT PRIMARY KEY, saved TEXT NOT NULL)");
          sql.exec("CREATE TABLE IF NOT EXISTS door_ended (process TEXT PRIMARY KEY)");
          sql.exec(
            "CREATE TABLE IF NOT EXISTS door_receipts (id TEXT PRIMARY KEY, parent TEXT NOT NULL, process TEXT NOT NULL, kind TEXT NOT NULL, session TEXT NOT NULL, UNIQUE(parent, process, kind))",
          );
        };
        const stored = Effect.fnUntraced(function* <A>(step: () => A) {
          return yield* Effect.try({ try: step, catch: () => new LedgerError({ reason: "storage" }) });
        });
        const ended = (process: string) =>
          sql.exec("SELECT process FROM door_ended WHERE process=?", process).length > 0;
        const load = (parent: string) => {
          const [row] = sql.exec("SELECT saved FROM door_sessions WHERE parent=?", parent);
          return row === undefined ? null : decode(row.saved);
        };
        const signer = Effect.fn("session.signer")(function* (parent: string, process: string, kind: string) {
          const request = yield* SignRequest;

          // A signal id is the brain's alone: the signer refuses it before it reads or writes,
          // so no receipt binds one and the delivery's one receipt stays free.
          if (inSignalSpace(request.id) || inRunnerSpace(request.id)) {
            return yield* new SigningRefused({ reason: "signal" });
          }

          const saved = yield* stored(() => {
            ensure();
            return load(parent);
          });

          if (saved !== null) {
            yield* membership(saved.input.client).pipe(Effect.provideContext(context));
          }

          return yield* stored(() =>
            sql.transaction(() => {
              if (ended(process)) {
                return Result.fail(new SigningRefused({ reason: "ended" }));
              }

              const current = load(parent);

              if (current === null) {
                return Result.fail(new SigningRefused({ reason: "not_delivered" }));
              }

              const session = SavedInput.sign(current, process, policy.event(kind));

              if (Result.isFailure(session)) {
                return session;
              }

              const [receipt] = sql.exec(
                "SELECT * FROM door_receipts WHERE id=? OR (parent=? AND process=? AND kind=?)",
                request.id,
                parent,
                process,
                kind,
              );

              if (receipt !== undefined) {
                return receipt.id === request.id &&
                  receipt.parent === parent &&
                  receipt.process === process &&
                  receipt.kind === kind
                  ? Result.succeed(decodeSession(receipt.session))
                  : Result.fail(new SigningRefused({ reason: "spent" }));
              }

              sql.exec(
                "INSERT INTO door_receipts (id,parent,process,kind,session) VALUES (?,?,?,?,?)",
                request.id,
                parent,
                process,
                kind,
                encodeSession(session.success),
              );
              return session;
            }),
          ).pipe(
            Effect.flatMap((answer) =>
              Result.isFailure(answer) ? Effect.fail(answer.failure) : Effect.succeed(answer.success),
            ),
          );
        });
        return {
          signer,
          receipt: Effect.fn("session.receipt")(function* (id: string, parent: string, process: string, kind: string) {
            const exists = yield* stored(() => {
              ensure();
              return (
                sql.exec(
                  "SELECT id FROM door_receipts WHERE id=? AND parent=? AND process=? AND kind=?",
                  id,
                  parent,
                  process,
                  kind,
                ).length > 0
              );
            });

            if (!exists) {
              return yield* new SigningRefused({ reason: "not_delivered" });
            }

            return yield* signer(parent, process, kind).pipe(Effect.provideService(SignRequest, { id }));
          }),
          record: Effect.fn("session.record")(function* (input: InputRecord) {
            const result = yield* stored(() =>
              sql.transaction(() => {
                ensure();

                if (ended(input.process)) {
                  return Result.fail(new SigningRefused({ reason: "ended" }));
                }

                const prior = load(input.id);
                const saved = SavedInput.make({
                  input: { ...input, personOnly: input.personOnly && policy.input(input.name) },
                  state: State.cases.recorded.make({}),
                });

                if (prior !== null) {
                  return JSON.stringify(prior.input) === JSON.stringify(saved.input)
                    ? Result.succeed(undefined)
                    : Result.fail(new SigningRefused({ reason: "not_delivered" }));
                }

                sql.exec("INSERT INTO door_sessions (parent,saved) VALUES (?,?)", input.id, encode(saved));
                return Result.succeed(undefined);
              }),
            );

            if (Result.isFailure(result)) {
              return yield* result.failure;
            }
          }),
          delivered: Effect.fn("session.delivered")(function* (parent: string, process: string) {
            const result = yield* stored(() =>
              sql.transaction(() => {
                ensure();

                if (ended(process)) {
                  return Result.fail(new SigningRefused({ reason: "ended" }));
                }

                const saved = load(parent);

                if (saved === null || saved.input.process !== process) {
                  return Result.fail(new SigningRefused({ reason: "not_delivered" }));
                }

                sql.exec(
                  "UPDATE door_sessions SET saved=? WHERE parent=?",
                  encode(SavedInput.make({ ...saved, state: State.cases.delivered.make({}) })),
                  parent,
                );
                return Result.succeed(undefined);
              }),
            );

            if (Result.isFailure(result)) {
              return yield* result.failure;
            }
          }),
          end: Effect.fn("session.end")(function* (process: string) {
            yield* stored(() =>
              sql.transaction(() => {
                ensure();
                sql.exec("INSERT OR IGNORE INTO door_ended (process) VALUES (?)", process);
              }),
            );
          }),
        };
      }),
    );
}
