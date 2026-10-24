import {Shell} from "@kampus/fabrika";
import {Cause, Exit, Schema} from "effect";

// What the window and the main process say to each other: the two message types of
// docs/direction/the-gui-is-electron-first.md. They are the protocol; the MessagePort that
// carries them today is one way to carry them. No platform here: the window imports this file too.
//
//   to the page    {type: "view", pane: "p1", data: {
//                    tsh: {run: "tsh:p1", lines: [...], state: {kind: "busy", waiting: 1}},
//                    front: [{program: "counter", run: "counter:1a2b", data: {n: 0}}]}}
//   from the page  {type: "msg", pane: "p1", to: "tsh:p1", msg: {type: "line", value: "counter"}}
//                  {type: "msg", pane: "p1", to: "counter:1a2b", msg: {type: "press", value: "plus"}}
//
// A message from the page names the run it is for, so one sent as that run ended is refused,
// never handed to whatever is under it. Its `msg` is one of that run's inputs, and only the
// run's own program can read it: the host reads it with `readInput` (from @kampus/fabrika),
// after this file's reader took the envelope. A front's `data` is read the same way, in the
// window, by its program's view schema.
//
// Each side reads what it is handed strictly, with no key the schema does not name. The host
// refuses a message from the page that does not read; it never passes one on.

/** A pane. One for now, so a message for any other is refused: a second pane widens this. */
export const PaneId = Schema.Literal("p1");
export type PaneId = typeof PaneId.Type;

/** One line on tsh's screen: one the person sent, or one tsh printed, on out or err. */
export const Line = Schema.Union([
	Schema.Struct({kind: Schema.Literal("typed"), text: Schema.String}),
	Schema.Struct({kind: Schema.Literal("printed"), ...Shell.Printed.fields}),
]);
export type Line = typeof Line.Type;

/** How a run ended, as a program's run says it. */
export const How = Schema.Literals(["ended", "stopped", "failed"]);
export type How = typeof How.Type;

/**
 * Where tsh is. `ready`: the prompt is up, with how the last line ended (`null`: no line
 * yet). `busy`: lines sent and not done yet, one or more. `ended`: tsh is gone.
 */
export const Tsh = Schema.Union([
	Schema.Struct({kind: Schema.Literal("ready"), status: Schema.NullOr(Shell.Ready.fields.status)}),
	Schema.Struct({
		kind: Schema.Literal("busy"),
		waiting: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	}),
	Schema.Struct({kind: Schema.Literal("ended"), how: How}),
]);
export type Tsh = typeof Tsh.Type;

/** tsh in a pane: its run, the lines so far, oldest first, and where it is. */
export const TshView = Schema.Struct({run: Schema.String, lines: Schema.Array(Line), state: Tsh});
export type TshView = typeof TshView.Type;

/**
 * A program with a window, over tsh: its name, which picks the window that draws it, its run,
 * which a message for it names, and its view's data, which only its own schema reads.
 */
export const Front = Schema.Struct({
	program: Schema.String,
	run: Schema.String,
	data: Schema.Unknown,
});
export type Front = typeof Front.Type;

/** What a pane shows: tsh, and the windows over it, the newest last. The newest is drawn; with none, tsh. */
export const PaneView = Schema.Struct({tsh: TshView, front: Schema.Array(Front)});
export type PaneView = typeof PaneView.Type;

export const ToPage = Schema.Struct({type: Schema.Literal("view"), pane: PaneId, data: PaneView});
export type ToPage = typeof ToPage.Type;

export const FromPage = Schema.Struct({
	type: Schema.Literal("msg"),
	pane: PaneId,
	/** The run it is for: tsh's, or a front's. */
	to: Schema.String,
	/** One of that run's inputs, `{type, value}`: read by its program, not here. */
	msg: Schema.Unknown,
});
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

/** What the host reads from the page. */
export const readFromPage = reader(FromPage);
/** What the page reads from the host. */
export const readToPage = reader(ToPage);
