import {defineProgram, flag, output} from "@kampus/fabrika";
import {ExperimentId, ExperimentPage} from "@kampus/pipeline/experiments/experiment";
import {Experiments} from "@kampus/pipeline/experiments/experiments";
import {Effect, Schema} from "effect";

// One experiment: its page as data (the write-up and its runs), then the same page as markdown,
// a view made from the data, and it ends. It reads through the `Experiments` service and writes
// nothing.
//
//   tsh> experiment --n 170
//   page (170, The experiments…, …)        the write-up, as data, and its runs
//   markdown # 170: The experiments…       the page as markdown, once
//
//   tsh> experiment --n 170 | markdown      the page, drawn
//
//   tsh> experiment --n 404                 fails: no experiment 404 on the ledger

export const experiment = defineProgram({
	name: "experiment",
	description:
		"One experiment: its write-up as data and its runs, then the same page as markdown. It ends once it has sent them.",
	flags: {
		n: flag(ExperimentId, "The experiment's number, as its write-up spells it: 01, 104c, 170."),
	},
	inputs: {},
	outputs: {
		page: output(ExperimentPage, "The experiment: its title, its write-up as data, its runs."),
		markdown: output(
			Schema.String,
			"The page as markdown: the answer first, the sections, the runs.",
		),
	},
	main: ({flags, send}) =>
		Effect.gen(function* () {
			const page = yield* (yield* Experiments).open(flags.n);
			yield* send("page", page);
			yield* send("markdown", ExperimentPage.toMarkdown(page));
		}),
});
