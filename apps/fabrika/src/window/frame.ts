import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {whenOf} from "@tea-fabrika/tracker/window";
import {Option, Schema} from "effect";
import type {Ask, AsksNow} from "../asks.ts";
import {activeOf, focusedOf, type Open, questionOf, tilesOf, type Workspace} from "../desk/desk.ts";
import {bindingOf, type Group, groupOf, type Show} from "../desk/keys.ts";
import type {TileId, TileNode} from "../desk/layout/index.ts";
import type {LinkNow, ToWindow} from "../messages.ts";
import {type Cap, capsOf, type Row, type Section, sentence} from "./pop.ts";

// The window's frame, in words: what the top bar, the bottom line, the asks list and the palette
// say, worked out from what the host sent (the desk, the keys, the programs, the asks) and what
// the app said of the link. Plain data, no React, so each word is tested (frame.test.ts); the
// page draws it (frame.tsx).
//
//   top      1 #7  2 tsh   tracker | ticket | runs                                    2 ask you •
//   bottom   t2 ticket #7 · takes ticket · sends ticket · from tracker → runs        C-b ? keys
//   Ctrl-B   PREFIX · N new · x close · z zoom · f fold · | split · ? keys        esc cancels
//   Ctrl-B x close t2? (y/n)                                                 y closes · n keeps it
//
// The top bar is the whole desk; the bottom line is the tile you are in and the key you just
// pressed (the frame's research, rule 1). Only "asks you" takes the accent, and only a broken part
// takes the warning color, each with its word (rules 2 and 11). A part that works says nothing:
// the host and the ledger show up in the top bar only when something is wrong with them. An
// agent's ask is never on the bottom line: that line is yours.
//
// What the page itself keeps (the list open, the palette, the info mode, the bars hidden) is a
// model and an update with no Cmd, Elm's `Browser.sandbox`: `frameUpdate` below. The desk's own
// state stays the host's.

/** The room macOS's three window buttons take at the top bar's left, in px. */
export const LIGHTS = 84;

/** What each program takes and sends, by its inputs' and outputs' names (host/serve.ts). */
export interface Shape {
	readonly takes: readonly string[];
	readonly sends: readonly string[];
}
export type Shapes = ReadonlyMap<string, Shape>;

/** One binding of the desk's Ctrl-B table, as the host sent it. */
export interface Bound {
	readonly key: string;
	readonly repeats: boolean;
	readonly name: string;
}

/** The ticket a tile's run shows, by the run's id: what the ticket program's view said. */
export type TicketsShown = ReadonlyMap<string, number>;

/** The one field of the ticket program's view the frame reads: the ticket it shows. */
const ShowsTicket = Schema.Struct({number: Schema.NullOr(TicketNumber)});
const readShowsTicket = Schema.decodeUnknownOption(ShowsTicket);

/** The tickets the runs' views show now, by run: only the ticket program's views say one. */
export const ticketsShown = (views: Iterable<readonly [string, ToWindow]>): TicketsShown => {
	const shown = new Map<string, number>();
	for (const [run, view] of views) {
		if (view.program !== "ticket") continue;
		const read = readShowsTicket(view.data);
		if (Option.isSome(read) && read.value.number !== null) shown.set(run, read.value.number);
	}
	return shown;
};

// ---------------------------------------------------------------- the keys, in words

/** A key as the frame writes it: `C-h`, `←`, `Space`, or the character. */
export const keyWord = (key: string): string => {
	const arrows: Record<string, string> = {
		"<arrowleft>": "←",
		"<arrowright>": "→",
		"<arrowup>": "↑",
		"<arrowdown>": "↓",
	};
	const arrow = arrows[key];
	if (arrow !== undefined) return arrow;
	if (key === " ") return "Space";
	const mod = /^<([cam])-(.+)>$/.exec(key);
	if (mod === null) return key;
	return `${mod[1]?.toUpperCase()}-${mod[2]}`;
};

/** A binding's whole key, as pressed: the prefix, then its own key. */
export const bindingWord = (prefix: string, key: string): string =>
	`${keyWord(prefix)} ${keyWord(key)}`;

