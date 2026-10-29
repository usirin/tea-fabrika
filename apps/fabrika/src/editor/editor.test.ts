import {replay} from "@demlik/tea";
import {listed, Shell} from "@kampus/fabrika";
import {counter} from "@tea-fabrika/counter";
import {Layer} from "effect";
import {describe, expect, it} from "vitest";
import {type Editor, type EditorMsg, editor} from "./editor.ts";
import {gridOf} from "./grid.ts";
import {back, draw, PROMPT, spot} from "./screen.ts";

// The line editor, folded with `replay` and read back off a terminal's grid (grid.ts): what a
// person would see, and where the cursor is, never the bytes by eye.

const programs = Shell.programList([...Shell.SMALL, listed(counter, Layer.empty)]);

const keys = (data: string): EditorMsg => ({type: "keys", data});

/** Fold the messages, then read the screen the writes leave, and what else was asked for. */
const run = (
	msgs: readonly EditorMsg[],
	opts: {history?: readonly string[]; cols?: number} = {},
) => {
	const cols = opts.cols ?? 80;
	const folded = replay(editor, {
		ctx: {programs, history: opts.history ?? []},
		msgs: [{type: "size", cols}, ...msgs],
	});
	const bytes = folded.cmds.flatMap((c) => (c.type === "write" ? [c.data] : [])).join("");
	const asked = folded.cmds.flatMap((c) => {
		if (c.type === "line") return [`line ${c.text}`];
		if (c.type === "keep") return [`keep ${c.lines.join(",")}`];
		if (c.type === "interrupt" || c.type === "close") return [c.type];
		return [];
	});
	return {...gridOf(bytes, cols), state: folded.state, asked, bytes};
};

/** The screen's rows, and a `|` where the cursor is on its row. */
const seen = (
	msgs: readonly EditorMsg[],
	opts: {history?: readonly string[]; cols?: number} = {},
) => {
	const {rows, cursor} = run(msgs, opts);
	return rows.map((row, i) =>
		i === cursor.row
			? `${row.padEnd(cursor.col).slice(0, cursor.col)}|${row.slice(cursor.col)}`
			: row,
	);
};

describe("the prompt", () => {
	it("starts with the prompt, the cursor after it", () => {
		expect(seen([])).toEqual(["tsh$ |"]);
	});

	it("puts typed text in at the cursor", () => {
		expect(seen([keys("seq --to 3")])).toEqual(["tsh$ seq --to 3|"]);
	});

	it("moves the cursor: Ctrl-A, Ctrl-E, Ctrl-B, Ctrl-F and the arrows, as readline's emacs keys", () => {
		expect(seen([keys("seq 3\x01")])).toEqual(["tsh$ |seq 3"]);
		expect(seen([keys("seq 3\x01\x05")])).toEqual(["tsh$ seq 3|"]);
		expect(seen([keys("seq 3\x02\x02")])).toEqual(["tsh$ seq| 3"]);
		expect(seen([keys("seq 3\x1b[D\x1b[D\x1b[C")])).toEqual(["tsh$ seq |3"]);
		expect(seen([keys("seq 3\x1b[H\x06")])).toEqual(["tsh$ s|eq 3"]);
	});

	it("moves by words: Alt-B and Alt-F, as readline's backward-word and forward-word", () => {
		expect(seen([keys("seq --to 3\x1bb")])).toEqual(["tsh$ seq --to |3"]);
		expect(seen([keys("seq --to 3\x1bb\x1bb")])).toEqual(["tsh$ seq --|to 3"]);
		expect(seen([keys("seq --to 3\x01\x1bf")])).toEqual(["tsh$ seq| --to 3"]);
		expect(seen([keys("seq --to 3\x01\x1bf\x1bf")])).toEqual(["tsh$ seq --to| 3"]);
	});

	it("kills: Ctrl-K to the end, Ctrl-U to the start, Ctrl-W the word before; Ctrl-Y puts it back", () => {
		expect(seen([keys("seq --to 3\x1bb\x0b")])).toEqual(["tsh$ seq --to |"]);
		expect(seen([keys("seq --to 3\x1bb\x15")])).toEqual(["tsh$ |3"]);
		expect(seen([keys("seq --to 3\x17")])).toEqual(["tsh$ seq --to |"]);
		expect(seen([keys("seq --to 3\x17\x17")])).toEqual(["tsh$ seq |"]);
		expect(seen([keys("seq --to 3\x15double \x19")])).toEqual(["tsh$ double seq --to 3|"]);
	});

	it("joins kills in a row, as readline's kill ring does, and starts again after another key", () => {
		// Two Ctrl-W in a row: Ctrl-Y puts both words back.
		expect(seen([keys("say hi there\x17\x17\x19")])).toEqual(["tsh$ say hi there|"]);
		// A key between them: only the last kill.
		expect(seen([keys("say hi there\x17\x02\x17\x05\x19")])).toEqual(["tsh$ say  hi|"]);
	});

	it("deletes: Backspace before the cursor, Delete and Ctrl-D under it", () => {
		expect(seen([keys("seqq\x7f")])).toEqual(["tsh$ seq|"]);
		expect(seen([keys("sseq\x01\x1b[3~")])).toEqual(["tsh$ |seq"]);
		expect(seen([keys("sseq\x01\x04")])).toEqual(["tsh$ |seq"]);
	});

	it("rings the bell for a Backspace with nothing before the cursor", () => {
		expect(run([keys("\x7f")]).bytes).toContain("\x07");
	});

	it("swaps the two characters at the cursor: Ctrl-T, as readline's transpose-chars", () => {
		expect(seen([keys("sqe\x14")])).toEqual(["tsh$ seq|"]);
		expect(seen([keys("esq\x01\x06\x14")])).toEqual(["tsh$ se|q"]);
	});

	it("leaves out a key it has no command for, and a control character in a paste", () => {
		expect(seen([keys("seq\x1b[24~")])).toEqual(["tsh$ seq|"]);
		expect(seen([keys("se\x1b[200~q")])).toEqual(["tsh$ seq|"]);
	});

	it("clears the screen on Ctrl-L and draws the line again at the top", () => {
		const {rows, cursor} = run([keys("say a\r"), {type: "ready"}, keys("seq\x0c")]);
		expect(rows.at(-1)).toBe("tsh$ seq");
		expect(cursor.col).toBe(8);
		expect(run([keys("say a\r"), {type: "ready"}, keys("seq\x0c")]).bytes).toContain("\x1b[2J");
	});
});

