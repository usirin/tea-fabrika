# 122. Can an agent write a check for a plain-sentence promise that catches what the repo's own tests miss?

The question: [Promises in the pipeline](../docs/direction/promises-in-the-pipeline.md)
proposes a verify writer, an agent that is not the builder and writes one
check per promise before any code exists. Is such a check any good? This
experiment replays the step on three closed kamp-us/demlik tickets. One agent
run per ticket writes one fast-check property test from the promise and the
triaged plan alone, on the code as it was before the fix. Code then grades it:
red before the fix, green after, and the mutants it catches beside the repo's
own tests.

**Answer: yes, on one ticket of three. On the other two it caught exactly
what the pull request's own tests caught. It never caught less on the promise
itself. Confidence 70%.**

- **Red first held on all three.** Each check failed on the base commit, 3
  runs of 3, and passed on the merge commit, 3 runs of 3. No import path had
  to change. No writer touched any other file.
- **#483 (the API key):** the agent's check caught 4 mutants that no test in
  the repo caught, before or after the fix. Two are a status of exactly 400
  (`>= 400` made `> 400`), one in each client. Two are a `null` inside an
  error body, one in each client. Either would leak the key, or crash, on a
  real reply.
- **#367 (span times) and #355 (notes once):** the agent's check caught the
  same mutants as the PR's own tests, no more and no fewer.
- **The tests that existed before each fix** caught 6 of 88 valid mutants on
  #483, 7 of 11 on #367 and 2 of 6 on #355. The agent's check added 22, 1 and
  2 over them.
- **The PR's tests caught 38 on #483 that the agent's check missed.** By hand,
  all 38 are outside the promise: the account error text the same ticket
  added, the `[redacted]` marker's wording, and keeping the rest of the body.
- **#483's promise was already half kept on the base code.** The thrown error
  carried no body at all, so it could not carry the key. The check went red
  only through the plan's other place, the body `fetchPost` returns. In the
  proposal's words, half of it was `ask:owner:already_kept`. The writer said
  so in its own answer.
- **Cost:** $1.04 for the three writers, 3.5 minutes of agent time. Stryker
  took 6 minutes in all. No writer reached for the fix or the PR.

```ts
// A sketch of 122-verify-writer-replay.ts, per ticket.
const promise = "A Jev client error never carries the API key."; // approved by the owner
const plan = replay.enriched;                       // the body today's fabrika triage wrote
const writer = claudeP(promptOf(promise, plan), {    // one headless agent, not the builder
	cwd: baseTree, model: "claude-opus-5-5", tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
});                                                  // writes one fast-check test at a named path
const red = runThrice(test, baseTree);               // a new promise: must fail before the fix
const green = runThrice(test, mergeTree);            // and pass after it
const mutants = stryker({mutate: linesThePrChanged(src), checker: "typescript", runner: "command"});
for (const m of mutants) killers[m.id] = failingTests(m); // every failing test, by file and name
// a: tests that existed at baseSha, b: tests the PR added or changed, c: the agent's test
const credit = killedBy("c").minus(killedBy("a")); // what the check adds over the old tests
```

## Who did what

- **Today's fabrika:** the triaged bodies (`enriched` in `replay/issues/*.json`),
  which the writer got as its plan. The merged pull requests and their tests
  are as they landed on demlik.
- **This repo:** a script, `122-verify-writer-replay.ts`. No machine of this
  repo ran. The script plays the verify writer's slot and the grading code.
- **The verify writer:** one `claude -p` run per ticket, started by the script.
- **The promises:** the owner approved the three sentences, as worded, before
  the run.
- **The hand read** below is one agent's judging (the one that ran the
  experiment), not the owner's.

## How it was done

- **Trees:** a fresh clone of kamp-us/demlik in a scratch folder. For each
  ticket, four copies from `git archive`: the base commit, the merge commit,
  the writer's folder (the base, with a fresh one-commit git history, so
  `git log` shows nothing), and a tree for Stryker (the merge, plus Stryker).
  On #483 the two sweep packages got `fast-check` as a dev dependency in every
  tree, since they had none.
