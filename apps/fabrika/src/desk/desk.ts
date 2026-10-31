import {defineMachine, noop} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import {TileJobs} from "../tile-jobs.ts";
import {bindingOf, type Does, PREFIX, REPEAT_MS, SHOWS} from "./keys.ts";
import {
	type Area,
	checkTree,
	createContainer,
	createTile,
	createTree,
	findChildTile,
	findSibling,
	findTile,
	fold,
	freeTint,
	isLayoutTree,
	type LayoutTree,
	type NodeId,
	type Orientation,
	openLine,
	quiet,
	remove,
	resize,
	type Shown,
	setShows,
	split,
	type TileId,
	type TileNode,
	TSH,
	tiles,
	turn,
	unfold,
	unzoom,
	zoom,
} from "./layout/index.ts";

// The desk: the one window's tiles, as a tea machine. Pure, so a test folds Msgs through it and a
// property test checks its laws after every step (desk.test.ts). Its keys are tmux's and Tuval's
// (keys.ts); its layout is Tuval's tree (layout/). Tuval's own desk machine (kamp-us/phoenix,
// apps/tuval/src/shell/core/machine.ts) is the evidence; this one is smaller.
//
//   [desk] = init(null)                                    one workspace, one tile t1: open {tile: "t1"}
//   update(desk, {type: "key", key: "<c-b>", at: 0})       the prefix is armed
//   update(desk, {type: "key", key: "|", at: 10})          t2 beside t1, focused: open {tile: "t2"}, save
//   update(desk, {type: "key", key: "x", at: 20})          ... after the prefix: "close t2? (y/n)"
//   update(desk, {type: "key", key: "y", at: 30})          nothing runs in t2: it goes, stop {tile: "t2"}
//
// Closing a tile is tmux's `confirm-before -p "kill-pane #P? (y/n)" kill-pane`, made soft:
//
//   Ctrl-B x                 always asks: "close t2? (y/n)". Only y says yes; any other key, no
//   y, nothing runs in t2    t2 goes at once: stop {tile: "t2"}
//   y, something runs        t2 is closing: close {tile: "t2"} gives its tsh and programs the end
//                            of their inputs. When its tsh has ended (`ended`), t2 goes
//   Ctrl-B x on a closing t2 asks "stop t2 now? (y/n)": y and t2 goes, stop {tile: "t2"}
//
// Any tile folds into a strip in its place (docs/direction/fold-not-tabs.md). Focus is always on
// an open tile:
//
//   Ctrl-B f, or a double-click on t2's title bar  t2 folds, and focus goes to the next open tile
//   a single click on t2's title bar               only focuses t2, as a click anywhere on it does
//   the last open tile                             does not fold: nothing changes
//   a click on t2's strip, or focus onto t2        t2 opens again, at the size it had
//   a click on a folded column's strip             every tile in it opens: {type: "unfold", node: "c4"}
//
// A line with several windows opens in place, in the tile it was typed in (layout/line.ts):
//
//   update(desk, {type: "covered", tile: "t1", runs: [tracker, ticket, runs]})
//                  t1 shows the tracker over its tsh; t4 and t5, new, show the ticket and the
//                  runs beside it, one tint for the three; save
//   the same in a workspace too small for three  t4 and t5 open folded, t1 keeps the whole share
//   update(desk, {type: "over", run: "runs:1"})  t5 goes: it was the runs' window, with no tsh
//   Ctrl-C in t4                                  goes to t1's tsh, where the line was typed
//   Ctrl-B x, y in t4                             t4 is closing: end {process: "ticket:1"} gives the
//                                                 ticket the end of its inputs; t4 goes on its `over`
//   Ctrl-B x, y in t4 again                       "stop t4 now?": kill {process: "ticket:1"}, t4 goes
//
// No timer anywhere: a closing tile waits for its programs, or for the person to say stop.
//
// It runs in the host process (host/serve.ts), as tmux's server holds its windows and panes: a
// page only draws the desk it is sent, and sends its keys and clicks. What it is told, besides
// keys and clicks, comes from the tiles beside it (tiles.ts): a run with a view is in a tile's
// foreground (`covered`), a run ended (`over`), a tile's jobs (`jobs`), a tile's tsh
// ended (`ended`). `closing` is no longer said by anyone: it was for a page loaded again, and the
// desk no longer lives in the page. A run started with `&` is a job in the background, as in
// bash, and the desk hears nothing of it until `attach` brings it to the foreground.
//
// What it asks for, each a Cmd (the host carries them out, host/serve.ts):
//
//   open {tile}          start the tile's tsh, or show the one that runs
//   close {tile}         give the tile's tsh and its programs the end of their inputs
//   stop {tile}          the tile is gone: stop what still runs in it, as tmux's kill-pane
//   send {tile, data}    bytes for the tile's tsh, as if typed: Ctrl-B twice, Ctrl-C over a program
//   save {desk}          the desk changed: keep it for the next start
//   empty {}             the last tile closed: the window closes, as the last tab's does in Terminal
//   end {process}        a line's window closed: give its one process the end of its inputs
//   kill {process}       a closing window asked to stop now: stop its one process
//   show {what}          the frame shows the asks, the keys, the info mode or hides its bars, on
//                        the page that pressed the key (window/frame.ts): not a desk change
//
// The window's frame moves the desk too (window/frame.tsx), with no key pressed:
//
//   {type: "go", tile: "t7"}           a tile anywhere, as an ask in the asks list is picked:
//                                      its workspace comes forward and it is focused
//   {type: "pick", workspace: "w2"}    a workspace clicked in the top bar
//   {type: "run", key: "z"}            the palette ran a command: as Ctrl-B, then that key
//
// And a tile's tsh moves it, by a command's tsh word (desk/words.ts), as `tmux resize-pane -Z`
// typed in a pane zooms that pane:
//
//   zoom, typed in t2              {type: "typed", tile: "t2", does: {kind: "zoom"}}: t2 is
//                                  focused, its workspace comes forward, and it zooms, as C-b z
//   focus --to t9, with no t9      `refusedOf` says "no tile t9" first, and the desk is not told
//
// Time is in the Msg (`at`), not read here: the repeat window is a deadline in the state, so no
// timer is needed, and a key after the deadline is the tile's again.