describe("Enter", () => {
	it("hands tsh the line, keeps it in the history, and waits for tsh", () => {
		const {asked, state} = run([keys("seq --to 3\r")]);
		expect(asked).toEqual(["line seq --to 3", "keep seq --to 3"]);
		expect(state.mode).toEqual({kind: "busy", ahead: []});
	});

	it("hands it the whole line, wherever the cursor is", () => {
		expect(run([keys("seq --to 3\x01\r")]).asked[0]).toBe("line seq --to 3");
	});

	it("gives a fresh prompt for a blank line, and asks tsh nothing", () => {
		expect(seen([keys("  \r")])).toEqual(["tsh$", "tsh$ |"]);
		expect(run([keys("  \r")]).asked).toEqual([]);
	});

	it("shows what tsh prints under the line, then the prompt when tsh is ready", () => {
		expect(
			seen([
				keys("seq --to 2\r"),
				{type: "printed", text: "1"},
				{type: "printed", text: "2"},
				{type: "ready"},
			]),
		).toEqual(["tsh$ seq --to 2", "1", "2", "tsh$ |"]);
	});

	it("keeps a line run again once, at the newest end", () => {
		const {asked} = run([
			keys("say a\r"),
			{type: "ready"},
			keys("say b\r"),
			{type: "ready"},
			keys("say a\r"),
		]);
		expect(asked.at(-1)).toBe("keep say b,say a");
	});
});

describe("while tsh runs a line", () => {
	it("holds keys typed ahead and puts them at the next prompt", () => {
		expect(seen([keys("sleep\r"), keys("say hi"), {type: "ready"}])).toEqual([
			"tsh$ sleep",
			"tsh$ say hi|",
		]);
	});

	it("runs a line typed ahead with its Enter, at the next prompt", () => {
		const {asked} = run([keys("sleep\r"), keys("say hi\r"), {type: "ready"}]);
		expect(asked).toEqual(["line sleep", "keep sleep", "line say hi", "keep sleep,say hi"]);
	});

	it("sends Ctrl-C to tsh at once and drops what was typed ahead, as a terminal does", () => {
		const done = run([keys("counter\r"), keys("say x"), keys("\x03"), {type: "ready"}]);
		expect(done.asked).toEqual(["line counter", "keep counter", "interrupt"]);
		expect(seen([keys("counter\r"), keys("say x"), keys("\x03"), {type: "ready"}])).toEqual([
			"tsh$ counter",
			"^C",
			"tsh$ |",
		]);
	});

	it("lets go of a Ctrl-D typed ahead, so tsh does not end once the prompt is back", () => {
		const done = run([keys("counter\r"), keys("\x04"), {type: "ready"}]);
		expect(done.asked).toEqual(["line counter", "keep counter"]);
		expect(done.state.mode.kind).toBe("prompt");
	});
});

