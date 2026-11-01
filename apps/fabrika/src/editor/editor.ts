import {defineMachine, noop} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Shell} from "@kampus/fabrika-old";
import {Schema} from "effect";
import {type Command, KILLS, keyOf, keysIn, printable} from "./keys.ts";
import {
	BELL,
	back,
	CLEAR,
	CLEAR_BELOW,
	columns,
	draw,
	fitsRow,
	NEWLINE,
	PROMPT,
	redrawRow,
	shown,
	spot,
	table,
} from "./screen.ts";

// tsh's line editor, as a tea machine: keys in, the bytes a terminal draws out. It is what
// readline is to bash: it owns the prompt line, and hands tsh a whole line on Enter. Pure, so a
// test folds keys through it with `replay` and reads the screen back (editor.test.ts).
//
//   replay(editor, {ctx, msgs: [{type: "keys", data: "cou\t"}]})
//   // writes "tsh$ counter ": Tab put in the one program that starts with "cou"
//   replay(editor, {ctx, msgs: [{type: "keys", data: "counter\r"}]})
//   // writes the line and a new row, and asks for `line {text: "counter"}`: tsh runs it
//
// Where it is:
//
//   prompt   the line is up; keys edit it (keys.ts names each, by readline's names)
//   search   Ctrl-R, bash's reverse-i-search, over the history (Shell.Search)
//   busy     tsh runs a line. Keys wait, as a terminal's type-ahead does, and go to the next
//            prompt; Ctrl-C goes to tsh at once and drops what waits, as a terminal's does.
//   ended    tsh is gone; keys go nowhere
//
// What it asks for, each a Cmd (the host runs them, host.ts):
//
//   write {data}        bytes to the terminal: one per step, in order
//   line {text}         a line for tsh
//   interrupt {}        Ctrl-C for tsh: it stops what runs in the foreground
//   close {}            Ctrl-D on an empty line: tsh's input ends, and tsh with it
//   keep {lines}        the history changed: keep it for the next start
//
// A text from tsh (`printed`) goes above the prompt: the prompt is taken away, the text written,
// and the prompt drawn again under it, as a shell does with a background job's output. A table
// from tsh (`table`) goes the same way, laid out at the terminal's width and in color first, as
// gh's printer asks its terminal for both.

/** The line: what is before the cursor, and what is after it. */
export interface Line {
	readonly left: string;
	readonly right: string;
}

/** A line from the history on the line: which one, counted from the newest (1), and what was typed before Up. */
export interface Recall {
	readonly back: number;
	readonly typed: Line;
}

export type Mode =
	| {readonly kind: "prompt"; readonly line: Line; readonly recall: Recall | null}
	| {readonly kind: "search"; readonly search: Shell.Search.Search; readonly typed: Line}
	| {readonly kind: "busy"; readonly ahead: readonly string[]}
	| {readonly kind: "ended"};

export interface Editor {
	readonly mode: Mode;
	/** Lines run, oldest first, each once: a line run again moves to the end, as readline's `erasedups` does. */
	readonly history: readonly string[];
	/** What Ctrl-Y puts back: the last kill, or kills in a row joined. */
	readonly killed: string;
	/** What the last key did: a second Tab lists, and kills in a row join. */
	readonly last: Command | null;
	/** The terminal's width, in cells. */
	readonly cols: number;
	/**
	 * The width changed since the prompt line was last redrawn. The terminal reflowed the line
	 * onto other rows, so the next redraw clears to the end of the screen, not of one row.
	 */
	readonly resized: boolean;
	/** tsh's job table, for `%1` on Tab. */
	readonly jobs: Shell.Jobs;
	/**
	 * The programs tsh knows, for Tab: handed in at the start, as Elm's flags are, and kept here
	 * because an update sees only the model. Never kept on disk, so it may hold more than data.
	 */
	readonly programs: Shell.ProgramList;
}

export type EditorMsg =
	/** What the terminal sent: keys, typed or pasted. */
	| {readonly type: "keys"; readonly data: string}
	/** The terminal's width changed. */
	| {readonly type: "size"; readonly cols: number}
	/** tsh printed a line. */
	| {readonly type: "printed"; readonly text: string}
	/** tsh printed a table for a person: laid out here, at the terminal's width, and in color. */
	| {readonly type: "table"; readonly table: Shell.Table}
	/** tsh is done with a line: the prompt comes back. */
	| {readonly type: "ready"}
	/** tsh is gone. */
	| {readonly type: "ended"}
	/** tsh's job table changed. */
	| {readonly type: "jobs"; readonly jobs: Shell.Jobs}
	/** An editor, this one or another tile's, kept its history: the lines every tile shares. */
	| {readonly type: "history"; readonly lines: readonly string[]};

