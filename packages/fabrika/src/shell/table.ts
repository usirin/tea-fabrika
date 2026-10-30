import {Schema} from "effect";
import {type TableCell, type TableView, Tone} from "../program/person.ts";

// A table for a person, as `gh pr list` prints one on a terminal (cli/cli's
// internal/tableprinter, on go-gh's): a title line with the count, a muted
// header in capitals, columns lined up two by two, the secondary ones muted,
// one column cut with … to fit the width, about one screen of rows, and what
// to type for the rest. A pipe, a `$( )` and `tsh --json` never see it: they
// get the values whole.
//
//   tableOf(view, rows, {all: false, typed: "experiments"})   the data: tsh hands it to its terminal
//   tableLines(table, 100)                                      the lines, laid out at that width
//   paint(lines, ANSI)   or   plain(lines)                      as bytes: in color for a terminal, or not
//
//   Experiments  171 · newest first
//
//     #     TITLE                                                  RUNS   UPDATED
//     171   Can the app host run the ledger as Alchemy's local…       1   Oct 30
//     170   The experiments program, on today's ledger (part 1)       0   Oct 30
//
//   151 more.  experiments --all for every row, experiment --n 170 | markdown to read one.
//
// tsh builds the data and the terminal lays it out, as gh's printer asks its
// IOStreams for the width: tsh does not know how wide the tile is, and the
// terminal does.

/** About one screen of rows, as `gh pr list --limit` holds a list to 30: the rest is one `--all` away. */
export const ONE_SCREEN = 20;

/** Between two columns. gh puts two spaces; the approved mockup three, which reads calmer. */
const GAP = "   ";
/** Before each row and the header, under the title line. */
const INDENT = "  ";
/** The narrowest a cut column gets, however narrow the terminal: below it the line wraps instead. */
const NARROWEST = 12;
/**
 * The widest a cut column gets, however wide the terminal: a line read at once, as help keeps to
 * 80 columns, so the columns after it stay near it on a wide tile.
 */
const WIDEST = 80;

/** A piece of a line, in one tone. */
export const Span = Schema.Struct({text: Schema.String, tone: Tone});
export type Span = typeof Span.Type;

/** One line of a table, as spans. */
type Line = readonly Span[];

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * A table as tsh hands it to its terminal: every cell already made, in its tone, and laid out by
 * the terminal at its own width. `rows` may hold fewer than `total`: the rest are left for `--all`,
 * and `hints` say how to get them.
 */
export const Table = Schema.Struct({
	title: Schema.String,
	note: Schema.NullOr(Schema.String),
	total: Count,
	columns: Schema.NonEmptyArray(
		Schema.Struct({header: Schema.String, align: Schema.Literals(["left", "right"])}),
	),
	/** Which column is cut to fit: its place among `columns`. */
	cut: Count,
	rows: Schema.Array(Schema.Array(Span)),
	hints: Schema.Array(Schema.Struct({line: Schema.String, for: Schema.String})),
}).check(
	Schema.makeFilter(
		(t) =>
			(t.cut < t.columns.length &&
				t.rows.length <= t.total &&
				t.rows.every((row) => row.length === t.columns.length)) ||
			"a table cuts one of its columns, holds no more rows than its total, and each row has a cell per column",
	),
);
export type Table = typeof Table.Type;

/**
 * A text as one line in a cell: every run of white space one space, as gh's
 * `RemoveExcessiveWhitespace` does to a title, and any other control character
 * a replacement character, so no text can move the cursor or color the screen.
 */
const oneLine = (text: string): string =>
	text
		.replace(/\s+/g, " ")
		.trim()
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it takes out.
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, "\u{fffd}");

/**
 * The table of `rows`, as `view` declares it: about one screen of them, or all with `all`.
 * `typed`: the command as the person typed it, for the hint that shows every row.
 */
export function tableOf<T>(
	view: TableView<T>,
	rows: readonly T[],
	options: {readonly all: boolean; readonly typed: string},
): Table {
	const shown = options.all ? rows : rows.slice(0, ONE_SCREEN);
	const cellOf = (muted: boolean, cell: TableCell): Span =>
		typeof cell === "string"
			? {text: oneLine(cell), tone: muted ? "muted" : "plain"}
			: {text: oneLine(cell.text), tone: cell.tone};
	const [first] = rows;
	const hints =
		shown.length === rows.length || first === undefined
			? []
			: [
					{line: `${oneLine(options.typed)} --all`, for: "for every row"},
					...(view.next?.(first) ?? []).map((h) => ({line: oneLine(h.line), for: oneLine(h.for)})),
				];
	const [head, ...rest] = view.columns;
	const columnOf = (c: typeof head) => ({
		header: oneLine(c.header).toUpperCase(),
		align: c.align ?? "left",
	});
	return {
		title: oneLine(view.title),
		note: view.note === undefined ? null : oneLine(view.note),
		total: rows.length,
		columns: [columnOf(head), ...rest.map(columnOf)],
		cut: view.columns.findIndex((c) => c.header === view.cut),
		rows: shown.map((row) => view.columns.map((c) => cellOf(c.muted === true, c.cell(row)))),
		hints,
	};
}

/**
 * How many cells a character takes on a terminal: two for the wide ones of East Asian scripts and
 * for emoji, none for a mark that joins the one before, one for the rest. A sketch of wcwidth,
 * enough for a title; the app's line editor counts with the terminal's own table.
 */
