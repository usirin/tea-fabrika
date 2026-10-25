import {describe, expect, it} from "vitest";
import {
	readFromDesk,
	readFromTerminal,
	readFromWindow,
	readToDesk,
	readToTerminal,
	readToWindow,
} from "./messages.ts";

// The envelope of each message type, read strictly. What is inside a window's `msg` is read by
// its run's program, in host.test.ts.

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
	it("has no `beside`: a run started with & opens no tile", () => {
		const run = {id: "counter:1a2b", program: "counter"};
		expect(readToDesk({type: "beside", tile: "t1", run}).kind).toBe("refused");
		expect(readToDesk({type: "covered", tile: "t1", run}).kind).toBe("read");
		expect(readToDesk({type: "closing", tile: "t2"}).kind).toBe("read");
	});

	it("asks to close a tile, to stop one, and to empty, and stops no run by its id", () => {
		expect(readFromDesk({type: "close", tile: "t2"}).kind).toBe("read");
		expect(readFromDesk({type: "stop", tile: "t2"}).kind).toBe("read");
		expect(readFromDesk({type: "empty"}).kind).toBe("read");
		expect(readFromDesk({type: "stop", run: "counter:1a2b"}).kind).toBe("refused");
		expect(readFromDesk({type: "quit"}).kind).toBe("refused");
	});
});
