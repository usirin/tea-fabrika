# 124. Can the verify writer kill every mutant that lives, and what does the skip list cost?

The question: [Promises in the pipeline](../docs/direction/promises-in-the-pipeline.md)
runs mutation testing after the build, and every mutant that lives blocks the
pull request. It goes back to the verify writer, about a promise or not. A
fixed skip list leaves out error and log text. A mutant the writer believes no
test can tell apart becomes a disable comment the owner approves. This
experiment runs that loop on the three kamp-us/demlik tickets of experiments
122 and 123 (#483, #367, #355), on the merge commit with 122's check in place.

**Answer: one round on every ticket, $0.86 in all, about 3 minutes of agent
time. 29 mutants lived; the writer killed 28 and called one untellable, and
that claim held. The new tests are real, but they are examples, not
properties, and some pin text no promise is about. The skip list cost little
here: it removed 2 of 24 live mutants on #483, and also 3 kills of an
acceptance criterion. Confidence 70%.**

- **Rounds to zero:** 1 on each ticket, and 1 on 123's equal rewrite. No
  ticket needed a second round. A fresh `--force` run agreed with each
  incremental answer.
- **Dollars:** $0.14 (#355), $0.29 (#367), $0.31 (#483), $0.11 (the rewrite).
  Far under the $4 a call allowed.
- **One claim of "cannot be told apart",** on #355. By hand it holds: the
  mutant only adds an empty array to a private `WeakSet`, and the array is
  never filled later.
- **Two earlier guesses were wrong.** 122's hand read said both of #355's
  survivors change nothing a test can see; the writer killed one. 123 said the
  rewrite's new mutant (`> 399` made `>= 399`) is one "no test can tell
  apart"; the writer killed it with a faked reply of status 399.
- **No writer touched any file but its own test file,** by `git status`. No
  test was dropped. Every file passed 3 runs of 3 at the end.
- **The quality worry is real but small.** On #483 the writer pinned the
  `[redacted]` marker's exact text, and wrote one test only to kill
  Stryker's own replacement text (a key that is the string
  `"Stryker was here!"`).

```ts
// A sketch of 124-kill-every-survivor.ts, per ticket.
const tree = cloneOf(e123.probe);                 // merge commit + 122's check + Stryker 10.1.1
const skip = ignorer("arid", insideErrorOrLogText); // fixed before any agent ran
let run = stryker({runner: "vitest", coverage: "perTest", ignorers: [skip], incremental: true});
const claimed = new Set<string>();
for (let round = 1; round <= 3; round++) {
	const open = run.uncaught.filter((m) => !claimed.has(m.key));
	if (open.length === 0) break;                       // done: every mutant killed or claimed
	const answers = claudeP(promptOf(promise, ownTestFile, open), {cwd: writerCopy, budget: 4});
	for (const a of answers) if (a.answer === "cannot") claimed.add(a.key); // to the owner
	copyOnly(ownTestFile, writerCopy, tree);            // anything else it touched is put back
	run = stryker({...same});                           // incremental: only what the test reaches
}
const truth = stryker({...same, force: true});        // is the incremental answer true?
```

## Who did what

- **This repo:** one script, `124-kill-every-survivor.ts`. It plays the
  mutation test step and its grading: Stryker runs, the mutant list, the
  check on touched files, the copy of the test file, the `--force` truth run.
  No machine of this repo ran.
- **The verify writer:** one `claude -p` run per round, started by the
  script. Four runs in all.
- **Today's fabrika:** nothing in this run. The trees and the checks come
  from experiments 122 and 123, which used today's fabrika's triaged bodies
  as plans.
- **The hand read** below is one agent's judging (the one that ran the
  experiment), not the owner's.

## How it was done

- **Trees:** a copy-on-write copy of 123's vitest-runner tree for each
  ticket (the merge commit, 122's check, Stryker 10.1.1 with its vitest
  runner and TypeScript checker). Put back to the merge: the test 123
  appended was removed, and so were 122's copies of the PR's tests as they
  were at the base commit.
