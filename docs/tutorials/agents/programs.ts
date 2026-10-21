// Two programs. The poet asks an agent for one line per guest and sends it to the book.
// The book keeps every line, once each.
import {defineMachine} from "@demlik/tea";
import {streams} from "@tea-fabrika/tea-host";
import {envelope, Self} from "@tea-fabrika/tea-host/host";
import {defineProgram} from "@tea-fabrika/tea-program";
import {input} from "@tea-fabrika/tea-program/shape";
import {Console, Effect, Schema, Stream} from "effect";
import {write} from "./agent.ts";

// ------------------------------------------------------------------ the poet

export const Order = Schema.Struct({id: Schema.String, guest: Schema.String});

export const Poet = Schema.Struct({
	written: Schema.Number,
	cursor: Schema.Number,
	/** Dollars spent on lines that were saved. A line asked for twice is paid twice. */
	usd: Schema.Number,
});
type Poet = typeof Poet.Type;

const poet = defineMachine({
	types: {
		model: {} as Poet,
		msg: {} as {readonly type: "written"; readonly rev: number; readonly usd: number},
		ctx: undefined,
	},
	cmds: [],
	init: (saved) => [saved ?? {written: 0, cursor: 0, usd: 0}, []],
	update: {
		written: (s, m) =>
			m.rev <= s.cursor
				? [s, []]
				: [{written: s.written + 1, cursor: m.rev, usd: s.usd + m.usd}, []],
	},
});

export const poetProgram = defineProgram({
	name: "poet",
	description: "Asks an agent for one line per guest and sends it to the book.",
	inputs: {inbox: input(envelope(Order), "One order: an id and a guest.")},
	outputs: {},
	main: ({inputs}) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const run = yield* self.run(poet, {schema: Poet, cursor: (s) => s.cursor}, {ctx: undefined});
			const machine = yield* run.ready;
			const book = streams("book").inbox;
			yield* inputs.inbox.pipe(
				Stream.runForEach((e) =>
					Effect.gen(function* () {
						yield* Console.log(`${self.holder}  poet    asking for ${e.body.guest} (${e.body.id})`);
						// The slow part, and the paid one. If this host dies here, the next host asks again.
						const w = yield* write(e.body.guest).pipe(Effect.orDie);
						yield* Console.log(`${self.holder}  poet    $${w.usd.toFixed(4)}  ${w.line}`);
						// The key comes from the order, so a second line for one order never lands.
						const sent = yield* self.send(book, `line:${e.body.id}`, {
							guest: e.body.guest,
							line: w.line,
						});
						if (sent.how !== "sent") return yield* Effect.interrupt;
						yield* machine.dispatch({type: "written", rev: e.rev, usd: w.usd});
					}),
				),
			);
		}).pipe(Effect.scoped),
});

// ------------------------------------------------------------------ the book

export const Line = Schema.Struct({guest: Schema.String, line: Schema.String});

export const Book = Schema.Struct({
	cursor: Schema.Number,
	lines: Schema.Array(Line),
});
type Book = typeof Book.Type;

const book = defineMachine({
	types: {
		model: {} as Book,
		msg: {} as {
			readonly type: "kept";
			readonly rev: number;
			readonly guest: string;
			readonly line: string;
		},
		ctx: undefined,
	},
	cmds: [],
	init: (saved) => [saved ?? {cursor: 0, lines: []}, []],
	update: {
		kept: (s, m) =>
			m.rev <= s.cursor
				? [s, []]
				: [{cursor: m.rev, lines: [...s.lines, {guest: m.guest, line: m.line}]}, []],
	},
});

export const bookProgram = defineProgram({
	name: "book",
	description: "Keeps every line the poet sends, once each, in order.",
	inputs: {inbox: input(envelope(Line), "One line, from the poet.")},
	outputs: {},
	main: ({inputs}) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const run = yield* self.run(book, {schema: Book, cursor: (s) => s.cursor}, {ctx: undefined});
			const machine = yield* run.ready;
			yield* inputs.inbox.pipe(
				Stream.runForEach((e) =>
					machine.dispatch({type: "kept", rev: e.rev, guest: e.body.guest, line: e.body.line}),
				),
			);
		}).pipe(Effect.scoped),
});