/** The keys the bottom line shows after Ctrl-B: the ones used most, then `?` for all of them. */
const SHOWN_AFTER_PREFIX = ["N", "x", "z", "f", "|", "?"];

/** The bottom line while Ctrl-B is down: each of the keys used most and its name. */
export const prefixLine = (table: readonly Bound[]): readonly {key: string; name: string}[] =>
	SHOWN_AFTER_PREFIX.flatMap((key) => {
		const bound = table.find((b) => b.key === key);
		return bound === undefined ? [] : [{key: keyWord(key), name: bound.name}];
	});

/** The palette's groups, in the order it shows them (desk/keys.ts, `groupOf`). */
const GROUPS: readonly Group[] = ["tile", "focus", "workspace", "window"];

/** One command of the palette: its name, its group, its key, and the binding it runs. */
export interface Command {
	readonly name: string;
	readonly group: Group;
	/** As the bottom line writes it, after the palette ran it: `C-b z`. */
	readonly key: string;
	/** As keycaps, in the palette: `⌃B` `Z`. */
	readonly caps: readonly Cap[];
	/** The binding's key: the palette runs it as Ctrl-B and this key would. */
	readonly runs: string;
}

/**
 * Every command there is, once each, by the desk's own table, grouped: a name bound to two keys
 * (h and the left arrow) is listed by its first. A workspace that is not there is not listed. A
 * key this page's table does not know (a newer host's) goes with the window's own.
 */
export const commandsOf = (
	prefix: string,
	table: readonly Bound[],
	workspaces: number,
): readonly Command[] => {
	const seen = new Set<string>();
	const all = table.flatMap((b) => {
		const at = /^workspace (\d+)$/.exec(b.name);
		if (at !== null && Number(at[1]) > workspaces) return [];
		if (seen.has(b.name)) return [];
		seen.add(b.name);
		const does = bindingOf(b.key)?.does;
		return [
			{
				name: b.name,
				group: does === undefined ? "window" : groupOf(does),
				key: bindingWord(prefix, b.key),
				caps: capsOf(prefix, b.key),
				runs: b.key,
			},
		];
	});
	return GROUPS.flatMap((g) => all.filter((c) => c.group === g));
};

/** The commands whose name holds every word typed, in the table's order. */
export const matching = (commands: readonly Command[], query: string): readonly Command[] => {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return commands.filter((c) => {
		const text = c.name.toLowerCase();
		return words.every((w) => text.includes(w));
	});
};

// ---------------------------------------------------------------- the top bar

/** The ticket a tile shows, when its run is the ticket program's and the view named one. */
const ticketOn = (tile: TileNode, tickets: TicketsShown): number | undefined =>
	tile.shows.run === null ? undefined : tickets.get(tile.shows.run.id);

/** A tile's program, as the frame names it: `ticket #7`, `tracker`, or `tsh`. */
export const tileWord = (tile: TileNode, tickets: TicketsShown): string => {
	const run = tile.shows.run;
	if (run === null) return "tsh";
	const n = ticketOn(tile, tickets);
	return n === undefined ? run.program : `${run.program} #${n}`;
};

/**
 * A workspace's name, from what it holds: the ticket it shows, `#7`; else the program its line
 * starts with; else `tsh`. No name is made up: the desk has no names of its own yet.
 */
export const workspaceName = (ws: Workspace, tickets: TicketsShown): string => {
	const all = tilesOf(ws);
	for (const tile of all) {
		const n = ticketOn(tile, tickets);
		if (n !== undefined) return `#${n}`;
	}
	const head = all.find((t) => t.shows.kind === "line") ?? all.find((t) => t.shows.run !== null);
	return head?.shows.run?.program ?? "tsh";
};

/** One program of a line, with the tile it is shown in. */
export interface Segment {
	readonly program: string;
	readonly tile: TileId;
	readonly focused: boolean;
}

/**
 * The line of the workspace, in its order: the focused tile's line, or the first one in reading
 * order. Empty when the workspace has no line.
 */
