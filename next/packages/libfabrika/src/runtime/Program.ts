/**
 * A program: a pure tea machine and the declarations the runner checks it by. A program gets no
 * sender, key, ledger or service. `stepper` steps it by hand, as Elm's runtime would, and never
 * runs a Cmd: the runner does that, after the input is saved.
 *
 * @stability unstable
 */
import { applyCell, msgKeysOf, type AnyCmdDef } from "@demlik/tea";
import { Effect, Option, Predicate, Result, Schema, type SchemaIssue } from "effect";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { ParentText } from "../coordination/index.ts";
import { Deliveries, Policy } from "./internal/recovery.ts";

/** A function type whose parameters TypeScript checks both ways, as it does a method's: a program
 *  declares `(model: Model) => …`, and the runner calls it with the model it decoded. */
type Code<A extends ReadonlyArray<unknown>, R> = { call(...args: A): R }["call"];

/** A schema a program declares. It decodes and encodes without services. */
type Declared = Schema.Codec<unknown, unknown>;
const isDeclared = (u: unknown): u is Declared => Schema.isSchema(u);
const isCode = <F>(u: unknown): u is F => Predicate.isFunction(u);

const code = <F>(expected: string) => Schema.declare((u: unknown): u is F => isCode<F>(u), { expected });

/** What the runner needs of a tea machine: its update table, its Cmd definitions and its init. */
type Steps = {
  readonly update: object;
  readonly cmds?: ReadonlyArray<AnyCmdDef>;
  readonly init: Code<[loaded: unknown, ctx: unknown], readonly [unknown, ReadonlyArray<unknown>]>;
};

/** `typeof` says "object": null too, but no function. The null check is a second read, as it was. */
const isObjectOrNull = (u: unknown): u is object | null => Predicate.isObjectOrArray(u) || Predicate.isNull(u);

const isSteps = (u: unknown): u is Steps =>
  Predicate.isObjectOrArray(u) &&
  Predicate.hasProperty(u, "update") &&
  isObjectOrNull(u.update) &&
  Predicate.isNotNull(u.update) &&
  Predicate.hasProperty(u, "init") &&
  Predicate.isFunction(u.init);

const Schemas = Schema.declare(isDeclared, { expected: "a schema" });

/** A program's refusal: reason, and the numbers that explain it. */
export const Refusal = Schema.Struct({
  reason: Schema.String,
  now: Schema.optionalKey(Schema.Number),
  most: Schema.optionalKey(Schema.Number),
});
/**
 * A program's own no to a fresh Msg, as `Refusal` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Refusal = typeof Refusal.Type;

const Upgrade = Schema.Struct({
  name: Schema.NonEmptyString,
  /** Advances a saved model from `from` to `from + 1`. */
  from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  run: code<Code<[raw: unknown], unknown>>("an upgrade function"),
});

/**
 * Schema for the saved model's shape: its version, its schema and the named upgrades that reach it.
 *
 * @stability unstable
 * @category schemas
 */
export const State = Schema.Struct({
  v: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  schema: Schemas,
  upgrades: Schema.Array(Upgrade),
});
/**
 * The saved model's shape, as `State` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type State = typeof State.Type;

/** A port a client may use. A write port takes an input; a read port answers from the view. The
 *  two are exclusive: a read port carries no `personOnly`, and a write port no answer. */
const InputSchema = Schema.TaggedUnion({
  write: {
    schema: Schemas,
    description: Schema.String,
    personOnly: Schema.Boolean,
    answer: Schema.optionalKey(Schema.Never),
  },
  read: {
    schema: Schemas,
    description: Schema.String,
    answer: code<Code<[view: unknown, input: unknown], unknown>>("a read answer"),
    personOnly: Schema.optionalKey(Schema.Never),
  },
});

/**
 * One input port of a program: a write port, which takes an input, or a read port, which answers
 * from the view.
 *
 * @stability unstable
 * @category models
 */
export type Input = typeof InputSchema.Type;

type ReadPort<Q extends Declared, A> = Omit<typeof InputSchema.cases.read.Type, "schema" | "answer"> & {
  readonly schema: Q;
  readonly description: string;
  readonly answer: A;
};

const readInput = InputSchema.cases.read.make;
const writeInput = InputSchema.cases.write.make;

