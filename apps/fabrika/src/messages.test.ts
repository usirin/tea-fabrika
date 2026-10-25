import {describe, expect, it} from "vitest";
import {readFromTerminal, readFromWindow, readToTerminal, readToWindow} from "./messages.ts";

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
