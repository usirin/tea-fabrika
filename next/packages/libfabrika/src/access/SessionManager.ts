/**
 * Keeps each delivered input's signing right: who wrote it, which process may sign for it, and one
 * receipt per signing request.
 *
 * **Details**
 *
 * State lives in three tables of the given `Sql`: `gateway_sessions`, `gateway_ended` and
 * `gateway_receipts`. They are created on first use.
 *
 * @stability unstable
 */
import { Context, Effect, Layer, Result, Schema } from "effect";
import { type InputId } from "../Id.ts";
import { inNoticeSpace, inRunnerSpace, inSignalSpace } from "../processes/Process.ts";
import { ProcessId } from "../ProcessId.ts";
import { ParentText } from "../Rev.ts";
import { type Sql } from "../Sql.ts";

/**
 * Schema for who wrote an input: a person or an agent, with its key and the person it works for.
 *
 * @stability unstable
 * @category models
 */
export const Writer = Schema.TaggedUnion({
  person: { key: Schema.String, for: Schema.String },
  agent: { key: Schema.String, for: Schema.String },
});
/**
 * The decoded type of `Writer`.
 *
 * @stability unstable
 * @category models
 */
export type Writer = typeof Writer.Type;

/**
 * An input as it arrived: its id, who wrote it, when it arrived, and the input itself.
 *
 * @stability unstable
 * @category models
 */
export interface Envelope<A> {
  readonly id: InputId;
  readonly by: Writer;
  readonly arrivedAt: number;
  readonly input: A;
}

const Span = Schema.Struct({ traceId: Schema.String, spanId: Schema.String });

/**
 * Schema for what a signature stands for: the writer, the parent input id, and the trace and span
 * of the input.
 *
 * @stability unstable
 * @category models
 */
export const Session = Schema.Struct({
  by: Writer,
  parent: ParentText,
  traceId: Schema.String,
  span: Span,
});
/**
 * The decoded type of `Session`.
 *
 * @stability unstable
 * @category models
 */
export type Session = typeof Session.Type;

/**
 * Error for a signing request or a recording that the session rules refuse.
 *
 * **Details**
 *
 * `not_delivered` means no saved input for that parent and process, or it is not delivered yet, or
 * a different input was already recorded under the id, or `receipt` finds no stored receipt for
 * that id, parent, process and kind. `person_only` means the event kind needs a
 * person and the input was not written by one or is not person-only. `ended` means the process is
 * over. `spent` means the receipt's request id, parent, process and kind overlap an earlier
 * receipt without all matching it. `signal` means the request id is in the signal, runner or
 * notice space, which only the brain uses.
 *
 * @stability unstable
 * @category errors
 */
export class SigningRefused extends Schema.TaggedError<SigningRefused>()("SigningRefused", {
  reason: Schema.Literals(["not_delivered", "spent", "person_only", "ended", "signal"]),
}) {}

/**
 * Error for a request that is not let through: most often a writer whose key does not belong, or
 * no longer does.
 *
 * **Details**
 *
 * It has no fields. `appendAdmitted` fails with it when the key is not admitted, and the
 * membership function given to `SessionManager.layer` may fail with it too. The gateway also uses
 * it for a client that is not online, a parent id that does not decode, a binding that does not
 * match, or a destination that is not live.
 *
 * @stability unstable
 * @category errors
 */
export class NotGranted extends Schema.TaggedError<NotGranted>()("NotGranted", {}) {}

/**
 * Reason for a session table that could not be read or written: the `Sql` threw. The throw is
 * kept as `cause`.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * Reason for a saved input or receipt that does not decode. The decoder's failure is kept as
 * `cause`.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Reason for a membership check that failed for any cause but `NotGranted`, such as the access
 * store below it. That failure is kept as `cause`.
 *
 * @stability unstable
 * @category errors
 */
export class Membership extends Schema.TaggedError<Membership>()("Membership", { cause: Schema.Defect() }) {}

/**
 * Error for a session call that failed below the session rules: in its own tables, or in the
 * membership check it was given. A refusal by the rules is `SigningRefused` or `NotGranted`
 * instead.
 *
 * @stability unstable
 * @category errors
 */
export class SessionManagerError extends Schema.TaggedError<SessionManagerError>()("SessionManagerError", {
  reason: Schema.Union([Storage, BadRow, Membership]),
}) {}

/** The manager's own error for a throw in a stored step: a decoder's failure is a bad row. */
const storageFault = (cause: unknown) =>
  new SessionManagerError({ reason: Schema.isSchemaError(cause) ? new BadRow({ cause }) : new Storage({ cause }) });

/**
 * Service that carries the id of one signing request.
 *
 * **Details**
 *
 * `SessionManager.signer` reads it. Asking again with the same id for the same parent, process and
 * kind returns the same session, and any other use of that id is refused as `spent`.
 *
 * @stability unstable
 * @category services
 */
