import {Schema} from "effect";

// How tsh shows an output's values to a person at a terminal, as `gh pr list` shows a list: a
// form for people beside the value itself. A pipe, a `$( )` and `tsh --json` always get the value
// whole; this is only what a person reads.
//
//   output(Experiment, "One experiment.", {person: {table: {
//     title: "Experiments",
//     note: "newest first",
//     columns: [
//       {header: "#", cell: (row) => row.n, muted: true},
//       {header: "Title", cell: (row) => row.title},
//       {header: "Runs", cell: (row) => String(row.runs), align: "right", muted: true},
//     ],
//     cut: "Title",                      // the one column cut with … to fit; a header above, or it does not type
//   }}})
//   output(Comparison, "Two runs.", {person: {line: Comparison.toLine}})    one value, one line
//   output(Schema.String, "The page as markdown.", {person: "none"})          for a pipe or a window only
//
// Left out, tsh prints its own short form of the value, by its fields (../shell/short.ts).
//
// A line and a table are the program's answer in a person's form. So when a pipe or a `$( )` takes
// another output of the same run, tsh prints neither: the person asked for the answer in that
// other form (`experiments | markdown` draws the list in a window and prints no table under it).

/** How a piece of a table is drawn. The terminal picks the colors; the program names only the role. */
export const Tone = Schema.Literals(["plain", "strong", "muted", "faint", "accent", "warning"]);
export type Tone = typeof Tone.Type;

/** A cell: its text in its column's tone, or with a tone of its own, such as a run that failed. */
export type TableCell = string | {readonly text: string; readonly tone: Tone};

/** One column of a table view. */
export interface TableColumn<T, H extends string> {
	/** As a person reads it: "Title". tsh prints it in capitals, as gh does. */
	readonly header: H;
	/** The cell of one row. */
	readonly cell: (row: T) => TableCell;
	/** Left out: left. Numbers read best on the right. */
	readonly align?: "left" | "right";
	/** A column a person reads second, such as a number or a day: drawn in the muted ink. */
	readonly muted?: boolean;
}

/** A line a person may type next, and what it is for: `experiment --n 170 | markdown`, `to read one`. */
export interface Hint {
	readonly line: string;
	readonly for: string;
}

/**
 * An output's values as the rows of one table, printed once its run has ended: a title line, a
 * header, about one screen of rows, and what to type for the rest.
 */
export interface TableView<T, H extends string = string> {
	/** What the rows are: "Experiments". tsh puts the count beside it. */
	readonly title: string;
	/** How the rows are ordered, or anything else a reader needs first: "newest first". */
	readonly note?: string;
	readonly columns: readonly [TableColumn<T, H>, ...TableColumn<T, H>[]];
	/** The one column cut, with …, to fit the terminal's width: the header of a column above. */
	readonly cut: NoInfer<H>;
	/** What else to type, said under a list cut short, made from its first row. */
	readonly next?: (first: T) => readonly Hint[];
}

/** How tsh shows an output's values to a person. */
export type Person<T, H extends string = string> =
	| {readonly line: (value: T) => string}
	| {readonly table: TableView<T, H>}
	| "none";

/**
 * `person`, if it is one a terminal can draw: a table with a title, and headers that are there
 * and each its own. Refused here otherwise, when the output is declared, as a mailbox's capacity
 * is. The types already hold the cut column to a header of the table.
 */
export function personOf<T, H extends string>(person: Person<T, H>): Person<T, H> {
	if (typeof person === "string" || "line" in person) return person;
	const {title, columns, cut} = person.table;
	const headers = columns.map((c) => c.header);
	if (title.trim() === "") throw new Error("a table needs a title: what its rows are");
	if (headers.some((h) => h.trim() === "")) throw new Error("a table's column needs a header");
	if (new Set(headers).size !== headers.length)
		throw new Error(`a table's headers are each its own, not ${headers.join(", ")}`);
	if (!headers.includes(cut)) throw new Error(`a table cuts one of its columns, not ${cut}`);
	return person;
}
