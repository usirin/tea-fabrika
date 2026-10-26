import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {applyCell, replay} from "@demlik/tea";
import {arbConstantMsg, arbMsg, arbRecordMsg, type MsgArbitraryTable} from "@demlik/tea/pbt";
import {listed, Shell} from "@kampus/fabrika";
import {counter} from "@tea-fabrika/counter";
import {Layer} from "effect";
import fc from "fast-check";
import {Ghostty, type GhosttyTerminal} from "ghostty-web";
import {beforeAll, describe, expect, it, vi} from "vitest";
import type {
	close,
	Editor,
	EditorCtx,
	EditorMsg,
	editor,
	interrupt,
	keep,
	line,
	write,
} from "./editor.ts";
import {gridOf} from "./grid.ts";
import * as screen from "./screen.ts";

// The line editor's redraw, as laws: property tests on fast-check, over two terminals.
//
//   the test grid (grid.ts)   counts one cell per code point, as the editor does
//   ghostty                   ghostty-web's own terminal, the one the app draws with, run here
//                             without a window: it knows real widths and reflows on a resize
//
// The reference is the editor as it was before the one-row redraw: the same code with `fitsRow`
// always false, so every redraw takes the old path (back to the prompt, clear below, draw). Each
// law is seen to fail once, on a plant: the real editor with one function of screen.ts swapped
// for a broken copy (vi.doMock), or with one field of its state dropped.
//
// The wasm file is read with node:fs: a test's thin edge, where Effect's FileSystem buys nothing.

type Screen = typeof screen;
type Machine = typeof editor;
type Out =
	| ReturnType<typeof write>
	| ReturnType<typeof line>
	| ReturnType<typeof interrupt>
	| ReturnType<typeof close>
	| ReturnType<typeof keep>;

/** An editor to test: where it starts, one message, and the fit check it uses. */
interface Variant {
	readonly start: (ctx: EditorCtx) => readonly [Editor, string];
	readonly step: (s: Editor, m: EditorMsg) => readonly [Editor, string];
	readonly fits: (text: string, cols: number) => boolean;
}

const bytesOf = (cmds: readonly Out[]): string =>
	cmds.flatMap((c) => (c.type === "write" ? [c.data] : [])).join("");

const variantOf = (machine: Machine, fits: Screen["fitsRow"] = screen.fitsRow): Variant => ({
	start: (ctx) => {
		const r = replay(machine, {ctx, msgs: []});
		return [r.state, bytesOf(r.cmds)];
	},
	step: (s, m) => {
		const [next, cmds] = applyCell<Editor, EditorMsg, Out>(machine, s, m);
		return [next, bytesOf(cmds)];
	},
	fits,
});

/** A fresh copy of editor.ts, with some of screen.ts swapped. */
const editorWith = async (patch: Partial<Screen>): Promise<Machine> => {
	vi.resetModules();
	vi.doMock("./screen.ts", async (real) => ({...(await real<Screen>()), ...patch}));
	try {
		return (await import("./editor.ts")).editor;
	} finally {
		vi.doUnmock("./screen.ts");
	}
};

const CSI = "\x1b[";
const right = (n: number) => (n > 0 ? `${CSI}${n}C` : "");
const narrow = (text: string) => [...text].every((c) => (c.codePointAt(0) ?? 0) < 0x1100);

/** The laws, by name. */
const N = {
	sameGrid: "the same screen as the old redraw, on the test grid",
	sameGhostty: "the same screen as the old redraw, on ghostty",
	rowPath: "the row path runs when the line fits, and only then",
	leftoversGrid: "no leftovers, on the test grid",
	leftoversGhostty: "no leftovers, on ghostty",
	resize: "the first redraw after a width change is a full one",
	fits: "what fitsRow lets through fits its row on ghostty",
	sequences: "every sequence the editor writes is one the test grid knows",
} as const;

