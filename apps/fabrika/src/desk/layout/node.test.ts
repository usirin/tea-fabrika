import {describe, expect, it} from "vitest";
import {isKeptTree, isLayoutTree} from "./node.ts";

// The guards a saved layout is read with (node.ts): a tree comes back from disk, or from a host,
// as `unknown`, so each guard is checked here on a whole tree with one bad part in it. A good tree
// must pass, so a guard that says no to everything fails too.

const tracker = {id: "tracker:1", program: "tracker"};
const ticket = {id: "ticket:1", program: "ticket"};

/** A row of a plain tsh and one tile showing `shows`, as JSON gives it back. */
const treeWith = (shows: unknown, over: Record<string, unknown> = {}): unknown => ({
	root: {
		tag: "container",
		id: "c1",
		orientation: "horizontal",
		children: [
			{tag: "tile", id: "t1", shows: {kind: "tsh", run: null}, folded: false},
			{tag: "tile", id: "t2", shows, folded: false},
		],
		sizes: {t1: 50, t2: 50},
	},
	zoomed: null,
	...over,
});

/** A window of the line typed in t1, its line given as is. */
const windowOf = (line: unknown, over: Record<string, unknown> = {}) => ({
	kind: "window",
	run: ticket,
	line,
	...over,
});

const line = (letter?: unknown): Record<string, unknown> =>
	letter === undefined
		? {id: "tracker:1", from: "t1", tint: 0}
		: {id: "tracker:1", from: "t1", tint: 0, letter};

describe("a pipe's letter, as a saved tree is read", () => {
	it("is one or more capitals: A, then AA past Z", () => {
		for (const letter of ["A", "Z", "AA", "AB"]) {
			expect(isLayoutTree(treeWith(windowOf(line(letter))))).toBe(true);
			expect(isKeptTree(treeWith(windowOf(line(letter))))).toBe(true);
		}
	});

	it("is refused in small letters, with a digit on either end, empty, or not a string", () => {
		for (const letter of ["a", "aA", "A1", "1A", "", "A B", 7, ["A"]]) {
			expect(isLayoutTree(treeWith(windowOf(line(letter)))), String(letter)).toBe(false);
			// A desk kept before pipes had letters may have none, never a bad one.
			expect(isKeptTree(treeWith(windowOf(line(letter)))), String(letter)).toBe(false);
		}
	});

	it("must be there in a tree as it is kept now, and may be missing in one kept before letters", () => {
		expect(isLayoutTree(treeWith(windowOf(line())))).toBe(false);
		expect(isKeptTree(treeWith(windowOf(line())))).toBe(true);
	});
});

describe("what a tile shows, as a saved tree is read", () => {
	it("passes a tsh with no run, a tsh with a run, a line and a window", () => {
		for (const shows of [
			{kind: "tsh", run: null},
			{kind: "tsh", run: tracker},
			{kind: "line", run: tracker, line: line("A")},
			windowOf(line("A")),
		]) {
			expect(isLayoutTree(treeWith(shows)), JSON.stringify(shows)).toBe(true);
		}
	});

	it("refuses a bad shows, run, kind or line, and never throws on one", () => {
		const bad: readonly unknown[] = [
			null,
			7,
			"tsh",
			{kind: "tsh", run: {id: 7, program: "tracker"}},
			{kind: "tsh"},
			{kind: "pane", run: ticket, line: line("A")},
			{run: ticket, line: line("A")},
			windowOf(line("A"), {run: null}),
			windowOf(line("A"), {run: {id: "ticket:1"}}),
			windowOf(null),
			windowOf({...line("A"), tint: 9}),
			windowOf({...line("A"), id: 1}),
			windowOf({...line("A"), from: null}),
		];

		for (const shows of bad) {
			expect(isLayoutTree(treeWith(shows)), JSON.stringify(shows)).toBe(false);
			expect(isKeptTree(treeWith(shows)), JSON.stringify(shows)).toBe(false);
		}
	});
});

describe("a saved tree's shape", () => {
	it("refuses a child that is no node, a size that is no number, and a zoom that is no id", () => {
		const good = treeWith({kind: "tsh", run: null}) as {root: Record<string, unknown>};
		expect(isLayoutTree(good)).toBe(true);
		expect(isLayoutTree({...good, root: {...good.root, children: [7]}})).toBe(false);
		expect(isLayoutTree({...good, root: {...good.root, children: [{tag: "tile"}]}})).toBe(false);
		expect(isLayoutTree({...good, root: {...good.root, sizes: {t1: "50", t2: 50}}})).toBe(false);
		expect(isLayoutTree(treeWith({kind: "tsh", run: null}, {zoomed: 3}))).toBe(false);
		expect(isLayoutTree(treeWith({kind: "tsh", run: null}, {zoomed: "t2"}))).toBe(true);
	});
});
