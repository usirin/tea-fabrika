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
// No timer anywhere: a closing tile waits for its programs, or for the person to say stop.
//
// It runs in the host process (host/serve.ts), as tmux's server holds its windows and panes: a
// page only draws the desk it is sent, and sends its keys and clicks. What it is told, besides
// keys and clicks, comes from the tiles beside it (tiles.ts): a run with a view is in a tile's
// foreground (`covered`), a run ended (`over`), a tile's running jobs (`jobs`), a tile's tsh
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
	/**
	 * The tile asking y or n, in the active workspace, or none. What it asks follows from the tile
	 * (`questionOf`): "close t2?", or "stop t2 now?" once it is closing.
	 */
	readonly ask: TileId | null;
	/** How many jobs run in each tile's tsh, as its tsh says. A tile not named runs none. */
	readonly running: Readonly<Record<TileId, number>>;
	/** The tiles closing: their programs have been given the end of their inputs, and the tile waits for their end. */
	readonly closing: readonly TileId[];
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
	/** A run with a view is in a tile's foreground, started there or attached: it covers the tile's tsh. */
	| {readonly type: "covered"; readonly tile: TileId; readonly run: Shown}
	/** A run with a view ended. */
	| {readonly type: "over"; readonly run: string}
	/** How many jobs run in a tile's tsh now. */
	| {readonly type: "jobs"; readonly tile: TileId; readonly running: number}
	/** A tile is closing: its programs were given their inputs' end. Said by no one since the desk moved to the host. */
	| {readonly type: "closing"; readonly tile: TileId}
	/** A tile's tsh ended: `exit`, Ctrl-D on an empty line, or its programs ended after a close. */
	| {readonly type: "ended"; readonly tile: TileId};

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
		running: Schema.Record(Schema.String, Schema.Int),
		closing: Schema.Array(TileIdSchema),
		next: Schema.Int,
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

export type DeskCmd =
	| ReturnType<typeof open>
	| ReturnType<typeof close>
	| ReturnType<typeof stop>
	| ReturnType<typeof send>
	| ReturnType<typeof save>
	| ReturnType<typeof empty>;

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
	closing: [],
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
	const closing = s.closing.filter((tile) => !doomed.includes(tile));
	const ask = s.ask !== null && doomed.includes(s.ask) ? null : s.ask;
	if (left.length === 0) {
		const at = s.workspaces.findIndex((w) => w.id === ws.id);
		const [first, ...rest] = s.workspaces.filter((w) => w.id !== ws.id);
		if (first === undefined) return {at: "over"};
		const workspaces: Open["workspaces"] = [first, ...rest];
		const active =
			s.active !== ws.id ? s.active : (workspaces[Math.min(at, workspaces.length - 1)] ?? first).id;
		return {...s, workspaces, active, running, closing, ask};
	}
	const layout = doomed.reduce(remove, ws.layout);
	const focused = left.includes(ws.focused) ? ws.focused : heirOf(all, left, ws.focused);
	return {...withWorkspace(s, {...ws, layout, focused}), running, closing, ask};
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
	(s.running[tile.id] ?? 0) > 0 || tile.shows.run !== null;

/** The question a tile asks, as tmux's confirm-before puts it: close it, or, once it is closing, stop it now. */
export const questionOf = (s: Open, tile: TileId): string =>
	s.closing.includes(tile) ? `stop ${tile} now? (y/n)` : `close ${tile}? (y/n)`;

/**
 * y to the tile's question. A closing tile goes now, stopped. One with nothing running goes at
 * once. One with something running is closing: its programs get the end of their inputs, and it
 * goes when its tsh says it ended.
 */
const yes = (s: Open, tile: TileId): Step => {
	const ws = whereIs(s, tile);
	const node = ws === undefined ? null : findTile(ws.layout, tile);
	if (node === null) return [s, []];
	if (s.closing.includes(tile) || !busy(s, node)) return goneTile(s, tile);
	return [{...s, closing: [...s.closing, tile]}, [close({tile})]];
};

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
	if (key === "<c-c>" && tile !== null && tile.shows.run !== null)
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

const covered = (s: Open, tile: TileId, run: Shown): Step => {
	const ws = whereIs(s, tile);
	const node = ws === undefined ? null : findTile(ws.layout, tile);
	if (ws === undefined || node === null) return [s, []];
	return [withWorkspace(s, {...ws, layout: setShows(ws.layout, tile, {kind: "tsh", run})}), []];
};

/** A run ended: each tile it covered shows its tsh again. */
const over = (s: Open, run: string): Step => {
	let next = s;
	for (const {tile} of showing(s, run)) {
		const ws = whereIs(next, tile.id);
		if (ws !== undefined)
			next = withWorkspace(next, {...ws, layout: setShows(ws.layout, tile.id, TSH)});
	}
	return next === s ? [s, []] : [next, keep(next)];
};

/** A tile the main process says is closing: its question is "stop it now?" from here on. */
const closingNow = (s: Open, tile: TileId): Step =>
	whereIs(s, tile) === undefined || s.closing.includes(tile)
		? [s, []]
		: [{...s, closing: [...s.closing, tile]}, []];

export const deskMachine = defineMachine({
	types: {model: {} as Desk, msg: {} as DeskMsg},
	cmds: [open, close, stop, send, save, empty],
	init: (loaded) => {
		if (loaded !== null && loaded.at === "open")
			return [
				loaded,
				loaded.workspaces.flatMap((ws) => tilesOf(ws).map((t) => open({tile: t.id}))),
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
		over: onOpen((s, m) => over(s, m.run)),
		jobs: onOpen((s, m) =>
			whereIs(s, m.tile) === undefined
				? [s, []]
				: [{...s, running: {...s.running, [m.tile]: Math.max(0, m.running)}}, []],
		),
		closing: onOpen((s, m) => closingNow(s, m.tile)),
		ended: onOpen((s, m) => goneTile(s, m.tile)),
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
	},
});

const TILE_ID = /^t([0-9]{1,9})$/;
const decodeSaved = Schema.decodeUnknownOption(Saved);

/**
 * A kept desk, read back for the next start, or `null`: it does not read, or breaks a law of the
 * desk. The host reads it as it starts. A tile covered by a run shows its tsh again: after the
 * host stopped nothing runs, and `attach` brings the run back. The prefix is not armed, nothing
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
		let layout = ws.layout;
		for (const t of [...tiles(layout.root)])
			if (t.shows.run !== null) layout = setShows(layout, t.id, TSH);
		const left = [...tiles(layout.root)];
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
		closing: [],
		next: Math.max(saved.next, top + 1),
	};
};
