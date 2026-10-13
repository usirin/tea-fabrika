# 61. Can a reviewer find the case the tests left out?

A ticket's acceptance criteria get marked "met". A split for how is on the
table:

1. A criterion written as a recipe (set this up, do this, expect that) is
   decided by code that runs it.
2. A criterion that needs reading is decided by a reviewer agent.
3. The reviewer agent is also asked, of the recipes: "which case is missing
   from these checks?"

Step 3 is unproven, and it is the point of this experiment. The case that
started it: [kamp-us/demlik#622](https://github.com/kamp-us/demlik/issues/622)
says "The output names every removed subpath."
[Pull request #634](https://github.com/kamp-us/demlik/pull/634) shipped with
passing tests. A removed subpath that published no names is still not named.
The builder said so in the pull request and filed
[#633](https://github.com/kamp-us/demlik/issues/633).

Part A counts how many criteria are recipes, how many need reading, and how
many claim "every" or "never" with no case named. Part B hands a reviewer
six shipped changes with a known hole each and asks it the step 3 question.

**Answer: mixed, and step 3 is still unproven. The reviewer named the known
missing case in 6 of 12 runs: in both runs on three cases, and in neither run
on the other three. Nothing changed from one run to the next. None of those
six cases is a fair test, though. Somebody had already seen every one of the
six gaps before the merge: the builder in two, today's reviewer in four. On
the one case where nobody had, the reviewer missed, in one run with a weaker
answer key. What the reviewer named beside the known case was mostly real:
35 of 38, and 11 of those look like wrong code. Those marks are one agent's
reading of another agent's answers, with nothing run. I am about 90% sure of
the hit and miss marks and about 70% sure of the real and not-real marks.**

```text
Part A   106 criterion lines, 17 tickets, the 12 newest pull requests
   77  recipe only: code could decide the whole line        72.6%
   16  both: a recipe part and a reading part               15.1%
   13  reading only                                         12.3%
   12  claim "every / never / unchanged" with no case named 11.3%

Part B   6 cases, 2 runs each, the review stage's own settings
  hit in both runs       #634  #528  #465
  hit in neither run     #606  #495  #450
  hit in one run only    none

  by how the gap became known        cases   runs hit
    the builder declared it            2      2 of 4
    today's reviewer saw it            4      4 of 8
    nobody saw it by the merge         0      -
    (a seventh case of that last kind, added late:  0 of 1)

  other cases the 12 runs named: 38, or 3.2 a run
    35 real   2 not real   1 cannot tell
    of the 35: wrong code 11, unsure 8, only the test is missing 16

  cost: $11.10 for the 12 runs, $0.92 and 138 seconds a run
        $11.82 with the seventh case's run
```

- **Half, and the same half both times.** Three cases were found twice and
  three were missed twice. No case was found once.
- **The plan's test for "supports" is not met, and a third run could not
  have met it.** It asked for a hit in 2 of 3 runs on 4 of 6 cases. A case
  with 0 of 2 can reach 1 of 3 at most, so 3 cases is the ceiling.
- **The plan's test for "counts against" is not met either.** Half the runs
  hit, the hits repeat, and most of the other cases are real.
- **No fair test was in the six.** I had labelled four gaps "found by a later
  issue". All four issues were filed before the merge, out of the pipeline's
  own review. So a hit here shows a reviewer can find again what somebody
  had already seen.
- **The one found-later case missed, and it is thin.** One case, one run, a
  key I marked as weaker before running it. The run named two neighbours of
  the gap and did not join them.
- **The misses were not empty answers.** On the three missed cases the runs
  named 31 other cases. All 31 are marked real, and all 11 that look like
  wrong code are among them.
- **The universal flag did not point at the hits.** Four of the six keyed
  lines carry it, against 11.3% of all lines. Two of those four were hit and
  two were missed.
- **Three runs' tool lists were not three tools.** They also held 17 tools
  of the signed-in account's connectors. No run called one. See the limits.

## Who did what

Everything under review is **today's fabrika's** work on the public repo
[kamp-us/demlik](https://github.com/kamp-us/demlik): the tickets and their
criteria, the pull requests, the code and the tests, and the follow-up issues
its builders and reviewers filed. It was read through GitHub's API and out of
a clone. Nothing was written to that repo.

**This repo's** part is the script, the sorting rules and labels, the answer
keys, the marks, and the reviewer runs. A reviewer run is an agent started
with the review stage's own options (`reviewerOptions` in
`src/stages/review/reviewer.ts`: model `opus`, effort `medium`, tools Read,
Grep and Glob, the check on every call). The prompt is this experiment's own,
not the review stage's. 13 agent runs, $11.82. No Jev call and no Jev key.

One agent did the hand work: it sorted the 106 lines, picked the cases, wrote
the keys and marked the runs. That is the agent writing this.

## The plan, written before any run

This section was committed before the first paid run. The git history shows
the order: the rules and the unsorted lines, then the labels, then the answer
keys and this plan, then the runs.

### Part A

Walk the merged pull requests of kamp-us/demlik, newest first, starting at
#634. Take every ticket a pull request closes. Skip an epic's own ticket: its
lines say its children's again. A criterion line is a checkbox line under the
ticket's "Acceptance criteria" heading, above the copy of the original report
that triage keeps at the bottom. Stop after the first pull request that brings
the count to 100.

The sorting rules are in `61-sorting.json`, written before any label. In
short:

- **recipe**: every claim in the line can be decided by code with no model.
  The line gives a start, an action and a result to compare.
- **reading**: every claim is about what a text or a design says or means,
  with no comparison that settles it.
- **both**: at least one claim of each.
- **universal**, a flag beside the kind: the line claims every, all, no,
  never, unchanged or the like over a set, and does not list the set.

### Part B: the cases

A case is a merged pull request where one case under one of the ticket's
criteria is known to have been left out. A case had to pass all of these:

- the pull request closes a ticket with written criteria;
- a public record names one concrete input where the shipped code is wrong,
  and points at the pull request: the builder's own "Deviations" with a filed
  issue, or a later bug issue;
- the input falls under the words of one criterion;
- reading the code at the head commit shows the hole, and no test in the pull
  request tries it.

Six passed. All six are on kamp-us/demlik.

| Case | Under which line | The missing case | Known from |
|---|---|---|---|
| [#634](https://github.com/kamp-us/demlik/pull/634) | #622, line 7: "The output names every removed subpath." | A removed subpath that published no names is not named and does not fail. | the builder, [#633](https://github.com/kamp-us/demlik/issues/633) |
| [#606](https://github.com/kamp-us/demlik/pull/606) | #600, line 6: "overloads are not nodes" | A constructor's overload signatures still become nodes. | the builder, [#605](https://github.com/kamp-us/demlik/issues/605) |
| [#528](https://github.com/kamp-us/demlik/pull/528) | #524, line 15: "A wrangler config the run cannot parse is never skipped silently." | A config with a syntax error part-way through counts as parsed. | a later issue, [#529](https://github.com/kamp-us/demlik/issues/529) |
| [#495](https://github.com/kamp-us/demlik/pull/495) | #493, line 1: "The per-candidate probability from each answer is recorded on that candidate's row" | A candidate the answer leaves out is recorded as probability 0, a sure look-alike. | a later issue, [#496](https://github.com/kamp-us/demlik/issues/496) |
| [#465](https://github.com/kamp-us/demlik/pull/465) | #451, line 4: "no alias gets an opaque id derived from working-tree resolution" | A git-ignored file that differs from `--ref` is not seen by the check. | a later issue, [#471](https://github.com/kamp-us/demlik/issues/471) |
| [#450](https://github.com/kamp-us/demlik/pull/450) | #423, line 30: "Neutral naming is scope-aware" | `switch (x) { case 1: let x = 2 }`: the `x` switched on gets the inner `x`'s name. | a later issue, [#451](https://github.com/kamp-us/demlik/issues/451) |

The full keys are in `61-cases.json` and `results/missing-case-keys.json`:
the criteria as written, the line the hole sits under, the head commit, the
missing case in one sentence, and why the case counts.

Left out, and why:

- [#514](https://github.com/kamp-us/demlik/pull/514): the README at the head
  commit states the hole. The answer is in the copy.
- [#462](https://github.com/kamp-us/demlik/pull/462),
  [#437](https://github.com/kamp-us/demlik/pull/437),
  [#533](https://github.com/kamp-us/demlik/pull/533): a later bug is real, but
  it does not sit under the words of any one criterion.
- [#617](https://github.com/kamp-us/demlik/pull/617): an epic's pull request
  that closes seven tickets. Four later issues point at it, and which ticket's
  criteria to hand the reviewer is not clear.
- Most "known defect left unfixed" lines in demlik pull requests are about
  one red check on the pull request, not about a case of the code.
- kamp-us/phoenix: a text search found 34 merged pull requests that declare a
  defect and a filed issue. I read about a third of them. They were mostly
  screen, lane and environment gaps, and I found none that passed the four
  tests above. So phoenix gives no case here. That is a limit of the search,
  not a finding about phoenix.

### Part B: what the reviewer gets

- A fresh copy of the repo at the pull request's head commit, with no `.git`
  folder, so no history to read.
- Three tools: Read, Grep, Glob. That is its whole tool list, not a list of
  tools approved ahead. No shell and no network. Each call is also checked,
  and a read outside the copy is refused. These are the review stage's own
  settings (`reviewerOptions` in `src/stages/review/reviewer.ts`), with the
  same model and effort: `opus`, `medium`.
- The ticket's title and its criteria as written, numbered by place.
- The names of the test files the pull request added or changed.

It does not get the pull request's text, the deviations, the follow-up issue,
any review, or the diff.

The question, per criterion: what case does this line cover that the tests do
not try? The answer is a fixed JSON shape: per criterion, a list of cases,
each with the case in one sentence, the file and lines that show it, what the
code does with it (`wrong`, `unsure`, `fine`) and how sure the reviewer is.
The `code` field is my addition to the asked shape.

The prompt is in `promptOf` in the script. `STEP=prompt ONLY=<case>` prints
it. It was written once. It tells the reviewer that for most criteria the
right answer is no case, and caps a criterion at two cases. It does not list
words like "every" or "empty" to look for: that would be fitting it to the
known answers.

Three runs a case, 18 in all. Runs go round the cases, so a stop on budget
leaves the cases even. Budget: about $12.

### Part B: the search for give-aways

Before any run, each copy was searched for words that could give the answer
away (`61-cases.json` lists them per case). Every line found was read. A
**leak** is text that calls the known case a gap, a limit or a known problem.
A **hint** is text that states the behaviour or mentions the key input without
calling it a gap.

No case has a leak. Three have a hint:

- #634: the spec says a subpath that publishes nothing is still a key in the
  API view. It says nothing about removing one.
- #606: one test builds a class with a constructor overload, and finds the
  bodied constructor by its line. It never counts the nodes.
- #465: the comment on the function that lists differences says ignored files
  are left out. It states that as design.

### Part B: scoring

Written before any run, and kept in `61-marks.json`.

- **hit**: the run names, on the keyed criterion, a case with the same input
  or situation as the key and the same wrong result.
- **near**: the same case under another criterion. Or, on the keyed criterion,
  the same input with a result that is vaguer than the key's or differs from
  it.
- **miss**: anything else.

Every other case a run names is read against the code at the head commit and
marked:

- **real**: the criterion's words cover it, no test tries it, and what the
  run says about the code is true.
- **not real**: a test tries it, or the criterion does not cover it, or what
  the run says about the code is false.
- **cannot tell**: reading does not settle it.

For a real case I also note whether the code does the wrong thing with it:
yes, no, unsure.

I am an agent marking another agent's answers, and I know the answer keys.
Nothing under review was run: the marks come from reading. The full list is
printed below so a person can check them.

### What would support the split, and what would count against it

- **Supports step 3:** the known case is a hit in at least 2 of 3 runs on at
  least 4 of 6 cases (about two thirds of runs or more), and at least half of
  the other cases named are real.
- **Counts against it:** fewer than one third of runs hit. Or fewer than half
  hit and the cases that are found are found once in three. Or fewer than one
  third of the other cases named are real.
- **In between:** mixed. I will say so, and not round it up.

A low hit rate would mean the reviewer cannot be the main way missing cases
are found, and the builder's own "here is what I did not cover" stays the
main source. A failure is a finding. The prompt will not be tuned until the
number looks good. If the prompt changes after a result is seen, both results
are kept and the change is named.

If budget is left after the 18 runs, one more arm: the same cases, with only
the criteria and the test files in the folder, and none of the other code.

## Two changes after the first 12 runs

This section was committed after the 12 runs of the six cases were saved and
before the seventh case below was run. The plan above is left as it was
written, mistake included.

### The "Known from" column was wrong for four cases

While the runs were going, a question came in from the coordinating agent:
split the result by how each gap became known. A gap the builder wrote down
only tests whether a reviewer can find again what somebody had already seen.
A gap nobody saw by the merge is the real test.

So I read the times and the words of the six follow-up issues again. The plan
calls four of them "a later issue". None of the four is later. Each was filed
before its pull request merged, out of the pipeline's own review of that pull
request:

| Case | Follow-up filed | Merged | What the follow-up says |
|---|---|---|---|
| #528 | 6 minutes before | 2026-10-02 12:49 | the reviewer of round 2 tried the case |
| #495 | 5 minutes before | 2026-09-26 22:31 | written while reviewing the pull request, before it was on main |
| #465 | 5 minutes before | 2026-09-26 09:09 | the reviewer of round 3 noted it and left it out of the verdict as outside the criteria |
| #450 | 3.5 hours before | 2026-09-26 07:46 | the reviewer of round 2 noted it while grading criterion 30 and did not send the work back |

So the six cases are of two kinds, and neither is the real test:

- **declared**, 2 cases (#634, #606): the builder wrote the gap in the pull
  request.
- **seen in review**, 4 cases (#528, #495, #465, #450): today's reviewer saw
  the gap, let the pull request through, and the gap was filed as a
  follow-up.
- **found later**, 0 cases: nobody had written the gap down by the merge.

`61-cases.json` now carries the right kind for each case. The sentences in it
that said "filed after merge" are corrected. The git history keeps the first
version.

### A seventh case, the only one found later

I looked for gaps that nobody had written down by the merge. I read every
bug issue on kamp-us/demlik that was opened after a merged pull request it
points at: about 17 of 354 issues. Nearly all were filed within minutes of
the merge by a reviewer or by the agent running the lane, or they are about
docs, publishing or names. One passed:

- [Pull request #139](https://github.com/kamp-us/demlik/pull/139), ticket
  [#117](https://github.com/kamp-us/demlik/issues/117), line 3: "a process
  kill between attempts resumes at the same attempt count (test: SIGKILL
  between attempts, resume, assert attempt count and no extra handler call
  beyond the ladder)".
- The missing case: a tool with both a retry ladder and `timeoutMs` is killed
  while it waits to retry, and the process stays down past the tool's time
  limit. On resume the handler is called once more for real, then the call is
  settled as a timeout and that result is thrown away.
- Known from [#144](https://github.com/kamp-us/demlik/issues/144): a cold
  read by another agent 70 minutes after the merge. The pull request's text
  and its reviews do not mention it.

This key is weaker than the other six. The kill test uses a tool with no
`timeoutMs`, and the code at the head commit does what #144 says. But line 3
does not say in so many words that a handler call after the time limit is
wrong. The ticket that fixed it added that as a new criterion. I keep the
case out of the six-case numbers and report it on its own.

The search of its copy found no leak and two hints. One comment calls the
saved time limit an "absolute cap". Another part of the code, the run's
watchdog, says in a comment that a saved time would fire at once after
downtime, and resets its clock on a restart for that reason. That second one
is the strongest hint of the seven cases.

One found-later case is not three. I could not find more, and I say so in
the results.

The 12 runs cost $11.10. That leaves about $0.90 under the budget. So: one
run of this case, with the run's own cost cap set to $0.90. If the cap cuts
the run short, there is no answer and I will say that.

Two small changes to the script for this: the cost cap of one run can be set
from outside, and the reading of a ticket's criteria now cuts only the folded
"original report" block, not everything after it. Ticket #117 has its
criteria under that block. Part A's 106 lines come out the same under the new
cut, checked by reading them again.

## Part A: what the 106 lines are

106 lines on 17 tickets, closed by the 12 newest merged pull requests, #603
to #634. Those 12 merged within 30 hours of each other.

| Kind | Lines | Share | Of them universal |
|---|---|---|---|
| recipe only | 77 | 72.6% | 10 |
| both | 16 | 15.1% | 1 |
| reading only | 13 | 12.3% | 1 |
| all | 106 | | 12 (11.3%) |

- **Code could decide the whole of 73 lines in 100, and part of 88.** A line
  with a recipe in it: 93 of 106 (87.7%). A line with a reading part in it:
  29 of 106 (27.4%).
- **One recipe line in eight claims more than it names.** 10 of the 77
  recipe-only lines (13.0%) say every, never or unchanged over a set the line
  does not list. Code can run such a line on the cases somebody thought of.
  It cannot say the set is whole. These are the lines step 3 is for.
- **The flag is a floor.** I flagged a line only when it held a universal
  word. A line that is general through "a" or "an" ("a removed subpath is
  judged by...") is not flagged. Six labels are marked borderline in the
  data: three flagged, three not.
- **10 of the 77 recipes are the same line**: typecheck, lint and test pass.
- **One sorter, by hand.** The rules were written and committed before any
  label. Every label has a one-line reason in `61-sorting.json`.

### Beside experiment 19

[Experiment 19](./19-data-criteria.md) found that 36 of 130 criteria (27.7%)
"carried an example". Here 87.7% hold a recipe. The two numbers do not
measure the same thing, so they do not disagree:

- Experiment 19 counted a criterion when triage could write it as one
  JavaScript call and its exact result. Here a recipe is any start, action
  and result that code could run and compare. That takes in a command run
  over a fixture, a search of the code, and "these commands pass".
- Experiment 19 read seven older tickets. These are 17 tickets from the last
  two days, 11 of them about one command-line tool whose output is text that
  can be compared.
- There a triage agent wrote the examples. Here one reader sorted by hand.

What carries over: "a function call and its result" fits about a quarter of
criteria, and "something code can run" fits most of them.

### The six lines the holes sit under

After the cases were picked I sorted their six keyed lines by the same rules.
I knew the hole under each line by then, so these labels are not blind and
are not counted above.

| Line | Kind | Universal | Part B |
|---|---|---|---|
| #622 line 7 | recipe | yes | hit twice |
| #600 line 6 | reading | yes | missed twice |
| #524 line 15 | both | no | hit twice |
| #493 line 1 | recipe | yes | missed twice |
| #451 line 4 | recipe | yes | hit twice |
| #423 line 30 | recipe | no | missed twice |

Four of six carry the flag, against 11.3% of the 106. So the holes do sit
under universal lines more often than chance. But the flag does not tell a
hit from a miss: two flagged lines were hit and two were missed.

## Part B: did a run name the known case?

Two runs a case, not the three of the plan. The script stopped itself after
12 runs at $11.10, because one more would have passed $12.

| Case | How the gap became known | Run 1 | Run 2 | What the runs did |
|---|---|---|---|---|
| #634 | declared | hit | hit | Both named a removed subpath with no names, on line 7. |
| #606 | declared | miss | miss | Nothing on line 6 and nothing about a constructor. |
| #528 | seen in review | hit | hit | Both named a broken config that still parses to an object, on line 15. |
| #495 | seen in review | miss | miss | Both named another case on line 1: two candidates with the same text. |
| #465 | seen in review | hit | hit | Both named a git-ignored file, on line 4. |
| #450 | seen in review | miss | miss | Nothing on line 30. 14 other cases on lines 1 to 29. |
| #139 | found later | miss | | Two neighbours of the gap, on lines 2 and 3. |

- **Hit: 6 of 12 runs (50.0%) on the six cases of the plan.** No run was
  marked near, so hit-or-near is the same 6 of 12. With the seventh case: 6
  of 13 (46.2%).
- **Run to run: no spread at all.** Three cases hit in every run, three in
  no run, none in some. Two runs is too few to call that a rule.
- **Every hit was on the keyed line.** The reviewer did not put a known case
  under another line.
- **No case leaked.** Four of the seven copies held a hint: #634, #606, #465
  and #139. Two of the three hits had a hint and one did not (#528). The two
  hinted misses are #606 and #139.
- **#606's line is a docs line.** Line 6 says what three texts must name, and
  holds "overloads are not nodes" in brackets. Asked what case the tests do
  not try on that line, both runs said none.
- **#495 is the closest miss of the six.** Both runs looked at line 1 and
  found a different way for a candidate's row to be lost. I read that one
  and it looks like wrong code too.
- **#139's run named the two halves apart.** On line 2: a tool with both
  fields whose time runs out during a wait, with no kill. On line 3: a kill
  during an attempt, after which the call gets a fresh time limit. The gap is
  a kill during the wait and a process down past the limit. By the rule
  written before the runs that is a miss, not a near: neither case has the
  downtime or the extra handler call. A person may want to check that mark
  first.

### By how the gap became known

| Kind | Cases | Runs | Hit | Hit in every run | In some | In none |
|---|---|---|---|---|---|---|
| declared: the builder wrote it in the pull request | 2 | 4 | 2 (50.0%) | 1 | 0 | 1 |
| seen in review: today's reviewer saw it before the merge | 4 | 8 | 4 (50.0%) | 2 | 0 | 2 |
| found later: nobody had written it down by the merge | 1 | 1 | 0 | 0 | 0 | 1 |
| the six cases of the plan | 6 | 12 | 6 (50.0%) | 3 | 0 | 3 |
| all seven | 7 | 13 | 6 (46.2%) | 3 | 0 | 4 |

- **The two kinds with enough cases give the same number**: half, with no
  spread between runs.
- **Found later has one case and one run.** The brief for this split asked
  for at least three. I could not find them. Of about 17 later bug issues on
  kamp-us/demlik that point back at a merged pull request, one passed the
  four tests, and its key is the weakest of the seven. kamp-us/phoenix was
  not searched a second time. So this experiment does not test the question
  that matters most: can a reviewer find a gap nobody has seen?
- **For the four seen-in-review cases there is a baseline.** Today's
  reviewer saw all four. It had more to go on: it reviews the pull request
  itself, with its diff and its text, and in three of the four the follow-up
  says it was on its second or third round. The reviewer here, with three
  read tools and one pass, found two of the four, twice.
- **Before the merge, the builder's note and today's review had all six
  between them.** This reviewer found three.

### The other cases the runs named

Every case a run named that is not the known one, read against the code at
the head commit.

| Cases | Named | A run | real | not real | cannot tell |
|---|---|---|---|---|---|
| declared | 11 | 2.8 | 9 (81.8%) | 2 (18.2%) | 0 |
| seen in review | 27 | 3.4 | 26 (96.3%) | 0 | 1 (3.7%) |
| found later | 4 | 4.0 | 2 (50.0%) | 1 (25.0%) | 1 (25.0%) |
| the six cases of the plan | 38 | 3.2 | 35 (92.1%) | 2 (5.3%) | 1 (2.6%) |
| all seven | 42 | 3.2 | 37 (88.1%) | 3 (7.1%) | 2 (4.8%) |

- **The false-case share is 5.3% on the six cases**, 2 of 38. Counting
  "cannot tell" as false too: 7.9%. With the seventh case: 7.1% and 11.9%.
- **"Real" is a wide word here.** It means the line covers the case, no
  test tries it, and what the run said about the code is true. Of the 35
  real ones, in 16 the code reads right and only the test is missing ("the
  command is never run with this flag"). In 8 I could not tell. In 11 the
  code looks wrong.
- **Those 11 are 7 different cases**, all on #495 and #450, the two cases
  whose known gap was missed both times. None was run, and none is filed.
- **As different cases the 38 are 24**: 22 real, 1 not real, 1 cannot tell.
  14 of the 24 were named in both runs and 10 in one run only.
- **A run that hit named little else.** The six hit runs named 7 other
  cases. The six miss runs named 31.
- **Both not-real marks are one case, named twice** on #634: the run said no
  test tries reading tea's real build config out of the base copy. The same
  test file does that when the build sets a base commit, and the build
  workflow sets one on every pull request.
- **"Not real" does not mean untrue.** On #139 the run said a call with bad
  arguments is retried up the ladder though the handler never ran. That
  reads true in the code. No criterion covers it, so by the rule it is not
  real. It may still be worth a ticket.

### Every other case, with its mark

All 28, so a person can check the marks. "Named in" is the run and then
`#<criterion>.<place>`. "Code wrong?" is filled only for a real case. An
agent wrote every mark and every reason, knowing the answer keys, by reading
and without running anything.

| Case | What the run named | Mark | Code wrong? | Why | Named in |
|---|---|---|---|---|---|
| 634 | The base commit's tsup.config.ts is read out of a temporary copy of the base, and tea's real config imports from tsup. The test's own config imports nothing, so no test shows the import works there. | not real | | A test tries it. The same test file has a mode that runs the check on tea itself against a base commit, and the build workflow sets that mode on every pull request. The code that reads the base links node_modules into the copy. | 1#1.1, 2#9.1 |
| 606 | The command is never run with the new flag: nothing checks that a header reaches the JSON, starts on the node's first line, or is the same on two runs. | real | no | Line 1 is about the command's output. Only one test file mentions headers, and it calls the header function directly. The code that puts the header on the node reads right. | 1#1.1, 2#1.1 |
| 606 | A header spread over many lines, with an object type as the return type just before the body's brace, is never tried. | real | no | Line 1 covers every header. Every header in the tests fits on one line. The code that finds where the header ends reads right for this shape. | 1#1.2, 2#1.2 |
| 606 | No test builds the same node with and without the flag and compares the two. | real | no | Line 2 says every other field is unchanged when the flag is on. No test compares. The code adds one field and touches nothing else. | 1#2.1, 2#2.1 |
| 606 | Overloads that each run over many lines, with a blank line and a long comment between them, are never tried. | real | no | Line 2 covers overloads. The tests use one-line overloads with a one-line comment between. The code that walks back over the signatures reads right. | 1#2.2 |
| 606 | The one-file view is never run with the flag, so nothing checks it carries the same header and overloads as the whole-graph view. | real | no | Line 4 is about that view. No test runs it with the flag. The view passes the node's fields through. | 1#4.1, 2#4.1 |
| 528 | Only one rule is listed and a config cannot be parsed: the summary is still printed and is wrong, and the test checks only the exit code and the error text. | cannot tell | | Line 15 itself says this situation behaves as before. Whether the summary is wrong there I could not settle by reading. | 1#15.2 |
| 528 | A binding is given another name, or pulled out of env, and then only returned or put in an object, with no member read and not passed as an argument: no use is listed, though the same return without the new name is one. | real | unsure | Line 5 lists one level of renaming and pulling out of env among the forms that count. The code counts a renamed binding only when a member is read off it or it is an argument. The tests rename and then read a member. Whether a bare return should count is a design call the line does not settle. | 2#5.1 |
| 495 | One anchor has two candidates whose text is the same, byte for byte: both pairs get the same id, so one row overwrites the other and the output holds one row for two pairs. | real | yes | Line 1 says every candidate pair is asked and recorded on its row. The pair id is a hash of the two texts, sorted, so two candidates with the same text give the same id. No test has two candidates with the same text. | 1#1.1, 2#1.1 |
| 495 | The plan step is never run together with a graph file, so the estimate over rewritten bodies is never checked. | real | no | Line 3 says the estimate is taken over exactly what each question would send. Every plan test prices plain source. The code prices the rewritten bodies when a graph is given. | 1#3.1, 2#3.1 |
| 495 | The whole command is never run with pairs over the cap: the count on the error stream and the list in the written file are checked only through inner functions. | real | no | Line 4 says skipped pairs are counted on the error stream and listed in the output. The one command-level test has none skipped. The command's own code for it reads right. | 1#4.1, 2#4.1 |
| 495 | The command is never run with a real graph file on disk: tests hand the inner function a graph in memory. | real | no | Line 5 is about the flag that names a graph file. No test passes a file through the command. The reading code is short and reads right. | 1#5.1, 2#5.1 |
| 465 | An untracked file that no import names, such as a notes file at the top of the repo, counts as added and stops the run. | real | unsure | Line 10 says the run refuses only on changes that can move where an import resolves. The code treats every added path as one that can, on purpose: an import may name any path. The tests add only the tool's own outputs and its config. Whether stopping on a notes file is wrong depends on how the line is read. | 1#10.1 |
| 465 | The command itself is never run with the redact flag and an untracked config: every test calls the inner function with the config's path. | real | no | Line 10 names the config file. The tests go round the command. The command passes the path through. | 1#10.2 |
| 465 | An untracked file inside the repo that the run only reads as input, a graph file or a list of files, is not on the run's own list, so it counts as added and the run refuses. | real | unsure | Line 10 says files the tool itself reads outside resolution do not stop the run, and then names two of them. The code's own list holds the output folder, the answers file and the config, and nothing else. No test puts an untracked input file in the repo. Whether the two named files are the whole list is not settled by the line. | 2#10.1 |
| 450 | Only top-level exported functions are ever tried. A class method, a getter or an arrow function held in a const is matched to the parsed code by its lines alone, and a mismatch quietly becomes an unknown. | real | unsure | Line 1 says every function the graph names. The tests use top-level exported functions. The matching is by first and last line, as the run says. Whether a method or an arrow mismatches I could not settle by reading. | 1#1.1 |
| 450 | A call under a condition whose result is kept, such as `const r = charge(user)` inside an `if`, writes no call fact: only a call that is a whole statement does. | real | unsure | Line 1 says a call under a condition is a fact. The code writes a call fact for a statement that is a call, and a declaration only binds a name. No test keeps a call's result under a condition. The line does not say whether a kept result still counts. | 1#1.2, 2#1.2 |
| 450 | `if (a) return 1; else if (b) return 2; return 3;` puts the last return under not-a only. The not-b is dropped. | real | yes | Line 2 is about the conditions an early exit leaves behind. The code throws away what the else branch learned unless the whole branch ends. No test has an else-if chain of exits. | 1#2.1, 2#2.1 |
| 450 | With `logger` set as a logging name, a logger that is a parameter or a local of the function is not stripped: it is renamed as a local, so its call is kept. | real | unsure | Line 4 is about stripping logging calls. The code strips a call whose target is a free name, and a parameter is not free. No test passes a logger in. Whether a local with that name should be stripped is not settled by the line. | 1#4.1, 2#4.1 |
| 450 | A function that returns null through a one-line either-or (`cond ? value : null`) gives one return fact for the whole expression, so a caller's check for null selects nothing. | real | yes | Line 14 is about a caller's null check picking out the callee's returns. The summary takes a return's value whole and does not split the two sides. No test returns through an either-or. | 1#14.1, 2#14.1 |
| 450 | A function called under an import alias gets no callee id, because the called name must end the callee's id, so the caller's null check stays unresolved. | real | yes | Line 14 again. The match is by the end of the id against the name as written at the call. No test imports under another name. | 1#14.2 |
| 450 | The two stage objects are exported from the package but are not in the script that checks the exports, so dropping one would still pass. | real | yes | Line 24 says the new exports are listed in that script. The script lists the functions and not the two stage objects. | 1#24.1 |
| 450 | A statement after a switch whose cases return runs under the unchanged condition, with no negation of the cases that left. | real | yes | Lines 2 and 29 cover early exits and switches. After a switch the code hands back the condition it came in with. No test has a statement after a switch whose cases return. Run 1 named it on line 29 and run 2 on line 2. | 1#29.1, 2#2.2 |
| 450 | Two functions the graph names that start and end on the same line are matched by line only, so the second is rewritten from the first one's body. | real | yes | Line 1 says every function the graph names. The match takes the first parsed function with the same first and last line. No test has two functions on one line. | 2#1.1 |
| 139 | A tool with a retry ladder is called with arguments that fail its input check: the rejection goes up the ladder like a handler failure, so it is retried and the model is shown retries used up, though the handler never ran. | not real | | The criterion's words do not cover it. Line 2 says how a tool that used up its retries settles, and this one settles that way. Which failures a ladder should retry is in no line. What the run says about the code reads true: every failure reason is offered to the ladder. It may be a flaw worth a ticket, outside these criteria. | 1#2.1 |
| 139 | A tool has both fields and its time runs out part-way up the ladder, during a wait or a later attempt, with no kill: the one test with both fields has a handler that succeeds at once. | real | no | Line 2 covers a timed-out tool. No test lets the time run out during a wait. As read, the limit's timer ends the call while it waits and the retry timer goes with it. | 1#2.2 |
| 139 | The process is killed while an attempt is running, after an earlier failed attempt: on restart the attempt is issued again with the same count and a fresh full time limit. | cannot tell | | The code does what the run says: a restart from a running attempt works out a new limit from the restart time. No test kills during an attempt. But line 3 says a kill between attempts, and no line says what a restart should do to the time limit, so reading does not settle whether the line covers it. The known case has the same weakness. | 1#3.1 |
| 139 | A saved state from before this change, with no field for the ladders, is resumed part-way through a batch of plain tools: one fallback covers it and no test loads such a state. | real | no | Line 4 says tools without the fields behave as before. No test loads a state without the field. The fallback to an empty value is there and reads right. | 1#4.1 |

The reason for each hit and miss mark is in `61-marks.json`, under `runs`.

### What it cost

- **$11.10 for the 12 runs of the plan: $0.92 a run**, from $0.62 to $1.64.
  The seventh case's run cost $0.72. All 13: $11.82.
- **138 seconds a run**, from 81 to 290. 23 tool calls a run.
- **The price follows the ticket.** #450 has 30 criteria and cost $1.64 and
  $1.41. #528 has 15 and cost $1.21 and $1.29. The other four have 8 to 11
  and cost $0.62 to $0.77.
- **Model `claude-opus-5-5`, effort `medium`**, as the SDK reported it. That
  is what `opus` in the review stage's settings came out as.
- **291 tool calls in all: Read 190, Grep 71, Glob 30.** None refused. No
  run broke and no answer failed its shape.

## Guesses that were wrong

- **"A later issue showed the gap", for four cases.** All four issues were
  filed before the merge, out of the pipeline's own review. I had read the
  issues for what they said about the code and not for when and why they
  were filed. The plan above still shows the mistake.
- **18 runs for about $12.** The first run cost $0.65 and I planned on that.
  The mean was $0.92, so the money bought 12 runs and one more.
- **"Three tools is the whole tool list."** True of 10 runs. In 3 the list
  also held 17 connector tools. See the next section.
- **The flag would point at the holes a reviewer finds.** It points at the
  holes, four of six. It does not point at the ones found.
- **kamp-us/phoenix would give cases.** It gave none that passed the four
  tests, as the plan already says.
- **The tests-only arm.** Planned if budget was left. None was.

## What this cannot tell us

- **Whether a reviewer finds a gap nobody has seen.** One case, one run, a
  weak key. Everything else here is "can it find again what was seen".
- **Whether the marks are right.** An agent marked an agent's answers. It
  knew the answer keys and it wrote them. It ran nothing: every "real",
  every "code looks wrong" and every "reads right" is a reading. The hit and
  miss marks are clear-cut, apart from #139. The real and not-real marks
  are softer, and "does the line's wording cover this case" is a judgment
  each time. The full list is above for that reason.
- **Whether the cases are typical.** Seven cases, one repo, picked by hand
  by the same agent. A case had to have a gap that shows when the code is
  read. That favours gaps a reading reviewer can find.
- **Whether a third run would differ.** Two runs agreed on every case. The
  plan's "2 of 3" could not be applied as written.
- **What the hints did.** Four of seven copies held one. Two of three hits
  had one. That is too few to say a hint helped.
- **What the prompt's limits did.** It says most criteria have no missing
  case and caps a line at two. That may have kept a known case out on a
  ticket with 30 lines. I did not change the prompt after seeing a result,
  so there is one prompt and one result.
- **What a reviewer with the diff would do.** This one got the code after
  the change and the names of the changed test files, as the brief asked.
  Today's reviewer also gets the diff and the pull request's own text.
- **The tool list was not clean in three runs.** The SDK's first message in
  runs 450/1, 634/2 and 528/2 listed 17 more tools: the tools of two
  connectors of the account the machine was signed in to, which can reach
  the network. `tools` in the run's options names three, and no settings
  were loaded. No run called one of the 17: the 291 calls are all Read, Grep
  and Glob. So "no network was used" holds for all 13 runs, and "the tool
  list is three tools" holds for 10. The review stage uses the same options,
  so it has the same opening. The saved runs hold a count of these tools and
  not their names. I rebuilt the branch's last commits once to take the
  names out; the order of the commits is unchanged.
- **Some criteria were written by a review round.** A line that ends in
  `<!-- ac:review pr:#N round:N -->` was added by today's reviewer while it
  reviewed that same pull request. #450's line 30 is one. The reviewer here
  got those lines as written, marker and all.
- **The #139 ticket was read with a changed rule**, the cut of the "original
  report" block. Part A's lines are the same under both rules.
- **Part A is two days of one repo.** 17 tickets, most about one tool. One
  sorter. The flag is a floor.
- **What a missing case costs when it ships.** Not looked at here.
  [Experiment 60](./60-what-happens-to-filed-follow-ups.md) reads what
  happens to the follow-ups.

**Took from it:** asked "which case is missing from these checks?", the
reviewer found a known gap in half the cases, and the same half both times.
That is neither the two thirds the plan asked for nor a failure. It is also
not yet a test of step 3: every gap in the six had been seen by somebody
before the merge, and the one that had not was missed. The stronger result
is the by-product. A run named about three other cases, nine in ten held up
when read, and about a third of those look like wrong code that shipped. All
of that hangs on one agent's reading, so the next thing this needs is a
person, or a test run, on the list above.

## Run it

```
node experiments/61-missing-case.ts          # every table, from the saved files: no key, no network
LIST=1 node experiments/61-missing-case.ts   # and the full list of other cases
```

To do it again:

```
STEP=lines node experiments/61-missing-case.ts    # Part A's lines, through gh, read-only
STEP=keys node experiments/61-missing-case.ts     # each case's head commit, criteria and test files, through gh
CLONE=<a clone that holds every head commit> STEP=leaks node experiments/61-missing-case.ts
CLONE=<the same> STEP=review node experiments/61-missing-case.ts   # paid: RUNS, ONLY, MAX_USD, RUN_USD
STEP=prompt ONLY=634 node experiments/61-missing-case.ts          # what one case's reviewer is sent
```

`STEP=review` runs an agent through the Agent SDK on the signed-in Claude
account. It skips a run that is already saved and stops before `MAX_USD`. A
head commit of a pull request has to be fetched into the clone first
(`git fetch origin pull/<number>/head`).

- `61-criteria.json`: the 106 lines as written. `61-sorting.json`: the
  rules, and a kind, a flag and a reason for every line.
- `61-cases.json`: the seven answer keys, by hand.
  `results/missing-case-keys.json`: the same with each head commit, the
  criteria and the test files.
- `results/missing-case-leaks.json`: every line the search of each copy
  found. `61-marks.json`: the scoring rules, the hints, and every mark with
  its reason.
- `results/missing-case-runs.json`: all 13 runs as saved: the answer, the
  cost, the time, and every tool call with the path it was pointed at.
  `results/missing-case.json`: the counts.

None holds a path of the machine it ran on, an account name, or a pull
request's text.
