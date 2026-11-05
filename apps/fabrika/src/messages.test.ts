import {Result} from "effect";
import {describe, expect, it} from "vitest";
import {fresh, takenNow} from "./desk/desk.ts";
import {decodeKeys} from "./desk/keymap.ts";
import {
	readFromPage,
	readFromTerminal,
	readFromWindow,
	readToApp,
	readToPage,
	readToTerminal,
	readToWindow,
} from "./messages.ts";

// The envelope of each message type, read strictly. What is inside a window's `msg` is read by
// its run's program, in tsh.test.ts.

describe("from the terminal", () => {
	it("reads keys and a size", () => {
		expect(readFromTerminal({type: "keys", data: "cou\t"})).toEqual({
			kind: "read",
			msg: {type: "keys", data: "cou\t"},
		});
		expect(readFromTerminal({type: "size", cols: 100, rows: 30}).kind).toBe("read");
	});

	it("is refused with a key it does not name, a size out of bounds, or a paste past 64 KiB", () => {
		expect(readFromTerminal({type: "keys", data: "x", to: "tsh"}).kind).toBe("refused");
		expect(readFromTerminal({type: "size", cols: 0, rows: 30}).kind).toBe("refused");
		expect(readFromTerminal({type: "size", cols: 80.5, rows: 30}).kind).toBe("refused");
		expect(readFromTerminal({type: "keys", data: "x".repeat(65537)}).kind).toBe("refused");
		expect(readFromTerminal("seq --to 3").kind).toBe("refused");
	});
});

describe("to the terminal", () => {
	it("reads bytes to write, and nothing else", () => {
		expect(readToTerminal({type: "write", data: "tsh$ "}).kind).toBe("read");
		expect(readToTerminal({type: "view", data: "tsh$ "}).kind).toBe("refused");
	});
});

describe("a program's window", () => {
	it("reads a view with its program's name, and sends a message for its run", () => {
		const view = {type: "view", program: "counter", data: {n: 0}};
		expect(readToWindow(view)).toEqual({kind: "read", msg: view});
		const m = {type: "msg", msg: {type: "press", value: "plus"}};
		expect(readFromWindow(m)).toEqual({kind: "read", msg: m});
	});

	it("is refused a message that names another run", () => {
		expect(readFromWindow({type: "msg", to: "tsh:p1", msg: null}).kind).toBe("refused");
		expect(readToWindow({type: "view", data: {n: 0}}).kind).toBe("refused");
	});

	// 185b PR 3b, call C: a view says which inputs its run takes, so a window in an agent's tile
	// draws no control for one the agent's tsh dropped. A view with no `takes` is from a host
	// before 3b, and still reads. Made up here: `ToWindow.takes`.
	it("reads a view with the inputs its run takes, and one with none said", () => {
		const view = {type: "view", program: "ticket", data: {}, takes: ["comment", "close"]};
		expect(readToWindow(view)).toEqual({kind: "read", msg: view});
		expect(readToWindow({type: "view", program: "ticket", data: {}}).kind).toBe("read");
		expect(readToWindow({...view, takes: "comment"}).kind).toBe("refused");
		expect(readToWindow({...view, takes: [7]}).kind).toBe("refused");
	});
});