const readPort = <Q extends Declared, A extends (view: never, input: NoInfer<Q["Type"]>) => unknown>(
  spec: Omit<ReadPort<Q, A>, "_tag">,
): ReadPort<Q, A> => ({ ...readInput(spec), schema: spec.schema, answer: spec.answer });

const writePort = <Q extends Declared>(
  spec: Omit<typeof InputSchema.cases.write.Type, "_tag" | "schema"> & { readonly schema: Q },
) => ({ ...writeInput(spec), schema: spec.schema });

type InputConstructors = Omit<typeof InputSchema, "cases"> & {
  readonly cases: {
    readonly read: Omit<typeof InputSchema.cases.read, "make"> & { readonly make: typeof readPort };
    readonly write: Omit<typeof InputSchema.cases.write, "make"> & {
      readonly make: typeof writePort;
    };
  };
};

const readCase = Schema.make<InputConstructors["cases"]["read"]>(InputSchema.cases.read.ast, {
  fields: InputSchema.cases.read.fields,
});

const writeCase = Schema.make<InputConstructors["cases"]["write"]>(InputSchema.cases.write.ast, {
  fields: InputSchema.cases.write.fields,
});

Object.defineProperty(readCase, "make", { value: readPort });
Object.defineProperty(writeCase, "make", { value: writePort });

/**
 * Schema for one input port of a program, kept in `inputs` under its Msg `type`.
 *
 * **Details**
 *
 * A write port takes an input and may be `personOnly`. A read port answers from the view with its
 * `answer` function and changes nothing. The two exclude each other: a read port carries no
 * `personOnly`, and a write port no `answer`. `Input.cases.read.make` and `Input.cases.write.make`
 * keep the port's own schema type, so TypeScript checks a read port's `answer` against the input
 * that port declares.
 *
 * @stability unstable
 * @category schemas
 */
export const Input = Schema.make<InputConstructors>(InputSchema.ast, {
  ...InputSchema,
  cases: { read: readCase, write: writeCase },
});

/** An event a program may write: its schema, and whether only a person's input may cause it. This is
 *  the trusted policy the door checks. Elm outputs never authorize a ledger write. */
export const EventPolicy = Schema.Struct({ schema: Schemas, personOnly: Schema.Boolean });
/**
 * One row of a program's `writes`, as `EventPolicy` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type EventPolicy = typeof EventPolicy.Type;

const Declaration = Schema.Struct({
  name: Schema.NonEmptyString,
  /** How many times one letter is tried before it is dead. Absent: the selected policy's limit. */
  maxDeliveries: Schema.optionalKey(Deliveries),
  /** Restart rules for a new recovery journal; existing journals keep their saved policy. */
  policy: Schema.optionalKey(Policy),
  machine: Schema.declare(isSteps, { expected: "a tea machine" }),
  state: State,
  msg: Schemas,
  view: Schema.Struct({
    data: Schemas,
    select: code<Code<[model: unknown], unknown>>("a view selector"),
  }),
  refuse: code<Code<[model: unknown, msg: unknown], unknown>>("a refusal check"),
  inputs: Schema.Record(Schema.String, Input),
  outputs: Schema.Record(Schema.String, Schemas),
  writes: Schema.Record(Schema.String, EventPolicy),
  wake: code<Code<[model: unknown], unknown>>("a wake time"),
});

type Typed = { readonly type: string };

type ProgramMachine = Steps & {
  readonly model: Schema.Schema<unknown>;
  readonly msg: Schema.Schema<Typed>;
};

type Description =
  | string
  | {
      readonly description: string;
      readonly personOnly: true;
      readonly schema?: never;
      readonly answer?: never;
    };

type Port<M extends Typed, K, P> = P extends Pick<typeof InputSchema.cases.read.Type, "_tag"> & {
  readonly schema: infer Q extends Declared;
}
  ? P extends ReadPort<Q, (view: never, input: Q["Type"]) => unknown>
    ? P
    : never
  : K extends M["type"]
    ? Description
    : never;

type Ports<M extends Typed, I> = {
  readonly [K in keyof I]: Port<M, K, I[K]>;
};

type ReadView<P> = P extends Pick<typeof InputSchema.cases.read.Type, "_tag"> & {
  readonly answer: (view: infer V, ...args: never[]) => unknown;
}
  ? (view: V) => void
  : never;

