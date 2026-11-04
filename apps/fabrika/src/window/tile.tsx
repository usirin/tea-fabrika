import type {PointerEvent as ReactPointerEvent, ReactNode} from "react";
import type {Keys} from "../desk/keymap.ts";
import {type LayoutNode, type Line, lineOf, type TileNode, tiles} from "../desk/layout/index.ts";
import type {FromPage} from "../messages.ts";
import {PIPES, type Pipe} from "../pipes.ts";
import {INFO, infoFor, type TicketsShown, tileWord} from "./frame.ts";

// A tile and a strip, as the desk's page draws them (docs/direction/tile-guidelines.md, decided
// 2026-11-01). They take the desk's messages as `toHost`, so a test draws them with no page around
// them (tile.test.ts); desk.tsx gives them the page's.
//
//   <section class="tile focused" data-pipe="sky">
//     <header class="titlebar">  A  ticket #7  · closing                          t2</header>
//     the body: the tile's terminal, or the view over it
//   </section>
//
// A pipe is marked by `data-pipe`, its color's name, which window.css washes the title bar with,
// and by its letter in the slot. Color is never the only cue: a tile in no pipe shows a dot in the
// same slot, so its name sits where a pipe's does.

/** The dot in a plain tile's slot: one character, as a letter is, and no word. */
const DOT = "•";

/**
 * The line a node is drawn with: its line, when every tile under it shows a window of that one
 * line, else none. So a folded column takes a pipe only when all its tiles are in it.
 */
const pipeOf = (node: LayoutNode): Line | null => {
	const lines = [...tiles(node)].map((tile) => lineOf(tile));
	const [first] = lines;
	if (first == null || lines.some((line) => line?.id !== first.id)) return null;
	return first;
};

/** The color a line is drawn in: its tint's place in the six. */
const colorOf = (line: Line | null): Pipe | undefined =>
	line === null ? undefined : PIPES[line.tint];

/** What a strip calls a node: its tile's program, or its tiles' programs in order. */
const nameOf = (node: LayoutNode): string =>
	[...tiles(node)].map((tile) => tile.shows.run?.program ?? "tsh").join(" · ");

/** A press that takes no focus: the desk gives focus to a tile, and the page follows it. */
const noFocus = (e: ReactPointerEvent) => e.preventDefault();

/** The slot: a pipe's letter, or a dot. Hidden from a screen reader, which hears it in words. */
function Slot({line}: {readonly line: Line | null}): ReactNode {
	return (
		<span className="slot" aria-hidden="true">
			{line?.letter ?? DOT}
		</span>
	);
}

/**
 * The one word a tile's state slot holds: the close question, which waits on the person, then
 * `closing`, then `zoomed`. None for a tile at rest.
 */
const stateOf = (props: {
	readonly asking: string | null;
	readonly closing: boolean;
	readonly zoomed: boolean;
}): {readonly words: string; readonly asking: boolean} | null => {
	if (props.asking !== null) return {words: props.asking, asking: true};
	if (props.closing) return {words: "closing", asking: false};
	if (props.zoomed) return {words: "zoomed", asking: false};
	return null;
};

export function Tile(props: {
	readonly tile: TileNode;
	readonly focused: boolean;
	/** The tile's close question, as tmux's confirm-before asks it, or none. */
	readonly asking: string | null;
	readonly closing: boolean;
	/** Is this the tile drawn alone (`C-b z`). */
	readonly zoomed: boolean;
	/** Does the desk let this tile fold: no for the last open tile of the workspace. */
	readonly folds: boolean;
	/** The tickets the views on the desk show, so a ticket's title bar says its number. */
	readonly tickets: TicketsShown;
	/** The key table in use, so info mode names the keys the person has. */
	readonly keys: Keys;
	readonly toHost: (msg: FromPage) => void;
	/** The body: the tile's terminal, or the view over it. */
	readonly children: ReactNode;
}): ReactNode {
	const {tile, focused, closing, folds, toHost} = props;
	const run = tile.shows.run;
	const line = lineOf(tile);
	const of = line === null ? "" : `, a window of the line typed in ${line.from}`;
	const state = stateOf(props);
	return (
		<section
			className={`tile${focused ? " focused" : ""}${closing ? " closing" : ""}`}
			data-tile={tile.id}
			data-pipe={colorOf(line)}
			aria-label={`tile ${tile.id}${run === null ? "" : `, ${run.program}`}${of}${closing ? ", closing" : ""}`}
			aria-current={focused}
			onPointerDownCapture={() => toHost({type: "click", tile: tile.id})}
		>
			{/* A press on the title bar focuses the tile, as anywhere on it, and takes no focus of
			    its own; a double-click folds it, as on a device's title bar in Ableton Live. Nothing
			    in it presses, so it is a header, with no tab stop. */}
			<header
				className="titlebar"
				data-info={infoFor(props.keys).titlebar}
				onPointerDown={noFocus}
				onDoubleClick={() => {
					if (folds) toHost({type: "fold", tile: tile.id});
				}}
			>
				<Slot line={line} />
				<span className="name">{tileWord(tile, props.tickets)}</span>
				{/* The question itself is on the status bar too, where tmux asks it; the tile it is
				    for says so as well, so an eye on the tile does not miss it. */}
				{state !== null && (
					<span className={state.asking ? "state asking" : "state"}>{state.words}</span>
				)}
				<span className="tid">{tile.id}</span>
			</header>
			{props.children}
		</section>
	);
}

/**
 * A folded tile, or a container whose tiles are all folded: a thin strip in its place, along its
 * parent's direction, named by its programs, with its pipe's wash and letter. A click opens every
 * tile it stands for.
 */
export function Strip(props: {
	readonly node: LayoutNode;
	readonly toHost: (msg: FromPage) => void;
}): ReactNode {
	const {node, toHost} = props;
	const name = nameOf(node);
	const line = pipeOf(node);
	return (
		<button
			type="button"
			className="strip"
			data-strip={node.id}
			data-pipe={colorOf(line)}
			aria-label={`open ${name}, ${node.id}`}
			data-info={INFO.strip}
			onPointerDown={noFocus}
			onClick={() => toHost({type: "unfold", node: node.id})}
		>
			<Slot line={line} />
			<span className="strip-name">{name}</span>
		</button>
	);
}
