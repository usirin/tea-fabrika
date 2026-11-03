import {describe, expect, it} from "vitest";
import type {TableView} from "../program/person.ts";
import {ANSI, ONE_SCREEN, paint, plain, type Table, tableLines, tableOf, widthOf} from "./table.ts";

// The table printer: one view, a few rows, laid out at a width and drawn plain or in color.

interface Row {
	readonly n: number;
	readonly title: string;
	readonly runs: number;
	readonly status: "finished" | "running";
}

const view: TableView<Row, "#" | "Title" | "Runs"> = {
	title: "Experiments",
	note: "newest first",
	columns: [
		{header: "#", cell: (r) => String(r.n), muted: true},
		{header: "Title", cell: (r) => r.title},
		{
			header: "Runs",
			cell: (r) =>
				r.status === "running" ? {text: `running ${r.runs}`, tone: "accent"} : String(r.runs),
			align: "right",
			muted: true,
		},
	],
	cut: "Title",
	next: (first) => [{line: `experiment --n ${first.n} | markdown`, for: "to read one"}],
};

const rows = (n: number): readonly Row[] =>
	Array.from({length: n}, (_, i) => ({
		n: n - i,
		title: i === 0 ? "A title long enough that a narrow terminal has to cut it short" : "Short",
		runs: i,
		status: "finished",
	}));

const text = (table: Table, width: number) => plain(tableLines(table, width)).split("\n");

describe("the table printer", () => {
	it("lines its columns up, with a title, a header in capitals and a number on the right", () => {
		const table = tableOf(view, rows(3), {all: false, typed: "experiments"});
		expect(text(table, 100)).toEqual([
			"",
			"Experiments  3 · newest first",
			"",
			"  #   TITLE                                                            RUNS",
			"  3   A title long enough that a narrow terminal has to cut it short      0",
			"  2   Short                                                               1",
			"  1   Short                                                               2",
			"",
		]);
	});

	it("cuts only the one column, with …, to fit the width", () => {
		const lines = text(tableOf(view, rows(3), {all: false, typed: "experiments"}), 40);
		// 40 cells: 2 of indent, 3 + 3 between the columns, 1 for #, 4 for RUNS, and 27 for the title.
		expect(lines[4]).toBe("  3   A title long enough that a…      0");
		expect(lines[5]).toBe(`  2   ${"Short".padEnd(27)}      1`);
		for (const line of lines) expect(widthOf(line)).toBeLessThanOrEqual(40);
	});

	it("never cuts a column under twelve cells: a terminal too narrow wraps instead", () => {
		const lines = text(tableOf(view, rows(1), {all: false, typed: "experiments"}), 10);
		expect(lines[4]).toBe("  1   A title lon…      0");
	});

	it("never makes the cut column wider than eighty cells, so the columns after it stay near", () => {
		const long = tableOf(view, [{n: 1, title: "word ".repeat(30), runs: 0, status: "finished"}], {
			all: false,
			typed: "experiments",
		});
		expect(text(long, 200)[4]).toBe(`  1   ${"word ".repeat(16).slice(0, 79)}…      0`);
	});

	it("counts a wide character as two cells", () => {
		const wide = tableOf(view, [{n: 1, title: "漢字漢字漢字漢字", runs: 0, status: "finished"}], {
			all: false,
			typed: "experiments",
		});
		// 15 cells for the title: seven characters of two, and the …
		expect(text(wide, 28)[4]).toBe("  1   漢字漢字漢字漢…      0");
	});

	it("shows one screen of rows, then how many are left and what to type for them", () => {
		const table = tableOf(view, rows(25), {all: false, typed: "experiments"});
		expect(table.rows).toHaveLength(ONE_SCREEN);
		expect(table.total).toBe(25);
		expect(text(table, 100).slice(-3)).toEqual([
			"",
			"5 more.  experiments --all for every row, experiment --n 25 | markdown to read one.",
			"",
		]);
	});

	it("shows every row with --all, and no footer", () => {
		const table = tableOf(view, rows(25), {all: true, typed: "experiments"});
		expect(table.rows).toHaveLength(25);
		expect(table.hints).toEqual([]);
		expect(text(table, 100).at(-2)).toMatch(/^ {2}1 {4}Short/);
	});

	it("shows a list with no rows as its title and count", () => {
		expect(text(tableOf(view, [], {all: false, typed: "experiments"}), 80)).toEqual([
			"",
			"Experiments  0 · newest first",
			"",
		]);
	});

	it("keeps a cell to one line, and no text can draw on the screen", () => {
		const table = tableOf(
			view,
			[{n: 1, title: "two\nlines \x1b[2Jand\tmore", runs: 0, status: "finished"}],
			{all: false, typed: "experiments"},
		);
		expect(table.rows[0]?.[1]?.text).toBe("two lines \u{fffd}[2Jand more");
	});

	it("wraps what to type between words on a narrow terminal, each command whole", () => {
		const table = tableOf(view, rows(25), {all: false, typed: "experiments"});
		expect(text(table, 40).slice(-4)).toEqual([
			"5 more.  experiments --all for every",
			"row, experiment --n 25 | markdown to",
			"read one.",
			"",
		]);
	});

	it("draws no color when it is not a terminal's", () => {
		const out = plain(tableLines(tableOf(view, rows(25), {all: false, typed: "e"}), 100));
		expect(out).not.toContain("\x1b");
	});

	it("draws each tone in its color for a terminal: the title bold, the header dim, a hint in the accent", () => {
		const lines = tableLines(
			tableOf(view, [{n: 9, title: "On", runs: 2, status: "running"}, ...rows(25)], {
				all: false,
				typed: "experiments",
			}),
			100,
		);
		const out = paint(lines, ANSI);
		expect(out).toContain("\x1b[1mExperiments\x1b[0m\x1b[90m  26 · newest first\x1b[0m");
		expect(out).toContain("\x1b[2;90mTITLE\x1b[0m");
		expect(out).toContain("\x1b[34mrunning 2\x1b[0m");
		expect(out).toContain("\x1b[34mexperiments --all\x1b[0m");
		// The same lines, plain, are the colored ones with their colors taken out.
		// oxlint-disable-next-line eslint/no-control-regex -- the colors are what it takes out.
		expect(out.replace(/\x1b\[[\d;]*m/g, "")).toBe(plain(lines));
	});
});
