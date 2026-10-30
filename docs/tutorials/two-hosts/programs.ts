// Two programs. The kettle brews each order and pours it into the glass. The glass counts pours.
import {defineMachine} from "@demlik/tea";
import {defineProgram, envelope, input, Self, streams} from "@kampus/fabrika";
import {Effect, Schema} from "effect";

// ------------------------------------------------------------------ the kettle

export const Order = Schema.Struct({id: Schema.String, guest: Schema.String});

export const Kettle = Schema.Struct({
	brewed: Schema.Number,
	/** The inbox rev of the last order brewed. */
	cursor: Schema.Number,
	last: Schema.NullOr(Schema.String),
});
type Kettle = typeof Kettle.Type;

const kettle = defineMachine({
	types: {
		model: {} as Kettle,
		msg: {} as {readonly type: "brewed"; readonly rev: number; readonly guest: string},
		ctx: undefined,
	},
	cmds: [],
	init: (saved) => [saved ?? {brewed: 0, cursor: 0, last: null}, []],
	update: {
		brewed: (s, m) =>
			m.rev <= s.cursor ? [s, []] : [{brewed: s.brewed + 1, cursor: m.rev, last: m.guest}, []],
	},
});

export const kettleProgram = defineProgram({
	name: "kettle",
	description: "Brews each order once and pours it into the glass.",
	inputs: {inbox: input(envelope(Order), "One order: an id and a guest.")},
	outputs: {},
	main: ({serve}) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const run = yield* self.run(
				kettle,
				{schema: Kettle, cursor: (s) => s.cursor},
				{ctx: undefined},
			);
			const machine = yield* run.ready;
			const glass = streams("glass").inbox;
			yield* serve({
				inbox: (e) =>
					Effect.gen(function* () {
						// Pour first, under a key made from the order's id. If this host dies before the
						// save below, the next host pours again under the same key, and the ledger
						// answers `dup`: one glass, never two.
						const poured = yield* self.send(glass, `pour:${e.body.id}`, {guest: e.body.guest});
						// Fenced: another host holds the kettle now. Stop; it pours this one itself.
						if (poured.how !== "sent") return yield* Effect.interrupt;
						yield* machine.dispatch({type: "brewed", rev: e.rev, guest: e.body.guest});
					}),
			});
		}).pipe(Effect.scoped),
});

// ------------------------------------------------------------------ the glass

export const Pour = Schema.Struct({guest: Schema.String});

export const Glass = Schema.Struct({
	poured: Schema.Number,
	cursor: Schema.Number,
	last: Schema.NullOr(Schema.String),
});
type Glass = typeof Glass.Type;

const glass = defineMachine({
	types: {
		model: {} as Glass,
		msg: {} as {readonly type: "poured"; readonly rev: number; readonly guest: string},
		ctx: undefined,
	},
	cmds: [],
	init: (saved) => [saved ?? {poured: 0, cursor: 0, last: null}, []],
	update: {
		poured: (s, m) =>
			m.rev <= s.cursor ? [s, []] : [{poured: s.poured + 1, cursor: m.rev, last: m.guest}, []],
	},
});

export const glassProgram = defineProgram({
	name: "glass",
	description: "Counts every glass poured, once each.",
	inputs: {inbox: input(envelope(Pour), "One pour, from the kettle.")},
	outputs: {},
	main: ({serve}) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const run = yield* self.run(
				glass,
				{schema: Glass, cursor: (s) => s.cursor},
				{ctx: undefined},
			);
			const machine = yield* run.ready;
			yield* serve({
				inbox: (e) => machine.dispatch({type: "poured", rev: e.rev, guest: e.body.guest}),
			});
		}).pipe(Effect.scoped),
});