/** The plants: each a broken copy of one piece of the change, and the laws that catch it. */
const PLANTS = {
	"the row redraw does not erase the row": {
		patch: {redrawRow: (text: string, at: number) => `\r${text}\r${right(at)}`},
		by: [N.sameGrid, N.leftoversGrid, N.leftoversGhostty],
	},
	"the row redraw leaves the cursor at the end": {
		patch: {redrawRow: (text: string, _at: number) => `\r${CSI}K${text}`},
		by: [N.sameGrid, N.sameGhostty, N.leftoversGhostty],
	},
	"the row redraw erases with CSI 2K, which the test grid does not know": {
		patch: {redrawRow: (text: string, at: number) => `\r${CSI}2K${text}\r${right(at)}`},
		by: [N.sequences],
	},
	"no line ever takes the row path": {
		patch: {fitsRow: () => false},
		by: [N.rowPath],
	},
	"a line that fills its row counts as fitting": {
		patch: {
			fitsRow: (text: string, cols: number) => screen.cells(text) <= cols && narrow(text),
		},
		by: [N.sameGhostty, N.leftoversGrid, N.leftoversGhostty],
	},
	"every line fits": {
		patch: {fitsRow: () => true},
		by: [N.sameGrid, N.rowPath, N.leftoversGrid],
	},
	"no guard for wide characters": {
		patch: {fitsRow: (text: string, cols: number) => screen.cells(text) < cols},
		by: [N.rowPath, N.fits],
	},
} as const satisfies Record<string, {patch: Partial<Screen>; by: readonly string[]}>;

/** A plant on the editor's state, not on screen.ts: a width change is never noted. */
const RESIZE_FORGOTTEN = "a width change is forgotten";
const RESIZE_BY: readonly string[] = [N.resize];

let real: Variant;
let old: Variant;
const planted = new Map<string, Variant>();
let ghostty: Ghostty;

beforeAll(async () => {
	const wasm = readFileSync(createRequire(import.meta.url).resolve("ghostty-web/ghostty-vt.wasm"));
	const compiled = await WebAssembly.compile(wasm);
	freshGhostty = () => new Ghostty(new WebAssembly.Instance(compiled, {env: {log: () => {}}}));
	ghostty = freshGhostty();
	real = variantOf(await editorWith({}));
	old = variantOf(await editorWith({fitsRow: () => false}), () => false);
	for (const [name, {patch}] of Object.entries(PLANTS))
		planted.set(
			name,
			variantOf(await editorWith(patch), "fitsRow" in patch ? patch.fitsRow : screen.fitsRow),
		);
	planted.set(RESIZE_FORGOTTEN, {
		...real,
		step: (s, m) => {
			const [next, out] = real.step(s, m);
			return [{...next, resized: false}, out];
		},
	});
});

// --- Two terminals ---

/** What a terminal shows: its rows, with no blank rows at the end, and the cursor. */
interface Seen {
	readonly rows: readonly string[];
	readonly cursor: {readonly row: number; readonly col: number};
}

interface Term {
	readonly write: (bytes: string) => void;
	readonly resize: (cols: number) => void;
	readonly seen: () => Seen;
	readonly free: () => void;
}

type Kind = "grid" | "ghostty";

const HEIGHT = 24;

const trimmed = (rows: readonly string[]): readonly string[] => {
	const r = [...rows];
	while (r.length > 0 && r[r.length - 1] === "") r.pop();
	return r;
};

const gridTerm = (cols: number): Term => {
	let bytes = "";
	return {
		write: (b) => {
			bytes += b;
		},
		resize: (to) => {
			if (to !== cols) throw new Error("test setup: the test grid keeps one width");
		},
		seen: () => {
			const {rows, cursor} = gridOf(bytes, cols, HEIGHT);
			return {rows: trimmed(rows), cursor};
		},
		free: () => {},
	};
};

