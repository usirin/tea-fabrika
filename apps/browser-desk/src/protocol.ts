import {Message as TerminalMessage, View as TerminalView} from "@tea-fabrika/terminal/view";
import {Schema} from "effect";
import {Message as CounterMessage, View as CounterView} from "./counter/view.ts";
import {Id, Message, View} from "./desk.ts";
import {Message as PipeMessage, View as PipeView} from "./terminal-pipe-view.ts";
import {Message as TshMessage, View as TshView} from "./tsh.ts";

export const Session = Schema.Struct({
	token: Schema.String,
	place: Schema.Literals(["local", "sandbox"]),
});
export const Cloud = Schema.Struct({
	phase: Schema.String,
	saved: Schema.NullOr(Schema.Int),
	failure: Schema.NullOr(Schema.String),
	running: Schema.Boolean,
});

export const FromPage = Schema.Union([
	Schema.Struct({type: Schema.Literal("desk"), id: Id, message: Message}),
	Schema.Struct({type: Schema.Literal("counter"), id: Id, pane: Id, message: CounterMessage}),
	Schema.Struct({type: Schema.Literal("terminal"), id: Id, pane: Id, message: TerminalMessage}),
	Schema.Struct({type: Schema.Literal("tsh"), id: Id, pane: Id, message: TshMessage}),
	Schema.Struct({type: Schema.Literal("pipe"), id: Id, pane: Id, message: PipeMessage}),
]);
export type FromPage = typeof FromPage.Type;
export const Window = Schema.Union([
	Schema.Struct({kind: Schema.Literal("counter"), id: Id, data: CounterView}),
	Schema.Struct({kind: Schema.Literal("terminal"), id: Id, data: TerminalView}),
	Schema.Struct({kind: Schema.Literal("tsh"), id: Id, data: TshView}),
	Schema.Struct({kind: Schema.Literal("pipe"), id: Id, data: PipeView}),
]);
export type Window = typeof Window.Type;
export const Snapshot = Schema.Struct({
	type: Schema.Literal("state"),
	desk: View,
	windows: Schema.Array(Window),
	pid: Schema.Int,
});
export type Snapshot = typeof Snapshot.Type;
export const ToPage = Schema.Union([
	Snapshot,
	Schema.Struct({type: Schema.Literal("refused"), why: Schema.String}),
]);
export const decode = Schema.decodeUnknownSync(Schema.fromJsonString(FromPage));