export const lineIn = (ws: Workspace): readonly Segment[] => {
	const all = tilesOf(ws);
	const focused = all.find((t) => t.id === ws.focused);
	const shown = (t: TileNode) => (t.shows.kind === "tsh" ? null : t.shows.line.id);
	const id =
		(focused === undefined ? null : shown(focused)) ?? all.map(shown).find((l) => l !== null);
	if (id === undefined || id === null) return [];
	return all.flatMap((t) =>
		shown(t) === id && t.shows.run !== null
			? [{program: t.shows.run.program, tile: t.id, focused: t.id === ws.focused}]
			: [],
	);
};

/** How the count of asks reads: `nothing asks you`, `1 asks you`, `3 ask you`. */
export const asksWord = (n: number): string =>
	n === 0 ? "nothing asks you" : `${n} ask${n === 1 ? "s" : ""} you`;

/** A part of the frame that says how a part of the app is, and whether that part is broken. */
export interface Said {
	readonly word: string;
	readonly broken: boolean;
}

/**
 * The ledger's item: shown only when the last read failed, so the count may be old. A ledger
 * that answers says nothing.
 */
export const ledgerWord = (now: AsksNow): Said | null =>
	now.reach === "failed" ? {word: "ledger unreachable", broken: true} : null;

/**
 * The host's item, one branch per kind of link: a kind left out does not compile. A host that is
 * up says nothing; every other kind has a word, and its lines say what to do.
 */
export const hostWord = (link: LinkNow, attachedOnce: boolean): Said | null => {
	switch (link.kind) {
		case "up":
			return null;
		case "build":
			return {word: "host older", broken: false};
		case "version":
			return {word: "host speaks another version", broken: true};
		case "reconnecting":
			return attachedOnce ? {word: "host down", broken: true} : {word: "connecting", broken: false};
		case "stopped":
			return {word: "host down", broken: true};
		case "restarting":
			return {word: "host restarting", broken: false};
	}
};

// ---------------------------------------------------------------- the bottom line

/** The tile a ticket is shown in, if any: an ask names it, and picking the ask focuses it. */
export const tileOfTicket = (
	desk: Open,
	ticket: number,
	tickets: TicketsShown,
): TileId | undefined =>
	desk.workspaces
		.flatMap((ws) => tilesOf(ws))
		.find((t) => t.shows.run !== null && tickets.get(t.shows.run.id) === ticket)?.id;

/** The tracker on the desk, to turn to a ticket no tile shows: the active workspace's first, else any. */
const trackerOn = (desk: Open): TileNode | undefined => {
	const isTracker = (t: TileNode) => t.shows.run?.program === "tracker";
	return (
		tilesOf(activeOf(desk)).find(isTracker) ??
		desk.workspaces.flatMap((ws) => tilesOf(ws)).find(isTracker)
	);
};

/**
 * Where Enter on an ask goes: the tile that shows its ticket; else the tracker, turned to that
 * ticket's page (its window's own `query`), which the line then carries on; else nowhere, and the
 * bottom line says so. Never a dead key.
 */
export type Opens =
	| {readonly kind: "tile"; readonly tile: TileId}
	| {readonly kind: "tracker"; readonly tile: TileId; readonly run: string}
	| {readonly kind: "none"};

export const opensOf = (desk: Open | null, ticket: number, tickets: TicketsShown): Opens => {
	if (desk === null) return {kind: "none"};
	const tile = tileOfTicket(desk, ticket, tickets);
	if (tile !== undefined) return {kind: "tile", tile};
	const tracker = trackerOn(desk);
	const run = tracker?.shows.run;
	return tracker === undefined || run == null
		? {kind: "none"}
		: {kind: "tracker", tile: tracker.id, run: run.id};
};

/** What the bottom line says when Enter on an ask has nowhere to go. */
export const nowhereNote = (ticket: number): string =>
	`no tile shows #${ticket} · the tracker opens it`;

/**
 * One ask as a row: what it asks, in sentence case; its ticket, title and tile under it; its time
 * at the right. `Approve plan` over `#1 Login fails on Safari · t2`, at `11:13`.
 */
const askRowOf = (ask: Ask, tile: TileId | undefined, now: number, later: boolean): Row => ({
	id: ask.key,
	icon: later ? "later" : ask.kind,
	title: sentence(ask.kind === "stuck" ? `stuck: ${ask.what}` : ask.what),
	sub: `#${ask.ticket} ${ask.title}${tile === undefined ? "" : ` · ${tile}`}`,
	side: whenOf(ask.at, now),
	second: later ? {name: "Bring back", cap: "H"} : {name: "Later", cap: "H"},
});

