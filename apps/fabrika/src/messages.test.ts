import {describe, expect, it} from "vitest";
import {fresh, takenNow} from "./desk/desk.ts";
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

	it("takes keys, clicks and a border let go from the page, and nothing that opens or stops a tile", () => {
		expect(readFromPage({type: "press", id: 0, key: "<c-b>"}).kind).toBe("read");
		expect(readFromPage({type: "press", id: 0, key: "<c-b>", at: 12}).kind).toBe("refused");
		expect(readFromPage({type: "click", tile: "t2"}).kind).toBe("read");
		expect(readFromPage({type: "click", tile: "../t2"}).kind).toBe("refused");
		expect(readFromPage({type: "resize", stack: "s1", sizes: {t1: 40, t2: 60}}).kind).toBe("read");
		expect(readFromPage({type: "open", tile: "t2"}).kind).toBe("refused");
		expect(readFromPage({type: "stop", tile: "t2"}).kind).toBe("refused");
		expect(readFromPage({type: "save", desk: {}}).kind).toBe("refused");
	});

	it("tells the page the link is down, with what the app does now", () => {
		const down = {type: "down", why: "The link to the host ended: the other side closed."};
		expect(readToPage({...down, now: "reconnecting"}).kind).toBe("read");
		expect(readToPage({...down, now: "stopped"}).kind).toBe("read");
		expect(readToPage({...down, now: "refused"}).kind).toBe("read");
		expect(readToPage(down).kind).toBe("refused");
		expect(readToPage({...down, now: "gone"}).kind).toBe("refused");
	});

	it("takes Try again from the page for the app itself, and nothing more", () => {
		expect(readToApp({type: "again"})).toEqual({kind: "read", msg: {type: "again"}});
		expect(readToApp({type: "again", now: true}).kind).toBe("refused");
		expect(readToApp({type: "click", tile: "t2"}).kind).toBe("refused");
		// The host does not read it: Try again never reaches it as a message of its own.
		expect(readFromPage({type: "again"}).kind).toBe("refused");
	});
});
