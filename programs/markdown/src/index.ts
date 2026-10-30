import {defineMachine} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {defineProgram, end, flag, input, kind} from "@kampus/fabrika";
import {Effect, Schema} from "effect";
import {Root} from "./root.ts";

// Any markdown, drawn, as `glow` or `less` draws it in a terminal: in a tile of its own
// (./window.tsx). Not for experiments alone: it draws what it is told.
//
//   tsh> markdown --text "# Hi"               its window shows a heading
//   tsh> experiment --n 170 | markdown        the page; each text told replaces the one shown
//   {}                                         on `quit`: it ends, as `q` ends less
//
// Its machine holds the text read into blocks (./root.ts); its view is those blocks. A pipe's
// end does not end it: a person reads, then quits.

export const Model = Schema.Struct({root: Root});
export type Model = typeof Model.Type;

type Msg = {readonly type: "show"; readonly text: string};

const page = defineMachine({
	types: {model: {} as Model, msg: {} as Msg, ctx: undefined},
	cmds: [],
	init: (): readonly [Model, readonly []] => [{root: Root.fromMarkdown("")}, []],
	update: {show: (_s, m): readonly [Model, readonly []] => [{root: Root.fromMarkdown(m.text)}, []]},
});

const options = {ctx: undefined};

export const markdown = defineProgram({
	name: "markdown",
	description:
		"Draws any markdown it is told, as glow or less does: headings, paragraphs, lists, code, quotes and tables. Each text told replaces the one shown. It has a window, and ends on quit.",
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
			drawing: () => ({name: "page", steps: {}}),
			status: (s) => `${s.root.children.length} blocks`,
		}),
	},
	view: {machine: "page", data: Root, of: (s) => s.root},
	main: ({flags, serve, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* (yield* run(page, options)).ready;
			const show = (text: string) => runtime.dispatch({type: "show", text}).pipe(Effect.orDie);
			if (flags.text !== undefined) yield* show(flags.text);
			yield* watch("page", "page", runtime);
			// Each text told, in order with the window's quit: a pipe's end does not end the window.
			// A quit, or `quit` closed, does.
			yield* serve({text: show, quit: () => end}, {until: ["quit"]});
		}).pipe(Effect.scoped),
});