// ghostty-web 0.4.0 in one WebAssembly memory, as seen here (2026-10-25):
//
//   a terminal made after one was freed     shows the freed one's rows
//   a terminal reset (RIS), then used again  sometimes shows other memory as made-up code points
//   about 800 terminals                     the memory is full (4 GB): no more can be made
//
// So every terminal is new, and is never freed or used again. After a fixed number of them, the
// next one goes into a new WebAssembly memory, and the old memory is dropped whole.

/** A new WebAssembly memory, with nothing in it yet. */
let freshGhostty: () => Ghostty;

/** Terminals made in one memory before the next memory: well under the 800 that fill it. */
const PER_MEMORY = 200;
let memory: {readonly ghostty: Ghostty; made: number} | null = null;

/** A new terminal, in a memory that has room for it. */
const newTerminal = (cols: number): GhosttyTerminal => {
	if (memory === null || memory.made >= PER_MEMORY) memory = {ghostty: freshGhostty(), made: 0};
	memory.made += 1;
	return memory.ghostty.createTerminal(cols, HEIGHT);
};

/**
 * A ghostty terminal, read back as text. A cell with combining marks gets one `+` per mark, as its
 * marks are not read back. Only the rows on screen count: on a width change ghostty pushes blank
 * rows into its scrollback, which a fresh terminal does not have.
 */
const ghosttyTerm = (cols: number): Term => {
	const t = newTerminal(cols);
	return {
		// ghostty-web 0.4.0 throws on an empty write: its zero-byte buffer sits past the end of memory.
		write: (b) => {
			if (b !== "") t.write(b);
		},
		resize: (to) => {
			if (to !== t.cols) t.resize(to, HEIGHT);
		},
		seen: () => {
			const rows: string[] = [];
			for (let y = 0; y < HEIGHT; y += 1) {
				let text = "";
				for (const c of t.getLine(y) ?? []) {
					// The second cell of a wide character is empty and has no width of its own.
					if (c.codepoint === 0) text += c.width === 0 ? "" : " ";
					else text += String.fromCodePoint(c.codepoint) + "+".repeat(c.grapheme_len);
				}
				rows.push(text.trimEnd());
			}
			const {x, y} = t.getCursor();
			return {rows: trimmed(rows), cursor: {row: y, col: x}};
		},
		// Dropped with its memory: freeing it would leave its rows to the next terminal made.
		free: () => {},
	};
};

const termOf = (kind: Kind, cols: number): Term =>
	kind === "grid" ? gridTerm(cols) : ghosttyTerm(cols);

const same = (a: Seen, b: Seen): boolean => JSON.stringify(a) === JSON.stringify(b);
const showSeen = (s: Seen): string => JSON.stringify(s);

// --- Cases: a width, a history, and messages ---

const programs = Shell.programList([...Shell.SMALL, listed(counter, Layer.empty)]);

/** Narrow letters, some past ASCII. Program names' letters, so Tab finds something. */
const NARROW = [..."aesyqountrc- ", "é", "ç", "ğ", "ü", "Ω"];
/** Characters at or past U+1100 that a terminal draws two cells wide. */
const WIDE = ["漢", "字", "가", "😀", "ᄀ"];
/** Below U+1100, but not one cell each: a combining mark takes none; © with U+FE0F takes two. */
const ODD = ["́", "̈", "©", "️"];

/** The keys that edit the line in place, by readline's emacs names (keys.ts). */
const EDITS = [
	"\x7f", // Backspace
	`${CSI}3~`, // Delete
	"\x01", // Ctrl-A
	"\x05", // Ctrl-E
	"\x02", // Ctrl-B
	"\x06", // Ctrl-F
	`${CSI}D`,
	`${CSI}C`,
	"\x1bb", // Alt-B
	"\x1bf", // Alt-F
	"\x1bd", // Alt-D
	"\x1b\x7f", // Alt-Backspace
	"\x0b", // Ctrl-K
	"\x15", // Ctrl-U
	"\x17", // Ctrl-W
	"\x19", // Ctrl-Y
	"\x14", // Ctrl-T
	`${CSI}A`, // Up
	`${CSI}B`, // Down
	"\x12", // Ctrl-R
	"\x07", // Ctrl-G: leaves a search
	"\x1b", // Esc
	`${CSI}24~`, // F12: nothing
];