/** What the editor is handed at the start: the programs tsh knows, for Tab, and the history kept from before. */
export interface EditorCtx {
	readonly programs: Shell.ProgramList;
	readonly history: readonly string[];
}

/** History lines kept, as bash's HISTSIZE: past it, the oldest go. */
export const KEPT = 1000;

const Done = Schema.Null;
export const write = Cmd.define("write", {
	input: Schema.Struct({data: Schema.String}),
	ok: Done,
	err: [],
});
export const line = Cmd.define("line", {
	input: Schema.Struct({text: Schema.String}),
	ok: Done,
	err: [],
});
export const interrupt = Cmd.define("interrupt", {input: Schema.Struct({}), ok: Done, err: []});
export const close = Cmd.define("close", {input: Schema.Struct({}), ok: Done, err: []});
export const keep = Cmd.define("keep", {
	input: Schema.Struct({lines: Schema.Array(Schema.String)}),
	ok: Done,
	err: [],
});

type EditorCmd =
	| ReturnType<typeof write>
	| ReturnType<typeof line>
	| ReturnType<typeof interrupt>
	| ReturnType<typeof close>
	| ReturnType<typeof keep>;

/** A step's output so far: bytes to write, and the other Cmds, in the order they were asked for. */
type Part = string | Exclude<EditorCmd, ReturnType<typeof write>>;

interface Acc {
	readonly s: Editor;
	readonly parts: readonly Part[];
}

const EMPTY: Line = {left: "", right: ""};
const prompt = (line: Line, recall: Recall | null = null): Mode => ({kind: "prompt", line, recall});

/** Only what a line can hold: a pasted tab or control character is left out, as fish does. */
const clean = (text: string): string => [...text].filter(printable).join("");

/** The editor at the start, with the history it was handed, cleaned. */
export const fresh = (ctx: EditorCtx): Editor => ({
	mode: prompt(EMPTY),
	history: ctx.history
		.map(clean)
		.filter((l) => l.trim() !== "")
		.slice(-KEPT),
	killed: "",
	last: null,
	cols: 80,
	resized: false,
	jobs: Shell.EMPTY,
	programs: ctx.programs,
});

/**
 * What the prompt line shows now, from the prompt's first cell, and where the cursor is in it at
 * the terminal's width (screen.ts). After a width change, that is where the terminal's reflow
 * put it.
 */
const shownLine = (s: Editor): {readonly text: string; readonly at: number} | null => {
	const {mode} = s;
	if (mode.kind === "prompt") {
		const before = PROMPT + mode.line.left;
		return {text: before + mode.line.right, at: spot(before, s.cols)};
	}
	if (mode.kind === "search") {
		const text = Shell.Search.shown(newestFirst(s.history), mode.search);
		return {text, at: spot(text, s.cols)};
	}
	return null;
};

const newestFirst = (history: readonly string[]): readonly string[] => [...history].reverse();

/** Back to the prompt's first cell, from where the cursor is in `s`. */
const backFrom = (s: Editor): string => {
	const now = shownLine(s);
	return now === null ? "" : back(now.at, s.cols);
};

/** The prompt line of `s`, drawn from the prompt's first cell. */
const drawn = (s: Editor): string => {
	const now = shownLine(s);
	return now === null ? "" : draw(now.text, now.at, s.cols);
};

/**
 * From `before`'s cursor to just after its line, as the terminal leaves it: on a line that fills
 * its last row, still on that row, waiting to wrap.
 */
const toEnd = (before: Editor): string => {
	const now = shownLine(before);
	return now === null ? "" : back(now.at, before.cols) + CLEAR_BELOW + now.text;
};

/** From `before`'s cursor to a fresh row under its line. */
const leave = (before: Editor): string =>
	shownLine(before) === null ? "" : toEnd(before) + NEWLINE;

const say = (acc: Acc, ...parts: readonly Part[]): Acc => ({
	...acc,
	parts: [...acc.parts, ...parts],
});

/**
 * Text from tsh, drawn above the prompt line: written where the cursor is when no prompt is up,
 * or, over the prompt, the prompt taken away, the text written, and the prompt drawn under it.
 */
const above = (s: Editor, text: string): Acc =>
	shownLine(s) === null
		? say(start(s), text)
		: say(start(s), backFrom(s) + CLEAR_BELOW + text + drawn(s));

