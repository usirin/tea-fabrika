import {defineProgram, output} from "@kampus/fabrika";
import {Experiment} from "@kampus/pipeline/experiments/experiment";
import {Experiments} from "@kampus/pipeline/experiments/experiments";
import {Effect, Schema} from "effect";

// Every experiment on the ledger, as `ls` lists files: one row each, then the list as markdown,
// and it ends. It reads through the `Experiments` service and writes nothing.
//
//   tsh> experiments
//   row (170, The experiments…, 1, …)       one per experiment, by number
//   markdown # Experiments…                  the list as a table, once
//
//   tsh> experiments | markdown              the table, drawn
//
// No machine: it reads once and sends, as `seq` does, so it keeps no state and has no window.

export const experiments = defineProgram({
	name: "experiments",
	description:
		"Every experiment on the ledger: one row each, with its number, title, how many runs and the latest run's headline metric, then the list as markdown. It ends once it has sent them.",
	inputs: {},
	outputs: {
		row: output(Experiment, "One experiment, by number: its title, run count and latest run."),
		markdown: output(Schema.String, "The list as a markdown table, once, after the rows."),
	},
	main: ({send}) =>
		Effect.gen(function* () {
			const rows = yield* (yield* Experiments).list();
			for (const row of rows) yield* send("row", row);
			yield* send("markdown", Experiment.toMarkdown(rows));
		}),
});
