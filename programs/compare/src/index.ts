import {defineProgram, flag, output} from "@kampus/fabrika-old";
import {Comparison, ExperimentId, RunId, RunLabel} from "@kampus/pipeline/experiments/experiment";
import {Experiments, ExperimentsFailed} from "@kampus/pipeline/experiments/experiments";
import {Effect, Schema} from "effect";

// Two runs of one experiment, side by side: every metric, then the cases whose scores changed,
// as data and then as markdown, and it ends. Left out, the two runs are the experiment's last two.
// It reads through the `Experiments` service and writes nothing.
//
//   tsh> compare --n 170                    one line for a person; the markdown is not printed
//   170-1 against 170-2: 1 metric, 1 case changed, 0 the same
//
//   tsh> compare --n 170 --a 170-1 --b 170-3 | markdown
//   tsh> compare --n 170 --a 170.49af0a19b683 --b 170-3     an id where a label may have moved
//
//   tsh> compare --n 171                    fails: 171 has fewer than two runs

/** A run as a person names it on the line: its label, as the tables show it, or its id. */
const Pick = Schema.Union([RunLabel, RunId]);
type Pick = typeof Pick.Type;

export const compare = defineProgram({
	name: "compare",
	description:
		"Two runs of one experiment, metric by metric, then the cases whose scores changed, as data and then as markdown. Left out, the runs are its last two. It ends once it has sent them.",
	flags: {
		n: flag(ExperimentId, "The experiment's number."),
		a: flag(
			Schema.UndefinedOr(Pick),
			"The first run: its label, such as 170-1, or its id. Left out: the one before the last.",
		),
		b: flag(
			Schema.UndefinedOr(Pick),
			"The second run: its label, such as 170-2, or its id. Left out: the last.",
		),
	},
	inputs: {},
	outputs: {
		comparison: output(
			Comparison,
			"Every metric in both runs, and the cases whose scores changed.",
			{person: {line: Comparison.toLine}},
		),
		// For a pipe or a window: tsh prints it only into one.
		markdown: output(
			Schema.String,
			"The comparison as markdown: a table of metrics, then of cases.",
			{person: "none"},
		),
	},
	main: ({flags, send}) =>
		Effect.gen(function* () {
			const experiments = yield* Experiments;
			const runs = yield* experiments.runs(flags.n);
			// A label is read here, against the runs just read, and turned into a run: what the
			// service is asked for next is the run's id.
			const pick = (name: Pick | undefined, back: number) =>
				name === undefined ? runs.at(-back) : runs.find((r) => r.run === name || r.label === name);
			const a = pick(flags.a, 2);
			const b = pick(flags.b, 1);
			if (a === undefined || b === undefined)
				return yield* new ExperimentsFailed({
					why: "no_run",
					says: `compare needs two runs of ${flags.n}, and ${flags.n} has ${runs.length}`,
				});
			const comparison = Comparison.fromRuns(
				a,
				b,
				yield* experiments.cases(a.run),
				yield* experiments.cases(b.run),
			);
			yield* send("comparison", comparison);
			yield* send("markdown", Comparison.toMarkdown(comparison));
		}),
});