/** The prompt line of `s`, if it is on one row of the screen, and stays there when drawn again. */
const inRow = (s: Editor): {readonly text: string; readonly at: number} | null => {
	const now = shownLine(s);
	return now !== null && !s.resized && fitsRow(now.text, s.cols) ? now : null;
};

/**
 * Move to `next`, drawing the prompt line again. A line on one row, before and after, is cleared
 * to the end of that row only, not of the screen: the terminal then draws one row, not every row
 * under the prompt (experiment 143). Any other line is drawn whole, below the prompt cleared.
 */
const redraw = (acc: Acc, next: Editor): Acc => {
	const after = inRow(next);
	const part =
		inRow(acc.s) !== null && after !== null
			? redrawRow(after.text, after.at)
			: backFrom(acc.s) + drawn(next);
	return {s: {...next, resized: false}, parts: [...acc.parts, part]};
};

const withMode = (s: Editor, mode: Mode): Editor => ({...s, mode});

// Words, as readline's word moves see them: letters and digits. unix-word-rubout's are cut at spaces.
const isWord = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string): boolean => c === " " || c === "\t";

/** Where the word before `at` starts: skip what is not a word, then the word. */
const wordBefore = (chars: readonly string[], at: number, inWord: (c: string) => boolean) => {
	let i = at;
	while (i > 0 && !inWord(chars[i - 1] ?? "")) i -= 1;
	while (i > 0 && inWord(chars[i - 1] ?? "")) i -= 1;
	return i;
};

/** Where the word after `at` ends. */
const wordAfter = (chars: readonly string[], at: number) => {
	let i = at;
	while (i < chars.length && !isWord(chars[i] ?? "")) i += 1;
	while (i < chars.length && isWord(chars[i] ?? "")) i += 1;
	return i;
};

/** The line cut at `at` characters, counted from its start. */
const cutAt = (chars: readonly string[], at: number): Line => ({
	left: chars.slice(0, at).join(""),
	right: chars.slice(at).join(""),
});

/** The longest start every candidate shares. */
const sharedStart = (all: readonly string[]): string => {
	const [first, ...rest] = all;
	if (first === undefined) return "";
	let shared = [...first];
	for (const c of rest) {
		const chars = [...c];
		let n = 0;
		while (n < shared.length && shared[n] === chars[n]) n += 1;
		shared = shared.slice(0, n);
	}
	return shared.join("");
};

/** The history with `text` run: at the end, and nowhere else. */
const remembered = (history: readonly string[], text: string): readonly string[] =>
	[...history.filter((h) => h !== text), text].slice(-KEPT);

/** Enter: the line goes to tsh, unless it is blank; then a fresh prompt, as bash gives one. */
const accept = (acc: Acc, text: string): Acc => {
	const {s} = acc;
	if (text.trim() === "") {
		const next = withMode(s, prompt(EMPTY));
		return say({...acc, s: next}, leave(s), drawn(next));
	}
	const history = remembered(s.history, text);
	return say(
		{...acc, s: {...s, mode: {kind: "busy", ahead: []}, history}},
		leave(s),
		line({text}),
		keep({lines: history}),
	);
};

/** A kill: the text goes to what Ctrl-Y puts back, joined to the last kill when that was the key before. */
const kill = (acc: Acc, recall: Recall | null, cut: string, next: Line, before: boolean): Acc => {
	const {s} = acc;
	const joined = s.last !== null && KILLS.has(s.last);
	const killed = !joined ? cut : before ? cut + s.killed : s.killed + cut;
	return redraw(acc, {...s, killed, mode: prompt(next, recall)});
};

