import {Cause, Exit, Schema} from "effect";

// What the app's windows and the main process say to each other. There are two kinds of window,
// and each has its own two message types. They are the protocol; the MessagePort that carries
// them today is one way to carry them. No platform here: the windows import this file too.
//
// The terminal window is a terminal and nothing more, as a terminal emulator is to a pty: it
// sends the keys pressed and its size, and draws the bytes it is sent. The line editor and tsh
// are in the main process (host.ts).
//
//   to the terminal      {type: "write", data: "tsh$ "}
//   from the terminal    {type: "keys", data: "cou\t"}
//                        {type: "size", cols: 100, rows: 30}
//
// A program's window draws one run of one program with a window, and sends what its window
// sends. Its port is that run's: a message on it can only be for that run.
//
//   to a window          {type: "view", program: "counter", data: {n: 0}}
//   from a window        {type: "msg", msg: {type: "press", value: "plus"}}
//
// A window's `msg` is one of its run's inputs, and only the run's program reads it: the host
// reads it with `readInput` (from @kampus/fabrika), after this file's reader took the envelope.
// A view's `data` is read the same way, in the window, by its program's view schema.
//
// Each side reads what it is handed strictly, with no key the schema does not name. The host
// refuses a message from a window that does not read; it never passes one on.

/** A terminal's width or height, in cells. */
const Cells = Schema.Int.check(Schema.isBetween({minimum: 2, maximum: 1000}));

export const ToTerminal = Schema.Struct({type: Schema.Literal("write"), data: Schema.String});
export type ToTerminal = typeof ToTerminal.Type;

export const FromTerminal = Schema.Union([
	// A paste is one message: 64 KiB is a long one. Past it, the message is refused whole.
	Schema.Struct({
		type: Schema.Literal("keys"),
		data: Schema.String.check(Schema.isMaxLength(65536)),
	}),
	Schema.Struct({type: Schema.Literal("size"), cols: Cells, rows: Cells}),
]);
export type FromTerminal = typeof FromTerminal.Type;

export const ToWindow = Schema.Struct({
	type: Schema.Literal("view"),
	/** The program's name, which picks the window that draws it. */
	program: Schema.String,
	/** Its view's data, which only its own schema reads. */
	data: Schema.Unknown,
});
export type ToWindow = typeof ToWindow.Type;

export const FromWindow = Schema.Struct({
	type: Schema.Literal("msg"),
	/** One of the run's inputs, `{type, value}`: read by its program, not here. */
	msg: Schema.Unknown,
});
export type FromWindow = typeof FromWindow.Type;

/** A message read: what it says, or why it was refused, in the schema's words. */
export type Read<T> =
	| {readonly kind: "read"; readonly msg: T}
	| {readonly kind: "refused"; readonly why: string};

/** A reader for one of the message types: strict, so a key the schema does not name is refused. */
export const reader = <T>(schema: Schema.Codec<T, T>) => {
	const decode = Schema.decodeUnknownExit(schema);
	return (raw: unknown): Read<T> => {
		const exit = decode(raw, {onExcessProperty: "error"});
		if (Exit.isSuccess(exit)) return {kind: "read", msg: exit.value};
		const failure = Cause.squash(exit.cause);
		return {kind: "refused", why: failure instanceof Error ? failure.message : String(failure)};
	};
};

/** What the host reads from the terminal. */
export const readFromTerminal = reader(FromTerminal);
/** What the terminal reads from the host. */
export const readToTerminal = reader(ToTerminal);
/** What the host reads from a program's window. */
export const readFromWindow = reader(FromWindow);
/** What a program's window reads from the host. */
export const readToWindow = reader(ToWindow);
