import {type AnyCmdDef, type Tagged} from "@demlik/tea";
import {Effect, Option, Result, Schema} from "effect";
import {type Input, ProgramDown, stepper, Step} from "./program.ts";
import {Saved} from "./state.ts";

const Upgraded = Schema.Struct({saved: Saved, ran: Schema.Array(Schema.String)});
const Outcome = Schema.TaggedUnion({
	Ok: {value: Schema.Unknown, at: Schema.Number},
	Err: {
		error: Schema.declare<Tagged>(
			(value): value is Tagged =>
				typeof value === "object" &&
				value !== null &&
				"_tag" in value &&
				typeof value._tag === "string",
		),
		at: Schema.Number,
	},
});
const Typed = Schema.Struct({type: Schema.String});

export const Declaration = Schema.Struct({
	name: Schema.String,
	v: Schema.Int,
	writes: Schema.Record(Schema.String, Schema.Struct({personOnly: Schema.Boolean})),
	/** Each input port: whether it takes writes, and whether only a person may send it. */
	inputs: Schema.Record(
		Schema.String,
		Schema.Struct({write: Schema.Boolean, personOnly: Schema.Boolean}),
	),
	cmds: Schema.Array(Schema.String),
});
export type Declaration = typeof Declaration.Type;

export type ProgramSource = {readonly hash: string; readonly source: string};

export type Execution = {
	readonly init: (saved: unknown) => Effect.Effect<Step, ProgramDown>;
	readonly step: (model: unknown, msg: unknown) => Effect.Effect<Step, ProgramDown>;
	readonly fold: (model: unknown, msg: unknown) => Effect.Effect<Step, ProgramDown>;
	readonly upgrade: (saved: unknown) => Effect.Effect<typeof Upgraded.Type, ProgramDown>;
	readonly reply: (cmd: unknown, outcome: unknown) => Effect.Effect<Schema.Json, ProgramDown>;
	readonly check: (kind: string, fact: unknown) => Effect.Effect<boolean, ProgramDown>;
	/** Whether a stamped input decodes against its write port's schema, checked inside the box. */
	readonly admit: (m: unknown) => Effect.Effect<boolean, ProgramDown>;
};

export type ExecutionCalls = {
	readonly init: (saved: unknown) => Promise<unknown>;
	readonly step: (model: unknown, msg: unknown) => Promise<unknown>;
	readonly fold: (model: unknown, msg: unknown) => Promise<unknown>;
	readonly upgrade: (saved: unknown) => Promise<unknown>;
	readonly reply: (cmd: unknown, outcome: unknown) => Promise<unknown>;
	readonly check?: (kind: string, fact: unknown) => Promise<unknown>;
	readonly admit?: (m: unknown) => Promise<unknown>;
};

const attempt = <A>(why: ProgramDown["why"], f: () => A) =>
	Effect.try({try: f, catch: () => new ProgramDown({why})});

const isCodec = (schema: unknown): schema is Schema.Codec<unknown, unknown> =>
	Schema.isSchema(schema);

/** A Cmd answer as its schema encodes it, as JSON; a schema that is not a codec answers nothing. */
const encodeAnswer = (schema: unknown, value: unknown): Schema.Json => {
	if (!isCodec(schema)) throw new ProgramDown({why: "step"});
	return Schema.decodeUnknownSync(Schema.Json)(Schema.encodeUnknownSync(schema)(value));
};

/** True when `m` names a write port and decodes against that port's schema. */
const admits = (inputs: Readonly<Record<string, Input>>, m: unknown): boolean => {
	const typed = Schema.decodeUnknownOption(Typed)(m);
	if (Option.isNone(typed) || !Object.hasOwn(inputs, typed.value.type)) return false;
	const port = inputs[typed.value.type];
	return (
		port !== undefined &&
		port._tag === "write" &&
		Result.isSuccess(Schema.decodeUnknownResult(port.schema)(m))
	);
};

