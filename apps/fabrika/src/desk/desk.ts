import {defineMachine, noop} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import {bindingOf, type Does, PREFIX, REPEAT_MS} from "./keys.ts";
import {
	checkTree,
	createStack,
	createTile,
	createTree,
	findSibling,
	findTile,
	isLayoutTree,
	type LayoutTree,
	remove,
	resize,
	type Shown,
	type Shows,
	setShows,
	split,
	type TileId,
	type TileNode,
	TSH,
	tiles,
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
//   update(desk, {type: "key", key: "x", at: 20})          ... after the prefix: t2 closes: close {tile: "t2"}
//
// What it is told, besides keys and clicks, comes from the main process, where each tile's tsh
// runs (tiles.ts): a run with a view began in a tile's foreground (`covered`) or with `&`
// (`beside`), a run ended (`over`), a tile's running jobs (`jobs`), a tile's tsh ended (`ended`).
//
// What it asks for, each a Cmd (the page carries them to the main process, window/desk.tsx):
//
//   open {tile}          start the tile's tsh, or show the one that runs
//   close {tile}         end the tile's tsh and its runs, as tmux's kill-pane
//   stop {run}           stop one run: its own tile was closed
//   send {tile, data}    bytes for the tile's tsh, as if typed: Ctrl-B twice, Ctrl-C over a program
//   save {desk}          the desk changed: keep it for the next start
//   quit {}              the last tile closed: the app quits, as tmux ends with its last pane
//
// Time is in the Msg (`at`), not read here: the repeat window is a deadline in the state, so no
// timer is needed, and a key after the deadline is the tile's again.

/** A workspace: a layout, and the tile focus sits in. `focused` always names a tile of `layout`. */
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
	/** The tile asking "close it, and stop what runs in it?", in the active workspace, or none. */
	readonly ask: TileId | null;
	/** How many jobs run in each tile's tsh, as its tsh says. A tile not named runs none. */
	readonly running: Readonly<Record<TileId, number>>;
	/** The next number to mint: every id is `t<n>`, `s<n>` or `w<n>` for one `n`, spent once. */
	readonly next: number;
}

/** The desk: open, or over once its last tile closed. */
export type Desk = Open | {readonly at: "over"};

export type DeskMsg =
	/** A key, named as `keyName` names it, and when it was pressed, in milliseconds. */
	| {readonly type: "key"; readonly key: string; readonly at: number}
	/** A tile was clicked. */
	| {readonly type: "click"; readonly tile: TileId}
	/** A border was dragged: a stack's new sizes, in percent. */
	| {
			readonly type: "resize";
			readonly stack: string;
			readonly sizes: Readonly<Record<string, number>>;
	  }
	/** A run with a view began in a tile's foreground: it covers the tile's tsh. */
	| {readonly type: "covered"; readonly tile: TileId; readonly run: Shown}
	/** A run with a view began with `&`: it gets a tile of its own beside the tile's tsh. */
	| {readonly type: "beside"; readonly tile: TileId; readonly run: Shown}
	/** A run with a view ended. */
	| {readonly type: "over"; readonly run: string}
	/** How many jobs run in a tile's tsh now. */
	| {readonly type: "jobs"; readonly tile: TileId; readonly running: number}
	/** A tile's tsh ended: `exit`, or Ctrl-D on an empty line. */
	| {readonly type: "ended"; readonly tile: TileId};

/** A tile's id: `t` and a number. The main process names a folder by it, so nothing else passes. */
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

export const open = Cmd.define("open", {input: Tile, ok: Done, err: []});
export const close = Cmd.define("close", {input: Tile, ok: Done, err: []});
export const stop = Cmd.define("stop", {
	input: Schema.Struct({run: Schema.String}),
	ok: Done,
	err: [],
});
export const send = Cmd.define("send", {
	input: Schema.Struct({tile: TileIdSchema, data: Schema.String}),
	ok: Done,
	err: [],
});
export const save = Cmd.define("save", {input: Schema.Struct({desk: Saved}), ok: Done, err: []});
export const quit = Cmd.define("quit", {input: Schema.Struct({}), ok: Done, err: []});

export type DeskCmd =
	| ReturnType<typeof open>
	| ReturnType<typeof close>
	| ReturnType<typeof stop>
	| ReturnType<typeof send>
	| ReturnType<typeof save>
	| ReturnType<typeof quit>;

type Step = readonly [Desk, readonly DeskCmd[]];

const DISARMED: Prefix = {armed: false};

