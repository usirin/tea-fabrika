import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {whenOf} from "@tea-fabrika/tracker/window";
import {Option, Schema} from "effect";
import type {Ask, AsksNow} from "../asks.ts";
import {activeOf, focusedOf, type Open, questionOf, tilesOf, type Workspace} from "../desk/desk.ts";
import {bindingOf, type Group, groupOf, type Show} from "../desk/keys.ts";
import type {TileId, TileNode} from "../desk/layout/index.ts";
import type {HostNow, LedgerLink, LinkNow, ToWindow} from "../messages.ts";
import type {JobEnded, TileJobs} from "../tile-jobs.ts";
import {type Cap, capsOf, type Icon, type Piece, type Row, type Section, sentence} from "./pop.ts";

// The window's frame, in words: what the top bar, the bottom line, the asks list and the palette
// say, worked out from what the host sent (the desk, the keys, the programs, the asks) and what
// the app said of the link. Plain data, no React, so each word is tested (frame.test.ts); the
// page draws it (frame.tsx).
//
//   top      1 #7  2 tsh   tracker | ticket | runs                    2 ask you • · 1 agent · ✓
//   at rest  1 #7  2 tsh   tracker | ticket | runs                                          ✓
//   bottom   t2 ticket #7 · takes ticket · sends ticket · from tracker → runs        C-b ? keys
//   a job    t1 tsh · %3 seq --to 9 | tally 2m +1                                  C-b ? keys
//   Ctrl-B   PREFIX · N new · x close · z zoom · f fold · | split · ? keys        esc cancels
//   Ctrl-B x close t2? (y/n)                                                 y closes · n keeps it
//
// The top bar is the whole desk; the bottom line is the tile you are in and the key you just
// pressed (the frame's research, rule 1). Its job item names the job the tile runs, by the host's
// table: `%3`, its line, how long it has run, and `+1` for each other job there. A job that just
// ended says so for a short while (`done in 4s`), then the item clears; with nothing running it
// says nothing. A click, or C-b J, lists the jobs: there is no trace to open for a job yet (the
// app's `trace` reads records held in memory), so it does what tsh's `jobs` does. Only "asks you"
// takes the accent, and only a broken part takes the warning color, each with its word (rules 2
// and 11). A part that works says nothing: no asks, no agents attached and a ledger in sync draw
// no item at all, each a word only while it matters (`2 ask you`, `1 agent`, `syncing`, `ledger
// unreachable`). The one exception is the host's quiet icon while it is up: the host runs on your
// laptop, and its icon is where C-b H and a click land. Each opens a few lines under the bar's
// right end (C-b a, C-b A, C-b S, C-b H, or the tsh words `asks`, `agents`, `sync`, `host`), with
// or without its word. An agent's ask is never on the bottom line: that line is yours.
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

/** One binding of the desk's Ctrl-B table, as the host sent it, with the tsh word that does the same. */
export interface Bound {
	readonly key: string;
	readonly repeats: boolean;
	readonly name: string;
	readonly tsh: string;
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

/** One command of the palette: its name, its group, its key, its tsh word, and the binding it runs. */
export interface Command {
	readonly name: string;
	readonly group: Group;
	/** As the bottom line writes it, after the palette ran it: `C-b z`. */
	readonly key: string;
	/** As keycaps, in the palette: `⌃B` `Z`. */
	readonly caps: readonly Cap[];
	/** What to type in a tile's tsh for the same: `zoom`, `split --to down`. */
	readonly tsh: string;
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
				tsh: b.tsh,
				runs: b.key,
			},
		];
	});
	return GROUPS.flatMap((g) => all.filter((c) => c.group === g));
};

