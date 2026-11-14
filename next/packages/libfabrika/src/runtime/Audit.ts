/**
 * Audit selection and its errors. `select` reduces a program's message to the audit data the
 * program declares. The errors keep their cause in memory, redacted, and `Answer` carries a failure
 * across the audit RPC with no field for that cause.
 *
 * @stability unstable
 */
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const Cause = { cause: Schema.optionalKey(Schema.Redacted(Schema.Unknown, { disallowJsonEncode: true })) };

/**
 * The input cannot be decoded for audit selection.
 *
 * @stability unstable
 * @category errors
 */
export class Input extends Schema.TaggedError<Input>()("Input", Cause) {}
/**
 * The program's selector failed.
 *
 * @stability unstable
 * @category errors
 */
export class Selection extends Schema.TaggedError<Selection>()("Selection", Cause) {}
/**
 * The selected value cannot be encoded as checked JSON.
 *
 * @stability unstable
 * @category errors
 */
export class Output extends Schema.TaggedError<Output>()("Output", Cause) {}
/**
 * Audit transport failed without deciding anything about the program.
 *
 * @stability unstable
 * @category errors
 */
export class Transport extends Schema.TaggedError<Transport>()("Transport", Cause) {}
/**
 * The remote audit reply could not be checked.
 *
 * @stability unstable
 * @category errors
 */
export class Reply extends Schema.TaggedError<Reply>()("Reply", Cause) {}

/**
 * Audit failures retain private causes in memory and print only safe tags.
 *
 * @stability unstable
 * @category errors
 */
export class AuditError extends Schema.TaggedError<AuditError>()("AuditError", {
  reason: Schema.Union([Input, Selection, Output, Transport, Reply]),
}) {}

/**
 * Schema for checked audit RPC data: an `ok` value, or an `AuditError` with only its reason tag.
 * It deliberately has no field for a private cause.
 *
 * @stability unstable
 * @category schemas
 */
export const Answer = Schema.TaggedUnion({
  ok: { value: Schema.Json },
  AuditError: { reason: Schema.TaggedUnion({ Input: {}, Selection: {}, Output: {}, Transport: {}, Reply: {} }) },
});

/**
 * Converts an audit failure to body-free RPC data.
 *
 * @stability unstable
 * @category constructors
 */
export const failure = (error: AuditError): typeof Answer.cases.AuditError.Type =>
  Answer.cases.AuditError.make({ reason: Answer.cases.AuditError.fields.reason.cases[error.reason._tag].make({}) });

const reasons = { Input, Selection, Output, Transport, Reply };

/**
 * Restores a checked audit error without trusting a remote cause.
 *
 * @stability unstable
 * @category constructors
 */
export const restore = (answer: typeof Answer.cases.AuditError.Type): AuditError =>
  new AuditError({ reason: new reasons[answer.reason._tag]({}) });

const Minimal = Schema.Struct({ type: Schema.String });

type Declaration = {
  readonly msg: Schema.Codec<unknown, unknown>;
  readonly audit?: {
    readonly data: Schema.Codec<unknown, unknown>;
    readonly select: (msg: unknown) => unknown;
  };
};

/**
 * Selects only a program's declared audit data, defaulting to message type. It decodes the raw
 * message with the program's `msg` schema, runs the program's audit selector (or keeps just the
 * message `type`), and encodes the result as JSON. A failure in the first step is an `Input` error,
 * in the selector a `Selection` error, and in the last step an `Output` error.
 *
 * @stability unstable
 * @category combinators
 */
export const select = (program: Declaration, raw: unknown): Result.Result<Schema.Json, AuditError> => {
  const decoded = Result.try({
    try: () => Schema.decodeUnknownResult(program.msg)(raw),
    catch: (cause) => new AuditError({ reason: new Input({ cause: Redacted.make(cause) }) }),
  }).pipe(
    Result.flatMap((result) =>
      Result.mapError(result, (cause) => new AuditError({ reason: new Input({ cause: Redacted.make(cause) }) })),
    ),
  );

  return Result.flatMap(decoded, (msg) => {
    const selected = Result.try({
      try: () => (program.audit === undefined ? Schema.decodeUnknownSync(Minimal)(msg) : program.audit.select(msg)),
      catch: (cause) => new AuditError({ reason: new Selection({ cause: Redacted.make(cause) }) }),
    });
    return Result.flatMap(selected, (value) =>
      Result.try({
        try: () =>
          Schema.decodeUnknownSync(Schema.Json)(Schema.encodeUnknownSync(program.audit?.data ?? Minimal)(value)),
        catch: (cause) => new AuditError({ reason: new Output({ cause: Redacted.make(cause) }) }),
      }),
    );
  });
};
