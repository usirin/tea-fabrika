# 170. The experiments program, on today's ledger (part 1)

**Answer.** Yes, it builds from the blocks we have, with 16 gaps, none of them a blocker for
part 1. One is closed since: a run now has a key from its caller, so a second import adds
nothing, and the run's id is made from that key, so no change to the fold can move it. An
`Experiments` service keeps each experiment's facts on the ledger under
`experiments/<n>/inbox`, with its own fold. Four small programs read it: `experiments`,
`experiment`, `compare` and `markdown`. The importer read the whole old log into a ledger in
memory in about 0.7 seconds: 167 write-ups and 180 results files, of which 148 fit the run
record. Only 7 of the 20 experiments with two or more old runs can be compared on a shared
metric, so most old results stay something to read, not something to compare. $0, no key, no
model.

```ts
// The whole idea: an experiment is a stream of facts; a run is a few of them; programs read the fold.
const experiments = yield* Experiments;                       // on the ledger, or a ledger in memory
yield* experiments.create("170", "The experiments program");
const plan = {key: "job-7f3a", params: {model: "jev"}, tags: {}, job: null};  // the key: the caller's
const run = yield* experiments.start("170", plan);            // "170.49af0a19b683", from the key, every time
yield* experiments.log(run, [
	{kind: "case", item: "ticket-41", output: "yes", scores: {agreed: 1}},
	{kind: "metric", key: "agreed", value: 1},
]);
yield* experiments.end(run, {status: "finished", usd: 0.01, tokens: {input: 900, output: 30}});
// tsh> experiment --n 170 | markdown       the page, drawn in a window; this run's label is 170-1
// tsh> compare --n 170                     the last two runs, metric by metric, then case by case
```

