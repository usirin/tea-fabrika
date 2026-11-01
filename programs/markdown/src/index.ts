import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {defineProgram, end, flag, input, kind} from "@kampus/fabrika-old";
import {Duration, Effect, Schema, Stream} from "effect";
import {Root} from "./root.ts";

// Any markdown, drawn, as `glow` or `less` draws it in a terminal: in a tile of its own
// (./window.tsx). Not for experiments alone: it draws what it is told.
//
//   tsh> markdown --text "# Hi"               its window shows a heading
//   tsh> experiment --n 170 | markdown        the page; each text told replaces the one shown
//   {}                                         on `quit`: it ends, as `q` ends less
//   tsh> experiment --n 404 | markdown        the left fails, so no text comes: it ends at once
//
// Its machine holds the text read into a tree (./root.ts); its view is that tree. Once a text
// has come, a pipe's end does not end it: a person reads, then quits.

export const Model = Schema.Struct({
	root: Root,
	/** The newest text told while the page cools: read when it has cooled. Older ones are dropped. */
	waiting: Schema.NullOr(Schema.String),
	/** A text was read less than `PACE` ago. */
	cool: Schema.Boolean,
	/** Texts read so far: keys the pace Sub, so each read starts its own wait. */
	reads: Schema.Number,
});
export type Model = typeof Model.Type;

type Msg =
	| {readonly type: "show"; readonly text: string}
	| {readonly type: "told"; readonly text: string}
	| {readonly type: "cooled"};

/** The fastest a page is read and sent on: slower than a long page takes the host and the window. */
export const PACE = Duration.millis(250);

type PaceSub = Sub<"pace", {readonly reads: number}>;

/** `cooled`, once, a `PACE` after the read it is keyed by. */
const paceRunner = (_sub: PaceSub) =>
	Stream.fromEffect(Effect.sleep(PACE)).pipe(Stream.map(() => ({type: "cooled" as const})));

const read = (s: Model, text: string, cool: boolean): readonly [Model, readonly []] => [
	{root: Root.fromMarkdown(text), waiting: null, cool, reads: s.reads + 1},
	[],
];

const page = defineMachine({
	types: {model: {} as Model, msg: {} as Msg, ctx: undefined, sub: {} as PaceSub},
	cmds: [],
	init: (): readonly [Model, readonly []] => [
		{root: Root.fromMarkdown(""), waiting: null, cool: false, reads: 0},
		[],
	],
	update: {
		show: (s, m) => read(s, m.text, false),
		// The first of a burst shows at once, the newest of it a pace later: nothing waits on a
		// lone text, and what was told last always shows.
		told: (s, m): readonly [Model, readonly []] =>
			s.cool ? [{...s, waiting: m.text}, []] : read(s, m.text, true),
		cooled: (s): readonly [Model, readonly []] =>
			s.waiting === null ? [{...s, cool: false}, []] : read(s, s.waiting, true),
	},
	subs: [
		{
			type: "pace",
			deps: (s) => (s.cool ? {reads: s.reads} : null),
		} satisfies DepKeyedSub<Model, PaceSub>,
	],
});

const options = {ctx: undefined, subscribe: {pace: paceRunner}};

export const markdown = defineProgram({
	name: "markdown",
	description:
		"Draws any markdown it is told, as glow or less does: headings, paragraphs, lists, code, quotes and tables. Each text told replaces the one shown. It has a window, and ends on quit, or at once when its text closes with none told.",
	flags: {
		text: flag(
			Schema.UndefinedOr(Schema.String),
			"A markdown text to draw first. Left out, it waits for one on `text`.",
		),
	},
	inputs: {
		text: input(Schema.String, "A markdown text: it replaces the one shown."),
		quit: input(Schema.Struct({}), "The window quits: the program ends."),
	},
	outputs: {},
	machines: {
		page: kind({
			machine: page,
			state: Model,
			parent: "main",
			options: () => options,
			drawing: () => ({name: "page", steps: {pace: "wait a pace between reads"}}),
			status: (s) => `${s.root.children.length} blocks`,
		}),
	},
	view: {machine: "page", data: Root, of: (s) => s.root},
	main: ({flags, serve, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(page, options)).ready;
			const show = (text: string) => runtime.dispatch({type: "show", text}).pipe(Effect.orDie);
			yield* watch("page", "page", runtime);
			// Until the first text: a `text` that closes with none told ends it, as git's pager
			// (`less -F`) quits on an empty page. So when the program before it fails, the window
			// closes and tsh's error is what the person sees, not an empty page waiting for `q`.
			let first: "text" | "quit" | null = null;
			const got = (input: "text" | "quit") =>
				Effect.sync(() => {
					first = input;
				}).pipe(Effect.andThen(end));
			if (flags.text !== undefined) {
				yield* show(flags.text);
				first = "text";
			} else
				yield* serve(
					{text: (text) => show(text).pipe(Effect.andThen(got("text"))), quit: () => got("quit")},
					{until: ["text"]},
				);
			if (first !== "text") return;
			// Then each text told, in order with the window's quit: a pipe's end does not end the
			// window, a person reads, then quits. A quit, or `quit` closed, does.
			const told = (text: string) => runtime.dispatch({type: "told", text}).pipe(Effect.orDie);
			yield* serve({text: told, quit: () => end}, {until: ["quit"]});
		}).pipe(Effect.scoped),
});