- **The writer:**
  - `claude -p --model claude-opus-5-5 --output-format json`, prompt on stdin.
  - `--tools Read,Write,Edit,Glob,Grep,Bash`, the same list pre-approved.
  - `--disallowedTools WebFetch WebSearch Bash(gh:*) Bash(curl:*) Bash(git fetch:*) Bash(git pull:*)`.
  - `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`:
    no CLAUDE.md, settings, plugins or servers. `--max-budget-usd 8`.
  - Effort left at the CLI's default. Every `CLAUDE*` variable and the Jev key
    removed from its environment.
  - The prompt: the promise, the exact path to write, "rely only on names that
    exist today or that the plan names exactly", the command to run the test,
    no network, then the plan.
- **Grading, by code:**
  1. Copy the test into the base tree and the merge tree. Run it 3 times in
     each. Keep the failure text.
  2. Stryker 9.6.1 in the merge tree, in place. It mutates only the source
     lines the PR changed, with the TypeScript checker on. A mutant the
     typecheck refuses is not counted.
  3. Each mutant runs vitest on every test file related to the mutated files
     (vitest's own `related`, computed once on the clean tree; files that fail
     clean are dropped, and none did). Each changed test file also runs as it
     was at the base commit, as a copy beside it.
  4. Every failing test of every mutant is kept, by file and full name, then
     sorted. **a:** a test that existed at the base commit (every test of a
     file the PR did not touch, and the base copies). **b:** a test the PR
     added, or changed (its text differs from the base copy). **c:** the
     agent's test. A merged test the PR left as it was counts as a.
  5. No ticket had more than 150 mutants, so none was sampled.
- **Stryker's vitest runner did not work here, so the command runner ran
  instead.** On vitest 5.0.1 the runner reported no coverage: every test
  "covered 0" and every mutant survived, in both of the configs tried. Its
  forced thread pool also broke one structure-sweep test. So, as in
  experiment 119, Stryker's command runner calls the script once per mutant,
  and the script asks vitest for its JSON report. The cost: no per-test
  coverage, so every related file runs on every mutant. It was still fast.
- `nice -n 15`, concurrency 4, one ticket at a time, each started only when no
  other Stryker ran.

## What came back