/** The keys that write more than the prompt line: Enter, Tab, Ctrl-L, Ctrl-C, Ctrl-D. */
const LEAVES = ["\r", "\t", "\x0c", "\x03", "\x04"];

const textOf = (chars: readonly string[], maxLength: number) =>
	fc.string({unit: fc.constantFrom(...chars), minLength: 1, maxLength});

const editKey = (chars: readonly string[]) =>
	fc.oneof(
		{arbitrary: textOf(chars, 8), weight: 3},
		{arbitrary: fc.constantFrom(...EDITS), weight: 5},
	);

interface Case {
	readonly cols: number;
	readonly history: readonly string[];
	readonly msgs: readonly EditorMsg[];
}

const keysMsg = (data: fc.Arbitrary<string>) => data.map((d) => ({type: "keys", data: d}) as const);

/**
 * A case: a width from 8 to 32 cells, so lines wrap often, a history with long and short lines,
 * and up to 30 messages from `msgs`, which is handed the width.
 */
const caseOf = (chars: readonly string[], msgs: (cols: number) => fc.Arbitrary<EditorMsg>) =>
	fc
		.record({
			cols: fc.integer({min: 8, max: 32}),
			history: fc.array(textOf(chars, 30), {maxLength: 4}),
		})
		.chain(({cols, history}) =>
			fc.array(msgs(cols), {maxLength: 30}).map((m): Case => ({cols, history, msgs: m})),
		);

/** Only keys that edit the line in place. */
const editsOnly = (chars: readonly string[]) => caseOf(chars, () => keysMsg(editKey(chars)));

/** Keys that edit the line, and width changes. */
const editsAndResizes = (chars: readonly string[]) =>
	caseOf(chars, () =>
		fc.oneof(
			{arbitrary: keysMsg(editKey(chars)), weight: 4},
			{
				arbitrary: fc.integer({min: 8, max: 32}).map((c): EditorMsg => ({type: "size", cols: c})),
				weight: 1,
			},
		),
	);

/**
 * Every message the editor takes, one generator for each (tea's strict table). On the test grid
 * a size message keeps the width, as the grid cannot change it: that is the rule that a size
 * message with the same width changes nothing.
 */
const everything = (chars: readonly string[], resize: boolean) =>
	caseOf(chars, (cols) => {
		const table: MsgArbitraryTable<EditorMsg> = {
			keys: keysMsg(
				fc.oneof(
					{arbitrary: editKey(chars), weight: 8},
					{arbitrary: fc.constantFrom(...LEAVES), weight: 1},
				),
			),
			size: arbRecordMsg("size", {
				cols: resize ? fc.integer({min: 8, max: 32}) : fc.constant(cols),
			}),
			printed: arbRecordMsg("printed", {
				text: fc.string({unit: fc.constantFrom(...chars, "\n", "\x07"), maxLength: 20}),
			}),
			ready: arbConstantMsg("ready"),
			ended: arbConstantMsg("ended"),
			jobs: arbRecordMsg("jobs", {jobs: fc.constant(Shell.EMPTY)}),
			history: arbRecordMsg("history", {lines: fc.array(textOf(chars, 30), {maxLength: 3})}),
		};
		return arbMsg(table, {
			weights: {keys: 20, size: 2, printed: 2, ready: 3, ended: 1, jobs: 1, history: 1},
		});
	});

// --- Playing a case ---

interface Moment {
	readonly msg: EditorMsg;
	readonly before: Editor;
	readonly after: Editor;
	readonly out: string;
}

/**
 * Fold the case through `v`, after the size message a host sends first, writing to `term` if
 * given. `visit` sees each message; the first reason it gives ends the walk.
 */
