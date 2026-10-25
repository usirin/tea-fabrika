import {Cause, Exit, Schema} from "effect";
import {DeskSchema, TileIdSchema} from "./desk/desk.ts";

// What the app's one window and the host say to each other. The window draws the desk
// (desk/desk.ts, run in the host), a terminal per tile, and a view per run of a program with one;
// each has its own two message types, on a port of its own. They are the protocol: the page's
// MessagePort and the host's socket (link.ts) are only what carries them, and the app's main
// process relays them unread. No platform here: the window imports this file too.
//
// A tile's terminal is a terminal and nothing more, as a terminal emulator is to a pty: it
// sends the keys pressed and its size, and draws the bytes it is sent. The line editor and tsh
// are in the host (tsh.ts).
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

/** A key's name, as `keyName` spells it (desk/keys.ts): short, always. */
const KeyName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));

/** A number the page gives each key it sends the host, so the answer names the key it is for. */
const PressId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * What the host tells the page, on the desk's port. The desk runs in the host (host/serve.ts);
 * the page draws what it is sent and nothing else. `keys` is the desk's Ctrl-B table, sent once
 * as the page loads. `desk` is the whole desk, after every change, with the keys the desk takes
 * now (`takes`): the page sends those keys to the host and no further. `answer` says whether the
 * host took the key sent with that id; a key it did not take goes on to the tile, in order.
 * `down` is the app's own, not the host's: the link to the host is down, or was refused.
 *
 *   {type: "keys", prefix: "<c-b>", table: [{key: "|", repeats: false}, ...]}
 *   {type: "desk", desk: {at: "open", ...}, takes: {all: false, keys: ["<c-b>"]}}
 *   {type: "answer", id: 3, took: true}
 *   {type: "down", why: "the host speaks version 0, this app 1"}
 */
export const ToPage = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("keys"),
		prefix: KeyName,
		table: Schema.Array(Schema.Struct({key: KeyName, repeats: Schema.Boolean})),
	}),
	Schema.Struct({
		type: Schema.Literal("desk"),
		desk: DeskSchema,
		takes: Schema.Struct({all: Schema.Boolean, keys: Schema.Array(KeyName)}),
	}),
	Schema.Struct({type: Schema.Literal("answer"), id: PressId, took: Schema.Boolean}),
	Schema.Struct({type: Schema.Literal("down"), why: Schema.String}),
]);
export type ToPage = typeof ToPage.Type;

/**
 * What the page tells the host, on the desk's port: a key the desk takes, a click on a tile, a
 * border let go. A tile's id names a folder in the app's home, so it is read by its pattern (`t`
 * and a number) and nothing else passes. The host stamps each key with its own clock.
 *
 *   {type: "press", id: 3, key: "<c-b>"}
 *   {type: "click", tile: "t2"}
 *   {type: "resize", stack: "s2", sizes: {t1: 30, t2: 70}}
 */
export const FromPage = Schema.Union([
	Schema.Struct({type: Schema.Literal("press"), id: PressId, key: KeyName}),
	Schema.Struct({type: Schema.Literal("click"), tile: TileIdSchema}),
	Schema.Struct({
		type: Schema.Literal("resize"),
		stack: Schema.String,
		sizes: Schema.Record(Schema.String, Schema.Number),
	}),
]);
export type FromPage = typeof FromPage.Type;

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
/** What the host reads from the page, on the desk's port. */
export const readFromPage = reader(FromPage);
/** What the page reads from the host, on the desk's port. */
export const readToPage = reader(ToPage);
