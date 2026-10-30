import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {applyCell, replay} from "@demlik/tea";
import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
} from "@demlik/tea/pbt";
import {listed, type MsgOf, Shell} from "@kampus/fabrika";
import {counter} from "@tea-fabrika/counter";
import {Layer} from "effect";
import fc from "fast-check";
import {Ghostty, type GhosttyTerminal} from "ghostty-web";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {
	close,
	type Editor,
	type EditorCtx,
	type EditorMsg,
	editor,
	interrupt,
	KEPT,
	keep,
	line,
	write,
} from "./editor.ts";
import {gridOf} from "./grid.ts";
import {keysIn, printable} from "./keys.ts";
import * as screen from "./screen.ts";
import {cells, PROMPT} from "./screen.ts";

// Every law of the line editor (editor.ts), in two groups: the redraw's, then the machine's own.

// --- Group 1: the redraw ---

// The line editor's redraw, as laws: property tests on fast-check, over two terminals.
//
//   the test grid (grid.ts)   lays text out as the editor counts it (cells.ts), at one width
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
const up = (n: number) => (n > 0 ? `${CSI}${n}A` : "");
const right = (n: number) => (n > 0 ? `${CSI}${n}C` : "");
const narrow = (text: string) => [...text].every((c) => (c.codePointAt(0) ?? 0) < 0x1100);

/** The laws, by name. */
const N = {
	sameGrid: "the same screen as the old redraw, on the test grid",
	sameGhostty: "the same screen as the old redraw, on ghostty",
	rowPath: "the row path runs when the line fits, and only then",
	leftoversGrid: "no leftovers, on the test grid",
	leftoversGhostty: "no leftovers, on ghostty",
	leftoversOdd: "the line alone on ghostty, with wide characters and combining marks",
	leftoversResized: "the line alone after a width change, on ghostty",
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
	"the row redraw writes no blank after the line": {
		patch: {redrawRow: (text: string, at: number) => `\r${CSI}K${text}\r${right(at)}`},
		by: [N.leftoversResized],
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
		by: [N.leftoversGrid, N.leftoversGhostty, N.fits],
	},
	"every line fits": {
		patch: {fitsRow: () => true},
		by: [N.sameGrid, N.rowPath, N.leftoversGrid],
	},
	"no guard for wide characters": {
		patch: {fitsRow: (text: string, cols: number) => screen.cells(text) < cols},
		by: [N.rowPath],
	},
	"the cursor's place counted one cell a code point, as before": {
		patch: {spot: (text: string) => [...text].length},
		by: [N.leftoversOdd],
	},
	"the draw from before: no blank after the line, and a new row after a full one": {
		patch: {
			draw: (text: string, at: number, cols: number) => {
				const end = screen.spot(text, cols);
				const wrap = end > 0 && end % cols === 0 ? "\r\n" : "";
				const rows = Math.floor(end / cols) - Math.floor(at / cols);
				return `${CSI}J${text}${wrap}${up(rows)}\r${right(at % cols)}`;
			},
		},
		by: [N.leftoversResized],
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

/** A table as tsh sends one: up to three rows of `chars`, a total that may be more, cut on the title. */
const tableOf = (chars: readonly string[]): fc.Arbitrary<Shell.Table> =>
	fc.array(fc.tuple(textOf(chars, 4), textOf(chars, 30)), {maxLength: 3}).chain((rows) =>
		fc.integer({min: rows.length, max: rows.length + 30}).map((total) => ({
			title: "Experiments",
			note: "newest first",
			total,
			columns: [
				{header: "#", align: "right"},
				{header: "TITLE", align: "left"},
			],
			cut: 1,
			rows: rows.map(([n, title]) => [
				{text: n, tone: "muted"},
				{text: title, tone: "plain"},
			]),
			hints: [{line: "experiments --all", for: "for every row"}],
		})),
	);

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
			table: arbRecordMsg("table", {table: tableOf(chars)}),
		};
		return arbMsg(table, {
			weights: {keys: 20, size: 2, printed: 2, ready: 3, ended: 1, jobs: 1, history: 1, table: 1},
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

/** What the prompt line shows, and the part of it before the cursor, worked out apart from the editor. */
const lineOf = (s: Editor): {readonly text: string; readonly before: string} | null => {
	const {mode} = s;
	if (mode.kind === "prompt") {
		const before = screen.PROMPT + mode.line.left;
		return {text: before + mode.line.right, before};
	}
	if (mode.kind === "search") {
		const text = Shell.Search.shown([...s.history].reverse(), mode.search);
		return {text, before: text};
	}
	return null;
};

/**
 * What a terminal of `kind` should show with only this line on it: the rows the text takes, and
 * the cursor just after `before`, as this terminal lays it out, not as the editor counts it. A
 * line that fills its row to the end puts the cursor on the next row, as the editor does
 * (screen.ts): found by writing one more letter and seeing it go there.
 */
const freshly = (kind: Kind, cols: number, text: string, before: string): Seen => {
	const t = termOf(kind, cols);
	t.write(text);
	const {rows} = t.seen();
	t.free();
	const u = termOf(kind, cols);
	u.write(before);
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
		out ===
			screen.back(screen.spot(was.before, m.before.cols), m.before.cols) +
				screen.draw(now.text, screen.spot(now.before, m.after.cols), m.after.cols);
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
 * reflows the line.
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
			const want = freshly(kind, cols, now.text, now.before);
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
		// A cursor move, or a table's colors (SGR).
		const move = rest.startsWith(CSI) && /^(\d*[AC]|[\d;]*m)/.test(rest.slice(CSI.length));
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
	noLeftovers(N.leftoversOdd, "ghostty", editsOnly([...NARROW, ...WIDE, ...ODD])),
	noLeftovers(N.leftoversResized, "ghostty", editsAndResizes(NARROW)),
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
		// Combining marks and the like: no cell at all, and `cells` counts none.
		expect(widths.get(0)).toBeGreaterThan(0);
	});
});

