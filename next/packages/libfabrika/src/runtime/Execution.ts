import { type AnyCmdDef, type Tagged } from "@demlik/tea";
import { Cause, Effect, Option, Result, Schema } from "effect";
import * as Redacted from "effect/Redacted";
import * as Audit from "./Audit.ts";
import { Deliveries } from "./internal/recovery.ts";
import { Admission, type Input, ProgramDown, stepper, Step, type Prepared, type Stepper } from "./Program.ts";
import { Saved } from "./State.ts";

const Upgraded = Schema.Struct({ saved: Saved, ran: Schema.Array(Schema.String) });

const Outcome = Schema.TaggedUnion({
  Ok: { value: Schema.Unknown, at: Schema.Number },
  Err: {
    error: Schema.declare<Tagged>(
      (value): value is Tagged =>
        typeof value === "object" && value !== null && "_tag" in value && typeof value._tag === "string",
    ),
    at: Schema.Number,
  },
});

const Typed = Schema.Struct({ type: Schema.String });

// Match P37's deletable failure-content ceiling, half a Durable Object row.
const MOST_CONTENT = 1_000_000;

/** Program failures are checked RPC data; a rejected call is a transport failure. */
const Failure = {
  reason: ProgramDown.fields.reason,
  error: Schema.String,
  content: Schema.String.check(Schema.isMaxLength(MOST_CONTENT)),
};

export const ExecutionFailure = Schema.TaggedStruct("ProgramDown", Failure);

/** A program's own throw rides in deletable content; a cause the runtime kept for diagnosis,
 *  which may hold the input that failed, never leaves memory. */
const shown = (error: ProgramDown): unknown =>
  !Object.hasOwn(error, "cause")
    ? error
    : error.error === "ProgramDown"
      ? new ProgramDown({ reason: error.reason, error: error.error })
      : error.cause;

export const executionFailure = (error: ProgramDown) =>
  ExecutionFailure.make({
    reason: error.reason,
    error: error.errorClass,
    content: Cause.pretty(Cause.fail(shown(error))).slice(0, MOST_CONTENT),
  });

const programFailure = (failure: typeof ExecutionFailure.Type) => {
  // Restore only checked text, never an arbitrary remote object or prototype.
  const cause = new Error(failure.content);
  cause.stack = failure.content;
  return new ProgramDown({ reason: failure.reason, error: failure.error, cause });
};

/** A checked reply failure crosses RPC as data; a rejected call remains an RPC failure. */
export const Reply = Schema.TaggedUnion({
  ok: { value: Schema.Json },
  ProgramDown: Failure,
});

export const Declaration = Schema.Struct({
  name: Schema.String,
  v: Schema.Int,
  maxDeliveries: Schema.optionalKey(Deliveries),
  writes: Schema.Record(Schema.String, Schema.Struct({ personOnly: Schema.Boolean })),
  /** Each input port: whether it takes writes, and whether only a person may send it. */
  inputs: Schema.Record(Schema.String, Schema.Struct({ write: Schema.Boolean, personOnly: Schema.Boolean })),
  cmds: Schema.Array(Schema.String),
});
export type Declaration = typeof Declaration.Type;

export type ProgramSource = { readonly hash: string; readonly source: string };

export type Execution = {
  readonly fresh: (model: unknown, msg: unknown) => Effect.Effect<Admission, ProgramDown>;
  readonly update: (model: unknown, msg: unknown) => Effect.Effect<Prepared, ProgramDown>;
  readonly audit: (msg: unknown) => Effect.Effect<Schema.Json, Audit.AuditError>;
  readonly init: (saved: unknown) => Effect.Effect<Step, ProgramDown>;
  readonly step: (model: unknown, msg: unknown) => Effect.Effect<Step, ProgramDown>;
  readonly fold: (model: unknown, msg: unknown) => Effect.Effect<Step, ProgramDown>;
  readonly upgrade: (saved: unknown) => Effect.Effect<typeof Upgraded.Type, ProgramDown>;
  readonly reply: (cmd: unknown, outcome: unknown) => Effect.Effect<Schema.Json, ProgramDown>;
  readonly check: (kind: string, event: unknown) => Effect.Effect<boolean, ProgramDown>;
  /** Whether a stamped input decodes against its write port's schema, checked inside the box. */
  readonly admit: (m: unknown) => Effect.Effect<boolean, ProgramDown>;
};