describe("the desk's port", () => {
	it("sends the page the whole desk, with the keys the desk takes now", () => {
		const desk = fresh();
		const sent = {type: "desk", desk, takes: takenNow(desk, 0)};
		expect(readToPage(sent)).toEqual({kind: "read", msg: sent});
		expect(sent.takes).toEqual({all: false, keys: ["<c-b>"]});
		expect(readToPage({type: "desk", desk: {at: "over"}, takes: {all: false, keys: []}}).kind).toBe(
			"read",
		);
		// A desk that breaks its own shape is not drawn.
		const broken = {...desk, workspaces: []};
		expect(readToPage({type: "desk", desk: broken, takes: sent.takes}).kind).toBe("refused");
		expect(readToPage({type: "answer", id: 3, took: true}).kind).toBe("read");
	});

	it("takes keys, clicks, a border let go and folds from the page, and nothing that opens or stops a tile", () => {
		expect(readFromPage({type: "press", id: 0, key: "<c-b>"}).kind).toBe("read");
		expect(readFromPage({type: "press", id: 0, key: "<c-b>", at: 12}).kind).toBe("refused");
		expect(readFromPage({type: "click", tile: "t2"}).kind).toBe("read");
		expect(readFromPage({type: "click", tile: "../t2"}).kind).toBe("refused");
		const sizes = {t1: 40, t2: 60};
		expect(readFromPage({type: "resize", container: "c1", sizes}).kind).toBe("read");
		expect(readFromPage({type: "resize", stack: "c1", sizes}).kind).toBe("refused");
		expect(readFromPage({type: "fold", tile: "t2"}).kind).toBe("read");
		expect(readFromPage({type: "fold", tile: "../t2"}).kind).toBe("refused");
		expect(readFromPage({type: "unfold", node: "c4"}).kind).toBe("read");
		expect(readFromPage({type: "open", tile: "t2"}).kind).toBe("refused");
		expect(readFromPage({type: "stop", tile: "t2"}).kind).toBe("refused");
		expect(readFromPage({type: "save", desk: {}}).kind).toBe("refused");
	});

	it("sends the page the keys file's table, and takes a palette run by its command word (ticket 174)", () => {
		const read = decodeKeys('prefix = "ctrl+a"', true);
		if (Result.isFailure(read)) throw new Error(read.failure.why);
		const sent = {type: "keys", ...read.success};
		expect(readToPage(sent)).toEqual({kind: "read", msg: sent});
		const refused = {
			...sent,
			file: {_tag: "refused", line: 2, why: "tezgah.zom is not a command"},
		};
		expect(readToPage(refused)).toEqual({kind: "read", msg: refused});
		// A row names a command the code lists, never a free string.
		const typo = {...sent, rows: [{does: "tezgah.zom", keys: [], source: "yours"}]};
		expect(readToPage(typo).kind).toBe("refused");
		// The old table, one row per key, is not read.
		expect(
			readToPage({
				type: "keys",
				prefix: "<c-b>",
				table: [{key: "|", repeats: false, name: "split", tsh: "split"}],
			}).kind,
		).toBe("refused");
		expect(readFromPage({type: "run", does: "tezgah.zoom"}).kind).toBe("read");
		expect(readFromPage({type: "run", does: "tezgah.zom"}).kind).toBe("refused");
		expect(readFromPage({type: "run", key: "z"}).kind).toBe("refused");
	});

	it("tells the page what it shows of the link: what the app found, or how it is lost", () => {
		const why = "The link to the host ended: the other side closed.";
		const link = (now: unknown) => readToPage({type: "link", now}).kind;
		expect(link({kind: "up"})).toBe("read");
		expect(link({kind: "version", theirs: 1, ours: 2})).toBe("read");
		expect(link({kind: "build", theirs: "0ld0ld0ld0ld", ours: "n3wn3wn3wn3w"})).toBe("read");
		expect(link({kind: "build", theirs: null, ours: "n3wn3wn3wn3w"})).toBe("read");
		expect(link({kind: "reconnecting", why})).toBe("read");
		expect(link({kind: "stopped", why})).toBe("read");
		expect(link({kind: "restarting"})).toBe("read");
		// Each kind has what it names, and no more.
		expect(link({kind: "version", theirs: 1})).toBe("refused");
		expect(link({kind: "build", ours: "n3wn3wn3wn3w"})).toBe("refused");
		expect(link({kind: "reconnecting"})).toBe("refused");
		expect(link({kind: "up", why})).toBe("refused");
		expect(link({kind: "gone"})).toBe("refused");
		// The old shape is not read.
		expect(readToPage({type: "down", why, now: "reconnecting"}).kind).toBe("refused");
	});

	it("takes Try again and the restart from the page for the app itself, and nothing more", () => {
		expect(readToApp({type: "again"})).toEqual({kind: "read", msg: {type: "again"}});
		expect(readToApp({type: "restart"})).toEqual({kind: "read", msg: {type: "restart"}});
		expect(readToApp({type: "again", now: true}).kind).toBe("refused");
		expect(readToApp({type: "restart", pid: 42}).kind).toBe("refused");
		expect(readToApp({type: "click", tile: "t2"}).kind).toBe("refused");
		// The host does not read them: neither reaches it as a message of its own.
		expect(readFromPage({type: "again"}).kind).toBe("refused");
		expect(readFromPage({type: "restart"}).kind).toBe("refused");
	});

	// 185b PR 3b, call C: the line in an agent's tile, "Only you can answer this. Open #7 in your
	// own tile.", asks the desk for a tile of the person's that shows #7, when no tile of theirs
	// shows it and no tracker of theirs is open. Made up here: the `mine` message, "open this
	// ticket in a tile of mine" (`own` already names the home's own ledger).
	it("takes a ticket to open in the person's own tile, by its number, and nothing more", () => {
		expect(readFromPage({type: "mine", ticket: 7})).toEqual({
			kind: "read",
			msg: {type: "mine", ticket: 7},
		});
		expect(readFromPage({type: "mine", ticket: 0}).kind).toBe("refused");
		expect(readFromPage({type: "mine", ticket: 7.5}).kind).toBe("refused");
		expect(readFromPage({type: "mine", ticket: "7"}).kind).toBe("refused");
		expect(readFromPage({type: "mine", ticket: 7, tile: "t2"}).kind).toBe("refused");
		expect(readFromPage({type: "mine", ticket: 7, agent: "claude"}).kind).toBe("refused");
		expect(readFromPage({type: "mine"}).kind).toBe("refused");
	});
});
