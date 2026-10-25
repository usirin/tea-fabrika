import {applyCell} from "@demlik/tea";
import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
} from "@demlik/tea/pbt";
import {type MsgOf, Shell} from "@kampus/fabrika";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	close,
	type Editor,
	type EditorCtx,
	editor,
	interrupt,
	KEPT,
	keep,
	line,
	write,
} from "./editor.ts";
import {gridOf} from "./grid.ts";
import {keysIn, printable} from "./keys.ts";
import {cells, PROMPT} from "./screen.ts";

// The line editor's laws, on tea's pbt: after every step of any list of Msgs, from the real init.
// Keys come as a terminal sends them: typed, pasted, and escape sequences, in one chunk or many.
// The screen law reads every byte written back off a terminal's grid (grid.ts), as a person sees
// it. The "something good" laws press keys from wherever a list left the editor.

type Machine = typeof editor;
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

// ---------------------------------------------------------------- generators

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

// ---------------------------------------------------------------- what a step did

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

// ---------------------------------------------------------------- the laws

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

const every = (name: string, law: (step: EditorStep) => boolean): Law => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, law, OPTS),
});

const fromTheEnd = (
	name: string,
	law: (machine: Machine, last: Editor) => boolean,
	seqs = lists,
): Law => ({
	name,
	check: (machine) => propertyTrace(machine, ctx, seqs, (_, last) => law(machine, last), OPTS),
});

const screenShowsLine: Law = {
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

const LAWS = [
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
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// ---------------------------------------------------------------- planted mistakes

const real = editor.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...editor,
	update: {...real, ...update},
});

const PLANTS = {
	/** Backspace changes the line and forgets to draw it again. */
	backspaceDrawsNothing: plant({
		keys: (s, m) => {
			const [next, cmds] = real.keys(s, m);
			return [next, m.data.includes("\x7f") ? cmds.filter((c) => c.type !== "write") : cmds];
		},
	}),
	/** Enter on a blank line still hands tsh the line. */
	runsBlankLines: plant({
		keys: (s, m) => {
			const [next, cmds] = real.keys(s, m);
			const blank = s.mode.kind === "prompt" && m.data === "\r" && lines(cmds).length === 0;
			return blank
				? [{...next, mode: {kind: "busy", ahead: []}}, [...cmds, line({text: ""})]]
				: [next, cmds];
		},
	}),
	/** Keys typed while tsh runs are taken at a prompt at once. */
	noTypeAhead: plant({
		keys: (s, m) =>
			real.keys(
				s.mode.kind === "busy"
					? {...s, mode: {kind: "prompt", line: {left: "", right: ""}, recall: null}}
					: s,
				m,
			),
	}),
	/** Ctrl-C while tsh runs stays in the editor. */
	keepsCtrlC: plant({
		keys: (s, m) => {
			const [next, cmds] = real.keys(s, m);
			return [next, cmds.filter((c) => c.type !== "interrupt")];
		},
	}),
	/** tsh being ready brings a prompt back after tsh is gone. */
	comesBack: plant({
		ready: (s, m) =>
			real.ready(s.mode.kind === "ended" ? {...s, mode: {kind: "busy", ahead: []}} : s, m),
	}),
	/** A line run again is put at the end, and its older copy stays. */
	keepsCopies: plant({
		keys: (s, m) => {
			const [next, cmds] = real.keys(s, m);
			const ran = lines(cmds).at(-1);
			return ran === undefined ? [next, cmds] : [{...next, history: [...s.history, ran]}, cmds];
		},
	}),
	/** Enter leaves out what was after the cursor. */
	cutsAtTheCursor: plant({
		keys: (s, m) => {
			const [next, cmds] = real.keys(s, m);
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
			const [next, cmds] = real.keys(s, m);
			return next.mode.kind === "ended" && s.mode.kind === "prompt" ? [s, []] : [next, cmds];
		},
	}),
} satisfies Readonly<Record<string, Machine>>;

describe("the line editor's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(editor);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			backspaceDrawsNothing: [screenShowsLine.name],
			runsBlankLines: [screenShowsLine.name, oneLineAtATime.name, historyKept.name],
			noTypeAhead: [screenShowsLine.name, keysWait.name, interruptReaches.name],
			keepsCtrlC: [interruptReaches.name],
			comesBack: [goneStaysGone.name],
			keepsCopies: [historyKept.name],
			cutsAtTheCursor: [oneLineAtATime.name, historyKept.name, enterRuns.name],
			deafToReady: [readyBringsPrompt.name],
			ctrlDDoesNothing: [ctrlDEnds.name],
		});
		// Every law is caught by at least one plant.
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});