/** One key, at the prompt. */
const atPrompt = (acc: Acc, mode: Extract<Mode, {kind: "prompt"}>, raw: string): Acc => {
	const {s} = acc;
	const key = keyOf(raw);
	const {left, right} = mode.line;
	const l = [...left];
	const r = [...right];
	const all = [...l, ...r];
	const edit = (next: Line) => redraw(acc, withMode(s, prompt(next, mode.recall)));
	const bell = () => say(acc, BELL);
	// A key readline has no command for (F12, say) does nothing, as fish's does: no bell, nothing put in.
	if (key.kind === "unknown") return acc;
	if (key.kind === "text") return edit({left: left + key.text, right});
	const cut = (text: string, next: Line, before: boolean) =>
		kill(acc, mode.recall, text, next, before);
	switch (key.command) {
		case "beginning-of-line":
			return edit({left: "", right: left + right});
		case "end-of-line":
			return edit({left: left + right, right: ""});
		case "backward-char":
			return l.length === 0 ? acc : edit(cutAt(all, l.length - 1));
		case "forward-char":
			return r.length === 0 ? acc : edit(cutAt(all, l.length + 1));
		case "backward-word":
			return edit(cutAt(all, wordBefore(all, l.length, isWord)));
		case "forward-word":
			return edit(cutAt(all, wordAfter(all, l.length)));
		case "backward-delete-char":
			return l.length === 0 ? bell() : edit({left: l.slice(0, -1).join(""), right});
		case "delete-char":
			return r.length === 0 ? acc : edit({left, right: r.slice(1).join("")});
		case "end-of-file":
			if (left + right !== "")
				return r.length === 0 ? acc : edit({left, right: r.slice(1).join("")});
			// Ctrl-D on an empty line: the end of tsh's input, as bash ends on it.
			return say({s: withMode(s, {kind: "ended"}), parts: acc.parts}, NEWLINE, close({}));
		case "kill-line":
			return cut(right, {left, right: ""}, false);
		case "unix-line-discard":
			return cut(left, {left: "", right}, true);
		case "unix-word-rubout": {
			const from = wordBefore(l, l.length, (c) => !isSpace(c));
			return cut(l.slice(from).join(""), {left: l.slice(0, from).join(""), right}, true);
		}
		case "backward-kill-word": {
			const from = wordBefore(l, l.length, isWord);
			return cut(l.slice(from).join(""), {left: l.slice(0, from).join(""), right}, true);
		}
		case "kill-word": {
			const to = wordAfter(all, l.length);
			return cut(all.slice(l.length, to).join(""), {left, right: all.slice(to).join("")}, false);
		}
		case "yank":
			return s.killed === "" ? acc : edit({left: left + s.killed, right});
		case "transpose-chars": {
			// readline's: the character before the cursor goes over the one under it; at the end, the last two swap.
			if (all.length < 2 || l.length === 0) return bell();
			const at = r.length === 0 ? l.length - 1 : l.length;
			const swapped = [...all];
			[swapped[at - 1], swapped[at]] = [all[at] ?? "", all[at - 1] ?? ""];
			return edit(cutAt(swapped, at + 1));
		}
		case "clear-screen":
			return say(acc, CLEAR + drawn(s));
		case "accept-line":
			return accept(acc, left + right);
		case "previous-history": {
			const back = (mode.recall?.back ?? 0) + 1;
			const found = s.history[s.history.length - back];
			if (found === undefined) return bell();
			return redraw(
				acc,
				withMode(
					s,
					prompt({left: found, right: ""}, {back, typed: mode.recall?.typed ?? mode.line}),
				),
			);
		}
		case "next-history": {
			if (mode.recall === null) return bell();
			const back = mode.recall.back - 1;
			if (back === 0) return redraw(acc, withMode(s, prompt(mode.recall.typed)));
			const found = s.history[s.history.length - back] ?? "";
			return redraw(acc, withMode(s, prompt({left: found, right: ""}, {...mode.recall, back})));
		}
		case "reverse-search-history":
			return redraw(
				acc,
				withMode(s, {kind: "search", search: Shell.Search.begin, typed: mode.line}),
			);
		case "complete":
			return completed(acc, mode);
		case "interrupt": {
			// Ctrl-C at the prompt: `^C` after the line, which is dropped, and a fresh prompt, as bash's.
			const next = withMode(s, prompt(EMPTY));
			return say({...acc, s: next}, toEnd(s), `^C${NEWLINE}`, drawn(next));
		}
	}
};

/**
 * Tab, as readline's `complete` does it: one candidate goes in whole, with a space after it
 * (none after `name=`, where a value follows); several put in what they share. A Tab that put
 * nothing in rings the bell; the next one lists them all, and the prompt comes back under them.
 */
const completed = (acc: Acc, mode: Extract<Mode, {kind: "prompt"}>): Acc => {
	const {s} = acc;
	const {left, right} = mode.line;
	const {candidates, word} = Shell.complete(left, s.programs, s.jobs);
	const stem = left.slice(0, left.length - word.length);
	const put = (text: string) =>
		redraw(acc, withMode(s, prompt({left: stem + text, right}, mode.recall)));
	const [only] = candidates;
	if (only === undefined) return say(acc, BELL);
	if (candidates.length === 1) return put(only.endsWith("=") ? only : `${only} `);
	const shared = sharedStart(candidates);
	if (shared.length > word.length) return put(shared);
	if (s.last !== "complete") return say(acc, BELL);
	return say(acc, leave(s), columns(candidates.map(clean), s.cols), drawn(s));
};