export type ExecutionCalls = {
  readonly fresh: (model: unknown, msg: unknown) => Promise<unknown>;
  readonly update: (model: unknown, msg: unknown) => Promise<unknown>;
  readonly audit: (msg: unknown) => Promise<unknown>;
  readonly init: (saved: unknown) => Promise<unknown>;
  readonly step: (model: unknown, msg: unknown) => Promise<unknown>;
  readonly fold: (model: unknown, msg: unknown) => Promise<unknown>;
  readonly upgrade: (saved: unknown) => Promise<unknown>;
  readonly reply: (cmd: unknown, outcome: unknown) => Promise<unknown>;
  readonly check?: (kind: string, event: unknown) => Promise<unknown>;
  readonly admit?: (m: unknown) => Promise<unknown>;
};

const attempt = <A>(reason: ProgramDown["reason"], f: () => A) =>
  Effect.try({
    try: f,
    catch: (cause) => (cause instanceof ProgramDown ? cause : new ProgramDown({ reason, cause })),
  });

const isCodec = (schema: unknown): schema is Schema.Codec<unknown, unknown> => Schema.isSchema(schema);

/** A Cmd answer as its schema encodes it, as JSON; a schema that is not a codec answers nothing. */
const encodeAnswer = (schema: unknown, value: unknown): Schema.Json => {
  if (!isCodec(schema)) {
    throw new ProgramDown({ reason: "step" });
  }

  return Schema.decodeUnknownSync(Schema.Json)(Schema.encodeUnknownSync(schema)(value));
};

/** True when `m` names a write port and decodes against that port's schema. */
const admits = (inputs: Readonly<Record<string, Input>>, m: unknown): boolean => {
  const typed = Schema.decodeUnknownOption(Typed)(m);

  if (Option.isNone(typed) || !Object.hasOwn(inputs, typed.value.type)) {
    return false;
  }

  const port = inputs[typed.value.type];
  return port !== undefined && port._tag === "write" && Result.isSuccess(Schema.decodeUnknownResult(port.schema)(m));
};

const reply = (defs: ReadonlyArray<AnyCmdDef>, cmd: unknown, raw: unknown): Schema.Json => {
  const type = Schema.decodeUnknownSync(Typed)(cmd).type;
  const def = defs.find((d) => d.cmdType === type);

  if (def === undefined) {
    throw new ProgramDown({ reason: "step" });
  }

  const outcome = Schema.decodeUnknownSync(Outcome)(raw);

  if (outcome._tag === "Ok") {
    return Schema.decodeUnknownSync(Schema.Json)({
      type: def.okType,
      cmd,
      value: encodeAnswer(def.schema.ok, outcome.value),
      at: outcome.at,
    });
  }

  const tag = outcome.error._tag;

  if (!def.errTags.includes(tag)) {
    throw new ProgramDown({ reason: "step" });
  }

  return Schema.decodeUnknownSync(Schema.Json)({
    type: def.errType,
    cmd,
    error: encodeAnswer(Schema.TaggedStruct(tag, {}), outcome.error),
    at: outcome.at,
  });
};

export const nodeExecution = (declared: unknown, build = "node"): Execution => {
  const pure = Effect.fromResult(stepper(declared)).pipe(
    Effect.mapError((cause) => new ProgramDown({ reason: "load", error: "ProgramDown", cause })),
  );
  const run = <A>(reason: ProgramDown["reason"], f: (pure: Stepper) => A) =>
    pure.pipe(Effect.flatMap((loaded) => attempt(reason, () => f(loaded))));
  return {
    init: Effect.fn("execution.init")((saved) => run("load", (pure) => pure.init(saved))),
    step: Effect.fn("execution.step")((model, msg) => run("step", (pure) => pure.step(model, msg))),
    fresh: Effect.fn("execution.fresh")((model, msg) =>
      pure.pipe(Effect.flatMap((pure) => Effect.fromResult(pure.fresh(model, msg)))),
    ),
    update: Effect.fn("execution.update")((model, msg) =>
      pure.pipe(Effect.flatMap((pure) => Effect.fromResult(pure.update(model, msg)))),
    ),
    audit: Effect.fn("execution.audit")((msg) =>
      pure.pipe(
        Effect.mapError((cause) => new Audit.AuditError({ reason: new Audit.Input({ cause: Redacted.make(cause) }) })),
        Effect.flatMap((pure) => Effect.fromResult(Audit.select(pure.program, msg))),
      ),
    ),
    fold: Effect.fn("execution.fold")((model, msg) => run("saved_letter", (pure) => pure.fold(model, msg))),
    upgrade: Effect.fn("execution.upgrade")((saved) =>
      run("saved_state", (pure) => Saved.upgrade(saved, pure.program.state, build)),
    ),
    reply: Effect.fn("execution.reply")((cmd, outcome) =>
      run("step", (pure) => reply(pure.program.machine.cmds ?? [], cmd, outcome)),
    ),
    admit: Effect.fn("execution.admit")((m) => run("step", (pure) => admits(pure.program.inputs, m))),
    check: Effect.fn("execution.check")((kind, event) =>
      run("step", (pure) => {
        const policy = pure.program.writes[kind];
        return policy !== undefined && Result.isSuccess(Schema.decodeUnknownResult(policy.schema)(event));
      }),
    ),
  };
};

