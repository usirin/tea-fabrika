import {defineMachine} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Shown} from "./machine.ts";

export const WindowState = Schema.Struct({
	view: Schema.NullOr(Shown),
	picked: Schema.NullOr(Schema.String),
	title: Schema.String,
	body: Schema.String,
	find: Schema.String,
	comments: Schema.Record(Schema.String, Schema.String),
});
export const WindowMsg = Schema.Union([
	Schema.Struct({type: Schema.Literal("view"), view: Shown}),
	Schema.Struct({
		type: Schema.Literal("draft"),
		field: Schema.Literals(["title", "body", "find"]),
		text: Schema.String,
	}),
	Schema.Struct({type: Schema.Literal("comment"), ticket: Schema.Number, text: Schema.String}),
	Schema.Struct({type: Schema.Literal("pick"), row: Schema.String}),
	...(
		[
			"next",
			"previous",
			"new",
			"search",
			"open",
			"closed",
			"all",
			"quit",
			"submit",
			"return",
		] as const
	).map((type) => Schema.Struct({type: Schema.Literal(type)})),
]);
const input = Cmd.make("input", {
	input: Schema.Struct({msg: Schema.Unknown}),
	ok: Schema.Null,
	err: [],
});
const focus = Cmd.make("focus", {
	input: Schema.Struct({where: Schema.String}),
	ok: Schema.Null,
	err: [],
});
type State = typeof WindowState.Type;
type Msg = typeof WindowMsg.Type;
type Step = readonly [State, readonly ReturnType<typeof input | typeof focus>[]];
const orderOf = (view: State["view"]): readonly string[] =>
	view?.page.kind !== "list"
		? []
		: [
				...view.page.tickets.map((ticket) => `ticket:${ticket.number}`),
				...view.page.pullRequests.map((pr) => `pr:${pr.url}`),
			];
const update = (s: State, m: Msg): Step => {
	const view = s.view;
	switch (m.type) {
		case "view":
			return [{...s, view: m.view}, []];
		case "draft":
			return [
				{...s, [m.field]: m.text},
				m.field !== "find" || view === null
					? []
					: [input({msg: {type: "query", value: {status: view.filter.show, find: m.text}}})],
			];
		case "comment":
			return [{...s, comments: {...s.comments, [m.ticket]: m.text}}, []];
		case "pick":
			return [{...s, picked: m.row}, []];
		case "next":
		case "previous": {
			const order = orderOf(view);
			const at = Math.max(0, order.indexOf(s.picked ?? ""));
			const picked =
				order[Math.max(0, Math.min(order.length - 1, at + (m.type === "next" ? 1 : -1)))];
			return picked === undefined ? [s, []] : [{...s, picked}, [focus({where: picked})]];
		}
		case "new":
		case "search":
			return [s, [focus({where: m.type})]];
		case "open":
		case "closed":
		case "all":
			return [s, [input({msg: {type: "query", value: {status: m.type, find: s.find}}})]];
		case "quit":
			return [s, [input({msg: {type: "quit", value: null}})]];
		case "return":
			return [
				s,
				view?.page.kind === "ticket"
					? [input({msg: {type: "query", value: {status: view.filter.show, find: s.find}}})]
					: [focus({where: s.picked ?? orderOf(view)[0] ?? "list"})],
			];
		case "submit": {
			if (view?.page.kind === "ticket") {
				const ticket = view.page.number,
					body = (s.comments[ticket] ?? "").trim();
				return body === ""
					? [s, []]
					: [
							{...s, comments: {...s.comments, [ticket]: ""}},
							[input({msg: {type: "comment", value: {ticket, body}}})],
						];
			}
			if (s.title.trim() === "") return [s, [focus({where: "new"})]];
			return [
				{...s, title: "", body: ""},
				[
					input({msg: {type: "file", value: {title: s.title.trim(), body: s.body.trimEnd()}}}),
					focus({where: "new"}),
				],
			];
		}
	}
};
export const windowMachine = defineMachine({
	types: {model: {} as State, msg: {} as Msg, ctx: undefined},
	cmds: [input, focus],
	init: () => [{view: null, picked: null, title: "", body: "", find: "", comments: {}}, []],
	update: {
		view: update,
		draft: update,
		comment: update,
		pick: update,
		next: update,
		previous: update,
		new: update,
		search: update,
		open: update,
		closed: update,
		all: update,
		quit: update,
		submit: update,
		return: update,
		input_ok: (s) => [s, []],
		input_err: (s) => [s, []],
		focus_ok: (s) => [s, []],
		focus_err: (s) => [s, []],
	},
});
