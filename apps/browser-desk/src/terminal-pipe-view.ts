import {
	ZERO as TERMINAL_ZERO,
	Message as TerminalMessage,
	View as TerminalView,
} from "@tea-fabrika/terminal/view";
import {Schema} from "effect";

export const Packet = Schema.Struct({
	id: Schema.Int,
	text: Schema.String,
	bytes: Schema.Int,
	status: Schema.Literals(["pending", "queued", "discarded"]),
});
export const Link = Schema.Struct({
	enabled: Schema.Boolean,
	next: Schema.Int,
	sent: Schema.Int,
	bytes: Schema.Int,
	dropped: Schema.Int,
	packets: Schema.Array(Packet),
});
export type Link = typeof Link.Type;
export const LINK_ZERO: Link = {enabled: true, next: 0, sent: 0, bytes: 0, dropped: 0, packets: []};
export const View = Schema.Struct({
	from: TerminalView,
	to: TerminalView,
	link: Link,
	failure: Schema.NullOr(Schema.String),
});
export type View = typeof View.Type;
export const ZERO: View = {from: TERMINAL_ZERO, to: TERMINAL_ZERO, link: LINK_ZERO, failure: null};
export const Message = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("terminal"),
		side: Schema.Literals(["from", "to"]),
		message: TerminalMessage,
	}),
	Schema.Struct({type: Schema.Literal("link"), enabled: Schema.Boolean}),
	Schema.Struct({type: Schema.Literal("restart")}),
]);
export type Message = typeof Message.Type;
