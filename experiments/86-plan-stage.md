# 86. A plan stage for every ticket

The pipeline under test is report, triage (sort only), **plan**, build, review,
ship. Plan is a stage for every ticket, sized to the work; an epic is just a
plan with many tasks. The plan is data, kept outside any builder, so each task
can get a fresh builder. Criteria are **outcomes**: one claim per line, "When
‹trigger›, ‹thing› ‹observable result›", with no file paths or function names.
Those go in a `pointers` list that binds nobody. An open product call becomes a
question with a lean. Each task ends in `pr` or `answer`; a decision is a
question, never a task.

This is part 1: the plan program, run read-only on 6 closed demlik tickets and
set beside today's triaged criteria and the merged PR.

**Answer: yes, the plan stage writes outcome criteria, and it is not a
sledgehammer at the criteria level. A blind reader called 93% of our criteria
outcomes, against 49% of today's. Every plan was one task. Our criteria are
shorter than today's (1,294 words against 1,579 over the six). But the whole
plan, with its summary, pointers and questions, is about 3 times today's
criteria text, and it lost two things today's criteria had: the realistic
end-to-end fixture, and the names a user types. $4.39 in all, 28 to 105
seconds a plan. Confidence 70%.**

The plans, as views to mark up, are in [`86-plans/`](./86-plans/).

## Who did what

| Part | Whose |
|---|---|
| The reports, the triaged criteria, the builds and the merged PRs | today's fabrika on kamp-us/demlik, before this run |
| The six tickets' records (report as filed, PR, files, tests, notes) | the replay set (`replay/issues/`), unchanged |
| The plan program: the data, the Check, the machine, the planner, the view (`wip/src/stages/plan/`) | tea-fabrika, new here |
| The code facts each planner was handed | tea-fabrika's first-generation triage facts (`legacy/src/facts.ts`, `legacy/src/code-facts.ts`), reused unchanged |
| The runs, the blind judge and the tables (`86-plan-stage.ts`) | tea-fabrika, new here |
| The planner | Claude (`opus`, effort medium) through the Agent SDK, with Read, Grep and Glob only |
| The outcome or recipe labels | Claude (`sonnet`) through the Agent SDK, no tools, blind to which criteria are whose |
| Caught or missed, and whether each question was real | a reader, from the PR's files, test names and the replay notes |

Nothing was written to GitHub. No lane ran.

## How it was done

**The program.** `plan` is a tea-program program. It reads the ticket (Gather),
gathers code facts about the names and paths it mentions (Gather, reusing the
first-generation facts), then one planner run writes the plan as typed data
(Draft). A pure Check reads the plan. Its problems go back into the same
conversation, up to 3 drafts (the refine combo). It ends `done`,
`ask:owner:questions` (the plan passed and has open questions),
`skip:closed`, or `stuck` with a reason.

The Check sends a criterion back when:

- it names code: a path, a file name, a camelCase or PascalCase name, a call,
  or anything in backticks;
- it says more than one thing;
- its result reads as a step to take;
- a question has no lean.

**The planner's view of the code.** Each ticket was planned at its PR's base
commit: the commit the fix was built on. The planner read a `git archive` copy
at that commit, with no history, so it could not see the fix. Facts came from a
scratch clone at the same commit. The planner saw the report as it was filed,
not today's triaged ticket.

**The six.**