/**
 * A workspace: a layout, and the tile focus sits in. `focused` always names a tile of `layout`,
 * and one that is open, not folded.
 */
export interface Workspace {
	readonly id: string;
	readonly layout: LayoutTree;
	readonly focused: TileId;
}

/** The prefix. Armed with `until: null`, it waits as long as it takes; with a number, until then. */
export type Prefix =
	| {readonly armed: false}
	| {readonly armed: true; readonly until: number | null};

/** The desk while it has tiles. */
export interface Open {
	readonly at: "open";
	readonly workspaces: readonly [Workspace, ...Workspace[]];
	readonly active: string;
	readonly prefix: Prefix;
	/**
	 * The tile asking y or n, in the active workspace, or none. What it asks follows from the tile
	 * (`questionOf`): "close t2?", or "stop t2 now?" once it is closing.
	 */
	readonly ask: TileId | null;
	/** Each tile's jobs, as its tsh says them (tile-jobs.ts). A tile not named runs none. */
	readonly jobs: Readonly<Record<TileId, TileJobs>>;
	/** The tiles closing: their programs have been given the end of their inputs, and the tile waits for their end. */
	readonly closing: readonly TileId[];
	/** The next number to mint: every id is `t<n>`, `s<n>` or `w<n>` for one `n`, spent once. */
	readonly next: number;
	/** The workspace's size in px, as the page last said, or `null` before any page has. */
	readonly area: Area | null;
}

/** Which way a line's windows run, for now always: left to right, as a pipe reads. */
export const LINE: Orientation = "horizontal";

/** The desk: open, or over once its last tile closed. */
export type Desk = Open | {readonly at: "over"};

export type DeskMsg =
	/** A key, named as `keyName` names it, and when it was pressed, in milliseconds. */
	| {readonly type: "key"; readonly key: string; readonly at: number}
	/** A tile was clicked. */
	| {readonly type: "click"; readonly tile: TileId}
	/** A border was dragged: a container's new sizes, in percent. */
	| {
			readonly type: "resize";
			readonly container: string;
			readonly sizes: Readonly<Record<string, number>>;
	  }
	/** A tile's title bar was double-clicked: fold it. */
	| {readonly type: "fold"; readonly tile: TileId}
	/** A strip was clicked: open the folded tile, or every tile of the folded container, it stands for. */
	| {readonly type: "unfold"; readonly node: NodeId}
	/**
	 * A line's runs with a view are in a tile's foreground, started there or attached, in the
	 * line's order. One covers the tile's tsh; several open in place (`openLine`).
	 */
	| {readonly type: "covered"; readonly tile: TileId; readonly runs: readonly [Shown, ...Shown[]]}
	/** The page drew the workspace at this size, in px. */
	| {readonly type: "area"; readonly width: number; readonly height: number}
	/** A run with a view ended. */
	| {readonly type: "over"; readonly run: string}
	/** A tile's jobs now: the ones running in its tsh, and the last to end. */
	| {readonly type: "jobs"; readonly tile: TileId; readonly jobs: TileJobs}
	/** A tile is closing: its programs were given their inputs' end. Said by no one since the desk moved to the host. */
	| {readonly type: "closing"; readonly tile: TileId}
	/** A tile's tsh ended: `exit`, Ctrl-D on an empty line, or its programs ended after a close. */
	| {readonly type: "ended"; readonly tile: TileId}
	/** Focus this tile, in whichever workspace it is: that workspace comes forward. */
	| {readonly type: "go"; readonly tile: TileId}
	/** This workspace comes forward. */
	| {readonly type: "pick"; readonly workspace: string}
	/** What this key does after the prefix, with no prefix pressed: the palette ran it. */
	| {readonly type: "run"; readonly key: string}
	/** A command's tsh word, typed in this tile's tsh: it does what its key does, from this tile. */
	| {readonly type: "typed"; readonly tile: TileId; readonly does: Does};

