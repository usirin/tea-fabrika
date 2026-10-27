import type {CmdDef, CmdInput, DepKeyedSub, Sub, TaggedError} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {decodeJevReply, jevCallThrew, jevQuestions} from "@demlik/tea/jev";
import {Effect, Schema} from "effect";
import {z} from "zod";
import {isEffectSpec, type Plain, type Spec, zodCmd} from "./schema.ts";
import {Jev} from "./services.ts";

// The six moves every step of a pipeline is made of, each one an Elm thing:
//
//   Gather  code reads the world             a Cmd, typed answer, no change
//   Act     code writes the world            a Cmd, its intent kept in the model first
//   Listen  things arrive on their own       a Sub
//   Draft   an agent produces something      a Sub over the agent's stream (src/draft.ts)
//   Check   code judges an output            a pure function, or a Cmd when it runs code
//   Judge   Jev answers one narrow question  a Cmd; the floor is applied in update
//
// They add no engine: each is tea's Cmd, Sub or a pure function, with the
// rule that makes it safe written into its type. The combos that join them
// (refine, gate, ask, remember, spawn) are in src/combos.ts.
//
// A move takes its schemas as Effect Schema and hands them to tea's own
// `Cmd.define` from `@demlik/tea/effect`, so no caller writes
// `Schema.toStandardSchemaV1`. Until the repo is off zod a move takes a zod
// schema too, one slot at a time: a Cmd may have a zod `input` beside an
// Effect `ok`. tea's Effect `Cmd.define` takes Effect schemas only, so such a
// spec goes to `zodCmd` (src/schema.ts) instead. Each place that does is
// marked "zod", and removing zod is deleting those.

/**
 * Gather: code reads the world and answers with typed data. It changes
 * nothing, so a restart that finds one in flight simply asks it again.
 */
export const gather = <
	const N extends string,
	I extends CmdInput,
	O,
	const T extends readonly string[],
>(
	name: N,
	spec: Spec<I, O, T>,
) =>
	// zod: the second branch.
	isEffectSpec(spec) ? Cmd.define(name, spec) : zodCmd(name, spec);

/** What an Act carries besides its own input: the name of the one write it stands for. */
export type Intended<I> = I & {readonly intent: string};

type Struct = Schema.Struct<Schema.Struct.Fields>;
type ActSpec<In, O, T extends readonly string[]> = {
	readonly input: In;
	readonly ok: Plain<O>;
	readonly err: T;
};

/**
 * `input` with the `intent` field added: Effect Schema's form of zod's
 * `.extend`. The cast says what `fieldsAssign` did, which TypeScript cannot
 * follow through a struct whose fields it does not know yet.
 */
const intended = <I>(input: Struct & Plain<I>) =>
	// biome-ignore lint/plugin: TypeScript cannot follow `fieldsAssign` through a struct whose fields it does not know yet, and refuses a single cast; the cast says what was built
	Schema.fieldsAssign({intent: Schema.String})(input) as unknown as Plain<Intended<I>>;

/** zod: Act over a zod object, as it was. */
const actZod = <
	const N extends string,
	S extends z.ZodRawShape,
	O,
	const T extends readonly string[],
>(
	name: N,
	spec: ActSpec<z.ZodObject<S>, O, T>,
) => zodCmd(name, {input: spec.input.extend({intent: z.string()}), ok: spec.ok, err: spec.err});

/**
 * Act: code writes the world. The Cmd carries an `intent`, a name for this one
 * write that the model picks and keeps (usually the Cmd itself, as `asked`)
 * before the Cmd goes out. A restart re-sends the kept Cmd with the same
 * intent, and the service behind it answers a second send of an intent with
 * the first one's result instead of writing again. Where the world has no
 * such key, the service reads before it writes.
 *
 * `input` is a struct, so the `intent` field has somewhere to go.
 */
export function act<
	const N extends string,
	I extends CmdInput,
	O,
	const T extends readonly string[],
>(
	name: N,
	spec: ActSpec<Struct & Plain<I>, O, T>,
): CmdDef<N, Intended<I>, O, TaggedError<T[number]>>;
// zod: this signature, and the second branch below.
export function act<
	const N extends string,
	S extends z.ZodRawShape,
	O,
	const T extends readonly string[],
>(name: N, spec: ActSpec<z.ZodObject<S>, O, T>): ReturnType<typeof actZod<N, S, O, T>>;
export function act(
	name: string,
	spec: ActSpec<(Struct & Plain<CmdInput>) | z.ZodObject, unknown, readonly string[]>,
) {
	const {input, ok, err} = spec;
	if (!Schema.isSchema(input)) return actZod(name, {input, ok, err});
	const withIntent = {input: intended(input), ok, err};
	// zod: the second branch, for an Effect `input` beside a zod `ok`.
	return isEffectSpec(withIntent) ? Cmd.define(name, withIntent) : zodCmd(name, withIntent);
}

/**
 * The name of one write, built from where it stands in the run. Pure, so the
 * same step names the same write on every replay; never a clock or a random id.
 */