| # | Kind | Why picked |
|---|---|---|
| [367](https://github.com/kamp-us/demlik/issues/367) | bug | small runtime bug |
| [579](https://github.com/kamp-us/demlik/issues/579) | bug | small docs bug |
| [393](https://github.com/kamp-us/demlik/issues/393) | feature | a new rule |
| [504](https://github.com/kamp-us/demlik/issues/504) | feature | the PR re-paired one criterion's example |
| [490](https://github.com/kamp-us/demlik/issues/490) | chore | comment only: the sledgehammer case |
| [565](https://github.com/kamp-us/demlik/issues/565) | feature | the criterion's fixture proved wrong |

**Outcome or recipe.** For each ticket, today's criteria and ours were shuffled
together and handed to Sonnet with no word of whose was whose. It labelled
each one `outcome`, `recipe`, or `mixed` (an observable result pinned to
internal names). Rows marked `ac:review` were left out; there were none in
these six.

## The numbers

| # | Ended | Drafts | Cost | Time | Tasks | Criteria, today / ours | Criteria words, today / ours | Whole plan words | Questions | The PR |
|---|---|---|---|---|---|---|---|---|---|---|
| 367 | ask | 2 | $0.55 | 63 s | 1 | 5 / 3 | 150 / 98 | 675 | 1 | 3 files, +101 −19 |
| 579 | ask | 3 | $0.89 | 78 s | 1 | 6 / 5 | 139 / 121 | 646 | 1 | 3 files, +100 −8 |
| 393 | ask | 2 | $0.57 | 71 s | 1 | 10 / 8 | 229 / 254 | 930 | 2 | 5 files, +186 −34 |
| 504 | ask | 3 | $0.95 | 105 s | 1 | 8 / 13 | 390 / 422 | 1,240 | 2 | 5 files, +382 −17 |
| 490 | done | 2 | $0.13 | 28 s | 1 | 4 / 3 | 93 / 88 | 300 | 0 | 1 file, +5 −2 |
| 565 | ask | 3 | $0.80 | 68 s | 1 | 6 / 11 | 578 / 311 | 880 | 1 | 10 files, +389 −27 |
| all | | | $3.89 | | 6 | 39 / 43 | 1,579 / 1,294 | 4,671 | 7 | |

"Today" counts the triaged checklist only, gate rows included. "Whole plan"
counts everything a plan says: summary, titles, criteria, checks, pointers and
questions. 490 was planned twice; the first run took 3 drafts, gave 4 criteria
and 400 words, and cost $0.41. Planner runs took 7 to 15 turns, with a
conversation of 10k to 27k tokens at the end.

**Outcome or recipe, blind:**

| Criteria | Outcome | Mixed | Recipe |
|---|---|---|---|
| today (39) | 19 (49%) | 14 (36%) | 6 (15%) |
| ours (43) | 40 (93%) | 3 (7%) | 0 |

Spot-checked by hand, the direction holds. The judge was not consistent on
today's gate row (`pnpm typecheck && ...`): outcome on four tickets, recipe on
one. Our 3 "mixed" are about a doc comment, which it read as internal.

**What the Check sent back:** 34 problems over 9 later drafts (the second run of each ticket; the first run of 490 was not logged). 21 were "names
code", 13 were "two claims in one" or "a step, not a result". Every plan passed
within 3 drafts; none ended `unchecked`.

**Cost:** planner $4.30 (seven runs), judge $0.09, **$4.39 in all**.

## Caught or missed, against the PR

| # | Would the PR meet our criteria? | What ours missed that the PR did | What ours added |
|---|---|---|---|
| 367 | yes | today's "the doc says `at` is epoch ms" row | a pointer to the detached span's end, which became follow-up [#373](https://github.com/kamp-us/demlik/issues/373) from this lane's review |
| 579 | **no**: 3 of 5 criteria ask to run step 3's program and read its state; the PR type-checked the page text | the PR's way: the page's own text is type-checked | 3 criteria past the ticket, and a "matches its source" check that bakes in a design |
| 393 | yes, except perhaps the EXCEEDED hint text (the record cannot say) | the human view tagging B4 (the PR changed it) | a criterion on the EXCEEDED hint |
| 504 | yes if the owner picks what shipped; our lean was the other way | the end-to-end fixture: an upward import reported at its line, exit 1, then exit 0 once allowed | asks the two calls today's triage made quietly |
| 490 | yes; no test, no changeset asked, as the replay notes want | nothing | nothing |
| 565 | yes | the realistic end-to-end sequence: record the crossings, gate green twice, prune one once its write is gone | no wrong fixture: it pinned none, so the PR's deviation could not happen |

**Questions: 7 asked, 5 real.**

- **Real:**
  - 504's "which pattern wins an overlap?". Today's triage settled it
    quietly, and its own example came out wrong under its own rule.
  - 504's "refuse a tie when it is resolved, or per file?". The PR chose
    per file; our lean was the other way.
  - 393's "judge importers outside `src/`?"
  - 367's "fix the library or only the test?". The lean matched the PR.
  - 565's "missing `decidedBy` against an empty list". The lean matched the
    PR.
- **Not real:**
  - 579's "where should step 3's source live?" is a build choice, not a
    product call.
  - 393's "same ceiling?": the ticket already said yes.

Five of six plans ended `ask:owner`, so the owner would be asked on most
tickets.

## What it found

1. **The no-code-names rule bans what a user types.** Of the 21 "names code"
   problems, most named things a user of the package meets:
   - a CLI flag in backticks (`--boundaries --ci`);
   - a key the user writes in a rules file (`decidedBy`);
   - a glob pattern that is the feature itself (`**/*-plumbing.ts`).

   The planner obeyed by going vague. "A layer declared by a filename suffix
   under any number of folders" pins less than today's "`**/*-x.ts` claims
   `a-x.ts` and `a/b/c/d/e-x.ts`". The rule should ban internal names only.
2. **The realistic end-to-end case got lost.** On 504 and 565, today's first
   criterion was a full fixture of the user's job, and both PRs built it. Our
   plans broke the job into small single claims and dropped the run that ties
   them together. One claim per line plus no concrete names pushes plans away
   from the fixture demlik's own rule asks for first. On 565 that dodged a
   wrong fixture; on 504 it lost the test the PR leaned on most.
3. **Questions surface real calls, and too many of them.** The best case is
   504: today's triage made two product calls quietly, one example was wrong,
   and a deviation followed. Ours asked both, and its leans differed from
   what shipped, so asking was right. But 5 of 6 tickets would wait on the
   owner, and 2 of 7 questions were not product calls.

Smaller:

- **Size holds at the task and criteria level.** No ticket was split into
  tasks. Criteria are shorter than today's, and the comment-only chore stayed
  at 3 criteria with no test or changeset asked.
- **The bulk is pointers and summary.** 300 words for a 7-line change is
  heavy. Pointers run to 4 to 8 per plan, and their `at` often holds a sentence,
  not a place.
- **Over-asking still happens (579).** Three criteria went past the ticket.
  The Check cannot see scope.
- **Run to run, 490 moved.** 4 criteria in 3 drafts, then 3 criteria in 2.

## Recommendations

- **Let criteria name what a user types**: CLI flags, config keys, published
  package and command names, pattern examples, a doc page's title. Keep the ban
  on internal paths, files, functions and types.
  - Why: 21 of 34 send-backs, and the vaguer criteria they caused.
  - Tradeoff: the Check must tell a published name from an internal one. A
    list from the package's exports and CLI help would do it, through code
    facts.
  - Confidence 80%.
- **Make the first criterion the user's whole job, with a realistic fixture,
  and exempt it from "one claim".** That is demlik's own rule.
  - Why: 504 and 565 lost the test their PRs leaned on most.
  - Tradeoff: a long first criterion is where 565's wrong fixture came from.
    Keep the fixture's shape in the criterion and its exact files in pointers.
  - Confidence 70%.
- **Let a plan with questions go ahead on its leans, and ask the owner
  without blocking.** Block only when the plan marks a question as one that
  changes what ships.
  - Why: 5 of 6 tickets would otherwise wait.
  - Tradeoff: a wrong lean gets built, as 504's would have been, and has to be
    redone after the owner answers.
  - Confidence 60%.
- **Cap pointers**: a place in `at` (a path, a test name), and the reason in
  `why`, a few at most.
  - Why: pointers are most of the words.
  - Confidence 65%.

## Next

**checkRun, not done here.** It would answer "does this check fail at the base
commit today?". It needs an installed copy per base commit, and the vet code
is shaped for examples and snippets, not for a plan's checks. It is the next
cheap part once the plans name runnable checks.

**Part 2 (not this run): does a plan help a builder?** Same six tickets, on the
sandbox copy of demlik at each base commit, the owner's answers taken as what
shipped.

- Arm A: one builder gets the report and plans for itself.
- Arm B: a fresh builder per plan task, given only that task's criteria and
  the pointers.

All six plans here are one task, so B needs at least one multi-task ticket
added. Use a replay ticket that took two PRs, or a small epic. Measure:

- whether the PR's own added tests pass on the builder's change (the hidden
  answer key);
- the review rounds;
- cost and time;
- the diff size against the real one;
- the deviations each builder had to write.

Run each arm twice: 490 shows the planner's spread.

Later, on 2026-10-24: in the plan for #393, in `86-plans/393.md` and
`results/86b-plans.json`, one product name the planner copied from the ticket
was replaced with `‹product›` in two places, to keep it out of this public
repo. Nothing else changed.

## What this cannot tell us

- Six tickets, all from two packages. One reader judged caught or missed, from
  file lists, test names and the replay notes, not the full diffs. The EXCEEDED
  hint on 393 is one this record cannot settle.
- The blind judge is one run of one model. It may favour our "When ..., ..."
  form for its look.
- No builder ran from these plans. Whether outcome criteria build better is
  part 2's question.
- The questions were judged by what shipped, not by an owner. A real owner
  might call some of the "real" ones obvious.
- Code facts were handed over every time; this run cannot say whether they
  helped.
- Experiment 85 landed note ids up to 2026-10-18-159 while this ran, so this
  run's notes start at -160. Experiment 87 runs at the same time and may need
  to move its ids.