export class SignRequest extends Context.Service<SignRequest, { readonly id: string }>()(
  "@kampus/libfabrika/access/SessionManager.SignRequest",
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

/**
 * Opaque record of an input and whether it is `recorded` or `delivered`.
 *
 * **Details**
 *
 * Its `sign` function turns a delivered input into a `Session`. It fails with `not_delivered`
 * unless the input is delivered and belongs to the given process, and with `person_only` when the
 * kind needs a person and the input was not written by a person or is not person-only.
 *
 * @stability unstable
 * @category models
 */
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

/**
 * Service that records inputs, marks them delivered, ends a process, and signs for a delivered
 * input.
 *
 * **Details**
 *
 * `record` saves an input, narrowing its person-only flag by the layer's input policy. Recording
 * the same input again changes nothing, and a different input under the same id is refused.
 * `delivered` marks a recorded input delivered for its process. `end` stops a process for good:
 * later `record`, `delivered` and `signer` calls for it are refused with `ended`. `signer` needs a
 * `SignRequest`, refuses ids in the signal, runner and notice spaces, checks that the writer's key
 * still belongs, then inside one transaction answers with the session and stores one receipt for
 * the request. `receipt` replays a stored receipt by its id, parent, process and kind, and
 * answers `not_delivered` when there is none.
 *
 * **Gotchas**
 *
 * The membership check in `signer` runs before the transaction, so a key removed in between is
 * not seen by that call. `receipt` runs `signer` again, so it checks membership again.
 *
 * @stability unstable
 * @category services
 */
export class SessionManager extends Context.Service<
  SessionManager,
  {
    readonly record: (input: InputRecord) => Effect.Effect<void, SessionManagerError | SigningRefused>;
    readonly delivered: (parent: string, process: string) => Effect.Effect<void, SessionManagerError | SigningRefused>;
    readonly end: (process: string) => Effect.Effect<void, SessionManagerError>;
    readonly signer: (
      parent: string,
      process: string,
      kind: string,
    ) => Effect.Effect<Session, SigningRefused | NotGranted | SessionManagerError, SignRequest>;
    readonly receipt: (
      id: string,
      parent: string,
      process: string,
      kind: string,
    ) => Effect.Effect<Session, SigningRefused | NotGranted | SessionManagerError>;
  }
>()("@kampus/libfabrika/access/SessionManager") {
  /**
   * Builds the service on a `Sql` store. `membership` turns a client key into its `Writer`. Its
   * `NotGranted` passes through as it is, and any other failure becomes a `SessionManagerError`
   * with reason `Membership`. `policy.input` says whether an input of that name may be
   * person-only, and `policy.event` says whether an event of that kind needs a person writer.
   */
  static readonly layer = <E, R>(
    sql: Sql,
    membership: (key: string) => Effect.Effect<Writer, E, R>,
    policy: { readonly input: (name: string) => boolean; readonly event: (kind: string) => boolean },
  ): Layer.Layer<SessionManager, never, R> =>
    Layer.effect(
      SessionManager,
      Effect.gen(function* () {
        const context = yield* Effect.context<R>();
        const ensure = () => {
          sql.exec("CREATE TABLE IF NOT EXISTS gateway_sessions (parent TEXT PRIMARY KEY, saved TEXT NOT NULL)");
          sql.exec("CREATE TABLE IF NOT EXISTS gateway_ended (process TEXT PRIMARY KEY)");
          sql.exec(
            "CREATE TABLE IF NOT EXISTS gateway_receipts (id TEXT PRIMARY KEY, parent TEXT NOT NULL, process TEXT NOT NULL, kind TEXT NOT NULL, session TEXT NOT NULL, UNIQUE(parent, process, kind))",
          );
        };
        const stored = Effect.fnUntraced(function* <A>(step: () => A) {
          return yield* Effect.try({ try: step, catch: storageFault });
        });
        const ended = (process: string) =>
          sql.exec("SELECT process FROM gateway_ended WHERE process=?", process).length > 0;
        const load = (parent: string) => {
          const [row] = sql.exec("SELECT saved FROM gateway_sessions WHERE parent=?", parent);
          return row === undefined ? null : decode(row.saved);
        };
        const signer = Effect.fn("session.signer")(function* (parent: string, process: string, kind: string) {
          const request = yield* SignRequest;

          // A signal, runner or notice id is the brain's alone: refuse it before reading or writing,
          // so no receipt binds one and the delivery's one receipt stays free.
          if (inSignalSpace(request.id) || inRunnerSpace(request.id) || inNoticeSpace(request.id)) {
            return yield* new SigningRefused({ reason: "signal" });
          }

          const saved = yield* stored(() => {
            ensure();
            return load(parent);
          });

          if (saved !== null) {
            yield* membership(saved.input.client).pipe(
              Effect.provideContext(context),
              Effect.mapError((cause) =>
                Schema.is(NotGranted)(cause) ? cause : new SessionManagerError({ reason: new Membership({ cause }) }),
              ),
            );
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
                "SELECT * FROM gateway_receipts WHERE id=? OR (parent=? AND process=? AND kind=?)",
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
                "INSERT INTO gateway_receipts (id,parent,process,kind,session) VALUES (?,?,?,?,?)",
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
                  "SELECT id FROM gateway_receipts WHERE id=? AND parent=? AND process=? AND kind=?",
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

                sql.exec("INSERT INTO gateway_sessions (parent,saved) VALUES (?,?)", input.id, encode(saved));
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
                  "UPDATE gateway_sessions SET saved=? WHERE parent=?",
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
                sql.exec("INSERT OR IGNORE INTO gateway_ended (process) VALUES (?)", process);
              }),
            );
          }),
        };
      }),
    );
}