describe("Ctrl-C and Ctrl-D at the prompt", () => {
	it("drops the line on Ctrl-C and gives a fresh prompt, as bash does", () => {
		expect(seen([keys("seq --to\x03")])).toEqual(["tsh$ seq --to^C", "tsh$ |"]);
		expect(run([keys("seq\x03")]).asked).toEqual([]);
	});

	it("ends tsh's input on Ctrl-D with an empty line", () => {
		const done = run([keys("\x04")]);
		expect(done.asked).toEqual(["close"]);
		expect(done.state.mode).toEqual({kind: "ended"});
		expect(run([keys("\x04"), keys("say hi\r")]).asked).toEqual(["close"]);
	});
});

describe("text from tsh while the prompt is up", () => {
	it("goes above the prompt, and the line and cursor stay as they were", () => {
		expect(seen([keys("say hi\x02"), {type: "printed", text: "counter 1"}])).toEqual([
			"counter 1",
			"tsh$ say h|i",
		]);
	});

	it("cannot move the cursor or clear the screen: control characters are shown as ^ and a letter", () => {
		expect(seen([{type: "printed", text: "a\x1b[2Jb\x07"}])).toEqual(["a^[[2Jb^G", "tsh$ |"]);
	});
});

describe("history", () => {
	const history = ["seq --to 3", "say hi", "counter"];

	it("goes back with Up and forward with Down, and gives back the line typed before", () => {
		expect(seen([keys("\x1b[A")], {history})).toEqual(["tsh$ counter|"]);
		expect(seen([keys("\x1b[A\x1b[A")], {history})).toEqual(["tsh$ say hi|"]);
		expect(seen([keys("dou\x1b[A\x1b[A\x1b[B\x1b[B")], {history})).toEqual(["tsh$ dou|"]);
		expect(seen([keys("\x10\x10\x0e")], {history})).toEqual(["tsh$ counter|"]);
	});

	it("rings the bell past the oldest line", () => {
		const done = run([keys("\x1b[A\x1b[A\x1b[A\x1b[A")], {history});
		expect(done.rows).toEqual(["tsh$ seq --to 3"]);
		expect(done.bytes).toContain("\x07");
	});

	it("runs a line it went back to, and keeps it as the newest", () => {
		expect(run([keys("\x1b[A\x1b[A\r")], {history}).asked).toEqual([
			"line say hi",
			"keep seq --to 3,counter,say hi",
		]);
	});

	it("leaves out a control character in a kept line, and a blank one", () => {
		expect(seen([keys("\x1b[A")], {history: ["say \x1b[2Jhi", "   "]})).toEqual([
			"tsh$ say [2Jhi|",
		]);
	});
});

describe("Ctrl-R, bash's reverse-i-search", () => {
	const history = ["seq --to 3", "say hi", "counter", "say there"];

	it("finds the newest line with what is typed, and Enter runs it", () => {
		expect(seen([keys("\x12say")], {history})).toEqual(["(reverse-i-search)`say': say there|"]);
		expect(seen([keys("\x12say\x12")], {history})).toEqual(["(reverse-i-search)`say': say hi|"]);
		expect(run([keys("\x12seq\r")], {history}).asked[0]).toBe("line seq --to 3");
	});

	it("gives back the line typed before on Ctrl-G or Ctrl-C", () => {
		expect(seen([keys("dou\x12say\x07")], {history})).toEqual(["tsh$ dou|"]);
		expect(seen([keys("dou\x12say\x03")], {history})).toEqual(["tsh$ dou|"]);
	});

	it("takes the line found to edit on another key, and that key goes on", () => {
		expect(seen([keys("\x12count\x01")], {history})).toEqual(["tsh$ |counter"]);
	});
});

