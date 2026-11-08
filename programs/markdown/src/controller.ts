import {defineMachine} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";

export const WindowState = Schema.Struct({});
export const WindowMsg = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("scroll"),
		by: Schema.Literals(["line-down", "line-up", "page-down", "page-up", "first", "last"]),
	}),
	Schema.Struct({type: Schema.Literal("quit")}),
]);
const scroll = Cmd.make("scroll", {
	input: Schema.Struct({by: WindowMsg.members[0].fields.by}),
	ok: Schema.Null,
	err: [],
});
const input = Cmd.make("input", {
	input: Schema.Struct({
		msg: Schema.Struct({type: Schema.Literal("quit"), value: Schema.Struct({})}),
	}),
	ok: Schema.Null,
	err: [],
});
export const windowMachine = defineMachine({
	types: {model: {} as typeof WindowState.Type, msg: {} as typeof WindowMsg.Type, ctx: undefined},
	cmds: [scroll, input],
	init: () => [{}, []],
	update: {
		scroll: (s, m) => [s, [scroll({by: m.by})]],
		quit: (s) => [s, [input({msg: {type: "quit", value: {}}})]],
		scroll_ok: (s) => [s, []],
		scroll_err: (s) => [s, []],
		input_ok: (s) => [s, []],
		input_err: (s) => [s, []],
	},
});