// Check the selector's result after inferring ports. Checking read answers against V first
// makes a nested Input constructor fix V to Json before the selector can infer it.
type ViewFor<I> = {
  readonly [K in keyof I]: ReadView<I[K]>;
}[keyof I] extends (view: infer V) => void
  ? V
  : unknown;

type Policies<W> = {
  readonly [K in keyof W]: {
    readonly schema: Schema.Codec<Schema.TaggedStruct<K & string, Record<never, never>>["Type"], unknown>;
    readonly personOnly: boolean;
  };
};

type Spec<T extends ProgramMachine, V extends Schema.Json, I, O, W> = {
  readonly name: string;
  readonly maxDeliveries?: number;
  readonly policy?: Policy;
  readonly machine: T;
  readonly state: Omit<State, "schema"> & { readonly schema?: never };
  readonly msg?: never;
  readonly view: (model: NoInfer<T["model"]["Type"]>) => V & NoInfer<ViewFor<I>>;
  readonly refuse: (model: NoInfer<T["model"]["Type"]>, msg: NoInfer<T["msg"]["Type"]>) => Refusal | null;
  readonly inputs: I & Ports<NoInfer<T["msg"]["Type"]>, I>;
  readonly outputs: O;
  readonly writes: W & Policies<W>;
  readonly wake: (model: NoInfer<T["model"]["Type"]>) => number | null;
};

type FilledPort<T extends ProgramMachine, P> =
  P extends Pick<typeof InputSchema.cases.read.Type, "_tag">
    ? P
    : Omit<typeof InputSchema.cases.write.Type, "schema"> & { readonly schema: T["msg"] & Declared };

type FilledPorts<T extends ProgramMachine, I> = {
  readonly [K in keyof I]: FilledPort<T, I[K]>;
};

/** Concrete types stay with authored programs. The loader uses the checked, erased declaration. */
export type Program<
  T extends ProgramMachine = ProgramMachine,
  V extends Schema.Json = Schema.Json,
  I = Record<string, Input>,
  O = Record<string, Declared>,
  W = Record<string, EventPolicy>,
> = {
  readonly name: string;
  readonly maxDeliveries?: number;
  readonly policy?: Policy;
  readonly machine: T;
  readonly state: Omit<State, "schema"> & { readonly schema: T["model"] & Declared };
  readonly msg: T["msg"] & Declared;
  readonly view: {
    readonly data: typeof Schema.Json;
    readonly select: (model: T["model"]["Type"]) => V;
  };
  readonly refuse: (model: T["model"]["Type"], msg: T["msg"]["Type"]) => Refusal | null;
  readonly inputs: FilledPorts<T, I>;
  readonly outputs: O;
  readonly writes: W;
  readonly wake: (model: T["model"]["Type"]) => number | null;
};

const Authoring = Schema.Struct({
  name: Declaration.fields.name,
  maxDeliveries: Declaration.fields.maxDeliveries,
  policy: Declaration.fields.policy,
  machine: Schema.declare(
    (u): u is ProgramMachine & { readonly model: Declared; readonly msg: Declared } =>
      isSteps(u) && "model" in u && isDeclared(u.model) && "msg" in u && isDeclared(u.msg),
    { expected: "a tea machine with model and Msg schemas" },
  ),
  state: Schema.Struct({ v: State.fields.v, upgrades: State.fields.upgrades }),
  view: code<Code<[model: unknown], unknown>>("a view selector"),
  inputs: Schema.Record(
    Schema.String,
    Schema.Union([
      Schema.String,
      Schema.Struct({ description: Schema.String, personOnly: Schema.Literal(true) }),
      InputSchema.cases.read,
    ]),
  ),
  refuse: Declaration.fields.refuse,
  outputs: Declaration.fields.outputs,
  writes: Declaration.fields.writes,
  wake: Declaration.fields.wake,
});

const decodeDeclaration = Schema.decodeUnknownResult(Declaration);
const decodeAuthoring = Schema.decodeUnknownResult(Authoring);