describe("Tab", () => {
	it("puts in the one program that starts with what is typed, and a space", () => {
		expect(seen([keys("cou\t")])).toEqual(["tsh$ counter |"]);
	});

	it("puts in a flag of the program, from its schema", () => {
		expect(seen([keys("seq --t\t")])).toEqual(["tsh$ seq --to |"]);
	});

	it("puts in what several share, then lists them on the next Tab, as readline does", () => {
		const once = run([keys("s\t")]);
		expect(once.rows).toEqual(["tsh$ s"]);
		expect(once.bytes).toContain("\x07");
		const twice = seen([keys("s\t\t")]);
		expect(twice[0]).toBe("tsh$ s");
		expect(twice.slice(1, -1).join(" ").split(/\s+/)).toEqual(
			expect.arrayContaining(["say", "seq", "sleep"]),
		);
		expect(twice.at(-1)).toBe("tsh$ s|");
	});

	it("puts in a job by its number, from tsh's table", () => {
		const run1 = {program: "counter", flags: {}, run: "counter:1a2b", wire: null, ended: false};
		const jobs: Shell.Jobs = {
			jobs: [{n: 1, text: "counter &", stages: [run1], state: "running", background: true}],
			next: 2,
		};
		expect(seen([{type: "jobs", jobs}, keys("stop %\t")])).toEqual(["tsh$ stop %1 |"]);
	});

	it("leaves the text after the cursor where it is", () => {
		expect(seen([keys(" --to 3\x01cou\t")])).toEqual(["tsh$ counter | --to 3"]);
	});

	it("rings the bell when nothing fits", () => {
		const done = run([keys("zz\t")]);
		expect(done.rows).toEqual(["tsh$ zz"]);
		expect(done.bytes).toContain("\x07");
	});
});

describe("a line longer than the terminal is wide", () => {
	it("wraps, and the cursor still lands where it is in the line", () => {
		expect(seen([keys("say abcdefghij")], {cols: 10})).toEqual(["tsh$ say a", "bcdefghij|"]);
		expect(seen([keys("say abcdefghij\x01")], {cols: 10})).toEqual(["tsh$ |say a", "bcdefghij"]);
		expect(seen([keys("say abcdefghij\x01\x05")], {cols: 10})).toEqual([
			"tsh$ say a",
			"bcdefghij|",
		]);
	});

	it("draws a line that fills its row exactly with the cursor on the next row", () => {
		expect(seen([keys("say a")], {cols: 10})).toEqual(["tsh$ say a", "|"]);
		expect(seen([keys("say a\x7f")], {cols: 10})).toEqual(["tsh$ say |"]);
	});

	it("puts tsh's text above a wrapped line, and the line whole under it", () => {
		expect(seen([keys("say abcdefghij"), {type: "printed", text: "x"}], {cols: 10})).toEqual([
			"x",
			"tsh$ say a",
			"bcdefghij|",
		]);
	});

	it("leaves a wrapped line for a fresh row on Enter", () => {
		expect(
			seen([keys("say abcdefghij\x01\r"), {type: "printed", text: "abcdefghij"}, {type: "ready"}], {
				cols: 10,
			}),
		).toEqual(["tsh$ say a", "bcdefghij", "abcdefghij", "tsh$ |"]);
	});
});