/** A fresh desk: one workspace, one tile running tsh. */
export const fresh = (): Open => ({
	at: "open",
	workspaces: [blank(1)],
	active: "w1",
	prefix: DISARMED,
	ask: null,
	running: {},
	next: 2,
});

const blank = (n: number): Workspace => ({
	id: `w${n}`,
	layout: createTree(createStack(`s${n}`, "horizontal", [createTile(`t${n}`)])),
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

const withWorkspace = (s: Open, ws: Workspace): Open => {
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
	const running = Object.fromEntries(
		Object.entries(s.running).filter(([tile]) => !doomed.includes(tile)),
	);
	const ask = s.ask !== null && doomed.includes(s.ask) ? null : s.ask;
	if (left.length === 0) {
		const at = s.workspaces.findIndex((w) => w.id === ws.id);
		const [first, ...rest] = s.workspaces.filter((w) => w.id !== ws.id);
		if (first === undefined) return {at: "over"};
		const workspaces: Open["workspaces"] = [first, ...rest];
		const active =
			s.active !== ws.id ? s.active : (workspaces[Math.min(at, workspaces.length - 1)] ?? first).id;
		return {...s, workspaces, active, running, ask};
	}
	const layout = doomed.reduce(remove, ws.layout);
	const focused = left.includes(ws.focused) ? ws.focused : heirOf(all, left, ws.focused);
	return {...withWorkspace(s, {...ws, layout, focused}), running, ask};
};

/** Where focus goes when its tile is taken: the next tile left in reading order, else the one before. */
const heirOf = (all: readonly TileId[], left: readonly TileId[], from: TileId): TileId => {
	const at = all.indexOf(from);
	const after = all.slice(at + 1).find((id) => left.includes(id));
	const before = all.slice(0, Math.max(0, at)).findLast((id) => left.includes(id));
	return after ?? before ?? left[0] ?? from;
};

/** Close a tile: a tsh tile with the tiles of its runs, or a run's own tile with its run. */
const closeTile = (s: Open, tile: TileId): Step => {
	const ws = whereIs(s, tile);
	const node = ws === undefined ? null : findTile(ws.layout, tile);
	if (ws === undefined || node === null) return [s, []];
	const shows = node.shows;
	const doomed =
		shows.kind === "tsh"
			? [
					tile,
					...tilesOf(ws)
						.filter((t) => t.shows.kind === "run" && t.shows.of === tile)
						.map((t) => t.id),
				]
			: [tile];
	const own: DeskCmd = shows.kind === "tsh" ? close({tile}) : stop({run: shows.run.id});
	const next = drop(s, ws, doomed);
	return next.at === "over" ? [next, [own, quit({})]] : [next, [own, ...keep(next)]];
};

/** Does closing this tile stop something that runs? Then the desk asks first. */
const stopsSomething = (s: Open, tile: TileNode): boolean =>
	tile.shows.kind === "run" || (s.running[tile.id] ?? 0) > 0 || tile.shows.run !== null;

/** What a key after the prefix does. */
const act = (s: Open, does: Does): Step => {
	const ws = activeOf(s);
	switch (does.kind) {
		case "split": {
			const ids = {tile: `t${s.next}`, stack: `s${s.next}`};
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
		case "zoom": {
			if (tilesOf(ws).length < 2) return [s, []];
			const layout = ws.layout.zoomed === null ? zoom(ws.layout, ws.focused) : unzoom(ws.layout);
			const next = withWorkspace(s, {...ws, layout});
			return [next, keep(next)];
		}
		case "close": {
			const tile = findTile(ws.layout, ws.focused);
			if (tile === null) return [s, []];
			if (stopsSomething(s, tile)) return [{...s, ask: tile.id}, []];
			return closeTile(s, tile.id);
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
	}
};

/** What a key comes to: the desk's (with its step), or the focused tile's, as if the desk were not there. */
export type Routed = {readonly kind: "desk"; readonly step: Step} | {readonly kind: "tile"};

const desk = (step: Step): Routed => ({kind: "desk", step});

/** The byte Ctrl-B and Ctrl-C send a terminal. */
const CTRL_B = "\x02";
const CTRL_C = "\x03";

/** A key with the prefix not armed: Ctrl-B arms it; Ctrl-C over a program goes to its tile's tsh. */
const unarmed = (s: Open, key: string): Routed => {
	if (key === PREFIX) return desk([{...s, prefix: {armed: true, until: null}}, []]);
	const tile = focusedOf(s);
	// The program covers the terminal, so its tsh would never see Ctrl-C: the desk hands it on.
	if (key === "<c-c>" && tile !== null && tile.shows.kind === "tsh" && tile.shows.run !== null)
		return desk([s, [send({tile: tile.id, data: CTRL_C})]]);
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
		if (key === "y") return desk(closeTile({...s, ask: null}, s.ask));
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
		const to = tile !== null && tile.shows.kind === "tsh" && tile.shows.run === null;
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

const covered = (s: Open, tile: TileId, run: Shown): Step => {
	const ws = whereIs(s, tile);
	const node = ws === undefined ? null : findTile(ws.layout, tile);
	if (ws === undefined || node === null || node.shows.kind !== "tsh") return [s, []];
	return [withWorkspace(s, {...ws, layout: setShows(ws.layout, tile, {kind: "tsh", run})}), []];
};

const beside = (s: Open, tile: TileId, run: Shown): Step => {
	const ws = whereIs(s, tile);
	const node = ws === undefined ? null : findTile(ws.layout, tile);
	if (ws === undefined || node === null || node.shows.kind !== "tsh") return [s, []];
	const ids = {tile: `t${s.next}`, stack: `s${s.next}`};
	const shows: Shows = {kind: "run", run, of: tile};
	const layout = split(unzoom(ws.layout), tile, "horizontal", ids, shows);
	if (findTile(layout, ids.tile) === null) return [s, []];
	// Focus stays on the tsh, as tmux's `split-window -d`: the prompt is back, and keys go to it.
	const next = {...withWorkspace(s, {...ws, layout}), next: s.next + 1};
	return [next, keep(next)];
};

const over = (s: Open, run: string): Step => {
	let next: Desk = s;
	for (const {tile} of showing(s, run)) {
		if (next.at !== "open") break;
		const ws = whereIs(next, tile.id);
		if (ws === undefined) continue;
		if (tile.shows.kind === "tsh")
			next = withWorkspace(next, {...ws, layout: setShows(ws.layout, tile.id, TSH)});
		else next = drop(next, ws, [tile.id]);
	}
	if (next === s) return [s, []];
	return next.at === "open" ? [next, keep(next)] : [next, [quit({})]];
};

export const deskMachine = defineMachine({
	types: {model: {} as Desk, msg: {} as DeskMsg},
	cmds: [open, close, stop, send, save, quit],
	init: (loaded) => {
		if (loaded !== null && loaded.at === "open")
			return [
				loaded,
				loaded.workspaces.flatMap((ws) =>
					tilesOf(ws)
						.filter((t) => t.shows.kind === "tsh")
						.map((t) => open({tile: t.id})),
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
			const layout = resize(ws.layout, m.stack, m.sizes);
			if (layout === ws.layout) return [s, []];
			const next = withWorkspace(s, {...ws, layout});
			return [next, keep(next)];
		}),
		covered: onOpen((s, m) => covered(s, m.tile, m.run)),
		beside: onOpen((s, m) => beside(s, m.tile, m.run)),
		over: onOpen((s, m) => over(s, m.run)),
		jobs: onOpen((s, m) =>
			whereIs(s, m.tile) === undefined
				? [s, []]
				: [{...s, running: {...s.running, [m.tile]: Math.max(0, m.running)}}, []],
		),
		ended: onOpen((s, m) => closeTile(s, m.tile)),
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
		quit_ok: noop,
		quit_err: noop,
	},
});

const TILE_ID = /^t([0-9]{1,9})$/;
const decodeSaved = Schema.decodeUnknownOption(Saved);

/**
 * A kept desk, read back for the next start, or `null`: it does not read, or breaks a law of the
 * desk. What ran in it is not running now: a tile of a run goes, a tile covered by a run shows its
 * tsh again, and `attach` brings the run back. The prefix is not armed and nothing is asked.
 */
export const restore = (raw: unknown): Open | null => {
	const read = decodeSaved(raw);
	if (read._tag === "None") return null;
	const saved = read.value;
	const seen = new Set<string>();
	let top = 0;
	const workspaces: Workspace[] = [];
	for (const ws of saved.workspaces) {
		let layout = ws.layout;
		for (const t of [...tiles(layout.root)]) {
			if (t.shows.kind === "run") layout = remove(layout, t.id);
			else if (t.shows.run !== null) layout = setShows(layout, t.id, TSH);
		}
		const left = [...tiles(layout.root)];
		if (left.some((t) => t.shows.kind === "run")) continue;
		if (checkTree(layout).length > 0) return null;
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
		workspaces.push({id: ws.id, layout: zoomed, focused});
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
		running: {},
		next: Math.max(saved.next, top + 1),
	};
};
