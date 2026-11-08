import {defineMachine} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Shown} from "./view.ts";

export const WindowState = Schema.Struct({
	view: Schema.NullOr(Shown),
	drafts: Schema.Record(Schema.String, Schema.String),
});
export const WindowMsg = Schema.Union([
	Schema.Struct({type: Schema.Literal("view"), view: Shown}),
	Schema.Struct({type: Schema.Literal("draft"), ticket: Schema.Number, text: Schema.String}),
	Schema.Struct({type: Schema.Literal("submit")}),
	Schema.Struct({type: Schema.Literal("changes")}),
	Schema.Struct({type: Schema.Literal("next")}),
	Schema.Struct({type: Schema.Literal("previous")}),
	Schema.Struct({type: Schema.Literal("quit")}),
]);
const input = Cmd.make("input", {
	input: Schema.Struct({msg: Schema.Unknown}),
	ok: Schema.Null,
	err: [],
});
const focus = Cmd.make("focus", {
	input: Schema.Struct({by: Schema.Number}),
	ok: Schema.Null,
	err: [],
});
const submit = (s: typeof WindowState.Type, changes: boolean) => {
	const ticket = s.view?.number,
		body = ticket == null ? "" : (s.drafts[ticket] ?? "").trim();
	return ticket == null || body === ""
		? ([s, []] as const)
		: ([
				{...s, drafts: {...s.drafts, [ticket]: ""}},
				[
					input({
						msg: {type: "comment", value: {ticket, body, ...(changes ? {asks: "changes"} : {})}},
					}),
				],
			] as const);
};
export const windowMachine = defineMachine({
	types: {model: {} as typeof WindowState.Type, msg: {} as typeof WindowMsg.Type, ctx: undefined},
	cmds: [input, focus],
	init: () => [{view: null, drafts: {}}, []],
	update: {
		view: (s, m) => [{...s, view: m.view}, []],
		draft: (s, m) => [{...s, drafts: {...s.drafts, [m.ticket]: m.text}}, []],
		submit: (s) => submit(s, false),
		changes: (s) => submit(s, true),
		next: (s) => [s, [focus({by: 1})]],
		previous: (s) => [s, [focus({by: -1})]],
		quit: (s) => [s, [input({msg: {type: "quit", value: null}})]],
		input_ok: (s) => [s, []],
		input_err: (s) => [s, []],
		focus_ok: (s) => [s, []],
		focus_err: (s) => [s, []],
	},
});