const walk = (
	v: Variant,
	c: Case,
	term: Term | null,
	visit: (m: Moment) => string | null,
): string | null => {
	let [s, out] = v.start({programs, history: c.history});
	term?.write(out);
	for (const msg of [{type: "size", cols: c.cols} as const, ...c.msgs]) {
		const before = s;
		[s, out] = v.step(s, msg);
		if (msg.type === "size") term?.resize(Math.max(1, msg.cols));
		term?.write(out);
		const why = visit({msg, before, after: s, out});
		if (why !== null) return why;
	}
	return null;
};

const keysOf = (data: string): EditorMsg => ({type: "keys", data});

/** What ghostty shows after the whole case, through `v`. */
const screenAfter = (v: Variant, c: Case): Seen => {
	const t = termOf("ghostty", c.cols);
	walk(v, c, t, () => null);
	const seen = t.seen();
	t.free();
	return seen;
};

/** What the prompt line shows, and where the cursor is in it, worked out apart from the editor. */
const lineOf = (s: Editor): {readonly text: string; readonly at: number} | null => {
	const {mode} = s;
	if (mode.kind === "prompt") {
		const left = screen.PROMPT + mode.line.left;
		return {text: left + mode.line.right, at: screen.cells(left)};
	}
	if (mode.kind === "search") {
		const text = Shell.Search.shown([...s.history].reverse(), mode.search);
		return {text, at: screen.cells(text)};
	}
	return null;
};

/**
 * What a terminal of `kind` should show with only this line on it: the rows the text takes, and
 * the cursor just after the first `at` characters, as this terminal lays them out, not as `cells`
 * counts them. A line that fills its row to the end puts the cursor on the next row, as the editor
 * does (screen.ts): found by writing one more letter and seeing it go there.
 */
const freshly = (kind: Kind, cols: number, text: string, at: number): Seen => {
	const t = termOf(kind, cols);
	t.write(text);
	const {rows} = t.seen();
	t.free();
	const u = termOf(kind, cols);
	u.write([...text].slice(0, at).join(""));
	const {cursor} = u.seen();
	u.write("x");
	const next = u.seen().cursor;
	u.free();
	return {rows, cursor: next.row > cursor.row ? {row: cursor.row + 1, col: 0} : cursor};
};

/** Whether the old redraw wrote just this: back to the prompt, clear below, the line again. */
const oldRedraw = (m: Moment): {readonly out: string; readonly pure: boolean} => {
	const [, out] = old.step(m.before, m.msg);
	const was = lineOf(m.before);
	const now = lineOf(m.after);
	const pure =
		m.msg.type === "keys" &&
		was !== null &&
		now !== null &&
		out === screen.back(was.at, m.before.cols) + screen.draw(now.text, now.at, m.after.cols);
	return {out, pure};
};

const shown = (m: Moment) => JSON.stringify(m.msg);

// --- The laws ---

interface Law {
	readonly name: string;
	/** The first broken case `v` gives, and why; `null`: the law held. */
	readonly broken: (
		v: Variant,
		quick: boolean,
	) => {readonly c: unknown; readonly why: string} | null;
}

const RUNS = 150;

const lawOf = <C>(
	name: string,
	cases: fc.Arbitrary<C>,
	check: (v: Variant, c: C) => string | null,
	runs = RUNS,
): Law => ({
	name,
	broken: (v, quick) => {
		// The reason of the last failing run: fast-check shrinks from the last failure, so it is the
		// counterexample's.
		let why = "";
		const r = fc.check(
			fc.property(cases, (c) => {
				const found = check(v, c);
				if (found !== null) why = found;
				return found === null;
			}),
			{seed: 101, numRuns: runs, endOnFailure: quick},
		);
		if (!r.failed || r.counterexample === null) return null;
		const [c] = r.counterexample;
		// The terminals keep no state between cases: the counterexample fails again on its own.
		if (check(v, c) === null) throw new Error(`${name}: a case failed once and then held`);
		return {c, why: why || String(r.errorInstance)};
	},
});

