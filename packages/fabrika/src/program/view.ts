import {Schema} from "effect";
import type {AnyProgram, Inputs, Program, View} from "./program.ts";
import {type PayloadOf, shapeOf} from "./shape.ts";

// A program's window, from the program's side: what it is shown and what it may send. Elm's
// `view` and `Msg`, less the HTML. The program declares its view in `defineProgram` (`view`,
// in program.ts); this file holds the types its window is written against, and the reader a
// host puts in front of the program.
//
// A window sends one of the program's own inputs, by name, with a value of that input's type:
// its Msg is its inputs, so inputs stay the only way into a program. The host reads each one
// with `readInput` before it tells the run, and refuses what does not read.
//
//   readInput(counter, {type: "press", value: "plus"})    {kind: "read", msg: {type: "press", value: "plus"}}
//   readInput(counter, {type: "press", value: "minus"})   {kind: "refused", why: "counter's press does not fit: ..."}
//   readInput(counter, {type: "stop", value: null})       {kind: "refused", why: "counter has no input stop"}
//
// The window itself is a React component in the program's own package, on `<package>/window`:
//
//   export const CounterWindow = ({view, send}: WindowProps<typeof counter>) =>
//     <button onClick={() => send({type: "press", value: "plus"})}>{view.n}</button>;

/** One of the inputs `I`, by name, with a value of its type: what a window sends. */
export type InputMsg<I extends Inputs> = {
	readonly [K in keyof I & string]: {readonly type: K; readonly value: PayloadOf<I[K]>};
}[keyof I & string];

/** What a program's window may send: one of its inputs. */
export type InputMsgOf<P> =
	P extends Program<any, infer I, any, any, any, any> ? InputMsg<I> : never;

/** What a program's window is shown: its view's data. `never`: it has no window. */
export type ViewDataOf<P> = P extends {readonly view: View<any, infer V>} ? V : never;

/** What a program's window component is handed: what it shows, and the way to send. */
export interface WindowProps<P> {
	readonly view: ViewDataOf<P>;
	readonly send: (msg: InputMsgOf<P>) => void;
}

/** A message from a program's window, read: one of its inputs, or why it was refused. */
export type ReadInput<P> =
	| {readonly kind: "read"; readonly msg: InputMsgOf<P>}
	| {readonly kind: "refused"; readonly why: string};

/** Any input message, before its name and value are checked against a program. */
const sent = shapeOf(Schema.Struct({type: Schema.String, value: Schema.Unknown}));

const refused = (why: string) => ({kind: "refused", why}) as const;

/**
 * Read what a window sent to `program`: a `{type, value}` with no other key, whose `type` is
 * one of its inputs and whose `value` fits that input's shape. Nothing is told here.
 */
export function readInput<P extends AnyProgram>(program: P, raw: unknown): ReadInput<P> {
	if (!sent.check(raw)) return refused(sent.problem(raw) ?? "not an input message");
	const declared = Object.hasOwn(program.inputs, raw.type) ? program.inputs[raw.type] : undefined;
	if (declared === undefined) return refused(`${program.name} has no input ${raw.type}`);
	const why = declared.shape.problem(raw.value);
	if (why !== undefined) return refused(`${program.name}'s ${raw.type} does not fit: ${why}`);
	// Checked just above against the input's own shape; the types cannot follow a name read at run time.
	const msg = {type: raw.type, value: raw.value} as InputMsgOf<P>;
	return {kind: "read", msg};
}
