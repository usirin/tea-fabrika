import {defineMachine} from "@demlik/tea";
import {defineProgram, envelope, input, Self} from "@kampus/fabrika";
import {Effect, Schema, Stream} from "effect";

export const Kind = Schema.Literals(["tsh", "counter", "terminal", "pipe"]);
export type Kind = typeof Kind.Type;
export const catalog = {
	tsh: {title: "tsh", description: "Start with a command"},
	counter: {title: "Counter", description: "A saved little job"},
	terminal: {title: "Terminal", description: "Your shell on the connected host"},
	pipe: {title: "Terminal pipe", description: "Two real terminals joined by typed text ports"},
} satisfies Record<Kind, {title: string; description: string}>;
export const Id = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{1,80}$/));
export const Message = Schema.Union([
	Schema.Struct({type: Schema.Literal("open"), kind: Kind, pane: Id}),
	Schema.Struct({type: Schema.Literals(["hide", "show", "focus"]), pane: Id}),
	Schema.Struct({type: Schema.Literal("display"), pane: Id, kind: Kind}),
]);
export type Message = typeof Message.Type;
export const Pane = Schema.Struct({
	id: Id,
	kind: Kind,
	title: Schema.String,
	open: Schema.Boolean,
	started: Schema.Array(Kind),
});
export const View = Schema.Struct({panes: Schema.Array(Pane), active: Schema.NullOr(Id)});
export type View = typeof View.Type;
export const State = Schema.Struct({...View.fields, cursor: Schema.Int});
export type State = typeof State.Type;
export const ZERO: State = {panes: [], active: null, cursor: 0};
export const view = (state: State): View => ({panes: state.panes, active: state.active});

function step(state: State, message: Message): State {
	if (message.type === "open") {
		const existing = state.panes.find((pane) => pane.id === message.pane);
		if (existing !== undefined) return step(state, {type: "show", pane: existing.id});
		const ordinal = state.panes.filter((pane) => pane.kind === message.kind).length + 1;
		return {
			...state,
			active: message.pane,
			panes: [
				...state.panes,
				{
					id: message.pane,
					kind: message.kind,
					title: `${catalog[message.kind].title} ${ordinal}`,
					open: true,
					started: [message.kind],
				},
			],
		};
	}
	const pane = state.panes.find((pane) => pane.id === message.pane);
	if (pane === undefined || (message.type === "focus" && !pane.open)) return state;
	if (message.type === "display")
		return {
			...state,
			active: pane.id,
			panes: state.panes.map((item) =>
				item.id === pane.id
					? {
							...item,
							kind: message.kind,
							title: catalog[message.kind].title,
							open: true,
							started: item.started.includes(message.kind)
								? item.started
								: [...item.started, message.kind],
						}
					: item,
			),
		};
	const panes = state.panes.map((pane) =>
		pane.id === message.pane ? {...pane, open: message.type !== "hide"} : pane,
	);
	return {
		...state,
		panes,
		active:
			message.type === "hide"
				? state.active === pane.id
					? (panes.findLast((pane) => pane.open)?.id ?? null)
					: state.active
				: pane.id,
	};
}
const Sent = Schema.Struct({id: Schema.String, message: Message});
type Arrived = {type: "arrived"; rev: number; message: Message};
export const machine = defineMachine({
	types: {model: {} as State, msg: {} as Arrived, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? ZERO, []],
	update: {
		arrived: (state, event) =>
			event.rev <= state.cursor
				? [state, []]
				: [{...step(state, event.message), cursor: event.rev}, []],
	},
});
export const program = defineProgram({
	name: "desk",
	description: "Keeps pane records without owning a browser window.",
	inputs: {inbox: input(envelope(Sent), "Saved pane actions.")},
	outputs: {},
	main: ({inputs}) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const handle = yield* self.run(
				machine,
				{schema: State, cursor: (state) => state.cursor},
				{ctx: undefined},
			);
			const runtime = yield* handle.ready;
			yield* inputs.inbox.pipe(
				Stream.runForEach((event) =>
					runtime.dispatch({type: "arrived", rev: event.rev, message: event.body.message}),
				),
			);
		}),
});