const construct = (raw: unknown) =>
  Result.flatMap(decodeAuthoring(raw), (spec) =>
    decodeDeclaration({
      ...spec,
      state: { ...spec.state, schema: spec.machine.model },
      msg: spec.machine.msg,
      view: { data: Schema.Json, select: spec.view },
      inputs: Object.fromEntries(
        Object.entries(spec.inputs).map(([key, port]) => [
          key,
          typeof port !== "string" && "_tag" in port
            ? port
            : Input.cases.write.make({
                schema: spec.machine.msg,
                description: typeof port === "string" ? port : port.description,
                personOnly: typeof port !== "string",
              }),
        ]),
      ),
    }),
  );

// Schema checks callable fields; the spec's types check the signatures without calling them.
const typedProgram = <T extends ProgramMachine, V extends Schema.Json, I, O, W>(spec: Spec<T, V, I, O, W>) =>
  Schema.declare(
    (u): u is Program<T, V, I, O, W> =>
      Result.isSuccess(decodeDeclaration(u)) &&
      Predicate.isObjectOrArray(u) &&
      Predicate.hasProperty(u, "machine") &&
      u.machine === spec.machine,
    { expected: "the checked program" },
  );

const make = <
  T extends ProgramMachine,
  V extends Schema.Json,
  const I extends Readonly<Record<string, unknown>>,
  O extends Readonly<Record<string, Declared>>,
  W extends Readonly<Record<string, EventPolicy>>,
>(
  spec: Spec<T, V, I, O, W>,
): Program<T, V, I, O, W> => {
  const checked = construct(spec);

  if (Result.isFailure(checked)) {
    throw checked.failure;
  }

  return Schema.decodeUnknownSync(typedProgram(spec))(checked.success);
};

const makeEffect = Effect.fn("program.make")(function* <
  T extends ProgramMachine,
  V extends Schema.Json,
  const I extends Readonly<Record<string, unknown>>,
  O extends Readonly<Record<string, Declared>>,
  W extends Readonly<Record<string, EventPolicy>>,
>(spec: Spec<T, V, I, O, W>): Effect.fn.Return<Program<T, V, I, O, W>, SchemaIssue.Issue> {
  const checked = construct(spec);

  if (Result.isFailure(checked)) {
    return yield* Effect.fail(checked.failure.issue);
  }

  return yield* Schema.decodeUnknownEffect(typedProgram(spec))(checked.success).pipe(
    Effect.mapError((error) => error.issue),
  );
});

/**
 * The constructors of a program, and the check a loader runs on one.
 *
 * **Details**
 *
 * `Program.make(spec)` builds one typed program from its machine and its declarations, and throws
 * when the spec does not pass its check, which suits trusted input. `Program.makeEffect(spec)`
 * does the same and fails with the schema issue instead. `Program.schema` is the declaration with
 * its types erased, which a loader decodes a program with.
 *
 * A spec writes nothing twice: the model's schema and the Msg schema come from the machine, and a
 * write port given as a description takes the machine's Msg schema.
 *
 * @stability unstable
 * @category constructors
 */
export const Program = { schema: Declaration, make, makeEffect };

type PortFields<M, K extends string> = M extends Typed ? (K extends M["type"] ? Omit<M, "type"> : never) : never;

type PortSchema<P extends typeof Declaration.Type, K extends string> = string extends K
  ? Declared
  : K extends keyof P["inputs"]
    ? P["inputs"][K] extends Pick<typeof InputSchema.cases.read.Type, "_tag"> & {
        readonly schema: infer S extends Declared;
      }
      ? S
      : unknown extends P["msg"]["Type"]
        ? Declared
        : Schema.Codec<PortFields<P["msg"]["Type"], K>, unknown>
    : Declared;

const Payload = Schema.Record(Schema.String, Schema.Json).check(
  Schema.makeFilter((value) => !Object.hasOwn(value, "type")),
);

const Fields = Schema.Record(Schema.String, Schema.Unknown);

/** Narrows a JSON value to its object case. `Predicate.isObject` alone leaves a type no rest pattern takes. */
const isJsonObject = (u: Schema.Json): u is Schema.JsonObject => Predicate.isObject(u);