/** One key, in a Ctrl-R search. */
const inSearch = (acc: Acc, mode: Extract<Mode, {kind: "search"}>, raw: string): Acc => {
	const {s} = acc;
	const stepped = Shell.Search.step(newestFirst(s.history), mode.search, Shell.Search.keyOf(raw));
	if (stepped.kind === "searching")
		return redraw(acc, withMode(s, {...mode, search: stepped.search}));
	const found: Line = stepped.line === null ? mode.typed : {left: stepped.line, right: ""};
	const back = redraw(acc, withMode(s, prompt(found)));
	if (stepped.run) return accept(back, found.left + found.right);
	// The key that ended the search goes on, at the prompt, as bash hands it on.
	return stepped.replay === null ? back : step(back, stepped.replay);
};

/** One key, wherever the editor is. */
const step = (acc: Acc, raw: string): Acc => {
	const {mode} = acc.s;
	const key = keyOf(raw);
	const command = key.kind === "command" ? key.command : null;
	const after = (next: Acc): Acc => ({...next, s: {...next.s, last: command}});
	switch (mode.kind) {
		case "prompt":
			return after(atPrompt(acc, mode, raw));
		case "search":
			return after(inSearch(acc, mode, raw));
		case "busy":
			if (command === "interrupt")
				// A terminal's Ctrl-C drops what was typed ahead (POSIX: the input queue is flushed).
				return say(
					{...acc, s: withMode(acc.s, {kind: "busy", ahead: []})},
					`^C${NEWLINE}`,
					interrupt({}),
				);
			// Ctrl-D typed ahead would end tsh once the prompt is back: it is let go.
			if (command === "end-of-file") return acc;
			return {...acc, s: withMode(acc.s, {kind: "busy", ahead: [...mode.ahead, raw]})};
		case "ended":
			return acc;
	}
};

const keys = (acc: Acc, raw: readonly string[]): Acc => raw.reduce(step, acc);

/** The step's parts as Cmds: the bytes between two other Cmds written as one. */
const cmdsOf = (parts: readonly Part[]): readonly EditorCmd[] => {
	const cmds: EditorCmd[] = [];
	let data = "";
	for (const part of parts) {
		if (typeof part === "string") {
			data += part;
			continue;
		}
		if (data !== "") cmds.push(write({data}));
		data = "";
		cmds.push(part);
	}
	if (data !== "") cmds.push(write({data}));
	return cmds;
};

const done = (acc: Acc): readonly [Editor, readonly EditorCmd[]] => [acc.s, cmdsOf(acc.parts)];
const start = (s: Editor): Acc => ({s, parts: []});

export const editor = defineMachine({
	types: {model: {} as Editor, msg: {} as EditorMsg, ctx: {} as EditorCtx},
	cmds: [write, line, interrupt, close, keep],
	init: (_loaded, ctx) => {
		const s = fresh(ctx);
		return [s, [write({data: drawn(s)})]];
	},
	update: {
		keys: (s, m) => done(keys(start(s), keysIn(m.data))),
		size: (s, m) => {
			const cols = Math.max(1, m.cols);
			return [{...s, cols, resized: s.resized || cols !== s.cols}, []];
		},
		printed: (s, m) => done(above(s, shown(m.text) + NEWLINE)),
		table: (s, m) => done(above(s, table(m.table, s.cols) + NEWLINE)),
		ready: (s) => {
			if (s.mode.kind !== "busy") return done(start(s));
			// The prompt, then what was typed ahead, as if typed at it.
			const up = withMode(s, prompt(EMPTY));
			return done(keys(say(start(up), drawn(up)), s.mode.ahead));
		},
		ended: (s) =>
			done(say(start(withMode(s, {kind: "ended"})), shownLine(s) === null ? "" : leave(s))),
		jobs: (s, m) => [{...s, jobs: m.jobs}, []],
		// Taken as it is: the lines came from an editor's `keep`, cleaned there already.
		history: (s, m) => [{...s, history: m.lines.slice(-KEPT)}, []],
		write_ok: noop,
		write_err: noop,
		line_ok: noop,
		line_err: noop,
		interrupt_ok: noop,
		interrupt_err: noop,
		close_ok: noop,
		close_err: noop,
		keep_ok: noop,
		keep_err: noop,
	},
});