Part 1 of the design in
[experiments behind a service](../docs/direction/experiments-behind-a-service.md). Tracker
ticket [#95](https://github.com/usirin/tea-fabrika/issues/95) holds the updates. No run here
starts an agent or spends money: that is part 2, after tracker #88, #89, #90 and #91.

## What was built

| Part | Where | Lines |
|---|---|---|
| Facts, fold, run record, comparison, markdown views | `packages/pipeline/src/experiments/experiment.ts` | 654 |
| `Experiments`, the service on the ledger | `packages/pipeline/src/experiments/experiments.ts` | 292 |
| The importer: `transform` (files to facts) and `load` (through the service) | `packages/pipeline/src/experiments/import.ts` | 469 |
| `experiments`, the list | `programs/experiments/` | 32 |
| `experiment`, one page | `programs/experiment/` | 39 |
| `compare`, two runs | `programs/compare/` | 73 |
| `markdown`, any markdown in a window | `programs/markdown/` | 308 |

- Tests beside each part: 34 tests, all on a ledger in memory, with laws for run keys and for
  `markdown`'s one machine, and one app test that lists the new inputs agents can drive.
- `markdown` reads its inputs through the one mailbox (pull request
  [#195](https://github.com/usirin/tea-fabrika/pull/195)): `serve` with a handler for `text` and
  one for `do`, a quit is `end`, and `until: ["do"]`, so a pipe's end does not end the window.
- The fabrika app lists all four programs and knows `markdown`'s window. The three that read
  experiments get the service over the app's own ledger, read-only.

## The service

The words are MLflow's (experiment, run, params, metrics, tags, artifacts, `log_batch`) and
Langfuse's (dataset item, score). The design's sketch had no way to put an experiment or its
write-up on the ledger, so `create` and `write` were added.

```ts
export class Experiments extends Context.Service<Experiments, {
	readonly list: () => Call<readonly Experiment[]>;                   // number, title, runs, latest
	readonly create: (n: ExperimentId, title: string) => Call<void>;
	readonly write: (n: ExperimentId, writeUp: WriteUp) => Call<void>;  // the write-up, as data
	readonly open: (n: ExperimentId) => Call<ExperimentPage>;
	readonly start: (n: ExperimentId, plan: RunPlan) => Call<RunId>;    // one run per plan.key: "170.49af0a19b683"
	readonly log: (run: RunId, what: readonly RunLog[]) => Call<void>; // a batch, as MLflow's log_batch
	readonly end: (run: RunId, how: RunEnd) => Call<void>;
	readonly runs: (n: ExperimentId) => Call<readonly RunRecord[]>;
	readonly cases: (run: RunId) => Call<readonly CaseResult[]>;
}>()("Experiments") {}

type Call<A> = Effect.Effect<A, ExperimentsFailed>;
// ExperimentsFailed {why: "unreachable" | "no_experiment" | "no_run" | "ended" | "key_reused" | "id_taken" | "refused" | "bad_fact", says}

export const experimentsOnLedger: (writer: Writer) => Layer.Layer<Experiments, never, Ledger>;
```

- In memory is the same layer over `memoryService()`, the ledger in memory. No second
  implementation was needed.
- Every write has its own message id, so a write sent again lands once: `created`,
  `written/<hash>`, `started/<run>`, `metric/<run>/<key>`, `case/<run>/<item>`,
  `artifact/<run>/<path>`, `ended/<run>`, where `<run>` is the run's id.
- A start's key comes from its caller, as a Stripe idempotency key does: a job's trace id, or
  `import/experiments/results/<file>` for an imported run. A caller with none, such as a person
  starting a fresh run, makes one before its first try and keeps it for its retries. The key is
  a field of `RunPlan` that is not optional, so a start without one does not type.
- A run has two names, as MLflow has a run's `run_id` and its `run_name`. Every fact that points
  at a run uses its id, and the label is only for people:

  ```ts
  runIdOf("170", "job-7f3a")    // "170.49af0a19b683": the experiment, a dot, 12 hex of SHA-256 of the key
  record.label                  // "170-1": its place among the runs, made by each read, never stored

  experiments.log("170.49af0a19b683", logs)   // types
  experiments.log("170-1", logs)              // does not: RunId is `${string}.${string}`, RunLabel `${string}-${number}`
  ```

- Why a hash and not the key: a key is up to 256 characters of anything, such as
  `import/experiments/results/167-duplicate-hint.json`, and the id goes into message ids and
  tables. Why 12 hex characters: 48 bits. With 1,000 runs in one experiment the chance that two
  keys share an id is about 1 in 560 million (the birthday bound, n²/2⁴⁹). The hash is SHA-256
  in plain code (`sha256Hex` in `@kampus/fabrika`, the one under `runTraceId`), so the fold can
  make the id at once, on any platform; Web Crypto's digest waits.
- Why two types and not a brand: a program's flags and outputs take only a schema whose two
  sides are one type, and a brand's are not. A template literal is, and TypeScript keeps
  `${string}.${string}` and `${string}-${number}` apart. A test holds a label, a label read off
  a record and a plain string to not type as a run id.
- When two keys do share an id, the second is refused, never merged into the first run. `start`
  fails `id_taken`, after the first or at the same time (the ledger keeps one `started/<run>`,
  and the second reads back a run with another key). A start with that id written by hand is
  kept out by the fold as a problem. The test uses a real pair: `k13051066` and `k36814461` both
  make `93c55fefa810`, found by hashing 48 million keys once, in 32 seconds.
- Two starts with one key at once: the ledger keeps the first, the second is its `dup`, and both
  read back the same run. Two keys at once: both land, each under its own id; the ledger's order
  only picks their labels. A test holds two starts until both have read, the worst order. A law
  holds that any order of starts gives one run per key and the same id for each key.
- The same key with another plan fails `key_reused`, as Stripe refuses a key reused with other
  parameters. Returning the first run instead would log the second plan's results under the
  first plan's params.
- `compare --a` and `--b` take a label or an id. A label is read against the runs just read and
  turned into the run's id before anything is asked of the service.
- A log or an end sent again after its run ended is no change, so a second import is all
  `dup`s. A log the run does not hold yet, or an end another way, still fails `ended`.

## The facts

Five facts, by `type`, on the experiment's inbox. A run is not a stream of its own: the ledger
refuses a name registered inside another registered name, so `experiments/170/1` cannot exist
beside `experiments/170`.

```ts
export const Fact = Schema.Union([
	Schema.Struct({type: Schema.Literal("created"), title: Title}),
	Schema.Struct({type: Schema.Literal("written"), ...WriteUp.fields}),        // date, answer, headline, sections
	Schema.Struct({type: Schema.Literal("started"), ...RunPlan.fields}),         // key, params, tags, job; the id is runIdOf(key)
	Schema.Struct({type: Schema.Literal("logged"), run: RunId, what: RunLog}),   // metric | case | artifact
	Schema.Struct({type: Schema.Literal("ended"), run: RunId, ...RunEnd.fields}),  // status, usd, tokens
]);

// What the fold makes of one run: what field/runs.jsonl holds by hand today, as one shape.
class RunRecord { run; label; experiment; key; at; status; params; tags; metrics; usd; tokens; artifacts; job; ended }
// One case's result in a run: Langfuse's dataset run item and its scores.
const CaseResult = Schema.Struct({run: RunId, item: Item, output: Schema.Unknown, scores: Metrics});
```

## One step of the fold

The fold reads every row under `experiments/`, in order, and steps each experiment. A fact
that does not fit is not dropped silently: it becomes a problem with its row number.

```ts
const step = (kept: Kept | undefined, entry: Entry): Kept | string => {
	const {fact} = entry;
	const where = `row ${entry.pos} on ${entry.experiment}`;
	if (fact.type === "created")
		return kept === undefined
			? {page: {n: entry.experiment, title: fact.title, writeUp: null, runs: []}, cases: []}
			: `${where}: created a second time`;
	if (kept === undefined) return `${where}: ${fact.type}, but the experiment was never created`;
	const wrong = misfit(kept, fact);       // started twice, id taken, never started, after it ended, logged twice
	if (wrong !== null) return `${where}: ${wrong}`;
	switch (fact.type) { /* written, started, ended, logged: the page after it */ }
};

fold(rows).problems;   // a log before `created`, an end with no start, a second `created`
// ["row 2 on 170: logged, but the experiment was never created",
//  "row 4 on 170: run 170.66b1eb530fb7 ended, but it never started",
//  "row 5 on 170: created a second time"]
```

A fact that points at a run by its label, `{type: "ended", run: "170-1", ...}`, is not a fact:
`readRow` reads its row as broken.

## One call, and its answer

```ts
yield* call(compare, {n: "170", a: undefined, b: undefined});
// {kind: "called", ended: {kind: "ended"}, heard: [
//   {name: "comparison", value: {a: {run: "170.e063cdf36f81", label: "170-2"}, b: {run: "170.2a8c9f051e91", label: "170-3"},
//     metrics: [{key: "agreed", a: 1, b: 0.67}],
//     cases: [{item: "t-1", a: {agreed: 1}, b: {agreed: 0}}], same: 2}},
//   {name: "markdown", value: "# 170-2 against 170-3\n\n| Metric | 170-2 | 170-3 |\n..."}]}

yield* call(compare, {n: "171", a: undefined, b: undefined});
// ended: failed, ExperimentsFailed {why: "no_run", says: "compare needs two runs of 171, and 171 has 1"}
```

On the imported log, `compare --n 77b` picks the last two runs of 77b, `77b-5` and `77b-6`
(ids `77b.41ec7d6d2fc0` and `77b.efc07e2fc25f`), and shows `totalUsd` and `usd` side by side,
with one case changed.

## The gaps

Each block from the map of building blocks that did not fit as it was, what part 1 needed, and
what was done instead.

| Block | Needed | What was done |
|---|---|---|
| The design's `Experiments` sketch | A way to put an experiment and its write-up on the ledger | Added `create` and `write` |
| The sketch's `log`, one item | Thousands of cases per run: each `log` reads the run's stream to check it is still running | `log` takes a list, as MLflow's `log_batch` |
| Ledger names | A run as a stream of its own | Refused: a name inside a registered name. A run is facts on its experiment's inbox, named by message id |
| Ledger message ids | A start sent twice lands once | Done: a key from the caller makes the run's id, `started/<id>`. A second load of the whole old log added 0 rows (tests and the script show it) |
| Blobs (block 34) | Artifacts and big case outputs, by hash | Missing. An artifact is a repo path; a case output is kept whole in its fact |
| JobRecord `summary` (block 32) | The run record's home | Not built. The run record lives in the fold; `job` is a trace id or `null`, `null` for every imported run |
| `Traces` | A list of an experiment's runs, for `compare` | `Traces` reads one trace by id; `runs(n)` comes from the fold |
| One meter for money (#91) | Dollars and tokens under one name each | Not built. `usd` and `tokens` may be `null`: nobody measured them |
| One way to ask a person (#90) | The estimate shown and approved before a paid run | Not built. No run here starts anything |
| The `Agents` service (#89) and the twin (#88) | A run that starts agents as a job | Not built. Runs are only logged |
| Writer kinds | A write-up only a person may approve | None. Any writer may write any fact |
| A markdown reader | Write-ups read into blocks for a window | None in the repo. A small reader in mdast's names (`programs/markdown/src/root.ts`); the known way is `mdast-util-from-markdown`, a dependency to choose |
| tsh's short printer (blocks 43, 24) | A page drawn in a terminal, as `less` does | It cuts any text past 24 characters. `markdown` draws only in a window |
| A program's view | A window for `experiments`, `experiment`, `compare` | A view needs a machine; a read-once program has none. They send markdown to `markdown` instead |
| `Schema.TaggedError` with `says` | A failed run that prints why | `Cause.pretty` prints `ExperimentsFailed:` and no words, the same as `TicketsFailed`. Tests read the error's value |
| A metric's history | MLflow's steps: one key, many values | One value per key per run; a second is refused |

- The old runs' time is unknown: `at` is the import's time, and the write-up's date is a tag.
- The pipe needed no change: tsh wires the one text output of `experiments`, `experiment` and
  `compare` into `markdown`'s one text input on its own (a test checks all three lines).

## Where the split went too far

- `experiments`, `experiment` and `compare` are 32, 39 and 63 lines. Each also needs a
  `package.json` (23 lines), a `tsconfig.json`, a README, and a line in five places: the root
  `package.json`, the app's `package.json`, the app's program list, and two READMEs.
- So for these three the package costs more lines than the program. Their logic is in the
  service and in `toMarkdown`, which are shared. The split as programs is right (each is one
  name on a tsh line); one package each is more than they need.
- `markdown` is the split that earned its place: 311 lines, its own window, and any program can
  pipe into it.

## The import

Read-only, into a ledger in memory. Nothing from an old write-up is written anywhere: the
results file holds counts only, and the names of cost keys stay on the console.

| Count | Value | What it means |
|---|---|---|
| Write-ups | 167 | `NN-title.md` files, one experiment each; no number is used twice |
| In the README's table | 164 | 165 with a date, 164 with an answer |
| Title from the file name | 0 | Every write-up has a `# NN. Title` line |
| Results files | 180 | All of them JSON that reads |
| With a number in the name | 122 | |
| With no number | 58 | The design's survey counted 58 too |
| Placed by the script that names them | 37 | 3 named by more than one script: the lowest number wins, a guess |
| Placed nowhere | 21 | Kept out |
| Fit the run record | 148 | A metric, or a case with a score |
| No number anywhere | 4 | Words only |
| With cases | 110 | 7,379 cases in all |
| With dollars | 39 | |
| With tokens | 1 | Most token counts are per case or per call, not per run |
| Metrics kept | 4,690 | At most 200 per run; 20,845 more were cut |
| Names for cost | 24 | `usd`, `costUsd`, `totalUsd`, `spentUsd`, `cost`, `dollars` and 18 more |
| Names for tokens | 29 | `input_tokens`, `inputTokens`, `tokensIn` and 26 more |
| Experiments with 2 or more runs | 20 | |
| Of those, last two share a metric | 7 | The only ones `compare` can say much about |

- 13,016 ledger rows; transform 298 ms, load 430 ms on one laptop, in one run. Loaded a second
  time, in 659 ms, it added 0 rows: every start, log and end was already there, each run found
  by the id its results file's key makes.
- The counts move as the log grows: experiment 157's second round landed during this work and
  added one results file, one run and one comparable experiment. The rerun after the run id
  change read 4 more write-ups and 5 more results files that had landed on main since. The first
  run counted 163 write-ups, 175 results files, 144 runs and 6 comparable experiments. The
  script reads the log as it is when it runs.
- The design said "6 names for cost". The count here is 24 with a strict rule (a key that says
  usd, dollar, cost, price, or is exactly spend or spent). An earlier, loose rule that also
  matched a parent's name said 68. Both say the same thing: one meter for money (#91) is needed.

Run it with:

```sh
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY node experiments/170-experiments-program.ts
```

## What to do next

- **Write new experiments to the service; keep the old ones as write-ups.** Why: 148 old
  results fit the run record, but only 7 experiments have runs that compare. The old log is for
  reading. Cost: none now; the import can run once into the real ledger when the owner says so.
  How sure: 85%.
- **Done: an id for a run, from the caller.** A retried start made a second run, and a second
  import doubled every run. Now `plan.key` names the run. The guess was "one field and one
  test"; it took one field, `log` and `end` learned to take a write sent again after the run
  ended, three new tests and a law. The doubt that stays: no caller today lacks a key, so the
  "make one before the first try" rule for a person's fresh run is written down but not yet
  used by any program.
- **Done, and wrong the first time: the run's id from its key, not its order.** The first try
  above numbered runs by the order their starts landed, `170-3`, and pointed every log and end
  at that number. The ledger never deletes, so a later change to which starts the fold counts
  would have moved the numbers and attached old cases and ends to another run. Now the id is
  `runIdOf(n, key)` and the number is only a label. Cost: the ids are longer to type, so
  `compare` still takes a label. How sure: 90%. The doubt: 48 bits is a guess at "enough"; a
  shared ledger with millions of runs in one experiment would want more.
- **One package for the three read-only programs, or none.** Why: each package costs more than
  its program. Cost: a move and a rename of imports. How sure: 60%. The doubt: the tracker's
  split put one program in each package on purpose, and the owner may want that rule kept. What
  would settle it: a fourth read-only program, to see whether the cost repeats.
- **Give `ExperimentsFailed` and `TicketsFailed` a `message`.** Why: a failed line in tsh says
  nothing today. Cost: a few lines each. How sure: 90%.

## What this cannot tell us

- Whether agents write a useful write-up: no agent ran.
- Whether a case output is often too big for a fact: the largest imported runs were not
  measured by size.
- Whether `markdown` reads every write-up well: its reader is small, and no one has looked at
  all 167 pages drawn.
- Whether a label that moves misleads someone: a write-up that cites `170-3` still means the
  third run only while the fold counts the same starts. Citing the id is the lasting way, and no
  write-up does it yet.
- How the service does on a shared ledger over the network: everything here ran in memory.
- Whether placing a results file by the script that names it is right: 37 were placed that way,
  and none was checked by hand.