/** After every message, `v` and the old editor leave the same cells and the same cursor. */
const sameScreen = (kind: Kind, cases: fc.Arbitrary<Case>) =>
	lawOf(kind === "grid" ? N.sameGrid : N.sameGhostty, cases, (v, c) => {
		const theirs = termOf(kind, c.cols);
		const theirSeen: Seen[] = [];
		walk(old, c, theirs, () => {
			theirSeen.push(theirs.seen());
			return null;
		});
		theirs.free();
		const ours = termOf(kind, c.cols);
		let n = 0;
		const why = walk(v, c, ours, (m) => {
			const a = ours.seen();
			const b = theirSeen[n];
			n += 1;
			return b === undefined || same(a, b)
				? null
				: `after ${shown(m)}: ${showSeen(a)}, the old redraw: ${showSeen(b)}`;
		});
		ours.free();
		return why;
	});

/**
 * A key whose line fits its row before and after, with no character that may be wide and no
 * width change since the last redraw, never clears below. Any other redraw is the old one, byte
 * for byte. Bytes only: no terminal.
 */
const rowPathWhenSafe = lawOf(N.rowPath, everything([...NARROW, ...WIDE], true), (v, c) =>
	walk(v, c, null, (m) => {
		const {out, pure} = oldRedraw(m);
		if (!pure) return null;
		const was = lineOf(m.before);
		const now = lineOf(m.after);
		if (was === null || now === null) return null;
		const fits = (t: string) => screen.cells(t) < m.before.cols && narrow(t);
		const safe = !m.before.resized && fits(was.text) && fits(now.text);
		if (safe && m.out.includes(`${CSI}J`)) return `after ${shown(m)}: fits, but cleared below`;
		if (!safe && m.out !== out)
			return `after ${shown(m)}: does not surely fit, but wrote ${JSON.stringify(m.out)}`;
		return null;
	}),
);

/**
 * After any keys that edit the line, the screen holds the line and nothing else: what a fresh
 * terminal shows with only this line drawn on it. With width changes, only on ghostty, which
 * reflows the line (see the known bug).
 */
const noLeftovers = (name: string, kind: Kind, cases: fc.Arbitrary<Case>) =>
	lawOf(name, cases, (v, c) => {
		const t = termOf(kind, c.cols);
		let cols = c.cols;
		const why = walk(v, c, t, (m) => {
			if (m.msg.type === "size") {
				cols = Math.max(1, m.msg.cols);
				return null;
			}
			const now = lineOf(m.after);
			if (now === null) return null;
			const seen = t.seen();
			const want = freshly(kind, cols, now.text, now.at);
			return same(seen, want)
				? null
				: `after ${shown(m)} at ${cols} cells: ${showSeen(seen)}, the line alone: ${showSeen(want)}`;
		});
		t.free();
		return why;
	});

/** After a width change, the first redraw is the old full one, byte for byte. */
const afterResize = lawOf(N.resize, editsAndResizes([...NARROW, ...WIDE]), (v, c) => {
	let changed = false;
	return walk(v, c, null, (m) => {
		if (m.msg.type === "size") {
			changed ||= Math.max(1, m.msg.cols) !== m.before.cols;
			return null;
		}
		const {out, pure} = oldRedraw(m);
		if (!pure) {
			// Two redraws in one message (a search left with a key that edits): not checked, but
			// the first of them was the full one.
			if (out.includes(`${CSI}J`)) changed = false;
			return null;
		}
		const first = changed;
		changed = false;
		return first && m.out !== out
			? `after ${shown(m)}, the first redraw at ${m.after.cols} cells: ${JSON.stringify(m.out)}, not the full ${JSON.stringify(out)}`
			: null;
	});
});

/** How many cells ghostty gives a text: where its cursor ends, on a row wide enough for it. */
const widthOn = (() => {
	let wide: GhosttyTerminal | null = null;
	return (text: string): number => {
		wide ??= ghostty.createTerminal(500, 2);
		wide.write(`${CSI}H${CSI}2J${text}`);
		return wide.getCursor().x;
	};
})();