- **The writer's folder:** a second copy of the same tree, with one fresh
  git commit. The writer ran there, so `git status` shows every file it
  changed. Only its own test file was copied back.
- **Stryker:** `coverageAnalysis: "perTest"`, `--incremental` between
  rounds, the PR's changed lines as in 122, concurrency 4, `nice -n 15`, one
  Stryker at a time. After each loop, one more run with `--force`.
- **The writer:**
  - `claude -p --model claude-opus-5-5 --output-format json`, prompt on
    stdin, the same flags as 122: `--tools Read,Write,Edit,Glob,Grep,Bash`,
    no web, no `gh`, `curl` or `git fetch`, `--setting-sources ""`,
    `--strict-mcp-config`, `--disable-slash-commands`. `--max-budget-usd 4`.
    Every `CLAUDE*` variable and the Jev key removed from its environment.
  - The prompt: the promise, its own test file, and each mutant that lived
    (file, line, column, mutator, the source line, the original text, the
    replacement). Change only your test file; do not apply a mutant to the
    source even to try it; keep the promise's check; end with one JSON
    entry per mutant, a test name or "cannot" with a reason.
  - No plan, no ticket text. A fresh run each round; the test file carries
    what the last round did.
- **A claim of "cannot"** takes that mutant off the next round's list. In
  the real pipeline it would go to the owner as a disable comment. Here it
  was read by hand only; no comment was added to the source.
- **The rewrite case:** after #483's loop, 123's equal rewrite (`>= 400`
  written as `> 399`, structure-sweep's client) in both copies, then the
  loop once more.

### The skip list, fixed before any agent ran

One rule: **skip every mutant inside the text of an error or a log line.**
That is any argument of `new <Name>Error(...)`, of `<Name>Error(...)`, of
`super(...)` in a class that extends `<Name>Error`, or of `console.<any>(...)`.
It is a Stryker ignorer plugin, `arid`, 30 lines in the script, so it skips
the node and everything under it, as Google's arid nodes do.

```js
// The heart of the plugin (the full text is in the script and the results file).
shouldIgnore(path) {
  const parent = path.parentPath;
  if (parent == null || path.listKey !== "arguments") return undefined;
  if (!parent.isCallExpression() && !parent.isNewExpression()) return undefined;
  const found = why(parent);            // "error text", "log text" or undefined
  return found === undefined ? undefined : `arid: ${found}`;
}
```

`mutator.excludedMutations: ["StringLiteral"]` was the blunt choice. It is
counted below for contrast, from 122's results, but not run.

## What came back

