import {defineMachine} from "@demlik/tea";
import {defineProgram, envelope, input, Self} from "@kampus/fabrika";
import {Effect, Schema, Stream} from "effect";
import {Message, State, ZERO} from "./view.ts";

const Action = Schema.Union([
	Message,
	Schema.Struct({type: Schema.Literal("tick"), job: Schema.String, next: Schema.Int}),
]);
const Sent = Schema.Struct({id: Schema.String, action: Action});
type Arrived = {type: "arrived"; rev: number; id: string; action: typeof Action.Type};
export const machine = defineMachine({
	types: {model: {} as State, msg: {} as Arrived, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? ZERO, []],
	update: {
		arrived: (state, event) => {
			if (event.rev <= state.cursor) return [state, []];
			const next = {...state, cursor: event.rev};
			const action = event.action;
			switch (action.type) {
				case "add":
					return [state.target === null ? {...next, count: state.count + 1} : next, []];
				case "start":
					return [
						state.target === null ? {...next, target: state.count + 5, job: event.id} : next,
						[],
					];
				case "tick":
					return [
						state.target !== null && action.job === state.job && action.next === state.count + 1
							? {
									...next,
									count: action.next,
									target: action.next >= state.target ? null : state.target,
								}
							: next,
						[],
					];
			}
		},
	},
});
export const program = defineProgram({
	name: "counter",
	description: "A saved counter that can run five steps without a window.",
	inputs: {inbox: input(envelope(Sent), "Durable counter actions.")},
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
			yield* Effect.gen(function* () {
				for (;;) {
					yield* Effect.sleep("1 second");
					const state = runtime.getState();
					if (state.target === null) continue;
					const next = state.count + 1;
					const id = `${state.job}:tick:${next}`;
					yield* self.send(self.inbox, id, {id, action: {type: "tick", job: state.job, next}});
				}
			}).pipe(Effect.forkScoped);
			yield* inputs.inbox.pipe(
				Stream.runForEach((event) =>
					runtime.dispatch({
						type: "arrived",
						rev: event.rev,
						id: event.body.id,
						action: event.body.action,
					}),
				),
			);
		}).pipe(Effect.scoped),
});
