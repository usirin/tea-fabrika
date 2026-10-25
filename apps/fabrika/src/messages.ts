import {Cause, Exit, Schema} from "effect";
import {Saved, TileIdSchema} from "./desk/desk.ts";

// What the app's one window and the main process say to each other. The window holds the desk
// (desk/desk.ts), a terminal per tile, and a view per run of a program with one; each has its own
// two message types, on a port of its own. They are the protocol; the MessagePort that carries
// them today is one way to carry them. No platform here: the window imports this file too.
//
// A tile's terminal is a terminal and nothing more, as a terminal emulator is to a pty: it
// sends the keys pressed and its size, and draws the bytes it is sent. The line editor and tsh
// are in the main process (host.ts).
//
//   to the terminal      {type: "write", data: "tsh$ "}
//   from the terminal    {type: "keys", data: "cou\t"}
//                        {type: "size", cols: 100, rows: 30}
//
// A program's view draws one run of one program with a view, in a tile, and sends what the
// view sends. Its port is that run's: a message on it can only be for that run. Its types keep
// the word "window", as the programs' own `WindowProps` do.
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

/** A run with a view, as the desk names it: its id, and its program, which picks its view. */
const Run = Schema.Struct({id: Schema.String, program: Schema.String});

/**
 * What the main process tells the desk (desk/desk.ts), on the desk's own port. `start` hands it
 * the desk kept from before, not read yet: the page reads it with `restore`. The rest are the
 * desk's own Msgs, as each tile's tsh sees its runs (tiles.ts).
 *
 *   {type: "start", saved: null}
 *   {type: "covered", tile: "t1", run: {id: "counter:1a2b", program: "counter"}}
 *   {type: "over", run: "counter:1a2b"}
 *   {type: "jobs", tile: "t1", running: 1}
 *   {type: "closing", tile: "t2"}    t2 was closing before this page loaded
 *   {type: "ended", tile: "t2"}
 */
export const ToDesk = Schema.Union([
	Schema.Struct({type: Schema.Literal("start"), saved: Schema.Unknown}),
	Schema.Struct({type: Schema.Literal("covered"), tile: TileIdSchema, run: Run}),
	Schema.Struct({type: Schema.Literal("over"), run: Schema.String}),
	Schema.Struct({
		type: Schema.Literal("jobs"),
		tile: TileIdSchema,
		running: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	}),
	Schema.Struct({type: Schema.Literal("closing"), tile: TileIdSchema}),
	Schema.Struct({type: Schema.Literal("ended"), tile: TileIdSchema}),
]);
export type ToDesk = typeof ToDesk.Type;

/**
 * What the desk asks of the main process: its Cmds, but `send`, which goes on the tile's own
 * port as keys. A tile's id names a folder in the app's home, so it is read by its pattern
 * (`t` and a number) and nothing else passes.
 *
 *   {type: "open", tile: "t2"}       start t2's tsh, or show the one that runs
 *   {type: "close", tile: "t2"}      give t2's tsh and its programs the end of their inputs
 *   {type: "stop", tile: "t2"}       stop what still runs in t2, and drop its jobs: t2 is gone
 *   {type: "save", desk: {...}}      keep the desk for the next start
 *   {type: "empty"}                  the last tile closed: the window closes, the app stays
 */
export const FromDesk = Schema.Union([
	Schema.Struct({type: Schema.Literal("open"), tile: TileIdSchema}),
	Schema.Struct({type: Schema.Literal("close"), tile: TileIdSchema}),
	Schema.Struct({type: Schema.Literal("stop"), tile: TileIdSchema}),
	Schema.Struct({type: Schema.Literal("save"), desk: Saved}),
	Schema.Struct({type: Schema.Literal("empty")}),
]);
export type FromDesk = typeof FromDesk.Type;

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
/** What the main process reads from the desk. */
export const readFromDesk = reader(FromDesk);
/** What the desk reads from the main process. */
export const readToDesk = reader(ToDesk);
