// A program, next/: a pure tea machine and the declarations the runner checks it by (Tier 1, P11).
// A program gets no sender, key, ledger or service. `stepper` steps it by hand, as Elm's runtime
// would, and never runs a Cmd: the runner does that, after the input is saved.
import {applyCell, msgKeysOf, type AnyCmdDef} from "@demlik/tea";
import {Option, Result, Schema} from "effect";
import {ParentText} from "../coordination/index.ts";

/** A function type whose parameters TypeScript checks both ways, as it does a method's: a program
 *  declares `(model: Model) => …`, and the runner calls it with the model it decoded. */
type Code<A extends ReadonlyArray<unknown>, R> = {call(...args: A): R}["call"];

/** A schema a program declares. It decodes and encodes without services. */
type Declared = Schema.Codec<unknown, unknown>;
const isDeclared = (u: unknown): u is Declared => Schema.isSchema(u);
const isCode = <F>(u: unknown): u is F => typeof u === "function";
const code = <F>(expected: string) =>
	Schema.declare((u: unknown): u is F => isCode<F>(u), {expected});

/** What the runner needs of a tea machine: its update table, its Cmd definitions and its init. */
type Steps = {
	readonly update: object;
	readonly cmds?: ReadonlyArray<AnyCmdDef>;
	readonly init: Code<[loaded: unknown, ctx: unknown], readonly [unknown, ReadonlyArray<unknown>]>;
};
const isSteps = (u: unknown): u is Steps =>
	typeof u === "object" &&
	u !== null &&
	"update" in u &&
	typeof u.update === "object" &&
	u.update !== null &&
	"init" in u &&
	typeof u.init === "function";

const Schemas = Schema.declare(isDeclared, {expected: "a schema"});

/** A program's refusal: why, and the numbers that explain it. */
export const Refusal = Schema.Struct({
	why: Schema.String,
	now: Schema.optionalKey(Schema.Number),
	most: Schema.optionalKey(Schema.Number),
});
export type Refusal = typeof Refusal.Type;

const Upgrade = Schema.Struct({
	name: Schema.NonEmptyString,
	/** Advances a saved model from `from` to `from + 1`. */
	from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	run: code<Code<[raw: unknown], unknown>>("an upgrade function"),
});

/** The saved model's shape: its version, its schema and the named upgrades that reach it (S3). */
export const State = Schema.Struct({
	v: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	schema: Schemas,
	upgrades: Schema.Array(Upgrade),
});
export type State = typeof State.Type;

/** A port a client may use. A write port takes an input; a read port answers from the view. The
 *  two are exclusive: a read port carries no `personOnly`, and a write port no answer. */
