# Experiments: a bare-bones experiment platform, behind a service

Proposed 2026-10-29. Experiment 170 builds the smallest version of fabrika's
own experiment platform: a few small programs over an `Experiments` service.
Our ledger is the first implementation. A hosted platform (MLflow, Langfuse,
Weights & Biases) can be a second one later, the way GitHub sits behind
`CodeHost` ([backend as a library](./backend-as-a-library.md)).

```ts
// A sketch. The service, in the industry's words: MLflow's experiment, run,
// params, metrics, tags and artifacts; Langfuse's dataset, item and score.
export class Experiments extends Context.Service<Experiments, {
	readonly list: () => Effect.Effect<readonly Experiment[]>;
	readonly open: (n: ExperimentId) => Effect.Effect<ExperimentPage>;   // the write-up, as data, and its runs
	readonly start: (n: ExperimentId, run: RunPlan) => Effect.Effect<RunId>;
	readonly log: (run: RunId, what: RunLog) => Effect.Effect<void>;     // a metric, a case's result, an artifact
	readonly end: (run: RunId, how: RunEnd) => Effect.Effect<void>;
	readonly runs: (n: ExperimentId) => Effect.Effect<readonly RunRecord[]>; // what compare reads
	readonly cases: (run: RunId) => Effect.Effect<readonly CaseResult[]>;   // and, case by case, this
}>()("Experiments") {}

// One run's record: what field/runs.jsonl holds by hand today, as one shape.
const RunRecord = Schema.Struct({
	run: RunId, experiment: ExperimentId, at: Schema.Number,
	params: Schema.Record(Schema.String, Schema.Unknown),   // model, effort, prompt version, case set
	metrics: Schema.Record(Schema.String, Schema.Number),   // agreement, false alarms, ms
	usd: Schema.Number, tokens: Tokens,                     // one name each, never six
	artifacts: Schema.Array(BlobRef),                       // big files, in Blobs, by hash
	job: TraceId,                                           // the run's job: its trace and its agents' content
});

// One case's result in a run: Langfuse's dataset run item and its scores.
const CaseResult = Schema.Struct({
	run: RunId,
	item: Schema.String,                                    // the case: "ticket-41", "pr-44"
	output: Schema.Unknown,                                 // what came back; a big one goes in Blobs, by hash
	scores: Schema.Record(Schema.String, Schema.Number),    // agreed: 1, ms: 840
});

// tsh> experiment 170 --run --cases 5     estimate $0.40 for 5 of 120 cases; ask the owner
// owner answers yes                        5 cases run as one job; each case logs its result
// tsh> compare 170                         this run against the last, metric by metric,
//                                          then the cases whose scores changed
```

## The three goals of experiment 170

- **Agents do the experiment work** done by hand in a session today: run the
  script, read the numbers, write it up. That shows what to build around
  them.
- **The building blocks for experiments in any fabrika project.** A project
  that builds something other than fabrika runs its experiments on its own
  ledger, and nobody has to wonder whether a repo is public. This repo can
  keep its copies in `experiments/` as well.
- **Built only from the building blocks we have.** Where one does not fit,
  that is a gap to harden before a release candidate. The map of 44 blocks
  found 8 needs: 4 covered with a change, 4 missing.

## Not folded into the tracker

- An experiment has its own facts on the ledger (`experiments/170/...`) and
  its own fold, the way the tracker has its own. They share only the ledger.
- Why: a ticket is work someone owns until it is done. An experiment is a
  question with runs and numbers. Folding one into the other gives ticket
  facts fields only experiments use.
- An experiment can still link to a ticket, as a ticket links to a pull
  request.

## Small programs, the way the tracker split

