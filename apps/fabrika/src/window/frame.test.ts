import {applyCell} from "@demlik/tea";
import {whenOf} from "@tea-fabrika/tracker/window";
import {describe, expect, it} from "vitest";
import type {Ask, AsksNow} from "../asks.ts";
import {
	activeOf,
	type Desk,
	type DeskCmd,
	type DeskMsg,
	deskMachine,
	type Open,
} from "../desk/desk.ts";
import {BINDINGS, PREFIX} from "../desk/keys.ts";
import type {JobEnded} from "../tile-jobs.ts";
import {
	asksSections,
	asksWord,
	commandsOf,
	ENDED_SHOWN_MS,
	FRAME,
	type Frame,
	frameUpdate,
	hereWord,
	hostWord,
	jobItem,
	jobsList,
	keyGoesTo,
	keyWord,
	ledgerWord,
	lineIn,
	matching,
	nowhereNote,
	opensOf,
	prefixLine,
	questionWord,
	ticketsShown,
	tileOfTicket,
	tookWord,
	workspaceName,
} from "./frame.ts";

// The frame's words, from a real desk folded by the real machine, and the host's real table.

const fold = (msgs: readonly DeskMsg[]): Open => {
	let s: Desk = deskMachine.init(null, undefined)[0];
	for (const m of msgs) s = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, s, m)[0];
	if (s.at !== "open") throw new Error("the desk is over");
	return s;
};
const TABLE = BINDINGS.map((b) => ({key: b.key, repeats: b.repeats, name: b.name}));
const SHAPES = new Map([
	["tracker", {takes: [], sends: ["ticket"]}],
	["ticket", {takes: ["ticket"], sends: ["ticket"]}],
	["runs", {takes: ["ticket"], sends: ["run"]}],
]);
/** `tracker | ticket | runs` typed in t1, its windows in t2 and t3, t2 focused, showing #7. */
const lined = fold([
	{
		type: "covered",
		tile: "t1",
		runs: [
			{id: "tracker:1", program: "tracker"},
			{id: "ticket:1", program: "ticket"},
			{id: "runs:1", program: "runs"},
		],
	},
	{type: "click", tile: "t2"},
]);
const SHOWN = new Map([["ticket:1", 7]]);

const now = (over: Partial<AsksNow> = {}): AsksNow => ({
	asks: [],
	later: [],
	reach: "ok",
	why: null,
	...over,
});
const ask = (over: Partial<Ask> = {}): Ask => ({
	key: "7/a-1",
	ticket: 7,
	title: "Login fails",
	what: "approve plan",
	kind: "ask",
	at: 0,
	seen: false,
	...over,
});