const invoke = (binding: ExecutionCalls, key: keyof ExecutionCalls, args: ReadonlyArray<unknown>) => {
  const method = binding[key];

  if (method === undefined) {
    return Effect.fail(new Error("missing execution method"));
  }

  // oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader step RPC enters Effect
  return Effect.tryPromise({ try: () => Reflect.apply(method, binding, args), catch: (cause) => cause });
};

export const workerExecution = (binding: ExecutionCalls): Execution => {
  const call = (method: keyof ExecutionCalls, args: ReadonlyArray<unknown>, reason: ProgramDown["reason"]) =>
    invoke(binding, method, args).pipe(Effect.mapError((cause) => new ProgramDown({ reason, source: "rpc", cause })));
  const ask = <A>(
    schema: Schema.Decoder<A>,
    work: Effect.Effect<unknown, ProgramDown>,
    reason: ProgramDown["reason"],
  ) =>
    work.pipe(
      Effect.flatMap((raw) => {
        const failed = Schema.decodeUnknownResult(ExecutionFailure)(raw);

        if (Result.isSuccess(failed)) {
          return Effect.fail(programFailure(failed.success));
        }

        const decoded = Schema.decodeUnknownResult(schema)(raw);
        return Result.isSuccess(decoded)
          ? Effect.succeed(decoded.success)
          : Effect.fail(new ProgramDown({ reason, source: "decode", cause: decoded.failure }));
      }),
    );
  return {
    fresh: Effect.fn("execution.fresh")((model, msg) => ask(Admission, call("fresh", [model, msg], "step"), "step")),
    update: Effect.fn("execution.update")((model, msg) =>
      ask(Step.cases.stepped, call("update", [model, msg], "step"), "step"),
    ),
    audit: Effect.fn("execution.audit")((msg) =>
      invoke(binding, "audit", [msg]).pipe(
        Effect.mapError(
          (cause) => new Audit.AuditError({ reason: new Audit.Transport({ cause: Redacted.make(cause) }) }),
        ),
        Effect.flatMap((raw) =>
          Schema.decodeUnknownEffect(Audit.Answer)(raw).pipe(
            Effect.mapError(
              (cause) => new Audit.AuditError({ reason: new Audit.Reply({ cause: Redacted.make(cause) }) }),
            ),
          ),
        ),
        Effect.flatMap((answer) =>
          answer._tag === "ok" ? Effect.succeed(answer.value) : Effect.fail(Audit.restore(answer)),
        ),
      ),
    ),
    init: Effect.fn("execution.init")((saved) => ask(Step, call("init", [saved], "load"), "load")),
    step: Effect.fn("execution.step")((model, msg) => ask(Step, call("step", [model, msg], "step"), "step")),
    fold: Effect.fn("execution.fold")((model, msg) =>
      ask(Step, call("fold", [model, msg], "saved_letter"), "saved_letter"),
    ),
    upgrade: Effect.fn("execution.upgrade")((saved) =>
      ask(Upgraded, call("upgrade", [saved], "saved_state"), "saved_state"),
    ),
    reply: Effect.fn("execution.reply")((cmd, outcome) =>
      ask(Reply, call("reply", [cmd, outcome], "step"), "step").pipe(
        Effect.flatMap((answer) =>
          answer._tag === "ok" ? Effect.succeed(answer.value) : Effect.fail(programFailure(answer)),
        ),
      ),
    ),
    check: Effect.fn("execution.check")((kind, event) =>
      ask(Schema.Boolean, call("check", [kind, event], "step"), "step"),
    ),
    admit: Effect.fn("execution.admit")((m) => ask(Schema.Boolean, call("admit", [m], "step"), "step")),
  };
};