/** A tile's id: `t` and a number. The host names a folder by it, so nothing else passes. */
export const TileIdSchema = Schema.String.check(Schema.isPattern(/^t[0-9]{1,9}$/));

const Done = Schema.Null;
const Tile = Schema.Struct({tile: TileIdSchema});

/** The desk as it is kept between starts: its workspaces, the active one, and the next number. */
export const Saved = Schema.Struct({
	workspaces: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			layout: Schema.declare(isLayoutTree),
			focused: Schema.String,
		}),
	),
	active: Schema.String,
	next: Schema.Int,
});
export type Saved = typeof Saved.Type;

/** The prefix, as it is sent to a page. */
const PrefixSchema = Schema.Union([
	Schema.Struct({armed: Schema.Literal(false)}),
	Schema.Struct({armed: Schema.Literal(true), until: Schema.NullOr(Schema.Number)}),
]);

const WorkspaceSchema = Schema.Struct({
	id: Schema.String,
	layout: Schema.declare(isLayoutTree),
	focused: TileIdSchema,
});

/**
 * The whole desk, as the host sends it to every page to draw (messages.ts, `ToPage`). The page reads it
 * strictly, and draws nothing it does not read.
 */
export const DeskSchema = Schema.Union([
	Schema.Struct({
		at: Schema.Literal("open"),
		workspaces: Schema.NonEmptyArray(WorkspaceSchema),
		active: Schema.String,
		prefix: PrefixSchema,
		ask: Schema.NullOr(TileIdSchema),
		jobs: Schema.Record(Schema.String, TileJobs),
		closing: Schema.Array(TileIdSchema),
		next: Schema.Int,
		area: Schema.NullOr(Schema.Struct({width: Schema.Number, height: Schema.Number})),
	}),
	Schema.Struct({at: Schema.Literal("over")}),
]);

/**
 * Which keys the desk takes now, for a page to send it and not the tile: every key (a question is
 * asked, or the prefix is armed), or only these. It is `claims`, asked ahead: `all` is the desk
 * listening to the next key whatever it is, and the host answers whether it took it.
 */
export interface Takes {
	readonly all: boolean;
	readonly keys: readonly string[];
}

/** What the desk takes at `now`, by `claims`: the prefix and Ctrl-C over a program, or every key. */
export const takenNow = (s: Desk, now: number): Takes => {
	if (s.at === "over") return {all: false, keys: []};
	const armed = s.prefix.armed && (s.prefix.until === null || now <= s.prefix.until);
	if (s.ask !== null || armed) return {all: true, keys: []};
	return {all: false, keys: [PREFIX, "<c-c>"].filter((key) => claims(s, key, now))};
};

export const open = Cmd.define("open", {input: Tile, ok: Done, err: []});
export const close = Cmd.define("close", {input: Tile, ok: Done, err: []});
export const stop = Cmd.define("stop", {input: Tile, ok: Done, err: []});
export const send = Cmd.define("send", {
	input: Schema.Struct({tile: TileIdSchema, data: Schema.String}),
	ok: Done,
	err: [],
});
export const save = Cmd.define("save", {input: Schema.Struct({desk: Saved}), ok: Done, err: []});
export const empty = Cmd.define("empty", {input: Schema.Struct({}), ok: Done, err: []});
/** One process, a window of a line: by its id. */
const Process = Schema.Struct({process: Schema.String});
export const end = Cmd.define("end", {input: Process, ok: Done, err: []});
export const kill = Cmd.define("kill", {input: Process, ok: Done, err: []});
/** The frame shows something, on the page whose key asked: no tile and no layout changes. */
export const show = Cmd.define("show", {
	input: Schema.Struct({what: Schema.Literals(SHOWS)}),
	ok: Done,
	err: [],
});

export type DeskCmd =
	| ReturnType<typeof open>
	| ReturnType<typeof close>
	| ReturnType<typeof stop>
	| ReturnType<typeof send>
	| ReturnType<typeof save>
	| ReturnType<typeof empty>
	| ReturnType<typeof end>
	| ReturnType<typeof kill>
	| ReturnType<typeof show>;

type Step = readonly [Desk, readonly DeskCmd[]];

const DISARMED: Prefix = {armed: false};

/** A fresh desk: one workspace, one tile running tsh. */
export const fresh = (): Open => ({
	at: "open",
	workspaces: [blank(1)],
	active: "w1",
	prefix: DISARMED,
	ask: null,
	jobs: {},
	closing: [],
	next: 2,
	area: null,
});

