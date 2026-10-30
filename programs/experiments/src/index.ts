import {defineProgram, output} from "@kampus/fabrika";
import {dayLabel, dayOf, Experiment} from "@kampus/pipeline/experiments/experiment";
import {Experiments} from "@kampus/pipeline/experiments/experiments";
import {Clock, Effect, Schema} from "effect";

// Every experiment on the ledger, newest first, as `gh pr list` lists pull requests: one row each,
// then the list as markdown, and it ends. It reads through the `Experiments` service and writes
// nothing.
//
//   tsh> experiments                  a table: one screen of rows, and what to type for the rest
//
//   Experiments  171 · newest first
//
//     #     TITLE                                                   RUNS   UPDATED
//     171   Can the app host run the ledger as Alchemy's local…        1   Oct 30
//     170   The experiments program, on today's ledger (part 1)        0   Oct 30
//
//   151 more.  experiments --all for every row, experiment --n 171 | markdown to read one.
//
//   tsh> experiments --all            every row
//   tsh> experiments | markdown       the list as a table, drawn in a window; nothing printed
//
// A row is data; the table is how tsh shows it to a person (`person` on `row`), and `tsh --json`
// prints each row whole. `markdown` is for a pipe or a window, so tsh prints it only into one. No
// machine: it reads once and sends, as `seq` does, so it keeps no state and has no window.

/** A run that is not over, or did not end well: said in the runs cell, where a person looks. */
const runsCell = (row: Experiment) => {
	const status = row.latest?.status;
	if (status === "running") return {text: `running ${row.runs}`, tone: "accent"} as const;
	if (status === "failed" || status === "killed")
		return {text: `${status} ${row.runs}`, tone: "warning"} as const;
	return row.runs === 0 ? ({text: "0", tone: "faint"} as const) : String(row.runs);
};

export const experiments = defineProgram({
	name: "experiments",
	description:
		"Every experiment on the ledger, newest first: one row each, with its number, title, run count, day and latest run, then the list as markdown. It ends once it has sent them.",
	inputs: {},
	outputs: {
		row: output(Experiment, "One experiment: its number, title, day, run count and latest run.", {
			person: {
				table: {
					title: "Experiments",
					note: "newest first",
					columns: [
						{header: "#", cell: (row) => row.n, muted: true},
						{header: "Title", cell: (row) => row.title},
						{header: "Runs", cell: runsCell, align: "right", muted: true},
						{
							header: "Updated",
							// Read against today when it is printed: `Oct 30`, with the year only for another year.
							cell: (row) => (row.date === null ? "" : dayLabel(row.date, dayOf(Date.now()))),
							muted: true,
						},
					],
					cut: "Title",
					next: (first) => [{line: `experiment --n ${first.n} | markdown`, for: "to read one"}],
				},
			},
		}),
		markdown: output(Schema.String, "The list as a markdown table, once, after the rows.", {
			person: "none",
		}),
	},
	main: ({send}) =>
		Effect.gen(function* () {
			const rows = (yield* (yield* Experiments).list()).toReversed();
			for (const row of rows) yield* send("row", row);
			yield* send("markdown", Experiment.toMarkdown(rows, dayOf(yield* Clock.currentTimeMillis)));
		}),
});
