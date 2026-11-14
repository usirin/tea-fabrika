/**
 * How the runner runs a program's pure steps: in this process, or over RPC to the box the program
 * runs in on a Worker. Both give the runner the same `Execution`, and a program failure crosses
 * the RPC as checked data.
 *
 * @stability unstable
 */
import { type AnyCmdDef, type Tagged } from "@demlik/tea";
import { Cause, Context, Effect, Option, Result, Schema } from "effect";
import { Deliveries, Policy } from "./internal/recovery.ts";
import { type Input, ProgramDown, stepper, Step, type Stepper } from "./Program.ts";
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

// Match the deletable failure-content ceiling, half a Durable Object row.
const MOST_CONTENT = 1_000_000;

/** Program failures are checked RPC data; a rejected call is a transport failure. */
const Failure = {
  reason: ProgramDown.fields.reason,
  error: Schema.String,
  content: Schema.String.check(Schema.isMaxLength(MOST_CONTENT)),
};

/**
 * Schema for a program failure as it crosses the RPC from a program's box: the `ProgramDown`
 * reason, the class of what was thrown, and its printed content, at most 1,000,000 characters.
 *
 * @stability unstable
 * @category schemas
 */
export const ExecutionFailure = Schema.TaggedStruct("ProgramDown", Failure);

/** A program's own throw rides in deletable content; a cause the runtime kept for diagnosis,
 *  which may hold the input that failed, never leaves memory. */
const shown = (error: ProgramDown): unknown =>
  !Object.hasOwn(error, "cause")
    ? error
    : error.error === "ProgramDown"
      ? new ProgramDown({ reason: error.reason, error: error.error })
      : error.cause;

/**
 * Converts a `ProgramDown` into the `ExecutionFailure` a program's box replies with.
 *
 * **Details**
 *
 * A program's own throw is printed into `content`. A cause the runtime kept only for diagnosis,
 * which may hold the input that failed, is left out: only its reason and class cross.
 *
 * @stability unstable
 * @category constructors
 */
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

/**
 * Schema for what the runner knows of a loaded program without holding its code: its name, its
 * saved-state version, its delivery limit and restart policy when it declares them, the events it
 * may write, its input ports, and its Cmd types.
 *
 * @stability unstable
 * @category schemas
 */
export const Declaration = Schema.Struct({
  name: Schema.String,
  v: Schema.Int,
  maxDeliveries: Schema.optionalKey(Deliveries),
  policy: Schema.optionalKey(Policy),
  writes: Schema.Record(Schema.String, Schema.Struct({ personOnly: Schema.Boolean })),
  /** Each input port: whether it takes writes, and whether only a person may send it. */
  inputs: Schema.Record(Schema.String, Schema.Struct({ write: Schema.Boolean, personOnly: Schema.Boolean })),
  cmds: Schema.Array(Schema.String),
});
/**
 * A loaded program's checked declaration, as `Declaration` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Declaration = typeof Declaration.Type;

/**
 * One program's compiled source and the hash of it, as the build hands it to the Worker's loader.
 *
 * @stability unstable
 * @category models
 */
export type ProgramSource = { readonly hash: string; readonly source: string };

/**
 * A program's pure steps as the runner calls them. Each is an Effect that fails with
 * `ProgramDown`.
 *
 * **Details**
 *
 * `init`, `step` and `fold` answer a `Step`. `upgrade` climbs a saved model to the program's
 * current version. `reply` turns a Cmd's outcome into the settled Msg the program is told. `check`
 * says whether an event passes the schema of the write the program declared under `kind`.
 *
 * @stability unstable
 * @category models
 */
export type Execution = {
  readonly init: (saved: unknown) => Effect.Effect<Step, ProgramDown>;
  readonly step: (model: unknown, msg: unknown) => Effect.Effect<Step, ProgramDown>;
  readonly fold: (model: unknown, msg: unknown) => Effect.Effect<Step, ProgramDown>;
  readonly upgrade: (saved: unknown) => Effect.Effect<typeof Upgraded.Type, ProgramDown>;
  readonly reply: (cmd: unknown, outcome: unknown) => Effect.Effect<Schema.Json, ProgramDown>;
  readonly check: (kind: string, event: unknown) => Effect.Effect<boolean, ProgramDown>;
  /** Whether a stamped input decodes against its write port's schema, checked inside the box. */
  readonly admit: (m: unknown) => Effect.Effect<boolean, ProgramDown>;
};

/**
 * The RPC methods a program's box offers: the platform's side of `Execution`, as Promises. `check`
 * and `admit` are optional, and a box without one fails that call with `ProgramDown` `load`.
 *
 * @stability unstable
 * @category models
 */
