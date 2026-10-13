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
