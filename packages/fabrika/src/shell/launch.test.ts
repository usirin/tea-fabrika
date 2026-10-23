import {describe, expect, it} from "vitest";
import {homeOf, linesOf, sourceOf} from "./launch.ts";
import {begin, find, keyOf, keysIn, type Search, shown, step} from "./search.ts";

// What the launcher does from the line as typed, with no terminal: the Ctrl-R
// search, and how the command line is read. These cases were in the
// pipeline's tsh/complete.test.ts until experiment 114; they name no program,
// so they came here with the shell. Tab completion against the pipeline's
// programs stayed there.

describe("Ctrl-R", () => {
	const history = ["say --text hello", "seq --to 3", "say --text help"];
	const keys = (search: Search, ...raw: string[]) =>
		raw.reduce<ReturnType<typeof step>>(
			(at, key) => (at.kind === "searching" ? step(history, at.search, keyOf(key)) : at),
			{kind: "searching", search},
		);

	it("finds the newest line with the query, and an older one on Ctrl-R again", () => {
		const s = keys(begin, "h", "e", "l");
		expect(s.kind === "searching" && shown(history, s.search)).toBe(
			"(reverse-i-search)`hel': say --text hello",
		);
		const again = keys(begin, "h", "e", "l", "\x12");
		expect(again.kind === "searching" && again.search.at).toBe(2);
	});

	it("runs the line found on Enter, hands it back to edit on another key, and gives up on Esc", () => {
		expect(keys(begin, "s", "e", "q", "\r")).toEqual({
			kind: "done",
			line: "seq --to 3",
			run: true,
			replay: null,
		});
		expect(keys(begin, "s", "e", "q", "\x1b[D")).toEqual({
			kind: "done",
			line: "seq --to 3",
			run: false,
			replay: "\x1b[D",
		});
		expect(keys(begin, "s", "\x1b")).toEqual({kind: "done", line: null, run: false, replay: null});
	});

	it("says when nothing matches, and shrinks the query on Backspace", () => {
		const none = keys(begin, "z");
		expect(none.kind === "searching" && shown(history, none.search)).toBe(
			"(failing reverse-i-search)`z': ",
		);
		const back = keys(begin, "z", "\x7f", "s");
		expect(back.kind === "searching" && back.search.at).toBe(0);
		expect(find(history, "", 0)).toBe(-1);
	});

	it("cuts a chunk into keys, an escape sequence whole", () => {
		expect(keysIn("ab\x1b[A\x12c")).toEqual(["a", "b", "\x1b[A", "\x12", "c"]);
		expect(keysIn("\x1b")).toEqual(["\x1b"]);
	});
});

describe("the command line", () => {
	it("reads how tsh was started", () => {
		expect(sourceOf([], true)).toEqual({kind: "terminal"});
		expect(sourceOf([], false)).toEqual({kind: "stdin"});
		expect(sourceOf(["-c", "seq --to 1"], true)).toEqual({kind: "text", text: "seq --to 1"});
		expect(sourceOf(["run.tsh"], true)).toEqual({kind: "file", path: "run.tsh"});
		expect(sourceOf(["-c"], true).kind).toBe("usage");
		expect(sourceOf(["-x"], true).kind).toBe("usage");
		expect(sourceOf(["a", "b"], true).kind).toBe("usage");
	});

	it("cuts a script into lines, and finds the home", () => {
		expect(linesOf("a\r\nb\n")).toEqual(["a", "b"]);
		expect(linesOf("")).toEqual([]);
		expect(homeOf({TSH_HOME: "/h"}, "/u")).toBe("/h");
		expect(homeOf({}, "/u")).toBe("/u/.tsh");
	});
});