const reply = (defs: ReadonlyArray<AnyCmdDef>, cmd: unknown, raw: unknown): Schema.Json => {
	const type = Schema.decodeUnknownSync(Typed)(cmd).type;
	const def = defs.find((d) => d.cmdType === type);
	if (def === undefined) throw new ProgramDown({why: "step"});
	const outcome = Schema.decodeUnknownSync(Outcome)(raw);
	if (outcome._tag === "Ok")
		return Schema.decodeUnknownSync(Schema.Json)({
			type: def.okType,
			cmd,
			value: encodeAnswer(def.schema.ok, outcome.value),
			at: outcome.at,
		});
	const tag = outcome.error._tag;
	if (!def.errTags.includes(tag)) throw new ProgramDown({why: "step"});
	return Schema.decodeUnknownSync(Schema.Json)({
		type: def.errType,
		cmd,
		error: encodeAnswer(Schema.TaggedStruct(tag, {}), outcome.error),
		at: outcome.at,
	});
};

export const nodeExecution = (declared: unknown, build = "node"): Execution => {
	const pure = stepper(declared);
	return {
		init: Effect.fn("execution.init")((saved) => attempt("load", () => pure.init(saved))),
		step: Effect.fn("execution.step")((model, msg) => attempt("step", () => pure.step(model, msg))),
		fold: Effect.fn("execution.fold")((model, msg) =>
			attempt("saved_letter", () => pure.fold(model, msg)),
		),
		upgrade: Effect.fn("execution.upgrade")((saved) =>
			attempt("saved_state", () => Saved.upgrade(saved, pure.program.state, build)),
		),
		reply: Effect.fn("execution.reply")((cmd, outcome) =>
			attempt("step", () => reply(pure.program.machine.cmds ?? [], cmd, outcome)),
		),
		admit: Effect.fn("execution.admit")((m) =>
			attempt("step", () => admits(pure.program.inputs, m)),
		),
		check: Effect.fn("execution.check")((kind, fact) =>
			attempt("step", () => {
				const policy = pure.program.writes[kind];
				return (
					policy !== undefined && Result.isSuccess(Schema.decodeUnknownResult(policy.schema)(fact))
				);
			}),
		),
	};
};

export const workerExecution = (rpc: ExecutionCalls): Execution => {
	const ask = <A>(
		schema: Schema.Decoder<A>,
		send: () => Promise<unknown>,
		why: ProgramDown["why"],
	) =>
		// oxlint-disable-next-line fabrika/no-promises -- edge: adapt one Worker Loader RPC to Effect
		Effect.tryPromise({try: send, catch: () => new ProgramDown({why, source: "rpc"})}).pipe(
			Effect.flatMap((raw) => {
				const decoded = Schema.decodeUnknownResult(schema)(raw);
				return Result.isSuccess(decoded)
					? Effect.succeed(decoded.success)
					: Effect.fail(new ProgramDown({why, source: "decode"}));
			}),
		);
	return {
		init: Effect.fn("execution.init")((saved) => ask(Step, () => rpc.init(saved), "load")),
		step: Effect.fn("execution.step")((model, msg) =>
			ask(Step, () => rpc.step(model, msg), "step"),
		),
		fold: Effect.fn("execution.fold")((model, msg) =>
			ask(Step, () => rpc.fold(model, msg), "saved_letter"),
		),
		upgrade: Effect.fn("execution.upgrade")((saved) =>
			ask(Upgraded, () => rpc.upgrade(saved), "saved_state"),
		),
		reply: Effect.fn("execution.reply")((cmd, outcome) =>
			ask(Schema.Json, () => rpc.reply(cmd, outcome), "step"),
		),
		// On a Workers RPC stub, `method.call(rpc, ...)` is a remote call to a method named "call"
		// that sends the stub itself as an argument, and a Worker Loader stub cannot be sent.
		// Reflect.apply keeps `this` without reading a property off the stub.
		check: Effect.fn("execution.check")((kind, fact) => {
			const check = rpc.check;
			return check === undefined
				? Effect.fail(new ProgramDown({why: "load"}))
				: ask(Schema.Boolean, () => Reflect.apply(check, rpc, [kind, fact]), "step");
		}),
		admit: Effect.fn("execution.admit")((m) => {
			const admit = rpc.admit;
			return admit === undefined
				? Effect.fail(new ProgramDown({why: "load"}))
				: ask(Schema.Boolean, () => Reflect.apply(admit, rpc, [m]), "step");
		}),
	};
};