const blank = (n: number): Workspace => ({
	id: `w${n}`,
	layout: createTree(createContainer(`c${n}`, "horizontal", [createTile(`t${n}`)])),
	focused: `t${n}`,
});

/** Every tile of a workspace, in reading order. */
export const tilesOf = (ws: Workspace): readonly TileNode[] => [...tiles(ws.layout.root)];

/** The active workspace. The desk keeps `active` naming one; the first stands in if not. */
export const activeOf = (s: Open): Workspace =>
	s.workspaces.find((ws) => ws.id === s.active) ?? s.workspaces[0];

/** The workspace a tile is in, or none. */
export const whereIs = (s: Open, tile: TileId): Workspace | undefined =>
	s.workspaces.find((ws) => findTile(ws.layout, tile) !== null);

/** The tile with focus, in the active workspace. */
export const focusedOf = (s: Open): TileNode | null => {
	const ws = activeOf(s);
	return findTile(ws.layout, ws.focused);
};

/** The desk as it is kept. */
export const savedOf = (s: Open): Saved => ({
	workspaces: s.workspaces,
	active: s.active,
	next: s.next,
});

/**
 * The desk with this workspace in it. Its focused tile is unfolded on the way in, so focus is
 * always on an open tile, whatever moved focus there: a key, a click or a tile that went.
 */
const withWorkspace = (s: Open, given: Workspace): Open => {
	const ws = {...given, layout: unfold(given.layout, given.focused)};
	const [first, ...rest] = s.workspaces.map((w) => (w.id === ws.id ? ws : w));
	return first === undefined ? s : {...s, workspaces: [first, ...rest]};
};

const keep = (s: Open): readonly DeskCmd[] => [save({desk: savedOf(s)})];

/**
 * Take tiles out of a workspace. Their own Cmds are the caller's. Focus goes to the tile after the
 * first one taken, or before it, in reading order. A workspace left with no tile goes, and the
 * desk is over when no workspace is left.
 */
const drop = (s: Open, ws: Workspace, doomed: readonly TileId[]): Desk => {
	const all = tilesOf(ws).map((t) => t.id);
	const left = all.filter((id) => !doomed.includes(id));
	const jobs = Object.fromEntries(
		Object.entries(s.jobs).filter(([tile]) => !doomed.includes(tile)),
	);
	const closing = s.closing.filter((tile) => !doomed.includes(tile));
	const ask = s.ask !== null && doomed.includes(s.ask) ? null : s.ask;
	if (left.length === 0) {
		const at = s.workspaces.findIndex((w) => w.id === ws.id);
		const [first, ...rest] = s.workspaces.filter((w) => w.id !== ws.id);
		if (first === undefined) return {at: "over"};
		const workspaces: Open["workspaces"] = [first, ...rest];
		const active =
			s.active !== ws.id ? s.active : (workspaces[Math.min(at, workspaces.length - 1)] ?? first).id;
		return {...s, workspaces, active, jobs, closing, ask};
	}
	const layout = doomed.reduce(remove, ws.layout);
	const focused = left.includes(ws.focused) ? ws.focused : heirOf(all, openIn(layout), ws.focused);
	return {...withWorkspace(s, {...ws, layout, focused}), jobs, closing, ask};
};

/** The open tiles of a layout, in reading order. */
const openIn = (layout: LayoutTree): readonly TileId[] =>
	[...tiles(layout.root)].filter((t) => !t.folded).map((t) => t.id);

/**
 * Fold a tile of a workspace. Focus on it goes to the next open tile in reading order, else the
 * one before. The last open tile does not fold, and nothing changes. A question asked is answered
 * no, as a click answers it.
 */
const folded = (s: Open, ws: Workspace, tile: TileId): Step => {
	const layout = fold(ws.layout, tile);
	if (layout === ws.layout) return [s, []];
	const all = tilesOf(ws).map((t) => t.id);
	const focused = ws.focused === tile ? heirOf(all, openIn(layout), tile) : ws.focused;
	const next = {...withWorkspace(s, {...ws, layout, focused}), ask: null};
	return [next, keep(next)];
};

/** Open a folded tile, or every tile of a folded container, and focus its first tile. */
const unfolded = (s: Open, node: NodeId): Step => {
	const ws = activeOf(s);
	const layout = unfold(ws.layout, node);
	const first = findChildTile(layout, node, "start");
	if (layout === ws.layout || first === null) return [s, []];
	const next = {...withWorkspace(s, {...ws, layout, focused: first.id}), ask: null};
	return [next, keep(next)];
};

/** Where focus goes when its tile is taken: the next tile left in reading order, else the one before. */
const heirOf = (all: readonly TileId[], left: readonly TileId[], from: TileId): TileId => {
	const at = all.indexOf(from);
	const after = all.slice(at + 1).find((id) => left.includes(id));
	const before = all.slice(0, Math.max(0, at)).findLast((id) => left.includes(id));
	return after ?? before ?? left[0] ?? from;
};