export const intentOf = (...parts: readonly (string | number)[]): string => parts.join("/");

/**
 * The schema of a Cmd as a model keeps it (`asked`): its `type`, and the
 * input the move was given. A model that holds a Cmd is kept and read back
 * through its state schema, and this is that Cmd's part of it.
 *
 *   const At = Schema.Struct({ticket: Schema.String});
 *   const readTicket = gather("ticket_read", {input: At, ok: Ticket, err: ["unknown"]});
 *   keptCmd(readTicket, At)   // {type: "ticket_read", ticket: string}
 */
export const keptCmd = <const N extends string, F extends Schema.Struct.Fields>(
	def: {readonly cmdType: N},
	input: Schema.Struct<F>,
) => Schema.Struct({...input.fields, type: Schema.Literal(def.cmdType)});

/** `keptCmd` for an Act: its input as given, with the `intent` the move adds. */
export const keptAct = <const N extends string, F extends Schema.Struct.Fields>(
	def: {readonly cmdType: N},
	input: Schema.Struct<F>,
) => Schema.Struct({...input.fields, intent: Schema.String, type: Schema.Literal(def.cmdType)});

/**
 * Listen: things that arrive on their own (a CI result, a reply, the clock).
 * The machine names what it is listening for as data, and listens for as long
 * as `deps` is not null; leaving the phase stops it. The runner turns what
 * arrives into typed Msgs, and the model never reads raw text.
 */
export const listen = <S, T extends string, D>(
	type: T,
	deps: (state: S) => D | null,
): DepKeyedSub<S, Sub<T, D>> => ({type, deps}) as DepKeyedSub<S, Sub<T, D>>;

/**
 * Check, the pure form: what is wrong with an output, as sentences the
 * writer can act on. None is a pass.
 */
export type Check<O, B> = (output: O, brief: B) => readonly string[];

/**
 * Check, the Cmd form, for a check that has to run code (tests, a type check,
 * vetting). It answers with a verdict, data about the output, and a pure
 * `problemsOf` turns that into problems in update. Running it changes
 * nothing, so it is a Gather whose answer is a verdict.
 */
export const checkRun = <const N extends string, I extends CmdInput, V>(
	name: N,
	spec: {readonly input: Plain<I>; readonly verdict: Plain<V>},
) => gather(name, {input: spec.input, ok: spec.verdict, err: ["could_not_run"]});

/** Jev's answer to a Judge, before the floor. */
export interface Judged<C extends string> {
	readonly choice: C;
	readonly confidence: number;
}

/** A Judge's answer after the floor: sure of one choice, or unsure, which goes to a person. */
export type Ruled<C extends string> =
	| {readonly sure: true; readonly choice: C; readonly confidence: number}
	| {readonly sure: false; readonly best: C; readonly confidence: number};

/**
 * Judge: Jev answers one narrow question with fixed choices and a confidence.
 * The Cmd brings back Jev's answer as it is; `rule` applies the floor, in
 * update, with the floor the run copied into its state when it started. Below
 * the floor is "unsure", which a parent sends to `ask`.
 */
export function createJudge<const N extends string, const C extends string>(config: {
	readonly name: N;
	readonly instructions: string;
	readonly choices: Readonly<Record<C, string>>;
}) {
	const choices = Object.keys(config.choices) as [C, ...C[]];
	const questions = jevQuestions({
		answer: {type: "choice", instructions: config.instructions, criteria: config.choices},
	});
	const ask = Cmd.define(`${config.name}_judge`, {
		/** The texts Jev reads, by name; the instructions refer to them in backticks. */
		input: Schema.Struct({key: Schema.String, texts: Schema.Record(Schema.String, Schema.String)}),
		/** `Finite`, as zod's `number` was: a confidence is never NaN or infinite. */
		ok: Schema.Struct({choice: Schema.Literals(choices), confidence: Schema.Finite}),
		err: ["judge_failed"],
	});

	const rule = (judged: Judged<C>, floor: number): Ruled<C> =>
		judged.confidence >= floor
			? {sure: true, choice: judged.choice, confidence: judged.confidence}
			: {sure: false, best: judged.choice, confidence: judged.confidence};

	/** The handler, over the `Jev` service: one call, the reply read against the question. */
	const handle = (model: string) => (cmd: ReturnType<typeof ask>) =>
		Effect.gen(function* () {
			const jev = yield* Jev;
			const request = {state: cmd.texts, model, questions};
			const outcome = yield* jev.call(request).pipe(
				Effect.match({
					onSuccess: (reply) => decodeJevReply(request, reply),
					onFailure: (failure) => jevCallThrew(failure.cause),
				}),
			);
			if (outcome._tag === "Err") return yield* Effect.fail({_tag: "judge_failed" as const});
			const {choice, confidence} = outcome.value.answers.answer;
			return {choice: choice as C, confidence};
		});

	return {name: config.name, choices, criteria: config.choices, ask, rule, handle};
}