/** A line `fits` lets onto the row path is narrower than its row on ghostty, with a cell to spare for the cursor. */
const fitsOnGhostty = lawOf(
	N.fits,
	fc.record({
		cols: fc.integer({min: 8, max: 32}),
		text: fc.string({unit: fc.constantFrom(...NARROW, ...WIDE, ...ODD), maxLength: 30}),
	}),
	(v, {cols, text}) => {
		const line = screen.PROMPT + text;
		if (!v.fits(line, cols)) return null;
		const width = widthOn(line);
		return width < cols
			? null
			: `${JSON.stringify(line)} fits ${cols} cells, but ghostty gives it ${width}`;
	},
	500,
);

const KNOWN = [`${CSI}J`, `${CSI}K`, `${CSI}H`, `${CSI}2J`];

/** Where in `out` an escape sequence starts that is none the test grid knows; -1: none. */
const unknownAt = (out: string): number => {
	for (let i = out.indexOf("\x1b"); i !== -1; i = out.indexOf("\x1b", i + 1)) {
		const rest = out.slice(i);
		const move = rest.startsWith(CSI) && /^\d*[AC]/.test(rest.slice(CSI.length));
		if (!move && !KNOWN.some((k) => rest.startsWith(k))) return i;
	}
	return -1;
};

/**
 * Every escape sequence the editor writes is one the test grid knows, so no other law is blind to
 * one: none shows on the grid as `^[[`. Typed and printed text holds no `^` or ESC here, so a `^[[`
 * could only come from the editor.
 */
const knownSequences = lawOf(N.sequences, everything(NARROW, false), (v, c) => {
	const t = gridTerm(c.cols);
	const why = walk(v, c, t, (m) => {
		const at = unknownAt(m.out);
		if (at !== -1) return `after ${shown(m)}: ${JSON.stringify(m.out.slice(at, at + 8))}`;
		const seen = t.seen();
		return seen.rows.some((r) => r.includes("^[[") || r.includes("\x1b"))
			? `after ${shown(m)}: ${showSeen(seen)}`
			: null;
	});
	return why;
});

const LAWS: readonly Law[] = [
	sameScreen("grid", everything([...NARROW, ...WIDE], false)),
	sameScreen("ghostty", everything([...NARROW, ...WIDE, ...ODD], true)),
	rowPathWhenSafe,
	noLeftovers(N.leftoversGrid, "grid", editsOnly([...NARROW, ...WIDE])),
	noLeftovers(N.leftoversGhostty, "ghostty", editsOnly(NARROW)),
	afterResize,
	fitsOnGhostty,
	knownSequences,
];

describe("the line editor's redraw, as laws", () => {
	for (const law of LAWS)
		it(law.name, () => {
			expect(law.broken(real, false)).toBeNull();
		});
});

describe("characters that are not one cell", () => {
	it("ghostty gives no printable code point below U+1100 two cells, the guard's premise", () => {
		const widths = new Map<number, number>();
		for (let cp = 0x20; cp < 0x1100; cp += 1) {
			if (cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) continue;
			const w = widthOn(`ab${String.fromCodePoint(cp)}`) - 2;
			widths.set(w, (widths.get(w) ?? 0) + 1);
		}
		expect(widths.get(2) ?? 0).toBe(0);
		// Combining marks and the like: no cell at all. `cells` counts each as one.
		expect(widths.get(0)).toBeGreaterThan(0);
	});

	// KNOWN BUG, from before this change and on the old path too: `cells` counts a code point as one
	// cell, so a combining mark (no cell) or a wide character (two) puts the cursor, and a redraw's
	// way back to the prompt, off on a real terminal. This test holds the bug in place: when it is
	// fixed, it fails, and the law moves up with the others.
	const oddWidths = noLeftovers(
		"known bug: the line alone on ghostty, with wide characters and combining marks",
		"ghostty",
		editsOnly([...NARROW, ...WIDE, ...ODD]),
	);

	it("known bug: a line with a combining mark or a wide character is drawn wrong on ghostty, on both paths", () => {
		expect(oddWidths.broken(real, false)).not.toBeNull();
		expect(oddWidths.broken(old, false)).not.toBeNull();
	});
});