/** The asks list's sections: the live asks, then the ones set aside, under `Later`, which folds. */
export const asksSections = (
	asks: AsksNow,
	desk: Open | null,
	tickets: TicketsShown,
	now: number,
): readonly Section[] => {
	const tileOf = (ticket: number) =>
		desk === null ? undefined : tileOfTicket(desk, ticket, tickets);
	return [
		{
			id: "asks",
			title: null,
			fold: false,
			rows: asks.asks.map((a) => askRowOf(a, tileOf(a.ticket), now, false)),
		},
		...(asks.later.length === 0
			? []
			: [
					{
						id: "later",
						title: "Later",
						fold: true,
						rows: asks.later.map((a) => askRowOf(a, tileOf(a.ticket), now, true)),
					},
				]),
	];
};

/**
 * The focused tile, said at the bottom left: its name, what it takes and sends, and its
 * neighbors in its line. `t2 ticket #7 · takes ticket · sends ticket · from tracker → runs`.
 */
export const hereWord = (desk: Open, shapes: Shapes, tickets: TicketsShown): string => {
	const tile = focusedOf(desk);
	if (tile === null) return "";
	const ws = activeOf(desk);
	const parts = [`${tile.id} ${tileWord(tile, tickets)}`];
	const program = tile.shows.run?.program;
	const shape = program === undefined ? undefined : shapes.get(program);
	if (shape !== undefined) {
		parts.push(`takes ${shape.takes.join(", ") || "nothing"}`);
		parts.push(`sends ${shape.sends.join(", ") || "nothing"}`);
	}
	const line = lineIn(ws);
	const at = line.findIndex((s) => s.tile === tile.id);
	if (at !== -1) {
		const [before, after] = [line[at - 1]?.program, line[at + 1]?.program];
		const near = [
			before === undefined ? "" : `from ${before}`,
			after === undefined ? "" : `→ ${after}`,
		];
		const said = near.filter(Boolean).join(" ");
		if (said !== "") parts.push(said);
	}
	const running = desk.running[tile.id] ?? 0;
	if (running > 0) parts.push(`${running} running`);
	if (ws.layout.zoomed === tile.id) parts.push("zoomed");
	return parts.join(" · ");
};

/** The question you asked with a key, said where you look: the bottom line. */
export const questionWord = (desk: Open): string | null =>
	desk.ask === null ? null : questionOf(desk, desk.ask);

/** What info mode says of each part of the frame, in plain words. */
export const INFO = {
	workspace: "a workspace, named by what it holds. C-b 1 to 9 goes to one, C-b N makes one.",
	segment: "a program in this workspace's line, shown in the tile named. A click focuses it.",
	pipe: "a pipe: what the program before it sends goes into the one after it.",
	asks: "asks: what agents ask you, and runs that are stuck. One count, the same as the Dock badge. A dot is one you have not seen. A click opens the list.",
	ledger:
		"ledger: where the asks are read from. Unreachable, the count is the last one read. A click says why.",
	host: "host: the process that runs every tile and job. Down, nothing new runs, and the tiles keep their last state. A click says what to do.",
	again:
		"try again: the app stopped reaching for the host after five minutes. A click starts it reaching again.",
	drag: "an empty stretch to move the window by. A double-click zooms the window, as macOS does.",
	here: "the tile you are in: what it takes in, what it sends out, and its neighbors in its line.",
	keys: "keys: press Ctrl-B, then one key. C-b ? lists them all. Cmd-K finds any command by name.",
	info: "info: explains whatever the pointer is over, here. C-b i turns it off.",
	titlebar:
		"title bar: a click focuses the tile, a double-click folds it into a strip. C-b f folds too.",
	strip: "a folded tile: a click opens it again.",
} as const;

// ---------------------------------------------------------------- the page's own frame state

/**
 * What lies over the desk: the asks list, the palette, or one item's few lines. One value, so
 * two can never be open at once (Apple's HIG: one popover at a time).
 */