describe("the frame's keys", () => {
	it("writes keys as a person reads them", () => {
		expect(keyWord("<c-b>")).toBe("C-b");
		expect(keyWord("<c-h>")).toBe("C-h");
		expect(keyWord("<arrowleft>")).toBe("←");
		expect(keyWord(" ")).toBe("Space");
		expect(keyWord("|")).toBe("|");
	});

	it("lists every command once, by the desk's own table, and only the workspaces there are", () => {
		const commands = commandsOf(PREFIX, TABLE, 2);
		const names = commands.map((c) => c.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain("zoom");
		expect(names).toContain("workspace 2");
		expect(names).not.toContain("workspace 3");
		expect(commands.find((c) => c.name === "focus left")?.key).toBe("C-b h");
		expect(commands.find((c) => c.name === "zoom")).toEqual({
			name: "zoom",
			group: "tile",
			key: "C-b z",
			caps: ["⌃B", "Z"],
			runs: "z",
		});
		expect(commands.find((c) => c.name === "new")?.caps).toEqual(["⌃B", "⇧N"]);
		expect(matching(commands, "zo").map((c) => c.name)).toEqual(["zoom"]);
		expect(matching(commands, "workspace 2").map((c) => c.name)).toEqual(["workspace 2"]);
	});

	it("groups the commands as the palette shows them: tile, focus, workspace, then the window's own", () => {
		const commands = commandsOf(PREFIX, TABLE, 1);
		expect(commands.map((c) => c.name)).toEqual([
			"split",
			"split down",
			"turn",
			"fold",
			"zoom",
			"close",
			"focus left",
			"focus down",
			"focus up",
			"focus right",
			"new",
			"previous workspace",
			"next workspace",
			"workspace 1",
			"asks",
			"jobs",
			"keys",
			"info",
			"bars",
		]);
		// A key this page's table does not know, from a newer host, is still listed, with the window's own.
		const newer = commandsOf(PREFIX, [...TABLE, {key: "w", repeats: false, name: "pick"}], 1);
		expect(newer.at(-1)).toMatchObject({name: "pick", group: "window", caps: ["⌃B", "W"]});
	});

	it("shows the real keys after Ctrl-B", () => {
		expect(prefixLine(TABLE)).toEqual([
			{key: "N", name: "new"},
			{key: "x", name: "close"},
			{key: "z", name: "zoom"},
			{key: "f", name: "fold"},
			{key: "|", name: "split"},
			{key: "?", name: "keys"},
		]);
	});
});

describe("the top bar", () => {
	it("names a workspace by the ticket it shows, and draws its line in order", () => {
		const ws = activeOf(lined);
		expect(workspaceName(ws, SHOWN)).toBe("#7");
		expect(workspaceName(ws, new Map())).toBe("tracker");
		expect(lineIn(ws)).toEqual([
			{program: "tracker", tile: "t1", focused: false},
			{program: "ticket", tile: "t2", focused: true},
			{program: "runs", tile: "t3", focused: false},
		]);
		const plain = fold([]);
		expect(workspaceName(activeOf(plain), SHOWN)).toBe("tsh");
		expect(lineIn(activeOf(plain))).toEqual([]);
	});

	it("counts asks in words", () => {
		expect(asksWord(0)).toBe("nothing asks you");
		expect(asksWord(1)).toBe("1 asks you");
		expect(asksWord(3)).toBe("3 ask you");
	});

	it("says nothing of a ledger that answers, and a failed read as broken", () => {
		expect(ledgerWord(now())).toBeNull();
		expect(ledgerWord(now({reach: "reading"}))).toBeNull();
		expect(ledgerWord(now({reach: "failed", why: "refused"}))).toEqual({
			word: "ledger unreachable",
			broken: true,
		});
	});

	it("says nothing of a host that is up, and the rest in a word, broken only when down", () => {
		expect(hostWord({kind: "up"}, true)).toBeNull();
		expect(hostWord({kind: "build", theirs: "a1", ours: "b2"}, true)).toEqual({
			word: "host older",
			broken: false,
		});
		expect(hostWord({kind: "reconnecting", why: "gone"}, true)).toEqual({
			word: "host down",
			broken: true,
		});
		expect(hostWord({kind: "reconnecting", why: "gone"}, false)).toEqual({
			word: "connecting",
			broken: false,
		});
		expect(hostWord({kind: "stopped", why: "gone"}, true)?.word).toBe("host down");
	});
});

describe("the bottom line and the asks list", () => {
	it("says the focused tile, what it takes and sends, and its neighbors", () => {
		expect(hereWord(lined, SHAPES, SHOWN)).toBe(
			"t2 ticket #7 · takes ticket · sends ticket · from tracker → runs",
		);
		expect(hereWord(fold([]), SHAPES, SHOWN)).toBe("t1 tsh");
	});

	it("asks your own close at the bottom, as tmux does", () => {
		const asking = fold([
			{type: "key", key: "<c-b>", at: 0},
			{type: "key", key: "x", at: 1},
		]);
		expect(questionWord(asking)).toBe("close t1? (y/n)");
		expect(questionWord(fold([]))).toBeNull();
	});

	it("reads the ticket a run shows off the ticket program's view only", () => {
		const shown = ticketsShown([
			["ticket:1", {type: "view", program: "ticket", data: {ready: true, number: 7, page: null}}],
			["ticket:2", {type: "view", program: "ticket", data: {ready: false, number: null}}],
			["counter:1", {type: "view", program: "counter", data: {number: 3}}],
			["ticket:3", {type: "view", program: "ticket", data: "not a view"}],
		]);
		expect([...shown]).toEqual([["ticket:1", 7]]);
	});

	it("makes one row per ask: what it asks, its ticket and tile under it, its time", () => {
		const at = new Date(2026, 9, 30, 11, 13).getTime();
		const asks = now({
			asks: [
				ask({at}),
				ask({
					key: "8/stuck/r-1",
					ticket: 8,
					title: "Dark mode",
					kind: "stuck",
					what: "checks red",
					at,
				}),
			],
			later: [
				ask({key: "9/a-1", ticket: 9, title: "Login broken", what: "is it a duplicate of #7?", at}),
			],
		});
		const [live, later] = asksSections(asks, lined, SHOWN, at);
		expect(live).toMatchObject({id: "asks", title: null, fold: false});
		expect(live?.rows).toEqual([
			{
				id: "7/a-1",
				icon: "ask",
				title: "Approve plan",
				sub: "#7 Login fails · t2",
				side: "11:13",
				second: {name: "Later", cap: "H"},
			},
			{
				id: "8/stuck/r-1",
				icon: "stuck",
				title: "Stuck: checks red",
				sub: "#8 Dark mode",
				side: "11:13",
				second: {name: "Later", cap: "H"},
			},
		]);
		expect(later).toMatchObject({id: "later", title: "Later", fold: true});
		expect(later?.rows[0]).toMatchObject({
			icon: "later",
			title: "Is it a duplicate of #7?",
			second: {name: "Bring back", cap: "H"},
		});
		// Nothing set aside: no Later section at all.
		expect(asksSections(now({asks: [ask()]}), lined, SHOWN, at)).toHaveLength(1);
	});

	it("opens an ask in the tile that shows its ticket, else turns the tracker to it, else says so", () => {
		expect(tileOfTicket(lined, 7, SHOWN)).toBe("t2");
		expect(tileOfTicket(lined, 8, SHOWN)).toBeUndefined();
		expect(opensOf(lined, 7, SHOWN)).toEqual({kind: "tile", tile: "t2"});
		expect(opensOf(lined, 8, SHOWN)).toEqual({kind: "tracker", tile: "t1", run: "tracker:1"});
		expect(opensOf(fold([]), 8, SHOWN)).toEqual({kind: "none"});
		expect(opensOf(null, 7, SHOWN)).toEqual({kind: "none"});
		expect(nowhereNote(8)).toBe("no tile shows #8 · the tracker opens it");
	});
});

describe("keys while something lies over the desk", () => {
	const quiet = {armed: false, asking: false};
	const asks: Frame["over"] = {kind: "asks"};
	const palette: Frame["over"] = {kind: "palette", title: "commands", query: "", at: 0};

	it("sends every key to the desk when nothing is open", () => {
		for (const key of ["<arrowdown>", "a", "<c-b>"])
			expect(keyGoesTo({kind: "none"}, key, PREFIX, quiet)).toBe("desk");
	});

	it("never lets an arrow, Enter or a letter reach a tile while a popover is open", () => {
		const jobs: Frame["over"] = {kind: "jobs"};
		for (const over of [asks, jobs, palette, {kind: "item", what: "host"} as const])
			for (const key of ["<arrowdown>", "<arrowup>", "<arrowleft>", "<enter>", "h", "j", "x", " "])
				expect(keyGoesTo(over, key, PREFIX, quiet)).toBe("over");
	});

	it("lets Ctrl-B and the key after it reach the desk over a menu, so C-b a closes it", () => {
		expect(keyGoesTo(asks, PREFIX, PREFIX, quiet)).toBe("desk");
		expect(keyGoesTo(asks, "a", PREFIX, {armed: true, asking: false})).toBe("desk");
		expect(keyGoesTo(asks, "y", PREFIX, {armed: false, asking: true})).toBe("desk");
		expect(keyGoesTo({kind: "jobs"}, "J", PREFIX, {armed: true, asking: false})).toBe("desk");
	});

	it("keeps every key in the palette, a modal dialog, even Ctrl-B", () => {
		expect(keyGoesTo(palette, PREFIX, PREFIX, quiet)).toBe("over");
		expect(keyGoesTo(palette, "a", PREFIX, {armed: true, asking: true})).toBe("over");
	});
});

describe("the job item and the jobs list", () => {
	const job = (n: number, text: string, since: number, foreground = false) => ({
		n,
		text,
		since,
		foreground,
	});
	const ended = (over: Partial<JobEnded> = {}): JobEnded => ({
		n: 3,
		text: "seq --to 9 | tally",
		how: "done",
		since: 0,
		at: 60_000,
		foreground: true,
		...over,
	});

	it("says how long, calmly: seconds in the first minute, then minutes, then hours", () => {
		expect(tookWord(-5)).toBe("0s");
		expect(tookWord(14_999)).toBe("14s");
		expect(tookWord(134_000)).toBe("2m");
		expect(tookWord(3_600_000)).toBe("1h");
		expect(tookWord(3_900_000)).toBe("1h 5m");
	});

	it("names the job tsh waits for, else the newest, with how many more run; nothing when none runs", () => {
		const jobs = {
			running: [
				job(1, "counter", 0),
				job(2, "tracker | ticket", 1000, true),
				job(4, "tally", 2000),
			],
			ended: null,
		};
		expect(jobItem(jobs, 135_000)).toEqual({
			n: 2,
			text: "tracker | ticket",
			said: "2m",
			ended: false,
			more: 2,
		});
		const background = {running: [job(1, "counter", 0), job(4, "tally", 2000)], ended: null};
		expect(jobItem(background, 16_000)).toMatchObject({n: 4, said: "14s", more: 1});
		expect(jobItem({running: [], ended: null}, 0)).toBeNull();
		expect(jobItem(undefined, 0)).toBeNull();
	});

	it("says an end plainly for a short while, then clears; a quick one in the foreground not at all", () => {
		const done = {running: [], ended: ended()};
		expect(jobItem(done, 60_000)).toEqual({
			n: 3,
			text: "seq --to 9 | tally",
			said: "done in 1m",
			ended: true,
			more: 0,
		});
		expect(jobItem(done, 60_000 + ENDED_SHOWN_MS)).toBeNull();
		const failed = {running: [job(1, "counter", 0)], ended: ended({how: "failed", since: 46_000})};
		expect(jobItem(failed, 61_000)).toMatchObject({said: "failed after 14s", more: 1});
		// Seen happen: tsh printed it in the tile, and the bottom line names what still runs.
		const quick = {running: [job(1, "counter", 0)], ended: ended({since: 59_000})};
		expect(jobItem(quick, 60_000)).toMatchObject({n: 1, ended: false});
		// In the background it ended out of sight, however quick.
		const behind = {running: [], ended: ended({since: 59_000, foreground: false, how: "stopped"})};
		expect(jobItem(behind, 60_000)?.said).toBe("stopped after 1s");
		const instant = {running: [], ended: ended({since: 59_400, foreground: false, how: "failed"})};
		expect(jobItem(instant, 60_000)?.said).toBe("failed at once");
	});

	it("lists the focused tile's jobs first and its last end, then each other tile's", () => {
		const desk: Open = {
			...lined,
			jobs: {
				t1: {running: [job(1, "counter", 0)], ended: null},
				t2: {running: [job(2, "tally", 0), job(5, "sleep --ms 9000", 0, true)], ended: ended()},
			},
		};
		const list = jobsList(desk, 120_000);
		const typed = (text: string) => ({text, typed: true});
		const plain = (text: string) => ({text, typed: false});
		expect(list.running).toBe(3);
		expect(list.sections).toEqual([
			{
				id: "here",
				title: null,
				fold: false,
				rows: [
					{
						id: "t2/%5",
						icon: "running",
						title: [typed("sleep --ms 9000")],
						sub: [typed("%5"), plain(" · t2")],
						side: "2m",
						second: null,
					},
					{
						id: "t2/%2",
						icon: "running",
						title: [typed("tally")],
						sub: [typed("%2"), plain(" · t2")],
						side: "2m",
						second: null,
					},
				],
			},
			{
				id: "ended",
				title: "Last ended",
				fold: false,
				rows: [
					{
						id: "t2/ended",
						icon: "done",
						title: [typed("seq --to 9 | tally")],
						sub: [typed("%3"), plain(" · t2 · done in 1m")],
						side: whenOf(60_000, 120_000),
						second: null,
					},
				],
			},
			{
				id: "others",
				title: "Other tiles",
				fold: false,
				rows: [
					{
						id: "t1/%1",
						icon: "running",
						title: [typed("counter")],
						sub: [typed("%1"), plain(" · t1")],
						side: "2m",
						second: null,
					},
				],
			},
		]);
		// Enter on a row focuses the tile it runs in.
		expect(list.tiles.get("t1/%1")).toBe("t1");
		expect(list.tiles.get("t2/ended")).toBe("t2");
	});

	it("keeps the jobs list's own part when this tile runs nothing, so its calm line shows", () => {
		const desk: Open = {...lined, jobs: {t1: {running: [job(1, "counter", 0)], ended: null}}};
		const {sections, running} = jobsList(desk, 1000);
		expect(running).toBe(1);
		expect(sections.map((s) => [s.id, s.rows.length])).toEqual([
			["here", 0],
			["others", 1],
		]);
		expect(jobsList({...lined, jobs: {}}, 0).sections).toEqual([
			{id: "here", title: null, fold: false, rows: []},
		]);
	});

	it("opens and closes the jobs list as a menu, by its key", () => {
		const open = frameUpdate(FRAME, {type: "show", what: "jobs"});
		expect(open.over).toEqual({kind: "jobs"});
		expect(frameUpdate(open, {type: "show", what: "jobs"}).over).toEqual({kind: "none"});
		expect(TABLE.find((b) => b.name === "jobs")?.key).toBe("J");
	});
});

describe("the frame's own state", () => {
	it("opens and closes the asks list as a menu, and the palette with its query", () => {
		const open = frameUpdate(FRAME, {type: "show", what: "asks"});
		expect(open.over).toEqual({kind: "asks"});
		expect(frameUpdate(open, {type: "show", what: "asks"}).over).toEqual({kind: "none"});
		const palette = frameUpdate(FRAME, {type: "palette"});
		const typed = frameUpdate(palette, {type: "query", query: "zo"});
		expect(typed.over).toEqual({kind: "palette", title: "commands", query: "zo", at: 0});
		expect(frameUpdate(typed, {type: "move", by: -1, of: 3}).over).toMatchObject({at: 2});
	});

	it("opens one thing at a time: the next one takes the place of the last", () => {
		const asks = frameUpdate(FRAME, {type: "show", what: "asks"});
		expect(frameUpdate(asks, {type: "palette"}).over.kind).toBe("palette");
		expect(frameUpdate(asks, {type: "item", what: "host"}).over).toEqual({
			kind: "item",
			what: "host",
		});
		expect(frameUpdate(asks, {type: "show", what: "keys"}).over).toMatchObject({title: "keys"});
		const palette = frameUpdate(FRAME, {type: "palette"});
		expect(frameUpdate(palette, {type: "show", what: "asks"}).over).toEqual({kind: "asks"});
		expect(frameUpdate(asks, {type: "close"}).over).toEqual({kind: "none"});
	});

	it("closes and says why when an ask has nowhere to open", () => {
		const said = frameUpdate(frameUpdate(FRAME, {type: "show", what: "asks"}), {
			type: "say",
			note: nowhereNote(8),
		});
		expect(said.over).toEqual({kind: "none"});
		expect(said.note).toBe("no tile shows #8 · the tracker opens it");
	});

	it("says the key for next time after the palette ran a command", () => {
		const ran = frameUpdate(frameUpdate(FRAME, {type: "palette"}), {type: "ran", key: "C-b z"});
		expect(ran.over).toEqual({kind: "none"});
		expect(ran.note).toBe("next time: C-b z");
		expect(frameUpdate(ran, {type: "unnote"}).note).toBeNull();
	});

	it("explains only in info mode, and hides both bars and back", () => {
		expect(frameUpdate(FRAME, {type: "explain", text: "x"}).explained).toBeNull();
		const info = frameUpdate(FRAME, {type: "show", what: "info"});
		expect(frameUpdate(info, {type: "explain", text: "x"}).explained).toBe("x");
		const bare = frameUpdate(FRAME, {type: "show", what: "bars"});
		expect(bare.bare).toBe(true);
		expect(frameUpdate(bare, {type: "show", what: "bars"}).bare).toBe(false);
	});
});
