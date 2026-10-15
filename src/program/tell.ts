import {acceptedTypes} from "@demlik/tea";
import type {AnyProgram, InputsOf, MsgOf, Output, StateOf} from "./program.ts";
import {type Fit, fit, type Input, type PayloadOf} from "./shape.ts";

// `tell`: hand a value to another running program's input, and never wait for
// it to be processed. It answers one of four words, at once:
//
//   const word = tell(operatorRun, "outcome", {pr: "#7", kind: "done", why: "landed"});
//   // "queued" | "stopped" | "bad_shape" | "no_cell"
//
//   bad_shape  the payload fails the input's shape. Checked here, before the run sees it.
//   stopped    the run is stopped, as far as this layer knows (see ProgramRun.stopped).
//   no_cell    the run's state right now has no cell for this input.
//   queued     the Msg is on the run's line.
//
// `queued` means "on the line", not "will be folded". A Msg already ahead of it
// on the line can move the run to a state with no cell, or stop it. That
// refusal arrives later, after processing, and lands in the run's `late` list
// instead of in this answer. tea gives no way to ask at the moment the Msg is
// folded without waiting for the fold.

export type Word = "queued" | "stopped" | "bad_shape" | "no_cell";

/** A refusal that came after `tell` said `queued`. `why: "refused"` is a refusal this layer cannot name. */
export interface Late {
	readonly msg: string;
	readonly why: "no_cell" | "stopped" | "refused";
}

/** A running program, as `tell` and `connect` see it, on either engine. */
export interface ProgramRun<P extends AnyProgram> {
	readonly program: P;
	/** The run's committed state. */
	readonly state: () => StateOf<P>;
	/**
	 * Whether the run is stopped. tea has no way to ask a run this, so it is
	 * this layer's own record: set when this handle's `stop` is called, or (on
	 * the Effect engine) when the run's Scope starts closing. A run that tea
	 * halted by itself (a reducer that threw, a Sub that failed) still reads
	 * `false` here.
	 */
	readonly stopped: () => boolean;
	/** Put an input's Msg on the run's line and return at once. */
	readonly enqueue: (name: string, payload: unknown) => void;
	/** Hear every Msg the run folds, in order: its log. */
	readonly observe: (observer: (msg: MsgOf<P>) => void) => () => void;
	/** Listen to one of the program's outputs. Returns the way to stop listening. */
	readonly listen: <T>(out: Output<string, T>, listener: (value: T) => void) => () => void;
	/** Refusals that came after `queued`, in order. */
	readonly late: readonly Late[];
	/** Values an output refused to send because they did not fit its shape. */
	readonly dropped: readonly string[];
	readonly stop: () => Promise<void>;
	/** Wait until the run's line is empty. For tests. */
	readonly idle: () => Promise<void>;
}

/** Hand `payload` to the input `name` of `target`. Never waits. */
export function tell<P extends AnyProgram, K extends keyof InputsOf<P> & string>(
	target: ProgramRun<P>,
	name: K,
	payload: PayloadOf<InputsOf<P>[K]>,
): Word {
	const declared: Input<unknown> = target.program.inputs[name];
	if (!declared.shape.check(payload)) return "bad_shape";
	if (target.stopped()) return "stopped";
	if (!acceptedTypes(target.program.machine, target.state()).includes(name)) return "no_cell";
	target.enqueue(name, payload);
	return "queued";
}

/** What `connect` did. A shape that does not fit is not wired. One that cannot be told apart is. */
export type Connection =
	| {readonly wired: true; readonly fit: "fits" | "cannot_tell"; readonly off: () => void}
	| {readonly wired: false; readonly fit: Extract<Fit, "does_not_fit">};

/**
 * Feed one run's output into another run's input: every value the output
 * sends is told to the input. One-way: the answer of each `tell` goes nowhere.
 * The types must match exactly to compile. The fit check runs too, on the
 * JSON Schemas, and refuses a pair whose types match and whose JSON Schemas
 * do not. A check the JSON Schema leaves out, it cannot see.
 */
export function connect<
	F extends AnyProgram,
	T extends AnyProgram,
	K extends keyof InputsOf<T> & string,
>(
	from: ProgramRun<F>,
	out: Output<string, PayloadOf<InputsOf<T>[K]>>,
	to: ProgramRun<T>,
	name: K,
): Connection {
	const answer = fit(out, to.program.inputs[name]);
	if (answer === "does_not_fit") return {wired: false, fit: answer};
	const off = from.listen(out, (value) => {
		tell(to, name, value);
	});
	return {wired: true, fit: answer, off};
}