// Keep the Msg's codecs and checks intact. Only add and remove the port's discriminator.
const writePortCodec = (msg: Declared, key: string) =>
  Payload.pipe(
    Schema.decodeTo(
      Schema.toCodecJson(msg),
      SchemaTransformation.transform<Schema.Json, Readonly<Record<string, Schema.Json>>>({
        decode: (value) => ({ ...value, type: key }),
        encode: (wire) => {
          if (!isJsonObject(wire)) {
            return {};
          }

          const { type: _, ...value } = wire;
          return value;
        },
      }),
    ),
    Schema.decodeTo(Fields.check(Schema.makeFilter((m) => m.type === key))),
    Schema.decodeTo(
      Fields,
      SchemaTransformation.transform({
        decode: (m) => {
          const { type: _, ...fields } = Predicate.isObject(m) ? m : {};
          return fields;
        },
        encode: (fields) => ({ ...fields, type: key }),
      }),
    ),
  );

/**
 * Returns the schema of one of a program's ports, or none when the program declares no port by
 * that name. A read port gives its own schema. A write port gives a codec for its Msg's fields
 * without `type`, which decodes and checks them with the Msg's own JSON codec.
 *
 * @stability unstable
 * @category getters
 */
export function port<P extends typeof Declaration.Type, K extends string>(
  program: P,
  key: K,
): Option.Option<PortSchema<P, K>>;
export function port(program: typeof Declaration.Type, key: string): Option.Option<Declared> {
  const input = Object.hasOwn(program.inputs, key) ? program.inputs[key] : undefined;

  if (input === undefined) {
    return Option.none();
  }

  if (input._tag === "read") {
    return Option.some(input.schema);
  }

  return Option.some(writePortCodec(program.msg, key));
}

/** A JSON object: an event as it travels inside a write. Its declared schema gives its `_tag`. */
const Event = Schema.Record(Schema.String, Schema.Json);

/** What a program asks to write: caused by an earlier input it names, or explicitly its own. */
export const Write = Schema.TaggedUnion({
  caused: { parent: ParentText, event: Event },
  own: { event: Event },
});
/**
 * What a program asks the runner to write, as `Write` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Write = typeof Write.Type;

/** One pure step's answer: the next model, view and Cmds as JSON, or a refusal. */
export const Step = Schema.TaggedUnion({
  stepped: {
    model: Schema.Json,
    view: Schema.Json,
    cmds: Schema.Array(Schema.Json),
    wake: Schema.NullOr(Schema.Number),
  },
  refused: Refusal.fields,
});
/**
 * One pure step's answer, as `Step` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Step = typeof Step.Type;

/** The program cannot run: it did not load, a fresh step threw or returned bad data, or saved
 *  state or a saved letter does not fold. Never a refusal: nothing was decided. */
export class ProgramDown extends Schema.TaggedError<ProgramDown>()("ProgramDown", {
  reason: Schema.Literals(["load", "no_program", "step", "saved_state", "saved_letter"]),
  /** An RPC or reply decode failure decided nothing about the input. It must be retried. */
  source: Schema.optionalKey(Schema.Literals(["rpc", "decode"])),
  /** The thrown class, preserved as checked data across Worker RPC. A failure the runtime
   *  translates names ProgramDown itself: the cause it keeps is for diagnosis in memory only. */
  error: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Unknown),
}) {
  get errorClass(): string {
    if (this.error !== undefined) {
      return this.error;
    }

    const original = Object.hasOwn(this, "cause") ? this.cause : this;
    return original instanceof Error ? original.constructor.name : original === null ? "null" : typeof original;
  }
}

/**
 * A program's pure steps, as `stepper` builds them: the checked program, and `init`, `step` and
 * `fold`.
 *
 * **Details**
 *
 * Each step answers a `Step` as JSON and runs no Cmd. They are plain functions: a failure is
 * thrown as `ProgramDown`, never returned.
 *
 * @stability unstable
 * @category models
 */
export type Stepper = {
  readonly program: typeof Declaration.Type;
  /** Boots from a saved model, or from nothing. */
  readonly init: (saved: unknown) => Step;
  /** A fresh input: checked, maybe refused, then stepped. */
  readonly step: (model: unknown, msg: unknown) => Step;
  /** A saved input: applied as it was accepted, never refused again. */
  readonly fold: (model: unknown, msg: unknown) => Step;
};

const decodeRefusal = Schema.decodeUnknownResult(Schema.NullOr(Refusal));
const decodeJson = Schema.decodeUnknownResult(Schema.Json);

const isTyped = (u: unknown): u is Typed =>
  Predicate.isObjectOrArray(u) && Predicate.hasProperty(u, "type") && Predicate.isString(u.type);

