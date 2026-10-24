import {Schema} from "effect";

export const Message = Schema.Union([
	Schema.Struct({type: Schema.Literal("add")}),
	Schema.Struct({type: Schema.Literal("start")}),
]);
export type Message = typeof Message.Type;
export const State = Schema.Struct({
	count: Schema.Int,
	cursor: Schema.Int,
	target: Schema.NullOr(Schema.Int),
	job: Schema.String,
});
export type State = typeof State.Type;
export const ZERO: State = {count: 0, cursor: 0, target: null, job: ""};
export const View = Schema.Struct({
	count: Schema.Int,
	running: Schema.Boolean,
	remaining: Schema.Int,
});
export type View = typeof View.Type;
export const view = (state: State): View => ({
	count: state.count,
	running: state.target !== null,
	remaining: state.target === null ? 0 : state.target - state.count,
});