/** The commands whose name or tsh word holds every word typed, in the table's order. */
export const matching = (commands: readonly Command[], query: string): readonly Command[] => {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return commands.filter((c) => {
		const text = `${c.name} ${c.tsh}`.toLowerCase();
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

/**
 * The asks' item: `1 asks you`, `3 ask you`, or `null` when nothing asks you, as the Dock badge
 * shows no `0`. Nothing to answer is not news; C-b a still opens the empty list.
 */
export const asksWord = (n: number): string | null =>
	n === 0 ? null : `${n} ask${n === 1 ? "s" : ""} you`;

/** A part of the frame that says how a part of the app is, and whether that part is broken. */
export interface Said {
	readonly word: string;
	readonly broken: boolean;
}

/**
 * The agents' item: how many agents are attached to the host's agents' socket now, or `null`
 * when none is. Those are the agents at work on this desk: each drives the app's programs as tools
 * (host/agents.ts). No agent attached is not news, on a home where one could attach or on one
 * with no agents' socket (a home on a ledger server); C-b A still opens lines that say which.
 */
export const agentsWord = (host: HostNow): string | null => {
	const n = host.agents?.length ?? 0;
	return n === 0 ? null : `${n} agent${n === 1 ? "" : "s"}`;
};

/**
 * The sync item, or `null` while the ledger is in sync. A ledger server's says `syncing` until
 * the first read is in, then nothing: every write goes straight to the server, so none waits
 * here. The home's own file has nothing to sync and says nothing. Either one that failed its last
 * read says `ledger unreachable`, in red. C-b S opens its lines either way.
 */
export const syncWord = (now: AsksNow, ledger: LedgerLink): Said | null => {
	if (now.reach === "failed") return {word: "ledger unreachable", broken: true};
	if (ledger.kind === "own" || now.reach === "ok") return null;
	return {word: "syncing", broken: false};
};

/**
 * The shapes the host's item wears when something is wrong, each its own shape, never color
 * alone: waiting (a dashed ring), needs a look (`!`), down (`x`). None is the up state's ring and
 * check, so a host that is not up never looks up.
 */
export type HostShape = Extract<Icon, "later" | "stuck" | "failed">;

/**
 * The host's item. Up, it is a quiet icon and no word: a host that works is not news. Else it is
 * a word, with a shape that says the kind of wrong, red only where it is broken. There is no value
 * for an up host with a word, or a word with the up icon.
 */
export type HostItem =
	| {readonly kind: "up"}
	| {
			readonly kind: "word";
			readonly word: string;
			readonly broken: boolean;
			readonly shape: HostShape;
	  };

/** A host that is not up, said in a word with its shape. */
const wrong = (word: string, broken: boolean, shape: HostShape): HostItem => ({
	kind: "word",
	word,
	broken,
	shape,
});

/**
 * The host's item, one branch per kind of link: a kind left out does not compile. Only a host
 * down or one that speaks another version is broken. Its lines say what to do.
 */
export const hostWord = (link: LinkNow, attachedOnce: boolean): HostItem => {
	switch (link.kind) {
		case "up":
			return {kind: "up"};
		case "build":
			return wrong("host older", false, "stuck");
		case "version":
			return wrong("host speaks another version", true, "stuck");
		case "reconnecting":
			return attachedOnce
				? wrong("host down", true, "failed")
				: wrong("connecting", false, "later");
		case "stopped":
			return wrong("host down", true, "failed");
		case "restarting":
			return wrong("host restarting", false, "later");
	}
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A time on the local clock: `14:02` on the day of `now`, `Oct 29, 14:02` before it. */
export const clockWord = (at: number, now: number): string => {
	const t = new Date(at);
	const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
	return t.toDateString() === new Date(now).toDateString()
		? hm
		: `${MONTHS[t.getMonth()]} ${t.getDate()}, ${hm}`;
};

/** What the host holds now, from the desk it sent: `3 tiles · 1 job running`. */
export const holdsWord = (desk: Open): string => {
	const tiles = desk.workspaces.reduce((n, ws) => n + tilesOf(ws).length, 0);
	const running = Object.values(desk.jobs).reduce((n, j) => n + j.running.length, 0);
	return `${tiles} tile${tiles === 1 ? "" : "s"} · ${running} job${running === 1 ? "" : "s"} running`;
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
	if (ws.layout.zoomed === tile.id) parts.push("zoomed");
	return parts.join(" · ");
};

// ---------------------------------------------------------------- the job item

/**
 * How long, said calmly: `14s` under a minute, `2m` under an hour, then `1h 5m`. Seconds only
 * while they are most of it, so the line ticks each second for the first minute, then once a
 * minute: Ghostty writes durations as `1h30m` and `45s`, and tmux shows none at all, so nothing
 * ticks seconds on a job that has run for an hour.
 */
export const tookWord = (ms: number): string => {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
};

/** How long an ended job stays on the bottom line, in ms: a short while, then it clears. */
export const ENDED_SHOWN_MS = 5000;

/**
 * A job in the foreground that ran less than this, in ms, ended under the person's eyes: tsh
 * printed how in the tile, so the bottom line says nothing of it. Ghostty's and kitty's "command
 * finished" notices wait for the same 5 seconds.
 */
export const QUICK_MS = 5000;

/**
 * How a job's end reads: `done in 14s`, `failed after 2m`, `stopped after 1h 5m`, and
 * `failed at once` for one that ended within its first second, where `after 0s` reads oddly.
 */
export const endWord = (ended: JobEnded): string => {
	const ms = ended.at - ended.since;
	if (ms < 1000) return `${ended.how} at once`;
	const took = tookWord(ms);
	return ended.how === "done" ? `done in ${took}` : `${ended.how} after ${took}`;
};

/**
 * How long ago something ended, in the same calm form as `tookWord`: `14s ago`, `2m ago`. Under
 * a second it is `just now`, where `0s ago` reads oddly.
 */
export const agoWord = (ms: number): string => (ms < 1000 ? "just now" : `${tookWord(ms)} ago`);

/** Is this end still news at `now`: said a short while after, and only when it was not seen happen. */
const fresh = (ended: JobEnded | null, now: number): ended is JobEnded =>
	ended !== null &&
	now - ended.at < ENDED_SHOWN_MS &&
	(!ended.foreground || ended.at - ended.since >= QUICK_MS);

/** The job the bottom line names: its `%n` and line, how long or how it ended, and how many more run. */
export interface JobItem {
	readonly n: number;
	readonly text: string;
	/** `2m` while it runs; `done in 2m` once it ended. */
	readonly said: string;
	readonly ended: boolean;
	/** The tile's other jobs that run: `+2`. */
	readonly more: number;
}

/**
 * The focused tile's job item at `now`: a job that just ended, for a short while; else the job tsh
 * waits for, as tmux's status line names a pane's foreground command; else the newest, as bash's
 * current job `%+`. `null` when nothing runs and nothing just ended: the line says nothing.
 */
export const jobItem = (jobs: TileJobs | undefined, now: number): JobItem | null => {
	if (jobs === undefined) return null;
	const {running, ended} = jobs;
	if (fresh(ended, now))
		return {n: ended.n, text: ended.text, said: endWord(ended), ended: true, more: running.length};
	const shown = running.findLast((j) => j.foreground) ?? running.at(-1);
	if (shown === undefined) return null;
	return {
		n: shown.n,
		text: shown.text,
		said: tookWord(now - shown.since),
		ended: false,
		more: running.length - 1,
	};
};

/** A job's `%n` and its tile, as a row's muted line says them: `%3 · t2`, the `%3` typed. */
const whereOf = (n: number, tile: TileId, more = ""): readonly Piece[] => [
	{text: `%${n}`, typed: true},
	{text: ` · ${tile}${more}`, typed: false},
];

/** A running job as a row: its line as typed, `%n` and its tile under it, how long at the right. */
const runningRow = (tile: TileId, job: TileJobs["running"][number], now: number): Row => ({
	id: `${tile}/%${job.n}`,
	icon: "running",
	title: [{text: job.text, typed: true}],
	sub: whereOf(job.n, tile),
	side: tookWord(now - job.since),
	second: null,
});

/** The jobs list: its sections, the tile each row's Enter focuses, and the count at its head. */
export interface JobsList {
	readonly sections: readonly Section[];
	readonly tiles: ReadonlyMap<string, TileId>;
	/**
	 * The running jobs the list shows, on the whole desk: `Jobs 3`. `null` when none runs, so the
	 * head says only `Jobs` over its calm line, never `Jobs 0`.
	 */
	readonly count: number | null;
}

/**
 * The jobs list, as tsh's `jobs` lists the host's table: the focused tile's jobs, the one the
 * bottom line names first; then its last to end, however long ago, so the list still says it once
 * the bottom line has cleared; then each other tile's, by tile. Enter on a row focuses its tile.
 * The right side is always time from now: how long a job has run, or how long ago it ended.
 *
 *   Jobs 3
 *   ◐ sleep --ms 9000                 2m
 *     %5 · t2
 *   Last ended
 *   ✓ seq --to 9 | tally          1m ago
 *     %3 · t2 · done in 1m
 *   Other tiles
 *   ◐ counter                         2m
 *     %1 · t1
 *
 * A section with no rows is left out, this tile's own too: when only other tiles run something,
 * the list opens on `Other tiles`, which already says this one runs nothing. With no row at all,
 * the menu shows its calm line instead.
 */
export const jobsList = (desk: Open, now: number): JobsList => {
	const here = focusedOf(desk)?.id;
	const tiles = new Map<string, TileId>();
	const at = (tile: TileId, row: Row): Row => {
		tiles.set(row.id, tile);
		return row;
	};
	const mine = here === undefined ? undefined : desk.jobs[here];
	const hereRows: Row[] = [];
	const endedRows: Row[] = [];
	if (here !== undefined && mine !== undefined) {
		const first = jobItem({running: mine.running, ended: null}, now)?.n;
		const lead = mine.running.filter((j) => j.n === first);
		for (const j of [...lead, ...mine.running.filter((j) => j.n !== first)])
			hereRows.push(at(here, runningRow(here, j, now)));
		const {ended} = mine;
		if (ended !== null)
			endedRows.push(
				at(here, {
					id: `${here}/ended`,
					icon: ended.how,
					title: [{text: ended.text, typed: true}],
					sub: whereOf(ended.n, here, ` · ${endWord(ended)}`),
					side: agoWord(now - ended.at),
					second: null,
				}),
			);
	}
	const otherRows = Object.keys(desk.jobs)
		.filter((tile) => tile !== here)
		.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
		.flatMap((tile) =>
			(desk.jobs[tile]?.running ?? []).map((j) => at(tile, runningRow(tile, j, now))),
		);
	const sections: readonly Section[] = [
		{id: "here", title: null, fold: false, rows: hereRows},
		{id: "ended", title: "Last ended", fold: false, rows: endedRows},
		{id: "others", title: "Other tiles", fold: false, rows: otherRows},
	];
	const running = hereRows.length + otherRows.length;
	return {
		sections: sections.filter((s) => s.rows.length > 0),
		tiles,
		count: running === 0 ? null : running,
	};
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
	agents:
		"agents: the agents attached to this host now, each driving the app's programs as tools. A click names them.",
	sync: "sync: the ledger server this home reads, and whether it answers. Unreachable, the asks count is the last one read. A click says more.",
	host: "host: the process that runs every tile and job. Down, nothing new runs, and the tiles keep their last state. A click says more, and what to do.",
	again:
		"try again: the app stopped reaching for the host after five minutes. A click starts it reaching again.",
	drag: "an empty stretch to move the window by. A double-click zooms the window, as macOS does.",
	here: "the tile you are in: what it takes in, what it sends out, and its neighbors in its line.",
	job: "a job in this tile: its number, its line, and how long it has run. +2 is two more. A job that ended says how, for a few seconds. A click lists them, as tsh's jobs does.",
	keys: "keys: press Ctrl-B, then one key. C-b ? lists them all. Cmd-K finds any command by name.",
	info: "info: explains whatever the pointer is over, here. C-b i turns it off.",
	titlebar:
		"title bar: a click focuses the tile, a double-click folds it into a strip. C-b f folds too.",
	strip: "a folded tile: a click opens it again.",
} as const;

// ---------------------------------------------------------------- the page's own frame state

/**
 * What lies over the desk: the asks list, the jobs list, the palette, or one item's few lines.
 * One value, so two can never be open at once (Apple's HIG: one popover at a time).
 */
export type Over =
	| {readonly kind: "none"}
	| {readonly kind: "asks"}
	| {readonly kind: "jobs"}
	| {
			readonly kind: "palette";
			readonly title: "commands" | "keys";
			readonly query: string;
			readonly at: number;
	  }
	| {readonly kind: "item"; readonly what: Part};

/** A part of the app the top bar names, whose few lines open under it: a click, its key or its tsh word. */
export type Part = "agents" | "sync" | "host";

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

/** An item's lines open, or close when they are open already. */
const itemLines = (f: Frame, what: Part): Frame =>
	f.over.kind === "item" && f.over.what === what
		? {...f, over: {kind: "none"}}
		: {...f, over: {kind: "item", what}};

/**
 * What a key after Ctrl-B shows: the asks list, the jobs list, every key, the info mode, no bars,
 * or an item's lines.
 */
const shown = (f: Frame, what: Show): Frame => {
	switch (what) {
		case "agents":
		case "sync":
		case "host":
			return itemLines(f, what);
		case "asks":
			return toggle(f, {kind: "asks"});
		case "jobs":
			return toggle(f, {kind: "jobs"});
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
			return itemLines(f, m.what);
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