/** The tile goes from the desk, and what still runs in it stops. The last tile empties the desk. */
const goneTile = (s: Open, tile: TileId): Step => {
	const ws = whereIs(s, tile);
	if (ws === undefined) return [s, []];
	const next = drop(s, ws, [tile]);
	const own = stop({tile});
	return next.at === "over" ? [next, [own, empty({})]] : [next, [own, ...keep(next)]];
};

/** Does something run in this tile: a job in its tsh, or a run covering it? */
const busy = (s: Open, tile: TileNode): boolean =>
	(s.jobs[tile.id]?.running.length ?? 0) > 0 || tile.shows.run !== null;

/** The question a tile asks, as tmux's confirm-before puts it: close it, or, once it is closing, stop it now. */
export const questionOf = (s: Open, tile: TileId): string =>
	s.closing.includes(tile) ? `stop ${tile} now? (y/n)` : `close ${tile}? (y/n)`;

/**
 * y to the tile's question. A closing tile goes now, stopped. One with nothing running goes at
 * once. One with something running is closing: its programs get the end of their inputs, and it
 * goes when its tsh says it ended. A line's window holds one process and no tsh: that process is
 * what closes (`windowYes`).
 */
const yes = (s: Open, tile: TileId): Step => {
	const ws = whereIs(s, tile);
	const node = ws === undefined ? null : findTile(ws.layout, tile);
	if (node === null) return [s, []];
	if (node.shows.kind === "window") return windowYes(s, tile, node.shows.run.id);
	if (s.closing.includes(tile) || !busy(s, node)) return goneTile(s, tile);
	return [{...s, closing: [...s.closing, tile]}, [close({tile})]];
};

/**
 * y on a line's window, as tmux's kill-pane on a pane holding one process: the process gets the
 * end of its inputs, and the window waits for it to end (`over`), as a busy tile waits for its
 * tsh. Asked again, "stop now?", y kills it and the window goes. Its neighbours in the line
 * follow the pipes, in the host: the one before fails at its next send, the one after sees its
 * input end.
 */
const windowYes = (s: Open, tile: TileId, process: string): Step => {
	if (!s.closing.includes(tile)) return [{...s, closing: [...s.closing, tile]}, [end({process})]];
	const [next, cmds] = goneTile(s, tile);
	return [next, [kill({process}), ...cmds]];
};

/** What a key after the prefix does. */
const act = (s: Open, does: Does): Step => {
	const ws = activeOf(s);
	switch (does.kind) {
		case "split": {
			const ids = {tile: `t${s.next}`, container: `c${s.next}`};
			const layout = split(unzoom(ws.layout), ws.focused, does.orientation, ids);
			if (layout === ws.layout || findTile(layout, ids.tile) === null) return [s, []];
			const next = {...withWorkspace(s, {...ws, layout, focused: ids.tile}), next: s.next + 1};
			return [next, [open({tile: ids.tile}), ...keep(next)]];
		}
		case "focus": {
			const to = findSibling(ws.layout, ws.focused, does.to);
			if (to === null) return [s, []];
			// Focus moves out of a zoomed tile: the zoom goes, so the focused tile is always drawn.
			const next = withWorkspace(s, {...ws, layout: unzoom(ws.layout), focused: to.id});
			return [next, keep(next)];
		}
		case "go":
			return went(s, does.tile);
		case "fold":
			return folded(s, ws, ws.focused);
		case "turn": {
			// As tmux's next-layout, a turn undoes the zoom: a turn under it would not be seen.
			const layout = turn(unzoom(ws.layout), ws.focused);
			if (layout === ws.layout) return [s, []];
			const next = withWorkspace(s, {...ws, layout});
			return [next, keep(next)];
		}
		case "zoom": {
			if (tilesOf(ws).length < 2) return [s, []];
			const layout = ws.layout.zoomed === null ? zoom(ws.layout, ws.focused) : unzoom(ws.layout);
			const next = withWorkspace(s, {...ws, layout});
			return [next, keep(next)];
		}
		case "close": {
			// Always asked, as tmux's default binding: confirm-before, then kill-pane.
			if (findTile(ws.layout, ws.focused) === null) return [s, []];
			return [{...s, ask: ws.focused}, []];
		}
		case "new": {
			const made = blank(s.next);
			const [first, ...rest] = s.workspaces;
			const next: Open = {
				...s,
				workspaces: [first, ...rest, made],
				active: made.id,
				next: s.next + 1,
			};
			return [next, [open({tile: made.focused}), ...keep(next)]];
		}
		case "step": {
			if (s.workspaces.length < 2) return [s, []];
			const at = s.workspaces.findIndex((w) => w.id === ws.id);
			const by = does.to === "next" ? 1 : -1;
			const n = s.workspaces.length;
			const to = s.workspaces[(at + by + n) % n] ?? ws;
			const next = {...s, active: to.id};
			return [next, keep(next)];
		}
		case "pick": {
			const to = s.workspaces[does.at - 1];
			return to === undefined ? [s, []] : picked(s, to.id);
		}
		case "show":
			return [s, [show({what: does.what})]];
	}
};