describe("a width change", () => {
	// KNOWN BUG, from before this change and on the old path too: after a width change the editor
	// and ghostty stop agreeing on the cursor's row. The first redraw after it is the full one (the
	// law above), and goes back to the prompt with `back`, which counts rows at the new width. That
	// is right only where ghostty moved the cursor with the text, and it does not always:
	//
	//   a line that fills its row      the editor ends it with a hard "\r\n" (screen.ts), which
	//                                  no terminal reflows: the cursor stays a row below
	//   the cursor after the line's    ghostty-web 0.4.0 reflows the text, but does not put the
	//   end, as when typing            cursor where the line now ends
	//
	// One row too few draws the line again under the old one. One too many goes up into the row
	// above the prompt and clears from there: a program's last line of output is gone.
	const resized = noLeftovers(
		"known bug: the line alone after a width change, on ghostty",
		"ghostty",
		editsAndResizes(NARROW),
	);
	const caseOfMsgs = (cols: number, msgs: readonly EditorMsg[]): Case => ({
		cols,
		history: [],
		msgs,
	});

	it("known bug: the screen is wrong after a width change, on both paths", () => {
		expect(resized.broken(real, false)).not.toBeNull();
		expect(resized.broken(old, false)).not.toBeNull();
		// A line that filled its row at 8 cells, then 9 cells and Backspace: drawn twice.
		const twice = caseOfMsgs(8, [keysOf("aaa"), {type: "size", cols: 9}, keysOf("\x7f")]);
		expect(screenAfter(real, twice)).toEqual({
			rows: ["tsh$ aaa", "tsh$ aa"],
			cursor: {row: 1, col: 7},
		});
		expect(screenAfter(old, twice)).toEqual(screenAfter(real, twice));
		// Output, then a line that fills the row once the width is 8, then Backspace: the output is gone.
		const gone = caseOfMsgs(32, [
			{type: "printed", text: "out"},
			keysOf("aaa"),
			{type: "size", cols: 8},
			keysOf("\x7f"),
		]);
		expect(screenAfter(real, gone)).toEqual({rows: ["tsh$ aa"], cursor: {row: 0, col: 7}});
		expect(screenAfter(old, gone)).toEqual(screenAfter(real, gone));
		// Output, a line typed at 32 cells, then 8 cells, where it wraps, and Backspace.
		const typed = caseOfMsgs(32, [
			{type: "printed", text: "out"},
			keysOf("hello world"),
			{type: "size", cols: 8},
			keysOf("\x7f"),
		]);
		expect(screenAfter(real, typed)).toEqual({
			rows: ["tsh$ hel", "lo worl"],
			cursor: {row: 1, col: 7},
		});
		expect(screenAfter(old, typed)).toEqual(screenAfter(real, typed));
	});
});

describe("every plant", () => {
	const names = [...Object.keys(PLANTS), RESIZE_FORGOTTEN];
	const target = (name: string): readonly string[] =>
		name === RESIZE_FORGOTTEN ? RESIZE_BY : (PLANTS[name as keyof typeof PLANTS]?.by ?? []);

	it.each(names)("is caught by the laws it is planted for: %s", (name) => {
		const v = planted.get(name);
		if (v === undefined) throw new Error(`test setup: no plant "${name}"`);
		const laws = target(name).map((n) => LAWS.find((l) => l.name === n));
		expect(laws.includes(undefined)).toBe(false);
		const held = laws.filter((l) => l !== undefined && l.broken(v, true) === null);
		expect(held.map((l) => l?.name)).toEqual([]);
	});

	it("breaks every law at least once", () => {
		const aimed = new Set(names.flatMap(target));
		expect(LAWS.map((l) => l.name).filter((n) => !aimed.has(n))).toEqual([]);
	});
});
