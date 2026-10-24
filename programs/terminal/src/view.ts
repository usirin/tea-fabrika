import {Schema} from "effect";

const Size = Schema.Int.check(Schema.isBetween({minimum: 2, maximum: 400}));
export const Message = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("input"),
		data: Schema.String.check(Schema.isMaxLength(8192)),
	}),
	Schema.Struct({type: Schema.Literal("resize"), cols: Size, rows: Size}),
]);
export type Message = typeof Message.Type;
const Traffic = Schema.Struct({chunks: Schema.Int, bytes: Schema.Int, last: Schema.String});
export const View = Schema.Struct({
	phase: Schema.Literals(["opening", "running", "exited", "stopped"]),
	id: Schema.NullOr(Schema.String),
	pid: Schema.NullOr(Schema.Int),
	code: Schema.NullOr(Schema.Int),
	cols: Schema.Int,
	rows: Schema.Int,
	chunks: Schema.Array(Schema.Struct({seq: Schema.Int, data: Schema.String})),
	next: Schema.Int,
	stdin: Traffic,
	stdout: Traffic,
});
export type View = typeof View.Type;
export const ZERO: View = {
	phase: "opening",
	id: null,
	pid: null,
	code: null,
	cols: 80,
	rows: 24,
	chunks: [],
	next: 0,
	stdin: {chunks: 0, bytes: 0, last: ""},
	stdout: {chunks: 0, bytes: 0, last: ""},
};
export const view = (state: View): View => state;