/** This workspace comes forward. One not there, or the one forward already, changes nothing. */
const picked = (s: Open, id: string): Step => {
	if (s.active === id || !s.workspaces.some((ws) => ws.id === id)) return [s, []];
	const next = {...s, active: id, ask: null};
	return [next, keep(next)];
};

/**
 * Focus a tile, in whichever workspace it is, as picking an ask in the asks list does. Its
 * workspace comes forward; a zoom on another tile goes, so the tile is drawn; a question asked is
 * answered no, as a click answers it.
 */
const went = (s: Open, tile: TileId): readonly [Open, readonly DeskCmd[]] => {
	const ws = whereIs(s, tile);
	if (ws === undefined) return [s, []];
	if (s.active === ws.id && ws.focused === tile && s.ask === null) return [s, []];
	const layout =
		ws.layout.zoomed === null || ws.layout.zoomed === tile ? ws.layout : unzoom(ws.layout);
	const next = {...withWorkspace(s, {...ws, layout, focused: tile}), active: ws.id, ask: null};
	return [next, keep(next)];
};

/** The palette ran a key's command: as after the prefix, with the prefix put down and no question up. */
const ran = (s: Open, key: string): Step => {
	const binding = bindingOf(key);
	if (binding === undefined) return [s, []];
	return act({...s, prefix: DISARMED, ask: null}, binding.does);
};

/**
 * Why a tsh word typed in `tile` would do nothing it was asked to, or `null`: it names a tile or a
 * workspace that is not there. A key never can, so a key has no such answer; a word says it, as
 * `tmux select-pane -t %9` says "can't find pane". Asked before the desk is told.
 */
export const refusedOf = (s: Desk, tile: TileId, does: Does): string | null => {
	if (s.at !== "open" || whereIs(s, tile) === undefined) return `${tile} is gone`;
	if (does.kind === "go" && whereIs(s, does.tile) === undefined) return `no tile ${does.tile}`;
	const n = s.workspaces.length;
	if (does.kind === "pick" && does.at > n)
		return `no workspace ${does.at}: there ${n === 1 ? "is 1" : `are ${n}`}`;
	return null;
};

/**
 * A command's tsh word, typed in `tile`: as its key, from that tile. The tile is focused and its
 * workspace comes forward first, as the keys you type into a tile come from it; then the command
 * acts, with the prefix put down and no question up. A word that moves focus to a tile goes there
 * straight.
 */
const typed = (s: Open, tile: TileId, does: Does): Step => {
	if (whereIs(s, tile) === undefined) return [s, []];
	if (does.kind === "go") return went(s, does.tile);
	const [here, moved] = went(s, tile);
	const ready =
		here.prefix.armed || here.ask !== null ? {...here, prefix: DISARMED, ask: null} : here;
	const [next, cmds] = act(ready, does);
	if (next.at !== "open") return [next, cmds];
	// One save, of the desk after both: the move to the tile, and what the command changed.
	const others = cmds.filter((c) => c.type !== "save");
	const saved = moved.length > 0 || others.length !== cmds.length;
	return [next, saved ? [...others, ...keep(next)] : others];
};

/** What a key comes to: the desk's (with its step), or the focused tile's, as if the desk were not there. */
export type Routed = {readonly kind: "desk"; readonly step: Step} | {readonly kind: "tile"};

const desk = (step: Step): Routed => ({kind: "desk", step});

/** The byte Ctrl-B and Ctrl-C send a terminal. */
const CTRL_B = "\x02";
const CTRL_C = "\x03";

/** The tile whose tsh runs what this tile shows: its own, or the one its line was typed in. */
export const tshOf = (tile: TileNode): TileId =>
	tile.shows.kind === "window" ? tile.shows.line.from : tile.id;

/** A key with the prefix not armed: Ctrl-B arms it; Ctrl-C over a program goes to its tile's tsh. */
const unarmed = (s: Open, key: string): Routed => {
	if (key === PREFIX) return desk([{...s, prefix: {armed: true, until: null}}, []]);
	const tile = focusedOf(s);
	// The program covers the terminal, so its tsh would never see Ctrl-C: the desk hands it on, to
	// the tsh the line was typed in when the tile is one of its windows.
	if (key === "<c-c>" && tile !== null && tile.shows.run !== null)
		return desk([s, [send({tile: tshOf(tile), data: CTRL_C})]]);
	return {kind: "tile"};
};

/**
 * Where a key goes. One function for both questions the page asks: does the desk take this key
 * (so the terminal and the program never see it), and what does it do. `update` answers with it,
 * and so does `claims`, so the two cannot disagree.
 */
