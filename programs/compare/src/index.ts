import {defineProgram, flag, output} from "@kampus/fabrika";
import {Comparison, ExperimentId, RunId} from "@kampus/pipeline/experiments/experiment";
import {Experiments, ExperimentsFailed} from "@kampus/pipeline/experiments/experiments";
import {Effect, Schema} from "effect";

// Two runs of one experiment, side by side: every metric, then the cases whose scores changed,
// as data and then as markdown, and it ends. Left out, the two runs are the experiment's last two.
// It reads through the `Experiments` service and writes nothing.
//
//   tsh> compare --n 170
//   comparison (170-1, 170-2, …)            metrics [{key: "agreed", a: 0.5, b: 1}], cases that changed
//   markdown # 170-1 against 170-2…         the same, as two tables
//
//   tsh> compare --n 170 --a 170-1 --b 170-3 | markdown
//
//   tsh> compare --n 171                    fails: 171 has fewer than two runs

export const compare = defineProgram({
	name: "compare",
	description:
		"Two runs of one experiment, metric by metric, then the cases whose scores changed, as data and then as markdown. Left out, the runs are its last two. It ends once it has sent them.",
	flags: {
		n: flag(ExperimentId, "The experiment's number."),
		a: flag(
			Schema.UndefinedOr(RunId),
			"The first run, such as 170-1. Left out: the one before the last.",
		),
		b: flag(Schema.UndefinedOr(RunId), "The second run, such as 170-2. Left out: the last."),
	},
	inputs: {},
	outputs: {
		comparison: output(
			Comparison,
			"Every metric in both runs, and the cases whose scores changed.",
		),
		markdown: output(
			Schema.String,
			"The comparison as markdown: a table of metrics, then of cases.",
		),
	},
	main: ({flags, send}) =>
		Effect.gen(function* () {
			const experiments = yield* Experiments;
			const runs = yield* experiments.runs(flags.n);
			const pick = (id: string | undefined, back: number) =>
				id === undefined ? runs.at(-back) : runs.find((r) => r.run === id);
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