const decodeTyped = (u: unknown): Option.Option<Typed> => (isTyped(u) ? Option.some(u) : Option.none());

const decodeWake = Schema.decodeUnknownResult(Schema.NullOr(Schema.Number));

/** What each failed result failed with, in order: a check that meets several keeps them all. */
const failures = (results: ReadonlyArray<Result.Result<unknown, unknown>>): ReadonlyArray<unknown> =>
  results.flatMap((result) => (Result.isFailure(result) ? [result.failure] : []));

/** Runs `f`, turning any throw into ProgramDown with `reason`. */
const guard = <A>(reason: ProgramDown["reason"], f: () => A): A => {
  const done = Result.try({
    try: f,
    catch: (cause) => (cause instanceof ProgramDown ? cause : new ProgramDown({ reason, cause })),
  });

  if (Result.isFailure(done)) {
    throw done.failure;
  }

  return done.success;
};

/** tea keeps the Effect schema on its Standard Schema adapter. Decode it synchronously;
 *  an unknown validator cannot prove it will finish without making a Promise. */
const accepts = (schema: unknown, value: unknown): boolean =>
  isDeclared(schema) && Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

/** An error a Cmd settles with carries a string `_tag`. */
const isTagged = (u: unknown): boolean =>
  Predicate.isObjectOrArray(u) && Predicate.hasProperty(u, "_tag") && Predicate.isString(u._tag);

/** A settled Cmd Msg (`<name>_ok` or `<name>_err`) of a declared Cmd, checked by its schemas. */
const settled = (defs: ReadonlyArray<AnyCmdDef>, msg: unknown): Option.Option<boolean> => {
  const typed = decodeTyped(msg);

  if (Option.isNone(typed)) {
    return Option.none();
  }

  const type = typed.value.type;
  const def = defs.find((d) => d.okType === type || d.errType === type);

  if (def === undefined || !Predicate.isObjectOrArray(msg)) {
    return Option.none();
  }

  const cmd = Predicate.hasProperty(msg, "cmd") ? msg.cmd : undefined;
  const sameCmd = Option.exists(decodeTyped(cmd), (c) => c.type === def.cmdType);

  if (!sameCmd || !Predicate.hasProperty(msg, "at") || !Predicate.isNumber(msg.at)) {
    return Option.some(false);
  }

  if (type === def.okType) {
    return Option.some(Predicate.hasProperty(msg, "value") && accepts(def.schema.ok, msg.value));
  }

  const error = Predicate.hasProperty(msg, "error") ? msg.error : undefined;
  return Option.some(isTagged(error));
};

/**
 * Builds a program's pure stepper from its declaration, or fails with the schema error when the
 * declaration does not pass its check.
 *
 * **Details**
 *
 * - `init` boots from a saved model, or from nothing when `saved` is null.
 * - `step` takes a fresh Msg. One that does not decode, that the machine has no cell for, or that
 *   is a timer or a Cmd's answer is refused `bad_msg`: only the runner makes those two. Then the
 *   program's own `refuse` may refuse it, and only then is it stepped.
 * - `fold` applies a saved Msg as it was accepted and never asks `refuse` again. A Msg whose cell
 *   the machine no longer has is dropped, and the model stays.
 *
 * Every answer is checked before it leaves: the model and the view must encode to JSON, the wake
 * must be a number or null, and a declared Cmd must match its input schema. A throw or bad data is
 * a `ProgramDown`, whose reason says where: `load`, `step`, `saved_state` or `saved_letter`.
 *
 * @stability unstable
 * @category constructors
 */
