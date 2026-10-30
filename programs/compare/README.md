# compare: `@tea-fabrika/compare`

Two runs of one experiment, side by side, as MLflow's run comparison and Langfuse's dataset run
comparison show them: every metric in either run, then the cases whose scores changed. As data,
then as markdown, and it ends. Left out, the two runs are the experiment's last two. It reads
through the `Experiments` service
([`packages/pipeline/src/experiments/`](../../packages/pipeline/src/experiments/experiments.ts))
and writes nothing. The fabrika app lists it.

```ts
import {call} from "@kampus/fabrika";
import {compare} from "@tea-fabrika/compare";

yield* call(compare, {n: "170", a: undefined, b: undefined});
// {kind: "called", heard: [
//   {name: "comparison", value: {a: {run: "170.e063cdf36f81", label: "170-2"}, b: {run: "170.2a8c9f051e91", label: "170-3"},
//     metrics: [{key: "agreed", a: 1, b: 0.67}],
//     cases: [{item: "t-1", a: {agreed: 1}, b: {agreed: 0}}], same: 2}},
//   {name: "markdown", value: "# 170-2 against 170-3\n\n| Metric | 170-2 | 170-3 |\n..."}]}

yield* call(compare, {n: "171", a: undefined, b: undefined});
// ended: failed, ExperimentsFailed {why: "no_run", says: "compare needs two runs of 171, and 171 has 1"}
```

```text
tsh> compare --n 170 --a 170-1 --b 170-3 | markdown
tsh> compare --n 170 --a 170.ed1e1dcf9719 --b 170-3
```

A run is named on the line by its label, `170-1`, as the tables show it, or by its id,
`170.ed1e1dcf9719`, made from its key. A label is its place among the runs and is read against
the runs just read; what compare asks the service for is the id.

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/compare` | `src/index.ts` | `compare`, the program: flags `n`, `a`, `b`, outputs `comparison` and `markdown`. It needs `Experiments`. |

- A case is matched by its `item` in both runs. A case in one run only is a change.
- Dollars are a metric row too, `usd`, when either run has them.
- No machine and no window, for the same reason as `experiments`.
