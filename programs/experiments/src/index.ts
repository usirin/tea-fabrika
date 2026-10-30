import {defineProgram, output} from "@kampus/fabrika";
import {dayOf, Experiment} from "@kampus/pipeline/experiments/experiment";
import {Experiments} from "@kampus/pipeline/experiments/experiments";
import {Clock, Effect, Schema} from "effect";

// Every experiment on the ledger, as `ls` lists files: one row each, then the list as markdown,
// and it ends. It reads through the `Experiments` service and writes nothing.
//
//   tsh> experiments
//   row 170   The experiments program…   Oct 30   1 run    170-1 finished     one line per experiment
//   markdown # Experiments                                                   the list as a table, once
//
//   tsh> experiments | markdown              the table, drawn
//
// A row is data; tsh prints it as one line in columns (`Experiment.toLine`), as `gh issue list`
// does, and `tsh --json` prints the data whole. No machine: it reads once and sends, as `seq`
// does, so it keeps no state and has no window.

export const experiments = defineProgram({
	name: "experiments",
	description:
		"Every experiment on the ledger: one row each, with its number, title, day, how many runs and the latest run's headline metric, then the list as markdown. It ends once it has sent them.",
	inputs: {},
	outputs: {
		row: output(Experiment, "One experiment, by number: its title, run count and latest run.", {
			// A line is drawn when it is printed, so its `Oct 30` is read against today then.
			line: (row) => Experiment.toLine(row, dayOf(Date.now())),
		}),
		markdown: output(Schema.String, "The list as a markdown table, once, after the rows."),
	},
	main: ({send}) =>
		Effect.gen(function* () {
			const rows = yield* (yield* Experiments).list();
			for (const row of rows) yield* send("row", row);
			yield* send("markdown", Experiment.toMarkdown(rows, dayOf(yield* Clock.currentTimeMillis)));
		}),
});