describe("a width change", () => {
	// Three cases the editor drew wrong before it wrote a blank after the line and left the reflow
	// to the terminal (screen.ts): `twice` showed the line twice, and `gone` and `typed` cleared
	// the output above the prompt. A line that filled its row ended with a hard new row, which no
	// terminal reflows, and a cursor after the line's end sat on a cell never written, which
	// ghostty-web 0.4.0 does not carry with the text.
	const caseOfMsgs = (cols: number, msgs: readonly EditorMsg[]): Case => ({
		cols,
		history: [],
		msgs,
	});

	it("shows the line alone, under what was above it, on both paths", () => {
		// A line that filled its row at 8 cells, then 9 cells and Backspace.
		const twice = caseOfMsgs(8, [keysOf("aaa"), {type: "size", cols: 9}, keysOf("\x7f")]);
		expect(screenAfter(real, twice)).toEqual({rows: ["tsh$ aa"], cursor: {row: 0, col: 7}});
		expect(screenAfter(old, twice)).toEqual(screenAfter(real, twice));
		// Output, then a line that fills the row once the width is 8, then Backspace.
		const gone = caseOfMsgs(32, [
			{type: "printed", text: "out"},
			keysOf("aaa"),
			{type: "size", cols: 8},
			keysOf("\x7f"),
		]);
		expect(screenAfter(real, gone)).toEqual({rows: ["out", "tsh$ aa"], cursor: {row: 1, col: 7}});
		expect(screenAfter(old, gone)).toEqual(screenAfter(real, gone));
		// Output, a line typed at 32 cells, then 8 cells, where it wraps, and Backspace.
		const typed = caseOfMsgs(32, [
			{type: "printed", text: "out"},
			keysOf("hello world"),
			{type: "size", cols: 8},
			keysOf("\x7f"),
		]);
		expect(screenAfter(real, typed)).toEqual({
			rows: ["out", "tsh$ hel", "lo worl"],
			cursor: {row: 2, col: 7},
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

// --- Group 2: the machine's own laws ---

// The line editor's laws, on tea's pbt: after every step of any list of Msgs, from the real init.
// Keys come as a terminal sends them: typed, pasted, and escape sequences, in one chunk or many.
// The screen law reads every byte written back off a terminal's grid (grid.ts), as a person sees
// it. The "something good" laws press keys from wherever a list left the editor.

type Msg = MsgOf<Machine>;
type Cmd =
	| ReturnType<typeof write>
	| ReturnType<typeof line>
	| ReturnType<typeof interrupt>
	| ReturnType<typeof close>
	| ReturnType<typeof keep>;
type EditorStep = Step<Editor, Msg, Cmd>;

const COLS = 80;
const ctx: EditorCtx = {programs: Shell.programList(Shell.SMALL), history: ["seq --to 3", "say"]};

// --- Generators ---

/** Pieces of what a terminal sends: text, and the keys readline's emacs table binds. */
const PIECES = [
	"ls",
	"se",
	"seq --to 3",
	" ",
	"%1",
	"\r", // Enter
	"\t", // Tab
	"\x7f", // Backspace
	"\x01", // Ctrl-A
	"\x05", // Ctrl-E
	"\x02", // Ctrl-B
	"\x06", // Ctrl-F
	"\x0b", // Ctrl-K
	"\x15", // Ctrl-U
	"\x17", // Ctrl-W
	"\x19", // Ctrl-Y
	"\x14", // Ctrl-T
	"\x10", // Ctrl-P
	"\x0e", // Ctrl-N
	"\x12", // Ctrl-R
	"\x07", // Ctrl-G
	"\x03", // Ctrl-C
	"\x0c", // Ctrl-L
	"\x1b[A", // Up
	"\x1b[D", // Left
	"\x1bb", // Alt-B
	"\x1bd", // Alt-D
	"\x1b[24~", // F12, bound to nothing
	"\x1b", // Esc
];
const piece = fc.oneof(
	{weight: 30, arbitrary: fc.constantFrom(...PIECES)},
	{weight: 1, arbitrary: fc.constant("\x04")}, // Ctrl-D: rare, as it ends tsh on an empty line
);
const data = fc.array(piece, {minLength: 1, maxLength: 4}).map((ps) => ps.join(""));
const HISTORY = ["ls", "seq --to 3", "say", "true"];
const job: Shell.Jobs = {
	next: 2,
	jobs: [
		{
			n: 1,
			text: "sleep --ms 9",
			stages: [{program: "sleep", flags: {ms: 9}, run: "r1", wire: null, ended: false}],
			state: "running",
			background: true,
		},
	],
};

/** A Cmd's failed answer. The editor's Cmds declare no errors, so a malformed answer is the one left. */
const failed = <T extends string, C>(type: T, cmd: C) =>
	fc.constant({type, cmd, error: {_tag: "malformed_result", issues: []} as const, at: 0});
const [writing, lining, interrupting, closing, keeping] = [
	write({data: "x"}),
	line({text: "ls"}),
	interrupt({}),
	close({}),
	keep({lines: ["ls"]}),
] as const;

/** One entry per Msg type, the Cmds' answers too: leaving one out does not compile. */
const tableFor = (size: fc.Arbitrary<number>): MsgArbitraryTable<Msg> => ({
	keys: arbRecordMsg("keys", {data}),
	size: arbRecordMsg("size", {cols: size}),
	printed: arbRecordMsg("printed", {text: fc.constantFrom("done", "a\nb", "\x1b[2Jboom", "")}),
	ready: arbConstantMsg("ready"),
	ended: arbConstantMsg("ended"),
	jobs: arbRecordMsg("jobs", {jobs: fc.constantFrom(Shell.EMPTY, job)}),
	// Lines another editor kept: cleaned and each once, as its `keep` sends them.
	history: arbRecordMsg("history", {lines: fc.uniqueArray(fc.constantFrom(...HISTORY))}),
	table: arbRecordMsg("table", {table: tableOf(["a", "b", "\x1b", "\n"])}),
	write_ok: fc.constant(write.ok(writing, null, 0)),
	write_err: failed(write.errType, writing),
	line_ok: fc.constant(line.ok(lining, null, 0)),
	line_err: failed(line.errType, lining),
	interrupt_ok: fc.constant(interrupt.ok(interrupting, null, 0)),
	interrupt_err: failed(interrupt.errType, interrupting),
	close_ok: fc.constant(close.ok(closing, null, 0)),
	close_err: failed(close.errType, closing),
	keep_ok: fc.constant(keep.ok(keeping, null, 0)),
	keep_err: failed(keep.errType, keeping),
});
const WEIGHTS = {weights: {keys: 30, ready: 4, printed: 2, ended: 1}};
const listsOf = (table: MsgArbitraryTable<Msg>) =>
	fc.array(arbMsg(table, WEIGHTS), {maxLength: 40, size: "max"});
/** Any list, the terminal's width changing too. */
const lists = listsOf(tableFor(fc.constantFrom(80, 20, 1, 0)));
/** Lists where the terminal stays 80 wide, as the grid that reads the bytes back is. */
const steady = listsOf(tableFor(fc.constant(COLS)));
const OPTS = {numRuns: 300, seed: 1};

// --- What a step did ---

const lines = (cmds: readonly Cmd[]) => cmds.flatMap((c) => (c.type === "line" ? [c.text] : []));
const toTsh = (cmds: readonly Cmd[]) =>
	cmds.filter((c) => c.type === "line" || c.type === "interrupt" || c.type === "close");
const bytes = (cmds: readonly Cmd[]) => cmds.flatMap((c) => (c.type === "write" ? [c.data] : []));

/** Step `machine` on from `from` with these keys, keeping every Cmd it asks for. */
const press = (machine: Machine, from: Editor, ...msgs: readonly Msg[]) => {
	let s = from;
	const cmds: Cmd[] = [];
	for (const msg of msgs) {
		const [next, out] = applyCell<Editor, Msg, Cmd>(machine, s, msg);
		s = next;
		cmds.push(...out);
	}
	return {s, cmds};
};
const keys = (data: string): Msg => ({type: "keys", data});

// --- The laws ---

interface MachineLaw {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

const every = (name: string, law: (step: EditorStep) => boolean): MachineLaw => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, law, OPTS),
});

const fromTheEnd = (
	name: string,
	law: (machine: Machine, last: Editor) => boolean,
	seqs = lists,
): MachineLaw => ({
	name,
	check: (machine) => propertyTrace(machine, ctx, seqs, (_, last) => law(machine, last), OPTS),
});

const screenShowsLine: MachineLaw = {
	name: "at the prompt, the terminal shows the prompt and the line, with the cursor where the line's cursor is",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			steady,
			(steps) => {
				const [, booted] = machine.init(null, ctx);
				const written = bytes(booted);
				return steps.every((step) => {
					written.push(...bytes(step.cmds));
					const {mode} = step.next;
					if (mode.kind !== "prompt") return true;
					const text = PROMPT + mode.line.left + mode.line.right;
					// One row only: the grid trims each row's end, so a wrapped line loses its spaces.
					if (cells(text) >= COLS) return true;
					const grid = gridOf(written.join(""), COLS);
					return (
						grid.rows[grid.cursor.row] === text.trimEnd() &&
						grid.cursor.col === cells(PROMPT + mode.line.left)
					);
				});
			},
			OPTS,
		),
};

const oneLineAtATime = every(
	"at most one line goes to tsh in a step, never a blank one or one with a control character, and the editor then waits for tsh",
	({next, cmds}) => {
		const sent = lines(cmds);
		if (sent.length === 0) return true;
		const [text = ""] = sent;
		return (
			sent.length === 1 &&
			text.trim() !== "" &&
			[...text].every(printable) &&
			next.mode.kind === "busy"
		);
	},
);

const keysWait = every(
	"while tsh runs a line, keys never become a line or the end of tsh's input: they wait",
	({prev, msg, cmds}) =>
		prev.mode.kind !== "busy" ||
		msg.type !== "keys" ||
		cmds.every((c) => c.type !== "line" && c.type !== "close"),
);

const interruptReaches = every(
	"Ctrl-C while tsh runs a line reaches tsh at once, and drops what was typed ahead before it",
	({prev, msg, next, cmds}) => {
		if (prev.mode.kind !== "busy" || msg.type !== "keys") return true;
		const typed = keysIn(msg.data);
		const at = typed.lastIndexOf("\x03");
		if (at < 0) return true;
		const ahead = next.mode.kind === "busy" ? next.mode.ahead : [];
		return (
			cmds.some((c) => c.type === "interrupt") &&
			ahead.every((k) => typed.slice(at + 1).includes(k))
		);
	},
);

const goneStaysGone = every(
	"once tsh is gone, the editor stays ended and sends tsh nothing more",
	({prev, next, cmds}) =>
		prev.mode.kind !== "ended" ||
		(next.mode.kind === "ended" &&
			toTsh(cmds).length === 0 &&
			cmds.every((c) => c.type !== "keep")),
);

const historyKept = every(
	`the history holds each line once and at most ${KEPT}; a line run is its newest, and every keep carries it whole`,
	({next, cmds}) => {
		const {history} = next;
		const ran = lines(cmds).at(-1);
		return (
			new Set(history).size === history.length &&
			history.length <= KEPT &&
			(ran === undefined || history.at(-1) === ran) &&
			cmds.every((c) => c.type !== "keep" || JSON.stringify(c.lines) === JSON.stringify(history))
		);
	},
);

const enterRuns = fromTheEnd(
	"Enter at the prompt hands tsh the whole line, wherever the cursor is in it",
	(machine, last) => {
		if (last.mode.kind !== "prompt") return true;
		const {left, right} = last.mode.line;
		const {cmds} = press(machine, last, keys("ls\r"));
		return lines(cmds).join("\n") === `${left}ls${right}`;
	},
);

const readyBringsPrompt = fromTheEnd(
	"tsh being done brings the prompt back, or runs the next line typed ahead",
	(machine, last) => {
		if (last.mode.kind !== "busy") return true;
		const {s, cmds} = press(machine, last, {type: "ready"});
		return s.mode.kind === "prompt" || s.mode.kind === "search" || lines(cmds).length === 1;
	},
);

const ctrlDEnds = fromTheEnd(
	"Ctrl-D on an empty prompt ends tsh's input, and the editor with it",
	(machine, last) => {
		if (last.mode.kind !== "prompt") return true;
		// Ctrl-A then Ctrl-K: the whole line is cut, so the prompt is empty.
		const {s, cmds} = press(machine, last, keys("\x01\x0b"), keys("\x04"));
		return s.mode.kind === "ended" && cmds.some((c) => c.type === "close");
	},
);

const MACHINE_LAWS = [
	screenShowsLine,
	oneLineAtATime,
	keysWait,
	interruptReaches,
	goneStaysGone,
	historyKept,
	enterRuns,
	readyBringsPrompt,
	ctrlDEnds,
];

/** The names of the laws `machine` breaks. */
const broken = (machine: Machine): readonly string[] =>
	MACHINE_LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// --- Planted mistakes ---

const realUpdate = editor.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...editor,
	update: {...realUpdate, ...update},
});

const MACHINE_PLANTS = {
	/** Backspace changes the line and forgets to draw it again. */
	backspaceDrawsNothing: plant({
		keys: (s, m) => {
			const [next, cmds] = realUpdate.keys(s, m);
			return [next, m.data.includes("\x7f") ? cmds.filter((c) => c.type !== "write") : cmds];
		},
	}),
	/** Enter on a blank line still hands tsh the line. */
	runsBlankLines: plant({
		keys: (s, m) => {
			const [next, cmds] = realUpdate.keys(s, m);
			const blank = s.mode.kind === "prompt" && m.data === "\r" && lines(cmds).length === 0;
			return blank
				? [{...next, mode: {kind: "busy", ahead: []}}, [...cmds, line({text: ""})]]
				: [next, cmds];
		},
	}),
	/** Keys typed while tsh runs are taken at a prompt at once. */
	noTypeAhead: plant({
		keys: (s, m) =>
			realUpdate.keys(
				s.mode.kind === "busy"
					? {...s, mode: {kind: "prompt", line: {left: "", right: ""}, recall: null}}
					: s,
				m,
			),
	}),
	/** Ctrl-C while tsh runs stays in the editor. */
	keepsCtrlC: plant({
		keys: (s, m) => {
			const [next, cmds] = realUpdate.keys(s, m);
			return [next, cmds.filter((c) => c.type !== "interrupt")];
		},
	}),
	/** tsh being ready brings a prompt back after tsh is gone. */
	comesBack: plant({
		ready: (s, m) =>
			realUpdate.ready(s.mode.kind === "ended" ? {...s, mode: {kind: "busy", ahead: []}} : s, m),
	}),
	/** A line run again is put at the end, and its older copy stays. */
	keepsCopies: plant({
		keys: (s, m) => {
			const [next, cmds] = realUpdate.keys(s, m);
			const ran = lines(cmds).at(-1);
			return ran === undefined ? [next, cmds] : [{...next, history: [...s.history, ran]}, cmds];
		},
	}),
	/** Enter leaves out what was after the cursor. */
	cutsAtTheCursor: plant({
		keys: (s, m) => {
			const [next, cmds] = realUpdate.keys(s, m);
			const right = s.mode.kind === "prompt" ? s.mode.line.right : "";
			const cut = (c: Cmd): Cmd =>
				c.type === "line" && right !== "" && c.text.endsWith(right)
					? line({text: c.text.slice(0, -right.length)})
					: c;
			return [next, cmds.map(cut)];
		},
	}),
	/** tsh being ready is not heard. */
	deafToReady: plant({ready: (s) => [s, []]}),
	/** Ctrl-D on an empty prompt does nothing. */
	ctrlDDoesNothing: plant({
		keys: (s, m) => {
			const [next, cmds] = realUpdate.keys(s, m);
			return next.mode.kind === "ended" && s.mode.kind === "prompt" ? [s, []] : [next, cmds];
		},
	}),
} satisfies Readonly<Record<string, Machine>>;

describe("the line editor's laws", () => {
	it.each(MACHINE_LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(editor);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(MACHINE_PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			backspaceDrawsNothing: [screenShowsLine.name],
			// With tables in the lists, the screen law no longer meets this plant in its 300 runs.
			runsBlankLines: [oneLineAtATime.name, historyKept.name],
			noTypeAhead: [screenShowsLine.name, keysWait.name, interruptReaches.name],
			keepsCtrlC: [interruptReaches.name],
			comesBack: [goneStaysGone.name],
			keepsCopies: [historyKept.name],
			cutsAtTheCursor: [oneLineAtATime.name, historyKept.name, enterRuns.name],
			deafToReady: [readyBringsPrompt.name],
			ctrlDDoesNothing: [ctrlDEnds.name],
		});
		// Every law is caught by at least one plant.
		expect(MACHINE_LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual(
			[],
		);
	});
});