export const Input = Schema.TaggedUnion({
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
export type Input = typeof Input.Type;

/** A fact a program may write: its schema, and whether only a person's input may cause it. This is
 *  the trusted policy the door checks. Elm outputs never authorize a ledger write. */
export const FactPolicy = Schema.Struct({schema: Schemas, personOnly: Schema.Boolean});
export type FactPolicy = typeof FactPolicy.Type;

export const Program = Schema.Struct({
	name: Schema.NonEmptyString,
	machine: Schema.declare(isSteps, {expected: "a tea machine"}),
	state: State,
	msg: Schemas,
	view: Schema.Struct({
		data: Schemas,
		select: code<Code<[model: unknown], unknown>>("a view selector"),
	}),
	refuse: code<Code<[model: unknown, msg: unknown], unknown>>("a refusal check"),
	inputs: Schema.Record(Schema.String, Input),
	outputs: Schema.Record(Schema.String, Schemas),
	writes: Schema.Record(Schema.String, FactPolicy),
	wake: code<Code<[model: unknown], unknown>>("a wake time"),
});
export type Program = typeof Program.Type;

/** A JSON object: a fact as it travels inside a write. Its declared schema gives its `_tag`. */
const Fact = Schema.Record(Schema.String, Schema.Json);

/** What a program asks to write: caused by an earlier input it names, or explicitly its own. */
export const Write = Schema.TaggedUnion({
	caused: {parent: ParentText, fact: Fact},
	own: {fact: Fact},
});
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
export type Step = typeof Step.Type;

/** The program cannot run: it did not load, a fresh step threw or returned bad data, or saved
 *  state or a saved letter does not fold. Never a refusal: nothing was decided. */
export class ProgramDown extends Schema.TaggedError<ProgramDown>()("ProgramDown", {
	why: Schema.Literals(["load", "no_program", "step", "saved_state", "saved_letter"]),
	/** An RPC or reply decode failure decided nothing about the input. It must be retried. */
	source: Schema.optionalKey(Schema.Literals(["rpc", "decode"])),
}) {}

export type Stepper = {
	readonly program: Program;
	/** Boots from a saved model, or from nothing. */
	readonly init: (saved: unknown) => Step;
	/** A fresh input: checked, maybe refused, then stepped. */
	readonly step: (model: unknown, msg: unknown) => Step;
	/** A saved input: applied as it was accepted, never refused again. */
	readonly fold: (model: unknown, msg: unknown) => Step;
};

const decodeProgram = Schema.decodeUnknownResult(Program);
const decodeRefusal = Schema.decodeUnknownResult(Schema.NullOr(Refusal));
const decodeJson = Schema.decodeUnknownResult(Schema.Json);
type Typed = {readonly type: string};
const isTyped = (u: unknown): u is Typed =>
	typeof u === "object" && u !== null && "type" in u && typeof u.type === "string";
const decodeTyped = (u: unknown): Option.Option<Typed> =>
	isTyped(u) ? Option.some(u) : Option.none();
const decodeWake = Schema.decodeUnknownResult(Schema.NullOr(Schema.Number));

/** Runs `f`, turning any throw into ProgramDown with `why`. */
const guard = <A>(why: ProgramDown["why"], f: () => A): A => {
	const done = Result.try({try: f, catch: () => new ProgramDown({why})});
	if (Result.isFailure(done)) throw done.failure;
	return done.success;
};

type Standard = {readonly "~standard": {readonly validate: (value: unknown) => unknown}};
const isStandard = (u: unknown): u is Standard =>
	(typeof u === "object" || typeof u === "function") &&
	u !== null &&
	"~standard" in u &&
	typeof u["~standard"] === "object" &&
	u["~standard"] !== null &&
	"validate" in u["~standard"] &&
	typeof u["~standard"].validate === "function";

/** Whether a Standard Schema accepts `value` now. An answer that is not ready counts as no. */
const accepts = (schema: Standard, value: unknown): boolean => {
	const answer = schema["~standard"].validate(value);
	return (
		typeof answer === "object" && answer !== null && "value" in answer && !("issues" in answer)
	);
};

/** A settled Cmd Msg (`<name>_ok` or `<name>_err`) of a declared Cmd, checked by its schemas. */
const settled = (defs: ReadonlyArray<AnyCmdDef>, msg: unknown): Option.Option<boolean> => {
	const typed = decodeTyped(msg);
	if (Option.isNone(typed)) return Option.none();
	const type = typed.value.type;
	const def = defs.find((d) => d.okType === type || d.errType === type);
	if (def === undefined || typeof msg !== "object" || msg === null) return Option.none();
	const cmd = "cmd" in msg ? msg.cmd : undefined;
	const sameCmd = Option.exists(decodeTyped(cmd), (c) => c.type === def.cmdType);
	if (!sameCmd || !("at" in msg) || typeof msg.at !== "number") return Option.some(false);
	if (type === def.okType) return Option.some("value" in msg && accepts(def.schema.ok, msg.value));
	const error = "error" in msg ? msg.error : undefined;
	return Option.some(
		typeof error === "object" &&
			error !== null &&
			"_tag" in error &&
			typeof error._tag === "string",
	);
};

export const stepper = (declared: unknown): Stepper => {
	const loaded = decodeProgram(declared);
	if (Result.isFailure(loaded)) throw new ProgramDown({why: "load"});
	const program = loaded.success;
	const machine = program.machine;
	const defs = machine.cmds ?? [];
	const cells = new Set(msgKeysOf(machine));
	const decodeModel = Schema.decodeUnknownResult(program.state.schema);
	const encodeModel = Schema.encodeUnknownResult(program.state.schema);
	const encodeView = Schema.encodeUnknownResult(program.view.data);
	const decodeMsg = Schema.decodeUnknownResult(program.msg);

	/** A model as the program's own value, or ProgramDown with `why`. */
	const model = (raw: unknown, why: ProgramDown["why"]): unknown => {
		const decoded = decodeModel(raw);
		if (Result.isFailure(decoded)) throw new ProgramDown({why});
		return decoded.success;
	};

	/** A Msg as the machine takes it: a settled Cmd Msg, or one the program's Msg schema decodes. */
	const message = (raw: unknown, saved: boolean): Option.Option<Typed> => {
		const typed = decodeTyped(raw);
		if (
			!saved &&
			Option.exists(
				typed,
				(m) => m.type === "timer" || defs.some((d) => d.okType === m.type || d.errType === m.type),
			)
		)
			return Option.none();
		if (saved) {
			const result = settled(defs, raw);
			if (Option.isSome(result))
				return result.value && isTyped(raw) ? Option.some(raw) : Option.none();
		}
		const decoded = decodeMsg(raw);
		return Result.isSuccess(decoded) && isTyped(decoded.success)
			? Option.some(decoded.success)
			: Option.none();
	};

	/** A Cmd the machine returned: a declared one must match its input schema. */
	const cmdOk = (cmd: unknown): boolean => {
		const typed = decodeTyped(cmd);
		if (Option.isNone(typed)) return false;
		const def = defs.find((d) => d.cmdType === typed.value.type);
		if (def === undefined) return true;
		const schemas: object = def.schema;
		return "input" in schemas && isStandard(schemas.input) && accepts(schemas.input, cmd);
	};

	/** The machine's answer as JSON, checked. Bad data is ProgramDown with `why`. */
	const prepare = (next: unknown, cmds: ReadonlyArray<unknown>, why: ProgramDown["why"]): Step => {
		const encoded = encodeModel(next);
		const view = guard(why, () => encodeView(program.view.select(next)));
		const wake = guard(why, () => decodeWake(program.wake(next)));
		const json = cmds.map((cmd) => (cmdOk(cmd) ? decodeJson(cmd) : Result.fail(null)));
		if (
			Result.isFailure(encoded) ||
			Result.isFailure(view) ||
			Result.isFailure(wake) ||
			json.some(Result.isFailure)
		)
			throw new ProgramDown({why});
		const model = decodeJson(encoded.success);
		const shown = decodeJson(view.success);
		if (Result.isFailure(model) || Result.isFailure(shown)) throw new ProgramDown({why});
		return Step.cases.stepped.make({
			model: model.success,
			view: shown.success,
			cmds: json.flatMap((one) => (Result.isSuccess(one) ? [one.success] : [])),
			wake: wake.success,
		});
	};

	return {
		program,
		init: (saved) => {
			const start = saved === null ? null : model(saved, "saved_state");
			const [next] = guard("load", () => machine.init(start, {}));
			return prepare(next, [], "load");
		},
		step: (raw, msg) => {
			const now = model(raw, "saved_state");
			const m = message(msg, false);
			if (Option.isNone(m) || !cells.has(m.value.type))
				return Step.cases.refused.make({why: "bad_msg"});
			const refusal = guard("step", () => decodeRefusal(program.refuse(now, m.value)));
			if (Result.isFailure(refusal)) throw new ProgramDown({why: "step"});
			if (refusal.success !== null) return Step.cases.refused.make(refusal.success);
			const [next, cmds] = guard("step", () => applyCell(machine, now, m.value));
			return prepare(next, cmds, "step");
		},
		fold: (raw, msg) => {
			const now = model(raw, "saved_state");
			const typed = decodeTyped(msg);
			// tea drops a Msg whose cell is gone by its turn; a saved one is dropped the same way.
			if (Option.isSome(typed) && !cells.has(typed.value.type))
				return prepare(now, [], "saved_letter");
			const m = message(msg, true);
			if (Option.isNone(m)) throw new ProgramDown({why: "saved_letter"});
			const [next, cmds] = guard("saved_letter", () => applyCell(machine, now, m.value));
			return prepare(next, cmds, "saved_letter");
		},
	};
};
