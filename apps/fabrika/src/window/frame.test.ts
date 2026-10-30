import {applyCell} from "@demlik/tea";
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
import {
	askRow,
	asksWord,
	commandsOf,
	FRAME,
	frameUpdate,
	hereWord,
	hostWord,
	keyWord,
	ledgerWord,
	lineIn,
	matching,
	prefixLine,
	questionWord,
	ticketsShown,
	tileOfTicket,
	tipOf,
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
			key: "C-b z",
			runs: "z",
		});
		expect(matching(commands, "zo").map((c) => c.name)).toEqual(["zoom"]);
		expect(matching(commands, "workspace 2").map((c) => c.name)).toEqual(["workspace 2"]);
	});

	it("shows the real keys after Ctrl-B, and a tooltip says the name and the key, if any", () => {
		expect(prefixLine(TABLE)).toEqual([
			{key: "N", name: "new"},
			{key: "x", name: "close"},
			{key: "z", name: "zoom"},
			{key: "f", name: "fold"},
			{key: "|", name: "split"},
			{key: "?", name: "keys"},
		]);
		expect(tipOf("asks", "C-b a")).toBe("asks · C-b a");
		expect(tipOf("host", null)).toBe("host");
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

	it("names each ask by its tile and ticket, and finds the tile a ticket is shown in", () => {
		expect(tileOfTicket(lined, 7, SHOWN)).toBe("t2");
		expect(tileOfTicket(lined, 8, SHOWN)).toBeUndefined();
		expect(askRow(ask(), "t2")).toBe("t2 ticket #7 · approve plan");
		expect(askRow(ask({kind: "stuck", ticket: 8, what: "read failed"}), undefined)).toBe(
			"ticket #8 · stuck: read failed",
		);
	});
});

describe("the frame's own state", () => {
	it("opens and closes the asks list as a menu, and the palette with its query", () => {
		const open = frameUpdate(FRAME, {type: "show", what: "asks"});
		expect(open.over).toEqual({kind: "asks", later: false});
		expect(frameUpdate(open, {type: "show", what: "asks"}).over).toEqual({kind: "none"});
		const palette = frameUpdate(FRAME, {type: "palette"});
		const typed = frameUpdate(palette, {type: "query", query: "zo"});
		expect(typed.over).toEqual({kind: "palette", title: "commands", query: "zo", at: 0});
		expect(frameUpdate(typed, {type: "move", by: -1, of: 3}).over).toMatchObject({at: 2});
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