| Program | What it does |
|---|---|
| `experiments` | the list: number, title, latest run, its headline metric |
| `experiment 170` | one experiment: its write-up drawn from data, its runs |
| `compare 170` | two runs, metric by metric, then case by case |
| `markdown` | draws any markdown it is given, like `glow` or `less`; not only for experiments |
| a run | a job that starts the `claude` and `codex` programs (agents are programs, proposed in [PR 190](https://github.com/usirin/tea-fabrika/pull/190)) |

- The write-up is data, and markdown is a view made from it
  ([data first](./data-first-markdown-is-a-view.md)).
- Where the split goes too far is one of the things experiment 170 measures.

## Behind a service, so a platform can plug in

- The service's words come from MLflow
  ([tracking](https://mlflow.org/docs/latest/ml/tracking/): experiment, run,
  parameters, metrics, tags, artifacts) and Langfuse
  ([datasets and experiments](https://langfuse.com/docs/evaluation/experiments/overview):
  dataset, item, run, score). A second implementation is then a mapping, not
  a rewrite.
- **Not in experiment 170.** The ledger implementation comes first and can
  grow into a full platform of our own. A hosted one plugs in later, if a
  project wants it.
- MLflow has a REST API for runs, and so would map cleanly. Langfuse says it
  has no public REST endpoint to create experiment runs
  ([data model](https://langfuse.com/docs/evaluation/experiments/data-model)),
  so an adapter to it would go through its SDK or OpenTelemetry.
- The run's job keeps its trace in its own JobRecord, as every job does
  ([a JobRecord holds each host job](./a-job-record-holds-its-trace.md)).
  The run record points at it by trace id.

## Each case keeps its own result

- Most of our experiments ask a question case by case: did Jev agree with
  the agent on ticket 41, did a check raise a false alarm on PR 44. A run's
  metrics are totals, so they show that agreement moved, not on which cases.
- So a run holds one `CaseResult` per case: the case, what came back, and its
  scores. This is Langfuse's dataset run item with its scores
  ([data model](https://langfuse.com/docs/evaluation/experiments/data-model)).
  MLflow keeps the same thing as an evaluation table on the run.
- `compare` reads both: the totals first, then the cases whose scores changed.
- A run's metrics can be worked out from its cases; a run without cases
  (a flood test, a timing) logs its metrics directly.

## Money: estimate, try a few, then the rest

AGENTS.md asks for this before any paid run. Here it becomes a combo that
cannot be skipped, built from moves we have.

```ts
// A sketch, as moves.
Gather  count the cases, read the price per case from the last runs
Check   estimate = cases x price; over the project's limit: stop
ask     the owner sees the estimate's exact text: cost, cases, model
Act     setLimits(run, estimate)      the approval sets the limit, person-only
spawn   5 cases first; the owner looks; then the rest, under the same limit
```

- It needs one meter for money (tracker #91) and one way to ask a person
  (tracker #90). Both are gaps the map found.

## Gaps it closes, in order

- The app host runs the Miniflare twin (tracker #88), so the laptop has
  JobRecords at all.
- Every stage reaches agents through the `Agents` service (tracker #89).
- One way to ask a person (#90) and one meter for money (#91).
- The JobRecord's `summary` table, as the run record's home.
- `Blobs`, for artifacts. Today it exists only in notes.
- A list of an experiment's runs, for `compare`. `Traces` reads one trace by
  id.

## How sure

- **75% on the shape** (a service, its own facts, small programs). The
  doubt: whether a run record with free-form `params` and `metrics` is
  enough for every old experiment. The survey found 6 names for cost and 58
  result files with no number; most old ones would stay read-only
  write-ups. New experiments are written to it, with one result per case,
  so for them the doubt is smaller.
- **75% on one result per case.** The doubt: whether a case's output is
  often too big for a row. Blobs takes the big ones; how often that happens
  shows in the first runs.
- **60% on MLflow's and Langfuse's words over a shape of our own.** They fit
  the run record well. The doubt is whether "dataset" fits our cases, which
  are often tickets read from the ledger.

## What this cannot tell us yet

- Whether agents write a useful write-up. Only reading a few would show it.
- Which hosted platform, if any, a project would plug in.
- How many old experiments fit the run record without a rewrite.
