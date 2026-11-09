import {type AnyCmdDef, type Tagged} from "@demlik/tea";
import {Context, Effect, Option, Result, Schema} from "effect";
import {Deliveries} from "../coordination/recovery.ts";
import {type Input, ProgramDown, stepper, Step, type Stepper} from "./program.ts";
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

/** A checked reply failure crosses RPC as data; a rejected call remains an RPC failure. */
export const Reply = Schema.TaggedUnion({
	ok: {value: Schema.Json},
	ProgramDown: {why: ProgramDown.fields.why},
});

export const Declaration = Schema.Struct({
	name: Schema.String,
	v: Schema.Int,
	maxDeliveries: Schema.optionalKey(Deliveries),
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
	Effect.try({
		try: f,
		catch: (cause) => (cause instanceof ProgramDown ? cause : new ProgramDown({why, cause})),
	});

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
	const pure = Effect.fromResult(stepper(declared)).pipe(
		Effect.mapError(() => new ProgramDown({why: "load"})),
	);
	const run = <A>(why: ProgramDown["why"], f: (pure: Stepper) => A) =>
		pure.pipe(Effect.flatMap((loaded) => attempt(why, () => f(loaded))));
	return {
		init: Effect.fn("execution.init")((saved) => run("load", (pure) => pure.init(saved))),
		step: Effect.fn("execution.step")((model, msg) => run("step", (pure) => pure.step(model, msg))),
		fold: Effect.fn("execution.fold")((model, msg) =>
			run("saved_letter", (pure) => pure.fold(model, msg)),
		),
		upgrade: Effect.fn("execution.upgrade")((saved) =>
			run("saved_state", (pure) => Saved.upgrade(saved, pure.program.state, build)),
		),
		reply: Effect.fn("execution.reply")((cmd, outcome) =>
			run("step", (pure) => reply(pure.program.machine.cmds ?? [], cmd, outcome)),
		),
		admit: Effect.fn("execution.admit")((m) =>
			run("step", (pure) => admits(pure.program.inputs, m)),
		),
		check: Effect.fn("execution.check")((kind, fact) =>
			run("step", (pure) => {
				const policy = pure.program.writes[kind];
				return (
					policy !== undefined && Result.isSuccess(Schema.decodeUnknownResult(policy.schema)(fact))
				);
			}),
		),
	};
};

class ExecutionClient extends Context.Service<
	ExecutionClient,
	{
		readonly [K in keyof Execution]: (
			...args: Parameters<Execution[K]>
		) => Effect.Effect<unknown, ProgramDown>;
	}
>()("fabrika/ExecutionClient") {
	static make(rpc: ExecutionCalls): ExecutionClient["Service"] {
		return {
			init: (saved) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader init RPC enters Effect
				Effect.tryPromise({
					try: () => rpc.init(saved),
					catch: (cause) => new ProgramDown({why: "load", source: "rpc", cause}),
				}),
			step: (model, msg) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader step RPC enters Effect
				Effect.tryPromise({
					try: () => rpc.step(model, msg),
					catch: (cause) => new ProgramDown({why: "step", source: "rpc", cause}),
				}),
			fold: (model, msg) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader fold RPC enters Effect
				Effect.tryPromise({
					try: () => rpc.fold(model, msg),
					catch: (cause) => new ProgramDown({why: "saved_letter", source: "rpc", cause}),
				}),
			upgrade: (saved) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader upgrade RPC enters Effect
				Effect.tryPromise({
					try: () => rpc.upgrade(saved),
					catch: (cause) => new ProgramDown({why: "saved_state", source: "rpc", cause}),
				}),
			reply: (cmd, outcome) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader reply RPC enters Effect
				Effect.tryPromise({
					try: () => rpc.reply(cmd, outcome),
					catch: (cause) => new ProgramDown({why: "step", source: "rpc", cause}),
				}),
			check: (kind, fact) => {
				const check = rpc.check;
				if (check === undefined) return Effect.fail(new ProgramDown({why: "load"}));
				// Reflect.apply keeps this without reading a remote method named call off the stub.
				// oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader check RPC enters Effect
				return Effect.tryPromise({
					try: () => Reflect.apply(check, rpc, [kind, fact]),
					catch: (cause) => new ProgramDown({why: "step", source: "rpc", cause}),
				});
			},
			admit: (m) => {
				const admit = rpc.admit;
				if (admit === undefined) return Effect.fail(new ProgramDown({why: "load"}));
				// oxlint-disable-next-line fabrika/no-promises -- edge: Worker Loader admit RPC enters Effect
				return Effect.tryPromise({
					try: () => Reflect.apply(admit, rpc, [m]),
					catch: (cause) => new ProgramDown({why: "step", source: "rpc", cause}),
				});
			},
		};
	}
}

export const workerExecution = (binding: ExecutionCalls): Execution => {
	const rpc = ExecutionClient.make(binding);
	const ask = <A>(
		schema: Schema.Decoder<A>,
		work: Effect.Effect<unknown, ProgramDown>,
		why: ProgramDown["why"],
	) =>
		work.pipe(
			Effect.flatMap((raw) => {
				const decoded = Schema.decodeUnknownResult(schema)(raw);
				return Result.isSuccess(decoded)
					? Effect.succeed(decoded.success)
					: Effect.fail(new ProgramDown({why, source: "decode", cause: decoded.failure}));
			}),
		);
	return {
		init: Effect.fn("execution.init")((saved) => ask(Step, rpc.init(saved), "load")),
		step: Effect.fn("execution.step")((model, msg) => ask(Step, rpc.step(model, msg), "step")),
		fold: Effect.fn("execution.fold")((model, msg) =>
			ask(Step, rpc.fold(model, msg), "saved_letter"),
		),
		upgrade: Effect.fn("execution.upgrade")((saved) =>
			ask(Upgraded, rpc.upgrade(saved), "saved_state"),
		),
		reply: Effect.fn("execution.reply")((cmd, outcome) =>
			ask(Reply, rpc.reply(cmd, outcome), "step").pipe(
				Effect.flatMap((answer) =>
					answer._tag === "ok"
						? Effect.succeed(answer.value)
						: Effect.fail(new ProgramDown({why: answer.why})),
				),
			),
		),
		check: Effect.fn("execution.check")((kind, fact) =>
			ask(Schema.Boolean, rpc.check(kind, fact), "step"),
		),
		admit: Effect.fn("execution.admit")((m) => ask(Schema.Boolean, rpc.admit(m), "step")),
	};
};