| Ticket | Red, green | Mutants | Refused | Valid | Killed | By a | By b | By c | c, not a | Only c | b, not c | Survived |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [#483](https://github.com/kamp-us/demlik/issues/483), PR [#484](https://github.com/kamp-us/demlik/pull/484) | yes, yes | 126 | 38 | 88 | 64 | 6 | 60 | 26 | 22 | 4 | 38 | 24 |
| [#367](https://github.com/kamp-us/demlik/issues/367), PR [#370](https://github.com/kamp-us/demlik/pull/370) | yes, yes | 15 | 4 | 11 | 8 | 7 | 8 | 8 | 1 | 0 | 0 | 3 |
| [#355](https://github.com/kamp-us/demlik/issues/355), PR [#375](https://github.com/kamp-us/demlik/pull/375) | yes, yes | 8 | 2 | 6 | 4 | 2 | 4 | 4 | 2 | 0 | 0 | 2 |

"Only c" is killed by the agent's test and by no test in a or b.

### #483: "A Jev client error never carries the API key."

- **The test:** two properties, run on both clients (structure-sweep, and
  backlog-sweep by a relative import). Made-up keys (`tsk_FAKE_…`), statuses
  400 to 599, and error bodies built by `fc.letrec` that repeat the key in
  their values, nested. `fetch` is faked. One property checks the body
  `fetchPost` returns, one the `JevAskError` the client throws.
- **Red on base:** the returned body still held the key, in both clients. The
  thrown-error property passed on base, because tea's `decodeJevReply` keeps
  only the status of a failed reply. The writer said this itself, and named
  what it left out: a key in a 200 reply, in a thrown `fetch` error, and in an
  object key.
- **Only c, 4:** `response.status >= 400` made `> 400` (a 400 reply is not
  redacted), and `value !== null` made `true` in `isRecord` (a `null` in a
  body crashes the redaction). The PR's tests use other statuses and no
  `null`. Both are mistakes a builder could make.
- **b, not c, 38:** 32 in the account error text (`jevErrorDetail`, the
  error's message, the status gate for it), 2 where `isRecord` takes any
  non-null value for an object, 2 that change the `[redacted]` marker, 2 that
  drop the body's fields. None lets the key out. The ticket had two parts; the
  promise covers one.
- **Survived, 24:** 12 in the detail code again, and 12 that let no key out
  (the empty-key guard, an array dropped, the marker in object keys, a body
  that does not parse, 2xx bodies redacted too).
- **Refused, 38:** among them the plainest break of the promise, skipping the
  string redaction (`typeof value === "string"` made `false`). The mutated
  code does not typecheck, since `value` is `unknown` there.
- **Hand read** (one agent's judging): fails for the right reason, on the
  half that was broken. A real property: keys, statuses and bodies vary, and
  it shrinks. It copies no logic; its check is the promise itself, "the key's
  text is not in it".

### #367: "A span's start and end are the run clock's instant, however long the process has been up."

- **The test:** one property. A start time from three ranges (below the
  process's `performance.now()`, up to 100,000, and real epoch values), plus
  four step gaps. It drives one fixed run (a brain call, a tool call, the end)
  through `agentSpans` into OpenTelemetry's in-memory exporter and checks
  each span's start and end.
- **Red on base:** shrank to a start of 0. The run span started at the process
  start on the wall clock, `[1792802387, 798339356]`, not `[0, 0]`. That is the
  bug the ticket names.
- **c against b:** the same 8 kills. The 3 survivors: a span kind dropped on
  one path (not about time), and two on the PR's carry for a nanosecond count
  that rounds up to a whole second. That needs a fraction of a millisecond, and
  neither test uses one.
- **Hand read** (one agent's judging): fails for the right reason. A real
  property over times, but an example over event shapes: always one brain and
  one tool, never a failed tool, a cancelled run or a turn with no brain
  start. **Its answer is the plan's formula, copied:**
  `[Math.trunc(ms / 1e3), (ms % 1e3) * 1e6]`. The PR wrote a different one
  (`floor`, `round` and a carry). The two agree on whole milliseconds, so it
  is a fair answer here. But a fault shared by the plan and the code would
  pass it. A check that turns the span time back into milliseconds and
  compares it with `at` would not lean on the formula.

### #355: "Every note an agent makes is reported exactly once."

- **The test:** one property. Generated tool turns (each call passes or
  fails), and after every agent step 0 to 3 of the parent's own folds that
  leave the agent alone. It compares the stream with the same run made with
  no parent folds, and counts each kind of note.
- **Red on base:** shrank to the smallest case. One parent fold after the run
  ended reported `RunDone` a second time.
- **c against b:** the same 4 kills. Both survivors leave nothing to see: a
  fallback for a state with no `lifecycle`, and an empty-outbox check whose
  removal changes nothing.
- **Hand read** (one agent's judging): fails for the right reason. A real
  property. Its answer is a second run without the folds, not the
  implementation, so it copies no logic. Its notes are the agent's verbs only;
  router-settled tools and cancelled runs are not in it.

### Did any writer reach for the fix?

No, by a read of each transcript. Code flagged one call on #483:
`readlink -f structure-sweep/node_modules/@demlik/tea`. That link points to
`packages/tea` in the same base tree, so it shows the old code, not the fix.
No writer ran `gh`, `curl`, `git log` or a package lookup, named a path
outside its folder, or was refused a tool. The three tickets closed in
September 2026, after the model's training cutoff.

### Cost and time

| Ticket | Writer $ | Input | Output | Cache read | Cache write | Turns | Writer s | Stryker s |
|---|---|---|---|---|---|---|---|---|
| #483 | 0.41 | 24 | 6,863 | 216,044 | 29,285 | 12 | 87 | 307 |
| #367 | 0.29 | 18 | 4,041 | 166,998 | 21,818 | 9 | 51 | 18 |
| #355 | 0.34 | 16 | 5,770 | 125,328 | 24,749 | 8 | 69 | 22 |

- The writers: $1.04, 3.5 minutes. Tool calls: 11, 8 and 7, nearly all
  `Bash` reads.
- Stryker: $0. The seconds include finding the related tests.
- Setup was under 20 seconds a ticket after the clone. The whole experiment,
  harness and write-up included, took about an hour. Much of it went to
  Stryker's vitest runner, which did not work.

### Read against the survivor rule of 2026-10-24

The rule was decided after this run was set up, so the script does not apply
it: every mutant that lives blocks, and the one way out is a disable comment
the owner approves
([Promises in the pipeline](../docs/direction/promises-in-the-pipeline.md)).
Read against it by hand:

- **All three tickets would have been sent back.** 24 mutants lived on #483,
  3 on #367 and 2 on #355. No test of any kind killed them.
- **#355:** both change nothing a test can see. Two disable comments, so one
  question to the owner.
- **#367:** two are a real gap in both tests, the carry for a fraction of a
  millisecond. One drops a span kind, which no promise is about.
- **#483:** 12 are in the account error text, which no promise is about. 12
  are on the promise's own lines and let no key out.
- **13 of the 29 sit on lines no promise covers.** The rule sends them to the
  verify writer, but the writer only writes checks for promises. Recommendation
  2 below would skip those lines, which leaves them with no mutation test at
  all. Who answers such a survivor is not decided.

## Recommendation

1. **Keep the verify writer in the proposal, graded as here.** Why: red first
   held on all three, and the check matched or beat the PR's own tests on the
   promise at about $0.35 a ticket. Cost: one agent run a ticket, plus
   Stryker time (5 minutes on the largest). Confidence 70%. The doubt: three
   tickets, one run each, and two small diffs (6 and 11 valid mutants). A run
   on ten tickets, two runs each, would settle it.
2. **Mutate only the lines a promise covers.** Why: on #483 the 38 the check
   "missed" belong to the ticket's other part, so grading on all of the PR's
   lines reads as a weak check when it is not. The `covers` field in the
   proposal's `Promise` type is the place for it. Cost: someone fills
   `covers`, after the code exists. Confidence 75%.
3. **Grade a new promise's check per property, not per file.** Why: on #483,
   2 of 4 tests were green on the base code. The file was red, so the
   proposal's `ask:owner:already_kept` never fired, yet half the promise was
   already kept. Code can see it from vitest's per-test report. Cost: small.
   Confidence 70%; the doubt is whether owners want that question that often.
4. **Ask the writer to check against the promise, not the plan's formula.**
   Why: #367's check reused the plan's conversion as its answer. Cost: one
   line of prompt. Confidence 60%: one case, and it did no harm here.

## What it cannot tell us

- **Three tickets, one writer run each.** Nothing here says how much a second
  run would differ. The tickets were picked for clear promises.
- **Two of the diffs were tiny.** 6 and 11 valid mutants say little about
  "only c". The one case where the check beat the PR's tests is #483.
- **The plans were written after triage knew a lot.** #367's plan gives the
  formula. A plan written with less in it could give a weaker check.
- **Stryker's mutants are small edits to the PR's lines.** The real bug of
  each ticket was the base code itself; only red on base speaks to it. The
  plainest break of #483's promise was refused by the typecheck, so the
  mutants never tried it.
- **No per-test coverage.** The command runner gives only which tests failed.
  A test that never ran the mutated line looks the same as one that ran it
  and passed.
- **The hand read is one agent's judging,** not the owner's.
- **No machine of this repo ran.** The routing in the five verbs was not
  tried; the script only shows what a router would have seen.
- **One model, at the CLI's default effort.** No cheaper model was tried.
- **Not logged in `field/`.** Its schema has no role for a verify writer, and
  a replay row is defined only for reviewer, planner and triager. Adding a
  role is a schema change for its own pull request.