export const route = (s: Open, key: string, at: number): Routed => {
	if (s.ask !== null) {
		// tmux's confirm-before: only y says yes; any other key says no.
		if (key === "y") return desk(yes({...s, ask: null}, s.ask));
		return desk([{...s, ask: null}, []]);
	}
	const {prefix} = s;
	if (!prefix.armed) return unarmed(s, key);
	const disarmed: Open = {...s, prefix: DISARMED};
	const binding = bindingOf(key);
	if (prefix.until !== null) {
		// The repeat window: a repeatable key repeats; anything else, or a key after it, is the tile's.
		if (at > prefix.until || binding === undefined || !binding.repeats)
			return unarmed(disarmed, key);
		const [next, cmds] = act(disarmed, binding.does);
		return desk([
			next.at === "open" ? {...next, prefix: {armed: true, until: at + REPEAT_MS}} : next,
			cmds,
		]);
	}
	if (key === PREFIX) {
		// tmux's send-prefix: Ctrl-B twice sends one Ctrl-B on, to a tsh that is not covered.
		const tile = focusedOf(s);
		const to = tile !== null && tile.shows.run === null;
		return desk([disarmed, to ? [send({tile: tile.id, data: CTRL_B})] : []]);
	}
	// A key with no binding after the prefix is swallowed, as tmux does.
	if (binding === undefined) return desk([disarmed, []]);
	const [next, cmds] = act(disarmed, binding.does);
	return desk([
		next.at === "open" && binding.repeats
			? {...next, prefix: {armed: true, until: at + REPEAT_MS}}
			: next,
		cmds,
	]);
};

/** Does the desk take this key? The page asks before the terminal or the program sees it. */
export const claims = (s: Desk, key: string, at: number): boolean =>
	s.at === "open" && route(s, key, at).kind === "desk";

/** Each tile showing a run, wherever it is: the run's id, its workspace and its tile. */
const showing = (s: Open, run: string) =>
	s.workspaces.flatMap((ws) =>
		tilesOf(ws)
			.filter((t) => t.shows.run?.id === run)
			.map((t) => ({ws, tile: t})),
	);

const onOpen =
	<M extends DeskMsg>(f: (s: Open, m: M) => Step) =>
	(s: Desk, m: M): Step =>
		s.at === "open" ? f(s, m) : [s, []];

/** A tile of the active workspace gets focus; the question, if one was asked, is answered no. */
const clicked = (s: Open, tile: TileId): Step => {
	const ws = activeOf(s);
	if (findTile(ws.layout, tile) === null) return [s, []];
	if (ws.focused === tile && s.ask === null) return [s, []];
	const layout =
		ws.layout.zoomed === null || ws.layout.zoomed === tile ? ws.layout : unzoom(ws.layout);
	const next = {...withWorkspace(s, {...ws, layout, focused: tile}), ask: null};
	return [next, keep(next)];
};

/**
 * A line is in a tile's foreground. One run covers the tile, and nothing is kept: a kept desk
 * shows no run. Several open in place (`openLine`), each window after the first in a tile minted
 * here, and the desk is kept, as its tiles changed. A line typed into a tile that is gone, or
 * that is a window with no tsh of its own, changes nothing.
 */
const covered = (s: Open, tile: TileId, runs: readonly [Shown, ...Shown[]]): Step => {
	const ws = whereIs(s, tile);
	const node = ws === undefined ? null : findTile(ws.layout, tile);
	if (ws === undefined || node === null || node.shows.kind === "window") return [s, []];
	const more = runs.length - 1;
	const layout = openLine(ws.layout, tile, {
		runs,
		tint: freeTint(s.workspaces.map((w) => w.layout)),
		orientation: LINE,
		ids: {tiles: Array.from({length: more}, (_, k) => `t${s.next + k}`), container: `c${s.next}`},
		area: s.area,
	});
	if (layout === ws.layout) return [s, []];
	// One run over a tsh changes nothing kept: a restore shows the tsh again. Over the tile a line
	// was typed in (its line sent to the back), that line's windows lose the tile they give their
	// space back to, and that is kept.
	if (more === 0 && node.shows.kind === "tsh") return [withWorkspace(s, {...ws, layout}), []];
	if (more === 0) {
		const next = withWorkspace(s, {...ws, layout});
		return [next, keep(next)];
	}
	const next = {...withWorkspace(s, {...ws, layout}), next: s.next + more};
	return [next, keep(next)];
};

/**
 * A run ended: each tile it covered shows its tsh again, and each window of a line it was goes,
 * its space back to the line. The last tile going empties the desk.
 */
const over = (s: Open, run: string): Step => {
	let next: Desk = s;
	const cmds: DeskCmd[] = [];
	for (const {tile} of showing(s, run)) {
		if (next.at !== "open") break;
		const ws = whereIs(next, tile.id);
		if (ws === undefined) continue;
		if (tile.shows.kind === "window") {
			next = drop(next, ws, [tile.id]);
			cmds.push(stop({tile: tile.id}));
		} else next = withWorkspace(next, {...ws, layout: setShows(ws.layout, tile.id, TSH)});
	}
	if (next === s) return [s, []];
	return [next, [...cmds, ...(next.at === "over" ? [empty({})] : keep(next))]];
};

