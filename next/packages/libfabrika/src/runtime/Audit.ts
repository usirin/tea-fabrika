import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const Cause = { cause: Schema.optionalKey(Schema.Redacted(Schema.Unknown, { disallowJsonEncode: true })) };

/** The input cannot be decoded for audit selection. */
export class Input extends Schema.TaggedError<Input>()("Input", Cause) {}
/** The program's selector failed. */
export class Selection extends Schema.TaggedError<Selection>()("Selection", Cause) {}
/** The selected value cannot be encoded as checked JSON. */
export class Output extends Schema.TaggedError<Output>()("Output", Cause) {}
/** Audit transport failed without deciding anything about the program. */
export class Transport extends Schema.TaggedError<Transport>()("Transport", Cause) {}
/** The remote audit reply could not be checked. */
export class Reply extends Schema.TaggedError<Reply>()("Reply", Cause) {}

/** Audit failures retain private causes in memory and print only safe tags. */
export class AuditError extends Schema.TaggedError<AuditError>()("AuditError", {
  reason: Schema.Union([Input, Selection, Output, Transport, Reply]),
}) {}

/** Checked audit RPC data deliberately has no field for a private cause. */
export const Answer = Schema.TaggedUnion({
  ok: { value: Schema.Json },
  AuditError: { reason: Schema.TaggedUnion({ Input: {}, Selection: {}, Output: {}, Transport: {}, Reply: {} }) },
});

/** Converts an audit failure to body-free RPC data. */
export const failure = (error: AuditError): typeof Answer.cases.AuditError.Type =>
  Answer.cases.AuditError.make({ reason: Answer.cases.AuditError.fields.reason.cases[error.reason._tag].make({}) });

const reasons = { Input, Selection, Output, Transport, Reply };

/** Restores a checked audit error without trusting a remote cause. */
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

/** Selects only a program's declared audit data, defaulting to message type. */
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