export type ExecutionCalls = {
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

/**
 * Builds an `Execution` that steps a program in this process, from its declaration.
 *
 * **Details**
 *
 * The declaration is checked once, when the execution is built, and a bad one fails every call
 * with `load`. A throw inside a call becomes `ProgramDown` with that call's reason: `load` for
 * `init`, `saved_letter` for `fold`, `saved_state` for `upgrade`, and `step` for the rest. `build`
 * is stamped on a model that `upgrade` saves.
 *
 * @stability unstable
 * @category constructors
 */
export const nodeExecution = (declared: unknown, build = "node"): Execution => {
  const pure = Effect.fromResult(stepper(declared)).pipe(
    Effect.mapError((cause) => new ProgramDown({ reason: "load", error: "ProgramDown", cause })),
  );
  const run = <A>(reason: ProgramDown["reason"], f: (pure: Stepper) => A) =>
    pure.pipe(Effect.flatMap((loaded) => attempt(reason, () => f(loaded))));
  return {
    init: Effect.fn("execution.init")((saved) => run("load", (pure) => pure.init(saved))),
    step: Effect.fn("execution.step")((model, msg) => run("step", (pure) => pure.step(model, msg))),
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

class ExecutionClient extends Context.Service<
  ExecutionClient,
  {
    readonly [K in keyof Execution]: (...args: Parameters<Execution[K]>) => Effect.Effect<unknown, ProgramDown>;
  }
>()("@kampus/libfabrika/runtime/Execution.ExecutionClient") {
  static make(rpc: ExecutionCalls): ExecutionClient["Service"] {
    return {
      init: (saved) => {
        const fail = (cause: unknown) => new ProgramDown({ reason: "load", source: "rpc", cause });
        // oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader init RPC enters Effect
        return Effect.tryPromise({ try: () => rpc.init(saved), catch: fail });
      },
      step: (model, msg) => {
        const fail = (cause: unknown) => new ProgramDown({ reason: "step", source: "rpc", cause });
        // oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader step RPC enters Effect
        return Effect.tryPromise({ try: () => rpc.step(model, msg), catch: fail });
      },
      fold: (model, msg) => {
        const fail = (cause: unknown) => new ProgramDown({ reason: "saved_letter", source: "rpc", cause });
        // oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader fold RPC enters Effect
        return Effect.tryPromise({ try: () => rpc.fold(model, msg), catch: fail });
      },
      upgrade: (saved) => {
        const fail = (cause: unknown) => new ProgramDown({ reason: "saved_state", source: "rpc", cause });
        // oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader upgrade RPC enters Effect
        return Effect.tryPromise({ try: () => rpc.upgrade(saved), catch: fail });
      },
      reply: (cmd, outcome) => {
        const fail = (cause: unknown) => new ProgramDown({ reason: "step", source: "rpc", cause });
        // oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader reply RPC enters Effect
        return Effect.tryPromise({ try: () => rpc.reply(cmd, outcome), catch: fail });
      },
      check: (kind, event) => {
        const check = rpc.check;

        if (check === undefined) {
          return Effect.fail(new ProgramDown({ reason: "load" }));
        }

        const fail = (cause: unknown) => new ProgramDown({ reason: "step", source: "rpc", cause });
        const args: Parameters<typeof check> = [kind, event];
        // Reflect.apply keeps this without reading a remote method named call off the stub.
        // oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader check RPC enters Effect
        return Effect.tryPromise({ try: () => Reflect.apply(check, rpc, args), catch: fail });
      },
      admit: (m) => {
        const admit = rpc.admit;

        if (admit === undefined) {
          return Effect.fail(new ProgramDown({ reason: "load" }));
        }

        const fail = (cause: unknown) => new ProgramDown({ reason: "step", source: "rpc", cause });
        // oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader admit RPC enters Effect
        return Effect.tryPromise({ try: () => Reflect.apply(admit, rpc, [m]), catch: fail });
      },
    };
  }
}

/**
 * Builds an `Execution` that steps a program inside its box, over the box's RPC.
 *
 * **Details**
 *
 * Each reply is decoded before the runner sees it. A reply that is an `ExecutionFailure` becomes
 * the `ProgramDown` it names, with its content as the cause.
 *
 * **Gotchas**
 *
 * A rejected call fails with `source: "rpc"`, and a reply that does not decode with
 * `source: "decode"`. Neither decided anything about the input, so the call must be tried again.
 *
 * @stability unstable
 * @category constructors
 */
export const workerExecution = (binding: ExecutionCalls): Execution => {
  const rpc = ExecutionClient.make(binding);
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
    init: Effect.fn("execution.init")((saved) => ask(Step, rpc.init(saved), "load")),
    step: Effect.fn("execution.step")((model, msg) => ask(Step, rpc.step(model, msg), "step")),
    fold: Effect.fn("execution.fold")((model, msg) => ask(Step, rpc.fold(model, msg), "saved_letter")),
    upgrade: Effect.fn("execution.upgrade")((saved) => ask(Upgraded, rpc.upgrade(saved), "saved_state")),
    reply: Effect.fn("execution.reply")((cmd, outcome) =>
      ask(Reply, rpc.reply(cmd, outcome), "step").pipe(
        Effect.flatMap((answer) =>
          answer._tag === "ok" ? Effect.succeed(answer.value) : Effect.fail(programFailure(answer)),
        ),
      ),
    ),
    check: Effect.fn("execution.check")((kind, event) => ask(Schema.Boolean, rpc.check(kind, event), "step")),
    admit: Effect.fn("execution.admit")((m) => ask(Schema.Boolean, rpc.admit(m), "step")),
  };
};