/** A tile the main process says is closing: its question is "stop it now?" from here on. */
const closingNow = (s: Open, tile: TileId): Step =>
	whereIs(s, tile) === undefined || s.closing.includes(tile)
		? [s, []]
		: [{...s, closing: [...s.closing, tile]}, []];

export const deskMachine = defineMachine({
	types: {model: {} as Desk, msg: {} as DeskMsg},
	cmds: [open, close, stop, send, save, empty, end, kill, show],
	init: (loaded) => {
		if (loaded !== null && loaded.at === "open")
			return [
				loaded,
				loaded.workspaces.flatMap((ws) =>
					tilesOf(ws).flatMap((t) => (t.shows.kind === "window" ? [] : [open({tile: t.id})])),
				),
			];
		const s = fresh();
		return [s, [open({tile: "t1"}), ...keep(s)]];
	},
	update: {
		key: onOpen((s, m) => {
			const routed = route(s, m.key, m.at);
			return routed.kind === "desk" ? routed.step : [s, []];
		}),
		click: onOpen((s, m) => clicked(s, m.tile)),
		resize: onOpen((s, m) => {
			const ws = activeOf(s);
			const layout = resize(ws.layout, m.container, m.sizes);
			if (layout === ws.layout) return [s, []];
			const next = withWorkspace(s, {...ws, layout});
			return [next, keep(next)];
		}),
		fold: onOpen((s, m) => folded(s, activeOf(s), m.tile)),
		unfold: onOpen((s, m) => unfolded(s, m.node)),
		covered: onOpen((s, m) => covered(s, m.tile, m.runs)),
		area: onOpen((s, m) => [{...s, area: {width: m.width, height: m.height}}, []]),
		over: onOpen((s, m) => over(s, m.run)),
		jobs: onOpen((s, m) =>
			whereIs(s, m.tile) === undefined
				? [s, []]
				: [{...s, jobs: {...s.jobs, [m.tile]: m.jobs}}, []],
		),
		closing: onOpen((s, m) => closingNow(s, m.tile)),
		ended: onOpen((s, m) => goneTile(s, m.tile)),
		go: onOpen((s, m) => went(s, m.tile)),
		pick: onOpen((s, m) => picked(s, m.workspace)),
		run: onOpen((s, m) => ran(s, m.key)),
		typed: onOpen((s, m) => typed(s, m.tile, m.does)),
		show_ok: noop,
		show_err: noop,
		open_ok: noop,
		open_err: noop,
		close_ok: noop,
		close_err: noop,
		stop_ok: noop,
		stop_err: noop,
		send_ok: noop,
		send_err: noop,
		save_ok: noop,
		save_err: noop,
		empty_ok: noop,
		empty_err: noop,
		end_ok: noop,
		end_err: noop,
		kill_ok: noop,
		kill_err: noop,
	},
});

const TILE_ID = /^t([0-9]{1,9})$/;
const decodeSaved = Schema.decodeUnknownOption(Saved);

/**
 * A kept desk, read back for the next start, or `null`: it does not read, or breaks a law of the
 * desk. The host reads it as it starts. A tile covered by a run shows its tsh again: after the
 * host stopped nothing runs, and `attach` brings the run back; a line's other windows go, their
 * space back to the tile it was typed in (`quiet`). The prefix is not armed, nothing
 * is asked, and nothing is closing.
 */
export const restore = (raw: unknown): Open | null => {
	const read = decodeSaved(raw);
	if (read._tag === "None") return null;
	const saved = read.value;
	const seen = new Set<string>();
	let top = 0;
	const workspaces: Workspace[] = [];
	for (const ws of saved.workspaces) {
		if (checkTree(ws.layout).length > 0) return null;
		const layout = quiet(ws.layout);
		const left = [...tiles(layout.root)];
		for (const t of left) {
			const n = TILE_ID.exec(t.id);
			if (n === null || seen.has(t.id)) return null;
			seen.add(t.id);
			top = Math.max(top, Number(n[1]));
		}
		const [first] = left;
		if (first === undefined) continue;
		const focused = left.some((t) => t.id === ws.focused) ? ws.focused : first.id;
		const zoomed = layout.zoomed === focused ? layout : unzoom(layout);
		workspaces.push({id: ws.id, layout: unfold(zoomed, focused), focused});
	}
	const [first, ...rest] = workspaces;
	if (first === undefined) return null;
	const active = workspaces.some((ws) => ws.id === saved.active) ? saved.active : first.id;
	return {
		at: "open",
		workspaces: [first, ...rest],
		active,
		prefix: DISARMED,
		ask: null,
		jobs: {},
		closing: [],
		next: Math.max(saved.next, top + 1),
		area: null,
	};
};