export const stepper = (declared: unknown): Result.Result<Stepper, Schema.SchemaError> => {
  const loaded = decodeDeclaration(declared);

  if (Result.isFailure(loaded)) {
    return Result.fail(loaded.failure);
  }

  const program = loaded.success;
  const machine = program.machine;
  const defs = machine.cmds ?? [];
  const cells = new Set(msgKeysOf(machine));
  const decodeModel = Schema.decodeUnknownResult(program.state.schema);
  const encodeModel = Schema.encodeUnknownResult(program.state.schema);
  const encodeView = Schema.encodeUnknownResult(program.view.data);
  const decodeMsg = Schema.decodeUnknownResult(Schema.toCodecJson(program.msg));

  /** A model as the program's own value, or ProgramDown with `reason`. */
  const model = (raw: unknown, reason: ProgramDown["reason"]): unknown => {
    const decoded = decodeModel(raw);

    if (Result.isFailure(decoded)) {
      throw new ProgramDown({ reason, error: "ProgramDown", cause: decoded.failure });
    }

    return decoded.success;
  };

  /** A Msg as the machine takes it: a settled Cmd Msg, or one the Msg schema's JSON codec decodes. */
  const message = (raw: unknown, saved: boolean): Option.Option<Typed> => {
    const typed = decodeTyped(raw);

    if (
      !saved &&
      Option.exists(typed, (m) => m.type === "timer" || defs.some((d) => d.okType === m.type || d.errType === m.type))
    ) {
      return Option.none();
    }

    if (saved) {
      const result = settled(defs, raw);

      if (Option.isSome(result)) {
        return result.value && isTyped(raw) ? Option.some(raw) : Option.none();
      }
    }

    const decoded = decodeMsg(raw);
    return Result.isSuccess(decoded) && isTyped(decoded.success) ? Option.some(decoded.success) : Option.none();
  };

  /** A Cmd the machine returned: a declared one must match its input schema. */
  const cmdOk = (cmd: unknown): boolean => {
    const typed = decodeTyped(cmd);

    if (Option.isNone(typed)) {
      return false;
    }

    const def = defs.find((d) => d.cmdType === typed.value.type);

    if (def === undefined) {
      return true;
    }

    const schemas: object = def.schema;
    return "input" in schemas && accepts(schemas.input, cmd);
  };

  /** The machine's answer as JSON, checked. Bad data is ProgramDown with `reason`. */
  const prepare = (next: unknown, cmds: ReadonlyArray<unknown>, reason: ProgramDown["reason"]): Step => {
    const encoded = encodeModel(next);
    const view = guard(reason, () => encodeView(program.view.select(next)));
    const wake = guard(reason, () => decodeWake(program.wake(next)));
    const json = cmds.map((cmd) => (cmdOk(cmd) ? decodeJson(cmd) : Result.fail(null)));

    if (Result.isFailure(encoded) || Result.isFailure(view) || Result.isFailure(wake) || json.some(Result.isFailure)) {
      throw new ProgramDown({ reason, error: "ProgramDown", cause: failures([encoded, view, wake, ...json]) });
    }

    const model = decodeJson(encoded.success);
    const shown = decodeJson(view.success);

    if (Result.isFailure(model) || Result.isFailure(shown)) {
      throw new ProgramDown({ reason, error: "ProgramDown", cause: failures([model, shown]) });
    }

    return Step.cases.stepped.make({
      model: model.success,
      view: shown.success,
      cmds: json.flatMap((one) => (Result.isSuccess(one) ? [one.success] : [])),
      wake: wake.success,
    });
  };

  return Result.succeed({
    program,
    init: (saved) => {
      const start = saved === null ? null : model(saved, "saved_state");
      const [next] = guard("load", () => machine.init(start, {}));
      return prepare(next, [], "load");
    },
    step: (raw, msg) => {
      const now = model(raw, "saved_state");
      const m = message(msg, false);

      if (Option.isNone(m) || !cells.has(m.value.type)) {
        return Step.cases.refused.make({ reason: "bad_msg" });
      }

      const refusal = guard("step", () => decodeRefusal(program.refuse(now, m.value)));

      if (Result.isFailure(refusal)) {
        throw new ProgramDown({ reason: "step", error: "ProgramDown", cause: refusal.failure });
      }

      if (refusal.success !== null) {
        return Step.cases.refused.make(refusal.success);
      }

      const [next, cmds] = guard("step", () => applyCell(machine, now, m.value));
      return prepare(next, cmds, "step");
    },
    fold: (raw, msg) => {
      const now = model(raw, "saved_state");
      const typed = decodeTyped(msg);

      // tea drops a Msg whose cell is gone by its turn; a saved one is dropped the same way.
      if (Option.isSome(typed) && !cells.has(typed.value.type)) {
        return prepare(now, [], "saved_letter");
      }

      const m = message(msg, true);

      if (Option.isNone(m)) {
        throw new ProgramDown({ reason: "saved_letter" });
      }

      const [next, cmds] = guard("saved_letter", () => applyCell(machine, now, m.value));
      return prepare(next, cmds, "saved_letter");
    },
  });
};
