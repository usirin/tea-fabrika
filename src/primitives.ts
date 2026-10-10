import { Cmd, type CmdInput, type DepKeyedSub, type Sub } from "@demlik/tea";
import { decodeJevReply, jevCallThrew, jevQuestions } from "@demlik/tea/jev";
import { Effect } from "effect";
import { z } from "zod";
import { Jev } from "./services.ts";

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

type Spec<I extends CmdInput, O, T extends readonly string[]> = {
  readonly input: z.ZodType<I>;
  readonly ok: z.ZodType<O>;
  readonly err: T;
};

/**
 * Gather: code reads the world and answers with typed data. It changes
 * nothing, so a restart that finds one in flight simply asks it again.
 */
export const gather = <const N extends string, I extends CmdInput, O, const T extends readonly string[]>(
  name: N,
  spec: Spec<I, O, T>,
) => Cmd.define(name, spec);

/** What an Act carries besides its own input: the name of the one write it stands for. */
export type Intended<I> = I & { readonly intent: string };

/**
 * Act: code writes the world. The Cmd carries an `intent`, a name for this one
 * write that the model picks and keeps (usually the Cmd itself, as `asked`)
 * before the Cmd goes out. A restart re-sends the kept Cmd with the same
 * intent, and the service behind it answers a second send of an intent with
 * the first one's result instead of writing again. Where the world has no
 * such key, the service reads before it writes.
 */
export const act = <const N extends string, S extends z.ZodRawShape, O, const T extends readonly string[]>(
  name: N,
  spec: { readonly input: z.ZodObject<S>; readonly ok: z.ZodType<O>; readonly err: T },
) => Cmd.define(name, { input: spec.input.extend({ intent: z.string() }), ok: spec.ok, err: spec.err });

/**
 * The name of one write, built from where it stands in the run. Pure, so the
 * same step names the same write on every replay; never a clock or a random id.
 */
export const intentOf = (...parts: readonly (string | number)[]): string => parts.join("/");

/**
 * Listen: things that arrive on their own (a CI result, a reply, the clock).
 * The machine names what it is listening for as data, and listens for as long
 * as `deps` is not null; leaving the phase stops it. The runner turns what
 * arrives into typed Msgs, and the model never reads raw text.
 */
export const listen = <S, T extends string, D>(type: T, deps: (state: S) => D | null): DepKeyedSub<S, Sub<T, D>> =>
  ({ type, deps }) as DepKeyedSub<S, Sub<T, D>>;

/**
 * Check, the pure form: what is wrong with an output, as sentences the
 * writer can act on. None is a pass.
 */
export type Check<O, B> = (output: O, brief: B) => readonly string[];

/**
 * Check, the Cmd form, for a check that has to run code (tests, a type check,
 * vetting). It answers with a verdict, data about the output, and a pure
 * `problemsOf` turns that into problems in update.
 */
export const checkRun = <const N extends string, I extends CmdInput, V>(
  name: N,
  spec: { readonly input: z.ZodType<I>; readonly verdict: z.ZodType<V> },
) => Cmd.define(name, { input: spec.input, ok: spec.verdict, err: ["could_not_run"] });

/** Jev's answer to a Judge, before the floor. */
export interface Judged<C extends string> {
  readonly choice: C;
  readonly confidence: number;
}

/** A Judge's answer after the floor: sure of one choice, or unsure, which goes to a person. */
export type Ruled<C extends string> =
  | { readonly sure: true; readonly choice: C; readonly confidence: number }
  | { readonly sure: false; readonly best: C; readonly confidence: number };

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
    answer: { type: "choice", instructions: config.instructions, criteria: config.choices },
  });
  const ask = Cmd.define(`${config.name}_judge`, {
    /** The texts Jev reads, by name; the instructions refer to them in backticks. */
    input: z.object({ key: z.string(), texts: z.record(z.string(), z.string()) }),
    ok: z.object({ choice: z.enum(choices), confidence: z.number() }),
    err: ["judge_failed"],
  });

  const rule = (judged: Judged<C>, floor: number): Ruled<C> =>
    judged.confidence >= floor
      ? { sure: true, choice: judged.choice, confidence: judged.confidence }
      : { sure: false, best: judged.choice, confidence: judged.confidence };

  /** The handler, over the `Jev` service: one call, the reply read against the question. */
  const handle = (model: string) => (cmd: ReturnType<typeof ask>) =>
    Effect.gen(function* () {
      const jev = yield* Jev;
      const request = { state: cmd.texts, model, questions };
      const outcome = yield* jev.call(request).pipe(
        Effect.match({
          onSuccess: (reply) => decodeJevReply(request, reply),
          onFailure: (failure) => jevCallThrew(failure.cause),
        }),
      );
      if (outcome._tag === "Err") return yield* Effect.fail({ _tag: "judge_failed" as const });
      const { choice, confidence } = outcome.value.answers.answer;
      return { choice: choice as C, confidence };
    });

  return { name: config.name, choices, criteria: config.choices, ask, rule, handle };
}
