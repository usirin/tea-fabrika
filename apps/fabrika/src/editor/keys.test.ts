import {describe, expect, it} from "vitest";
import {keyOf, keysIn} from "./keys.ts";
import {columns, shown} from "./screen.ts";

describe("keysIn", () => {
	it("keeps a run of typed text whole, and each control key alone", () => {
		expect(keysIn("ls\x01\x05")).toEqual(["ls", "\x01", "\x05"]);
	});

	it("keeps an escape sequence whole: arrows, Delete, Ctrl-Left", () => {
		expect(keysIn("\x1b[A\x1b[3~\x1b[1;5Dx")).toEqual(["\x1b[A", "\x1b[3~", "\x1b[1;5D", "x"]);
	});

	it("reads ESC and a key as Alt and that key, and ESC O as the other arrow form", () => {
		expect(keysIn("\x1bb\x1bOA")).toEqual(["\x1bb", "\x1bOA"]);
	});

	it("keeps a lone ESC at the end alone", () => {
		expect(keysIn("a\x1b")).toEqual(["a", "\x1b"]);
	});

	it("cuts a paste with new lines into lines and Enters", () => {
		expect(keysIn("say a\rsay b\r")).toEqual(["say a", "\r", "say b", "\r"]);
	});
});

describe("keyOf", () => {
	it("names each key by readline's command", () => {
		expect(keyOf("\x01")).toEqual({kind: "command", command: "beginning-of-line"});
		expect(keyOf("\x1bf")).toEqual({kind: "command", command: "forward-word"});
		expect(keyOf("\x1b[B")).toEqual({kind: "command", command: "next-history"});
		expect(keyOf("\t")).toEqual({kind: "command", command: "complete"});
	});

	it("reads text as text, and anything else as unknown", () => {
		expect(keyOf("cou")).toEqual({kind: "text", text: "cou"});
		expect(keyOf("\x1b[24~")).toEqual({kind: "unknown"});
		expect(keyOf("\u0085")).toEqual({kind: "unknown"});
	});
});

describe("shown", () => {
	it("writes control characters as ^ and a letter, as cat -v does", () => {
		expect(shown("a\x1b]0;x\x07b")).toBe("a^[]0;x^Gb");
		expect(shown("del\x7f")).toBe("del^?");
	});

	it("keeps tabs, and makes a new line a new row", () => {
		expect(shown("a\tb\nc")).toBe("a\tb\r\nc");
	});

	it("shows a C1 control as the replacement character", () => {
		expect(shown("a\u009bb")).toBe("a\u{fffd}b");
	});
});

describe("columns", () => {
	it("lists down, then across, as readline does", () => {
		expect(columns(["aa", "bb", "cc", "dd", "ee"], 12)).toBe("aa  cc  ee\r\nbb  dd\r\n");
	});

	it("puts one in a row when none fit side by side", () => {
		expect(columns(["long-name", "other"], 8)).toBe("long-name\r\nother\r\n");
	});
});