export type Over =
	| {readonly kind: "none"}
	| {readonly kind: "asks"}
	| {
			readonly kind: "palette";
			readonly title: "commands" | "keys";
			readonly query: string;
			readonly at: number;
	  }
	| {readonly kind: "item"; readonly what: Part};

/** A part of the app the top bar names only when something is wrong with it. */
export type Part = "ledger" | "host";

export interface Frame {
	readonly over: Over;
	/** Info mode: the bottom line explains whatever the pointer is over. */
	readonly info: boolean;
	/** What info mode says now, or `null`: nothing under the pointer has words. */
	readonly explained: string | null;
	/** Both bars hidden; a thin band stays for the window's buttons. */
	readonly bare: boolean;
	/** A short note at the bottom right, as after the palette ran a command: `next time: C-b z`. */
	readonly note: string | null;
}

export const FRAME: Frame = {
	over: {kind: "none"},
	info: false,
	explained: null,
	bare: false,
	note: null,
};

export type FrameMsg =
	/** A key after Ctrl-B asked the frame to show something (desk.ts, `show`). */
	| {readonly type: "show"; readonly what: Show}
	| {readonly type: "palette"}
	| {readonly type: "item"; readonly what: Part}
	| {readonly type: "query"; readonly query: string}
	| {readonly type: "move"; readonly by: number; readonly of: number}
	| {readonly type: "ran"; readonly key: string}
	/** What lies over the desk closes, and the bottom line says why nothing happened. */
	| {readonly type: "say"; readonly note: string}
	| {readonly type: "explain"; readonly text: string | null}
	| {readonly type: "unnote"}
	| {readonly type: "close"};

/** A thing over the desk opens, or closes when it is open already, as a menu does. */
const toggle = (f: Frame, over: Over): Frame =>
	f.over.kind === over.kind ? {...f, over: {kind: "none"}} : {...f, over};

/** What a key after Ctrl-B shows: the asks list, every key, the info mode, or no bars. */
const shown = (f: Frame, what: Show): Frame => {
	switch (what) {
		case "asks":
			return toggle(f, {kind: "asks"});
		case "keys":
			return {...f, over: {kind: "palette", title: "keys", query: "", at: 0}};
		case "info":
			return {...f, info: !f.info, explained: null};
		case "bars":
			return {...f, bare: !f.bare, over: {kind: "none"}};
	}
};

/**
 * Who a key goes to while something lies over the desk: the over, or the desk as always. The
 * palette is a modal dialog, so it takes every key. A menu or an item's lines take every key but
 * Ctrl-B and the key after it, so `C-b a` still closes the asks list. A key the desk's own
 * question waits on (`close t2? (y/n)`) goes to the desk. A key that goes to the over never
 * reaches a tile: not its terminal, not its view.
 */
export const keyGoesTo = (
	over: Over,
	key: string,
	prefix: string,
	desk: {readonly armed: boolean; readonly asking: boolean},
): "over" | "desk" => {
	if (over.kind === "none") return "desk";
	if (over.kind === "palette") return "over";
	return key === prefix || desk.armed || desk.asking ? "desk" : "over";
};

export const frameUpdate = (f: Frame, m: FrameMsg): Frame => {
	switch (m.type) {
		case "show":
			return shown(f, m.what);
		case "palette":
			return toggle(f, {kind: "palette", title: "commands", query: "", at: 0});
		case "item":
			return f.over.kind === "item" && f.over.what === m.what
				? {...f, over: {kind: "none"}}
				: {...f, over: {kind: "item", what: m.what}};
		case "query":
			return f.over.kind === "palette" ? {...f, over: {...f.over, query: m.query, at: 0}} : f;
		case "move": {
			if (f.over.kind !== "palette" || m.of === 0) return f;
			const at = (f.over.at + m.by + m.of) % m.of;
			return {...f, over: {...f.over, at}};
		}
		case "ran":
			return {...f, over: {kind: "none"}, note: `next time: ${m.key}`};
		case "say":
			return {...f, over: {kind: "none"}, note: m.note};
		case "explain":
			return f.info && f.explained !== m.text ? {...f, explained: m.text} : f;
		case "unnote":
			return {...f, note: null};
		case "close":
			return {...f, over: {kind: "none"}};
	}
};
