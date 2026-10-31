import {Cmd, defineMachine} from "@demlik/tea";
import {Schema} from "effect";
import {defineProgram, Saw} from "../app/program.ts";

// The desktop's own state: one more process in the brain, the way a tmux server holds sessions any
// client attaches to (W1). The layout is in percent, one per workspace, and focus is per workspace,
// so two windows on one workspace mirror (W4). No window size in here: size belongs to the viewer.
//
//   {type: "focus", n: 1, tile: "t2", saw: 12}   workspace 1's focus is t2, in every window on it

export type Tile = {
	readonly id: string;
	readonly shows: string;
	readonly keep: "never" | "failed" | "always";
};
export type Split = {
	readonly dir: "row" | "column";
	readonly parts: readonly {readonly percent: number; readonly inner: Split | Tile}[];
};
export type Workspace = {
	readonly n: number;
	readonly layout: Split;
	readonly focus: string;
};
export type Desktop = {readonly workspaces: readonly Workspace[]};

const TileSchema = Schema.Struct({
	id: Schema.String,
	shows: Schema.String,
	keep: Schema.Literals(["never", "failed", "always"]),
});

const SplitSchema: Schema.Codec<Split, unknown> = Schema.Struct({
	dir: Schema.Literals(["row", "column"]),
	parts: Schema.Array(
		Schema.Struct({
			percent: Schema.Number,
			inner: Schema.Union([Schema.suspend(() => SplitSchema), TileSchema]),
		}),
	),
});

export const DesktopSchema: Schema.Codec<Desktop, unknown> = Schema.Struct({
	workspaces: Schema.Array(
		Schema.Struct({n: Schema.Int, layout: SplitSchema, focus: Schema.String}),
	),
});

const DeskMsg = Schema.Struct({
	type: Schema.Literal("focus"),
	n: Schema.Int,
	tile: Schema.String,
	saw: Saw,
});
type DeskMsg = typeof DeskMsg.Type;

/** The desk's pid: one person's desk, with its numbered workspaces inside. */
export const DESK = "desk:owner";

const first: Desktop = {
	workspaces: [
		{
			n: 1,
			layout: {
				dir: "row",
				parts: [
					{percent: 50, inner: {id: "t1", shows: "counter:1", keep: "failed"}},
					{percent: 50, inner: {id: "t2", shows: "counter:2", keep: "failed"}},
				],
			},
			focus: "t1",
		},
	],
};

export const isTile = (part: Split | Tile): part is Tile => "id" in part;

/** Every tile in a layout, in reading order. */
export const tilesIn = (split: Split): readonly Tile[] =>
	split.parts.flatMap((part) => (isTile(part.inner) ? [part.inner] : tilesIn(part.inner)));

export const desk = defineProgram({
	name: "desk",
	machine: defineMachine({
		types: {model: {} as Desktop, msg: {} as DeskMsg, ctx: undefined},
		init: (loaded) => [loaded ?? first, Cmd.none],
		update: {
			// A focus on a tile that is gone does nothing: the last one that counts wins.
			focus: (state, m) => [
				{
					workspaces: state.workspaces.map((w) =>
						w.n === m.n && tilesIn(w.layout).some((t) => t.id === m.tile)
							? {...w, focus: m.tile}
							: w,
					),
				},
				Cmd.none,
			],
		},
	}),
	msg: DeskMsg,
	view: {data: DesktopSchema, select: (state) => state},
});