const cellsOf = (c: string): number => {
	const cp = c.codePointAt(0) ?? 0;
	if ((cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
	const wide =
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1faff) ||
		(cp >= 0x20000 && cp <= 0x3fffd);
	return wide ? 2 : 1;
};

/** How many cells a text takes on a terminal. */
export const widthOf = (text: string): number => [...text].reduce((sum, c) => sum + cellsOf(c), 0);

/** A text cut to `width` cells, with … last when it is cut. */
const cut = (text: string, width: number): string => {
	if (widthOf(text) <= width) return text;
	let kept = "";
	let used = 0;
	for (const c of text) {
		const w = cellsOf(c);
		if (used + w > width - 1) break;
		kept += c;
		used += w;
	}
	return `${kept}…`;
};

const span = (text: string, tone: Span["tone"] = "plain"): Span => ({text, tone});

/**
 * The table's lines at `width` cells: a blank line, the title and its count, a blank line, the
 * header and the rows, and, when rows were left out, a blank line and what to type for them,
 * wrapped between words to the width. Every column but the cut one is as wide as its widest cell;
 * the cut one takes the room left, never more than it needs or `WIDEST`, and never under
 * `NARROWEST`. A row's last cell is not padded.
 */
export function tableLines(table: Table, width: number): readonly Line[] {
	const count = [String(table.total), ...(table.note === null ? [] : [table.note])].join(" · ");
	const title: Line = [span(table.title, "strong"), span(`  ${count}`, "muted")];
	if (table.rows.length === 0) return [[], title, []];
	const natural = table.columns.map((c, i) =>
		Math.max(widthOf(c.header), ...table.rows.map((row) => widthOf(row[i]?.text ?? ""))),
	);
	const fixed = natural.reduce((sum, w, i) => (i === table.cut ? sum : sum + w), 0);
	const room = width - INDENT.length - GAP.length * (natural.length - 1) - fixed;
	const widths = natural.map((w, i) =>
		i === table.cut ? Math.max(NARROWEST, Math.min(w, room, WIDEST)) : w,
	);
	const last = table.columns.length - 1;
	const lineOf = (cells: readonly Span[]): Line => [
		span(INDENT),
		...cells.flatMap((cell, i) => {
			const w = widths[i] ?? 0;
			const text = i === table.cut ? cut(cell.text, w) : cell.text;
			const pad = " ".repeat(Math.max(0, w - widthOf(text)));
			const right = table.columns[i]?.align === "right";
			const parts = right
				? [span(pad), span(text, cell.tone)]
				: [span(text, cell.tone), ...(i === last ? [] : [span(pad)])];
			return i === 0 ? parts : [span(GAP), ...parts];
		}),
	];
	const header = lineOf(table.columns.map((c) => span(c.header, "faint")));
	const more = table.total - table.rows.length;
	const lastHint = table.hints.length - 1;
	const footer: readonly Line[] =
		more === 0
			? []
			: [
					[],
					...wrapped(
						[
							{gap: "", spans: [span(`${more} more.`, "muted")]},
							...table.hints.flatMap((h, i) => [
								{gap: i === 0 ? "  " : " ", spans: [span(h.line, "accent")]},
								...`${h.for}${i === lastHint ? "." : ","}`
									.split(" ")
									.map((word) => ({gap: " ", spans: [span(word, "muted")]})),
							]),
						],
						width,
					),
				];
	return [[], title, [], header, ...table.rows.map(lineOf), ...footer, []].map(joined);
}

/** A piece of a line that is never broken, such as a command to type, and the space before it. */
interface Word {
	readonly gap: string;
	readonly spans: Line;
}

/**
 * Words as lines no wider than `width`, broken only between words, as a paragraph is: a command
 * a person may copy stays on one line. A word wider than the line has a line of its own.
 */
const wrapped = (words: readonly Word[], width: number): readonly Line[] => {
	const lines: Span[][] = [];
	let line: Span[] = [];
	let used = 0;
	for (const word of words) {
		const w = word.spans.reduce((sum, s) => sum + widthOf(s.text), 0);
		if (line.length > 0 && used + word.gap.length + w > width) {
			lines.push(line);
			line = [];
			used = 0;
		}
		if (line.length > 0) {
			line.push(span(word.gap));
			used += word.gap.length;
		}
		line.push(...word.spans);
		used += w;
	}
	return line.length === 0 ? lines : [...lines, line];
};

/** A line with each run of spans in one tone made one span, and nothing empty. */
const joined = (line: Line): Line =>
	line.reduce<Span[]>((acc, s) => {
		if (s.text === "") return acc;
		const before = acc.at(-1);
		if (before !== undefined && before.tone === s.tone)
			acc[acc.length - 1] = span(before.text + s.text, s.tone);
		else acc.push(s);
		return acc;
	}, []);

/** How a terminal draws each tone: the SGR parameters to start it. `plain` draws as the text around it. */
export type Palette = Readonly<Record<Exclude<Span["tone"], "plain">, string>>;

/**
 * The 16 colors every terminal has, for a terminal whose palette tsh does not know: bold, gray,
 * dim gray, blue and yellow. gh draws its muted text the same gray (`black+h`).
 */
export const ANSI: Palette = {strong: "1", muted: "90", faint: "2;90", accent: "34", warning: "33"};

/** The lines as one text in color, for a terminal: each tone started and reset, a new line after each. */
export const paint = (lines: readonly Line[], palette: Palette, newline = "\n"): string =>
	lines
		.map((line) =>
			line
				.map((s) => (s.tone === "plain" ? s.text : `\x1b[${palette[s.tone]}m${s.text}\x1b[0m`))
				.join("")
				.trimEnd(),
		)
		.join(newline);

/** The lines as one text with no color, for anything that is not a terminal. */
export const plain = (lines: readonly Line[]): string =>
	lines
		.map((line) =>
			line
				.map((s) => s.text)
				.join("")
				.trimEnd(),
		)
		.join("\n");