| Ticket | Mutants, live at the start | Round 1 asked | Killed, claimed | Live after | Writer $ | Writer s | Stryker s (start, round, force) |
|---|---|---|---|---|---|---|---|
| [#355](https://github.com/kamp-us/demlik/issues/355) | 7, 2 | 2 | 1, 1 | 1 (claimed) | 0.14 | 32 | 20, 22, 19 |
| [#367](https://github.com/kamp-us/demlik/issues/367) | 19, 4 | 4 | 4, 0 | 0 | 0.29 | 71 | 19, 14, 18 |
| [#483](https://github.com/kamp-us/demlik/issues/483) | 84, 22 | 22 | 22, 0 | 0 | 0.31 | 64 | 49, 32, 50 |
| #483, the rewrite | 84, 1 | 1 | 1, 0 | 0 | 0.11 | 14 | 14, 15, 48 |

"Mutants" leaves out the ones the typecheck refused and the ones the skip
list took out. Stryker 10 makes a few more mutants than 122's 9.6.1 did (a
`CallExpression` mutator), so the counts differ from 122's.

### #355: "Every note an agent makes is reported exactly once."

- **Killed:** `state.lifecycle ?? []` made `?? ["Stryker was here"]`. No test
  ran that line. The writer saw that a state with no `lifecycle` field (one
  saved before the outbox existed) would then report `[undefined]`. Its test
  drops the field and expects `[]`. 122's hand read called this mutant
  invisible. That was wrong.
- **Claimed:** `outbox.length === 0 || …` made `false || …`. The writer's
  reason: with an empty outbox the loop runs zero times, and the only change
  is an entry for an empty array in a private `WeakSet`. **By hand it holds.**
  The outbox is a `readonly` array, and every append makes a new one
  (`[...(s.lifecycle ?? []), ...notes]`), so the marked empty array never
  gets notes later. It holds because of that copy-on-write; code that filled
  the array in place would make it a real mutant.

### #367: "A span's start and end are the run clock's instant, however long the process has been up."

- **All 4 killed, no claim.** The carry for a fraction of a millisecond that
  rounds up to a whole second (2 mutants, 122's real gap): an `at` of
  `999.9999999` must give `[1, 0]`. A `TurnSettled` with no `BrainStarted`
  must open a `CLIENT` span (not about time). A child span still open at
  `RunDone` must end at its `at` (the new `CallExpression` mutant).
- **Hand read:** three example tests, sound. Two of the three check things
  the promise is not about (span kind, the detached flag). The answers are
  written out (`[1, 0]`, `[2, 0]`) or come from the file's existing `hr`
  helper, which 122 found is the plan's own formula.

### #483: "A Jev client error never carries the API key."

- **All 22 killed, no claim, in one run of 64 seconds.** Nine example tests,
  each run on both clients. They cover: redaction keeps the rest of the body
  (arrays, numbers, object keys); an empty key leaves the body as it is; a
  200 body passes through as is; a body that is not JSON reads as `{}`; the
  detail skips empty parts; no detail when the body names nothing; a status
  of exactly 400 carries the detail; a failed reply below 400 carries none.
- **What the grading looked for:**
  - **Touches outside the file:** none.
  - **Copied logic:** none. No added line repeats a line of the source.
  - **Exact text no promise is about:** yes. The expected bodies hold
    `"[redacted]"` word for word, and the detail tests expect the provider's
    text back (`"invalid_key"`, `"bad request"`). Those pin the ticket's
    other half, which has its own acceptance criteria, so they are fair
    tests. They are also what the PR's own tests already did.
  - **A test shaped by the mutant:** "a key that happens to be
    `"Stryker was here!"` is still redacted". It exists only because Stryker
    turns the `""` in `secret === ""` into that string. It is true and
    harmless, but it tests Stryker, not a case anyone meets.
  - **A test that pins the opposite of the promise's spirit:** "a success
    body is passed through as is" sends the key in a 200 body and expects it
    back. The promise is about errors, so this is the code's real
    behaviour. But if the owner later wants every body redacted, a check
    now stands in the way.
- **The promise's own two properties were kept as they were.**

### The rewrite case on #483

- `> 399` gave Stryker one new live mutant, `>= 399`. Incremental mode ran 10
  of 128 mutants again (it reused 118), in 14 seconds.
- **The writer killed it,** for $0.11: it added 399 to the statuses of "a
  failed reply below 400 carries no detail". A fake `post` can answer 399,
  so the mutant can be told apart. 123's write-up said no test could. That
  was wrong.

### What the skip list removed, against 122's results

| Ticket | Valid mutants in 122 | Skipped | Live mutants skipped | Kills by one test group only, skipped | `StringLiteral` would skip: live, one-group kills |
|---|---|---|---|---|---|
| #483 | 88 | 6 | 2 of 24 | 3 of 40 | 8 of 24, 7 of 40 |
| #367 | 11 | 0 | 0 of 3 | 0 of 0 | 0, 0 |
| #355 | 6 | 0 | 0 of 2 | 0 of 0 | 0, 0 |

"One test group": in 122, only the old tests, only the PR's tests, or only
the agent's check killed it. "3 of 40" is 3 of #483's 40 such kills.

- **All 6 are on one line, in each client:** the message of `JevAskError`,
  `` super(`jev: ${JSON.stringify(reason)}${detail ? `: ${detail}` : ""}`) ``.
- **The 2 live ones:** the `""` for "no detail" made `"Stryker was here!"`.
  A message would end in junk text when the body names nothing.
- **The 3 one-group kills** were the PR's own tests checking that the
  message holds the detail. The plan asked for exactly that: "fold it into
  the error message so a 402 reads e.g. `Credit limit reached;
  payment_required`".
- **Does it hide a mutant that matters?** For the promise, no: no change to
  the message text can add the key. **For the ticket, yes, a little:** on
  #483 the error text *is* half of the feature. The tests that check it
  still run; only mutation testing stops watching that line.
- **The blunt choice would hide more.** Skipping every `StringLiteral` takes
  8 of 24 live mutants, among them the empty-key guard's `""` and the
  `[redacted]` marker in object keys.
- On #367 and #355 the list did nothing: no error or log text on the
  changed lines.

### Cost and time

| Run | Writer $ | Input | Output | Cache read | Cache write | Turns |
|---|---|---|---|---|---|---|
| #355 | 0.14 | 12 | 2,254 | 69,336 | 10,732 | 6 |
| #367 | 0.29 | 18 | 5,209 | 156,457 | 18,736 | 12 |
| #483 | 0.31 | 14 | 6,339 | 117,790 | 20,499 | 7 |
| #483, the rewrite | 0.11 | 6 | 1,230 | 30,920 | 10,104 | 5 |

- **Writers:** $0.86 and 181 seconds in all. Input plus output: 15,082
  tokens. With cache reads and writes: 449,656 tokens.
- **Stryker:** $0, 320 seconds in all, the `--force` truth runs included.
- **The estimate was $4.** It came in at a fifth of that. The whole run,
  harness and write-up, took about an hour.

## Recommendation

1. **Keep the loop as the proposal has it: every live mutant goes to the
   verify writer, about a promise or not.** Why: it reached zero in one
   round on all four cases, at $0.11 to $0.31, and its one claim held. Cost:
   one writer run a ticket, plus an incremental Stryker run of 14 to 32
   seconds. Confidence 70%. The doubt: three small tickets, one run each,
   and all four lists were easy (no live mutant here was truly hard). A run
   on ten tickets, with at least one large diff, would settle it.
2. **Keep the skip list to error and log text, by an ignorer plugin, never
   by mutator name.** Why: the plugin skipped 2 live mutants and lost 3
   kills on one line; `StringLiteral` by name would skip 8 live mutants,
   some on the promise's own lines. Cost: a 30-line plugin per stack, and
   on a ticket whose feature is the error text, mutation testing stops
   watching it. Confidence 65%. The doubt: with a writer this cheap, the list
   saved one easy test here. Running the loop with no skip list at all would
   show whether the list is worth having.
3. **Add one line to the writer's prompt: no test whose only reason is
   Stryker's replacement text.** Why: "a key that is `Stryker was here!`"
   tests the tool, not a case anyone meets. Cost: one line. Confidence 60%:
   one case. A better answer may be to let the writer call such a mutant
   untellable with the reason "only Stryker's own text tells it apart", and
   let the owner choose.
4. **Grade the loop's new tests by hand for now, with the three checks used
   here.** Why: code found the touched files and the copied lines, but not
   the mutant-shaped test or the test that pins a 200 body's key. Cost: a
   short read a ticket. Confidence 75%.

## What it cannot tell us

- **Three small tickets, one writer run each.** 29 live mutants in all, 22
  of them on one ticket. A second run could differ.
- **No live mutant here was hard.** Each needed one small example. Nothing
  says how the writer does on a mutant that needs a new kind of input, or on
  many truly untellable ones.
- **No owner saw the one claim.** Whether an owner would approve its
  disable comment, or how long that wait takes, is not measured.
- **No disable comment was written.** A comment adds a line, which moves
  every mutant below it; the loop did not have to live with that.
- **The writer could read the PR's own tests,** which already pin much of
  #483's text. A writer with less to copy from could do worse.
- **The skip list was tried on one line of one ticket.** Neither #367 nor
  #355 had error or log text on its changed lines.
- **The hand read is one agent's judging,** not the owner's. Two of its
  earlier guesses (122's on #355, 123's on the rewrite) turned out wrong
  here, so a third could be too.
- **No machine of this repo ran.** The routing in the five verbs was not
  tried; the script only plays the steps.
- **Not logged in `field/`,** for the same reason as 122: its schema has no
  role for a verify writer.