describe("a redraw of a line that fits its row", () => {
	/** The bytes the last message wrote, and the run before and after it. */
	const last = (
		msgs: readonly EditorMsg[],
		opts: {history?: readonly string[]; cols?: number} = {},
	) => {
		const before = run(msgs.slice(0, -1), opts);
		const after = run(msgs, opts);
		return {before, after, wrote: after.bytes.slice(before.bytes.length)};
	};

	/** The prompt line a state shows, and where its cursor is, as the editor works it out. */
	const lineOf = (state: Editor, history: readonly string[], cols: number) => {
		const {mode} = state;
		if (mode.kind === "prompt") {
			const left = PROMPT + mode.line.left;
			return {text: left + mode.line.right, at: spot(left, cols)};
		}
		if (mode.kind === "search") {
			const text = Shell.Search.shown([...history].reverse(), mode.search);
			return {text, at: spot(text, cols)};
		}
		throw new Error(`no prompt line in ${mode.kind}`);
	};

	/**
	 * The screen after the last message, and the screen the old full redraw would leave in its
	 * place: back to the prompt's first cell, clear to the end of the screen, the line again.
	 */
	const both = (
		msgs: readonly EditorMsg[],
		opts: {history?: readonly string[]; cols?: number} = {},
	) => {
		const cols = opts.cols ?? 80;
		const {before, after, wrote} = last(msgs, opts);
		const was = lineOf(before.state, opts.history ?? [], cols);
		const now = lineOf(after.state, opts.history ?? [], cols);
		const full = back(was.at, cols) + draw(now.text, now.at, cols);
		const grid = (bytes: string) => {
			const {rows, cursor} = gridOf(bytes, cols);
			return {rows, cursor};
		};
		return {wrote, now: grid(after.bytes), old: grid(before.bytes + full)};
	};

	const history = ["seq --to 3", "say hi", "counter"];

	it("clears that row only, never to the end of the screen", () => {
		const {wrote} = last([keys("seq --to 3"), keys("\x7f")]);
		expect(wrote).toContain("\x1b[K");
		expect(wrote).not.toContain("\x1b[J");
		expect(seen([keys("seq --to 3"), keys("\x7f")])).toEqual(["tsh$ seq --to |"]);
	});

	it("leaves the screen the old full redraw left, for hand-picked edits", () => {
		const cases: readonly {msgs: readonly EditorMsg[]; history?: readonly string[]}[] = [
			// A letter, a Backspace and a Delete with the cursor in the middle of the line.
			{msgs: [keys("seq --to 3\x02\x02"), keys("x")]},
			{msgs: [keys("seq --to 3\x02\x02"), keys("\x7f")]},
			{msgs: [keys("seq --to 3\x01"), keys("\x1b[3~")]},
			// Ctrl-U and Ctrl-W, at the end and in the middle; Ctrl-U down to the prompt alone.
			{msgs: [keys("seq --to 3\x02\x02"), keys("\x15")]},
			{msgs: [keys("seq --to 3"), keys("\x15")]},
			{msgs: [keys("seq --to 3"), keys("\x17")]},
			{msgs: [keys("say hi there\x1bb"), keys("\x17")]},
			// The history: Up to a longer line, and Down back to a shorter one.
			{msgs: [keys("x"), keys("\x1b[A")], history},
			{msgs: [keys("\x1b[A\x1b[A"), keys("\x1b[B")], history},
			// Into a Ctrl-R search, and a letter in it.
			{msgs: [keys("dou"), keys("\x12")], history},
			{msgs: [keys("\x12sa"), keys("y")], history},
			// With text from tsh, and a Tab's list, above the prompt.
			{msgs: [keys("seq"), {type: "printed", text: "one\ntwo"}, keys("\x7f")]},
			{msgs: [keys("s\t\t"), keys("a")]},
		];
		for (const {msgs, history = []} of cases) {
			const {wrote, now, old} = both(msgs, {history});
			expect(wrote).not.toContain("\x1b[J");
			expect(now).toEqual(old);
		}
	});

	it("draws a line that grows onto a second row whole, and one that shrinks back to one row", () => {
		expect(last([keys("say "), keys("a")], {cols: 10}).wrote).toContain("\x1b[J");
		expect(seen([keys("say "), keys("a")], {cols: 10})).toEqual(["tsh$ say a", "|"]);
		expect(last([keys("say abcdefghij"), keys("k")], {cols: 10}).wrote).toContain("\x1b[J");
		expect(last([keys("say a"), keys("\x7f")], {cols: 10}).wrote).toContain("\x1b[J");
		expect(seen([keys("say a"), keys("\x7f")], {cols: 10})).toEqual(["tsh$ say |"]);
		expect(last([keys("say abcdefghij"), keys("\x15")], {cols: 10}).wrote).toContain("\x1b[J");
		expect(seen([keys("say abcdefghij"), keys("\x15")], {cols: 10})).toEqual(["tsh$ |"]);
	});

	it("draws a line with a wide character whole, as a terminal may wrap it where the editor does not", () => {
		expect(last([keys("say 漢字"), keys("x")]).wrote).toContain("\x1b[J");
		expect(last([keys("say 😀"), keys("x")]).wrote).toContain("\x1b[J");
		// Accents and other narrow letters past ASCII stay on the one-row path.
		expect(last([keys("say çok güzel"), keys("x")]).wrote).not.toContain("\x1b[J");
	});

	it("draws the line whole once after the width changes, then one row again", () => {
		const msgs: EditorMsg[] = [keys("say hi"), {type: "size", cols: 40}, keys("x")];
		expect(last(msgs).wrote).toContain("\x1b[J");
		expect(last([...msgs, keys("y")]).wrote).not.toContain("\x1b[J");
		// A size message with the same width changes nothing.
		const same: EditorMsg[] = [keys("say hi"), {type: "size", cols: 80}, keys("x")];
		expect(last(same).wrote).not.toContain("\x1b[J");
	});
});

describe("when tsh ends", () => {
	it("takes no more keys", () => {
		const done = run([keys("say hi\r"), {type: "ended"}, keys("say again\r")]);
		expect(done.asked).toEqual(["line say hi", "keep say hi"]);
		expect(done.state.mode).toEqual({kind: "ended"});
	});
});
